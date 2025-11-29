import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandling.js";
import { FlipkartGroceryProduct } from "../models/FlipkartGroceryProduct.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import { productQueries } from "../utils/productQueries.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";

// Set location for Flipkart Grocery
const setLocation = async (pincode) => {
  let page = null;
  try {
    // Get or create context
    const context = await contextManager.getContext(pincode);

    // Return existing context if already set up and serviceable
    if (contextManager.getWebsiteServiceabilityStatus(pincode, "flipkart-grocery")) {
      logger.info(`FK: Using existing serviceable context for ${pincode}`);
      return context;
    }

    // Set up Flipkart Grocery for this context
    page = await context.newPage();

    // Navigate to Flipkart
    logger.info("FK: Navigating to Flipkart...");
    await page.goto("https://www.flipkart.com/grocery-supermart-store?marketplace=GROCERY", {
      waitUntil: "domcontentloaded",
      timeout: 30000, // 30 second timeout
    });

    await page.waitForTimeout(4000); // Increased timeout

    // Set location
    logger.info(`FK: Setting location for ${pincode}...`);

    // Focus into the input field
    await page.focus('input[placeholder*="Enter Pincode Here"]');

    await page.keyboard.type(pincode);
    await page.keyboard.press("Enter");
    // If a button(div) with text "CONTINUE" appears, click it
    const continueButton = await page.waitForSelector('xpath=//div[text()="CONTINUE"]', { timeout: 5000 });
    await continueButton.click();
    await page.waitForTimeout(3000); // Increased timeout

    // Verify location
    const locationInput = await page.$('input[placeholder*="Enter Pincode Here"]');
    if (locationInput) {
      // Mark as not serviceable and clean up
      contextManager.markServiceability(pincode, "flipkart-grocery", false);
      throw AppError.badRequest(`Location ${pincode} is not serviceable by Flipkart Grocery`);
    }

    // Location is serviceable - mark it as such
    contextManager.markServiceability(pincode, "flipkart-grocery", true);
    logger.info(`FK: Successfully set up for location: ${pincode}`);
    await page.close();
    return context;
  } catch (error) {
    // Mark location as not serviceable for any initialization errors too
    try {
      if (page) await page.close();
      // Mark as not serviceable and clean up
      contextManager.markServiceability(pincode, "flipkart-grocery", false);
    } catch (cleanupError) {
      // Don't let cleanup errors override the original error
      logger.error(`FK: Error during cleanup for ${pincode}:`, cleanupError);
    }

    logger.error(`FK: Error initializing context for ${pincode}:`, error);
    throw error;
  }
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
    logger.error(`FK: Error extracting products from page:`, error);
    return { products: [], nextPageUrl: null };
  }
};

export const startTracking = async (_, res, next) => {
  try {
    // Start the search process in the background
    startTrackingHandler().catch((error) => {
      logger.error("FK: Error in search handler:", error);
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};

let isTrackingCrawlerRunning = false;

export const startTrackingHandler = async (pincode = "500064") => {
  if (isTrackingCrawlerRunning) {
    throw new AppError("Search is already in progress", 400);
  }
  isTrackingCrawlerRunning = true;

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
      logger.info("FK: Starting product search at:", startTime.toLocaleString());

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
            logger.error(`FK: Error processing category "${category.category} > ${category.subcategory}":`, error);
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
      logger.error("FK: Error in tracking cycle:", error);
    }
  }
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

    // Navigate to the main grocery page
    logger.info("FK: Navigating to main grocery page...");
    await page.goto("https://www.flipkart.com/grocery-supermart-store?marketplace=GROCERY", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for categories to load and find category links
    await page.waitForSelector("a[href*='/grocery/']", { timeout: 5000 });

    // Find category links that have the proper structure (not pagination)
    const categoryLinks = await page.$$("a[href*='/grocery/']");
    let categoryLinkToClick = null;

    for (const link of categoryLinks) {
      const href = await link.getAttribute("href");
      const text = await link.textContent();

      // Look for category links that have the structure /grocery/category/subcategory/pr
      if (href && href.includes('/grocery/') && href.includes('/pr?')) {
        const urlMatch = href.match(/\/grocery\/([^\/]+)\/([^\/]+)\/pr/);
        if (urlMatch) {
          categoryLinkToClick = link;
          break;
        }
      }
    }

    if (!categoryLinkToClick) {
      throw new Error("No suitable category link found to click");
    }

    // Get the href from the category link
    const categoryHref = await categoryLinkToClick.getAttribute("href");
    const currentUrl = categoryHref.startsWith("http") ? categoryHref : "https://www.flipkart.com" + categoryHref;
    logger.info("FK: Navigated to:", currentUrl);

    // Navigate to view-source to get raw HTML
    const viewSourceUrl = "view-source:" + currentUrl;
    await page.goto(viewSourceUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Extract categories from the raw HTML source
    const categories = await page.evaluate(() => {
      const preElement = document.querySelector("pre");
      const html = preElement ? preElement.textContent : document.body.textContent;

      const categorySet = new Set();

      // Look for category URLs in the HTML that have proper category tracking
      const urlRegex = /https:\/\/www\.flipkart\.com\/grocery\/[^\/]+\/[^\/]+\/pr\?[^"']*otracker=categorytree[^"']*/g;
      const urls = html.match(urlRegex) || [];

      urls.forEach(url => {
        // Decode HTML entities in the URL
        const decodedUrl = url.replace(/&#x3D;/g, '=').replace(/&/g, '&');

        // Extract category info from URL
        const urlMatch = decodedUrl.match(/\/grocery\/([^\/]+)\/([^\/]+)\/pr/);
        if (urlMatch) {
          const category = urlMatch[1].replace(/-/g, ' ');
          const subcategory = urlMatch[2].replace(/-/g, ' ');

          // Try to find the name in the HTML around this URL
          const urlIndex = html.indexOf(url);
          if (urlIndex > 0) {
            // Look for text before the URL that might be the category name
            const beforeText = html.substring(Math.max(0, urlIndex - 200), urlIndex);
            const nameMatch = beforeText.match(/([^<>]*?)["']?\s*$/);
            const name = nameMatch ? nameMatch[1].trim() : subcategory;

            if (name && name.length > 2 && !/^\d+$/.test(name) && name.toLowerCase() !== 'next' && !name.includes('link') && !name.includes('href')) {
              categorySet.add(JSON.stringify({
                category,
                subcategory,
                url: decodedUrl,
                name: name.length > 50 ? subcategory : name
              }));
            }
          }
        }
      });

      return Array.from(categorySet).map(item => JSON.parse(item));
    });

    logger.info(`FK: Extracted ${categories.length} categories from view-source`);
    return categories;

  } catch (error) {
    logger.error("FK: Error extracting categories:", error);
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
    logger.error('FLIPKART: Search error:', error.message);
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
    logger.error("FK: Error processing crawler products:", error);
    throw error;
  }
};
