import { AppError } from "../utils/errorHandling.js";
import { BlinkitProduct } from "../models/BlinkitProduct.js";
import { isNightTimeIST, chunk } from "../utils/priceTracking.js";
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
        await page.waitForTimeout(2000); // Wait for location to be set

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

// Function to extract products from current page with scroll pagination
const extractProductsFromPage = async (page) => {
    // Initial setup to track product count
    let previousProductCount = 0;
    let currentProductCount = 0;
    let scrollAttempts = 0;
    const MAX_SCROLL_ATTEMPTS = 10; // Increased maximum scroll attempts to ensure we get all products
    const MAX_RATE_LIMIT_RETRIES = 2; // Maximum number of retries for rate limit errors
    let RATE_LIMIT_RETRIES = 0;

    // Scroll until no new products are loaded or max attempts reached
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
        // Wait for potential new products to load
        await page.waitForTimeout(3000);

        // Check if we hit a rate limit error
        const hasRateLimitError = await page.evaluate(() => {
            const errorElement = document.querySelector(".error-container-widget");
            return !!errorElement;
        });

        if (hasRateLimitError && RATE_LIMIT_RETRIES < MAX_RATE_LIMIT_RETRIES) {
            RATE_LIMIT_RETRIES++;
            console.log("BLINKIT: Rate limit detected, waiting for 60 seconds before continuing");
            // Wait for 1 minute before continuing
            await page.waitForTimeout(60 * 1000);

            // Try to click the "Try Again" button if it exists
            await page.evaluate(() => {
                const tryAgainButton = document.querySelector(".error-container-widget .button");
                if (tryAgainButton) {
                    tryAgainButton.click();
                }
            });

            // Additional wait after clicking try again
            await page.waitForTimeout(5000);

            // Reset the scroll attempt counter to try again
            previousProductCount = 0;
            continue;
        }

        // Get current product count
        currentProductCount = await page.evaluate(() => {
            const container = document.getElementById("plpContainer");
            if (!container) return 0;

            // Look for the grid container that holds all product cards
            // Target the parent container with grid layout
            let productGrid = container.querySelector(
                "#plpContainer > div.BffPlpFeedContainer__BlurredContainer-sc-12wcdtn-8.hZbapl > div"
            );
            return productGrid ? productGrid.children.length : 0;
        });

        // If no new products were loaded after scrolling, we've reached the end
        if (currentProductCount === previousProductCount && scrollAttempts > 0) {
            break;
        }

        // Update previous count and scroll down
        previousProductCount = currentProductCount;

        // Scroll to the bottom of the container
        await page.evaluate(() => {
            const container = document.getElementById("plpContainer");
            if (container) {
                // Check if its is scrollable
                if (container.scrollHeight <= container.clientHeight) {
                    return;
                }
                container.scrollTop = container.scrollHeight;
            }
        });

        scrollAttempts++;
    }

    console.log(`BLINKIT: Found ${currentProductCount} products after ${scrollAttempts} scrolls`);

    // Check one more time for rate limiting before extraction
    const finalRateLimitCheck = await page.evaluate(() => {
        const errorElement = document.querySelector(".error-container-widget");
        return !!errorElement;
    });

    if (finalRateLimitCheck) {
        console.log("BLINKIT: Rate limit detected before extraction, waiting for 60 seconds");
        await page.waitForTimeout(60 * 1000);

        // Try to click the "Try Again" button
        await page.evaluate(() => {
            const tryAgainButton = document.querySelector(".error-container-widget .button");
            if (tryAgainButton) {
                tryAgainButton.click();
            }
        });

        // Wait for page to refresh
        await page.waitForTimeout(5000);
    }

    // Now slowly scroll back to the top to ensure all images are loaded
    await page.evaluate((totalProducts) => {
        return new Promise((resolve) => {
            const container = document.getElementById("plpContainer");
            if (!container) {
                resolve();
                return;
            }

            // Calculate number of steps based on product count (12 products visible per screen)
            const productsPerScreen = 12;
            const estimatedScreens = Math.ceil(totalProducts / productsPerScreen);
            const steps = Math.max(estimatedScreens, 2); // At least 5 steps for smooth scrolling

            console.log(`Scrolling with ${steps} steps for ${totalProducts} products`);

            const totalHeight = container.scrollHeight;
            const viewportHeight = container.clientHeight;
            let currentPosition = container.scrollTop;

            const scrollStep = currentPosition / steps;

            function smoothScrollUp() {
                if (currentPosition <= 0) {
                    resolve();
                    return;
                }

                currentPosition = Math.max(currentPosition - scrollStep, 0);
                container.scrollTop = currentPosition;

                // Pause at each step to let images load
                setTimeout(smoothScrollUp, 500); // Increased timeout for better image loading
            }

            smoothScrollUp();
        });
    }, currentProductCount); // Pass the total product count to the evaluate function

    // Extract all products after scrolling
    return await page.evaluate(() => {
        // Check for rate limit error
        const errorElement = document.querySelector(".error-container-widget");
        if (errorElement) {
            console.log("BLINKIT: Rate limit error still present during extraction");
            return [];
        }

        // Get the plpContainer
        const container = document.getElementById("plpContainer");
        if (!container) {
            console.log("BLINKIT: No plpContainer found, cannot extract products");
            return [];
        }

        // Try to find the grid container first
        let productGrid = container.querySelector(
            "#plpContainer > div.BffPlpFeedContainer__BlurredContainer-sc-12wcdtn-8.hZbapl > div"
        );
        if (!productGrid) {
            // Fallback to any grid container
            productGrid = container.querySelector('div[style*="display: grid"]');
        }

        let results = [];

        if (productGrid) {
            results = Array.from(productGrid.children);
        }

        return Array.from(results)
            .map((el) => {
                try {
                    // Get product ID from the element if available
                    const productId = el.querySelector('[tabindex="0"][role="button"]')?.id || el.id;
                    if (!productId) {
                        console.log("BLINKIT: Could not find product ID");
                        return null;
                    }

                    // Try to find the product name
                    let productName = "";
                    let titleEl = el.querySelector(".tw-font-semibold.tw-line-clamp-2");
                    if (titleEl) {
                        productName = titleEl.textContent.trim();
                    }

                    if (!productName) {
                        console.log("BLINKIT: Could not find product name");
                        return null;
                    }

                    // Construct the product URL using the product name and ID
                    const slugifiedName = productName
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
                        .replace(/\s+/g, "-"); // Replace spaces with hyphens

                    // Construct URL in format: https://blinkit.com/prn/{product-name}/prid/{product-id}
                    const url = `https://blinkit.com/prn/${slugifiedName}/prid/${productId}`;

                    // Find the product image
                    let imageUrl = "";
                    const imageEl = el.querySelector("img");
                    if (imageEl) {
                        imageUrl = imageEl.getAttribute("src") || "";
                    }

                    // Extract weight/unit information
                    let weight = "";
                    const weightEl = el.querySelector(".tw-text-200.tw-font-medium.tw-line-clamp-1");
                    if (weightEl) {
                        weight = weightEl.textContent.trim();
                    }

                    // Find price elements - try multiple selectors
                    let priceText = "";
                    let mrpText = "";

                    // Try new structure first
                    const priceEl = el.querySelector(
                        ".tw-font-semibold[style*='color: var(--colors-black-900)']:not(.tw-line-clamp-2)"
                    );
                    if (priceEl) {
                        priceText = priceEl.textContent.trim();
                    }

                    const mrpEl = el.querySelector(".tw-line-through");
                    if (mrpEl) {
                        mrpText = mrpEl.textContent.trim();
                    }

                    // Improved price parsing
                    const parsePrice = (priceStr) => {
                        if (!priceStr) return 0;
                        // Extract just the number with the ₹ symbol
                        const priceMatch = priceStr.match(/₹\s*([\d,]+(\.\d+)?)/);
                        if (priceMatch && priceMatch[1]) {
                            // Remove currency symbol and commas, then parse
                            const numStr = priceMatch[1].replace(/,/g, "");
                            return parseFloat(numStr);
                        }
                        // Fallback: just remove all non-numeric characters except decimal point
                        const numStr = priceStr.replace(/[^\d.]/g, "");
                        return parseFloat(numStr);
                    };

                    const price = parsePrice(priceText);
                    const mrp = parsePrice(mrpText) || price;

                    // Check if product is in stock
                    const isOutOfStock = el.textContent.toLowerCase().includes("out of stock");

                    const data = {
                        productId,
                        productName,
                        url,
                        imageUrl,
                        weight,
                        price,
                        mrp,
                        discount: mrp > price ? Math.floor(((mrp - price) / mrp) * 100) : 0,
                        inStock: !isOutOfStock,
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
        console.error("BLINKIT: Blinkit error:", error);
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
        console.log(`BLINKIT: Searching for "${query}"`);

        // Navigate to search page
        return [];
    } catch (error) {
        console.error(`BLINKIT: Error searching for "${query}":`, error);
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
        console.log("BLINKIT: Fetching categories");
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

    // Start tracking in background
    (async () => {
        while (true) {
            // Skip if it's night time (12 AM to 6 AM IST)
            if (isNightTimeIST()) {
                console.log("BLINKIT: Skipping price tracking during night hours");
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
                if (!contextManager.isWebsiteServiceable(location, "blinkit")) {
                    console.log(`BLINKIT: Location ${location} is not serviceable, stopping tracking`);
                    break;
                }

                const startTime = new Date();
                console.log("BLINKIT: Starting product search at:", startTime.toLocaleString());

                // Fetch all categories and subcategories
                let allCategories = await fetchCategories(context);
                if (allCategories.length === 0) {
                    console.log("BLINKIT: No categories found, retrying in 5 minutes");
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

                // Create batches for parallel processing
                const CONCURRENT_SEARCHES = 2;
                const categoryBatches = chunk(shuffledSubcategories, CONCURRENT_SEARCHES);

                console.log(
                    `BLINKIT: Processing ${subcategories.length} subcategories in ${categoryBatches.length} batches`
                );

                let totalProcessedProducts = 0;

                // Process each batch of subcategories
                for (const [batchIndex, batch] of categoryBatches.entries()) {
                    console.log(`BLINKIT: Processing batch ${batchIndex + 1}/${categoryBatches.length}`);

                    // Create browser pages for this batch
                    const pages = await Promise.all(
                        batch.map(() =>
                            context.newPage().catch((error) => {
                                console.error("BLINKIT: Error creating page:", error.message);
                                return null;
                            })
                        )
                    );

                    try {
                        // Process subcategories in parallel
                        const results = await Promise.all(
                            batch.map(async (subcategory, index) => {
                                const page = pages[index];
                                if (!page) return 0;

                                try {
                                    console.log(
                                        `BLINKIT: Processing subcategory: ${subcategory.name} - parent category: (${subcategory.parentCategory})`
                                    );

                                    // Navigate to subcategory page
                                    await page.goto(subcategory.url, {
                                        waitUntil: "domcontentloaded",
                                        timeout: 10000,
                                    });

                                    // Extract products
                                    const products = await extractProductsFromPage(page).catch((error) => {
                                        console.error(
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

                                    // Process andstore products
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
                                        console.error(
                                            `BLINKIT: Error saving products for ${subcategory.name}:`,
                                            error.message
                                        );
                                        return 0;
                                    });

                                    const processedCount = typeof result === "number" ? result : result.processedCount;
                                    return processedCount;
                                } catch (error) {
                                    console.error(`BLINKIT: Error processing ${subcategory.name}:`, error.message);
                                    return 0;
                                }
                            })
                        );

                        // Update total count
                        const batchProcessed = results.reduce((a, b) => a + b, 0);
                        totalProcessedProducts += batchProcessed;
                        // console.log(`BLINKIT: Batch ${batchIndex + 1} completed. Processed ${batchProcessed} products`);
                    } finally {
                        // Close all pages
                        await Promise.all(
                            pages.map((page) =>
                                page
                                    ? page
                                          .close()
                                          .catch((e) => console.error("BLINKIT: Error closing page:", e.message))
                                    : Promise.resolve()
                            )
                        );
                    }

                    // Short delay between batches
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }

                // Log completion and wait before next cycle
                const totalDuration = (Date.now() - startTime) / 1000 / 60;
                console.log(
                    `BLINKIT: Completed crawling. Processed ${totalProcessedProducts} products in ${totalDuration.toFixed(
                        2
                    )} minutes`
                );
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
            } catch (error) {
                console.error("BLINKIT: Error in tracking handler:", error);
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
            }
        }
    })();

    return "Blinkit price tracking started successfully";
};
