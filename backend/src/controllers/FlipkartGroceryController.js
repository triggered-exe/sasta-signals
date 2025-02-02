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

// Global variables
let FLIPKART_HEADERS = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 FKUA/msite/0.0.3/msite/Mobile',
    'Cookie': `T=TI173848501700200106455755444717511883658442928860883491777837300798; at=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjFkOTYzYzUwLTM0YjctNDA1OC1iMTNmLWY2NDhiODFjYTBkYSJ9.eyJleHAiOjE3NDAyMTMwMTcsImlhdCI6MTczODQ4NTAxNywiaXNzIjoia2V2bGFyIiwianRpIjoiZmJmMjZiYWQtNzc2Yy00Y2Y5LThiNDAtYzU1Y2QxZjczNDkwIiwidHlwZSI6IkFUIiwiZElkIjoiVEkxNzM4NDg1MDE3MDAyMDAxMDY0NTU3NTU0NDQ3MTc1MTE4ODM2NTg0NDI5Mjg4NjA4ODM0OTE3Nzc4MzczMDA3OTgiLCJrZXZJZCI6IlZJQzFBRjhGMzJGQzA4NEU4NjgxMDA2QTlEOUVFOTMzNTgiLCJ0SWQiOiJtYXBpIiwidnMiOiJMTyIsInoiOiJDSCIsIm0iOnRydWUsImdlbiI6M30.rqMmO42yMvoVlIUBNWQrLNSK9vLYHPW3fQmoB-cVdHE; K-ACTION=null; vw=769; dpr=2; AMCVS_17EB401053DAF4840A490D4C%40AdobeOrg=1; s_sq=flipkart-mob-web%3D%2526pid%253Dclp%25253A%252520Grocery%2526pidt%253D1%2526oid%253Dfunctionpo%252528%252529%25257B%25257D%2526oidt%253D2%2526ot%253DDIV; ud=7.ob55YpFv-Bf3TXHcfJwTmITLH6eoN0Q7NeWjazvSV42hbnF7wG57n9V9Za6Wr3Nxuq7IPmx4HntBmpWjShjguBhUmnS9kcU-zgzllxF9MCdqSTrMELWrp3FnXYzibYFOIck0l2jUx9t32J72KmfGFJ_87zf2Fjiko3hMyCdWrU5oGsmp7XwPvmuX_9zSTvDQGeIF9Za51y3KNtae5ez6eg; vd=VIC1AF8F32FC084E8681006A9D9EE93358-1738485018266-1.1738485240.1738485018.154769218; gpv_pn=Your%20smart%20basket%20page%3AGrocery%20Default%20-%20Kilos%20%2724; gpv_pn_t=GROCERY%3Aclp; rt=null; vh=1168; AMCV_17EB401053DAF4840A490D4C%40AdobeOrg=-227196251%7CMCIDTS%7C20121%7CMCMID%7C15161824613499806178582985216688110544%7CMCAID%7CNONE%7CMCOPTOUT-1738492498s%7CNONE; S=d1t14Vz8/Pz8/Pz8hTAkRP0Y/MVejrp+iJqDrG2s3ricrC8IoIS4cru7O8dl+ciinvABsoabm3UhKcheo2PlnF8upiQ==; SN=VIC1AF8F32FC084E8681006A9D9EE93358.TOKF0588ECDBFAD43379C8FEAD426A108AB.1738485299101.LO`,  // Replace xxxx with actual values
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

const processProducts = async (products, category, subcategory) => {
    try {
        const bulkOps = [];
        const now = new Date();
        const productIds = products
            .filter(p => p.stock_status === "in_stock")
            .map(p => p.product_id);

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
            if (product.stock_status !== "in_stock") continue;

            const currentPrice = Number(product.pricing.final_price) || 0;
            const existingProduct = existingProductsMap.get(product.product_id);

            const productData = {
                productId: product.product_id,
                categoryName: category.name,
                subcategoryName: subcategory?.name,
                productName: product.name,
                price: currentPrice,
                mrp: Number(product.pricing.mrp) || 0,
                discount: Math.floor(
                    ((product.pricing.mrp - currentPrice) / product.pricing.mrp) * 100
                ),
                weight: product.weight,
                brand: product.brand,
                imageUrl: product.image_url,
                url: `https://www.flipkart.com${product.product_url}`,
                inStock: product.stock_status === "in_stock",
                updatedAt: now
            };

            if (existingProduct) {
                productData.previousPrice = existingProduct.price;
                const currentDiscount = productData.discount;
                const previousDiscount = existingProduct.discount || 0;

                if (currentDiscount - previousDiscount >= 10) {
                    productData.priceDroppedAt = now;
                    droppedProducts.push({
                        ...productData,
                        previousPrice: existingProduct.price
                    });
                } else {
                    if (existingProduct.priceDroppedAt) {
                        productData.priceDroppedAt = existingProduct.priceDroppedAt;
                    }
                }
            }

            bulkOps.push({
                updateOne: {
                    filter: { productId: product.product_id },
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
    try {
        await fetchCategories();
        console.log('FK: Browser and contexts cleaned up successfully');
    } catch (error) {
        console.error('FK: Error cleaning up browser and contexts:', error);
    }
};

export const fetchCategories = async (pincode) => {
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

        console.log(response.data);
        const slots = response.data.RESPONSE.slots;
        const widgets = slots.map(slot => slot.widget);

        const renderableComponents = widgets.map(widget => widget.data?.renderableComponents).filter(Boolean).flat();
        console.log("renderableComponents", renderableComponents);

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
        console.log("categories", ParentCategories);

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

        console.log("categoriesTree", JSON.stringify(categoriesTree, null, 2));


        //  Extract categories from categoriesTree
        const categoriesSet = new Set();
        categoriesTree.forEach(category => {
            category.substores.forEach(substore => {
                if(substore?.action?.originalUrl) {
                    categoriesSet.add(substore.action.originalUrl);
                }
            });
        });
        const categories = Array.from(categoriesSet);
        console.log("categories", categories);
        return categories;

    } catch (error) {
        console.error('FK: Error fetching categories:', error?.response?.data || error);
        throw new AppError('Failed to fetch Flipkart categories', 500);
    }
};
