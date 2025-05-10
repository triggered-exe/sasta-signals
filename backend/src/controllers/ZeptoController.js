import { AppError } from "../utils/errorHandling.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import axios from "axios";
import { ZeptoProduct } from "../models/ZeptoProduct.js";
import { HALF_HOUR } from "../utils/constants.js";
import { sendPriceDropNotifications } from "../services/NotificationService.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";

// Global variables
let isTrackingActive = false;
const placesData = {};

const CATEGORY_CHUNK_SIZE = 2;

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
        // Return cached data if available
        if (placesData[location] && placesData[location].categories) {
            return placesData[location].categories;
        }

        // Step1: Get the storeId
        const storeId = await getStoreId(location);
        const { latitude, longitude } = placesData[location] || { latitude: 17.4561171, longitude: 78.3757135 };

        // Fetch categories from API
        const response = await axios.get("https://api.zeptonow.com/api/v2/get_page", {
            params: {
                page_size: 10,
                latitude,
                longitude,
                page_type: "PAGE_IN_PAGE",
                version: "v1",
                layout_id: 9277,
                scope: "pip",
            },
            headers: {
                accept: "application/json, text/plain, */*",
                "accept-language": "en-US,en;q=0.7",
                app_sub_platform: "WEB",
                app_version: "12.64.7",
                appversion: "12.64.7",
                auth_revamp_flow: "v2",
                compatible_components:
                    ",NEW_FEE_STRUCTURE,NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,SUPERSTORE_V1,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,MARKETPLACE_REPLACEMENT,ZEPTO_PASS,ZEPTO_PASS:1,ZEPTO_PASS:2,ZEPTO_PASS_RENEWAL,CART_REDESIGN_ENABLED,SHIPMENT_WIDGETIZATION_ENABLED,TABBED_CAROUSEL_V2,24X7_ENABLED_V1,PROMO_CASH:0,HOMEPAGE_V2,SUPER_SAVER:1,NO_PLATFORM_CHECK_ENABLED_V2,HP_V4_FEED,GIFT_CARD,SCLP_ADD_MONEY,GIFTING_ENABLED,OFSE,WIDGET_BASED_ETA,NEW_ETA_BANNER,",
                device_id: "43947ad0-3a84-4ba2-9542-e0d2cf84659a",
                deviceid: "43947ad0-3a84-4ba2-9542-e0d2cf84659a",
                marketplace_type: "ZEPTO_NOW",
                platform: "WEB",
                "request-signature": "750446e0e26bdc566c76f67e3fc73286a36dbffaa16c114ba106a55a9c681ff3",
                request_id: `${Math.random().toString(36).substring(2, 15)}-${Math.random()
                    .toString(36)
                    .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}-${Math.random()
                        .toString(36)
                        .substring(2, 15)}`,
                session_id: `${Math.random().toString(36).substring(2, 15)}-${Math.random()
                    .toString(36)
                    .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}-${Math.random()
                        .toString(36)
                        .substring(2, 15)}`,
                sessionid: `${Math.random().toString(36).substring(2, 15)}-${Math.random()
                    .toString(36)
                    .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}-${Math.random()
                        .toString(36)
                        .substring(2, 15)}`,
                store_id: storeId,
                storeid: storeId,
            },
        });

        if (!response.data) {
            throw AppError.badRequest("Failed to fetch categories");
        }

        // Process the data from the API response
        const widgets = response.data?.pageLayout?.widgets || [];
        const categoryWidgets = widgets.filter((widget) => widget.campaignName === "Category grid");

        if (!categoryWidgets.length) {
            console.log("Zepto: No category widgets found in response");
            return [];
        }

        // Create flat array of categories
        const categories = [];
        const processedCategoryIds = new Set();

        for (const widget of categoryWidgets) {
            const items = widget.data?.items || [];
            for (const item of items) {
                if (!item.availableSubcategories?.length) continue;

                // Get parent category from first subcategory
                const firstSubcat = item.availableSubcategories[0];
                const parentCategory = firstSubcat.category;

                if (!parentCategory?.id) continue;

                // Skip if already processed this category
                if (processedCategoryIds.has(parentCategory.id)) continue;
                processedCategoryIds.add(parentCategory.id);

                // Create category with subcategories
                // For the main category, we'll use the first subcategory's ID as the default subcategory
                const firstSubcatId = item.availableSubcategories[0]?.id;
                const categoryUrl = generateCategoryUrl(
                    parentCategory.name,
                    parentCategory.id,
                    item.availableSubcategories[0]?.name,
                    firstSubcatId
                );

                const category = {
                    id: parentCategory.id,
                    name: parentCategory.name,
                    image: parentCategory.image?.path ? `https://cdn.zeptonow.com/${parentCategory.image.path}` : "",
                    priority: parentCategory.priority || 0,
                    productCount: 0,
                    isActive: true,
                    url: categoryUrl, // Add the URL to the main category object
                    subCategories: item.availableSubcategories.map((subcat) => {
                        // Generate URL for each subcategory
                        const url = generateCategoryUrl(parentCategory.name, parentCategory.id, subcat.name, subcat.id);
                        return {
                            id: subcat.id,
                            name: subcat.name,
                            image: subcat.imageV2?.path ? `https://cdn.zeptonow.com/${subcat.imageV2.path}` : "",
                            priority: subcat.priority || 0,
                            unlisted: subcat.unlisted || false,
                            displaySecondaryImage: subcat.displaySecondaryImage || false,
                            url: url, // Add the URL to the subcategory object
                        };
                    }),
                };

                categories.push(category);
            }
        }

        console.log(`Zepto: Extracted ${categories.length} categories with their subcategories`);

        // Cache the results
        placesData[location] = {
            ...placesData[location],
            categories,
            storeId,
        };

        return categories;
    } catch (error) {
        console.error("Zepto: Error fetching categories:", error?.response?.data || error);
        throw AppError.internalError("Failed to fetch categories");
    }
};

export const startTracking = async (req, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError("Failed to start price tracking"));
    }
};

export const startTrackingHandler = async (location = "vertex corporate") => {
    console.log("Zepto: starting tracking");
    // Start the continuous tracking loop without awaiting it
    trackPrices().catch((error) => {
        console.error("Zepto: Failed in tracking loop:", error);
    });
    return "Zepto price tracking started";
};

const trackPrices = async (location = "vertex corporate") => {
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

            // Step1: Get the categories (now returns a flat array)
            let categories = await fetchCategories(location);

            console.log("Zepto: Starting to fetch products for all categories");

            const FILTERING_PARENT_CATEGORY_KEYWORDS = [
                "chicken",
                "meat",
                "makeup",
                "skincare",
                "hair",
                "bath",
                "cleaning",
                "stationery",
                "baby",
                "pet",
                "paan",
                "toys",
                "magazine",
                "books",
                "stores",
                "cards",
                "Cosmetics",
                "goods",
                "jewellery",
                "feminine",
                "home",
                "kitchen",
                "sexual wellness",
            ];

            const FILTERING_SUBCATEGORY_KEYWORDS = [
                "all",
                "top picks",
                "flower",
                "hydroponics",
                "sprouts",
                "gardening",
                "eggs",
                "vegan",
                "meat",
                "salami",
                "non veg",
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
                "girl",
                "kids",
                "baby",
                "handbag",
                "women",
            ];


            if (!categories || categories.length === 0) {
                console.log("Zepto: No categories found");
                continue;
            }

            // Filter out categories that contain any of the FILTERING_PARENT_CATEGORY_KEYWORDS
            categories = categories.filter(category => !FILTERING_PARENT_CATEGORY_KEYWORDS.some(keyword => category.name.toLowerCase().includes(keyword)));



            // Randomize the categories
            let subcategories = categories.flatMap((category) => category.subCategories.map(subcategory => ({
                ...subcategory,
                categoryName: category.name,
                categoryId: category.id,
                category // Add the full category object for reference
            })));

            // Filter out subcategories that contain any of the FILTERING_SUBCATEGORY_KEYWORDS
            subcategories = subcategories.filter(subcategory => !FILTERING_SUBCATEGORY_KEYWORDS.some(keyword => subcategory.name.toLowerCase().includes(keyword)));

            const randomizedSubcategories = [...subcategories].sort(() => Math.random() - 0.5);

            // Process categories in chunks
            for (let i = 0; i < randomizedSubcategories.length; i += CATEGORY_CHUNK_SIZE) {
                const chunk = randomizedSubcategories.slice(i, i + CATEGORY_CHUNK_SIZE);
                console.log(
                    `Zepto: Processing chunk ${i / CATEGORY_CHUNK_SIZE + 1} of ${Math.ceil(
                        randomizedSubcategories.length / CATEGORY_CHUNK_SIZE
                    )}`
                );

                // Process each subcategory in the chunk concurrently
                const processingPromises = chunk.map(async (subcategory) => {
                    // Skip unlisted subcategories
                    if (subcategory.unlisted) {
                        console.log(`Zepto: Skipping unlisted subcategory ${subcategory.name}`);
                        return;
                    }

                    console.log(
                        `Zepto: Processing subcategory ${subcategory.name} from category ${subcategory.categoryName}`
                    );

                    // Create a new page for this subcategory
                    const page = await context.newPage();

                    try {
                        // Extract products from the subcategory page
                        const products = await extractProductsFromPage(page, subcategory.category, subcategory);
                        if (products.length === 0) {
                            console.log(`Zepto: No products found for ${subcategory.name}, skipping`);
                            return;
                        }

                        // Process the products
                        const { processedCount } = await processProducts(products, subcategory.category, subcategory);
                        console.log(`Zepto: Processed ${processedCount} products from ${subcategory.name}`);
                    } catch (subcatError) {
                        console.error(`Zepto: Error processing subcategory ${subcategory.name}:`, subcatError);
                    } finally {
                        // Close the page when done with this subcategory
                        await page.close();
                    }
                });

                // Wait for all subcategories in the chunk to complete
                await Promise.all(processingPromises);
                console.log(`Zepto: Completed processing chunk ${i / CATEGORY_CHUNK_SIZE + 1}`);

                // Add a delay between chunks to avoid overwhelming the system
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }

            console.log("Zepto: Finished tracking prices for all categories");
        } catch (error) {
            console.error("Zepto: Failed to track prices:", error);
        } finally {
            console.log("Zepto: Tracking cycle completed at:", new Date().toISOString());
            // Add a small delay before starting the next cycle to prevent overwhelming the system
            await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
        }
    }
};

/**
 * Extracts products from a Zepto category or subcategory page with infinite scrolling
 * @param {Object} page - The Playwright page object
 * @param {Object} category - The category object
 * @param {Object} subcategory - The subcategory object
 * @returns {Promise<Array>} Array of extracted products
 */
const extractProductsFromPage = async (page, category, subcategory) => {
    try {
        console.log(`ZEPTO: Extracting products from ${subcategory.name} (${category.name})`);

        // Navigate to the subcategory URL
        await page.goto(subcategory.url, { waitUntil: "domcontentloaded", timeout: 30000 });

        // Wait for products to load
        await page
            .waitForSelector('[data-testid="product-card"]', { timeout: 10000 })
            .catch(() => {
                console.log(`ZEPTO: No products found for ${subcategory.name}`);
                return [];
            });

        await page.waitForTimeout(1000);

        // Scroll to load all products (infinite scroll)
        let previousProductCount = 0;
        let currentProductCount = 0;
        let scrollAttempts = 0;
        const MAX_SCROLL_ATTEMPTS = 15; // Maximum number of scroll attempts

        console.log(`ZEPTO: Starting to scroll for ${subcategory.name}`);
        // Spinner element selector
        const spinnerSelector = 'svg.animate-spin';

        // Scroll until no spinner is visible or max attempts reached
        while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
            // Get current product count
            currentProductCount = await page.evaluate(() => {
                return document.querySelectorAll('[data-testid="product-card"]').length;
            });

            console.log(`ZEPTO: Found ${currentProductCount} products after ${scrollAttempts} scrolls`);

            // Check if spinner is visible (indicating more products to load)
            const { spinner, isSpinnerVisible } = await page.evaluate(() => {
                const spinner = document.querySelector('.animate-spin');
                return { spinner, isSpinnerVisible: !!spinner };
            });

            // If spinner is visible, but new products didn't load, we need to scroll again
            if (isSpinnerVisible && currentProductCount === previousProductCount) {
                await page.evaluate(() => {
                    const spinner = document.querySelector('.animate-spin');
                    if (spinner) {
                        // Try different scrolling approaches to trigger loading
                        window.scrollTo(0, document.body.scrollHeight - 500);
                        setTimeout(() => {
                            spinner.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 300);
                    }
                });
            }

            // If no spinner is visible and product count hasn't changed, we've reached the end
            if (!isSpinnerVisible && currentProductCount === previousProductCount && scrollAttempts > 0) {
                console.log(`ZEPTO: No more products to load, stopping at ${currentProductCount} products`);
                break;
            }

            // Update previous count
            previousProductCount = currentProductCount;

            // Scroll the content-start container that holds the products
            await page.evaluate((spinnerSelector) => {
                const spinner = document.querySelector('.animate-spin');
                if (spinner) {
                    // Scroll the spinner into view to trigger loading more products
                    spinner.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });

            // Wait for new products to load
            await page.waitForTimeout(2000);

            scrollAttempts++;
        }

        // Now scroll back to the top to ensure all images are loaded
        await page.evaluate(() => {
            const container = document.querySelector('.content-start');
            if (container) {
                container.scrollTo(0, 0);
            }
        });

        await page.waitForTimeout(1000);

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
                    // Look for the element with line-through class that appears near the price
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
                    // Based on the example HTML, the discount tag has a specific structure
                    const discountTag = card.querySelector('.z-\\[100\\] p, .absolute.top-0 p');
                    if (discountTag) {
                        const discountText = discountTag.textContent.trim();
                        const discountMatch = discountText.match(/(\d+)%\s*Off/);
                        if (discountMatch) {
                            discount = parseInt(discountMatch[1], 10);
                        }
                    }

                    // Extract image URL - get the first image in the card
                    const imageElement = card.querySelector('[data-testid="product-card-image"]');
                    let imageUrl = imageElement.getAttribute('src');

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
            }).filter(product => product !== null);
        });

        console.log(`ZEPTO: Successfully extracted ${products.length} products from ${subcategory.name}`);
        return products;
    } catch (error) {
        console.error(`ZEPTO: Error extracting products from ${subcategory?.name}:`, error);
        return [];
    }
};

const processProducts = async (products, category, subcategory) => {
    try {
        // Transform the extracted products to the standard format expected by globalProcessProducts
        const transformedProducts = products
            .map((product) => {
                return {
                    productId: product.productId,
                    productName: product.productName,
                    categoryName: category.name,
                    subcategoryName: subcategory.name,
                    inStock: product.inStock,
                    imageUrl: product.imageUrl || "",
                    price: product.price,
                    mrp: product.mrp,
                    discount: product.discount || 0,
                    weight: product.weight || "",
                    brand: "",  // Not extracted from the page
                    url: product.url
                };
            });

        // Use the global processProducts function with Zepto-specific options
        const result = await globalProcessProducts(transformedProducts, category.name, {
            model: ZeptoProduct,
            source: "Zepto",
            telegramNotification: true,
            emailNotification: false,
            significantDiscountThreshold: 10,
        });

        const processedCount = typeof result === "number" ? result : 0;
        return { processedCount };
    } catch (error) {
        console.error("Zepto: Error processing products:", error);
        return { processedCount: 0 };
    }
};
