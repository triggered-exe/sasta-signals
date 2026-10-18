// Watch the video https://youtu.be/WP-S1QolVvU which is recorded for the future reference
import logger from "../utils/logger.js";
import { JiomartProduct } from "../models/JiomartProduct.js";
import contextManager from "../utils/contextManager.js";
import { AppError } from "../utils/errorHandling.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";

const setLocation = async (location) => {
  // Validate that location is a numerical pincode
  if (!location || !/^\d+$/.test(location)) {
    throw AppError.badRequest("Location must be a valid numerical pincode");
  }

  let page = null;
  try {
    const context = await contextManager.getContext(location);

    if (contextManager.getWebsiteServiceabilityStatus(location, "jiomart-grocery")) {
      logger.info(`JIO: Using existing serviceable context for ${location}`);
      return context;
    }

    page = await contextManager.createPage(context, 'jiomart');
    logger.info("JIO: Navigating to JioMart...");
    await page.goto("https://www.jiomart.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    const readLocationCookie = async () => {
      const cookies = await context.cookies();
      const cookie = cookies.find((c) => c.name === "app_location_details");
      if (!cookie) return null;
      try {
        return JSON.parse(decodeURIComponent(cookie.value));
      } catch (e) {
        return null;
      }
    };

    let locationDetails = await readLocationCookie();
    logger.info(`JIO: Location cookie before setup: ${JSON.stringify(locationDetails)}`);

    if (!locationDetails || String(locationDetails.pincode) !== String(location)) {
      // New JioMart location flow: AllowLocation modal -> manual search ->
      // Google Places suggestions rendered in .pac-container.
      let manualButton = page.getByRole("button", { name: /select location manually/i }).first();
      try {
        await manualButton.waitFor({ state: "visible", timeout: 15000 });
      } catch (e) {
        logger.warn("JIO: Manual location button not visible, reloading once");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(5000);
        manualButton = page.getByRole("button", { name: /select location manually/i }).first();
      }

      if (await manualButton.count()) {
        await manualButton.click();
        await page.waitForTimeout(1000);

        const searchInput = page.locator('input[placeholder="Search for area, landmark"]').first();
        await searchInput.waitFor({ state: "visible", timeout: 10000 });

        let suggestionsFound = false;
        for (let attempt = 0; attempt < 2 && !suggestionsFound; attempt++) {
          await searchInput.fill("");
          await searchInput.click();
          await page.keyboard.type(location, { delay: 100 });
          try {
            await page.waitForSelector(".pac-container .pac-item", { timeout: 10000 });
            suggestionsFound = true;
          } catch (e) {
            logger.warn(`JIO: Location suggestions not found (attempt ${attempt + 1})`);
            await page.waitForTimeout(2000);
          }
        }

        if (!suggestionsFound) {
          throw AppError.badRequest(`No location suggestions found for ${location}`);
        }

        await page.locator(".pac-container .pac-item").first().click();

        // The cookie can take a moment to update after selecting a suggestion.
        for (let attempt = 0; attempt < 10; attempt++) {
          await page.waitForTimeout(1000);
          locationDetails = await readLocationCookie();
          if (locationDetails && String(locationDetails.pincode) === String(location)) break;
        }
      }
    }

    logger.info(`JIO: Location cookie after setup: ${JSON.stringify(locationDetails)}`);
    if (!locationDetails || String(locationDetails.pincode) !== String(location)) {
      throw AppError.badRequest(`Failed to set location to ${location}`);
    }

    // The autocomplete updates the cookies but not always localStorage.pin,
    // which the header and collection pages use. Write it explicitly.
    const pin = {
      country: locationDetails.country || "INDIA",
      country_iso_code: locationDetails.country_iso_code || "IN",
      pincode: String(location),
      city: locationDetails.city || "",
      state: locationDetails.state || "",
    };
    await page.evaluate((value) => localStorage.setItem("pin", JSON.stringify(value)), pin);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    contextManager.markServiceability(location, "jiomart-grocery", true);
    logger.info(`JIO: Successfully set up for location: ${location}`);
    await page.close();
    return context;
  } catch (error) {
    try {
      if (page) await page.close();
    } catch (cleanupError) {
      logger.error(`JIO: Error during cleanup for ${location}: ${cleanupError.message || cleanupError}`, { error: cleanupError });
    }
    logger.error(`JIO: Error initializing context for ${location}: ${error.message || error}`, { error });
    throw error;
  }
};

const fetchJiomartCategories = async (context) => {
  let page = null;
  try {
    page = await contextManager.createPage(context, 'jiomart');
    await page.goto("https://www.jiomart.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(4000);

    let categories = null;
    for (let attempt = 0; attempt < 3 && !categories; attempt++) {
      categories = await page.evaluate(() => {
        const raw = localStorage.getItem("shop_all_categories_trees") || localStorage.getItem("quick_categories_trees");
        if (!raw) return null;

        let tree;
        try {
          tree = JSON.parse(raw);
        } catch (e) {
          return null;
        }

        const department = tree.find((d) => d.department?.value === "groceries");
        if (!department) return null;

        const cats = department.categories || {};
        const l1ByUid = new Map((cats.l1_category || []).map((c) => [c.uid, c]));
        const result = {};

        for (const l2 of cats.l2_category || []) {
          const hierarchy = (l2.hierarchy || []).find((h) => h.department === department.department.uid) || (l2.hierarchy || [])[0] || {};
          const parentUid = (l2.parentL1Uids || [])[0] || hierarchy.l1;
          const parent = l1ByUid.get(parentUid);
          if (!parent) continue;

          const url = `https://www.jiomart.com/products?department=${encodeURIComponent(department.department.value)}&l1_category=${encodeURIComponent(parent.value)}&l2_category=${encodeURIComponent(l2.value)}`;

          if (!result[parent.display]) result[parent.display] = {};
          if (!result[parent.display][l2.display]) result[parent.display][l2.display] = [];
          result[parent.display][l2.display].push({ name: l2.display, url });
        }

        return Object.keys(result).length ? result : null;
      });

      if (!categories) await page.waitForTimeout(2000);
    }

    if (categories) {
      const count = Object.values(categories).reduce((sum, subs) => sum + Object.keys(subs).length, 0);
      logger.info(`JIO: Extracted ${count} subcategories from localStorage category tree`);
      return categories;
    }
  } catch (error) {
    logger.error(`JIO: Error reading localStorage category tree: ${error.message || error}`, { error });
  } finally {
    if (page) await page.close();
  }

  logger.warn("JIO: Category tree unavailable; using collection fallback");
  return {
    Grocery: {
      "All Vegetable & Fruits": [{
        name: "All Vegetable & Fruits",
        url: "https://www.jiomart.com/collection/all-vegetable--fruits",
      }],
      "Premium Fruits": [{
        name: "Premium Fruits",
        url: "https://www.jiomart.com/collection/premium-fruits",
      }],
    },
    Beauty: {
      "Beauty & Cosmetic": [{
        name: "Beauty & Cosmetic",
        url: "https://www.jiomart.com/collection/beauty--cosmetic",
      }],
    },
    "Home & Kitchen": {
      "Kitchen Appliances": [{
        name: "Kitchen Appliances",
        url: "https://www.jiomart.com/collection/kitchen-appliance",
      }],
    },
  };
};

const filterCategories = (categories) => {
  const categoriesToRemove = ["lifestyle", "electronics", "fashion", "industrial", "jewellery", "luggage", "furniture"];

  let filteredCategories = {};
  Object.keys(categories).forEach((category) => {
    const shouldRemove = categoriesToRemove.some((categoryToRemove) =>
      category.toLowerCase().includes(categoryToRemove.toLowerCase())
    );

    if (!shouldRemove) {
      filteredCategories[category] = categories[category];
    }
  });
  const subCategoriesToRemove = [
    "baby care",
    "Home",
    "wipes",
    "Kitchenware",
    "Bakeware",
    "Tableware",
    "Disposables",
    "crafts",
    "Exam Central",
    "Mom & Baby",
    "Covid Essentials",
    "Make-Up",
    "Treatments",
    "Tools & Appliances",
    "Jewellery",
  ];
  // Lets create a single array of categories
  let allCategories = [];
  Object.keys(filteredCategories).forEach((category) => {
    Object.entries(filteredCategories[category]).forEach(([subCategoryKey, subCategoryValue]) => {
      const shouldRemove = subCategoriesToRemove.some((subCategoryToRemove) =>
        subCategoryKey.toLowerCase().includes(subCategoryToRemove.toLowerCase())
      );
      if (!shouldRemove) {
        subCategoryValue.forEach((subCategory) => {
          allCategories.push({
            category,
            subCategory: subCategoryKey,
            name: subCategory.name,
            url: subCategory.url,
          });
        });
      }
    });
  });

  return allCategories;
};

const extractProductsFromPage = async (page, url, MAX_LOAD_MORE_ATTEMPTS = 15) => {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const firstCard = await page.waitForSelector(".productCard__productCard", { timeout: 15000 }).catch(() => null);
    if (!firstCard) {
      logger.info(`JIO: No products found on ${url}`);
      return { products: [] };
    }

    // Load any products rendered behind a Load more button or scroll.
    for (let attempt = 0; attempt < MAX_LOAD_MORE_ATTEMPTS; attempt++) {
      const before = await page.$$eval(".productCard__productCard", (cards) => cards.length);
      const loadMore = page.getByRole("button", { name: /load more/i }).first();
      if (await loadMore.count()) {
        await loadMore.click().catch(() => {});
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
      const after = await page.$$eval(".productCard__productCard", (cards) => cards.length);
      if (after === before) break;
    }

    const products = await page.evaluate(() => {
      const parseNumber = (value) => {
        if (value === undefined || value === null) return 0;
        const number = parseFloat(String(value).replace(/,/g, ""));
        return Number.isFinite(number) ? number : 0;
      };

      return [...document.querySelectorAll(".productCard__productCard")]
        .map((card) => {
          const gtm = card.querySelector(".gtmEvents");
          const attrs = gtm
            ? Object.fromEntries([...gtm.attributes].map((attr) => [attr.name, attr.value]))
            : {};
          const text = (card.innerText || "").replace(/\s+/g, " ").trim();
          const prices = [...text.matchAll(/₹([\d,]+(?:\.\d+)?)/g)]
            .map((match) => parseFloat(match[1].replace(/,/g, "")))
            .filter((value) => Number.isFinite(value));

          const price = parseNumber(attrs["data-price"]) || prices[0] || 0;
          const mrp = prices.find((value) => value > price) || price;
          const productName = attrs["data-name"] || card.querySelector(".productCard__productTitle")?.innerText?.trim() || "";
          const productId = attrs["data-id"] || attrs["data-alternate"] || "";
          const slug = attrs["data-slug"] || "";
          const imageUrl = attrs["data-image"] || card.querySelector(".productCard__productImage")?.src || "";
          const weight = card.querySelector(".productCard__sizeSpan")?.innerText?.trim() || "";
          const brand = attrs["data-manu"] || "";
          const inStock = !/out of stock|sold out/i.test(text);
          const discount = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;

          return {
            productId,
            productName,
            categoryName: attrs["data-cate"] || "",
            subcategoryName: attrs["data-subcate"] || "",
            url: slug ? `https://www.jiomart.com/product/${slug}` : "",
            imageUrl,
            price,
            mrp,
            discount,
            weight,
            brand,
            inStock,
          };
        })
        .filter((product) => product.productId && product.productName && product.price > 0);
    });

    logger.info(`JIO: Successfully extracted ${products.length} products from page ${url}`);
    return { products };
  } catch (error) {
    logger.error(`JIO: Error extracting products from page: ${error.message || error}`, { error });
    return { products: [] };
  }
};

let isJioMartCrawlerRunning = false;
export const startTrackingHandler = async (location) => {
  if (isJioMartCrawlerRunning) {
    throw AppError.badRequest("JioMart crawler is already running");
  }
  isJioMartCrawlerRunning = true;
  while (true) {
    try {
      // Skip if it's night time (12 AM to 6 AM IST)
      if (isNightTimeIST()) {
        logger.info("JIO: Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      const startTime = new Date();
      logger.info(`JIO: Starting price tracking at: ${startTime.toLocaleString()}`);

      // Setup the context for the location
      const context = await setLocation(location);

      const categories = await fetchJiomartCategories(context);

      let filteredCategories = await filterCategories(categories);
      // Check if the location is serviceable
      if (!contextManager.getWebsiteServiceabilityStatus(location, "jiomart-grocery")) {
        logger.warn(`JIO: Location ${location} is not serviceable, stopping crawler`);
        break;
      }
      // lets shuffle the filteredCategories
      filteredCategories = filteredCategories.sort(() => Math.random() - 0.5);

      // Process queries in parallel batches
      const PARALLEL_SEARCHES = 1;

      for (let i = 0; i < filteredCategories.length; i += PARALLEL_SEARCHES) {
        const currentBatch = filteredCategories.slice(i, i + PARALLEL_SEARCHES);
        logger.debug(
          `JIO: Processing categories ${i + 1} to ${i + currentBatch.length} of ${filteredCategories.length}`
        );

        const batchPromises = currentBatch.map(async (category) => {
          try {
            let page = null;

            try {
              page = await contextManager.createPage(context, 'jiomart');

              // Extract products using the new function
              const { products } = await extractProductsFromPage(page, category.url);

              if (products.length > 0) {
                // Add category information to products
                const enrichedProducts = products.map((product) => ({
                  ...product,
                  categoryName: product.categoryName || category.category,
                  subcategoryName: product.subcategoryName || category.subCategory,
                }));

                // Process and store products
                const processedCount = await globalProcessProducts(enrichedProducts, category.category, {
                  model: JiomartProduct,
                  source: "JioMart",
                  significantDiscountThreshold: 10,
                  telegramNotification: true,
                  emailNotification: false,
                });

                logger.info(`JIO: Processed ${processedCount} products for ${category.name} (${category.subCategory})`);
              } else {
                logger.debug(`JIO: No products found for ${category.name}`);
              }
            } catch (error) {
              logger.error(`JIO: Error processing category ${category.name}: ${error.message || error}`, { error });
            } finally {
              if (page) {
                logger.debug(`JIO: Closing product extraction page for ${category.name}`);
                await page.close();
              }
              // Small delay between requests to be polite
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          } catch (error) {
            logger.error(`JIO: Error processing category ${category.name}: ${error.message || error}`, { error });
          }
        });

        await Promise.all(batchPromises);
        logger.info(
          `JIO: Categories Processed: ${i + currentBatch.length} of ${filteredCategories.length} and Time taken: ${(
            (new Date().getTime() - startTime.getTime()) /
            60000
          ).toFixed(2)} minutes`
        );
      }

      logger.info(
        `JIO: Tracking completed in: ${((new Date().getTime() - startTime.getTime()) / 60000).toFixed(2)} minutes`
      );
    } catch (error) {
      // Wait for 1 minutes
      await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
      logger.error(`JIO: Error in crawler: ${error.message || error}`, { error });
    }
  }
};

// Core search function that can be used by unified search
export const search = async (location, query) => {
  try {
    // Get or create context for the location
    const context = await setLocation(location);

    // Check if the location is serviceable
    if (!contextManager.getWebsiteServiceabilityStatus(location, "jiomart-grocery")) {
      throw new Error(`Location ${location} is not serviceable by JioMart`);
    }

    // Create a new page for search
    const page = await contextManager.createPage(context, 'jiomart');

    try {
      // Navigate to search page
      const searchUrl = `https://www.jiomart.com/products?q=${encodeURIComponent(query)}`;
      logger.debug(`JIO: Navigating to search URL: ${searchUrl}`);

      // Extract products from the page using existing function
      const { products } = await extractProductsFromPage(page, searchUrl, 3);

      logger.info(`JIO: Found ${products.length} products for query "${query}"`);

      return {
        success: true,
        products: products || [],
        total: products?.length || 0,
      };
    } finally {
      await page.close();
    }
  } catch (error) {
    logger.error(`JIO: Search error: ${error.message || error}`, { error });
    throw error;
  }
};

export const startTracking = async (req, res, next) => {
  try {
    const location = req.query.location;
    if (!location) {
      throw AppError.badRequest("Location is required");
    }
    // Start the search process in the background
    startTrackingHandler(location).catch((error) => {
      logger.error(`JIO: Error in search handler: ${error.message || error}`, { error });
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};