import { AppError } from '../utils/errorHandling.js';
import { createPage, cleanup, hasStoredLocation, getContextStats, storeContext } from '../utils/crawlerSetup.js';
import { isNightTimeIST, buildSortCriteria, buildMatchCriteria } from '../utils/priceTracking.js';
import axios from 'axios';
import { ZeptoProduct } from '../models/ZeptoProduct.js';
import { PAGE_SIZE, HALF_HOUR } from "../utils/constants.js";
import { sendPriceDropNotifications } from "../services/NotificationService.js";


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
    console.log('Zepto: got placeId', placeId);
    const { latitude, longitude } = await getLatitudeAndLongitudeFromPlaceId(placeId);
    console.log('Zepto: got latitude and longitude', latitude, longitude);
    const { isServiceable, storeId } = await checkLocationAvailabilityAndGetStoreId(latitude, longitude);
    console.log("Zepto: isServiceable", isServiceable, 'storeId', storeId);
    if (!isServiceable) {
        throw AppError.badRequest("Location is not serviceable by Zepto");
    }
    if (!storeId) {
        throw AppError.badRequest("servicable but storeid not found");
    }
    return storeId;
}

const getPlaceIdFromPlace = async (place) => {
    try {
        if (placesData[place]) {
            return placesData[place];
        }
        const response = await axios.get(`https://api.zeptonow.com/api/v1/maps/place/autocomplete?place_name=${place}`)
        const placeId = response.data?.predictions[0]?.place_id;
        if (!placeId) {
            console.log("Zepto: response", response.data);
            throw AppError.badRequest("Place not found");
        }
        placesData[place] = placeId;
        return placeId;
    } catch (error) {
        console.log("Zepto: error", error);
        throw AppError.badRequest("Place not found");
    }
}

const getLatitudeAndLongitudeFromPlaceId = async (placeId) => {
    const response = await axios.get(`https://api.zeptonow.com/api/v1/maps/place/details?place_id=${placeId}`)
    const location = response.data?.result?.geometry?.location;
    if (!location) {
        console.log("Zepto: response", response.data);
        throw AppError.badRequest("Location not found");
    }
    return { latitude: location?.lat, longitude: location?.lng };
}

const checkLocationAvailabilityAndGetStoreId = async (latitude, longitude) => {
    try {
        const response = await axios.get(`https://api.zeptonow.com/api/v1/get_page`, {
            params: {
                latitude,
                longitude,
                page_type: 'HOME',
                version: 'v2'
            },
            headers: {
                'app_version': '24.10.5',
                'platform': 'WEB',
                'compatible_components': 'CONVENIENCE_FEE,RAIN_FEE,EXTERNAL_COUPONS,STANDSTILL,BUNDLE,MULTI_SELLER_ENABLED,PIP_V1,ROLLUPS,SCHEDULED_DELIVERY,SAMPLING_ENABLED,ETA_NORMAL_WITH_149_DELIVERY,ETA_NORMAL_WITH_199_DELIVERY,HOMEPAGE_V2,NEW_ETA_BANNER,VERTICAL_FEED_PRODUCT_GRID,AUTOSUGGESTION_PAGE_ENABLED,AUTOSUGGESTION_PIP,AUTOSUGGESTION_AD_PIP,BOTTOM_NAV_FULL_ICON,COUPON_WIDGET_CART_REVAMP,DELIVERY_UPSELLING_WIDGET,MARKETPLACE_CATEGORY_GRID,NO_PLATFORM_CHECK_ENABLED_V2,SUPER_SAVER:1,SUPERSTORE_V1,PROMO_CASH:0,24X7_ENABLED_V1,TABBED_CAROUSEL_V2,HP_V4_FEED,WIDGET_BASED_ETA,NEW_FEE_STRUCTURE,NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,SUPERSTORE_V1,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,MARKETPLACE_REPLACEMENT,ZEPTO_PASS,ZEPTO_PASS:1,ZEPTO_PASS:2,ZEPTO_PASS_RENEWAL,CART_REDESIGN_ENABLED,SHIPMENT_WIDGETIZATION_ENABLED,TABBED_CAROUSEL_V2,24X7_ENABLED_V1,PROMO_CASH:0,HOMEPAGE_V2,SUPER_SAVER:1,NO_PLATFORM_CHECK_ENABLED_V2,HP_V4_FEED,GIFT_CARD,SCLP_ADD_MONEY,GIFTING_ENABLED,OFSE,WIDGET_BASED_ETA,NEW_ETA_BANNER,'
            }
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
}

const searchProductsFromZeptoHelper = async (query, storeId) => {
    try {
        let hasMore = true;
        let totalProducts = [];
        let pageNumber = 0;
        const deviceId = '0e8c2727-b821-4571-a2bf-939f4db01659';
        const sessionId = '486ff954-8379-4390-b08c-b47297ecdd22';
        const intentId = '91754206-304e-4352-9d51-d082da4a90fe';

        while (hasMore) {
            const searchResponse = await axios.post(
                'https://api.zeptonow.com/api/v3/search',
                {
                    query,
                    pageNumber,
                    intentId,
                    mode: "AUTOSUGGEST"
                },
                {
                    headers: {
                        'accept': 'application/json, text/plain, */*',
                        'accept-language': 'en-US,en;q=0.8',
                        'app_sub_platform': 'WEB',
                        'app_version': '24.10.5',
                        'appversion': '24.10.5',
                        'content-type': 'application/json',
                        'device_id': deviceId,
                        'deviceid': deviceId,
                        'platform': 'WEB',
                        'sec-ch-ua-mobile': '?1',
                        'sec-ch-ua-platform': '"Android"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-site',
                        'sec-gpc': '1',
                        'session_id': sessionId,
                        'sessionid': sessionId,
                        'storeid': storeId
                    }
                }
            );

            if (!searchResponse.data) {
                throw AppError.badRequest("Failed to fetch search results");
            }

            // Process and format the search results
            if (searchResponse.data?.layout) {
                searchResponse.data.layout.forEach(layout => {
                    if (layout.widgetId === "PRODUCT_GRID" && layout.data?.resolver?.data?.items) {
                        const products = layout.data.resolver.data.items.map(item => {
                            const productData = item.productResponse;
                            const product = productData?.product;
                            const variant = productData?.productVariant;

                            return {
                                id: productData?.id,
                                name: product?.name,
                                brand: product?.brand,
                                description: product?.description?.[0] || '',
                                weight: variant?.formattedPacksize,
                                price: productData?.sellingPrice / 100, // Converting to rupees
                                mrp: productData.mrp / 100, // Converting to rupees
                                discount: productData.discountPercent,
                                image: variant.images?.[0]?.path ? `https://cdn.zeptonow.com/${variant.images[0].path}` : '',
                                inStock: !productData.outOfStock,
                                quantity: variant.quantity,
                                category: {
                                    main: productData.primaryCategoryName,
                                    sub: productData.primarySubcategoryName,
                                    leaf: productData.l3CategoriesDetail?.[0]?.name
                                },
                                url: `https://www.zeptonow.com/pn/${product.name.toLowerCase().replace(/\s+/g, '-')}/pvid/${variant.id}`,
                                attributes: variant.l4Attributes || {}
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
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return {
            products: totalProducts,
            total: totalProducts.length,
            currentPage: pageNumber,
            totalPages: Math.ceil(totalProducts.length / 28)
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
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch categories'));
    }
};

const fetchCategories = async (placeName = "500081") => {
    try {
        if (placesData[placeName] && placesData[placeName].categories) {
            return placesData[placeName].categories;
        }
        // Step1: Get the storeId
        const storeId = await getStoreId(placeName);
        const response = await axios.get(
            `https://api.zeptonow.com/api/v2/category/grid`,
            {
                params: {
                    store_id: storeId,
                    version: 'v2',
                    show_new_eta_banner: true
                },
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'compatible_components': 'CONVENIENCE_FEE,RAIN_FEE,EXTERNAL_COUPONS,STANDSTILL,BUNDLE,MULTI_SELLER_ENABLED,PIP_V1,ROLLUPS,SCHEDULED_DELIVERY,SAMPLING_ENABLED,ETA_NORMAL_WITH_149_DELIVERY,ETA_NORMAL_WITH_199_DELIVERY,HOMEPAGE_V2,NEW_ETA_BANNER,VERTICAL_FEED_PRODUCT_GRID,AUTOSUGGESTION_PAGE_ENABLED,AUTOSUGGESTION_PIP,AUTOSUGGESTION_AD_PIP,BOTTOM_NAV_FULL_ICON,COUPON_WIDGET_CART_REVAMP,DELIVERY_UPSELLING_WIDGET,MARKETPLACE_CATEGORY_GRID,SUPERSTORE_V1,PROMO_CASH:0,NEW_FEE_STRUCTURE,NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,SUPERSTORE_V1,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,MARKETPLACE_REPLACEMENT,ZEPTO_PASS,ZEPTO_PASS:1,ZEPTO_PASS:2,ZEPTO_PASS_RENEWAL,CART_REDESIGN_ENABLED,SUPERSTORE_V1,SHIPMENT_WIDGETIZATION_ENABLED,TABBED_CAROUSEL_V2,24X7_ENABLED_V1,PROMO_CASH:0',
                    'source': 'DIRECT',
                    'store_id': storeId,
                    'storeid': storeId
                }
            }
        );

        if (!response.data) {
            throw AppError.badRequest("Failed to fetch categories");
        }

        // Process and format the categories
        const categoryGroups = response.data?.categoryGridResponseList?.map(group => ({
            parentCategory: group.parentCategoryName,
            title: group.viewMeta?.titleV2?.[0]?.text || '',
            categories: group.categories?.map(category => ({
                id: category.id,
                name: category.name,
                image: category.imageWithNameV2?.path ? `https://cdn.zeptonow.com/${category.imageWithNameV2.path}` : '',
                enlargedImage: category.enlargedImageV3?.path ? `https://cdn.zeptonow.com/${category.enlargedImageV3.path}` : '',
                priority: category.priority || 0,
                productCount: category.productCount || 0,
                isActive: category.isActive || false,
                deeplinkUrl: category.deeplinkUrl || '',
                subCategories: []
            })) || []
        })) || [];

        // Step3: Get the subcategories for each category
        for (const categoryGroup of categoryGroups) {
            for (const category of categoryGroup.categories) {
                try {
                    const subcategoriesResponse = await axios.get('https://api.zeptonow.com/api/v1/category', {
                        params: {
                            category_id: category.id,
                            store_id: storeId
                        },
                        headers: {
                            'accept': 'application/json, text/plain, */*'
                        }
                    });

                    // Process subcategories
                    category.subCategories = subcategoriesResponse.data?.availableSubcategories?.map(subcat => ({
                        id: subcat.id,
                        name: subcat.name,
                        image: subcat.imageV2?.path ? `https://cdn.zeptonow.com/${subcat.imageV2.path}` : '',
                        priority: subcat.priority || 0,
                        unlisted: subcat.unlisted || false,
                        displaySecondaryImage: subcat.displaySecondaryImage || false,
                        facebookSubcategory: subcat.facebookSubcategory || '',
                        googleSubcategory: subcat.googleSubcategory || '',
                        priceGuardrailThreshold: subcat.priceGuardrailThreshold || 0,
                        discountApplicable: subcat.discountApplicable || false,
                        mrpSpMismatchAllowed: subcat.mrpSpMismatchAllowed || false
                    })) || [];

                    // Add a small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`Error fetching subcategories for category ${category.name}:`, error?.response?.data || error);
                    // Continue with other categories even if one fails
                    continue;
                }
            }
        }

        placesData[placeName] = {
            categories: categoryGroups,
            storeId: storeId
        }
        return categoryGroups;
    } catch (error) {
        console.error('Error fetching categories:', error?.response?.data || error);
        throw AppError.internalError('Failed to fetch categories');
    }
};

export const startTracking = async (req, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError('Failed to start price tracking'));
    }
};

export const startTrackingHandler = async () => {
    console.log("Zepto: starting tracking");
    // Start the continuous tracking loop without awaiting it
    trackPrices().catch(error => {
        console.error('Zepto: Failed in tracking loop:', error);
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
                await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            console.log("Zepto: Starting new tracking cycle at:", new Date().toISOString());

            // Step1: Get the categories
            const categories = await fetchCategories(placeName);
            const storeId = placesData[placeName].storeId;

            console.log("Zepto: Starting to fetch products for all categories");

            if (!categories || categories.length === 0) {
                console.log("Zepto: No categories found");
                continue;
            }

            // Randomize the categories
            const randomizedCategories = categories.sort(() => Math.random() - 0.5);

            // Flatten categories from all groups into a single array
            const allCategories = categories.reduce((acc, group) => {
                return acc.concat(group.categories);
            }, []);

            // Process categories in chunks
            for (let i = 0; i < allCategories.length; i += CATEGORY_CHUNK_SIZE) {
                const chunk = allCategories.slice(i, i + CATEGORY_CHUNK_SIZE);
                console.log(`Zepto: Processing chunk ${i / CATEGORY_CHUNK_SIZE + 1} of ${Math.ceil(allCategories.length / CATEGORY_CHUNK_SIZE)}`);

                // Process the chunk
                await processChunk(chunk, storeId);
            }

            console.log("Zepto: Finished tracking prices for all categories");

            // Find products with price drops in the last hour
            const priceDrops = await ZeptoProduct.find({
                priceDroppedAt: { $gte: new Date(Date.now() - HALF_HOUR) },
                discount: { $gte: 40 },
                notified: { $exists: true, $eq: false }  // Only match documents where notified exists and is false
            }).sort({ discount: -1 }).lean();

            if (priceDrops.length > 0) {
                console.log(`Zepto: Found ${priceDrops.length} products with price drops in the last hour`);

                try {
                    // Send notifications
                    await sendPriceDropNotifications(priceDrops, "Zepto");

                    // Mark these products as notified
                    const productIds = priceDrops.map(product => product.productId);
                    const updateResult = await ZeptoProduct.updateMany(
                        { productId: { $in: productIds } },
                        {
                            $set: { notified: true }
                        }
                    );

                    console.log(`Zepto: Marked ${updateResult.modifiedCount} products as notified out of ${productIds.length} products`);
                } catch (error) {
                    console.error('Zepto: Error in notification process:', error);
                }
            }

        } catch (error) {
            console.error('Zepto: Failed to track prices:', error);
        } finally {
            console.log("Zepto: Tracking cycle completed at:", new Date().toISOString());
            // Add a small delay before starting the next cycle to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));
        }
    }
};

const processChunk = async (chunk, storeId) => {
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

            // Collect all products for this subcategory
            while (hasMoreProducts) {
                try {
                    const response = await axios.get('https://api.zeptonow.com/api/v2/store-products-by-store-subcategory-id', {
                        params: {
                            store_id: storeId,
                            subcategory_id: subcategory.id,
                            page_number: pageNumber,
                            user_session_id: ''
                        },
                        headers: {
                            'accept': 'application/json, text/plain, */*',
                            'request-signature': '860ea4ea95348d44eaa5848ba9b58929678a6d601e9e8d27fe292d794f1faba5',
                            'storeid': storeId
                        }
                    });

                    const storeProducts = response.data?.storeProducts || [];
                    hasMoreProducts = !response.data?.endOfList;
                    // Sometimes the endOfList is false but the products are empty
                    if (hasMoreProducts) {
                        hasMoreProducts = storeProducts.length > 0;
                    }

                    allSubcategoryProducts = allSubcategoryProducts.concat(storeProducts);
                    pageNumber++;
                    retryCount = 0; // Reset retry count on successful request
                } catch (error) {
                    if (error.response?.status === 429) {
                        console.log(`Zepto: Rate limited for subcategory ${subcategory.name}, waiting before retry...`);
                        retryCount++;

                        if (retryCount > MAX_RETRIES) {
                            console.error(`Zepto: Max retries reached for subcategory ${subcategory.name}, moving on...`);
                            hasMoreProducts = false;
                            break;
                        }

                        // Wait for progressively longer times between retries (1m, 2m, 3m)
                        const waitTime = retryCount * 60 * 1000;
                        console.log(`Zepto: Waiting ${waitTime / 1000} seconds before retry ${retryCount}/${MAX_RETRIES}`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue; // Retry the same request
                    }

                    console.error(`Zepto: Error fetching products for subcategory ${subcategory.name}:`, error?.response?.data || error);
                    hasMoreProducts = false;
                }
            }

            // Process all products for this subcategory at once
            if (allSubcategoryProducts.length > 0) {
                console.log(`Zepto: Processing ${allSubcategoryProducts.length} total products for subcategory ${subcategory.name}`);
                const { processedCount } = await processProducts(allSubcategoryProducts, category, subcategory);
                console.log(`Zepto: Completed processing subcategory ${subcategory.name}. Processed ${processedCount} products.`);
            }
        }
    }
};

const processProducts = async (products, category, subcategory) => {
    try {
        const bulkOps = [];
        const now = new Date();
        const productIds = products
            .filter(p => !p.outOfStock)
            .map(p => p.productVariant.id);

        // Get existing products from DB
        const existingProducts = await ZeptoProduct.find({
            productId: { $in: productIds }
        }).lean();

        // Create a map for faster lookups
        const existingProductsMap = new Map(
            existingProducts.map(p => [p.productId, p])
        );
        const droppedProducts = [];

        // Process each product
        for (const storeProduct of products) {
            if (storeProduct.outOfStock) continue;

            const product = storeProduct.product;
            const variant = storeProduct.productVariant;
            const currentPrice = storeProduct.discountedSellingPrice / 100;
            const existingProduct = existingProductsMap.get(variant.id);

            const productData = {
                productId: variant.id,
                categoryName: category.name,
                subcategoryName: subcategory.name,
                inStock: true,
                imageUrl: variant.images?.[0]?.path ? `https://cdn.zeptonow.com/${variant.images[0].path}` : '',
                productName: product.name,
                price: currentPrice,
                mrp: storeProduct.mrp / 100,
                discount: storeProduct.discountPercent || 0,
                weight: `${variant.packsize} ${variant.unitOfMeasure.toLowerCase()}`,
                brand: product.brand || '',
                url: `https://www.zeptonow.com/pn/${product.name.toLowerCase().replace(/\s+/g, '-')}/pvid/${variant.id}`,
                eta: variant.shelfLifeInHours || '',
                updatedAt: now
            };

            // Only process if price has changed
            if (existingProduct && existingProduct.price === currentPrice) {
                continue;
            }

            if (existingProduct) {
                productData.previousPrice = existingProduct.price;
                const currentDiscount = productData.discount;
                const previousDiscount = existingProduct.discount || 0;
                // The current discount should be greater than or equal to 20% more than the previous discount
                if (currentDiscount - previousDiscount >= 10) {
                    productData.priceDroppedAt = now;

                    droppedProducts.push({
                        ...productData,
                        previousPrice: existingProduct.price
                    });
                } else {
                    // Keep existing priceDroppedAt and notification status if price increased
                    if (existingProduct.priceDroppedAt) {
                        productData.priceDroppedAt = existingProduct.priceDroppedAt;
                    }
                }
            }

            bulkOps.push({
                updateOne: {
                    filter: { productId: variant.id },
                    update: { $set: productData },
                    upsert: true
                }
            });
        }

        if (droppedProducts.length > 0) {
            console.log(`Zepto: Found ${droppedProducts.length} dropped products in ${category.name}`);
            try {
                await sendPriceDropNotifications(droppedProducts, "Zepto");
            } catch (error) {
                console.error('Zepto: Error sending notifications:', error);
                // Don't throw the error to continue processing
            }
        } else {
            console.log(`Zepto: No dropped products in ${category.name} out of ${products.length} products`);
        }

        if (bulkOps.length > 0) {
            await ZeptoProduct.bulkWrite(bulkOps, { ordered: false });
            console.log(`Zepto: Updated ${bulkOps.length} products in ${category.name}`);
        }

        return { processedCount: bulkOps.length };
    } catch (error) {
        console.error('Zepto: Error processing products:', error);
        return { processedCount: 0 };
    }
};