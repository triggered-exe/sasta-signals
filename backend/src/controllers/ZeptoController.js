import { AppError } from '../utils/errorHandling.js';
import { createPage, cleanup, hasStoredLocation, getContextStats, storeContext } from '../utils/crawlerSetup.js';
import { isNightTimeIST } from '../utils/priceTracking.js';
import axios from 'axios';
import { ZeptoProduct } from '../models/ZeptoProduct.js';
import { PAGE_SIZE, HALF_HOUR } from "../utils/constants.js";
import { Resend } from 'resend';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Global variables
let isTrackingActive = false;
const placesData = {};

const CATEGORY_CHUNK_SIZE = 3;

// Helper function to build MongoDB sort criteria based on user preference
const buildSortCriteria = (sortOrder) => {
    const criteria = {};
    if (sortOrder === "price") criteria.price = 1;
    else if (sortOrder === "price_desc") criteria.price = -1;
    else if (sortOrder === "discount") criteria.discount = -1;
    return criteria;
};

// Helper function to build MongoDB match criteria for filtering products
const buildMatchCriteria = (priceDropped, notUpdated) => {
    const criteria = { inStock: true };
    if (priceDropped === "true") {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        criteria.priceDroppedAt = {
            $exists: true,
            $type: "date",
            $gte: oneHourAgo
        };
    }
    if (notUpdated === "true") {
        return {
            ...criteria,
            updatedAt: { $gt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) }
        };
    }
    return criteria;
};

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
                'app_version': '12.32.2',
                'platform': 'WEB',
                'compatible_components': 'CONVENIENCE_FEE,RAIN_FEE,EXTERNAL_COUPONS,STANDSTILL,BUNDLE,MULTI_SELLER_ENABLED,PIP_V1,ROLLUPS,SCHEDULED_DELIVERY,SAMPLING_ENABLED,ETA_NORMAL_WITH_149_DELIVERY,ETA_NORMAL_WITH_199_DELIVERY,HOMEPAGE_V2,NEW_ETA_BANNER,VERTICAL_FEED_PRODUCT_GRID,AUTOSUGGESTION_PAGE_ENABLED,AUTOSUGGESTION_PIP,AUTOSUGGESTION_AD_PIP,BOTTOM_NAV_FULL_ICON,COUPON_WIDGET_CART_REVAMP,DELIVERY_UPSELLING_WIDGET,MARKETPLACE_CATEGORY_GRID,SUPERSTORE_V1,PROMO_CASH:0,NEW_FEE_STRUCTURE,NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,SUPERSTORE_V1,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,MARKETPLACE_REPLACEMENT,ZEPTO_PASS,ZEPTO_PASS:1,ZEPTO_PASS:2,ZEPTO_PASS_RENEWAL,CART_REDESIGN_ENABLED,SUPERSTORE_V1,SHIPMENT_WIDGETIZATION_ENABLED,TABBED_CAROUSEL_V2,24X7_ENABLED_V1,PROMO_CASH:0'
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
                        'app_version': '12.32.2',
                        'appversion': '12.32.2',
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

export const getProducts = async (req, res, next) => {
    try {
        const {
            page = "1",
            pageSize = PAGE_SIZE.toString(),
            sortOrder = "price",
            priceDropped = "false",
            notUpdated = "false"
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const sortCriteria = buildSortCriteria(sortOrder);
        const matchCriteria = buildMatchCriteria(priceDropped, notUpdated);

        const totalProducts = await ZeptoProduct.countDocuments(matchCriteria);
        const products = await ZeptoProduct.aggregate([
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
                    eta: 1,
                    inStock: 1
                }
            }
        ]);

        res.status(200).json({
            data: products,
            totalPages: Math.ceil(totalProducts / parseInt(pageSize)),
            currentPage: parseInt(page),
            pageSize: parseInt(pageSize),
            total: totalProducts
        });

    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch Zepto products'));
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
                    await sendPriceDropNotifications(priceDrops);
                    
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
                            'storeid': storeId
                        }
                    });

                    const storeProducts = response.data?.storeProducts || [];
                    hasMoreProducts = !response.data?.endOfList;
                    // Sometimes the endOfList is false but the products are empty
                    if(hasMoreProducts){
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
                        console.log(`Zepto: Waiting ${waitTime/1000} seconds before retry ${retryCount}/${MAX_RETRIES}`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
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
                updatedAt: now,
                notified: true  // Always set notified field when processing products
            };
            
            // if the price didnt change then dont update the product
            if(existingProduct && existingProduct.price === currentPrice){
                continue;
            }
            
            if (existingProduct) {
                if(existingProduct.productId === "54a0f7ad-26c5-4dc3-b998-f6189d4cd0db"){
                    console.log("Zepto: existingProduct", existingProduct);
                }
                // If price has dropped, update price history and reset notification status
                if (currentPrice < existingProduct.price) {
                    productData.previousPrice = existingProduct.price;
                    productData.priceDroppedAt = now;
                    productData.notified = false;  // Reset notification status on price drop
                } else {
                    // Preserve existing price history if no drop
                    if (existingProduct.previousPrice) {
                        productData.previousPrice = existingProduct.previousPrice;
                    }
                    if (existingProduct.priceDroppedAt) {
                        productData.priceDroppedAt = existingProduct.priceDroppedAt;
                    }
                }
            }

            bulkOps.push({
                updateOne: {
                    filter: { productId: variant.id },
                    update: {
                        $set: productData,
                        $setOnInsert: { createdAt: now }
                    },
                    upsert: true
                }
            });
        }

        if (bulkOps.length > 0) {
            const result = await ZeptoProduct.bulkWrite(bulkOps, { ordered: false });
        } else {
            console.log("Zepto: No products to update in", subcategory.name);
        }

        return { processedCount: bulkOps.length };
    } catch (error) {
        console.error('Zepto: Error in processProducts for Zepto :', error);
        throw error;
    }
};

// Sends Telegram message for products with price drops
const sendTelegramMessage = async (droppedProducts) => {
    try {
        if (!droppedProducts || droppedProducts.length === 0) {
            console.log("Zepto: No dropped products to send Telegram message for");
            return;
        }

        // Verify Telegram configuration
        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
            console.error("Zepto: Missing Telegram configuration. Please check your .env file");
            return;
        }

        // Filter products with discount > 59% and sort by highest discount
        const filteredProducts = droppedProducts
            .filter((product) => product.discount > 59)
            .sort((a, b) => b.discount - a.discount);

        if (filteredProducts.length === 0) {
            console.log("Zepto: No products with discount > 59%");
            return;
        }

        // Create product entries with current and previous prices/discounts
        const productEntries = filteredProducts.map((product) => {
            const prevDiscount = Math.floor(((product.mrp - product.previousPrice) / product.mrp) * 100);
            return (
                `<b>${product.productName}</b>\n` +
                `Current: ₹${product.price} (${product.discount}% off)\n` +
                `Previous: ₹${product.previousPrice} (${prevDiscount}% off)\n` +
                `MRP: ₹${product.mrp}\n` +
                `<a href="${product.url}">View on Zepto</a>\n`
            );
        });

        // Split into chunks of 10 products each
        const chunks = [];
        for (let i = 0; i < productEntries.length; i += 15) {
            chunks.push(productEntries.slice(i, i + 15));
        }

        // Send each chunk as a separate message
        for (let i = 0; i < chunks.length; i++) {
            const messageText =
                `🔥 <b>Zepto Latest Price Drops (Part ${i + 1}/${chunks.length})</b>\n\n` +
                chunks[i].join("\n");

            await axios.post(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    chat_id: TELEGRAM_CHANNEL_ID,
                    text: messageText,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                }
            );

            // Add a small delay between messages to avoid rate limiting
            if (i < chunks.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error("Zepto: Error in Telegram message preparation:", error?.response?.data || error);
    }
};

// Sends email notification for products with price drops
const sendEmailWithDroppedProducts = async (sortedProducts) => {
    try {
        // Skip sending email if no dropped products
        if (!sortedProducts || sortedProducts.length === 0) {
            console.log("Zepto: No dropped products to send email for");
            return;
        }

        console.log(`Zepto: Attempting to send email for ${sortedProducts.length} dropped products`);

        // Split products into chunks of 50 each
        const chunks = [];
        for (let i = 0; i < sortedProducts.length; i += 50) {
            chunks.push(sortedProducts.slice(i, i + 50));
        }

        // Send email for each chunk
        for (let i = 0; i < chunks.length; i++) {
            const emailContent = `
                <h2>Recently Dropped Products on Zepto (Part ${i + 1}/${chunks.length})</h2>
                <div style="font-family: Arial, sans-serif;">
                    ${chunks[i]
                        .map(
                            (product) => {
                                const prevDiscount = Math.floor(((product.mrp - product.previousPrice) / product.mrp) * 100);
                                return `
                                <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #eee; border-radius: 8px;">
                                    <a href="${product.url}"  
                                       style="text-decoration: none; color: inherit; display: block;">
                                        <div style="display: flex; align-items: center;">
                                            <img src="${product.imageUrl}" 
                                                 alt="${product.productName}" 
                                                 style="width: 100px; height: 100px; object-fit: cover; border-radius: 4px; margin-right: 15px;">
                                            <div>
                                                <h3 style="margin: 0 0 8px 0;">${product.productName}</h3>
                                                <p style="margin: 4px 0; color: #2f80ed;">
                                                    Current: ₹${product.price} (${product.discount}% off)
                                                </p>
                                                <p style="margin: 4px 0; color: #666;">
                                                    Previous: ₹${product.previousPrice} (${prevDiscount}% off)
                                                </p>
                                                <p style="margin: 4px 0; text-decoration: line-through; color: #666;">
                                                    MRP: ₹${product.mrp}
                                                </p>
                                                <p style="margin: 4px 0; color: #219653;">
                                                    Price Drop: ₹${(product.previousPrice - product.price).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                    </a>
                                </div>
                            `
                            }
                        )
                        .join("")}
                </div>
            `;

            // Verify Resend API key is set
            if (!process.env.RESEND_API_KEY) {
                throw new Error("RESEND_API_KEY is not configured");
            }

            const response = await resend.emails.send({
                from: "onboarding@resend.dev",
                to: "harishanker.500apps@gmail.com",
                subject: `🔥 Price Drops Alert - Zepto (Part ${i + 1}/${chunks.length}, ${chunks[i].length} products)`,
                html: emailContent,
            });

            console.log(`Zepto: Email part ${i + 1}/${chunks.length} sent successfully`, response);

            // Add a small delay between emails to avoid rate limiting
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error("Zepto: Error sending email:", error?.response?.data || error);
        throw error;
    }
};

const sendPriceDropNotifications = async (droppedProducts) => {
    try {
        // Send both email and Telegram notifications
        await Promise.all([
            sendEmailWithDroppedProducts(droppedProducts),
            sendTelegramMessage(droppedProducts)
        ]);
    } catch (error) {
        console.error('Error in sendPriceDropNotifications:', error);
    }
};