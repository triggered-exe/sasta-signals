import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandling.js";
import { BlinkitProduct } from "../models/BlinkitProduct.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";
import blinkitScraper from "../services/scraping/providers/BlinkitScraper.js";

let isTrackingActive = false;

export const startTrackingHandler = async (location = "bahadurpura police station") => {
    if (isTrackingActive) {
        logger.info("BLINKIT: Tracking is already active");
        return "Tracking is already active";
    }

    isTrackingActive = true;

    (async () => {
        while (true) {
            if (isNightTimeIST()) {
                logger.info("BLINKIT: Skipping price tracking during night hours");
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            try {
                const context = await blinkitScraper.setupLocation(location);

                const startTime = new Date();
                logger.info(`BLINKIT: Starting product search at: ${startTime.toLocaleString()}`);

                const categoriesStartTime = new Date();
                let allCategories = await blinkitScraper.fetchCategories(context);
                const categoriesFetchTime = ((new Date().getTime() - categoriesStartTime.getTime()) / 1000).toFixed(2);
                logger.info(`BLINKIT: Fetched ${allCategories.length} categories in ${categoriesFetchTime} seconds`);

                if (allCategories.length === 0) {
                    logger.info("BLINKIT: No categories found, retrying in 5 minutes");
                    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                    continue;
                }

                const FILTERING_PARENT_CATEGORY_KEYWORDS = [
                    "chicken", "Toys", "Baby", "Pet", "magazine", "books", "stores", "cards", "cleaning", "Cosmetics", "goods",
                ];

                const FILTERING_SUBCATEGORY_KEYWORDS = [
                    "eggs", "vegan", "flower", "Meat", "pesticide", "cosmetics", "women", "jewellery", "hair colour", "veggies",
                    "tea", "salt", "beauty", "toy", "games", "books", "clocks", "diy", "decor", "herbs", "stationary",
                    "fresh juice & dips", "cake", "conditioner", "serum", "hand & foot care", "mushroom", "diapers", "smoking", "wellness"
                ];

                allCategories = allCategories.filter((category) => {
                    const categoryName = category.parentCategoryName.toLowerCase();
                    return !FILTERING_PARENT_CATEGORY_KEYWORDS.some((keyword) =>
                        categoryName.includes(keyword.toLowerCase())
                    );
                });

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

                const shuffledSubcategories = [...subcategories].sort(() => Math.random() - 0.5);

                logger.info(`BLINKIT: Processing ${subcategories.length} subcategories sequentially with single page`);

                const page = await contextManager.createPage(context, 'blinkit');
                let processedCategoriesCount = 0;
                try {
                    await page.goto("https://blinkit.com/categories", { waitUntil: "networkidle", timeout: 10000 });
                    await page.waitForTimeout(1000);

                    for (const [subcategoryIndex, subcategory] of shuffledSubcategories.entries()) {
                        const subcategoryStartTime = new Date();
                        try {
                            logger.info(
                                `BLINKIT: Processing subcategory ${subcategoryIndex + 1}/${shuffledSubcategories.length}: ${subcategory.name} - parent category: (${subcategory.parentCategory})`
                            );

                            const products = await blinkitScraper.extractProducts(page, subcategory.url);
                            const extractedCount = Array.isArray(products) ? products.length : 0;

                            const enrichedProducts = products.map((product) => ({
                                ...product,
                                categoryName: subcategory.parentCategory,
                                subcategoryName: subcategory.name,
                            }));

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
                            );
                            const updatedCount = typeof result === "number" ? result : (result.processedCount ?? 0);
                            const subcategoryTime = ((new Date().getTime() - subcategoryStartTime.getTime()) / 1000).toFixed(2);
                        
                            // Increment processed count
                            processedCategoriesCount++;

                            // Calculate elapsed time since tracking started
                            const elapsedSinceStart = ((new Date().getTime() - startTime.getTime()) / 1000).toFixed(2);
                            const elapsedMinutes = (elapsedSinceStart / 60).toFixed(2);

                            // Log detailed progress after each category
                            logger.info(
                                `BLINKIT: ✅ Processed ${processedCategoriesCount}/${shuffledSubcategories.length} categories | `+
                                `Total elapsed: ${elapsedMinutes}m (${elapsedSinceStart}s) | `+
                                `Category time: ${subcategoryTime}s | `+
                                `"${subcategory.parentCategory} > ${subcategory.name}" - ${extractedCount} extracted, ${updatedCount} updated`
                            );
                        } catch (error) {
                            logger.error(`BLINKIT: Error processing ${subcategory.name}: ${error.message || error}`, { error });
                            continue;
                        }
                    }
                } finally {
                    await page.close().catch((e) => logger.error(`BLINKIT: Error closing page: ${e.message || e}`, { error: e }));
                }

                const endTime = new Date();
                const totalDuration = (endTime - startTime) / 1000 / 60;
                logger.info(`BLINKIT: Total time taken For tracking completion is: ${totalDuration.toFixed(2)} minutes`);
                await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
            } catch (error) {
                logger.error(`BLINKIT: Error in tracking handler: ${error.message || error}`, { error });
                await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
            }
        }
    })();

    return "Blinkit price tracking started successfully";
};

// ====================================
// Route Handlers Below
// =====================================


export const startTracking = async (_, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        next(error);
    }
};


// Search endpoint handler
export const searchQuery = async (req, res, next) => {
    let page = null;

    try {
        const { query, location } = req.body;

        if (!query || !location) {
            throw AppError.badRequest("Query and location are required");
        }

        const context = await blinkitScraper.setupLocation(location);

        if (!contextManager.getWebsiteServiceabilityStatus(location, "blinkit")) {
            throw AppError.badRequest(`Location ${location} is not serviceable by Blinkit`);
        }

        page = await contextManager.createPage(context, 'blinkit');
        const allProducts = await blinkitScraper.searchProducts(page, query);
        allProducts.sort((a, b) => a.price - b.price);

        res.status(200).json({
            success: true,
            products: allProducts,
            total: allProducts.length,
            totalPages: Math.ceil(allProducts.length / allProducts.length),
            processedPages: Math.ceil(allProducts.length / allProducts.length),
        });
    } catch (error) {
        logger.error(`BLINKIT: Blinkit error: ${error.message || error}`, { error });
        next(error);
    } finally {
        if (page) await page.close();
    }
};
