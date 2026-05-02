import logger from "../utils/logger.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import { BigBasketProduct } from "../models/BigBasketProduct.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";
import { AppError } from "../utils/errorHandling.js";

// Set location for pincode using web scraping (similar to Amazon controller)
// IMPORTANT: when we enter the pincode the entered value is not visible neither the suggestions are visible
//  But are accessible via javascript
const setLocation = async (pincode) => {
  let page = null;
  try {
    // Get or create context
    const context = await contextManager.getContext(pincode);

    // If BigBasket is already set up for this pincode, return the context
    if (contextManager.getWebsiteServiceabilityStatus(pincode, "bigbasket")) {
      logger.info(`BB: Using existing serviceable context for ${pincode}`);
      return context;
    }

    // Set up BigBasket for this context
    page = await contextManager.createPage(context, 'bigbasket');

    // Navigate to BigBasket
    await page.goto("https://www.bigbasket.com/", { waitUntil: "domcontentloaded" });

    // Wait for the page to be fully loaded
    await page.waitForTimeout(5000);

    // Look for location selector - this will need to be updated with correct selectors
    logger.info("BB: Setting location...");

    // Sometimes the Bigbasket block the ip, check if Access Denied is present on the webpage
    const accessDenied = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 && h1.textContent.includes('Access Denied');
    });
    if (accessDenied) {
      logger.info("BB: Access denied - IP appears to be blocked by BigBasket");
      logger.info(`BB: User-Agent used: ${await page.evaluate(() => navigator.userAgent)}`);
      throw AppError.badRequest("BB: Access denied - IP appears to be blocked by BigBasket");
    }

    // Try to find and click location selector
    try {
      // Click location button
      const buttonClicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"]'))
          .find(b => b.textContent?.toLowerCase().includes('delivery in 10 mins') &&
            b.textContent?.toLowerCase().includes('select location'));
        if (btn) btn.click();
        return !!btn;
      });

      if (buttonClicked) {
        logger.info("BB: Clicked location selector with JavaScript");
      } else {
        throw new Error("BB: Could not click location selector with JavaScript");
      }

      // Fill the pincode using the correct selector from HTML structure
      const pincodeInput = await page.waitForSelector('input[placeholder="Search for area or street name"]', {
        timeout: 4000,
      });
      if (pincodeInput) {
        logger.info("BB: Pincode input field found");

        await pincodeInput.fill(pincode);

        // Wait for suggestions to appear
        await page.waitForTimeout(3000);

        // Wait for any suggestion list item to become visible.
        // Avoid relying on generated styled-component class names (sc-*) which change on every deploy.
        const firstSuggestion = await page.waitForFunction(() => {
          // Prefer a role-based selector; fall back to any visible <li> near the search input
          const byRole = document.querySelector('[role="listbox"] [role="option"], [role="option"]');
          if (byRole && byRole.offsetParent !== null) return byRole;

          const input = document.querySelector('input[placeholder*="Search for area"]');
          if (!input) return null;
          let parent = input.parentElement;
          for (let i = 0; i < 8; i++) {
            const li = parent?.querySelector('ul li');
            if (li && li.offsetParent !== null && li.textContent.trim().length > 0) return li;
            parent = parent?.parentElement;
          }
          return null;
        }, { timeout: 8000 }).catch(() => null);

        if (firstSuggestion) {
          await page.evaluate(() => {
            // Same multi-strategy click logic
            const byRole = document.querySelector('[role="listbox"] [role="option"], [role="option"]');
            if (byRole) { byRole.click(); return; }

            const input = document.querySelector('input[placeholder*="Search for area"]');
            let parent = input?.parentElement;
            for (let i = 0; i < 8; i++) {
              const li = parent?.querySelector('ul li');
              if (li && li.offsetParent !== null) { li.click(); return; }
              parent = parent?.parentElement;
            }
          });
          logger.info("BB: Selected first location suggestion");

          await new Promise(resolve => setTimeout(resolve, 5000));

          // If the location is set successfully, then the span tag with text "select location should be removed"
          // Check if the "Select Location" button is still present after selecting the suggestion
          const selectLocationButton = await page.evaluate(() => {
            const result = document.evaluate("//button[.//span[contains(text(), 'Select Location')]]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return !!result.singleNodeValue;
          });
          if (selectLocationButton) {
            logger.error("BB: Location not set successfully or not serviceable");
            throw AppError.badRequest(`BB: Location not set successfully or not serviceable for pincode: ${pincode}`);
          }
        } else {
          // No suggestions found — address is not serviceable or the UI changed again
          throw AppError.badRequest(`BB: No location suggestions found for pincode: ${pincode}`);
        }
      } else {
        throw new Error("BB: Pincode input field not found");
      }
    } catch (error) {
      logger.error(`BB: Error setting location: ${error.message || error}`, { error });
      contextManager.markServiceability(pincode, "bigbasket", false);
      throw AppError.badRequest(`BB: Could not set location for pincode: ${pincode}`);
    }

    // Mark as serviceable and register the website
    contextManager.markServiceability(pincode, "bigbasket", true);
    logger.info(`BB: Successfully set up for pincode: ${pincode}`);

    await page.close();
    return context;
  } catch (error) {
    if (page) await page.close();
    contextManager.markServiceability(pincode, "bigbasket", false);
    logger.error(`BB: Error setting pincode ${pincode}: ${error.message || error}`, { error });
    throw error;
  }
};

// Core search function that can be used by unified search
export const search = async (location, query) => {
  try {
    // Set up location context (pincode)
    const context = await setLocation(location);

    // Create a new page for search
    const page = await contextManager.createPage(context, 'bigbasket');

    try {
      // Search and extract products
      const allProducts = await extractProductsFromPage(page, null, query, 3);

      // Sort by price
      allProducts.sort((a, b) => a.price - b.price);

      return {
        success: true,
        products: allProducts || [],
        total: allProducts?.length || 0,
      };
    } finally {
      await page.close();
    }
  } catch (error) {
    logger.error(`BB: Search error: ${error.message || error}`, { error });
    throw error;
  }
};

const parseRawProducts = (rawProducts) => {
  const results = [];
  for (const p of rawProducts) {
    const parseNum = (val) => {
      if (!val) return 0;
      const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const price = parseNum(p?.pricing?.discount?.prim_price?.sp || p?.pricing?.discount?.prim_price?.base_price || p?.pricing?.subscription_price);
    const mrp = parseNum(p?.pricing?.discount?.mrp) || price;
    const product = {
      id: p?.id?.toString() || p?.requested_sku_id?.toString() || "",
      name: (p?.desc || "").toString().trim(),
      brand: p?.brand?.name || "",
      weight: p?.w || p?.unit || p?.pack_desc || "",
      price,
      mrp,
      discount: mrp > 0 && price > 0 ? parseFloat((((mrp - price) / mrp) * 100).toFixed(2)) : 0,
      image: (p?.images?.[0] && (p.images[0].m || p.images[0].l || p.images[0].s)) || "",
      url: p?.absolute_url ? `https://www.bigbasket.com${p.absolute_url}` : "",
      inStock: !!(p?.availability?.avail_status === "001" && !p?.availability?.not_for_sale),
    };
    if (product.name && product.price > 0) results.push(product);
  }
  return results;
};

// Extract products from a page - can handle both category pages and search pages
const extractProductsFromPage = async (page, category = null, searchQuery = null, maxPagesToFetch = 25) => {
  try {
    if (category?.slug) {
      logger.info(`BB: Processing category: ${category.name}`);
      await page.goto("https://www.bigbasket.com/", { waitUntil: "domcontentloaded" });

      const allProducts = [];
      let currentPage = 1;
      let totalPages = 1;

      while (currentPage <= Math.min(totalPages, maxPagesToFetch)) {
        const apiUrl = `https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=${category.slug}&page=${currentPage}&sort=dphtl`;

        let data = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt > 0) {
            const delay = attempt * 30 * 1000; // 30s, 60s, 90s
            logger.info(`BB: 429 on page ${currentPage}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/4)`);
            await new Promise(r => setTimeout(r, delay));
          }
          data = await page.evaluate(async (url) => {
            try {
              const res = await fetch(url, {
                credentials: "include",
                headers: {
                  "accept": "*/*",
                  "x-channel": "BB-WEB",
                  "x-entry-context": "bbnow",
                  "x-entry-context-id": "10",
                  "osmos-enabled": "true",
                },
              });
              if (res.status === 429) return { rateLimited: true };
              if (!res.ok) return { error: `HTTP ${res.status}` };
              const text = await res.text();
              if (!text) return { error: "Empty response" };
              return JSON.parse(text);
            } catch (e) { return { error: String(e) }; }
          }, apiUrl);
          if (!data.rateLimited) break;
        }

        if (data.rateLimited) { logger.error(`BB: Rate limited on page ${currentPage} after retries, stopping category`); break; }
        if (data.error) { logger.error(`BB: API error page ${currentPage}: ${data.error}`); break; }

        const productInfo = data.tabs?.[0]?.product_info;
        if (!productInfo?.products?.length) break;

        totalPages = productInfo.number_of_pages || 1;
        allProducts.push(...parseRawProducts(productInfo.products));
        logger.info(`BB: Page ${currentPage}/${totalPages}: ${productInfo.products.length} products`);
        currentPage++;
        await new Promise(r => setTimeout(r, 1000));
      }

      logger.info(`BB: Extracted ${allProducts.length} products from category ${category.name}`);
      return allProducts;
    }

    if (searchQuery) {
      logger.info(`BB: Processing search query: ${searchQuery}`);
      const baseUrl = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(searchQuery)}`;
      await page.goto(`${baseUrl}&page=1`, { waitUntil: "domcontentloaded" });
      await new Promise(r => setTimeout(r, 3000));

      const accessDenied = await page.evaluate(() => document.querySelector('h1')?.textContent.includes('Access Denied'));
      if (accessDenied) throw AppError.badRequest("BB: Access denied - IP appears to be blocked by BigBasket");

      const allProducts = [];
      let currentPage = 1;

      while (currentPage <= maxPagesToFetch) {
        const result = await page.evaluate(async (url) => {
          try {
            const res = await fetch(url, { credentials: "include" });
            if (!res.ok) return { error: `HTTP ${res.status}` };
            const html = await res.text();
            const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
            if (!match) return { products: [] };
            const raw = JSON.parse(match[1])?.props?.pageProps?.SSRData?.tabs?.[0]?.product_info?.products;
            return { products: raw || [] };
          } catch (e) { return { error: String(e) }; }
        }, `${baseUrl}&page=${currentPage}`);

        if (result.error) { logger.error(`BB: Search page ${currentPage} error: ${result.error}`); break; }
        if (!result.products.length) break;

        allProducts.push(...parseRawProducts(result.products));
        currentPage++;
        await new Promise(r => setTimeout(r, 500));
      }

      logger.info(`BB: Extracted ${allProducts.length} products from search`);
      return allProducts;
    }

    throw new Error("BB: No category or search query provided");
  } catch (error) {
    const ctx = category ? `category ${category.name}` : "search";
    logger.error(`BB: Error fetching products for ${ctx}: ${error.message || error}`, { error });
    await new Promise(r => setTimeout(r, 60 * 1000));
    return [];
  }
};

let isBigBasketCrawlerRunning = false;
export const startTrackingHandler = async (location) => {
  if (isBigBasketCrawlerRunning) {
    throw AppError.badRequest("BigBasket crawler is already running");
  }
  isBigBasketCrawlerRunning = true;
  while (true) {
    try {
      // Skip if it's night time (12 AM to 6 AM IST)
      if (isNightTimeIST()) {
        logger.info("BB: Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      const startTime = new Date();
      logger.info(`BB: Starting product search at: ${startTime.toLocaleString()}`);

      // Setup the context for the location
      const context = await setLocation(location);

      // Check if the location is serviceable
      if (!contextManager.getWebsiteServiceabilityStatus(location, "bigbasket")) {
        logger.info(`BB: Location ${location} is not serviceable, stopping crawler`);
        break;
      }

      const categories = await fetchCategories(location); // Contains all the final categories in flattened format
      if (!categories || categories.length === 0) {
        logger.info("BB: No categories found");
        continue;
      }

      // Randomize the order of categories
      categories.sort(() => Math.random() - 0.5);

      // Process categories in parallel batches
      const PARALLEL_SEARCHES = 1;
      let totalProcessedProducts = 0;

      for (let i = 0; i < categories.length; i += PARALLEL_SEARCHES) {
        const currentBatch = categories.slice(i, i + PARALLEL_SEARCHES);
        logger.info(`BB: Processing categories ${i + 1} to ${i + currentBatch.length} of ${categories.length}`);

        const batchPromises = currentBatch.map(async (category) => {
          try {
            let page = null;

            try {
              page = await contextManager.createPage(context, 'bigbasket');

              const products = await extractProductsFromPage(page, category, null, 25);

              if (products.length > 0) {
                const transformedProducts = products.map((product) => ({
                  productId: product.id,
                  productName: product.name,
                  categoryName: category.name,
                  categoryId: category.id,
                  subcategoryName: category.name,
                  subcategoryId: category.id,
                  inStock: product.inStock,
                  imageUrl: product.image,
                  mrp: product.mrp,
                  price: product.price,
                  discount: product.discount,
                  weight: product.weight,
                  brand: product.brand,
                  url: product.url,
                }));

                // Process and store products using globalProcessProducts
                const processedCount = await globalProcessProducts(transformedProducts, category.name, {
                  model: BigBasketProduct,
                  source: "BigBasket",
                  significantDiscountThreshold: 10,
                  telegramNotification: true,
                  emailNotification: false,
                });

                totalProcessedProducts += processedCount;
                logger.info(`BB: Processed ${processedCount} products for ${category.name}`);
              } else {
                logger.info(`BB: No products found for ${category.name}`);
              }
            } catch (error) {
              // If we get an error specific to access denied, re-throw it to stop the crawler
              if (error.message && error.message.includes("Access denied")) {
                throw error;
              }
              logger.error(`BB: Error processing category ${category.name}: ${error.message || error}`, { error });
            } finally {
              if (page) await page.close();
            }
          } catch (error) {
            logger.error(`BB: Error processing category ${category.name}: ${error.message || error}`, { error });
          }
        });

        await Promise.all(batchPromises);
        logger.info(
          `BB: Categories Processed: ${i + currentBatch.length} of ${categories.length} and Time taken: ${(
            (new Date().getTime() - startTime.getTime()) /
            60000
          ).toFixed(2)} minutes`
        );
      }

      logger.info(`BB: Total processed products: ${totalProcessedProducts}`);
      logger.info(`BB: Total time taken: ${((new Date().getTime() - startTime.getTime()) / 60000).toFixed(2)} minutes`);
    } catch (error) {
      // Wait for 5 minutes
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      logger.error(`BB: Error in crawler: ${error.message || error}`, { error });
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
      logger.error(`BB: Error in search handler: ${error.message || error}`, { error });
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};

export const fetchCategories = async (location) => {
  let page = null;
  try {
    const context = await contextManager.getContext(location);
    page = await contextManager.createPage(context, 'bigbasket');
    await page.goto("https://www.bigbasket.com/", { waitUntil: "domcontentloaded", timeout: 30000 });

    const categories = await page.evaluate(async () => {
      try {
        const res = await fetch("https://www.bigbasket.com/ui-svc/v1/category-tree?x-channel=BB-PWA", { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text) throw new Error("Empty response");
        const data = JSON.parse(text);

        const results = [];
        const walk = (cats) => {
          if (!Array.isArray(cats)) return;
          for (const cat of cats) {
            if (cat.level === 0) results.push({ id: cat.id, name: cat.name, slug: cat.url.replace(/^\/?(cl\/)?|\/$/g, "") });
            if (cat.children) walk(cat.children);
          }
        };
        walk(data.categories);
        return results;
      } catch (e) { throw new Error(String(e)); }
    });

    logger.info(`BB: Fetched ${categories.length} categories`);
    return categories;
  } catch (error) {
    logger.error(`Error fetching categories: ${error.message || error}`, { error });
    throw AppError.internalError("Failed to fetch categories");
  } finally {
    if (page) await page.close();
  }
};