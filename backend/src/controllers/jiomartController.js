// Watch the video https://youtu.be/WP-S1QolVvU which is recorded for the future reference
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

// The below functioanlity work for desktop view of browser not mobile or ipad view and can run only one category at a time
const extractProductsFromPage = async (page, url, MAX_LOAD_MORE_ATTEMPTS = 15) => {
  try {
    // Navigate to the page
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Wait for initial products to load
    await page.waitForSelector("a.plp_product_list", {
      timeout: 10000,
      state: "attached",
    });

    let loadMoreAttempts = 0;
    let previousHitsLength = 0;
    const MAX_NO_NEW_PRODUCTS_ATTEMPTS = 2;
    let noNewProductsAttempts = 0;

    while (loadMoreAttempts < MAX_LOAD_MORE_ATTEMPTS && noNewProductsAttempts < MAX_NO_NEW_PRODUCTS_ATTEMPTS) {

      // Get current hits length from window.hits object
      const currentHitsLength = await page.evaluate(() => {
        if (!window.hits || typeof window.hits !== 'object') {
          return 0;
        }
        return Object.values(window.hits).reduce((total, page) => {
          return total + (Array.isArray(page) ? page.length : 0);
        }, 0);
      });

      // If no new products were loaded, increment the counter
      if (currentHitsLength === previousHitsLength && loadMoreAttempts > 0) {
        noNewProductsAttempts++;
        console.log(`JIO: No new products loaded (attempt ${noNewProductsAttempts}/${MAX_NO_NEW_PRODUCTS_ATTEMPTS})`);
      } else {
        // If new products were found, and if the new products loaded are less than 12 then we have reached the end , since we have fetched the less products than the limit per page
        if (currentHitsLength - previousHitsLength < 12) {
          console.log("JIO: less than 12 new products loaded, stopping pagination");
          break;
        }
        noNewProductsAttempts = 0; // Reset counter if new products were found
      }

      // Update previous count
      previousHitsLength = currentHitsLength;

      // Set up response promise before clicking
      const responsePromise = page.waitForResponse(response =>
        response.url().includes('/queries') && response.request().method() === 'POST'
      );

      // Click the load more button inside the browser context
      const clickResult = await page.evaluate(() => {
        const loadMoreButton = document.querySelector('.ais-InfiniteHits-loadMore');
        if (loadMoreButton && !loadMoreButton.classList.contains('ais-InfiniteHits-loadMore--disabled')) {
          loadMoreButton.click();
          return true;
        }
        return false;
      });

      if (clickResult) {
        // console.log(`JIO: Clicked load more button (attempt ${++loadMoreAttempts})`);
      } else {
        console.log("JIO: Load more button not found or disabled, stopping pagination");
        break;
      }

      // Wait for the response to complete
      try {
        await responsePromise;
        // console.log("JIO: Load more response received");
      } catch (error) {
        console.log("JIO: Timeout waiting for load more response, continuing...");
      }

      // Wait a bit for the UI to update
      await page.waitForTimeout(500);

    }

    // Extract products from window.hits object
    const products = await page.evaluate(() => {
      const extractedProducts = [];

      if (!window.hits || typeof window.hits !== 'object') {
        console.log("JIO: window.hits not found or not an object");
        return extractedProducts;
      }

      // Flatten all hits (pages) into a single array of products
      const allProducts = [];
      Object.values(window.hits).forEach(page => {
        if (Array.isArray(page)) {
          allProducts.push(...page);
        }
      });

      allProducts.forEach((product) => {
        try {
          // Extract required fields from the product object
          const productId = product.product_code || product.objectID;
          const productName = product.display_name;
          const price = parseFloat(product.selling_price || product.sell_price_value || 0);
          const mrp = parseFloat(product.mrp || 0);
          const weight = product.size || "";
          const brand = product.brand || "";
          const inStock = true;
          // Check for the product card for the details about out of stock
          const productCard = document.querySelector('a[href*="' + product.url_path + '"]');
          if (productCard) {
            console.log("JIO: Product card found", product.url_path);
            if (productCard.textContent.toLowerCase().includes("out of stock")) {
              inStock = false;
            }
          }else{
            inStock = false;
            console.log("JIO: Product card not found", product.url_path);
          }


          if (mrp === 0 || price === 0) {
            return;
          }
          const discount = mrp > price ? Number((((mrp - price) / mrp) * 100).toFixed(2)) : 0;

          // Build full URL
          const fullUrl = product.url_path ? `https://www.jiomart.com${product.url_path}` : "";

          // Get image URL
          const imageUrl = `https://www.jiomart.com/images/product/original/${product.image_path}`

          // Validate required fields
          if (!productId || !productName || !price || price <= 0) {
            return;
          }

          extractedProducts.push({
            productId: productId.toString(),
            productName,
            url: fullUrl,
            imageUrl,
            price,
            mrp: mrp || price,
            discount,
            weight,
            brand,
            inStock,
          });
        } catch (error) {
          console.error("JIO: Error extracting product data from window.hits:", error);
        }
      });

      return extractedProducts;
    });

    // Extract variants for each product by clicking variant dropdown buttons
    // console.log("JIO: Starting variant extraction...");
    const variantDropdownButtons = await page.$$(".variant_dropdown");
    console.log(`JIO: Found ${variantDropdownButtons.length} variant dropdown buttons`);

    const extractedVariants = [];
    const processedProductIds = new Set();

    for (let i = 0; i < variantDropdownButtons.length; i++) {
      try {
        // Click on the variant dropdown button inside browser context
        const clickResult = await page.evaluate((index) => {
          const buttons = document.querySelectorAll('.variant_dropdown');
          if (buttons[index]) {
            buttons[index].click();
            return true;
          }
          return false;
        }, i);

        if (clickResult) {
          // console.log(`JIO: Clicked variant dropdown ${i + 1}/${variantDropdownButtons.length}`);
        } else {
          console.log(`JIO: Failed to click variant dropdown ${i + 1}, skipping`);
          continue;
        }

        // Wait for the modal to open and variant_data to be populated
        await page.waitForTimeout(1000);

        // Extract variant data
        const variants = await page.evaluate(() => {
          const variantProducts = [];
          console.log("JIO: variant_data", variant_data);
          if (variant_data && Array.isArray(variant_data)) {
            variant_data.forEach((variant) => {
              try {
                const productId = variant.product_code || variant.objectID;
                const productName = variant.display_name;
                let price = parseFloat(variant.selling_price || variant.sell_price_value || 0);
                let mrp = parseFloat(variant.mrp || 0);
                const weight = variant.size || "";
                const brand = variant.brand || "";
                // For instock check div 
                let variantProductCard = document.querySelector('a[href*="' + variant.url_path + '"]');
                let inStock = true;
                if (variantProductCard) {
                  console.log("JIO: Variant product card found", variant.url_path);
                  // Check if it contains text "out of stock"
                  if (variantProductCard.textContent.toLowerCase().includes("out of stock")) {
                    inStock = false;
                  }
                }else{
                  console.log("JIO: Variant product card not found", variant.url_path);
                }

                if (mrp === 0 || price === 0) {
                  // Try to find from the buybox
                  if (variant.buybox_mrp && Object.keys(variant.buybox_mrp).length > 0) {
                    const availableKey = Object.keys(variant.buybox_mrp).find(key => variant.buybox_mrp[key].available);

                    if (availableKey) {
                      const availableProduct = variant.buybox_mrp[availableKey];
                      mrp = availableProduct.mrp;
                      price = availableProduct.price;
                    }
                  }

                  if (mrp <= 0 || price <= 0) {
                    console.log("JIO: Invalid variant data", productId, productName, price);
                    return;
                  }
                }
                const discount = mrp > price ? Number((((mrp - price) / mrp) * 100).toFixed(2)) : 0;

                // Build full URL
                const fullUrl = variant.url_path ? `https://www.jiomart.com${variant.url_path}` : "";

                // Get image URL
                const imageUrl = `https://www.jiomart.com/images/product/original/${variant.image_path}`

                // Validate required fields
                if (!productId || !productName || !price || price <= 0 || mrp <= 0) {
                  return;
                }

                variantProducts.push({
                  productId: productId.toString(),
                  productName,
                  url: fullUrl,
                  imageUrl,
                  price,
                  mrp: mrp || price,
                  discount,
                  weight,
                  brand,
                  inStock,
                });
              } catch (error) {
                console.error("JIO: Error extracting variant data:", error);
              }
            });
          }

          return variantProducts;
        });

        // Add variants that haven't been processed yet
        variants.forEach(variant => {
          if (!processedProductIds.has(variant.productId)) {
            extractedVariants.push(variant);
            processedProductIds.add(variant.productId);
          }
        });

        // console.log(`JIO: Extracted ${variants.length} variants from dropdown ${i + 1}`);
      } catch (error) {
        console.error(`JIO: Error processing variant dropdown ${i + 1}:`, error);
        // Try to close any open modal
        try {
          await page.keyboard.press('Escape');
        } catch (closeError) {
          // Ignore close errors
        }
      }
    }

    // Combine main products with variants
    const allProducts = [...products, ...extractedVariants];
    console.log(`JIO: Total products extracted: ${products.length} main products + ${extractedVariants.length} variants = ${allProducts.length} total`);

    console.log(`JIO: Successfully extracted ${allProducts.length} products from page ${url} using window.hits and variants`);
    return { products: allProducts };
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
      const PARALLEL_SEARCHES = 1;
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