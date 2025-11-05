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
      console.log(`BB: Using existing serviceable context for ${pincode}`);
      return context;
    }

    // Set up BigBasket for this context
    page = await context.newPage();

    // Navigate to BigBasket
    await page.goto("https://www.bigbasket.com/", { waitUntil: "domcontentloaded" });

    // Wait for the page to be fully loaded
    await page.waitForTimeout(5000);

    // Look for location selector - this will need to be updated with correct selectors
    console.log("BB: Setting location...");

    // Sometimes the Bigbasket block the ip, check if Access Denied is present on the webpage
    const accessDeniedElement = await page.$('h1:has-text("Access Denied")');
    if (accessDeniedElement) {
      console.log("BB: Access denied - IP appears to be blocked by BigBasket");
      console.log("User Agent:", await page.evaluate(() => navigator.userAgent));
      throw AppError.badRequest("BB: Access denied - IP appears to be blocked by BigBasket");
    }

    // Try to find and click location selector
    try {
      // Click the location selector using JavaScript since Playwright click times out
      const clicked = await page.evaluate(() => {
        const element = document.querySelector('button[class*="AddressDropdown"]');
        if (element) {
          element.click();
          return true;
        }
        return false;
      });

      if (clicked) {
        console.log("BB: Clicked location selector with JavaScript");
      } else {
        throw new Error("BB: Could not click location selector with JavaScript");
      }

      // Fill the pincode using the correct selector from HTML structure
      const pincodeInput = await page.waitForSelector('input[placeholder="Search for area or street name"]', {
        timeout: 4000,
      });
      if (pincodeInput) {
        console.log("BB: Pincode input field found");

        await pincodeInput.fill(pincode);

        // Wait for suggestions to appear
        await page.waitForTimeout(3000);

        // Check if suggestions are visible with multiple selectors
        const firstSuggestion = await page.waitForSelector('li[class*="AddressDropdown___StyledMenuItem"]', {
          timeout: 5000,
        });

        if (firstSuggestion) {
          await page.evaluate(() => {
            const firstSuggestion = document.querySelector('li[class*="AddressDropdown___StyledMenuItem"]');
            if (firstSuggestion) {
              firstSuggestion.click();
              return true;
            } else {
              return false;
            }
          });
          console.log("BB: Selected first location suggestion");

          await page.waitForTimeout(5000);

          // If the location is set successfully, then the span tag with text "select location should be removed"
          // Check if the "Select Location" button is still present after selecting the suggestion
          const selectLocationButton = await page.$("//button[.//span[contains(text(), 'Select Location')]]");
          if (selectLocationButton) {
            console.error("BB: Location not set successfully or not serviceable");
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
      console.error("BB: Error setting location:", error);
      contextManager.markServiceability(pincode, "bigbasket", false);
      throw AppError.badRequest(`BB: Could not set location for pincode: ${pincode}`);
    }

    // Mark as serviceable and register the website
    contextManager.markServiceability(pincode, "bigbasket", true);
    console.log(`BB: Successfully set up for pincode: ${pincode}`);

    await page.close();
    return context;
  } catch (error) {
    if (page) await page.close();
    contextManager.markServiceability(pincode, "bigbasket", false);
    console.error(`BB: Error setting pincode ${pincode}:`, error);
    throw error;
  }
};

// Function to search and extract products for a query
const searchAndExtractProducts = async (page, query, maxScrollAttempts = 15) => {
  try {
    console.log(`BB: Searching for "${query}"`);

    // Navigate to search page
    const searchUrl = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    // Use the extractProductsFromPage function with infinite scroll
    const products = await extractProductsFromPage(page, null, maxScrollAttempts);

    console.log(`BB: Found ${products.length} unique products for "${query}"`);
    return products;
  } catch (error) {
    console.error(`BB: Error searching for "${query}":`, error);
    return [];
  }
};

// Search endpoint handler using web scraping
export const searchProducts = async (req, res, next) => {
  let page = null;

  try {
    const { query, pincode } = req.body;

    if (!query || !pincode) {
      throw AppError.badRequest("Query and pincode are required");
    }

    // Get or create context for this pincode
    const context = await setLocation(pincode);
    page = await context.newPage();

    // Search and extract products
    const allProducts = await searchAndExtractProducts(page, query, 3);

    // Sort by price
    allProducts.sort((a, b) => a.price - b.price);

    res.status(200).json({
      success: true,
      products: allProducts,
      total: allProducts.length,
      method: "web-scraping",
    });
  } catch (error) {
    console.error("BB: BigBasket scraping error:", error);
    next(error instanceof AppError ? error : AppError.internalError("Failed to fetch BigBasket products"));
  } finally {
    if (page) await page.close();
  }
};

// Extract products from a page - can handle both category pages and search pages
const extractProductsFromPage = async (page, category = null, maxScrollAttempts = 25) => {
  try {
    // If category is provided, navigate to category page first
    if (category) {
      console.log(`BB: Processing category: ${category.name}`);
      const categoryUrl = `https://www.bigbasket.com/${category.url}/`;
      await page.goto(categoryUrl, { waitUntil: "domcontentloaded" });
    }

    // Wait for the page to load completely
    await page.waitForTimeout(3000);

    // Get cookies from the browser
    const cookies = await page.evaluate(() => {
      return document.cookie;
    });
    console.log(`BB: Retrieved cookies from browser`);

    const allProducts = [];
    let currentPage = 1;
    let hasMoreProducts = true;

    // Fetch products using API calls instead of scrolling
    while (hasMoreProducts) {
      try {
        const apiUrl = `https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=${category.slug}&page=${currentPage}`;
        console.log(`BB: Fetching page ${currentPage} from API`);

        // Perform the listing API call inside the browser context so the request
        // uses the real browser cookies (including HttpOnly) and client behavior.
        // This usually bypasses CDN/bot protections that block non-browser clients.
        let respData = {};
        try {
          const browserResp = await page.evaluate(async (url) => {
            try {
              const res = await fetch(url, { credentials: 'include' });
              const text = await res.text();
              try {
                return { status: res.status, json: JSON.parse(text) };
              } catch (e) {
                return { status: res.status, text };
              }
            } catch (e) {
              return { error: String(e) };
            }
          }, apiUrl);

          if (browserResp && browserResp.error) {
            console.error('BB: Browser fetch error:', browserResp.error);
            respData = {};
          } else if (browserResp && browserResp.json) {
            respData = browserResp.json;
          } else {
            // No JSON returned; keep respData empty so fallback logic can run later
            respData = {};
          }
        } catch (e) {
          console.error('BB: Failed to fetch listing inside browser context:', e);
          respData = {};
        }

        // Try standard product_info first
        const productInfo = respData?.tabs?.[0]?.product_info || null;
        // Raw products array (structure may vary) - leave parsing for the next step
        const rawProducts = productInfo?.products || respData?.tab_info?.product_map?.all?.prods || [];

        // Parse and transform raw products into normalized shape used by the system
        if (Array.isArray(rawProducts) && rawProducts.length > 0) {
          rawProducts.forEach((p) => {
            try {
              const priceStr =
                p?.pricing?.discount?.prim_price?.sp || p?.pricing?.discount?.prim_price?.base_price || p?.pricing?.subscription_price || null;
              const mrpStr = p?.pricing?.discount?.mrp || null;

              const parseNum = (val) => {
                if (val === null || val === undefined) return 0;
                const s = String(val).replace(/[^0-9.]/g, "");
                const n = parseFloat(s);
                return Number.isFinite(n) ? n : 0;
              };

              const price = parseNum(priceStr);
              const mrp = parseNum(mrpStr) || price;
              const discount = mrp > 0 && price > 0 ? parseFloat((((mrp - price) / mrp) * 100).toFixed(2)) : 0;

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
                allProducts.push(product);
              }
            } catch (err) {
              console.error("BB: Error transforming product:", err);
            }
          });
        }

        // Pagination: use productInfo.number_of_pages and productInfo.page when available
        const pageFromResp = Number(productInfo?.page || currentPage);
        const numberOfPages = Number(productInfo?.number_of_pages || 0);

        if (!productInfo || rawProducts.length === 0) {
          hasMoreProducts = false;
        } else if (numberOfPages > 0 && pageFromResp >= numberOfPages) {
          hasMoreProducts = false;
        } else {
          // Advance to next page
          currentPage = pageFromResp + 1;
          // Safety: avoid hammering the API
          await page.waitForTimeout(500);
        }
      } catch (apiError) {
        console.error(`BB: Error fetching products from API for page ${currentPage}:`, apiError?.message || apiError);
        hasMoreProducts = false;
      }
    }

    const contextInfo = category ? `category ${category.name}` : "page";
    console.log(`BB: Successfully extracted ${allProducts.length} products from ${contextInfo}`);
    return allProducts;
  } catch (error) {
    const contextInfo = category ? `category ${category.name}` : "page";
    console.error(`BB: Error fetching products for ${contextInfo}:`, error);
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
        console.log("BB: Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      const startTime = new Date();
      console.log("BB: Starting product search at:", startTime.toLocaleString());

      // Setup the context for the location
      const context = await setLocation(location);

      // Check if the location is serviceable
      if (!contextManager.getWebsiteServiceabilityStatus(location, "bigbasket")) {
        console.log(`BB: Location ${location} is not serviceable, stopping crawler`);
        break;
      }

      const categories = await fetchCategories(); // Contains all the final categories in flattened format
      if (!categories || categories.length === 0) {
        console.log("BB: No categories found");
        continue;
      }

      // Process categories in parallel batches
      const PARALLEL_SEARCHES = 1;
      let totalProcessedProducts = 0;

      for (let i = 0; i < categories.length; i += PARALLEL_SEARCHES) {
        const currentBatch = categories.slice(i, i + PARALLEL_SEARCHES);
        console.log(`BB: Processing categories ${i + 1} to ${i + currentBatch.length} of ${categories.length}`);

        const batchPromises = currentBatch.map(async (category) => {
          try {
            let page = null;

            try {
              page = await context.newPage();

              // Extract products using the extractProductsFromPage function
              const products = await extractProductsFromPage(page, category, 25);

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
                console.log(`BB: Processed ${processedCount} products for ${category.name}`);
              } else {
                console.log(`BB: No products found for ${category.name}`);
              }
            } catch (error) {
              console.error(`BB: Error processing category ${category.name}:`, error);
            } finally {
              if (page) await page.close();
            }
          } catch (error) {
            console.error(`BB: Error processing category ${category.name}:`, error);
          }
        });

        await Promise.all(batchPromises);
        console.log(
          `BB: Categories Processed: ${i + currentBatch.length} of ${categories.length} and Time taken: ${(
            (new Date().getTime() - startTime.getTime()) /
            60000
          ).toFixed(2)} minutes`
        );
      }

      console.log(`BB: Total processed products: ${totalProcessedProducts}`);
      console.log(`BB: Total time taken: ${((new Date().getTime() - startTime.getTime()) / 60000).toFixed(2)} minutes`);
    } catch (error) {
      // Wait for 5 minutes
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      console.error("BB: Error in crawler:", error);
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
      console.error("BB: Error in search handler:", error);
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
    console.error("Error fetching categories:", error.response?.data || error.message);
    throw AppError.internalError("Failed to fetch categories");
  }
};
