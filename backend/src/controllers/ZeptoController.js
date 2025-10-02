import axios from "axios";
import { ZeptoProduct } from "../models/ZeptoProduct.js";
import contextManager from "../utils/contextManager.js";
import { AppError } from "../utils/errorHandling.js";
import { chunk, isNightTimeIST } from "../utils/priceTracking.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";

// Set location for Zepto
const setLocation = async (location) => {
  let page = null;
  try {
    // Get or create context
    const context = await contextManager.getContext(location);

    // Return existing context if already set up and serviceable
    if (contextManager.isWebsiteServiceable(location, "zepto")) {
      console.log(`ZEPTO: Using existing serviceable context for ${location}`);
      return context;
    }

    // Set up Zepto for this context
    page = await context.newPage();

    // Navigate to homepage
    await page.goto("https://www.zeptonow.com/", {
      waitUntil: "domcontentloaded",
    });

    // Click on the location selection button
    console.log(`ZEPTO: Setting location for ${location}...`);
    await page.waitForSelector('button[aria-label="Select Location"]', {
      timeout: 5000,
    });
    await page.click('button[aria-label="Select Location"]');

    // Wait for the location search input to appear
    await page.waitForSelector('input[placeholder="Search a new address"]', {
      timeout: 5000,
    });

    let inputSelector = 'input[placeholder="Search a new address"]';
    await page.waitForSelector(inputSelector, { timeout: 3000 });
    await page.click(inputSelector);
    await page.fill(inputSelector, location);

    // Click on the first suggestion using the address-search-container
    await page.waitForSelector('//div[@data-testid="address-search-item"]', {
      timeout: 5000,
    });

    // Click the first address search item specifically
    await page.click('(//div[@data-testid="address-search-item"])[1]');
    console.log("ZEPTO: Clicked first suggestion using data-testid selector");

    // Click the "Confirm & Continue" button on the map modal
    await page.waitForSelector('[data-testid="location-confirm-btn"]', {
      timeout: 5000,
    });
    console.log("ZEPTO: Clicking Confirm & Continue button");
    await page.click('[data-testid="location-confirm-btn"]');

    // Wait for 2 seconds
    await page.waitForTimeout(2000);

    // Check for "Coming Soon" message using a more reliable method
    const comingSoonElement = await page.$("h3.font-heading");
    if (comingSoonElement) {
      const headingText = await comingSoonElement.textContent();
      if (headingText.includes("Sit Tight")) {
        console.log(`ZEPTO: Location ${location} is not serviceable - "Coming Soon" message found`);
        throw AppError.badRequest(`Location ${location} is not serviceable by Zepto: Coming Soon`);
      }
    }

    // Location is serviceable - mark it as such
    contextManager.markServiceability(location, "zepto", true);
    contextManager.contextMap.get(location).websites.add("zepto");
    console.log(`ZEPTO: Successfully set up for location: ${location}`);
    return context;
  } catch (error) {
    // Mark location as not serviceable for any initialization errors too
    try {
      // Mark as not serviceable and clean up
      contextManager.markServiceability(location, "zepto", false);
    } catch (cleanupError) {
      // Don't let cleanup errors override the original error
      console.error(`ZEPTO: Error during cleanup for ${location}:`, cleanupError);
    }
    console.error(`ZEPTO: Error initializing context for ${location}:`, error);
    throw error;
  } finally {
    if (page) await page.close();
  }
};

export const getCategoriesHandler = async (req, res, next) => {
  try {
    const location = req.query.location;
    if (!location) {
      throw AppError.badRequest("Location is required");
    }

    const categories = await fetchCategories(location);
    res.status(200).json(categories);
  } catch (error) {
    next(error instanceof AppError ? error : AppError.internalError("Failed to fetch categories"));
  }
};

const fetchCategories = async (location = "vertex corporate") => {
  try {
    // Fetch the sitemap XML
    const response = await axios.get("https://www.zeptonow.com/sitemap/categories/hyderabad.xml");

    // Parse the URLs from the XML content
    const unfilteredUrls = response.data.match(/https:\/\/www\.zeptonow\.com\/city\/[^<]+/g) || [];

    // Process URLs to extract categories and their subcategories
    const categoryMap = new Map();
    const unwantedCategories = [
      "salami",
      "meat",
      "women",
      "feminine",
      "girls",
      "jewellery",
      "kitchen",
      "purse",
      "decor",
      "hair-color",
      "fish",
      "kids",
      "boys",
      "toys",
      "unlisted",
      "books",
      "pet-care",
      "elderly",
      "cleaning-essentials",
      "test-",
      "sample",
      "prescription-medicine",
      "bags-wallets",
      "dummy",
      "home-needs",
      "makeup",
      "home",
      "lips",
      "face",
      "eyes",
      "nail",
      "beauty",
      "gardening",
      "sexual-wellness",
      "bath-body",
      "zepto-cafe",
    ];

    const urls = unfilteredUrls.filter((url) => !unwantedCategories.some((category) => url.includes(category)));

    urls.forEach((url) => {
      const parts = url.split("/");

      // URL structure: /city/hyderabad/cn/category-name/subcategory-name/cid/category-id/scid/subcategory-id
      const categoryIndex = parts.indexOf("cn") + 1;
      const cidIndex = parts.indexOf("cid") + 1;
      const scidIndex = parts.indexOf("scid") + 1;

      if (categoryIndex > 0 && cidIndex > 0 && scidIndex > 0) {
        const categoryName = parts[categoryIndex].replace(/-/g, " ");
        const subcategoryName = parts[categoryIndex + 1].replace(/-/g, " ");
        const categoryId = parts[cidIndex];
        const subcategoryId = parts[scidIndex];

        // If this category doesn't exist yet, create it
        if (!categoryMap.has(categoryId)) {
          categoryMap.set(categoryId, {
            categoryId,
            categoryName,
            subcategories: [],
          });
        }

        // Add subcategory to the category
        const category = categoryMap.get(categoryId);
        if (!category.subcategories.some((subcategory) => subcategory.subcategoryId === subcategoryId)) {
          category.subcategories.push({
            categoryId,
            categoryName,
            subcategoryId,
            subcategoryName,
            url: url,
          });
        }
      }
    });

    // Convert map to a clean object structure
    const categories = Array.from(categoryMap.values()).map((category) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      subcategories: Array.from(category.subcategories.values()),
    }));
    return categories;
  } catch (error) {
    console.error("Zepto: Error fetching categories from sitemap:", error?.response?.data || error);
    throw AppError.internalError("Failed to fetch categories");
  }
};

// Search endpoint for testing
export const searchQuery = async (req, res, next) => {
  let page = null;
  try {
    const { query, location } = req.body;

    if (!query || !location) {
      throw AppError.badRequest("Query and location are required");
    }

    // Get or create context for this location
    const context = await setLocation(location);
    page = await context.newPage();

    // Note: User agent should be set at context level, not page level in Playwright
    console.log("ZEPTO: Proceeding with search (user agent should be set at context level)");

    const allProducts = await extractProducts(page, {
      query,
      maxScrollAttempts: 5,
    });

    // Sort by price
    allProducts.sort((a, b) => a.price - b.price);

    // Set headers for better browser compatibility
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Type": "application/json",
    });

    res.status(200).json({
      success: true,
      products: allProducts,
      total: allProducts.length,
      totalPages: Math.ceil(allProducts.length / allProducts.length),
      processedPages: Math.ceil(allProducts.length / allProducts.length),
    });
  } catch (error) {
    console.error("ZEPTO: Search error:", error);

    // Set headers for error responses too
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Type": "application/json",
    });

    // Handle specific error types for better user experience
    if (error.message && error.message.includes("Location") && error.message.includes("not serviceable")) {
      return res.status(400).json({
        success: false,
        message: error.message,
        products: [],
      });
    }

    next(error);
  } finally {
    if (page) await page.close();
  }
};

export const startTracking = async (req, res, next) => {
  try {
    const location = req.query.location;
    if (!location) {
      throw AppError.badRequest("Location is required");
    }
    const message = await startTrackingHelper(location);
    res.status(200).json({ message });
  } catch (error) {
    next(error instanceof AppError ? error : AppError.internalError("Failed to start price tracking"));
  }
};

// Function to extract products from a page, either by search or direct URL
const extractProducts = async (page, options = {}) => {
  try {
    const { query = "", maxScrollAttempts = 15, url = null } = options;

    // If URL is provided, navigate to it directly
    if (url) {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
    } else if (query) {
      // Navigate to search page if query is provided
      const searchUrl = `https://www.zeptonow.com/search?query=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
    } else {
      throw new Error("Either URL or search query must be provided");
    }

    // Wait for products to load or check if no results
    try {
      await page.waitForSelector("a div[data-is-out-of-stock]", {
        timeout: 3000,
      });
      console.log(`ZEPTO: Products found for ${url || query}`);
    } catch (error) {
      console.log(`ZEPTO: No products found for ${url || query} - checking for no results message`);
      throw new Error(`No products found for ${url || query}`);
    }

    await page.waitForTimeout(1000);

    // Scroll to load all products (infinite scroll)
    let previousProductCount = 0;
    let currentProductCount = 0;
    let scrollAttempts = 0;
    const MAX_SCROLL_ATTEMPTS = maxScrollAttempts;

    console.log(`ZEPTO: Starting to scroll for ${url || query}`);

    // Scroll until no spinner is visible or max attempts reached
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
      // Get current product count
      currentProductCount = await page.evaluate(() => {
        return document.querySelectorAll("a div[data-is-out-of-stock]").length;
      });

      console.log(`ZEPTO: Found ${currentProductCount} products after ${scrollAttempts} scrolls`);

      // First scroll to the last available product card to trigger loading
      const { shouldStopScrolling } = await page.evaluate(() => {
        const productCards = document.querySelectorAll("a div[data-is-out-of-stock]");
        if (productCards.length > 0) {
          const lastCard = productCards[productCards.length - 1];
          const parentATag = lastCard.closest("a");

          // Check if the last product is out of stock using the data attribute
          const isOutOfStock = lastCard.getAttribute("data-is-out-of-stock") === "true";

          if (isOutOfStock) {
            console.log("Last product is out of stock, stopping scroll");
            return { shouldStopScrolling: true };
          }

          if (parentATag) {
            parentATag.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          return { shouldStopScrolling: false };
        }
        return { shouldStopScrolling: false };
      });

      // If last product is out of stock, stop scrolling
      if (shouldStopScrolling) {
        console.log(`ZEPTO: Stopping scroll - last product is out of stock at ${currentProductCount} products`);
        break;
      }

      // Wait a bit for the scroll to trigger loading
      await page.waitForTimeout(1000);

      // Now check if spinner is visible (indicating more products to load)
      const { isSpinnerVisible } = await page.evaluate(() => {
        const spinner = document.querySelector(".animate-spin");
        return { isSpinnerVisible: !!spinner };
      });

      // If no spinner is visible and product count hasn't changed, we've reached the end
      if (!isSpinnerVisible && currentProductCount === previousProductCount && scrollAttempts > 0) {
        console.log(`ZEPTO: No more products to load, stopping at ${currentProductCount} products`);
        break;
      }

      // Update previous count
      previousProductCount = currentProductCount;

      // If spinner is visible, scroll to it to continue loading
      if (isSpinnerVisible) {
        await page.evaluate(() => {
          const spinner = document.querySelector(".animate-spin");
          if (spinner) {
            spinner.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        });
      }

      // Wait for new products to load
      await page.waitForTimeout(2000);

      scrollAttempts++;
    }

    // Extract product data using page.evaluate
    const products = await page.evaluate(() => {
      const productCards = Array.from(document.querySelectorAll("a div[data-is-out-of-stock]"));

      return productCards
        .map((stockDiv) => {
          try {
            // Get the parent a tag which contains the product card
            const card = stockDiv.closest("a");
            if (!card) return null;

            // Extract product URL and variant ID from href attribute
            const href = card.getAttribute("href") || "";
            const variantIdMatch = href.match(/\/pvid\/([\w-]+)/);
            const variantId = variantIdMatch ? variantIdMatch[1] : "";
            if (!variantId) {
              return null;
            }

            // Extract product name - look for h3 or similar heading elements
            let productName = "";
            const nameElement =
              card.querySelector('div[data-slot-id="ProductName"]') ||
              card.querySelector("[class*='product-name-container']");
            if (nameElement) {
              productName = nameElement.textContent.trim();
            }

            // Extract weight/quantity - look for p tags with tracking-normal or similar
            let weight = "";
            const weightElement = card.querySelector('div[data-slot-id="PackSize"]');
            if (weightElement) {
              weight = weightElement.textContent.trim();
            }

            // Extract price information
            let price = 0;
            let mrp = 0;

            // Look for price in various possible structures
            const priceContainer = card.querySelector('div[data-slot-id="Price"]');

            if (priceContainer) {
              // Current price - first p tag is usually the price
              const priceElements = priceContainer.querySelectorAll("p");
              const priceElement = priceElements[0];
              if (priceElement) {
                const priceText = priceElement.textContent.trim();
                const priceMatch = priceText.match(/₹(\d+(?:\.\d+)?)/);
                if (priceMatch) {
                  price = parseFloat(priceMatch[1]) || 0;
                }
              }

              // MRP - second p tag is usually the MRP
              const mrpElement = priceElements[1];
              if (mrpElement) {
                const mrpText = mrpElement.textContent.trim();
                const mrpMatch = mrpText.match(/₹(\d+(?:\.\d+)?)/);
                if (mrpMatch) {
                  mrp = parseFloat(mrpMatch[1]) || 0;
                }
              }
            }

            // If no MRP found, use price as MRP
            if (mrp === 0) {
              mrp = price;
            }

            // Calculate discount percentage
            let discount = 0;
            if (mrp > price && price > 0) {
              discount = Math.round(((mrp - price) / mrp) * 100);
            }

            // Extract image URL
            const imageElement = card.querySelector("img") || card.querySelector('[data-testid="product-card-image"]');
            let imageUrl = imageElement ? imageElement.getAttribute("src") : "";

            // Check if product is out of stock using the data attribute
            const isOutOfStock = stockDiv.getAttribute("data-is-out-of-stock") === "true";

            // Product URL
            const productUrl = "https://www.zeptonow.com" + href;

            return {
              productId: variantId,
              productName,
              url: productUrl,
              imageUrl,
              weight,
              price,
              mrp,
              discount,
              inStock: !isOutOfStock,
            };
          } catch (error) {
            console.error("Error extracting product data:", error);
            return null;
          }
        })
        .filter((product) => product !== null && product.productId);
    });
    const filteredProducts = products.filter(
      (product) => product !== null && product.productName && product.productId && product.mrp > 0
    );
    console.log(`ZEPTO: Successfully extracted ${filteredProducts.length} products`);
    return filteredProducts;
  } catch (error) {
    console.error(`ZEPTO: Error extracting products:`, error);
    await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
    return [];
  }
};

export const startTrackingHelper = async (location = "vertex corporate") => {
  while (true) {
    try {
      // Skip if it's night time (12 AM to 6 AM IST)
      if (isNightTimeIST()) {
        console.log("Zepto: Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      // Set up browser context with location
      const context = await setLocation(location);
      if (!context) {
        throw new Error("ZEPTO: Failed to set location for Zepto");
      }

      console.log("Zepto: Starting new tracking cycle at:", new Date().toISOString());

      // Get all categories and flatten subcategories into a single array
      const categories = await fetchCategories();
      const allSubcategories = categories.reduce((acc, category) => {
        return acc.concat(category.subcategories);
      }, []);

      // Randomize the order of subcategories before processing
      allSubcategories.sort(() => Math.random() - 0.5);

      console.log(`Zepto: Found ${allSubcategories.length} subcategories to process (randomized order)`);

      let totalProcessedProducts = 0;
      const CHUNK_SIZE = 2; // Process 2 subcategories at a time

      // Process subcategories in chunks using the utility function
      const subcategoryChunks = chunk(allSubcategories, CHUNK_SIZE);
      for (let i = 0; i < subcategoryChunks.length; i++) {
        const subcategoryChunk = subcategoryChunks[i];
        console.log(`Zepto: Processing chunk ${i + 1} of ${subcategoryChunks.length}`);

        // Create pages for this chunk
        const pages = await Promise.all(
          subcategoryChunk.map(async () => {
            const page = await context.newPage();
            return page;
          })
        );

        try {
          // Process subcategories in parallel within the chunk
          const results = await Promise.all(
            subcategoryChunk.map(async (subcategory, index) => {
              try {
                console.log(`Zepto: Processing ${subcategory.categoryName} > ${subcategory.subcategoryName}`);

                // Extract products using the URL directly
                const products = await extractProducts(pages[index], {
                  url: subcategory.url,
                  maxScrollAttempts: subcategory.url.includes("fitness") ? 25 : 15,
                });

                // Transform products to include category information
                const transformedProducts = products.map((product) => ({
                  ...product,
                  categoryName: subcategory.categoryName,
                  subcategoryName: subcategory.subcategoryName,
                  categoryId: subcategory.categoryId,
                  subcategoryId: subcategory.subcategoryId,
                }));

                // Process the products
                const result = await globalProcessProducts(transformedProducts, subcategory.subcategoryName, {
                  model: ZeptoProduct,
                  source: "Zepto",
                  telegramNotification: true,
                  emailNotification: false,
                  significantDiscountThreshold: 10,
                });

                return typeof result === "number" ? result : result.processedCount;
              } catch (error) {
                console.error(
                  `Zepto: Error processing ${subcategory.categoryName} > ${subcategory.subcategoryName}:`,
                  error
                );
                await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
                return 0;
              }
            })
          );

          totalProcessedProducts += results.reduce((a, b) => a + b, 0);
        } finally {
          // Close pages after each chunk
          await Promise.all(pages.map((page) => page.close()));
        }

        // Add delay between chunks
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      console.log(`Zepto: Completed subcategory-based tracking. Processed ${totalProcessedProducts} products`);
    } catch (error) {
      console.error("Zepto: Failed to track prices:", error);
    } finally {
      console.log("Zepto: Tracking cycle completed at:", new Date().toISOString());
      // Add a delay before starting the next cycle
      await new Promise((resolve) => setTimeout(resolve, 2 * 60 * 1000)); // 2 minutes
    }
  }
};
