import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandling.js";
import { BlinkitProduct } from "../models/BlinkitProduct.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import contextManager from "../utils/contextManager.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";

// Set location for Blinkit
const setLocation = async (location) => {
    let page = null;
    try {
        // Get or create context
        const context = await contextManager.getContext(location);

        // Return existing context if already set up and serviceable
        if (
            contextManager.getWebsiteServiceabilityStatus(location, "blinkit")
        ) {
            logger.info(`BLINKIT: Using existing serviceable context for ${location}`);
            return context;
        }

        // Set up Blinkit for this context
        page = await context.newPage();

        // Navigate to homepage
        await page.goto("https://blinkit.com", { waitUntil: "domcontentloaded" });

        // Set delivery location
        await page.waitForSelector('input[placeholder="search delivery location"]', { timeout: 5000 });
        await page.click('input[placeholder="search delivery location"]');
        await page.fill('input[placeholder="search delivery location"]', location);

        // Wait for and select the first suggestion
        await page.waitForSelector(".LocationSearchList__LocationListContainer-sc-93rfr7-0", { timeout: 5000 });
        await page.waitForTimeout(500); // Brief delay for suggestions to load completely
        await page.click(".LocationSearchList__LocationListContainer-sc-93rfr7-0:first-child");
        await page.waitForTimeout(3000); // Wait for location to be set

        // Check if location was set successfully
        const notServiceableElement = await page.$(".ns-exclamation");

        if (notServiceableElement) {
            // Extract error message if available
            const errorMessage = await page.evaluate(() => {
                const msgElement = document.querySelector(".ns-location");
                return msgElement ? msgElement.textContent.trim() : "Location is not serviceable";
            });

            // Mark as not serviceable and clean up
            contextManager.markServiceability(location, "blinkit", false);

            throw AppError.badRequest(`Location ${location} is not serviceable by Blinkit: ${errorMessage}`);
        }

        // Location is serviceable - mark it as such
        contextManager.markServiceability(location, "blinkit", true);
        logger.info(`BLINKIT: Successfully set up for location: ${location}`);
        await page.close();
        return context;
    } catch (error) {
        // Mark location as not serviceable for any initialization errors too
        try {
            if (page) await page.close();
            // Mark as not serviceable and clean up
            contextManager.markServiceability(location, "blinkit", false);
        } catch (cleanupError) {
            // Don't let cleanup errors override the original error
            logger.error(`BLINKIT: Error during cleanup for ${location}:`, cleanupError);
        }

        logger.error(`BLINKIT: Error initializing context for ${location}:`, error);
        throw error;
    }
};

// Function to extract products using API calls instead of scrolling
const extractProductsFromPageAPI = async (page, categoryUrl) => {
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
        const result = await page.evaluate(async ({ l0_cat, l1_cat }) => {
            const apiDomain = 'https://blinkit.com';
            const initialUrl = `https://blinkit.com/v1/layout/listing_widgets?l0_cat=${l0_cat}&l1_cat=${l1_cat}`;

            let allProducts = [];
            let nextUrl = initialUrl;
            let pageCounter = 1;
            let errors = [];

            // Fetch function with 429 retry logic
            const fetchData = async (url, options, retryCount = 0) => {
                const MAX_RETRIES = 3;
                const BASE_DELAY = 10000; // 10 seconds base delay

                try {
                    const response = await fetch(url, { ...options, credentials: 'include' });

                    // Handle 429 (Too Many Requests) with exponential backoff
                    if (response.status === 429) {
                        if (retryCount < MAX_RETRIES) {
                            const delay = BASE_DELAY * Math.pow(2, retryCount); // Exponential backoff: 2s, 4s, 8s
                            console.log(`BLINKIT API: Rate limited (429). Retrying in ${delay / 1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})`);

                            await new Promise(resolve => setTimeout(resolve, delay));
                            return await fetchData(url, options, retryCount + 1);
                        } else {
                            console.error(`BLINKIT API: Max retries (${MAX_RETRIES}) exceeded for 429 error`);
                            return null;
                        }
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
                        retryCount
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
                        accept: '*/*',
                        lat: lat,
                        lon: lon,
                    },
                };

                const data = await fetchData(nextUrl, options);

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
            return { products: allProducts, errors };
        }, { l0_cat, l1_cat });

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
        const parsedProducts = parseBlinkitProducts(allProducts);
        if (parsedProducts.length === 0) {
            logger.info("BLINKIT API: No products found in the API response");
            return [];
        }

        return parsedProducts;

    } catch (error) {
        logger.error("BLINKIT: Error extracting products using API:", error);
        return [];
    }
};

// Helper function to parse price from text (e.g., "₹50" -> 50)
const parsePrice = (priceText) => {
    if (!priceText) return 0;
    const priceMatch = priceText.match(/₹\s*([\d,]+(\.\d+)?)/);
    if (priceMatch && priceMatch[1]) {
        return parseFloat(priceMatch[1].replace(/,/g, ""));
    }
    return parseFloat(priceText.replace(/[^\d.]/g, "")) || 0;
};

// Helper function to construct product URL
const constructProductUrl = (productId, productName) => {
    if (!productId || !productName) return "";
    const slugifiedName = productName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-");
    return `https://blinkit.com/prn/${slugifiedName}/prid/${productId}`;
};

// Function to parse a single product from API data
const parseSingleProduct = (productData) => {
    try {
        // Extract basic product information
        const productId = productData.identity?.id || productData.product_id || "";
        const productName = productData.name?.text || productData.display_name?.text || "";
        const variant = productData.variant?.text || "";
        const imageUrl = productData.image?.url || "";
        const brand = productData.brand_name?.text || "";

        // Extract pricing information
        const price = parsePrice(productData.normal_price?.text);
        const mrp = parsePrice(productData.mrp?.text) || price;
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
        const url = constructProductUrl(productId, productName);

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
        logger.error("BLINKIT: Error parsing single product:", error);
        return null;
    }
};

// Function to parse all products including variants
const parseBlinkitProducts = (rawProducts) => {
    const parsedProducts = [];

    for (const productData of rawProducts) {
        try {
            // Parse the main product
            const mainProduct = parseSingleProduct(productData);
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

                        const variantProduct = parseSingleProduct(variantItem.data);
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
            logger.error("BLINKIT: Error parsing product:", error);
            continue;
        }
    }

    logger.info(`BLINKIT: Successfully parsed ${parsedProducts.length} products (including variants) from ${rawProducts.length} raw products`);
    return parsedProducts;
};

// Search endpoint handler
export const searchQuery = async (req, res, next) => {
    let page = null;

    try {
        const { query, location } = req.body;

        if (!query || !location) {
            throw AppError.badRequest("Query and location are required");
        }

        // Get or create context for this location
        const context = await setLocation(location);

        // Check if the location is serviceable before proceeding
        if (!contextManager.getWebsiteServiceabilityStatus(location, "blinkit")) {
            throw AppError.badRequest(`Location ${location} is not serviceable by Blinkit`);
        }

        page = await context.newPage();

        const allProducts = await searchAndExtractProducts(page, query);

        // Sort by price
        allProducts.sort((a, b) => a.price - b.price);

        res.status(200).json({
            success: true,
            products: allProducts,
            total: allProducts.length,
            totalPages: Math.ceil(allProducts.length / allProducts.length),
            processedPages: Math.ceil(allProducts.length / allProducts.length),
        });
    } catch (error) {
        logger.error("BLINKIT: Blinkit error:", error);
        next(error);
    } finally {
        if (page) await page.close();
    }
};

// Function to search and extract products for a query
// This is a placeholder function, not currently used
// eslint-disable-next-line no-unused-vars
const searchAndExtractProducts = async (_, query) => {
    try {
        logger.info(`BLINKIT: Searching for "${query}"`);

        // Navigate to search page
        return [];
    } catch (error) {
        logger.error(`BLINKIT: Error searching for "${query}":`, error);
        return [];
    }
};

let isTrackingActive = false;

export const startTracking = async (_, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        next(error);
    }
};

// Function to fetch all categories from Blinkit
const fetchCategories = async (context) => {
    let page = null;
    try {
        logger.info("BLINKIT: Fetching categories");
        page = await context.newPage();

        await page.goto("https://blinkit.com/categories", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForSelector(".Category__Temp-sc-1k4awti-1", { timeout: 10000 });

        const { allCategories: categories } = await page.evaluate(() => {
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
        // logger.info("categories", categories)
        // logger.info("debugData", debugData)

        logger.info(`BLINKIT: Found ${categories.length} parent categories`);
        return categories;
    } catch (error) {
        logger.error("BLINKIT: Error fetching categories:", error);
        return [];
    } finally {
        if (page) await page.close();
    }
};

export const startTrackingHandler = async (location = "bahadurpura police station") => {
    // Prevent multiple tracking instances
    if (isTrackingActive) {
        logger.info("BLINKIT: Tracking is already active");
        return "Tracking is already active";
    }

    isTrackingActive = true;

    // Start tracking in background
    (async () => {
        while (true) {
            // Skip if it's night time (12 AM to 6 AM IST)
            if (isNightTimeIST()) {
                logger.info("BLINKIT: Skipping price tracking during night hours");
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            try {
                // Set up browser context with location
                const context = await setLocation(location);
                if (!context) {
                    throw new Error("BLINKIT: Failed to set location for Blinkit");
                }

                // Check if the location is serviceable
                if (!contextManager.getWebsiteServiceabilityStatus(location, "blinkit")) {
                    logger.info(`BLINKIT: Location ${location} is not serviceable, stopping tracking`);
                    break;
                }

                const startTime = new Date();
                logger.info("BLINKIT: Starting product search at:", startTime.toLocaleString());

                // Fetch all categories and subcategories
                const categoriesStartTime = new Date();
                let allCategories = await fetchCategories(context);
                const categoriesFetchTime = ((new Date().getTime() - categoriesStartTime.getTime()) / 1000).toFixed(2);
                logger.info(`BLINKIT: Fetched ${allCategories.length} categories in ${categoriesFetchTime} seconds`);

                if (allCategories.length === 0) {
                    logger.info("BLINKIT: No categories found, retrying in 5 minutes");
                    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                    continue;
                }

                const FILTERING_PARENT_CATEGORY_KEYWORDS = [
                    "chicken",
                    "Toys",
                    "Baby",
                    "Pet",
                    "magazine",
                    "books",
                    "eggs",
                    "stores",
                    "cards",
                    "cleaning",
                    "Cosmetics",
                    "goods",
                ];

                const FILTERING_SUBCATEGORY_KEYWORDS = [
                    "eggs",
                    "vegan",
                    "flower",
                    "Meat",
                    "pesticide",
                    "cosmetics",
                    "women",
                    "jewellery",
                    "hair colour",
                    "veggies",
                    "tea",
                    "salt",
                    "beauty",
                    "toy",
                    "games",
                    "books",
                    "clocks",
                    "diy",
                    "decor",
                    "herbs",
                    "stationary",
                    "fresh juice & dips",
                    "cake",
                    "conditioner",
                    "serum",
                    "hand & foot care",
                    "mushroom",
                    "diapers",
                    "smoking",
                    "wellness"
                ];

                // Update filtering logic to exclude categories that match keywords fully or partially
                allCategories = allCategories.filter((category) => {
                    const categoryName = category.parentCategoryName.toLowerCase();
                    // Check if any keyword is contained within the category name
                    return !FILTERING_PARENT_CATEGORY_KEYWORDS.some((keyword) =>
                        categoryName.includes(keyword.toLowerCase())
                    );
                });

                // Flatten and prepare subcategories for processing
                const subcategories = allCategories
                    .flatMap((category) =>
                        category.subcategories.map((subcategory) => ({
                            ...subcategory,
                            parentCategory: category.parentCategoryName,
                        }))
                    )
                    .filter((subcategory) => {
                        return (
                            subcategory.url &&
                            !FILTERING_SUBCATEGORY_KEYWORDS.some((keyword) =>
                                subcategory.name.toLowerCase().includes(keyword.toLowerCase())
                            )
                        );
                    });

                // Shuffle subcategories to distribute load
                const shuffledSubcategories = [...subcategories].sort(() => Math.random() - 0.5);

                logger.info(
                    `BLINKIT: Processing ${subcategories.length} subcategories sequentially with single page`
                );
                // Processing a single tracking cycle takes around 40 minutes
                // Create a single page for all API calls
                const page = await context.newPage();
                try {
                    // Navigate to categories page once to set up cookies
                    await page.goto("https://blinkit.com/categories", { waitUntil: "networkidle", timeout: 10000 });
                    await page.waitForTimeout(1000);

                    // Process all subcategories sequentially using the same page
                    for (const [subcategoryIndex, subcategory] of shuffledSubcategories.entries()) {
                        const subcategoryStartTime = new Date();
                        try {
                            logger.info(
                                `BLINKIT: Processing subcategory ${subcategoryIndex + 1}/${shuffledSubcategories.length}: ${subcategory.name} - parent category: (${subcategory.parentCategory})`
                            );

                            // Extract products using API with the same page
                            const products = await extractProductsFromPageAPI(page, subcategory.url).catch((error) => {
                                logger.error(
                                    `BLINKIT: Error extracting products for ${subcategory.name}:`,
                                    error.message
                                );
                                return [];
                            });

                            // Add category information to products
                            const enrichedProducts = products.map((product) => ({
                                ...product,
                                categoryName: subcategory.parentCategory,
                                subcategoryName: subcategory.name,
                            }));

                            // Process and store products
                            const result = await globalProcessProducts(
                                enrichedProducts,
                                subcategory.parentCategory,
                                {
                                    model: BlinkitProduct,
                                    source: "Blinkit",
                                    significantDiscountThreshold: 10,
                                    telegramNotification: true,
                                    emailNotification: false,
                                }
                            ).catch((error) => {
                                logger.error(
                                    `BLINKIT: Error saving products for ${subcategory.name}:`,
                                    error.message
                                );
                                return 0;
                            });

                            const processedCount = typeof result === "number" ? result : result.processedCount;

                            // Log subcategory processing time
                            const subcategoryTime = ((new Date().getTime() - subcategoryStartTime.getTime()) / 1000).toFixed(2);
                            logger.info(`BLINKIT: Processed ${processedCount} products for "${subcategory.parentCategory} > ${subcategory.name}" in ${subcategoryTime} seconds`);
                        } catch (error) {
                            logger.error(`BLINKIT: Error processing ${subcategory.name}:`, error.message);
                            continue; // Continue with next subcategory
                        }
                    }
                } finally {
                    // Close the single page
                    await page.close().catch((e) => logger.error("BLINKIT: Error closing page:", e.message));
                }

                // Log completion and wait before next cycle
                const endTime = new Date();
                const totalDuration = (endTime - startTime) / 1000 / 60;
                logger.info(`BLINKIT: Tracking completed in :  ${totalDuration.toFixed(2)} minutes`);
                await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000)); // Wait for 1 minute before next iteration
            } catch (error) {
                logger.error("BLINKIT: Error in tracking handler:", error);
                await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000)); // Wait for 1 minute before retrying
            }
        }
    })();

    return "Blinkit price tracking started successfully";
};
