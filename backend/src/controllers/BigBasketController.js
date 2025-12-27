import logger from "../utils/logger.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import axios from "axios";
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
      logger.info("BB: User-Agent used:", await page.evaluate(() => navigator.userAgent));
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

        // Check if suggestions are visible with multiple selectors
        const firstSuggestion = await page.waitForSelector('li[class*="sc-jdkBTo"]', {
          timeout: 5000,
        });

        if (firstSuggestion) {
          await page.evaluate(() => {
            const firstSuggestion = document.querySelector('li[class*="sc-jdkBTo"]');
            if (firstSuggestion) {
              firstSuggestion.click();
              return true;
            } else {
              return false;
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
          // If no suggestion then the address is not serviceable
          throw AppError.badRequest(`BB: Delivery not available for pincode: ${pincode}`);
        }
      } else {
        throw new Error("BB: Pincode input field not found");
      }
    } catch (error) {
      logger.error("BB: Error setting location:", error);
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
    logger.error(`BB: Error setting pincode ${pincode}:`, error);
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
    logger.error('BB: Search error:', error.message);
    throw error;
  }
};

// Extract products from a page - can handle both category pages and search pages
const extractProductsFromPage = async (page, category = null, searchQuery = null, maxPagesToFetch = 25) => {
  try {
    // If category is provided, navigate to category page first
    let baseUrl = '';
    if (category?.url) {
      logger.info(`BB: Processing category: ${category.name}`);
      baseUrl = `https://www.bigbasket.com/${category.url}/`;
    } else if (searchQuery) {
      logger.info(`BB: Processing search query: ${searchQuery}`);
      baseUrl = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(searchQuery)}`;
    }

    if (!baseUrl) {
      throw new Error("BB: No category or search query provided for product extraction");
    }

    // Visit the first page once to establish session
    const firstPageUrl = baseUrl.includes('?') ? `${baseUrl}&page=1` : `${baseUrl}?page=1`;
    logger.info(`BB: Initial page load: ${firstPageUrl}`);

    await page.goto(firstPageUrl, { waitUntil: "domcontentloaded" });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check for Access Denied
    const accessDenied = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 && h1.textContent.includes('Access Denied');
    });
    if (accessDenied) {
      logger.info("BB: Access denied - IP appears to be blocked by BigBasket");
      throw AppError.badRequest("BB: Access denied - IP appears to be blocked by BigBasket");
    }

    const allProducts = [];
    let currentPage = 1;
    let hasMoreProducts = true;

    // Fetch products by making fetch calls inside the browser context
    while (hasMoreProducts && currentPage <= maxPagesToFetch) {
      try {
        const pageUrl = baseUrl.includes('?')
          ? `${baseUrl}&page=${currentPage}`
          : `${baseUrl}?page=${currentPage}`;

        logger.info(`BB: Fetching page ${currentPage} via fetch`);

        // Make fetch call inside browser context and parse the JSON data
        const products = await page.evaluate(async (url) => {
          try {
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) {
              return { error: `HTTP ${response.status}` };
            }

            const html = await response.text();

            // Extract JSON data from __NEXT_DATA__ script tag
            const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
            if (!nextDataMatch) {
              return { error: 'No __NEXT_DATA__ found' };
            }

            const nextData = JSON.parse(nextDataMatch[1]);
            const ssrData = nextData?.props?.pageProps?.SSRData;

            if (!ssrData?.tabs?.[0]?.product_info?.products) {
              return { products: [] };
            }

            const rawProducts = ssrData.tabs[0].product_info.products;
            const extractedProducts = [];

            rawProducts.forEach((p) => {
              try {
                const parseNum = (val) => {
                  if (!val) return 0;
                  const s = String(val).replace(/[^0-9.]/g, "");
                  const n = parseFloat(s);
                  return Number.isFinite(n) ? n : 0;
                };

                const priceStr = p?.pricing?.discount?.prim_price?.sp || p?.pricing?.discount?.prim_price?.base_price || p?.pricing?.subscription_price || null;
                const mrpStr = p?.pricing?.discount?.mrp || null;

                const price = parseNum(priceStr);
                const mrp = parseNum(mrpStr) || price;
                const discount = mrp > 0 && price > 0 ? parseFloat((((mrp - price) / mrp) * 100).toFixed(2)) : 0;

                // Get image from images array (prefer medium size)
                const image = (p?.images && p.images[0] && (p.images[0].m || p.images[0].l || p.images[0].s)) || "";

                const url = p?.absolute_url ? `https://www.bigbasket.com${p.absolute_url}` : "";

                const inStock = !!(
                  p?.availability &&
                  p.availability.avail_status === "001" &&
                  p.availability.not_for_sale !== true
                );

                const weight = p?.w || p?.unit || p?.pack_desc || "";

                const product = {
                  id: p?.id?.toString() || p?.requested_sku_id?.toString() || "",
                  name: (p?.desc || "").toString().trim(),
                  brand: p?.brand?.name || "",
                  weight: weight,
                  price: price,
                  mrp: mrp,
                  discount: discount,
                  image: image,
                  url: url,
                  inStock: inStock,
                };

                if (product.name && product.price > 0) {
                  extractedProducts.push(product);
                }
              } catch (err) {
                console.error('Error parsing product:', err);
              }
            });

            return { products: extractedProducts };
          } catch (error) {
            return { error: String(error) };
          }
        }, pageUrl);

        if (products.error) {
          logger.error(`BB: Error fetching page ${currentPage}:`, products.error);
          hasMoreProducts = false;
          break;
        }

        logger.info(`BB: Extracted ${products.products.length} products from page ${currentPage}`);

        if (products.products.length === 0) {
          hasMoreProducts = false;
          break;
        }

        allProducts.push(...products.products);
        currentPage++;

        // Safety: avoid hammering the server
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (pageError) {
        logger.error(`BB: Error fetching products from page ${currentPage}:`, pageError?.message || pageError);
        hasMoreProducts = false;
      }
    }

    const contextInfo = category ? `category ${category.name}` : "page";
    logger.info(`BB: Successfully extracted ${allProducts.length} products from ${contextInfo}`);
    return allProducts;
  } catch (error) {
    const contextInfo = category ? `category ${category.name}` : "page";
    logger.error(`BB: Error fetching products for ${contextInfo}:`, error);
    await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
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
      logger.info("BB: Starting product search at:", startTime.toLocaleString());

      // Setup the context for the location
      const context = await setLocation(location);

      // Check if the location is serviceable
      if (!contextManager.getWebsiteServiceabilityStatus(location, "bigbasket")) {
        logger.info(`BB: Location ${location} is not serviceable, stopping crawler`);
        break;
      }

      const categories = await fetchCategories(); // Contains all the final categories in flattened format
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
              logger.error(`BB: Error processing category ${category.name}:`, error);
            } finally {
              if (page) await page.close();
            }
          } catch (error) {
            logger.error(`BB: Error processing category ${category.name}:`, error);
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
      logger.error("BB: Error in crawler:", error);
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
      logger.error("BB: Error in search handler:", error);
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};

export const fetchCategories = async () => {
  try {
    const response = await axios.get("https://www.bigbasket.com/ui-svc/v1/category-tree?x-channel=BB-PWA", {
      headers: {
        accept: "*/*",
        cookie:
          'x-entry-context-id=100; x-entry-context=bb-b2c; _bb_locSrc=default; x-channel=pwa; PWA=1; _bb_bhid=; _bb_nhid=1723; _bb_vid=NTMwOTY4NTcxNTgzMjYwOTEw; _bb_dsevid=; _bb_dsid=; csrftoken=sSY3i39IumZPWGeSdiLTrk75ZfiRARjhsKQW4tBVAB5OBhjBY07myny3Q4z2PAnd; _bb_home_cache=952471fd.1.visitor; _bb_bb2.0=1; _is_tobacco_enabled=0; _is_bb1.0_supported=0; bb2_enabled=true; csurftoken=QrCMGQ.NTMwOTY4NTcxNTgzMjYwOTEw.1735715394543.joobZl7rDu+lkAhAiKkTSPXZkhnQY2GUAUBioJOeYso=; jarvis-id=5852cfbd-07cc-40a0-b3fb-58880d96fc00; ts=2025-01-01%2012:39:59.443; _bb_lat_long=MTcuMzU1ODcwNXw3OC40NTQ0Mjkz; _bb_cid=3; _bb_aid="MzAwNzQ5NTU2Nw=="; is_global=0; _bb_addressinfo=MTcuMzU1ODcwNXw3OC40NTQ0MjkzfE11cmlnaSBDaG93a3w1MDAwNjR8SHlkZXJhYmFkfDF8ZmFsc2V8dHJ1ZXx0cnVlfEJpZ2Jhc2tldGVlcg==; _bb_pin_code=500064; _bb_sa_ids=14657,15113; _bb_cda_sa_info=djIuY2RhX3NhLjEwMC4xNDY1NywxNTExMw==; is_integrated_sa=1',
      },
    });

    let processedCategories = [];

    // Process the categories recursively
    const processCategories = (categories) => {
      if (!Array.isArray(categories)) return [];

      categories.map((category) => {
        if (category?.level === 1) {
          processedCategories.push(category);
        }

        if (category?.children && Array.isArray(category?.children)) {
          processCategories(category?.children);
        }
      });
    };

    processCategories(response.data?.categories);

    return processedCategories;
  } catch (error) {
    logger.error("Error fetching categories:", error.response?.data || error.message);
    throw AppError.internalError("Failed to fetch categories");
  }
};