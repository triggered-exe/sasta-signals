import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandling.js";
import { FlipkartGroceryProduct } from "../models/FlipkartGroceryProduct.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";

// One attempt at choosing the delivery location on a fresh page. Throws if any step fails.
const selectLocationOnPage = async (page, pincode) => {
  // Navigate to Flipkart
  logger.info("FK: Navigating to Flipkart...");
  await page.goto("https://www.flipkart.com", {
    waitUntil: "domcontentloaded",
    timeout: 30000, // 30 second timeout
  });

  await page.waitForTimeout(4000); // Increased timeout

  // Set location
  logger.info(`FK: Setting location for ${pincode}...`);

  // Close login modal — Escape first, then look for any close button
  await page.keyboard.press('Escape').catch(() => { });
  await page.waitForTimeout(400);
  // .b3wTlE is a generated class that changes per deploy, so also try generic modal/close selectors
  const loginModalClose = await page.$(
    '.b3wTlE, button[class*="CloseIcon"], button[class*="close-btn"], [data-testid*="close"]'
  ).catch(() => null);
  if (loginModalClose && await loginModalClose.isVisible().catch(() => false)) {
    await loginModalClose.click().catch(() => { });
    await page.waitForTimeout(400);
    logger.info("FK: Closed login modal");
  }

  // Click "Select delivery location" — try text/xpath variants
  const deliveryLocSelectors = [
    'xpath=//div[text()="Select delivery location"]',
    'xpath=//span[text()="Select delivery location"]',
    'text=Select delivery location',
  ];
  let locationOpened = false;
  for (const sel of deliveryLocSelectors) {
    try {
      await page.click(sel, { timeout: 5000 });
      locationOpened = true;
      break;
    } catch (_) { }
  }
  if (!locationOpened) {
    logger.warn("FK: Could not click 'Select delivery location', proceeding anyway...");
  }

  await page.waitForTimeout(1500);

  // Find and focus the pincode input — try multiple placeholder patterns
  const inputSelectors = [
    'input[placeholder*="Search by area, street name, pin code"]',
    'input[placeholder*="Search by area"]',
    'input[placeholder*="pin code"]',
    'input[placeholder*="pincode"]',
    'input[placeholder*="Enter pincode"]',
  ];
  // Wait for any of them at once: the modal can take over 5s to open, and waiting on each pattern
  // in turn would give up on the first (matching) one before it appears
  const focusedInput = await page.waitForSelector(inputSelectors.join(", "), { timeout: 15000, state: 'visible' }).catch(() => null);
  if (focusedInput) {
    await focusedInput.focus();
    logger.info(`FK: Found location input with placeholder: ${await focusedInput.getAttribute("placeholder")}`);
  } else {
    const visibleInputs = await page.$$eval("input", (inputs) =>
      inputs.filter((input) => input.offsetParent !== null).map((input) => input.placeholder || input.name || input.type)
    ).catch(() => []);
    throw new Error(`FK: Could not find the location search input field (url: ${page.url()}, visible inputs: ${JSON.stringify(visibleInputs)})`);
  }

  await page.keyboard.type(pincode);

  // Click the suggestion row that matches what was typed.
  // Works for both exact pincodes (e.g. 500064) and free-text places.
  const searchTerm = pincode.trim();
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Target only suggestion rows (they contain location icon svg width=16 + text),
  // avoiding modal/input close buttons that are also cursor:pointer.
  const suggestionRows = page.locator('div[style*="cursor: pointer;"]').filter({
    has: page.locator('svg[width="16"]'),
    has: page.locator('div[dir="auto"]'),
  });
  const matchedSuggestion = suggestionRows.filter({
    hasText: new RegExp(escapeRegex(searchTerm), "i"),
  }).first();

  // Suggestions for a partially typed term can show first, so wait for a matching row specifically
  try {
    await matchedSuggestion.waitFor({ state: "visible", timeout: 10000 });
  } catch (err) {
    const shownSuggestions = await suggestionRows.allInnerTexts().catch(() => []);
    throw new Error(`FK: No location suggestion matching "${searchTerm}" (shown: ${JSON.stringify(shownSuggestions.slice(0, 3))})`);
  }
  await matchedSuggestion.click({ force: true });
  logger.info(`FK: Clicked matching location suggestion for "${searchTerm}"`);

  await page.waitForTimeout(3000); // Wait for the map page to load

  // After clicking suggestion, a "Confirm" button/div appears
  // FK renders this as a styled div, not an input[type=submit]
  // Try input[type=submit] (old web) first, then styled-div variants (new web)
  const confirmLocator = page.locator(
    'input[type="submit"][value="Confirm"], button:has-text("Confirm"), div[style*="cursor: pointer;"]:has-text("Confirm")'
  ).first();
  try {
    await confirmLocator.waitFor({ state: "visible", timeout: 7000 });
  } catch (err) {
    throw new Error(`FK: Confirm button not found after choosing location ${pincode}`);
  }
  await confirmLocator.click({ force: true });
  logger.info(`FK: Successfully set up for location: ${pincode}`);

  await page.waitForTimeout(2000); // Wait for location to be set
};

// Set location for Flipkart Grocery
const setLocation = async (pincode) => {
  // Get or create context
  const context = await contextManager.getContext(pincode);

  // Return existing context if already set up and serviceable
  if (contextManager.getWebsiteServiceabilityStatus(pincode, "flipkart-grocery")) {
    logger.info(`FK: Using existing serviceable context for ${pincode}`);
    return context;
  }

  // The location modal is flaky (suggestions sometimes load late or not at all), so retry on a fresh page
  const MAX_ATTEMPTS = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let page = null;
    try {
      page = await context.newPage();
      await selectLocationOnPage(page, pincode);

      // Flipkart have two platform grocery and  minutes. minutes is a new 10 min delivery platform. if the minutes is available then the flipkart-grocery is not availabe. so we need to check whether or not its available
      const isMinutesAvailable = await page.$("a[href*='/grocery-xtra-saver-at-store?marketplace=HYPERLOCAL']").catch(() => null);
      if (isMinutesAvailable) {
        logger.info(`FK: Minutes is available for ${pincode}, so classic Grocery is not. Marking as unserviceable.`);
        lastError = AppError.badRequest(`Location ${pincode} is not serviceable by Flipkart Grocery (Minutes is active)`);
        break;
      }

      // Location is serviceable - mark it as such
      contextManager.markServiceability(pincode, "flipkart-grocery", true);
      await page.close();
      return context;
    } catch (error) {
      lastError = error;
      logger.warn(`FK: Location setup attempt ${attempt}/${MAX_ATTEMPTS} for ${pincode} failed: ${error.message || error}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 3000));
    } finally {
      if (page && !page.isClosed()) await page.close().catch(() => { });
    }
  }

  // Mark as not serviceable so the next cycle starts the location flow again
  contextManager.markServiceability(pincode, "flipkart-grocery", false);
  logger.error(`FK: Error initializing context for ${pincode}: ${lastError?.message || lastError}`, { error: lastError });
  throw lastError;
};

// Function to extract products from a page
const extractProductsFromPage = async (page, url, query) => {
  try {
    // Navigate to current page
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Check if "no results found" message appears
    const noResultsFound = await page.evaluate(() => {
      // Check for the specific "Sorry, no results found!" text
      const noResultsText = document.querySelector('.BHPsUQ');
      if (noResultsText && noResultsText.textContent.includes('Sorry, no results found!')) {
        return true;
      }

      // Alternative check for the error image
      const errorImage = document.querySelector('img[src*="error-no-search-results"]');
      if (errorImage) {
        return true;
      }

      return false;
    });

    if (noResultsFound) {
      logger.info(`FK: No results found for "${query}" on current page`);
      return { products: [], nextPageUrl: null };
    }

    try {
      // Wait for products to load
      await page.waitForSelector("div[data-id]", {
        timeout: 10000,
        state: "attached",
      });
    } catch (error) {
      logger.info(`FK: No products found for "${query}" on current page`);
      return { products: [], nextPageUrl: null };
    }

    // Extract products
    const products = await page.evaluate(() => {
      const productElements = document.querySelectorAll("div[data-id]");
      return Array.from(productElements)
        .map((element) => {
          try {
            const nameElement = element.querySelector("a[title]");
            // Updated selectors based on new HTML structure
            const priceElement = element.querySelector("div.hZ3P6w.UqO8i8");
            const mrpElement = element.querySelector("div.kRYCnD");
            const imageElement = element.querySelector("img.UCc1lI");
            // Check for out of stock - look for "Currently unavailable" text in div.tSXtJx
            const unavailableElement = element.querySelector("div.tSXtJx");
            const isOutOfStock = unavailableElement && unavailableElement.textContent.toLowerCase().includes("unavailable");

            const price = priceElement ? Number(priceElement.textContent.replace(/[^0-9.]/g, "")) : 0;
            const mrp = mrpElement ? Number(mrpElement.textContent.replace(/[^0-9.]/g, "")) : price;

            // If the price is not available, don't add it to the products
            if (price === 0) {
              return null;
            }

            return {
              productId: element.getAttribute("data-id") || "",
              productName: nameElement ? nameElement.getAttribute("title") : "",
              url: nameElement ? "https://www.flipkart.com" + nameElement.getAttribute("href") : "",
              imageUrl: imageElement ? imageElement.getAttribute("src") : "",
              price: price,
              mrp: mrp,
              discount: mrp > 0 ? Math.floor(((mrp - price) / mrp) * 100) : 0,
              inStock: !isOutOfStock,
            };
          } catch (err) {
            // Note: console.error works in browser context (page.evaluate)
            console.error("FK: Error processing product:", err);
            return null;
          }
        })
        .filter((product) => product && product.productName && product.url);
    });

    // Check for next page
    const nextPageUrl = await page.evaluate(() => {
      try {
        // Look for anchor tag with class jgg0SZ containing "Next" text
        const nextButton = Array.from(document.querySelectorAll("a")).find((a) =>
          a.textContent.trim().toLowerCase() === "next"
        );
        return nextButton ? nextButton.getAttribute("href") : null;
      } catch (err) {
        console.error("FK: Error finding next page:", err);
        return null;
      }
    });

    return {
      products,
      nextPageUrl: nextPageUrl ? "https://www.flipkart.com" + nextPageUrl : null,
    };
  } catch (error) {
    logger.error(`FK: Error extracting products from page: ${error.message || error}`, { error });
    return { products: [], nextPageUrl: null };
  }
};

export const startTracking = async (_, res, next) => {
  try {
    // Start the search process in the background
    startTrackingHandler().catch((error) => {
      logger.error(`FK: Error in search handler: ${error.message || error}`, { error });
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};

let isTrackingActive = false;

export const startTrackingHandler = async (pincode = "500064") => {
  if (isTrackingActive) {
    console.log("FK: Search is already in progress");
    return;
  }
  isTrackingActive = true;

  while (true) {
    try {
      // Skip if it's night time (12 AM to 6 AM IST)
      if (isNightTimeIST()) {
        logger.info("FK : Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      const startTime = new Date();
      logger.info(`FK: Starting product search at: ${startTime.toLocaleString()}`);

      // Get all categories from Flipkart
      const categories = await extractCategories(pincode);
      logger.info(`FK: Found ${categories.length} categories to process`);

      const PARALLEL_CATEGORIES = 1; // Flipkart is fast so 1 seems sufficient
      let totalProcessedProducts = 0;

      // Set up context with location once for all categories
      const context = await setLocation(pincode);

      // Check if the location is serviceable
      if (!contextManager.getWebsiteServiceabilityStatus(pincode, "flipkart-grocery")) {
        logger.info(`FK: Location ${pincode} is not serviceable, stopping tracking`);
        break;
      }

      // Process categories in parallel batches
      for (let i = 0; i < categories.length; i += PARALLEL_CATEGORIES) {
        const currentBatch = categories.slice(i, i + PARALLEL_CATEGORIES);
        logger.info(`FK: Processing categories ${i + 1} to ${i + currentBatch.length} of ${categories.length}`);

        const batchStartTime = new Date();
        const batchPromises = currentBatch.map(async (category) => {
          const categoryStartTime = new Date();
          try {
            let page = null;

            try {
              page = await context.newPage();

              let categoryProducts = [];
              let currentUrl = category.url;
              let hasNextPage = true;
              let pageNum = 1;

              while (hasNextPage) {
                logger.info(`FK: Processing page ${pageNum} of ${category.category} > ${category.subcategory}...`);

                // Extract products using the function
                const { products: pageProducts, nextPageUrl } = await extractProductsFromPage(page, currentUrl, `${category.category} ${category.subcategory}`);

                categoryProducts = [...categoryProducts, ...pageProducts];

                if (nextPageUrl) {
                  currentUrl = nextPageUrl;
                  pageNum++;
                  await page.waitForTimeout(1000);
                } else {
                  hasNextPage = false;
                }
              }

              // Remove duplicates from category results
              const uniqueCategoryProducts = categoryProducts.filter(
                (product, index, self) =>
                  index ===
                  self.findIndex(
                    (p) =>
                      p.productId === product.productId ||
                      (p.productName === product.productName && p.price === product.price && p.mrp === product.mrp)
                  )
              );

              logger.info(`FK: Found ${uniqueCategoryProducts.length} unique products for "${category.category} > ${category.subcategory}"`);

              // Add category information to products
              const productsWithCategory = uniqueCategoryProducts.map(product => ({
                ...product,
                categoryName: category.category,
                subcategoryName: category.subcategory,
              }));

              // Process and save products for this category
              const processedProducts = await processProducts(productsWithCategory);
              const categoryTime = ((new Date().getTime() - categoryStartTime.getTime()) / 1000).toFixed(2);
              logger.info(`FK: Processed and saved ${processedProducts} products for "${category.category} > ${category.subcategory}" in ${categoryTime} seconds`);
              totalProcessedProducts += processedProducts;
              return processedProducts;
            } finally {
              if (page) await page.close();
            }
          } catch (error) {
            logger.error(`FK: Error processing category "${category.category} > ${category.subcategory}": ${error.message || error}`, { error });
            return 0;
          }
        });

        // Wait for current batch to complete
        await Promise.all(batchPromises);

        const batchTime = ((new Date().getTime() - batchStartTime.getTime()) / 60000).toFixed(2);
        logger.info(`FK: Categories Processed: ${i + currentBatch.length} of ${categories.length} and Time taken: ${batchTime} minutes`);

        if (i + PARALLEL_CATEGORIES < categories.length) {
          logger.info("FK: Waiting between batches...");
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      const endTime = new Date();
      const totalDuration = (endTime - startTime) / 1000 / 60; // in minutes
      logger.info(`FK: Total processed products: ${totalProcessedProducts}`);
      logger.info(
        `FK: Total time taken: ${totalDuration.toFixed(2)} minutes`
      );
      // Wait for 1 minutes
      await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
    } catch (error) {
      // Wait for 2 minutes
      await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
      logger.error(`FK: Error in tracking cycle: ${error.message || error}`, { error });
    }
  }
};

const GROCERY_STORE_URL = "https://www.flipkart.com/grocery-supermart-store?marketplace=GROCERY";
const GROCERY_ROOT_URL = "https://www.flipkart.com/grocery/pr?sid=73z&marketplace=GROCERY";

const decodeHtmlUrls = (html) => html.replace(/&#x3D;/g, '=').replace(/&amp;/g, '&');

/**
 * Parse /grocery/<category>/<subcategory>/pr links (relative or absolute) from page HTML
 * into categoriesByPath, keeping one entry per subcategory.
 */
const parseCategoriesFromHtml = (html, categoriesByPath = new Map()) => {
  const urlRegex = /(?:https?:\/\/www\.flipkart\.com)?\/grocery\/([a-z0-9-]+)\/([a-z0-9-]+)\/pr\?[^"'\s<>]*/g;
  for (const [rawUrl, categorySlug, subcategorySlug] of decodeHtmlUrls(html).matchAll(urlRegex)) {
    const key = `${categorySlug}/${subcategorySlug}`;
    if (categoriesByPath.has(key)) continue;

    const url = new URL(rawUrl, "https://www.flipkart.com");
    // Some links point at a later page of the listing; always start from page 1
    url.searchParams.delete("page");
    const category = categorySlug.replace(/-/g, ' ');
    const subcategory = subcategorySlug.replace(/-/g, ' ');
    categoriesByPath.set(key, { category, subcategory, url: url.toString(), name: subcategory });
  }
  return categoriesByPath;
};

// Parse top-level /grocery/<category>/pr links from page HTML
const parseTopCategoriesFromHtml = (html) => {
  const topCategories = new Map();
  const urlRegex = /(?:https?:\/\/www\.flipkart\.com)?\/grocery\/([a-z0-9-]+)\/pr\?[^"'\s<>]*/g;
  for (const [rawUrl, categorySlug] of decodeHtmlUrls(html).matchAll(urlRegex)) {
    if (!topCategories.has(categorySlug)) {
      topCategories.set(categorySlug, new URL(rawUrl, "https://www.flipkart.com").toString());
    }
  }
  return topCategories;
};

// Function to extract categories from Flipkart Grocery
const extractCategories = async (pincode = "500064") => {
  let page = null;
  try {
    // Get or create context with setLocation
    const context = await setLocation(pincode);

    // Check if the location is serviceable
    if (!contextManager.getWebsiteServiceabilityStatus(pincode, "flipkart-grocery")) {
      throw AppError.badRequest(`Location ${pincode} is not serviceable by Flipkart Grocery`);
    }

    page = await context.newPage();
    const getPageHtml = async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      return page.content();
    };

    // The grocery store page only links a handful of subcategories, so walk the category tree too:
    // the grocery root page links every top-level category, and each top-level page links all of its subcategories
    logger.info("FK: Navigating to main grocery page...");
    const categoriesByPath = parseCategoriesFromHtml(await getPageHtml(GROCERY_STORE_URL));

    const rootHtml = await getPageHtml(GROCERY_ROOT_URL);
    parseCategoriesFromHtml(rootHtml, categoriesByPath);
    const topCategories = parseTopCategoriesFromHtml(rootHtml);
    logger.info(`FK: Found ${topCategories.size} top-level categories: ${[...topCategories.keys()].join(", ")}`);

    for (const [topCategory, topCategoryUrl] of topCategories) {
      try {
        parseCategoriesFromHtml(await getPageHtml(topCategoryUrl), categoriesByPath);
      } catch (error) {
        logger.error(`FK: Error reading subcategories of ${topCategory}: ${error.message || error}`, { error });
      }
    }

    const categories = [...categoriesByPath.values()];
    if (categories.length === 0) {
      logger.warn("FK: No categories found on the grocery pages; returning empty array");
    }
    logger.info(`FK: Extracted ${categories.length} subcategories from the category tree`);
    return categories;

  } catch (error) {
    logger.error(`FK: Error extracting categories: ${error.message || error}`, { error });
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
  }
};


// Core search function that can be used by unified search
export const search = async (location, query) => {
  try {
    // Set up location context
    const context = await setLocation(location);

    // Check if location is serviceable
    if (!contextManager.getWebsiteServiceabilityStatus(location, "flipkart-grocery")) {
      throw new Error(`Location ${location} is not serviceable by Flipkart Grocery`);
    }

    // Create a new page for search
    const page = await context.newPage();

    try {
      let allProducts = [];
      let currentUrl = `https://www.flipkart.com/search?q=${query}&otracker=search&marketplace=GROCERY&page=1`;
      let hasNextPage = true;
      let pageNum = 1;

      // Search across multiple pages (limit to 3 pages for performance)
      while (hasNextPage && pageNum <= 3) {
        logger.info(`FLIPKART: Processing page ${pageNum} for "${query}"`);

        // Extract products from current page
        const { products: pageProducts, nextPageUrl } = await extractProductsFromPage(page, currentUrl, query);

        allProducts = [...allProducts, ...pageProducts];
        logger.info(`FLIPKART: Found ${pageProducts.length} products on page ${pageNum}`);

        if (nextPageUrl) {
          currentUrl = nextPageUrl;
          pageNum++;
          await page.waitForTimeout(1000);
        } else {
          hasNextPage = false;
        }
      }

      // Filter out duplicates
      const uniqueProducts = allProducts.filter(
        (product, index, self) =>
          index ===
          self.findIndex(
            (p) =>
              p.productId === product.productId ||
              (p.productName === product.productName && p.price === product.price && p.mrp === product.mrp)
          )
      );

      logger.info(`FLIPKART: Found ${uniqueProducts.length} unique products`);

      return {
        success: true,
        products: uniqueProducts,
        total: uniqueProducts.length,
      };
    } finally {
      await page.close();
    }
  } catch (error) {
    logger.error(`FLIPKART: Search error: ${error.message || error}`, { error });
    throw error;
  }
};

const processProducts = async (products) => {
  try {
    // Extract weight and unit from product names before processing
    const enrichedProducts = products.map((product) => {
      // Extract weight from product name
      const weightMatch = product.productName.match(/(\d+\.?\d*)\s*(kg|g|ml|l)\b/i);
      let weight = null;
      let unit = null;

      if (weightMatch) {
        weight = parseFloat(weightMatch[1]);
        unit = weightMatch[2].toLowerCase();

        // Convert all weights to grams for consistency
        if (unit === "kg") {
          weight *= 1000;
          unit = "g";
        } else if (unit === "l") {
          weight *= 1000;
          unit = "ml";
        }
      }

      // Calculate price per unit (per 100g/100ml)
      let pricePerUnit = null;
      if (weight && (unit === "g" || unit === "ml")) {
        pricePerUnit = (product.price / weight) * 100;
        pricePerUnit = Math.round(pricePerUnit * 100) / 100; // Round to 2 decimal places
      }

      return {
        ...product,
        weight,
        unit,
        pricePerUnit,
      };
    });

    // Use the global processProducts function with Flipkart-specific options
    const result = await globalProcessProducts(enrichedProducts, "Flipkart Grocery", {
      model: FlipkartGroceryProduct,
      source: "Flipkart",
      significantDiscountThreshold: 10,
      telegramNotification: true,
      emailNotification: false,
    });

    return result;
  } catch (error) {
    logger.error(`FK: Error processing crawler products: ${error.message || error}`, { error });
    throw error;
  }
};
