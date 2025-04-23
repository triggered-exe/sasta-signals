import { AppError } from "../utils/errorHandling.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import axios from "axios";
import { ZeptoProduct } from "../models/ZeptoProduct.js";
import { HALF_HOUR } from "../utils/constants.js";
import { sendPriceDropNotifications } from "../services/NotificationService.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";

// Global variables
let isTrackingActive = false;
const placesData = {};

const CATEGORY_CHUNK_SIZE = 3;

export const searchProducts = async (req, res, next) => {
    try {
        const { query, place } = req.body;
        if (!query || !place) {
            throw AppError.badRequest("Query and place are required");
        }

        console.log("Zepto: query", query);
        console.log("Zepto: place", place);

        // Step1: Get the storeId from the place
        const storeId = await getStoreId(place);

        // Step2: Search for products
        const searchResults = await searchProductsFromZeptoHelper(query, storeId);
        console.log("Zepto: Found products:", searchResults.total);

        res.status(200).json(searchResults);
    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError(`Failed to fetch Zepto products: ${error}`));
    }
};

const getStoreId = async (placeName = "500081") => {
    const placeId = await getPlaceIdFromPlace(placeName);
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

const searchProductsFromZeptoHelper = async (query, storeId) => {
    try {
        let hasMore = true;
        let totalProducts = [];
        let pageNumber = 0;
        const deviceId = "0e8c2727-b821-4571-a2bf-939f4db01659";
        const sessionId = "486ff954-8379-4390-b08c-b47297ecdd22";
        const intentId = "91754206-304e-4352-9d51-d082da4a90fe";

        while (hasMore) {
            const searchResponse = await axios.post(
                "https://api.zeptonow.com/api/v3/search",
                {
                    query,
                    pageNumber,
                    intentId,
                    mode: "AUTOSUGGEST",
                },
                {
                    headers: {
                        accept: "application/json, text/plain, */*",
                        "accept-language": "en-US,en;q=0.8",
                        app_sub_platform: "WEB",
                        app_version: "24.10.5",
                        appversion: "24.10.5",
                        "content-type": "application/json",
                        device_id: deviceId,
                        deviceid: deviceId,
                        platform: "WEB",
                        "sec-ch-ua-mobile": "?1",
                        "sec-ch-ua-platform": '"Android"',
                        "sec-fetch-dest": "empty",
                        "sec-fetch-mode": "cors",
                        "sec-fetch-site": "same-site",
                        "sec-gpc": "1",
                        session_id: sessionId,
                        sessionid: sessionId,
                        storeid: storeId,
                    },
                }
            );

            if (!searchResponse.data) {
                throw AppError.badRequest("Failed to fetch search results");
            }

            // Process and format the search results
            if (searchResponse.data?.layout) {
                searchResponse.data.layout.forEach((layout) => {
                    if (layout.widgetId === "PRODUCT_GRID" && layout.data?.resolver?.data?.items) {
                        const products = layout.data.resolver.data.items.map((item) => {
                            const productData = item.productResponse;
                            const product = productData?.product;
                            const variant = productData?.productVariant;

                            return {
                                id: productData?.id,
                                name: product?.name,
                                brand: product?.brand,
                                description: product?.description?.[0] || "",
                                weight: variant?.formattedPacksize,
                                price: productData?.sellingPrice / 100, // Converting to rupees
                                mrp: productData.mrp / 100, // Converting to rupees
                                discount: productData.discountPercent,
                                image: variant.images?.[0]?.path
                                    ? `https://cdn.zeptonow.com/${variant.images[0].path}`
                                    : "",
                                inStock: !productData.outOfStock,
                                quantity: variant.quantity,
                                category: {
                                    main: productData.primaryCategoryName,
                                    sub: productData.primarySubcategoryName,
                                    leaf: productData.l3CategoriesDetail?.[0]?.name,
                                },
                                url: `https://www.zeptonow.com/pn/${product.name
                                    .toLowerCase()
                                    .replace(/\s+/g, "-")}/pvid/${variant.id}`,
                                attributes: variant.l4Attributes || {},
                            };
                        });
                        totalProducts = [...totalProducts, ...products];
                    }
                });
            }

            hasMore = !searchResponse.data?.hasReachedEnd;
            pageNumber++;

            // Add a small delay between requests to avoid rate limiting
            if (hasMore) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        return {
            products: totalProducts,
            total: totalProducts.length,
            currentPage: pageNumber,
            totalPages: Math.ceil(totalProducts.length / 28),
        };
    } catch (error) {
        console.error("Zepto: Error in searchProductsFromZeptoHelper:", error);
        throw error;
    }
};

export const getCategoriesHandler = async (req, res, next) => {
    try {
        const placeName = req.query.placeName || "500081";

        const categories = await fetchCategories(placeName);
        res.status(200).json(categories);
    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError("Failed to fetch categories"));
    }
};

const fetchCategories = async (placeName = "500081") => {
    try {
        // Return cached data if available
        if (placesData[placeName] && placesData[placeName].categories) {
            return placesData[placeName].categories;
        }

        // Step1: Get the storeId
        const storeId = await getStoreId(placeName);
        const { latitude, longitude } = placesData[placeName] || { latitude: 17.4561171, longitude: 78.3757135 };

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
                const category = {
                    id: parentCategory.id,
                    name: parentCategory.name,
                    image: parentCategory.image?.path ? `https://cdn.zeptonow.com/${parentCategory.image.path}` : "",
                    priority: parentCategory.priority || 0,
                    productCount: 0,
                    isActive: true,
                    subCategories: item.availableSubcategories.map((subcat) => ({
                        id: subcat.id,
                        name: subcat.name,
                        image: subcat.imageV2?.path ? `https://cdn.zeptonow.com/${subcat.imageV2.path}` : "",
                        priority: subcat.priority || 0,
                        unlisted: subcat.unlisted || false,
                        displaySecondaryImage: subcat.displaySecondaryImage || false,
                    })),
                };

                categories.push(category);
            }
        }

        console.log(`Zepto: Extracted ${categories.length} categories with their subcategories`);

        // Cache the results
        placesData[placeName] = {
            ...placesData[placeName],
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

export const startTrackingHandler = async () => {
    console.log("Zepto: starting tracking");
    // Start the continuous tracking loop without awaiting it
    trackPrices().catch((error) => {
        console.error("Zepto: Failed in tracking loop:", error);
    });
    return "Zepto price tracking started";
};

const trackPrices = async (placeName = "500081") => {
    while (true) {
        try {
            // Skip if it's night time (12 AM to 6 AM IST)
            if (isNightTimeIST()) {
                console.log("Zepto: Skipping price tracking during night hours");
                // Wait for 5 minutes before checking night time status again
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            console.log("Zepto: Starting new tracking cycle at:", new Date().toISOString());

            // Step1: Get the categories (now returns a flat array)
            const categories = await fetchCategories(placeName);
            const storeId = placesData[placeName].storeId;

            console.log("Zepto: Starting to fetch products for all categories");

            if (!categories || categories.length === 0) {
                console.log("Zepto: No categories found");
                continue;
            }

            // Randomize the categories
            const randomizedCategories = [...categories].sort(() => Math.random() - 0.5);

            // Process categories in chunks
            for (let i = 0; i < randomizedCategories.length; i += CATEGORY_CHUNK_SIZE) {
                const chunk = randomizedCategories.slice(i, i + CATEGORY_CHUNK_SIZE);
                console.log(
                    `Zepto: Processing chunk ${i / CATEGORY_CHUNK_SIZE + 1} of ${Math.ceil(
                        randomizedCategories.length / CATEGORY_CHUNK_SIZE
                    )}`
                );

                // Process the chunk
                await processChunk(chunk, storeId);
            }

            console.log("Zepto: Finished tracking prices for all categories");

            // Find products with price drops in the last hour
            const priceDrops = await ZeptoProduct.find({
                priceDroppedAt: { $gte: new Date(Date.now() - HALF_HOUR) },
                discount: { $gte: 40 },
                notified: { $exists: true, $eq: false }, // Only match documents where notified exists and is false
            })
                .sort({ discount: -1 })
                .lean();

            if (priceDrops.length > 0) {
                console.log(`Zepto: Found ${priceDrops.length} products with price drops in the last hour`);

                try {
                    // Send notifications
                    await sendPriceDropNotifications(priceDrops, "Zepto");

                    // Mark these products as notified
                    const productIds = priceDrops.map((product) => product.productId);
                    const updateResult = await ZeptoProduct.updateMany(
                        { productId: { $in: productIds } },
                        {
                            $set: { notified: true },
                        }
                    );

                    console.log(
                        `Zepto: Marked ${updateResult.modifiedCount} products as notified out of ${productIds.length} products`
                    );
                } catch (error) {
                    console.error("Zepto: Error in notification process:", error);
                }
            }
        } catch (error) {
            console.error("Zepto: Failed to track prices:", error);
        } finally {
            console.log("Zepto: Tracking cycle completed at:", new Date().toISOString());
            // Add a small delay before starting the next cycle to prevent overwhelming the system
            await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
        }
    }
};

const processChunk = async (chunk, storeId) => {
    // Signature pool from working curl examples for different pages
    const signaturePool = [
        "d1ed6f69224fd8209aed3b395e57564c9391ad319c44b5680d36b00ee316f08f", // Page 1
        "27cf91aaf227c9736ed51a2b5b76671b4fb41ecd6b9e03d3a45e93de308f4c63", // Page 2
        "0f1e0d9bcf4f39c8e0a82eea4b040eabad62d06a1f33c19441fb330f479475b0", // Page 3
        "750446e0e26bdc566c76f67e3fc73286a36dbffaa16c114ba106a55a9c681ff3", // Page 4
        "bbb6655ddcd3e7f751e75de9d78b9e8a3ae33be0797940725818b033b3e69094", // Page 5 (fallback)
    ];

    // Maximum pages to fetch per subcategory to prevent endless loops
    const MAX_PAGES = 10;

    for (const category of chunk) {
        console.log(`Zepto: Processing category: ${category.name}`);

        // Loop through each subcategory
        for (const subcategory of category.subCategories) {
            if (subcategory.unlisted) {
                console.log(`Zepto: Skipping unlisted subcategory: ${subcategory.name}`);
                continue;
            }

            console.log(`Zepto: Fetching products for subcategory: ${subcategory.name}`);
            let pageNumber = 1;
            let hasMoreProducts = true;
            let allSubcategoryProducts = [];
            let retryCount = 0;
            const MAX_RETRIES = 3;
            let emptyResponsesCount = 0;

            // Collect all products for this subcategory
            while (hasMoreProducts && pageNumber <= MAX_PAGES) {
                try {
                    // Generate new session and request IDs for each request
                    const sessionId = `${Math.random().toString(36).substring(2, 15)}-${Math.random()
                        .toString(36)
                        .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}-${Math.random()
                        .toString(36)
                        .substring(2, 15)}`;
                    const requestId = `${Math.random().toString(36).substring(2, 15)}-${Math.random()
                        .toString(36)
                        .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}-${Math.random()
                        .toString(36)
                        .substring(2, 15)}`;
                    const deviceId = "5a602fda-7658-4f4c-8243-4c4936ba6794";

                    // Select signature based on page number
                    const signature = signaturePool[Math.min(pageNumber - 1, signaturePool.length - 1)];

                    console.log(
                        `Zepto: Fetching page ${pageNumber} for ${
                            subcategory.name
                        } with signature: ${signature.substring(0, 10)}...`
                    );

                    const response = await axios.get(
                        "https://api.zeptonow.com/api/v2/store-products-by-store-subcategory-id",
                        {
                            params: {
                                store_id: storeId,
                                subcategory_id: subcategory.id,
                                page_number: pageNumber,
                                user_session_id: sessionId,
                                boosted_pv_ids: "",
                            },
                            headers: {
                                accept: "application/json, text/plain, */*",
                                "accept-language": "en-US,en;q=0.9",
                                app_sub_platform: "WEB",
                                app_version: "12.64.7",
                                appversion: "12.64.7",
                                auth_revamp_flow: "v2",
                                compatible_components:
                                    "CONVENIENCE_FEE,RAIN_FEE,EXTERNAL_COUPONS,STANDSTILL,BUNDLE,MULTI_SELLER_ENABLED,PIP_V1,ROLLUPS,SCHEDULED_DELIVERY,SAMPLING_ENABLED,NEW_FEE_STRUCTURE,NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,SUPERSTORE_V1,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,MARKETPLACE_REPLACEMENT,ZEPTO_PASS,ZEPTO_PASS:1,ZEPTO_PASS:2,ZEPTO_PASS_RENEWAL,CART_REDESIGN_ENABLED,SHIPMENT_WIDGETIZATION_ENABLED,TABBED_CAROUSEL_V2,24X7_ENABLED_V1,PROMO_CASH:0,HOMEPAGE_V2,SUPER_SAVER:1,NO_PLATFORM_CHECK_ENABLED_V2,HP_V4_FEED,GIFT_CARD,SCLP_ADD_MONEY,GIFTING_ENABLED,OFSE,WIDGET_BASED_ETA,NEW_ETA_BANNER,",
                                device_id: deviceId,
                                deviceid: deviceId,
                                marketplace_type: "ZEPTO_NOW",
                                platform: "WEB",
                                "request-signature": signature,
                                request_id: requestId,
                                requestid: requestId,
                                session_id: sessionId,
                                sessionid: sessionId,
                                source: "DIRECT",
                                store_etas: `{"${storeId}":-1}`,
                                store_id: storeId,
                                store_ids: storeId,
                                storeid: storeId,
                                tenant: "ZEPTO",
                                "user-agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                                "x-timezone": "Asia/Calcutta",
                            },
                        }
                    );

                    const storeProducts = response.data?.storeProducts || [];

                    // Log detailed response info for debugging
                    console.log(
                        `Zepto: Page ${pageNumber} for ${subcategory.name} - Status: ${response.status}, Products: ${storeProducts.length}, EndOfList: ${response.data?.endOfList}`
                    );

                    if (storeProducts.length === 0) {
                        emptyResponsesCount++;
                        // If we get 2 consecutive empty responses, assume we're done
                        if (emptyResponsesCount >= 2) {
                            console.log(
                                `Zepto: Received ${emptyResponsesCount} consecutive empty responses, stopping pagination for ${subcategory.name}`
                            );
                            hasMoreProducts = false;
                            break;
                        }
                    } else {
                        emptyResponsesCount = 0; // Reset empty responses counter
                    }

                    hasMoreProducts = !response.data?.endOfList;

                    // If endOfList is false but no products returned, check if we should continue
                    if (hasMoreProducts && storeProducts.length === 0) {
                        console.log(
                            `Zepto: Page ${pageNumber} for ${subcategory.name} returned 0 products but endOfList=false, continuing...`
                        );
                    }

                    allSubcategoryProducts = allSubcategoryProducts.concat(storeProducts);
                    pageNumber++;
                    retryCount = 0; // Reset retry count on successful request

                    // Add a delay between requests to avoid rate limiting
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                } catch (error) {
                    const status = error.response?.status;
                    const data = error.response?.data;

                    console.error(
                        `Zepto: Error fetching page ${pageNumber} for ${subcategory.name}: Status=${status}, Message=${error.message}`
                    );

                    if (status === 429) {
                        console.log(`Zepto: Rate limited for subcategory ${subcategory.name}, waiting before retry...`);
                        retryCount++;

                        if (retryCount > MAX_RETRIES) {
                            console.error(
                                `Zepto: Max retries reached for subcategory ${subcategory.name}, moving on...`
                            );
                            hasMoreProducts = false;
                            break;
                        }

                        // Wait for progressively longer times between retries (30s, 45s, 60s)
                        const waitTime = (30 + (retryCount - 1) * 15) * 1000;
                        console.log(
                            `Zepto: Waiting ${waitTime / 1000} seconds before retry ${retryCount}/${MAX_RETRIES}`
                        );
                        await new Promise((resolve) => setTimeout(resolve, waitTime));
                        continue; // Retry the same request
                    } else if (status === 403 || status === 401) {
                        console.log(
                            `Zepto: Authentication error (${status}) for subcategory ${subcategory.name}, trying alternative approach...`
                        );

                        // Try a different API endpoint as fallback
                        try {
                            console.log(`Zepto: Attempting fallback API for subcategory ${subcategory.name}`);
                            const fallbackResponse = await axios.get(
                                `https://api.zeptonow.com/api/v1/subcategory/products`,
                                {
                                    params: {
                                        subcategory_id: subcategory.id,
                                        store_id: storeId,
                                        page: pageNumber,
                                    },
                                    headers: {
                                        accept: "application/json, text/plain, */*",
                                        "request-signature": signaturePool[4], // Use a different signature
                                        device_id: `${Math.random().toString(36).substring(2, 15)}-${Math.random()
                                            .toString(36)
                                            .substring(2, 15)}-${Math.random()
                                            .toString(36)
                                            .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`,
                                        "user-agent":
                                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                                    },
                                }
                            );

                            const fallbackProducts = fallbackResponse.data?.products || [];
                            console.log(
                                `Zepto: Fallback API returned ${fallbackProducts.length} products for subcategory ${subcategory.name}`
                            );

                            if (fallbackProducts.length > 0) {
                                allSubcategoryProducts = allSubcategoryProducts.concat(fallbackProducts);
                            } else {
                                hasMoreProducts = false; // Stop if fallback returns no products
                            }
                        } catch (fallbackError) {
                            console.error(
                                `Zepto: Fallback API also failed for subcategory ${subcategory.name}:`,
                                fallbackError.message
                            );
                            hasMoreProducts = false;
                        }

                        break; // Move to next subcategory after trying fallback
                    } else {
                        // For other errors, log and move on
                        console.error(`Zepto: Error details for ${subcategory.name}:`, data || error);
                        hasMoreProducts = false;
                    }
                }
            }

            // Process all products for this subcategory at once
            if (allSubcategoryProducts.length > 0) {
                console.log(
                    `Zepto: Processing ${allSubcategoryProducts.length} total products for subcategory ${subcategory.name}`
                );
                const { processedCount } = await processProducts(allSubcategoryProducts, category, subcategory);
                console.log(
                    `Zepto: Completed processing subcategory ${subcategory.name}. Processed ${processedCount} products.`
                );
            } else {
                console.log(`Zepto: No products found for subcategory ${subcategory.name}`);
            }
        }
    }
};

const processProducts = async (products, category, subcategory) => {
    try {
        // Transform Zepto products to the standard format expected by globalProcessProducts
        const transformedProducts = products
            .filter((storeProduct) => !storeProduct.outOfStock)
            .map((storeProduct) => {
                const product = storeProduct.product;
                const variant = storeProduct.productVariant;

                return {
                    productId: variant.id,
                    productName: product.name,
                    categoryName: category.name,
                    subcategoryName: subcategory.name,
                    inStock: true,
                    imageUrl: variant.images?.[0]?.path ? `https://cdn.zeptonow.com/${variant.images[0].path}` : "",
                    price: storeProduct.discountedSellingPrice / 100,
                    mrp: storeProduct.mrp / 100,
                    discount: storeProduct.discountPercent || 0,
                    weight: `${variant.packsize} ${variant.unitOfMeasure.toLowerCase()}`,
                    brand: product.brand || "",
                    url: `https://www.zeptonow.com/pn/${product.name.toLowerCase().replace(/\s+/g, "-")}/pvid/${
                        variant.id
                    }`,
                    eta: variant.shelfLifeInHours || "",
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
