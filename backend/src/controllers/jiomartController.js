import { JiomartProduct } from "../models/JiomartProduct.js";
import contextManager from "../utils/contextManager.js";
import { AppError } from "../utils/errorHandling.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
// Removed axios and cheerio; using Playwright context exclusively

const setLocation = async (location) => {
  let page = null;
  try {
    // Get or create context
    const context = await contextManager.getContext(location);

    // Return existing context if already set up and serviceable
    if (contextManager.isWebsiteServiceable(location, "jiomart-grocery")) {
      console.log(`JIO: Using existing serviceable context for ${location}`);
      return context;
    }

    // Set up JioMart for this context
    page = await context.newPage();

    // Navigate to JioMart
    console.log("JIO: Navigating to JioMart...");
    await page.goto("https://www.jiomart.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20000, // 20 second timeout
    });

    await page.waitForTimeout(5000); // Increased timeout

    // Step 1: check if enable location modal is present and visible
    const enableLocationModal = await page.$("#location_popup");
    const modalVisible = await enableLocationModal.evaluate((el) => el.style.display !== "none");
    if (modalVisible) {
      // Click on the close modal button
      await page.click("#btn_location_close_icon");
    }

    // Step 2: check if location input popup with form is present and visible
    const pincodePopup = await page.$("#delivery_popup");
    const pincodePopupVisible = await pincodePopup.evaluate((el) => el.style.display !== "none");
    if (pincodePopupVisible) {
      // Fill the input , by focusing on the input field
      await page.focus("#rel_pincode");
      await page.keyboard.type(location);
      await page.waitForTimeout(5000); // Wait for 5 seconds
      // Check if the delivery is availale at the location by checking the info message in the modal
      const deliveryInfo = await page.$("#delivery_pin_msg");
      const deliveryInfoText = await deliveryInfo.evaluate((el) => el.textContent);
      if (deliveryInfoText.includes("not delivering")) {
        throw AppError.badRequest(`Location ${location} is not serviceable by JioMart`);
      }
      await page.keyboard.press("Enter");
      await page.waitForTimeout(5000); // Wait for 5 seconds for page to reload and setup
    }

    // Location is serviceable - mark it as such
    contextManager.markServiceability(location, "jiomart-grocery", true);
    console.log(`JIO: Successfully set up for location: ${location}`);
    await page.close();
    return context;
  } catch (error) {
    // Mark location as not serviceable for any initialization errors too
    try {
      if (page) await page.close();
    } catch (cleanupError) {
      // Don't let cleanup errors override the original error
      console.error(`JIO: Error during cleanup for ${location}:`, cleanupError);
    }

    console.error(`JIO: Error initializing context for ${location}:`, error);
    throw error;
  }
};

const fetchJiomartCategories = async (context) => {
  console.log("JIO: Fetching categories...");
  let page = null;
  try {
    // Open page and scrape using Playwright DOM APIs
    page = await context.newPage();
    await page.goto("https://www.jiomart.com/all-category", {
      waitUntil: "networkidle",
      timeout: 20000,
    });
    // Extract links directly in the page context (no Cheerio needed)
    const allCategories = await page.$$eval("a[data-category][data-subcategory]", (els) =>
      els.map((el) => ({
        category: el.getAttribute("data-category") || "",
        subcategory: el.getAttribute("data-subcategory") || "",
        subSubCategory: (el.textContent || "").trim(),
        // el.href returns an absolute URL in the browser context
        url: el.href || null,
      }))
    );
    // Build nested structure and dedupe entries per subcategory
    // Result shape: { [category]: { [subcategory]: [{ name, url }] } }
    const categorized = {};
    for (const item of allCategories) {
      const cat = item.category || "Unknown";
      const sub = item.subcategory || "Misc";
      const name = item.subSubCategory || "";
      const href = item.url || null;

      if (!categorized[cat]) categorized[cat] = {};
      if (!categorized[cat][sub]) categorized[cat][sub] = [];

      // Deduplicate by name+url within a subcategory
      const list = categorized[cat][sub];
      const exists = list.some((e) => e.name === name && e.url === href);
      if (!exists) list.push({ name, url: href });
    }
    return categorized;
  } catch (error) {
    console.error("JIO: Error fetching categories:", error);
    throw error;
  } finally {
    if (page) await page.close();
  }
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

const extractProductsFromPage = async (page, url, MAX_SCROLL_ATTEMPTS = 25) => {
  try {
    // Ensure products are sorted by discount by appending query param
    const u = new URL(url);
    // u.searchParams.set(
    //   "prod_mart_master_vertical_products_popularity[sortBy]",
    //   "prod_mart_master_vertical_products_discount"
    // );
    let finalUrl = u.toString();

    // Navigate to current page with discount sorting
    await page.goto(finalUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for products to load
    await page.waitForSelector("a.plp_product_list", {
      timeout: 10000,
      state: "attached",
    });

    // Handle infinite scroll - scroll to load all products
    let previousProductCount = 0;
    let currentProductCount = 0;
    let scrollAttempts = 0;
    const MAX_NO_NEW_PRODUCTS_ATTEMPTS = 2;
    let noNewProductsAttempts = 0;

    while (scrollAttempts < MAX_SCROLL_ATTEMPTS && noNewProductsAttempts < MAX_NO_NEW_PRODUCTS_ATTEMPTS) {
      // Get current product count
      currentProductCount = await page.evaluate(() => {
        const productCards = document.querySelectorAll("a.plp_product_list");
        return productCards.length;
      });

      // If no new products were loaded, increment the counter
      if (currentProductCount === previousProductCount && scrollAttempts > 0) {
        noNewProductsAttempts++;
        console.log(`JIO: No new products loaded (attempt ${noNewProductsAttempts}/${MAX_NO_NEW_PRODUCTS_ATTEMPTS})`);
      } else {
        noNewProductsAttempts = 0; // Reset counter if new products were found
      }

      // Update previous count
      previousProductCount = currentProductCount;

      // Scroll to the last product to trigger loading of new products
      await page.evaluate(() => {
        const productCards = document.querySelectorAll("a.plp_product_list");
        if (productCards.length > 0) {
          const lastProduct = productCards[productCards.length - 1];
          lastProduct.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });

      // Wait for new products to load
      await page.waitForTimeout(3000);

      scrollAttempts++;
    }

    // Extract all products from the page
    const products = await page.evaluate(() => {
      const productCards = document.querySelectorAll("a.plp_product_list");
      const extractedProducts = [];

      productCards.forEach((card) => {
        try {
          // Extract product ID from data-objid attribute
          const productId = card.getAttribute("data-objid");
          if (!productId) return;

          // Extract product name from title attribute or from the name element
          let productName = card.getAttribute("title") || "";
          if (!productName) {
            const nameElement = card.querySelector(".plp-card-details-name");
            productName = nameElement ? nameElement.textContent.trim() : "";
          }
          if (!productName) return;

          // Extract product URL (relative URL from href)
          const url = card.getAttribute("href");
          const fullUrl = url ? `https://www.jiomart.com${url}` : "";

          // Extract image URL
          let imageUrl = "";
          const imgElement = card.querySelector("img");
          if (imgElement) {
            imageUrl = imgElement.getAttribute("data-src") || imgElement.getAttribute("src") || "";
          }

          // Extract price information
          let price = 0;
          let mrp = 0;

          // Extract current price - look for the first price element (non-crossed out)
          const priceElement = card.querySelector(".plp-card-details-price .jm-heading-xxs");
          if (priceElement) {
            const priceText = priceElement.textContent.trim();
            const priceMatch = priceText.match(/₹([\d,]+(?:\.\d+)?)/);
            if (priceMatch) {
              price = parseFloat(priceMatch[1].replace(/,/g, ""));
            }
          }

          // Extract MRP (crossed out price)
          const mrpElement = card.querySelector(".plp-card-details-price .line-through");
          if (mrpElement) {
            const mrpText = mrpElement.textContent.trim();
            const mrpMatch = mrpText.match(/₹([\d,]+(?:\.\d+)?)/);
            if (mrpMatch) {
              mrp = parseFloat(mrpMatch[1].replace(/,/g, ""));
            }
          }

          // If no MRP found, use price as MRP
          if (!mrp) mrp = price;

          // Calculate discount
          const discount = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;

          // Extract weight/variant information
          let weight = "";
          const variantElement = card.querySelector(".variant_value");
          if (variantElement) {
            weight = variantElement.textContent.trim();
          }
          
          // Fallback: try to extract from product name if weight not found
          if (!weight && productName) {
            const weightMatch = productName.match(/(\d+(?:\.\d+)?\s*(?:kg|g|ml|l|gm|gram|liter|litre))/i);
            if (weightMatch) {
              weight = weightMatch[1];
            }
          }

          // Extract brand from data attributes
          let brand = "";
          const gtmElement = card.querySelector(".gtmEvents");
          if (gtmElement) {
            brand = gtmElement.getAttribute("data-manu") || "";
          }

          // Check if product is in stock (assuming in stock if no out of stock indicator)
          const inStock = !card.textContent.toLowerCase().includes("out of stock");
          // Validate required fields
          if (!productId || !productName || !price || price <= 0) {
            return;
          }

          extractedProducts.push({
            productId,
            productName,
            url: fullUrl,
            imageUrl,
            price,
            mrp,
            discount,
            weight,
            brand,
            inStock,
          });
        } catch (error) {
          console.error("JIO: Error extracting product data:", error);
        }
      });

      return extractedProducts;
    });

    console.log(`JIO: Successfully extracted ${products.length} products from page ${url}`);
    return { products };
  } catch (error) {
    console.error("JIO: Error extracting products from page:", error);
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
        console.log("JIO: Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      const startTime = new Date();
      console.log("JIO: Starting product search at:", startTime.toLocaleString());

      // Setup the context for the location
      const context = await setLocation(location);

      const categories = await fetchJiomartCategories(context);

      const filteredCategories = await filterCategories(categories);
      // Check if the location is serviceable
      if (!contextManager.isWebsiteServiceable(location, "jiomart-grocery")) {
        console.log(`JIO: Location ${location} is not serviceable, stopping crawler`);
        break;
      }

      // Process queries in parallel batches
      const PARALLEL_SEARCHES = 3;
      let totalProcessedProducts = 0;

      for (let i = 0; i < filteredCategories.length; i += PARALLEL_SEARCHES) {
        const currentBatch = filteredCategories.slice(i, i + PARALLEL_SEARCHES);
        console.log(
          `JIO: Processing categories ${i + 1} to ${i + currentBatch.length} of ${filteredCategories.length}`
        );

        const batchPromises = currentBatch.map(async (category) => {
          try {
            let page = null;

            try {
              page = await context.newPage();

              // Extract products using the new function
              const { products } = await extractProductsFromPage(page, category.url);

              if (products.length > 0) {
                // Add category information to products
                const enrichedProducts = products.map((product) => ({
                  ...product,
                  categoryName: category.category,
                  subcategoryName: category.subCategory,
                }));

                // Process and store products
                const processedCount = await globalProcessProducts(enrichedProducts, category.category, {
                  model: JiomartProduct,
                  source: "JioMart",
                  significantDiscountThreshold: 10,
                  telegramNotification: true,
                  emailNotification: false,
                });

                totalProcessedProducts += processedCount;
                console.log(`JIO: Processed ${processedCount} products for ${category.name} (${category.subCategory})`);
              } else {
                console.log(`JIO: No products found for ${category.name}`);
              }
            } catch (error) {
              console.error(`JIO: Error processing category ${category.name}:`, error);
            } finally {
              if (page) await page.close();
            }
          } catch (error) {
            console.error(`JIO: Error processing category ${category.name}:`, error);
          }
        });

        await Promise.all(batchPromises);
        console.log(
          `JIO: Categories Processed: ${i + currentBatch.length} of ${filteredCategories.length} and Time taken: ${(
            (new Date().getTime() - startTime.getTime()) /
            60000
          ).toFixed(2)} minutes`
        );
      }

      console.log(`JIO: Total processed products: ${totalProcessedProducts}`);
      console.log(
        `JIO: Total time taken: ${((new Date().getTime() - startTime.getTime()) / 60000).toFixed(2)} minutes`
      );
    } catch (error) {
      // Wait for 5 minutes
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      console.error("JIO: Error in crawler:", error);
    }
  }
};

// Search endpoint handler for Jiomart
export const searchProducts = async (req, res, next) => {
  let page = null;
  try {
    const { query, location } = req.body;

    if (!query || !location) {
      throw AppError.badRequest("Query and location are required");
    }

    console.log(`JIO: Starting search for "${query}" in location ${location}`);

    // Get or create context for the location
    const context = await setLocation(location);

    // Check if the location is serviceable
    if (!contextManager.isWebsiteServiceable(location, "jiomart-grocery")) {
      throw AppError.badRequest(`Location ${location} is not serviceable by JioMart`);
    }

    // Create a new page for search
    page = await context.newPage();

    // Navigate to search page
    const searchUrl = `https://www.jiomart.com/search?q=${encodeURIComponent(query)}`;
    console.log(`JIO: Navigating to search URL: ${searchUrl}`);

    // Extract products from the page using existing function
    const { products } = await extractProductsFromPage(page, searchUrl, 5);

    console.log(`JIO: Found ${products.length} products for query "${query}"`);

    res.status(200).json({
      success: true,
      products: products,
      total: products.length,
      query: query,
      location: location,
    });
  } catch (error) {
    console.error("JIO: Search error:", error);
    next(
      error instanceof AppError ? error : AppError.internalError(`Failed to search JioMart products: ${error.message}`)
    );
  } finally {
    if (page) {
      await page.close();
    }
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
      console.error("JIO: Error in search handler:", error);
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};
