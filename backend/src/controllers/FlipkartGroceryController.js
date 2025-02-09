import axios from "axios";
import { AppError } from "../utils/errorHandling.js";
import { FlipkartGroceryProduct } from "../models/FlipkartGroceryProduct.js";
import { HALF_HOUR, ONE_HOUR, PAGE_SIZE } from "../utils/constants.js";
import { Resend } from "resend";
import { isNightTimeIST, chunk, buildSortCriteria, buildMatchCriteria } from "../utils/priceTracking.js";
import { createPage, cleanup } from '../utils/crawlerSetup.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);
const placesData = {};
// Global variables
let FLIPKART_HEADERS = {
    cookie: 'at=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjFkOTYzYzUwLTM0YjctNDA1OC1iMTNmLWY2NDhiODFjYTBkYSJ9.eyJleHAiOjE3NDAyMTMwNjgsImlhdCI6MTczODQ4NTA2OCwiaXNzIjoia2V2bGFyIiwianRpIjoiNjVhYzlmZmYtZGJmOC00MjJjLTlmNzctYWRiODIwZGE1MDJiIiwidHlwZSI6IkFUIiwia2V2SWQiOiJWSTU1QzQwRDM0NDVFNDQwQUZBQTJDNjI2NzRGNTE5MUMzIiwidElkIjoibWFwaSIsInZzIjoiTE8iLCJ6IjoiQ0giLCJtIjp0cnVlLCJnZW4iOjN9.fYpElJzcnNt-TFxAHukl5-sUdiznTKLrcn_t7_zn-QY; rt=null; vd=VI55C40D3445E440AFAA2C62674F5191C3-1738485068915-8.1738860133.1738860133.152168214; S=d1t12P3t%2FNT8kPzxFPz8%2FWj9TP4OHtzDHMvxxTg4npl8VfxsrKXQwofeCx0%2Fqd3R8C%2FtFX%2F96haPcokMeNQoUCwPzwA%3D%3D; SN=VI55C40D3445E440AFAA2C62674F5191C3.TOK2E3DA78236B04CA3A68BDA9E9DC16FD8.1738860133016.LO; ud=1.Fi97cbXq2dHNohHvhwt5IUZRcPmZYebObneAheGaCJ3g02P62K9sJjtYlBSR2tr6941NomYKs7HD7xsOtvNoAwCTOEyGYRJtjmkCGVNhlL4xsAkGbvKTW5NaEdOOOlwUwcBJ_qhSsq-YUANQurcTuGnwnsxOHfAkk0ccsPJvcqMFdT22kb5enwW8a00e692zGuYqxLZ2FQb9YFugKyU8_A',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'application/json',
    DNT: '1',
    Origin: 'https://www.flipkart.com',
    Pragma: 'no-cache',
    Referer: 'https://www.flipkart.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Sec-GPC': '1',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
    'X-User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 FKUA/msite/0.0.3/msite/Mobile',
    flipkart_secure: 'true',
    'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Brave";v="132"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"'
}
// Global variables
let isTrackingActive = false;
const CATEGORY_CHUNK_SIZE = 3;

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

        const totalProducts = await FlipkartGroceryProduct.countDocuments(matchCriteria);
        const products = await FlipkartGroceryProduct.aggregate([
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
        next(error);
    }
};

const processProducts = async (products, category) => {
    try {
        const bulkOps = [];
        const now = new Date();
        const productIds = products
            .filter(p => p.inStock)
            .map(p => p.productId);

        // Get existing products from DB
        const existingProducts = await FlipkartGroceryProduct.find({
            productId: { $in: productIds }
        }).lean();

        // Create a map for faster lookups
        const existingProductsMap = new Map(
            existingProducts.map(p => [p.productId, p])
        );
        const droppedProducts = [];

        // Process each product
        for (const product of products) {
            if (!product.inStock) continue;

            const currentPrice = product.price;
            const existingProduct = existingProductsMap.get(product.productId);

            const productData = {
                ...product,
                categoryName: category.name,
                updatedAt: now
            };

            if (existingProduct) {
                if (existingProduct.price === currentPrice) {
                    continue; // Skip if price hasn't changed
                }

                productData.previousPrice = existingProduct.price;
                const currentDiscount = productData.discount;
                const previousDiscount = existingProduct.discount || 0;

                if (currentDiscount - previousDiscount >= 10) {
                    productData.priceDroppedAt = now;
                    productData.notified = false;
                    droppedProducts.push({
                        ...productData,
                        previousPrice: existingProduct.price
                    });
                } else {
                    if (existingProduct.priceDroppedAt) {
                        productData.priceDroppedAt = existingProduct.priceDroppedAt;
                    }
                    productData.notified = true;
                }
            }

            bulkOps.push({
                updateOne: {
                    filter: { productId: product.productId },
                    update: { $set: productData },
                    upsert: true
                }
            });
        }

        if (droppedProducts.length > 0) {
            console.log(`FK: Found ${droppedProducts.length} dropped products in ${category.name}`);
            try {
                await sendTelegramMessage(droppedProducts);
            } catch (error) {
                console.error('FK: Error sending Telegram notification:', error);
            }
        }

        if (bulkOps.length > 0) {
            await FlipkartGroceryProduct.bulkWrite(bulkOps, { ordered: false });
            console.log(`FK: Updated ${bulkOps.length} products in ${category.name}`);
        }

        return { processedCount: bulkOps.length };
    } catch (error) {
        console.error('FK: Error processing products:', error);
        return { processedCount: 0 };
    }
};

const sendTelegramMessage = async (droppedProducts) => {
    try {
        if (!droppedProducts || droppedProducts.length === 0) {
            console.log("FK: No dropped products to send Telegram message for");
            return;
        }

        const filteredProducts = droppedProducts
            .filter((product) => product.discount > 59)
            .sort((a, b) => b.discount - a.discount);

        if (filteredProducts.length === 0) return;

        const chunks = chunk(filteredProducts, 15);
        console.log(`FK: Sending Telegram messages for ${filteredProducts.length} products`);

        for (let i = 0; i < chunks.length; i++) {
            const messageText = `🔥 <b>Flipkart Grocery Price Drops</b>\n\n` +
                chunks[i].map((product) => {
                    const priceDrop = product.previousPrice - product.price;
                    return `<b>${product.productName}</b>\n` +
                        `💰 Current: ₹${product.price}\n` +
                        `📊 Previous: ₹${product.previousPrice}\n` +
                        `📉 Drop: ₹${priceDrop.toFixed(2)} (${product.discount}% off)\n` +
                        `🔗 <a href="${product.url}">View on Flipkart</a>\n`;
                }).join("\n");

            await axios.post(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    chat_id: TELEGRAM_CHANNEL_ID,
                    text: messageText,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                }
            );

            if (i < chunks.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        console.log(`FK: Sent notifications for ${filteredProducts.length} products`);
    } catch (error) {
        console.error("FK: Error sending Telegram message:", error?.response?.data || error);
        throw error;
    }
};

export const startTracking = async (req, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        next(error);
    }
};

export const startTrackingHandler = async () => {
    // Prevent multiple tracking instances
    if (isTrackingActive) {
        console.log("FK : Tracking is already active");
        return;
    }

    isTrackingActive = true;
    while (true) {
        // Skip if it's night time (12 AM to 6 AM IST)
        if (isNightTimeIST()) {
            console.log("FK : Skipping price tracking during night hours");
            // Wait for 5 minutes before checking night time status again
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
            continue;
        }
        try {
            const categories = await fetchCategories(500064);
            console.log('FK: Categories received, processing...')

            // Process each category sequentially
            for (const category of categories) {
                try {
                    const products = await processCategoriesChunk(category, 500064, FLIPKART_HEADERS);
                    if (products && products.length > 0) {
                        await processProducts(products, { name: getCategoryNameFromUrl(category) });
                    }
                    // Add a small delayprocessProducts between categories
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`FK: Error processing category ${category}:`, error);
                    continue; // Continue with next category even if one fails
                }
            }

            console.log("FK: Tracking completed for categoreis: starting new in 5 min")
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));

        } catch (error) {
            console.error('FK: Error in tracking handler:', error);
            throw error;
        }
    }
};

const processCategoriesChunk = async (category, pincode, headers) => {
    try {
        console.log("FK: Processing category:", category);
        category = "https://www.flipkart.com" + category;
        let page = 1;
        let hasMoreProducts = true;
        let allProducts = [];

        while (hasMoreProducts) {
            const productsResponse = await axios.post(
                `https://2.rome.api.flipkart.com/api/4/page/fetch`,
                {
                    "pageUri": category,
                    "pageContext": {
                        "trackingContext": {
                            "context": {
                                "eVar51": "neo/merchandising",
                                "eVar61": "creative_card"
                            }
                        },
                        "pageNumber": page,
                        "networkSpeed": 0
                    },
                    "requestContext": {
                        "type": "BROWSE_PAGE",
                        "ssid": "zddoiwtils000000",
                        "sqid": "aad8be2b-06bd-4008-983a-8e7713357ebb"
                    },
                    "locationContext": {
                        "pincode": pincode,
                        "changed": false
                    }
                },
                {
                    headers: FLIPKART_HEADERS,
                    params: {
                        cacheFirst: false
                    }
                }
            );

            const slots = productsResponse.data?.RESPONSE?.slots || [];
            const productWidgets = slots
                .map(slot => slot.widget)
                .filter(widget => widget?.type === "PRODUCT_SUMMARY_EXTENDED");

            let pageProducts = [];

            productWidgets.forEach(widget => {
                if (widget.data?.products) {
                    Object.values(widget.data.products).forEach(product => {
                        if (product.productInfo?.value?.productSwatch?.products) {
                            Object.entries(product.productInfo?.value?.productSwatch?.products).forEach(([productId, productDetails]) => {
                                const productData = {
                                    productId: productId,
                                    productName: productDetails.titles?.title || '',
                                    brand: productDetails.titles?.superTitle || '',
                                    weight: productDetails.titles?.subtitle || '',
                                    imageUrl: productDetails.images?.[0]?.url?.replace('{@width}', '512').replace('{@height}', '512').replace('{@quality}', '70') || '',
                                    url: "https://www.flipkart.com" + productDetails.productUrl || '',
                                    inStock: productDetails.available,
                                    mrp: productDetails.pricing?.prices?.find(p => p.priceType === 'MRP')?.value || 0,
                                    price: productDetails.pricing?.finalPrice?.value || 0,
                                };
                                productData.discount = Math.floor(((productData.mrp - productData.price) / productData.mrp) * 100);
                                pageProducts.push(productData);
                            });
                        }
                    });
                }
            });

            if (pageProducts.length === 0) {
                hasMoreProducts = false;
            } else {
                allProducts = [...allProducts, ...pageProducts];
                page++;
            }
        }

        if (allProducts.length > 0) {
            // filter duplicate products
            const uniqueProductsMap = new Map();
            allProducts.forEach(product => {
                uniqueProductsMap.set(product.productId, product);
            });
            const uniqueProducts = Array.from(uniqueProductsMap.values());
            console.log(`FK: Found ${allProducts.length} products for category ${category}`);
            return uniqueProducts;
        }

    } catch (error) {
        console.error('FK: Error processing category chunk:', error?.response?.data || error);
        throw error;
    }
};

export const fetchCategories = async (pincode) => {
    if (placesData[pincode]) {
        return placesData[pincode].categories;
    }
    try {
        const response = await axios.post(
            'https://1.rome.api.flipkart.com/api/4/page/fetch',
            {
                pageUri: "/catab-store?marketplaceGROCERY",
                pageContext: {
                    trackingContext: {
                        context: {
                            eVar51: "neo/navigation",
                            eVar61: ""
                        }
                    },
                    fetchSeoData: true,
                    networkSpeed: 0
                },
                locationContext: {
                    pincode: pincode || 500064,
                    changed: false
                }
            },
            {
                headers: FLIPKART_HEADERS,
                params: {
                    cacheFirst: false
                }
            }
        );

        if (!response.data) {
            throw new AppError('No data received from Flipkart API', 500);
        }

        // console.log(response.data);
        const slots = response.data.RESPONSE.slots;
        const widgets = slots.map(slot => slot.widget);

        const renderableComponents = widgets.map(widget => widget.data?.renderableComponents).filter(Boolean).flat();

        const deDuplicate = new Map();

        // Extract categories url
        const ParentCategories = renderableComponents.map(component => {
            if (component?.action && component.action.originalUrl) {
                const splitUrl = component.action.originalUrl.split("/");
                const categoryKeyWord = splitUrl[2];
                if (deDuplicate.has(categoryKeyWord)) {
                    return null;
                }
                deDuplicate.set(categoryKeyWord, true);
                return component.action.originalUrl;
            }
            return null;
        }).filter(Boolean);
        // console.log("categories", ParentCategories);

        const categoriesTree = await Promise.all(ParentCategories.map(async category => {
            try {
                const categoriesTreeResponse = await axios.post(
                    "https://1.rome.api.flipkart.com/api/4/page/fetch",
                    {
                        "pageUri": category,
                        "pageContext": {
                            "trackingContext": {
                                "context": {
                                    "eVar51": "neo/merchandising",
                                    "eVar61": "creative_card"
                                }
                            },
                            "networkSpeed": 0
                        },
                        "requestContext": {
                            "type": "BROWSE_PAGE",
                            "ssid": "g6zz17iw2o000000",
                            "sqid": "6f5db46f-4dc7-4368-9d12-0b969c032184"
                        },
                        "locationContext": {
                            "pincode": 500064,
                            "changed": false
                        }
                    },
                    {
                        headers: FLIPKART_HEADERS,
                        params: {
                            cacheFirst: false
                        }
                    }
                );

                const slots = categoriesTreeResponse.data?.RESPONSE?.slots;

                // Find the category tree slot
                const categoryTreeSlot = slots.find(slot => slot.widget?.type === "CATEGORY_TREE");
                const substores = categoryTreeSlot?.widget?.data?.store?.value?.substores || [];

                return {
                    categoryUrl: category,
                    substores: substores
                };
            } catch (error) {
                console.error(`Error fetching category tree for ${category}:`, error);
                return {
                    categoryUrl: category,
                    substores: [],
                    error: error.message
                };
            }
        }));

        // console.log("categoriesTree", JSON.stringify(categoriesTree, null, 2));


        //  Extract categories from categoriesTree
        const categoriesSet = new Set();
        categoriesTree.forEach(category => {
            category.substores.forEach(substore => {
                if (substore?.action?.originalUrl) {
                    categoriesSet.add(substore.action.originalUrl);
                }
            });
        });
        const categories = Array.from(categoriesSet);
        // console.log("categories", categories);
        placesData[pincode] = {
            categories: categories
        }
        return categories;

    } catch (error) {
        console.error('FK: Error fetching categories:', error);
        throw new AppError('Failed to fetch Flipkart categories', 500);
    }
};

const getCategoryNameFromUrl = (url) => {
    const parts = url.split('/');
    return parts[2] || 'unknown';
};
