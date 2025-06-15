import { AppError } from "../utils/errorHandling.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import axios from "axios";
import { ZeptoProduct } from "../models/ZeptoProduct.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";
import { productQueries } from "../utils/productQueries.js";

// Global variables
const placesData = {};
/**
 * Generates a URL for a Zepto category or subcategory
 * @param {string} categoryName - The name of the category
 * @param {string} categoryId - The UUID of the category
 * @param {string} subcategoryName - The name of the subcategory
 * @param {string} subcategoryId - The UUID of the subcategory
 * @returns {string} The complete URL for the category/subcategory
 */
export const generateCategoryUrl = (categoryName, categoryId, subcategoryName, subcategoryId) => {
    // Convert names to URL-friendly format (lowercase, hyphenated)
    const slugifiedCategoryName = categoryName.toLowerCase().replace(/\s+/g, "-");
    const slugifiedSubcategoryName = subcategoryName.toLowerCase().replace(/\s+/g, "-");

    // Construct the URL using the Zepto URL pattern
    return `https://www.zeptonow.com/cn/${slugifiedCategoryName}/${slugifiedSubcategoryName}/cid/${categoryId}/scid/${subcategoryId}`;
};


// Set location for Zepto
const setLocation = async (location) => {
    let page = null;
    try {
        // Get or create context
        const context = await contextManager.getContext(location);

        // Return existing context if already set up and serviceable
        if (contextManager.isWebsiteSet(location, "zepto") && contextManager.isWebsiteServiceable(location, "zepto")) {
            console.log(`ZEPTO: Using existing serviceable context for ${location}`);
            return context;
        }

        // Set up Zepto for this context
        page = await context.newPage();

        // Navigate to homepage
        await page.goto("https://www.zeptonow.com/", { waitUntil: "domcontentloaded" });

        // Click on the location selection button
        console.log(`ZEPTO: Setting location for ${location}...`);
        await page.waitForSelector('button[aria-label="Select Location"]', { timeout: 5000 });
        await page.click('button[aria-label="Select Location"]');

        // Wait for the location search input to appear
        await page.waitForSelector('input[placeholder="Search a new address"]', { timeout: 5000 });

        let inputSelector = 'input[placeholder="Search a new address"]';
        await page.waitForSelector(inputSelector, { timeout: 3000 });
        await page.click(inputSelector);
        await page.fill(inputSelector, location);

        // Click on the first suggestion using the address-search-container
        await page.waitForSelector('[data-testid="address-search-container"]', { timeout: 5000 });

        // Click the first child element directly
        await page.click('[data-testid="address-search-container"] > *:first-child');
        console.log("ZEPTO: Clicked first suggestion using data-testid selector");

        // Click the "Confirm & Continue" button on the map modal
        await page.waitForSelector('[data-testid="location-confirm-btn"]', { timeout: 5000 });
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

const getStoreId = async (location = "vertex corporate") => {
    const placeId = await getPlaceIdFromPlace(location);
    console.log("Zepto: got placeId", placeId);
    const { latitude, longitude } = await getLatitudeAndLongitudeFromPlaceId(placeId);
    console.log("Zepto: got latitude and longitude", latitude, longitude);
    const { isServiceable, storeId } = await checkLocationAvailabilityAndGetStoreId(latitude, longitude);
    console.log("Zepto: isServiceable", isServiceable, "storeId", storeId);
    if (!isServiceable) {
        throw AppError.badRequest("Location is not serviceable by Zepto");
    }
    if (!storeId) {
        throw AppError.badRequest("servicable but storeid not found");
    }
    return storeId;
};

const getPlaceIdFromPlace = async (place) => {
    try {
        if (placesData[place]) {
            return placesData[place];
        }
        const response = await axios.get(
            `https://api.zeptonow.com/api/v1/maps/place/autocomplete?place_name=${place}`,
            {
                headers: {
                    accept: "application/json, text/plain, */*",
                    "accept-language": "en-US,en;q=0.8",
                    "request-signature": "bbb6655ddcd3e7f751e75de9d78b9e8a3ae33be0797940725818b033b3e69094",
                },
            }
        );
        const placeId = response.data?.predictions[0]?.place_id;
        if (!placeId) {
            console.log("Zepto: response", response.data);
            throw AppError.badRequest("Zepto: Place not found");
        }
        placesData[place] = placeId;
        return placeId;
    } catch (error) {
        console.log("Zepto: error", error);
        throw AppError.badRequest("Zepto: Place not found");
    }
};

const getLatitudeAndLongitudeFromPlaceId = async (placeId) => {
    const response = await axios.get(`https://api.zeptonow.com/api/v1/maps/place/details?place_id=${placeId}`, {
        headers: {
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.8",
            "request-signature": "bbb6655ddcd3e7f751e75de9d78b9e8a3ae33be0797940725818b033b3e69094",
        },
    });
    const location = response.data?.result?.geometry?.location;
    if (!location) {
        console.log("Zepto: response", response.data);
        throw AppError.badRequest("Zepto: Location not found");
    }
    return { latitude: location?.lat, longitude: location?.lng };
};

const checkLocationAvailabilityAndGetStoreId = async (latitude, longitude) => {
    try {
        const response = await axios.get(`https://api.zeptonow.com/api/v1/get_page`, {
            params: {
                latitude,
                longitude,
                page_type: "HOME",
                version: "v2",
            },
            headers: {
                app_version: "24.10.5",
                platform: "WEB",
                "request-signature": "bbb6655ddcd3e7f751e75de9d78b9e8a3ae33be0797940725818b033b3e69094",
                compatible_components:
                    "CONVENIENCE_FEE,RAIN_FEE,EXTERNAL_COUPONS,STANDSTILL,BUNDLE,MULTI_SELLER_ENABLED,PIP_V1,ROLLUPS,SCHEDULED_DELIVERY,SAMPLING_ENABLED,ETA_NORMAL_WITH_149_DELIVERY,ETA_NORMAL_WITH_199_DELIVERY,HOMEPAGE_V2,NEW_ETA_BANNER,VERTICAL_FEED_PRODUCT_GRID,AUTOSUGGESTION_PAGE_ENABLED,AUTOSUGGESTION_PIP,AUTOSUGGESTION_AD_PIP,BOTTOM_NAV_FULL_ICON,COUPON_WIDGET_CART_REVAMP,DELIVERY_UPSELLING_WIDGET,MARKETPLACE_CATEGORY_GRID,NO_PLATFORM_CHECK_ENABLED_V2,SUPER_SAVER:1,SUPERSTORE_V1,PROMO_CASH:0,24X7_ENABLED_V1,TABBED_CAROUSEL_V2,HP_V4_FEED,WIDGET_BASED_ETA,NEW_FEE_STRUCTURE,NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,SUPERSTORE_V1,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,MARKETPLACE_REPLACEMENT,ZEPTO_PASS,ZEPTO_PASS:1,ZEPTO_PASS:2,ZEPTO_PASS_RENEWAL,CART_REDESIGN_ENABLED,SHIPMENT_WIDGETIZATION_ENABLED,TABBED_CAROUSEL_V2,24X7_ENABLED_V1,PROMO_CASH:0,HOMEPAGE_V2,SUPER_SAVER:1,NO_PLATFORM_CHECK_ENABLED_V2,HP_V4_FEED,GIFT_CARD,SCLP_ADD_MONEY,GIFTING_ENABLED,OFSE,WIDGET_BASED_ETA,NEW_ETA_BANNER,",
            },
        });

        if (!response.data) {
            throw AppError.badRequest("Failed to check location availability");
        }

        // Check if the location is serviceable
        const isServiceable = response.data?.storeServiceableResponse?.serviceable;
        const storeId = response.data?.storeServiceableResponse?.storeId;

        if (!isServiceable) {
            console.log("Zepto: response", response.data);
            throw AppError.badRequest("Location is not serviceable by Zepto");
        }
        if (!storeId) {
            console.log("Zepto: response", response.data);
            throw AppError.badRequest("servicable but storeid not found");
        }

        return { isServiceable, storeId };
    } catch (error) {
        console.error("Zepto: Error checking location availability:", error?.response?.data || error);
        if (error instanceof AppError) {
            throw error;
        }
        throw AppError.badRequest(`Failed to check location availability: ${error.message}`);
    }
};

export const getCategoriesHandler = async (req, res, next) => {
    try {
        const location = req.query.location || "vertex corporate";

        const categories = await fetchCategories(location);
        res.status(200).json(categories);
    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError("Failed to fetch categories"));
    }
};

const fetchCategories = async (location = "vertex corporate") => {
    try {
        // Fetch the sitemap XML
        const response = await axios.get('https://www.zeptonow.com/sitemap/categories/hyderabad.xml');

        // Parse the URLs from the XML content
        const unfilteredUrls = response.data.match(/https:\/\/www\.zeptonow\.com\/city\/[^<]+/g) || [];

        // Process URLs to extract categories and their subcategories
        const categoryMap = new Map();
        const unwantedCategories = ["women", "feminine", "girls", "jewellery", "kitchen", "purse", "decor", "hair-color",
             "fish", "kids", "boys", "toys", "unlisted", "books", "pet-care", "elderly", "cleaning-essentials", 
             "test-", "sample", "prescription-medicine", "bags-wallets", "dummy", "home-needs", "makeup", "home",
             "lips", "face", "eyes", "nail", "beauty", "gardening", "sexual-wellness", "bath-body", "zepto-cafe"]

        const urls = unfilteredUrls.filter(url => !unwantedCategories.some(category => url.includes(category)));

        urls.forEach(url => {
            const parts = url.split('/');

            // URL structure: /city/hyderabad/cn/category-name/subcategory-name/cid/category-id/scid/subcategory-id
            const categoryIndex = parts.indexOf('cn') + 1;
            const cidIndex = parts.indexOf('cid') + 1;
            const scidIndex = parts.indexOf('scid') + 1;

            if (categoryIndex > 0 && cidIndex > 0 && scidIndex > 0) {
                const categoryName = parts[categoryIndex].replace(/-/g, ' ');
                const subcategoryName = parts[categoryIndex + 1].replace(/-/g, ' ');
                const categoryId = parts[cidIndex];
                const subcategoryId = parts[scidIndex];

                // If this category doesn't exist yet, create it
                if (!categoryMap.has(categoryId)) {
                    categoryMap.set(categoryId, {
                        categoryId,
                        categoryName,
                        subcategories: []
                    });
                }

                // Add subcategory to the category
                const category = categoryMap.get(categoryId);
                if (!category.subcategories.some(subcategory => subcategory.subcategoryId === subcategoryId)) {
                    category.subcategories.push({
                        categoryId,
                        categoryName,
                        subcategoryId,
                        subcategoryName,
                        url: url
                    });
                }
            }
        });

        // Convert map to a clean object structure
        const categories = Array.from(categoryMap.values()).map(category => ({
            categoryId: category.categoryId,
            categoryName: category.categoryName,
            subcategories: Array.from(category.subcategories.values())
        }));

        console.log("Zepto: categories with subcategories", JSON.stringify(categories, null, 2));

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

        const allProducts = await searchAndExtractProducts(page, query, 3);

        // Sort by price
        allProducts.sort((a, b) => a.price - b.price);

        // Set headers for better browser compatibility
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Type': 'application/json'
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
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Type': 'application/json'
        });

        // Handle specific error types for better user experience
        if (error.message && error.message.includes("Location") && error.message.includes("not serviceable")) {
            return res.status(400).json({
                success: false,
                message: error.message,
                products: []
            });
        }

        next(error);
    } finally {
        if (page) await page.close();
    }
};

export const startTracking = async (_, res, next) => {
    try {
        const message = await startTrackingHelper();
        res.status(200).json({ message });
    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError("Failed to start price tracking"));
    }
};

// Function to search and extract products for a query on Zepto
const searchAndExtractProducts = async (page, query, maxPages = 3) => {
    try {
        console.log(`ZEPTO: Searching for "${query}"`);

        // Note: User agent should be set at context level in Playwright
        console.log(`ZEPTO: Searching for "${query}" (user agent should be set at context level)`);

        // Navigate to search page
        const searchUrl = `https://www.zeptonow.com/search?query=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

        // Wait for products to load or check if no results
        try {
            await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 });
            console.log(`ZEPTO: Products found for "${query}"`);
        } catch (error) {
            console.log(`ZEPTO: No products found for "${query}" - checking for no results message`);
            throw new Error(`No products found for "${query}"`);
        }

        await page.waitForTimeout(1000);

        // Scroll to load all products (infinite scroll)
        let previousProductCount = 0;
        let currentProductCount = 0;
        let scrollAttempts = 0;
        const MAX_SCROLL_ATTEMPTS = maxPages * 5; // Adjust based on maxPages

        console.log(`ZEPTO: Starting to scroll for "${query}"`);

        // Scroll until no spinner is visible or max attempts reached
        while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
            // Get current product count
            currentProductCount = await page.evaluate(() => {
                return document.querySelectorAll('[data-testid="product-card"]').length;
            });

            console.log(`ZEPTO: Found ${currentProductCount} products after ${scrollAttempts} scrolls for "${query}"`);

            // First scroll to the last available product card to trigger loading
            await page.evaluate(() => {
                const productCards = document.querySelectorAll('[data-testid="product-card"]');
                if (productCards.length > 0) {
                    const lastCard = productCards[productCards.length - 1];
                    lastCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });

            // Wait a bit for the scroll to trigger loading
            await page.waitForTimeout(1000);

            // Now check if spinner is visible (indicating more products to load)
            const { isSpinnerVisible } = await page.evaluate(() => {
                const spinner = document.querySelector('.animate-spin');
                return { isSpinnerVisible: !!spinner };
            });

            console.log("isSpinnerVisible", isSpinnerVisible);

            // If no spinner is visible and product count hasn't changed, we've reached the end
            if (!isSpinnerVisible && currentProductCount === previousProductCount && scrollAttempts > 0) {
                console.log(`ZEPTO: No more products to load for "${query}", stopping at ${currentProductCount} products`);
                break;
            }

            // Update previous count
            previousProductCount = currentProductCount;

            // If spinner is visible, scroll to it to continue loading
            if (isSpinnerVisible) {
                await page.evaluate(() => {
                    const spinner = document.querySelector('.animate-spin');
                    if (spinner) {
                        spinner.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }

            // Wait for new products to load
            await page.waitForTimeout(2000);

            scrollAttempts++;
        }

        // Extract product data using page.evaluate
        const products = await page.evaluate(() => {
            const productCards = Array.from(document.querySelectorAll('[data-testid="product-card"]'));

            return productCards.map(card => {
                try {
                    // Extract product URL and variant ID from href attribute
                    const href = card.getAttribute('href') || '';
                    const variantIdMatch = href.match(/\/pvid\/([\w-]+)/);
                    const variantId = variantIdMatch ? variantIdMatch[1] : '';

                    // Extract product name
                    const nameElement = card.querySelector('[data-testid="product-card-name"]');
                    const productName = nameElement ? nameElement.textContent.trim() : '';

                    // Extract weight/quantity
                    const weightElement = card.querySelector('[data-testid="product-card-quantity"]');
                    const weight = weightElement ? weightElement.textContent.trim() : '';

                    // Extract price information
                    const priceElement = card.querySelector('[data-testid="product-card-price"]');
                    let price = 0;
                    let mrp = 0;

                    if (priceElement) {
                        const priceText = priceElement.textContent.trim();
                        // Parse price from text like "₹51"
                        const priceMatch = priceText.match(/₹(\d+(?:\.\d+)?)/);
                        if (priceMatch) {
                            price = parseFloat(priceMatch[1]) || 0;
                        }
                    }

                    // Extract MRP (original price)
                    const priceContainer = card.querySelector('.flex.items-baseline.gap-1');
                    const mrpElement = priceContainer ? priceContainer.querySelector('.line-through') : null;

                    if (mrpElement) {
                        const mrpText = mrpElement.textContent.trim();
                        // Parse MRP from text like "₹65"
                        const mrpMatch = mrpText.match(/₹(\d+(?:\.\d+)?)/);
                        if (mrpMatch) {
                            mrp = parseFloat(mrpMatch[1]) || 0;
                        }
                    } else {
                        // If no MRP found, use price as MRP
                        mrp = price;
                    }

                    // Calculate discount percentage
                    let discount = 0;
                    if (mrp > price) {
                        discount = Math.round(((mrp - price) / mrp) * 100);
                    }

                    // Extract discount from discount tag if available
                    const discountTag = card.querySelector('.z-\\[100\\] p, .absolute.top-0 p');
                    if (discountTag) {
                        const discountText = discountTag.textContent.trim();
                        const discountMatch = discountText.match(/(\d+)%\s*Off/);
                        if (discountMatch) {
                            discount = parseInt(discountMatch[1], 10);
                        }
                    }

                    // Extract image URL
                    const imageElement = card.querySelector('[data-testid="product-card-image"]');
                    let imageUrl = imageElement ? imageElement.getAttribute('src') : '';

                    // Check if product is out of stock
                    const isOutOfStock = !card.textContent.toLowerCase().includes('add to cart');

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
                        discount: discount,
                        inStock: !isOutOfStock
                    };
                } catch (error) {
                    console.error('Error extracting product data:', error);
                    return null;
                }
            }).filter(product => product !== null && product.productId);
        });

        console.log(`ZEPTO: Successfully extracted ${products.length} products for "${query}"`);
        return products;
    } catch (error) {
        console.error(`ZEPTO: Error searching for "${query}":`, error);
        return [];
    }
};

const startTrackingHelper = async () => {
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
            const context = await setLocation("vertex corporate");
            if (!context) {
                throw new Error("ZEPTO: Failed to set location for Zepto");
            }

            console.log("Zepto: Starting new tracking cycle at:", new Date().toISOString());

            // Get all queries from productQueries
            const queries = [];
            Object.values(productQueries).forEach((category) => {
                Object.values(category).forEach((subcategory) => {
                    subcategory.forEach((query) => {
                        queries.push(query);
                    });
                });
            });

            console.log(`Zepto: Found ${queries.length} search queries to process`);

            let totalProcessedProducts = 0;
            const QUERY_CHUNK_SIZE = 1; // Process 2 queries concurrently

            // Process queries in chunks
            for (let i = 0; i < queries.length; i += QUERY_CHUNK_SIZE) {
                const queryChunk = queries.slice(i, i + QUERY_CHUNK_SIZE);
                console.log(
                    `Zepto: Processing chunk ${i / QUERY_CHUNK_SIZE + 1} of ${Math.ceil(
                        queries.length / QUERY_CHUNK_SIZE
                    )}`
                );

                // Create pages for this chunk
                const pages = await Promise.all(
                    queryChunk.map(async () => {
                        const page = await context.newPage();

                        // Note: User agent should be set at context level in Playwright
                        return page;
                    })
                );

                try {
                    // Run searches in parallel
                    const results = await Promise.all(
                        queryChunk.map(async (query, index) => {
                            console.log(`Zepto: Processing ${query}`);
                            try {
                                const products = await searchAndExtractProducts(pages[index], query, 3);

                                // Transform products to include category information
                                const transformedProducts = products.map((product) => ({
                                    ...product,
                                    categoryName: query, // Use query as category name
                                    subcategoryName: "", // No subcategory for search-based approach
                                    brand: "", // Not extracted from search results
                                }));

                                return transformedProducts; //  will remove this later

                                const result = await globalProcessProducts(transformedProducts, query, {
                                    model: ZeptoProduct,
                                    source: "Zepto",
                                    telegramNotification: true,
                                    emailNotification: false,
                                    significantDiscountThreshold: 10,
                                });
                                const processedCount = typeof result === "number" ? result : result.processedCount;
                                return processedCount;
                            } catch (error) {
                                console.error(`Zepto: Error processing ${query}:`, error);
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

            console.log(`Zepto: Completed search-based tracking. Processed ${totalProcessedProducts} products`);
        } catch (error) {
            console.error("Zepto: Failed to track prices:", error);
        } finally {
            console.log("Zepto: Tracking cycle completed at:", new Date().toISOString());
            // Add a delay before starting the next cycle
            await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes
        }
    }
};


