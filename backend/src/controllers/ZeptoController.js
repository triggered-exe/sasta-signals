import { AppError } from '../utils/errorHandling.js';
import { createPage, cleanup, hasStoredLocation, getContextStats, storeContext } from '../utils/crawlerSetup.js';
import axios from 'axios';
import { ZeptoProduct } from '../models/ZeptoProduct.js';
import { PAGE_SIZE, HALF_HOUR } from "../utils/constants.js";
import { Resend } from 'resend';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Global variables
let trackingInterval = null;

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

        console.log("query", query);
        console.log("place", place);

        // Step1: Get the placeid from the searchQuery
        const placeId = await getPlaceIdFromSearchQuery(place);
        console.log('got placeId', placeId);

        // Step2: Get the latitude and longitude from the placeid
        const { latitude, longitude } = await getLatitudeAndLongitudeFromPlaceId(placeId);
        console.log('got latitude and longitude', latitude, longitude);

        // Step3: Check availability of the location 
        const { isServiceable, storeId } = await checkLocationAvailabilityAndGetStoreId(latitude, longitude);
        console.log("isServiceable", isServiceable, 'storeId', storeId);
        // TODO: Implement Zepto search functionality
        throw AppError.serviceUnavailable("Zepto search functionality not implemented yet");

    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError(`Failed to fetch Zepto products: ${error}`));
    }
};

const getPlaceIdFromSearchQuery = async (searchQuery) => {
    try {
        const response = await axios.get(`https://api.zeptonow.com/api/v1/maps/place/autocomplete?place_name=${searchQuery}`)
        const placeId = response.data?.predictions[0]?.place_id;
        if (!placeId) {
            console.log("response", response.data);
            throw AppError.badRequest("Place not found");
        }
        return placeId;
    } catch (error) {
        console.log("error", error);
        throw AppError.badRequest("Place not found");
    }
}

const getLatitudeAndLongitudeFromPlaceId = async (placeId) => {
    const response = await axios.get(`https://api.zeptonow.com/api/v1/maps/place/details?place_id=${placeId}`)
    const location = response.data?.result?.geometry?.location;
    if (!location) {
        console.log("response", response.data);
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
            console.log("response", response.data);
            throw AppError.badRequest("Location is not serviceable by Zepto");
        }
        if (!storeId) {
            console.log("response", response.data);
            throw AppError.badRequest("servicable but storeid not found");
        }

        return { isServiceable, storeId };
    } catch (error) {
        console.error("Error checking location availability:", error?.response?.data || error);
        if (error instanceof AppError) {
            throw error;
        }
        throw AppError.badRequest(`Failed to check location availability: ${error.message}`);
    }
}

export const searchProductsUsingCrawler = async (req, res, next) => {
    let page = null;
    let context = null;

    try {
        const { query, pincode } = req.body;
        if (!query || !pincode) {
            throw AppError.badRequest("Query and pincode are required");
        }

        // TODO: Implement Zepto crawler search functionality
        throw AppError.notImplemented("Zepto crawler search functionality not implemented yet");

    } catch (error) {
        if (page) {
            await page.close();
        }
        if (context && !hasStoredLocation(pincode)) {
            await context.close();
        }
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch Zepto products'));
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

export const fetchCategories = async (req, res, next) => {
    try {
        // TODO: Implement Zepto categories fetch functionality
        throw AppError.notImplemented("Zepto categories fetch functionality not implemented yet");
    } catch (error) {
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch categories'));
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

const startTrackingHandler = async () => {
    console.log("starting tracking");
    let message = "Zepto price tracking started";
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
        message = "Restarted Zepto price tracking";
    }

    trackingInterval = setInterval(() => trackPrices(), HALF_HOUR);
    await trackPrices(); // Run immediately for the first time
    return message;
};

const trackPrices = async () => {
    try {
        // TODO: Implement Zepto price tracking functionality
        console.log("Zepto price tracking not implemented yet");
    } catch (error) {
        console.error('Failed to track prices:', error);
    }
};

export const cleanupBrowser = async (req, res, next) => {
    try {
        await cleanup();
        res.status(200).json({ message: 'Browser and contexts cleaned up successfully' });
    } catch (error) {
        next(error);
    }
}; 