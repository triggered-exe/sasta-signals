// Watch the video https://youtu.be/WP-S1QolVvU which is recorded for the future reference
import axios from 'axios';
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
    // Get or create context
    const context = await contextManager.getContext(location);

    // Return existing context if already set up and serviceable
    if (contextManager.getWebsiteServiceabilityStatus(location, "jiomart-grocery")) {
      logger.info(`JIO: Using existing serviceable context for ${location}`);
      return context;
    }

    // Set up JioMart for this context
    page = await context.newPage();

    // Navigate to JioMart
    logger.info("JIO: Navigating to JioMart...");
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
      await page.fill('#rel_pincode', location);
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


    // Check whether the location is set correctly by checking the cookie

    const cookies = await page.context().cookies();
    const pincodeCookie = cookies.find(cookie => cookie.name === 'nms_mgo_pincode');

    if (!pincodeCookie || pincodeCookie.value !== location) {
      throw new AppError.badRequest(`Failed to set location to ${location}. Pincode cookie is not set correctly.`);
    }

    // Location is serviceable - mark it as such
    contextManager.markServiceability(location, "jiomart-grocery", true);
    logger.info(`JIO: Successfully set up for location: ${location}`);
    logger.debug(`JIO: Closing setup page for ${location}`);
    await page.close();
    return context;
  } catch (error) {
    // Mark location as not serviceable for any initialization errors too
    try {
      if (page) await page.close();
    } catch (cleanupError) {
      // Don't let cleanup errors override the original error
      logger.error(`JIO: Error during cleanup for ${location}:`, cleanupError);
    }

    logger.error(`JIO: Error initializing context for ${location}:`, error);
    throw error;
  }
};

const fetchJiomartCategories = async (context) => {
  logger.info("JIO: Fetching categories...");
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
    logger.error("JIO: Error fetching categories:", error);
    throw error;
  } finally {
    if (page) {
      logger.debug("JIO: Closing categories fetch page");
      await page.close();
    }
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

const extractProductsFromPageLegacy = async (page, url, MAX_SCROLL_ATTEMPTS = 25) => {
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
        logger.debug(`JIO: No new products loaded (attempt ${noNewProductsAttempts}/${MAX_NO_NEW_PRODUCTS_ATTEMPTS})`);
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

    logger.info(`JIO: Successfully extracted ${products.length} products from page ${url}`);
    return { products };
  } catch (error) {
    logger.error("JIO: Error extracting products from page:", error);
    return { products: [] };
  }
};

// The below functioanlity work for desktop view of browser not mobile or ipad view and can run only one category at a time
// Helper: try to extract a numeric category id from jiomart category URLs
const extractCategoryIdAndNameFromUrl = (url) => {
  try {
    if (!url) return null;
    const u = new URL(url, 'https://www.jiomart.com');
    const parts = u.pathname.split('/').filter(Boolean);
    // Find last numeric segment
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (/^\d+$/.test(p)) {
        return { categoryId: p, categoryName: parts[i - 1] || null };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
};

// Build the trex/search request body for a category and optional pageToken
// Accepts regionCode and storeCode so the filter can be built dynamically from cookies
// Generate a UUIDv4 (used for visitorId)
const generateUuidV4 = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const buildTrexBody = ({ categoryId, pageSize = 50, pageToken = null, visitorId = null, regionCode = 'TS34', storeCode = 'TL8Q' }) => {
  const filter = `attributes.status:ANY("active") AND attributes.category_ids:ANY("${categoryId}") AND (attributes.available_regions:ANY("${regionCode}", "PANINDIAGROCERIES")) AND (attributes.inv_stores_1p:ANY("ALL", "${storeCode}") OR attributes.inv_stores_3p:ANY("ALL", "groceries_zone_non-essential_services", "general_zone", "groceries_zone_essential_services"))`;

  const body = {
    pageSize,
    variantRollupKeys: ["variantId"],
    branch: "projects/sr-project-jiomart-jfront-prod/locations/global/catalogs/default_catalog/branches/0",
    pageCategories: [String(categoryId)],
    userInfo: { userId: null },
    orderBy: "attributes.popularity desc",
    filter,
    visitorId: visitorId || `anonymous-${generateUuidV4()}`,
  };

  if (pageToken) {
    body.pageToken = pageToken;
  }

  return body;
};

// Low-level trex search POST using Playwright request (uses context cookies)
const trexSearchRequest = async (cookieHeader, body) => {
  const url = 'https://www.jiomart.com/trex/search';

  const headers = {
    accept: '*/*',
    'content-type': 'application/json',
    origin: 'https://www.jiomart.com',
    referer: 'https://www.jiomart.com/',
    cookie: cookieHeader,
  };

  // Log the actual curl command for debugging
  const curlCommand = `curl -X POST '${url}' -H 'accept: */*' -H 'content-type: application/json' -H 'origin: https://www.jiomart.com' -H 'referer: https://www.jiomart.com/' -H 'cookie: ${cookieHeader.replace(/'/g, "\\'")}' -d '${JSON.stringify(body).replace(/'/g, "\\'")}'`;
  // logger.debug('JIO: Actual curl command:', curlCommand);

  try {
    const response = await axios.post(url, body, {
      headers,
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`trex search failed: ${error.response.status} ${error.response.statusText}`);
    } else {
      throw new Error(`trex search failed: ${error.message}`);
    }
  }
};

// Fetch up to maxPages pages of products for a category using trex/search pagination
const fetchTrexProducts = async (page, categoryId, categoryName, maxPages = 10, pageSize = 50) => {
  const allProducts = [];
  let pageToken = null;
  let pageCount = 0;

  // Read store/region info from page localStorage (primary), fall back to cookie (secondary)
  let regionCode = null;
  let storeCode = null;
  try {
    // Try localStorage first (nms_delivery_store_info stored as JSON string)
    let rawValue = null;
    try {
      rawValue = await page.evaluate(() => localStorage.getItem('nms_delivery_store_info'));
    } catch (err) {
      // If page.evaluate fails (no page), continue to cookie fallback
      rawValue = null;
    }

    let parsed = null;
    if (rawValue) {
      try {
        parsed = JSON.parse(rawValue);
      } catch (err) {
        // try decodeURIComponent then parse
        try {
          parsed = JSON.parse(decodeURIComponent(rawValue));
        } catch (err2) {
          parsed = null;
        }
      }
    }

    if (parsed && typeof parsed === 'object') {
      if (parsed.region_code) regionCode = parsed.region_code;
      if (parsed.store_code) storeCode = parsed.store_code;
    }

    if (!regionCode || !storeCode) {
      throw AppError.badRequest('nms_delivery_store_info not found in localStorage or cookies, or missing region_code/store_code');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.badRequest(`Error reading nms_delivery_store_info: ${err.message}`);
  }

  do {
    pageCount++;
    const body = buildTrexBody({ categoryId, pageSize, pageToken, regionCode, storeCode });
    // Build cookie header using document.cookie
    let cookieHeader = await page.evaluate(() => document.cookie || '');

    let json = null;
    try {
      json = await trexSearchRequest(cookieHeader, body);
    } catch (err) {
      logger.error('JIO: trex/search request failed:', err.message);
      break;
    }

    // Find the first array-of-objects in the response that looks like products
    let products = json?.results || [];

    // Helper to parse numeric prices
    const parsePrice = (v) => {
      if (v === undefined || v === null) return 0;
      const s = String(v).replace(/,/g, '');
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    };

    // Helper: parse a buybox entry string into fields
    // Expected format (observed): "3201|1|Reliance Retail||27.0|19.0||8.0|29.0||6|"
    // We treat parts[4] as mrp and parts[5] as price. parts[0] is a region/store identifier.
    const parseBuyboxEntry = (entry) => {
      try {
        const parts = entry.split('|');
        const identifier = parts[0] || '';
        const maybeMrp = parts[4] ? parseFloat(parts[4]) : NaN;
        const maybePrice = parts[5] ? parseFloat(parts[5]) : NaN;
        return {
          identifier: String(identifier),
          mrp: Number.isFinite(maybeMrp) ? maybeMrp : 0,
          price: Number.isFinite(maybePrice) ? maybePrice : 0,
          rawParts: parts,
        };
      } catch (e) {
        return { identifier: '', mrp: 0, price: 0, rawParts: [] };
      }
    };

    // Helper: choose buybox entry matching preferred codes (region/store/area). Fallback to first element
    const chooseBuyboxFor = (buyboxArray, regionCode = null) => {
      if (!Array.isArray(buyboxArray) || buyboxArray.length === 0) return null;
      // parse all entries
      const parsed = buyboxArray.map((e) => ({ raw: e, ...parseBuyboxEntry(e) }));
      if (!regionCode) return parsed[0];
      // match exact identifier
      const found = parsed.find((p) => p.identifier === String(regionCode));
      if (found) return found;

      // fallback to first parsed that has a positive price
      const firstValid = parsed.find((p) => p.price > 0 && p.mrp > 0) || parsed[0];
      return firstValid;
    };

    for (const p of products) {
      try {
        // New product shape: { id, product: { title, variants: [...] } }
        if (p.product && Array.isArray(p.product.variants) && p.product.variants.length > 0) {
          const parentTitle = p.product.title || '';
          for (const variant of p.product.variants) {
            try {
              const productId = variant.id || variant.name || variant.uri || null;
              const productName = variant.title || parentTitle || '';

              // price/mrp: prefer avg_selling_price.numbers, fallback to buybox_mrp text parsing
              let price = 0;
              let mrp = 0;
              if (variant.attributes) {
                if (variant.attributes.avg_selling_price && Array.isArray(variant.attributes.avg_selling_price.numbers)) {
                  price = parsePrice(variant.attributes.avg_selling_price.numbers[0]);
                }

                // buybox_mrp entries like: "3201|1|Reliance Retail||27.0|19.0||8.0|29.0||6|"
                if ((!price || !mrp) && variant.attributes.buybox_mrp && Array.isArray(variant.attributes.buybox_mrp.text) && variant.attributes.buybox_mrp.text.length > 0) {
                  const chosen = chooseBuyboxFor(variant.attributes.buybox_mrp.text, regionCode);
                  if (chosen) {
                    if (chosen.price && chosen.price > 0) price = chosen.price;
                    if (chosen.mrp && chosen.mrp > 0) mrp = chosen.mrp;
                  }
                }
              }

              const fullUrl = variant.uri || (variant.url_path ? `https://www.jiomart.com${variant.url_path}` : '');
              const imageUrl = (variant.images && variant.images[0] && variant.images[0].uri) ? variant.images[0].uri : '';
              const weight = (variant.sizes && variant.sizes[0]) || '';
              const brand = (variant.brands && variant.brands[0]) || '';

              if (!productId || !productName || !price || price <= 0) continue;

              const discount = mrp > price ? Number((((mrp - price) / mrp) * 100).toFixed(2)) : 0;

              allProducts.push({
                productId: String(productId),
                productName,
                url: fullUrl,
                imageUrl,
                price,
                mrp: mrp || price,
                discount,
                weight,
                brand,
                inStock: true,
              });
            } catch (innerErr) {
              logger.error('JIO: Error mapping variant from trex product shape:', innerErr.message);
            }
          }
          continue; // processed variants, skip to next candidate
        }
      } catch (err) {
        logger.error('JIO: Error mapping product from trex response:', err.message);
      }
    }

    // Determine next page token (common keys)
    pageToken = json.nextPageToken || null;

    // Defensive: stop if no more results or we've reached maxPages
    if ((!products || products.length === 0) || pageCount >= maxPages) break;

    // small delay to be polite
    await page.waitForTimeout(300);

  } while (pageToken);

  // Filter the duplicate products based on productId
  const seenProductIds = new Set();
  const uniqueProducts = [];
  allProducts.forEach((product) => {
    if (!seenProductIds.has(product.productId)) {
      seenProductIds.add(product.productId);
      uniqueProducts.push(product);
    }
  });

  logger.info(`JIO: trex fetched ${uniqueProducts.length} products for category ${categoryName} in ${Math.min(pageCount, maxPages)} pages`);
  return { products: uniqueProducts };
};

// Main extraction function: prefer trex/search for category pages, fallback to legacy DOM scraping
const extractProductsFromPage = async (page, url, MAX_LOAD_MORE_ATTEMPTS = 15) => {
  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 10000, // 10 second timeout
    });

    // If its a normal search instaead of category page, use legacy method
    if (url.includes('/search')) {
      logger.info('JIO: Detected search URL, using legacy DOM extraction method');
      return await extractProductsFromPageLegacy(page, url, MAX_LOAD_MORE_ATTEMPTS);
    }

    // Try to extract a category id from the URL - if present, use trex/search
    const { categoryId, categoryName } = extractCategoryIdAndNameFromUrl(url);
    if (categoryId) {
      try {
        logger.info(`JIO: Using trex/search for category ${categoryId} (url: ${url})`);
        return await fetchTrexProducts(page, categoryId, categoryName, 10, 50);
      } catch (err) {
        logger.warn('JIO: trex/search failed, falling back to DOM method:', err.message);
      }
    }

    // Fallback: use legacy DOM based extraction
    return await extractProductsFromPageLegacy(page, url, MAX_LOAD_MORE_ATTEMPTS);
  } catch (error) {
    logger.error('JIO: Error extracting products from page:', error);
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
      logger.info("JIO: Starting product search at:", startTime.toLocaleString());

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

                logger.info(`JIO: Processed ${processedCount} products for ${category.name} (${category.subCategory})`);
              } else {
                logger.debug(`JIO: No products found for ${category.name}`);
              }
            } catch (error) {
              logger.error(`JIO: Error processing category ${category.name}:`, error);
            } finally {
              if (page) {
                logger.debug(`JIO: Closing product extraction page for ${category.name}`);
                await page.close();
              }
              // Small delay between requests to be polite
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          } catch (error) {
            logger.error(`JIO: Error processing category ${category.name}:`, error);
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
      logger.error("JIO: Error in crawler:", error);
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
    const page = await context.newPage();

    try {
      // Navigate to search page
      const searchUrl = `https://www.jiomart.com/search?q=${encodeURIComponent(query)}`;
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
    logger.error('JIO: Search error:', error.message);
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
      logger.error("JIO: Error in search handler:", error);
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};