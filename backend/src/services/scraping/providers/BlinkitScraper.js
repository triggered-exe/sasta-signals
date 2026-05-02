import logger from "../../../utils/logger.js";
import contextManager from "../../../utils/contextManager.js";

/**
 * BlinkitScraper - Handles all Blinkit-specific scraping operations
 * 
 * Responsibilities:
 * - Location setup and serviceability checking
 * - Category extraction
 * - Product extraction via browser-side API calls
 * - Product parsing and normalization
 * - Cloudflare 403 handling with retry logic
 */
class BlinkitScraper {
    constructor() {
        this.baseURL = "https://blinkit.com";
    }

    /**
     * Set up location for Blinkit and verify serviceability
     * @param {string} location - Location/address to set up
     * @returns {Promise<Object>} Browser context
     */
    async setupLocation(location) {
        let page = null;
        try {
            const context = await contextManager.getContext(location);

            if (contextManager.getWebsiteServiceabilityStatus(location, "blinkit")) {
                logger.info(`BLINKIT: Using existing serviceable context for ${location}`);
                return context;
            }

            page = await contextManager.createPage(context, 'blinkit');

            await page.goto("https://blinkit.com", { waitUntil: "domcontentloaded" });

            await page.waitForSelector('input[placeholder="search delivery location"]', { timeout: 5000 });
            await page.click('input[placeholder="search delivery location"]');
            await page.fill('input[placeholder="search delivery location"]', location);

            await page.waitForSelector(".LocationSearchList__LocationListContainer-sc-93rfr7-0", { timeout: 5000 });
            await page.waitForTimeout(500);
            await page.click(".LocationSearchList__LocationListContainer-sc-93rfr7-0:first-child");
            await page.waitForTimeout(3000);

            const notServiceableElement = await page.$(".ns-exclamation");

            if (notServiceableElement) {
                const errorMessage = await page.evaluate(() => {
                    const msgElement = document.querySelector(".ns-location");
                    return msgElement ? msgElement.textContent.trim() : "Location is not serviceable";
                });

                contextManager.markServiceability(location, "blinkit", false);
                throw AppError.badRequest(`Location ${location} is not serviceable by Blinkit: ${errorMessage}`);
            }

            contextManager.markServiceability(location, "blinkit", true);
            logger.info(`BLINKIT: Successfully set up for location: ${location}`);
            await page.close();
            return context;
        } catch (error) {
            if (page) {
                try {
                    await page.close();
                } catch (cleanupError) {
                    logger.error(`BLINKIT: Error during cleanup for ${location}: ${cleanupError.message || cleanupError}`, { error: cleanupError });
                }
            }
            contextManager.markServiceability(location, "blinkit", false);
            logger.error(`BLINKIT: Error initializing context for ${location}: ${error.message || error}`, { error });
            throw error;
        }
    }

    /**
     * Fetch all categories from Blinkit
     * @param {Object} context - Browser context
     * @returns {Promise<Array>} Array of categories with subcategories
     */
    async fetchCategories(context) {
        let page = null;
        try {
            logger.info("BLINKIT: Fetching categories");
            page = await contextManager.createPage(context, 'blinkit');

            await page.goto("https://blinkit.com/categories", { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForSelector(".Category__Temp-sc-1k4awti-1", { timeout: 10000 });

            const { allCategories } = await page.evaluate(() => {
                const containers = document.querySelectorAll(".Category__Temp-sc-1k4awti-1");
                const allCategories = [];

                containers.forEach((container) => {
                    const parentCategoryName = container.previousElementSibling?.textContent.trim();
                    const subCategoriesLinks = container.querySelectorAll("a");
                    if (!parentCategoryName || !subCategoriesLinks) return;
                    
                    const subcategories = Array.from(subCategoriesLinks).map((a) => ({
                        name: a.textContent.trim(),
                        url: a.href,
                    }));
                    
                    allCategories.push({
                        parentCategoryName,
                        subcategories,
                    });
                });
                return { allCategories };
            });

            logger.info(`BLINKIT: Found ${allCategories.length} parent categories`);
            return allCategories;
        } catch (error) {
            logger.error(`BLINKIT: Error fetching categories: ${error.message || error}`, { error });
            return [];
        } finally {
            if (page) await page.close();
        }
    }

    /**
     * Extract products from a category using API calls instead of scrolling
     * @param {Object} page - Playwright page
     * @param {string} categoryUrl - Category URL to extract products from
     * @param {number} retryCount - Current retry count for 403 errors
     * @returns {Promise<Array>} Array of parsed products
     */
    async extractProducts(page, categoryUrl, retryCount = 0) {
        try {
            // Extract category IDs from the URL (no navigation needed - page already has cookies)
            const splitUrl = categoryUrl.split('/');
            const l0_cat = splitUrl[splitUrl.length - 2];
            const l1_cat = splitUrl[splitUrl.length - 1];

            if (!l0_cat || !l1_cat) {
                logger.error("BLINKIT: Could not extract category IDs from URL");
                return [];
            }

            // Use page.evaluate to make API calls from the browser context
            const result = await page.evaluate(async ({ l0_cat, l1_cat, baseURL }) => {
                const apiDomain = baseURL;
                const initialUrl = `${baseURL}/v1/layout/listing_widgets?l0_cat=${l0_cat}&l1_cat=${l1_cat}`;

                let allProducts = [];
                let nextUrl = initialUrl;
                let pageCounter = 1;
                let errors = [];

                // Fetch function with 429/403 handling
                const fetchData = async (url, options, fetchRetry = 0) => {
                    const MAX_RETRIES = 3;
                    const BASE_DELAY = 10000; // 10 seconds base delay

                    try {
                        const response = await fetch(url, { ...options, credentials: 'include' });

                        // Handle 429 (Too Many Requests) with exponential backoff
                        if (response.status === 429) {
                            if (fetchRetry < MAX_RETRIES) {
                                const delay = BASE_DELAY * Math.pow(2, fetchRetry);
                                console.log(`BLINKIT API: Rate limited (429). Retrying in ${delay / 1000}s (attempt ${fetchRetry + 1}/${MAX_RETRIES})`);
                                await new Promise(resolve => setTimeout(resolve, delay));
                                return await fetchData(url, options, fetchRetry + 1);
                            } else {
                                console.error(`BLINKIT API: Max retries (${MAX_RETRIES}) exceeded for 429 error`);
                                return null;
                            }
                        }

                        // 403 = Cloudflare bot protection triggered; signal outer code to reload page
                        if (response.status === 403) {
                            console.error('BLINKIT API: Got 403 Forbidden - Cloudflare protection triggered');
                            return { __forbidden: true };
                        }

                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }

                        return await response.json();
                    } catch (error) {
                        const errorInfo = {
                            url,
                            error: error.message,
                            timestamp: new Date().toISOString(),
                            fetchRetry
                        };
                        errors.push(errorInfo);
                        console.error(`BLINKIT API: Error fetching data from ${url}:`, error);
                        return null;
                    }
                };

                // Main loop to fetch all products using pagination
                while (nextUrl) {
                    console.log(`BLINKIT API: Fetching Page ${pageCounter}...`);
                    // The previous code is incorrect: document.cookie is a string, not an object. Must parse manually.
                    const lat = parseFloat(
                        document.cookie
                            .split('; ')
                            .find(row => row.startsWith('gr_1_lat='))
                            ?.split('=')[1]
                    );
                    const lon = parseFloat(
                        document.cookie
                            .split('; ')
                            .find(row => row.startsWith('gr_1_lon='))
                            ?.split('=')[1]
                    );
                    if (!lat || !lon) {
                        console.error("BLINKIT API: No latitude or longitude found in cookies");
                        return [];
                    }
                    const options = {
                        method: 'POST',
                        headers: {
                            'accept': 'application/json, text/plain, */*',
                            'accept-language': 'en-US,en;q=0.9',
                            'content-length': '0',
                            'referer': 'https://blinkit.com/categories',
                            'lat': String(lat),
                            'lon': String(lon),
                        },
                    };

                    const data = await fetchData(nextUrl, options);

                    // 403 = Cloudflare triggered; signal caller to reload page and retry
                    if (data && data.__forbidden) {
                        return { products: allProducts, errors, forbidden: true };
                    }

                    // Handle the response structure
                    if (data && data.response && data.response.snippets) {
                        // Extract products and append the l0 and l1 category IDs
                        const products = data.response.snippets.map(snippet => ({
                            ...snippet.data, // Copy all existing product data
                            l0_cat: l0_cat,  // Append the l0 category ID
                            l1_cat: l1_cat   // Append the l1 category ID
                        }));

                        if (products.length > 0) {
                            allProducts.push(...products);
                            console.log(`BLINKIT API: Page ${pageCounter}: Found ${products.length} products.`);
                        } else {
                            const errorInfo = {
                                url: nextUrl,
                                error: 'No products found in response',
                                timestamp: new Date().toISOString(),
                                pageCounter
                            };
                            errors.push(errorInfo);
                            console.log(`BLINKIT API: Page ${pageCounter}: No products found in this response.`);
                        }

                        // Check for the next URL to continue pagination
                        if (data?.response?.pagination?.next_url) {
                            nextUrl = apiDomain + data.response.pagination.next_url;
                            console.log(`BLINKIT API: Next page URL found, continuing...`);
                        } else {
                            console.log('BLINKIT API: Last page reached. No next_url found.');
                            nextUrl = null; // End the loop
                        }
                    } else {
                        const errorInfo = {
                            url: nextUrl,
                            error: 'Invalid response structure or no data',
                            timestamp: new Date().toISOString(),
                            pageCounter
                        };
                        errors.push(errorInfo);
                        console.log(`BLINKIT API: Page ${pageCounter}: Response structure was not as expected. Stopping.`);
                        nextUrl = null; // End the loop if the response is invalid
                    }

                    // Update for the next iteration
                    pageCounter++;

                    // Small delay to avoid overwhelming the server
                    if (nextUrl) {
                        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
                    }
                }

                console.log(`BLINKIT API: Total Pages Fetched: ${pageCounter - 1}`);
                console.log(`BLINKIT API: Total Products Fetched: ${allProducts.length}`);
                if (errors.length > 0) {
                    console.log(`BLINKIT API: Encountered ${errors.length} errors during fetching`);
                }
                return { products: allProducts, errors, forbidden: false };
            }, { l0_cat, l1_cat, baseURL: this.baseURL });

            // Handle 403: Cloudflare bot protection — reload the page to get a fresh session cookie and retry
            if (result.forbidden) {
                const MAX_403_RETRIES = 2;
                if (retryCount < MAX_403_RETRIES) {
                    logger.warn(`BLINKIT: 403 Forbidden for ${categoryUrl}, reloading page and retrying (attempt ${retryCount + 1}/${MAX_403_RETRIES})`);
                    await page.goto("https://blinkit.com/categories", { waitUntil: "networkidle", timeout: 15000 });
                    await page.waitForTimeout(3000);
                    return this.extractProducts(page, categoryUrl, retryCount + 1);
                } else {
                    logger.error(`BLINKIT: 403 Forbidden for ${categoryUrl} after ${MAX_403_RETRIES} retries, skipping`);
                    return [];
                }
            }

            // Extract products and errors from the result
            const { products: allProducts, errors } = result;

            // Log any errors that occurred during API calls
            if (errors && errors.length > 0) {
                logger.info(`BLINKIT: API errors encountered: ${errors.length}`);
                // errors.forEach((error, index) => {
                //     logger.error(`BLINKIT: API Error ${index + 1}:`, {
                //         url: error.url,
                //         error: error.error,
                //         timestamp: error.timestamp,
                //         retryCount: error.retryCount
                //     });
                // });
            }

            // Parse the raw API products into the format expected by the rest of the code
            const parsedProducts = this.parseProducts(allProducts);
            if (parsedProducts.length === 0) {
                logger.info("BLINKIT API: No products found in the API response");
                return [];
            }

            return parsedProducts;

        } catch (error) {
            logger.error(`BLINKIT: Error extracting products using API: ${error.message || error}`, { error });
            return [];
        }
    }

    /**
     * Function to parse all products including variants
     * @param {Array} rawProducts - Raw products from API
     * @returns {Array} Array of normalized products
     */
    parseProducts(rawProducts) {
        const parsedProducts = [];

        for (const productData of rawProducts) {
            try {
                // Parse the main product
                const mainProduct = this.parseSingleProduct(productData);
                if (mainProduct) {
                    parsedProducts.push(mainProduct);
                }

                // Handle variants if they exist
                if (productData.variant_list && Array.isArray(productData.variant_list)) {
                    for (const variantItem of productData.variant_list) {
                        if (variantItem.data) {
                            // Copy l0_cat and l1_cat to variant data
                            variantItem.data.l0_cat = productData.l0_cat;
                            variantItem.data.l1_cat = productData.l1_cat;

                            const variantProduct = this.parseSingleProduct(variantItem.data);
                            if (variantProduct) {
                                // Add variant-specific information
                                variantProduct.isVariant = true;
                                variantProduct.parentProductId = productData.identity?.id || productData.product_id;
                                variantProduct.parentGroupId = productData.group_id;
                                parsedProducts.push(variantProduct);
                            }
                        }
                    }
                }
            } catch (error) {
                logger.error(`BLINKIT: Error parsing product: ${error.message || error}`, { error });
                continue;
            }
        }

        logger.info(`BLINKIT: Successfully parsed ${parsedProducts.length} products (including variants) from ${rawProducts.length} raw products`);
        return parsedProducts;
    }

    /**
     * Function to parse a single product from API data
     * @param {Object} productData - Raw product data
     * @returns {Object|null} Normalized product or null if invalid
     */
    parseSingleProduct(productData) {
        try {
            // Extract basic product information
            const productId = productData.identity?.id || productData.product_id || "";
            const productName = productData.name?.text || productData.display_name?.text || "";
            const variant = productData.variant?.text || "";
            const imageUrl = productData.image?.url || "";
            const brand = productData.brand_name?.text || "";

            // Extract pricing information
            const price = this.parsePrice(productData.normal_price?.text);
            const mrp = this.parsePrice(productData.mrp?.text) || price;
            if (mrp <= 0 || price <= 0) {
                logger.info(`BLINKIT: Skipping product with invalid pricing - ID: ${productId}, Name: ${productName}, Price: ${price}, MRP: ${mrp}`);
                return null;
            }
            const discount = parseFloat((((mrp - price) / mrp) * 100).toFixed(2));

            // Extract stock information
            const inventory = productData.inventory || 0;
            const isSoldOut = productData.is_sold_out || false;
            const inStock = inventory > 0 && !isSoldOut;

            // Construct product URL
            const url = this.constructProductUrl(productId, productName);

            // Create the parsed product object
            const parsedProduct = {
                productId,
                productName,
                url,
                imageUrl,
                weight: variant,
                price,
                mrp,
                discount: discount,
                inStock,
                brand,
                l0_cat: productData.l0_cat,
                l1_cat: productData.l1_cat
            };

            // Validate required fields
            if (!parsedProduct.productId || !parsedProduct.productName) {
                logger.info(`BLINKIT: Skipping invalid product - ID: ${parsedProduct.productId}, Name: ${parsedProduct.productName}, Price: ${parsedProduct.price}`);
                return null;
            }

            return parsedProduct;
        } catch (error) {
            logger.error(`BLINKIT: Error parsing single product: ${error.message || error}`, { error });
            return null;
        }
    }

    /**
     * Helper function to parse price from text (e.g., "₹50" -> 50)
     * @param {string} priceText - Price text to parse
     * @returns {number} Parsed price
     */
    parsePrice(priceText) {
        if (!priceText) return 0;
        const priceMatch = priceText.match(/₹\s*([\d,]+(\.\d+)?)/);
        if (priceMatch && priceMatch[1]) {
            return parseFloat(priceMatch[1].replace(/,/g, ""));
        }
        return parseFloat(priceText.replace(/[^\d.]/g, "")) || 0;
    }

    /**
     * Helper function to construct product URL
     * @param {string} productId - Product ID
     * @param {string} productName - Product name
     * @returns {string} Constructed URL
     */
    constructProductUrl(productId, productName) {
        if (!productId || !productName) return "";
        const slugifiedName = productName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-");
        return `https://blinkit.com/prn/${slugifiedName}/prid/${productId}`;
    }

    /**
     * Search products on Blinkit
     * @param {Object} page - Playwright page
     * @param {string} query - Search query
     * @returns {Promise<Array>} Array of search results
     */
    async searchProducts(page, query) {
        try {
            logger.info(`BLINKIT: Searching for "${query}"`);
            // TODO: Implement search functionality
            return [];
        } catch (error) {
            logger.error(`BLINKIT: Error searching for "${query}": ${error.message || error}`, { error });
            return [];
        }
    }
}

export default new BlinkitScraper();
