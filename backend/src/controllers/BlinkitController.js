import { AppError } from "../utils/errorHandling.js";
import { BlinkitProduct } from "../models/BlinkitProduct.js";
import { PAGE_SIZE } from "../utils/constants.js";
import { isNightTimeIST, chunk, buildSortCriteria, buildMatchCriteria } from "../utils/priceTracking.js";
import contextManager from "../utils/contextManager.js";
import { productQueries } from "../utils/productQueries.js";
import { sendPriceDropNotifications } from "../services/NotificationService.js";

// Set location for Blinkit
const setLocation = async (location) => {
    let page = null;
    try {
        // Get or create context
        const context = await contextManager.getContext(location);

        // Return existing context if already set up and serviceable
        if (
            contextManager.isWebsiteSet(location, "blinkit") &&
            contextManager.isWebsiteServiceable(location, "blinkit")
        ) {
            console.log(`BLINKIT: Using existing serviceable context for ${location}`);
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
        await page.waitForTimeout(1000); // Wait for location to be set

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
        console.log(`BLINKIT: Successfully set up for location: ${location}`);
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
            console.error(`BLINKIT: Error during cleanup for ${location}:`, cleanupError);
        }

        console.error(`BLINKIT: Error initializing context for ${location}:`, error);
        throw error;
    }
};

export const getProducts = async (req, res, next) => {
    try {
        const {
            page = "1",
            pageSize = PAGE_SIZE.toString(),
            sortOrder = "price",
            priceDropped = "false",
            notUpdated = "false",
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const sortCriteria = buildSortCriteria(sortOrder);
        const matchCriteria = buildMatchCriteria(priceDropped, notUpdated);

        const totalProducts = await BlinkitProduct.countDocuments(matchCriteria);
        const products = await BlinkitProduct.aggregate([
            { $match: matchCriteria },
            { $sort: sortCriteria },
            { $skip: skip },
            { $limit: parseInt(pageSize) },
            {
                $project: {
                    productId: 1,
                    productName: 1,
                    price: 1,
                    mrp: 1,
                    discount: 1,
                    weight: 1,
                    brand: 1,
                    imageUrl: 1,
                    url: 1,
                    priceDroppedAt: 1,
                    categoryName: 1,
                    subcategoryName: 1,
                    inStock: 1,
                },
            },
        ]);

        res.status(200).json({
            data: products,
            totalPages: Math.ceil(totalProducts / parseInt(pageSize)),
            currentPage: parseInt(page),
            pageSize: parseInt(pageSize),
            total: totalProducts,
        });
    } catch (error) {
        next(error);
    }
};

// Function to extract products from current page
const extractProductsFromPage = async (page) => {
    return await page.evaluate(() => {
        const results = document.querySelectorAll(".product-card");
        console.log("BLINKIT: Found results:", results.length);

        return Array.from(results)
            .map((el) => {
                try {
                    // Get product title and URL
                    const titleEl = el.querySelector(".product-name");
                    const productLink = el.querySelector("a.product-link");

                    // Get price elements
                    const priceEl = el.querySelector(".actual-price");
                    const mrpEl = el.querySelector(".original-price");
                    const imageEl = el.querySelector(".product-image img");

                    // Extract product ID from URL or data attribute
                    const productId =
                        productLink?.getAttribute("data-product-id") ||
                        productLink?.href.split("/").pop() ||
                        `bk-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

                    // Extract numeric values with better error handling
                    const priceText = priceEl?.textContent.trim() || "";
                    const mrpText = mrpEl?.textContent.trim() || "";

                    // Improved price parsing
                    const parsePrice = (priceStr) => {
                        // Remove currency symbol and commas, then parse
                        const numStr = priceStr.replace(/[₹,]/g, "");
                        return parseFloat(numStr);
                    };

                    const price = parsePrice(priceText);
                    const mrp = parsePrice(mrpText) || price;

                    const data = {
                        productId,
                        productName: titleEl?.textContent.trim() || "",
                        url: productLink?.href ? productLink.href : "",
                        imageUrl: imageEl?.getAttribute("src") || "",
                        price,
                        mrp,
                        discount: mrp > price ? Math.floor(((mrp - price) / mrp) * 100) : 0,
                        inStock: !el.querySelector(".out-of-stock"),
                    };

                    // Validate the data
                    if (isNaN(data.price) || data.price <= 0) {
                        console.log("BLINKIT: Invalid price for product:", data.productName);
                        return null;
                    }

                    return data;
                } catch (err) {
                    console.error("BLINKIT: Error extracting product:", err);
                    return null;
                }
            })
            .filter((product) => product && product.productId && product.productName && product.price > 0);
    });
};

// Function to get next page URL
const getNextPageUrl = async (page) => {
    const nextPageButton = await page.$(".pagination .next");
    if (nextPageButton) {
        return await page.evaluate((button) => button.href, nextPageButton);
    }
    return null;
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
        if (!contextManager.isWebsiteServiceable(location, "blinkit")) {
            throw AppError.badRequest(`Location ${location} is not serviceable by Blinkit`);
        }

        page = await context.newPage();

        const allProducts = await searchAndExtractProducts(page, query, 3);

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
        console.error("BLINKIT: Blinkit error:", error);
        next(error);
    } finally {
        if (page) await page.close();
    }
};

// Function to search and extract products for a query
const searchAndExtractProducts = async (page, query, maxPages = 10) => {
    try {
        console.log(`BLINKIT: Searching for "${query}"`);

        // Navigate to search page
        const searchUrl = `https://blinkit.com/search?q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

        // Wait for products
        await page.waitForSelector(".product-card", { timeout: 5000 });

        let allProducts = [];
        let hasNextPage = true;
        let currentPage = 1;
        const MAX_PAGES = maxPages || 10; // Default to 10 if not set

        while (hasNextPage && currentPage <= MAX_PAGES) {
            // Extract products from current page
            const products = await extractProductsFromPage(page);

            allProducts = allProducts.concat(products);
            console.log(`BLINKIT: Found ${products.length} products on page ${currentPage} for ${query}`);

            // Check for next page
            const nextPageUrl = await getNextPageUrl(page);
            if (nextPageUrl && currentPage < MAX_PAGES) {
                await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });
                await page.waitForSelector(".product-card", { timeout: 5000 });
                currentPage++;
            } else {
                hasNextPage = false;
            }
        }
        const uniqueProducts = Array.from(new Map(allProducts.map((item) => [item.productId, item])).values());
        console.log(
            `BLINKIT: Found ${uniqueProducts.length} unique products out of ${allProducts.length} for ${query}`
        );
        return uniqueProducts;
    } catch (error) {
        console.error(`BLINKIT: Error searching for "${query}":`, error);
        return [];
    }
};

// Function to process and store products
const processProducts = async (products, categoryName) => {
    try {
        const bulkOps = [];
        const droppedProducts = [];
        const now = new Date();

        // Get existing products for price comparison
        const productIds = products.filter((p) => p.inStock).map((p) => p.productId);

        const existingProducts = await BlinkitProduct.find({
            productId: { $in: productIds },
        }).lean();

        const existingProductsMap = new Map(existingProducts.map((p) => [p.productId, p]));

        // Process each product
        for (const product of products) {
            const existingProduct = existingProductsMap.get(product.productId);

            // Make sure subcategoryName is retained if provided in the product
            const subcategoryName = product.subcategoryName || "";

            const productData = {
                ...product,
                productId: product.productId,
                productName: product.productName,
                categoryName: categoryName,
                subcategoryName: subcategoryName,
                inStock: product.inStock,
                mrp: product.mrp,
                price: product.price,
                discount: product.discount,
                imageUrl: product.imageUrl,
                url: product.url,
                updatedAt: now,
            };

            if (existingProduct) {
                if (existingProduct.price === product.price && product.inStock === existingProduct.inStock) {
                    continue; // Skip if price hasn't changed
                }

                // Update price history if price has changed
                productData.previousPrice = existingProduct.price;
                const currentDiscount = productData.discount;
                const previousDiscount = existingProduct.discount || 0;

                if (existingProduct.price > product.price) {
                    productData.priceDroppedAt = now;

                    // Check if discount increased significantly
                    if (currentDiscount - previousDiscount >= 10) {
                        droppedProducts.push({
                            ...productData,
                            previousPrice: existingProduct.price,
                            previousDiscount: previousDiscount,
                        });
                    }
                } else {
                    // Retain previous priceDroppedAt if exists
                    if (existingProduct.priceDroppedAt) {
                        productData.priceDroppedAt = existingProduct.priceDroppedAt;
                    }
                }
            } else {
                // For new products, set initial priceDroppedAt
                productData.priceDroppedAt = now;
            }

            bulkOps.push({
                updateOne: {
                    filter: { productId: product.productId },
                    update: { $set: productData },
                    upsert: true,
                },
            });
        }

        // Send notifications for price drops
        if (droppedProducts.length > 0) {
            console.log(`BLINKIT: Found ${droppedProducts.length} dropped products from ${categoryName}`);
            try {
                await sendPriceDropNotifications(droppedProducts, "Blinkit");
            } catch (error) {
                console.error("BLINKIT: Error sending notification:", error);
            }
        }

        // Perform bulk write operation
        if (bulkOps.length > 0) {
            await BlinkitProduct.bulkWrite(bulkOps, { ordered: false });
            console.log(`BLINKIT: Updated ${bulkOps.length} products from ${categoryName}`);
        }

        return bulkOps.length;
    } catch (error) {
        console.error("BLINKIT: Error processing products:", error);
        throw error;
    }
};

let isTrackingActive = false;

export const startTracking = async (req, res, next) => {
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
        console.log("BLINKIT: Fetching categories");
        page = await context.newPage();

        await page.goto("https://blinkit.com/categories", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForSelector(".Category__Temp-sc-1k4awti-1", { timeout: 10000 });

        const { allCategories: categories, debugData } = await page.evaluate(() => {
            const containers = document.querySelectorAll(".Category__Temp-sc-1k4awti-1");
            const allCategories = [];
            const debugData = [];
            containers.forEach((container) => {
                const parentCategoryName = container.previousElementSibling?.textContent.trim();
                const subCategoriesLinks = container.querySelectorAll("a");
                debugData.push({ parentCategoryName, subCategoriesLinks });
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
            return { allCategories, debugData };
        });
        // console.log("categories", categories)
        // console.log("debugData", debugData)

        console.log(`BLINKIT: Found ${categories.length} parent categories`);
        return categories;
    } catch (error) {
        console.error("BLINKIT: Error fetching categories:", error);
        return [];
    } finally {
        if (page) await page.close();
    }
};

export const startTrackingHandler = async (location = "bahadurpura police station") => {
    // Prevent multiple tracking instances
    if (isTrackingActive) {
        console.log("BLINKIT: Tracking is already active");
        return "Tracking is already active";
    }

    isTrackingActive = true;

    // Run this in a separate thread/process to not block
    (async () => {
        while (true) {
            // Skip if it's night time (12 AM to 6 AM IST)
            if (isNightTimeIST()) {
                console.log("BLINKIT: Skipping price tracking during night hours");
                // Wait for 5 minutes before checking night time status again
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            try {
                //   We need to set the browser context for the location or the location query
                const context = await setLocation(location);
                if (!context) {
                    throw new Error("BLINKIT: Failed to set location for Blinkit", location);
                }

                // Check if the location is serviceable
                if (!contextManager.isWebsiteServiceable(location, "blinkit")) {
                    console.log(`BLINKIT: Location ${location} is not serviceable, skipping tracking`);
                    // Wait for 30 minutes before trying again
                    await new Promise((resolve) => setTimeout(resolve, 30 * 60 * 1000));
                    continue;
                }

                const startTime = new Date();
                console.log("BLINKIT: Starting product search at:", startTime.toLocaleString());

                // Fetch all categories and subcategories
                const allCategories = await fetchCategories(context);
                if (allCategories.length === 0) {
                    console.log("BLINKIT: No categories found, retrying in 5 minutes");
                    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                    continue;
                }

                // Filter out parent categories and only process subcategories with valid URLs
                const subcategories = allCategories.filter((cat) => cat.url);
                console.log(`BLINKIT: Processing ${subcategories.length} subcategories`);

                // Process subcategories in parallel batches
                const CONCURRENT_SEARCHES = 2;
                let totalProcessedProducts = 0;

                // Process categories in parallel batches
                const categoryBatches = chunk(subcategories, CONCURRENT_SEARCHES);

                for (const [batchIndex, batch] of categoryBatches.entries()) {
                    console.log(`BLINKIT: Processing batch ${batchIndex + 1}/${categoryBatches.length}`);

                    const pages = await Promise.all(batch.map(() => context.newPage()));

                    try {
                        // Run subcategory processing in parallel
                        const results = await Promise.all(
                            batch.map(async (subcategory, index) => {
                                console.log(`BLINKIT: Processing ${subcategory.name} (${subcategory.parentCategory})`);
                                try {
                                    // Navigate to subcategory page
                                    await pages[index].goto(subcategory.url, {
                                        waitUntil: "domcontentloaded",
                                        timeout: 20000,
                                    });

                                    // Wait for products to load
                                    try {
                                        await pages[index].waitForSelector(".product-card", { timeout: 8000 });
                                    } catch (timeoutError) {
                                        console.log(`BLINKIT: No products found for ${subcategory.name}`);
                                        return 0;
                                    }

                                    // Extract products from this subcategory
                                    const products = await extractProductsFromPage(pages[index]);

                                    if (products.length === 0) {
                                        console.log(`BLINKIT: No valid products found for ${subcategory.name}`);
                                        return 0;
                                    }

                                    // Process and store products with category and subcategory names
                                    const processedProducts = products.map((product) => ({
                                        ...product,
                                        categoryName: subcategory.parentCategory,
                                        subcategoryName: subcategory.name,
                                    }));

                                    // Process products
                                    const processedCount = await processProducts(
                                        processedProducts,
                                        subcategory.parentCategory
                                    );
                                    console.log(
                                        `BLINKIT: Processed ${processedCount} products for ${subcategory.name}`
                                    );

                                    return processedCount;
                                } catch (error) {
                                    console.error(`BLINKIT: Error processing ${subcategory.name}:`, error);
                                    return 0;
                                }
                            })
                        );

                        const batchProcessed = results.reduce((a, b) => a + b, 0);
                        totalProcessedProducts += batchProcessed;
                        console.log(`BLINKIT: Batch ${batchIndex + 1} completed. Processed ${batchProcessed} products`);
                    } finally {
                        // Close pages after each batch
                        await Promise.all(pages.map((page) => page.close()));
                    }

                    // Add delay between batches
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                }

                const totalDuration = (Date.now() - startTime) / 1000 / 60; // in minutes
                console.log(
                    `BLINKIT: Completed crawling. Processed ${totalProcessedProducts} products in ${totalDuration.toFixed(
                        2
                    )} minutes`
                );

                // Wait for 60 minutes before next iteration (full catalog crawl is heavy)
                console.log("BLINKIT: Waiting 60 minutes before next crawl cycle");
                await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
            } catch (error) {
                console.error("BLINKIT: Error in tracking handler:", error);
                // Wait for 5 minutes before retrying
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
            }
        }
    })();

    return "Blinkit price tracking started successfully";
};
