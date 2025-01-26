import { AppError } from '../utils/errorHandling.js';
import { createPage, cleanup, hasStoredLocation, getContextStats, storeContext } from '../utils/crawlerSetup.js';
import { isNightTimeIST } from '../utils/priceTracking.js';
import axios from 'axios';
import { BigBasketProduct } from '../models/BigBasketProduct.js';
import { PAGE_SIZE, HALF_HOUR } from "../utils/constants.js";
import { bigBasketCategories } from '../utils/bigBasketCategories.js';
import { Resend } from 'resend';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Global variables
const pincodeData = {};
let trackingInterval = null;

const setCookiesAganstPincode = async (pincode) => {
    let page = null;
    let context = null;

    try {
        if (!pincodeData[pincode]) {
            // Step 1: Get cookies from browser session
            page = await createPage(pincode, true);
            context = page.context();

            // Navigate to BigBasket
            await page.goto('https://www.bigbasket.com/', { waitUntil: 'networkidle' });

            // Wait for the page to be fully loaded
            await page.waitForTimeout(5000);

            // Get all cookies from the browser session
            const cookies = await context.cookies();
            const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
            // console.log('BB: Browser Cookies:', cookies);

            // Extract csurftoken from cookies
            const csurfCookie = cookies.find(cookie => cookie.name === 'csurftoken');
            const csurfTokenValue = csurfCookie ? csurfCookie.value : '';
            // console.log('BB: CSRF Token:', csurfTokenValue);

            // Initialize cookie data for this pincode
            pincodeData[pincode] = {
                cookieString,
                csurfTokenValue,
                cookieStringWithLatLang: null // Will be updated after setting delivery address
            };

            // Step 2: Navigate to autocomplete URL and get response
            const autocompleteUrl = `https://www.bigbasket.com/places/v1/places/autocomplete/?inputText=${pincode}&token=096872a0-7aed-4c91-8cda-520a5e2f06ee`;
            const autocompleteResponse = await page.goto(autocompleteUrl, { waitUntil: 'networkidle' });
            const autocompleteText = await autocompleteResponse.text();
            let autocompleteData;
            try {
                autocompleteData = { success: true, data: JSON.parse(autocompleteText) };
            } catch (error) {
                console.log('BB: Error parsing autocomplete response:', error);
                autocompleteData = {
                    success: false,
                    error: error.message,
                    response: autocompleteText
                };
            }

            console.log('BB: Autocomplete Response:', autocompleteData);

            if (!autocompleteData.success) {
                throw AppError.badRequest(`Error in autocomplete request: ${JSON.stringify(autocompleteData.error)}`);
            }

            if (!autocompleteData.data?.predictions) {
                throw AppError.badRequest(`Error fetching autocomplete options for pincode: ${pincode}`);
            }

            // Extract the placeId from the autocomplete response
            const placeId = autocompleteData.data?.predictions?.[0]?.placeId;

            if (!placeId) {
                throw AppError.badRequest(`No placeId found for pincode: ${pincode}`);
            }

            pincodeData[pincode].placeId = placeId;
            console.log('BB: got the placeId', placeId);

            // Step 3: Navigate to address details URL and get response
            const addressUrl = `https://www.bigbasket.com/places/v1/places/details?placeId=${placeId}&token=096872a0-7aed-4c91-8cda-520a5e2f06ee`;
            const addressResponse = await page.goto(addressUrl, { waitUntil: 'networkidle' });
            const addressText = await addressResponse.text();
            let addressData;
            try {
                addressData = { success: true, data: JSON.parse(addressText) };
            } catch (error) {
                addressData = {
                    success: false,
                    error: error.message,
                    response: addressText
                };
            }

            console.log('BB: Address Response:', addressData);

            if (!addressData.success) {
                throw AppError.badRequest(`BB: Error in address details request: ${JSON.stringify(addressData.error)}`);
            }

            // Step 4: check serviceability with cookies
            pincodeData[pincode].lat = addressData.data?.geometry?.location?.lat;
            pincodeData[pincode].lng = addressData.data?.geometry?.location?.lng;

            if (!pincodeData[pincode].lat || !pincodeData[pincode].lng) {
                throw AppError.badRequest(`BB: No location data found for placeId: ${placeId}`);
            }

            console.log('BB: lat', pincodeData[pincode].lat, 'lng', pincodeData[pincode].lng);

            // Close browser session now that we have all the data
            await page.close();
            await context.close();

            // Step 5: check serviceability with cookies
            const serviceabilityResponse = await axios.get(
                `https://www.bigbasket.com/ui-svc/v1/serviceable/?lat=${pincodeData[pincode].lat}&lng=${pincodeData[pincode].lng}&send_all_serviceability=true`,
                {
                    headers: {
                        'accept': '*/*',
                        'cookie': cookieString
                    }
                }
            );

            const area = serviceabilityResponse.data?.places_info?.area || '';
            const contact_zipcode = serviceabilityResponse.data?.places_info?.pincode || '';

            pincodeData[pincode].area = area;
            pincodeData[pincode].contact_zipcode = contact_zipcode;
        }

        // Step 6: Set delivery address with updated cookies
        const deliveryAddressResponse = await axios.put(
            'https://www.bigbasket.com/member-svc/v2/member/current-delivery-address',
            {
                lat: pincodeData[pincode].lat,
                long: pincodeData[pincode].lng,
                return_hub_cookies: false,
                area: pincodeData[pincode].area,
                contact_zipcode: pincodeData[pincode].contact_zipcode
            },
            {
                headers: {
                    'accept': '*/*',
                    'content-type': 'application/json',
                    'x-caller': 'bigbasket-pwa',
                    'x-channel': 'BB-PWA',
                    'x-entry-context': 'bb-b2c',
                    'x-entry-context-id': '100',
                    'x-requested-with': 'XMLHttpRequest',
                    'cookie': pincodeData[pincode].cookieString,
                    'x-csurftoken': pincodeData[pincode].csurfTokenValue
                }
            }
        );

        // Update cookie string with new cookies from delivery address response
        const newCookies = deliveryAddressResponse.headers['set-cookie'] || [];
        const newCookieString = newCookies.map(cookie => cookie.split(';')[0]).join('; ');
        pincodeData[pincode].cookieStringWithLatLang = pincodeData[pincode].cookieString + '; ' + newCookieString;

        return pincodeData[pincode];
    } catch (error) {
        console.error('Error setting cookies for pincode:', error);
        pincodeData[pincode] = null;
        throw error;
    }
};

export const searchProducts = async (req, res, next) => {
    const { query, pincode } = req.body;
    try {
        if (!query || !pincode) {
            throw AppError.badRequest("Query and pincode are required");
        }

        // Get or set up cookies for the pincode
        if (!pincodeData[pincode]) {
            await setCookiesAganstPincode(pincode);
        }

        // Make the search call with updated cookies
        let allProducts = [];
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages) {
            const searchResponse = await axios.get(
                `https://www.bigbasket.com/listing-svc/v2/products?type=ps&slug=${encodeURIComponent(query)}&page=${currentPage}`,
                {
                    headers: {
                        'accept': '*/*',
                        'content-type': 'application/json',
                        'cookie': pincodeData[pincode].cookieStringWithLatLang,
                    }
                }
            );

            const products = searchResponse.data?.tabs?.[0]?.product_info?.products || [];

            if (products.length === 0) {
                hasMorePages = false;
                break;
            }

            const processedProducts = products.map(product => ({
                id: product.id,
                name: product.desc,
                brand: product.brand?.name,
                weight: product.w,
                price: product.pricing?.discount?.prim_price?.sp,
                mrp: product.pricing?.discount?.mrp,
                discount: product.pricing?.discount?.d_text,
                image: product.images?.[0]?.s,
                url: `https://www.bigbasket.com${product.absolute_url}`,
                availability: product.availability?.avail_status === '001',
                eta: product.availability?.medium_eta,
                category: {
                    main: product.category?.tlc_name,
                    sub: product.category?.mlc_name,
                    leaf: product.category?.llc_name
                }
            }));

            allProducts = [...allProducts, ...processedProducts];

            // Check if we have more pages based on the total count
            const totalCount = searchResponse.data?.tabs?.[0]?.product_info?.total_count || 0;
            const productsPerPage = 48; // BigBasket's default page size
            hasMorePages = currentPage * productsPerPage < totalCount;

            currentPage++;

            // Add a small delay between requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        res.status(200).json({
            products: allProducts,
            total: allProducts.length,
            cookieString: pincodeData[pincode].cookieStringWithLatLang
        });

    } catch (error) {
        console.error('BigBasket API error details:', {
            pincodeData: pincodeData[pincode],
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            headers: error.response?.headers,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers
            }
        });
        next(error instanceof AppError ? error : AppError.internalError(`Failed to fetch BigBasket products, error: ${error}`));
    }
};

const processProducts = async (products, category) => {
    try {
        const bulkOps = [];
        const now = new Date();
        const productIds = products
            .filter(p => p.availability?.avail_status === '001')
            .map(p => p.id);

        // Get existing products from DB
        const existingProducts = await BigBasketProduct.find({
            productId: { $in: productIds }
        }).lean();

        // Create a map for faster lookups
        const existingProductsMap = new Map(
            existingProducts.map(p => [p.productId, p])
        );

        // Process each product
        for (const product of products) {
            if (product.availability?.avail_status !== '001') continue;

            const currentPrice = product.pricing?.discount?.prim_price?.sp || 0;
            const existingProduct = existingProductsMap.get(product.id);

            const productData = {
                categoryName: category.name,
                categoryId: category.id,
                subcategoryName: product.category?.mlc_name,
                subcategoryId: product.category?.mlc_id,
                productId: product.id,
                inStock: product.availability?.avail_status === '001',
                imageUrl: product.images?.[0]?.s,
                productName: product.desc,
                mrp: product.pricing?.discount?.mrp || 0,
                price: currentPrice,
                discount: Math.floor(((product.pricing?.discount?.mrp || 0) - currentPrice) / (product.pricing?.discount?.mrp || 1) * 100),
                weight: product.w,
                brand: product.brand?.name,
                url: `https://www.bigbasket.com${product.absolute_url}`,
                eta: product.availability?.medium_eta,
                updatedAt: now,
                notified: true
            };

            // if the price didnt change then dont update the product
            if(existingProduct && existingProduct.price === currentPrice){
                continue;
            }

            if (existingProduct) {
                // If price has dropped, update price history
                if (currentPrice < existingProduct.price) {
                    productData.notified = false;
                    productData.previousPrice = existingProduct.price;
                    productData.priceDroppedAt = now;
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
                    filter: { productId: product.id },
                    update: {
                        $set: productData,
                        $setOnInsert: { createdAt: now }
                    },
                    upsert: true
                }
            });
        }

        if (bulkOps.length > 0) {
            const result = await BigBasketProduct.bulkWrite(bulkOps, { ordered: false });
            console.log(`BB: Processed ${bulkOps.length} products for ${category.name} with ${result.upsertedCount} inserts and ${result.modifiedCount} updates`);
        } else {
            console.log("BB: No products to update in", category.name);
        }

        return { processedCount: bulkOps.length };
    } catch (error) {
        console.error('BB: Error in processProducts:', error);
        throw error;
    }
};

const fetchProductsForCategoryInChunks = async (category, pincode) => {
    let allProducts = [];
    let currentPage = 1;
    let hasMorePages = true;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    // First fetch all products
    while (hasMorePages) {
        try {
            const searchResponse = await axios.get(
                `https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=${category.slug}&page=${currentPage}`,
                {
                    headers: {
                        'accept': '*/*',
                        'content-type': 'application/json',
                        'cookie': pincodeData[pincode].cookieStringWithLatLang,
                        'x-channel': 'BB-WEB'
                    }
                }
            );

            const products = searchResponse.data?.tabs?.[0]?.product_info?.products || [];

            if (products.length === 0) {
                hasMorePages = false;
                break;
            }

            allProducts = [...allProducts, ...products];
            currentPage++;
            retryCount = 0; // Reset retry count on successful request
        } catch (error) {
            if (error.response?.status === 429) {
                console.log(`BB: Rate limited for category ${category.name}, waiting before retry...`);
                retryCount++;

                if (retryCount > MAX_RETRIES) {
                    console.error(`BB: Max retries reached for category ${category.name}, moving on...`);
                    break;
                }

                // Wait for progressively longer times between retries (1m, 2m, 3m)
                const waitTime = retryCount * 60 * 1000;
                console.log(`BB: Waiting ${waitTime / 1000} seconds before retry ${retryCount}/${MAX_RETRIES}`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            console.error(`BB: Error processing page ${currentPage} for category ${category.name}:`, error);
            break;
        }
    }

    // Process all products at once
    try {
        if (allProducts.length > 0) {
            console.log(`BB: Processing ${allProducts.length} total products for category ${category.name}`);
            const { processedCount } = await processProducts(allProducts, category);
            console.log(`BB: Completed processing category ${category.name}. Processed ${processedCount} products.`);
        }
    } catch (error) {
        console.error(`BB: Error bulk processing products for category ${category.name}:`, error);
    }
    return allProducts;
};

// Sends Telegram message for products with price drops
const sendTelegramMessage = async (droppedProducts) => {
    try {
        if (!droppedProducts || droppedProducts.length === 0) {
            console.log("BB: No dropped products to send Telegram message for");
            return;
        }

        // Verify Telegram configuration
        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
            console.error("BB: Missing Telegram configuration. Please check your .env file");
            return;
        }

        // Filter products with discount > 59% and sort by highest discount
        const filteredProducts = droppedProducts
            .filter((product) => product.discount > 59)
            .sort((a, b) => b.discount - a.discount);

        if (filteredProducts.length === 0) {
            console.log("BB: No products with discount > 59%");
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
                `<a href="${product.url}">View on BigBasket</a>\n`
            );
        });

        // Split into chunks of 15 products each
        const chunks = [];
        for (let i = 0; i < productEntries.length; i += 15) {
            chunks.push(productEntries.slice(i, i + 15));
        }

        // Send each chunk as a separate message
        for (let i = 0; i < chunks.length; i++) {
            const messageText =
                `🔥 <b>BigBasket Latest Price Drops (Part ${i + 1}/${chunks.length})</b>\n\n` +
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
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error("BB: Error in Telegram message preparation:", error?.response?.data || error);
    }
};

// Sends email notification for products with price drops
const sendEmailWithDroppedProducts = async (sortedProducts) => {
    try {
        // Skip sending email if no dropped products
        if (!sortedProducts || sortedProducts.length === 0) {
            console.log("BB: No dropped products to send email for");
            return;
        }

        console.log(`BB: Attempting to send email for ${sortedProducts.length} dropped products`);

        // Split products into chunks of 50 each
        const chunks = [];
        for (let i = 0; i < sortedProducts.length; i += 50) {
            chunks.push(sortedProducts.slice(i, i + 50));
        }

        // Send email for each chunk
        for (let i = 0; i < chunks.length; i++) {
            const emailContent = `
                <h2>Recently Dropped Products on BigBasket (Part ${i + 1}/${chunks.length})</h2>
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
                subject: `🔥 Price Drops Alert - BigBasket (Part ${i + 1}/${chunks.length}, ${chunks[i].length} products)`,
                html: emailContent,
            });

            console.log(`BB: Email part ${i + 1}/${chunks.length} sent successfully`, response);

            // Add a small delay between emails to avoid rate limiting
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error("BB: Error sending email:", error?.response?.data || error);
        throw error;
    }
};

const processChunk = async (chunk, pincode) => {
    for (const category of chunk) {
        console.log(`BB: Processing category: ${category.name}`);

        // Loop through each subcategory
        const products = await fetchProductsForCategoryInChunks(category, pincode);
        if (products.length > 0) {
            console.log(`BB: Processing ${products.length} total products for category ${category.name}`);
            const { processedCount } = await processProducts(products, category);
            console.log(`BB: Completed processing category ${category.name}. Processed ${processedCount} products.`);
        }
        // await new Promise(resolve => setTimeout(resolve, 5 * 1000)); // 5 seconds delay
    }
};

// Main tracking function (not a route handler)
const trackPrices = async () => {
    while (true) {
        try {
            // Skip if it's night time (12 AM to 6 AM IST)
            if (isNightTimeIST()) {
                console.log("BB: Skipping price tracking during night hours");
                // Wait for 5 minutes before checking night time status again
                await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            console.log("BB: Starting new tracking cycle at:", new Date().toISOString());

            const pincode = '500064'; // Default pincode
            if (!pincodeData[pincode]) {
                await setCookiesAganstPincode(pincode);
            }

            const categories = await fetchCategories(); // Contains all the final categories in flattened format
            if (!categories || categories.length === 0) {
                console.log("BB: No categories found");
                continue;
            }

            // Process categories in parallel chunks
            const CATEGORY_CHUNK_SIZE = 3;
            const categoryChunks = [];
            for (let i = 0; i < categories.length; i += CATEGORY_CHUNK_SIZE) {
                categoryChunks.push(categories.slice(i, i + CATEGORY_CHUNK_SIZE));
            }

            console.log("BB: Starting to fetch products for all categories");

            for (const chunk of categoryChunks) {
                console.log(`BB: Processing chunk ${categoryChunks.indexOf(chunk) + 1} of ${categoryChunks.length}`);
                await processChunk(chunk, pincode);
            }

            console.log("BB: Finished tracking prices for all categories");

            // Find products with price drops in the last 30 minutes
            const priceDrops = await BigBasketProduct.find({
                priceDroppedAt: { $gte: new Date(Date.now() - HALF_HOUR) },
                discount: { $gte: 40 },
                notified: { $exists: true, $eq: false }
            }).sort({ discount: -1 }).lean();

            if (priceDrops.length > 0) {
                console.log(`BB: Found ${priceDrops.length} products with price drops in the last hour`);
                await Promise.all([
                    sendEmailWithDroppedProducts(priceDrops),
                    sendTelegramMessage(priceDrops)
                ]);
            }

            // Mark these products as notified
            const productIds = priceDrops.map(product => product.productId);
            await BigBasketProduct.updateMany(
                { productId: { $in: productIds } },
                { $set: { notified: true } }
            );

        } catch (error) {
            console.error('BB: Failed to track prices:', error);
        } finally {
            console.log("BB: Tracking cycle completed at:", new Date().toISOString());
            // Add a small delay before starting the next cycle to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));
        }
    }
};

export const startTrackingHandler = async () => {
    console.log("BB: starting tracking");
    // Start the continuous tracking loop without awaiting it
    trackPrices().catch(error => {
        console.error('BB: Failed in tracking loop:', error);
    });
    return "BigBasket price tracking started";
};

// Route handler for starting the tracking
export const startTracking = async (req, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        console.error('BB: Error starting price tracking:', error);
        next(error instanceof AppError ? error : AppError.internalError('Failed to start price tracking'));
    }
};

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

export const getProducts = async (req, res, next) => {
    try {
        const {
            page = "1",
            pageSize = PAGE_SIZE.toString(),
            sortOrder = "price",  // price if increasing order, price_desc if decreasing order, discount if discount is descending order order
            priceDropped = "false", // true if price dropped in last hour, false if not
            notUpdated = "false" // if true, then only products that are not updated in last 24 hours will not be fetched
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const sortCriteria = buildSortCriteria(sortOrder);
        const matchCriteria = buildMatchCriteria(priceDropped, notUpdated);

        const totalProducts = await BigBasketProduct.countDocuments(matchCriteria);
        const products = await BigBasketProduct.aggregate([
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
        console.error('BB: Error fetching BigBasket products:', error);
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch BigBasket products'));
    }
};

export const searchProductsUsingCrawler = async (req, res, next) => {
    let page = null;
    let context = null;

    try {
        const { query, pincode } = req.body;

        if (!query || !pincode) {
            throw AppError.badRequest("Query and pincode are required");
        }

        const isNewLocation = !hasStoredLocation(pincode);

        // Create new page with pincode
        page = await createPage(pincode, isNewLocation);
        context = page.context();

        // Check if we need to set location
        if (isNewLocation) {
            // Navigate to BigBasket
            await page.goto('https://www.bigbasket.com/', { waitUntil: 'networkidle' });

            // Set location
            console.log('BB: Setting location...');

            // Click the location selector
            const clickResult = await page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('span')).filter(span =>
                    span.textContent.trim() === 'Select Location'
                );
                if (spans.length > 0) {
                    spans[0].click();
                    return { clicked: true, count: spans.length };
                }
                return { clicked: false, count: spans.length };
            });
            console.log('BB: Click result:', clickResult);

            await page.waitForTimeout(500);

            // Find and fill the input field
            const inputs = await page.$$('input[placeholder="Search for area or street name"]');
            if (inputs.length >= 2) {
                await inputs[1].type(pincode);
                console.log('BB: Entered pincode:', pincode);
            } else {
                throw new Error('BB: Input field for location not found');
            }

            // Handle location dropdown
            try {
                await page.waitForSelector('.overscroll-contain', { timeout: 2000 });

                const locationResult = await page.evaluate(() => {
                    const firstLocation = document.querySelector('.overscroll-contain li');
                    if (firstLocation) {
                        firstLocation.click();
                        return { clicked: true };
                    }
                    return { clicked: false };
                });
                console.log('BB: Location selection result:', locationResult);

                if (!locationResult.clicked) {
                    throw new Error('BB: No locations found in dropdown');
                }

                await page.waitForTimeout(1000);

            } catch (error) {
                throw AppError.badRequest(`BB: Delivery not available for pincode: ${pincode}`);
            }

            // Store the context after location is set successfully
            await storeContext(pincode, context);
        }

        // Navigate directly to search results
        await page.goto(`https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle' });

        // Wait for products
        await page.waitForSelector('.PaginateItems___StyledLi-sc-1yrbjdr-0', { timeout: 10000 });

        // Scroll to load all products
        let hasMore = true;
        while (hasMore) {
            hasMore = await page.evaluate(async () => {
                const knownItem = document.querySelector('.PaginateItems___StyledLi-sc-1yrbjdr-0');
                if (!knownItem) return false;

                const parentContainer = knownItem.closest('ul');
                if (!parentContainer) return false;

                const items = parentContainer.children;
                if (items.length === 0) return false;

                let lastItem = items[items.length - 1];
                const previousCount = items.length;

                lastItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(resolve => setTimeout(resolve, 1000)); // wait for 1 second before checking again

                const newCount = parentContainer.children.length;
                if (newCount >= 100) {
                    parentContainer.children[parentContainer.children.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    console.log('BB: found 50 products');
                    return false;
                }
                return newCount > previousCount;
            });
        }

        // Extract products
        const products = await page.evaluate(async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const knownItem = document.querySelector('.PaginateItems___StyledLi-sc-1yrbjdr-0');
            const parentContainer = knownItem?.closest('ul');
            if (!parentContainer) return [];

            return Array.from(parentContainer.children).map(item => {
                const discountElement = item.querySelector('.Tags___StyledLabel2-sc-aeruf4-1 .font-semibold');
                const priceElement = item.querySelector('.Pricing___StyledLabel-sc-pldi2d-1');
                const mrpElement = item.querySelector('.Pricing___StyledLabel2-sc-pldi2d-2');
                const brandElement = item.querySelector('.BrandName___StyledLabel2-sc-hssfrl-1');
                const nameElement = item.querySelector('.text-darkOnyx-800');
                const imageElement = item.querySelector('img');
                const weightElement = item.querySelector('.PackChanger___StyledLabel-sc-newjpv-1');
                const ratingElement = item.querySelector('.Badges___StyledLabel-sc-1k3p1ug-0');
                const ratingCountElement = item.querySelector('.ReviewsAndRatings___StyledLabel-sc-2rprpc-1');

                const price = priceElement ? parseFloat(priceElement.textContent.replace(/[^\d.]/g, '')) : null;
                const mrp = mrpElement ? parseFloat(mrpElement.textContent.replace(/[^\d.]/g, '')) : price;
                const discount = discountElement ? parseInt(discountElement.textContent) : 0;

                return {
                    name: nameElement ? nameElement.textContent.trim() : '',
                    brand: brandElement ? brandElement.textContent.trim() : '',
                    weight: weightElement ? weightElement.textContent.trim() : '',
                    price: price,
                    mrp: mrp,
                    discount: discount,
                    image: imageElement ? imageElement.src : '',
                    url: item.querySelector('a') ? 'https://www.bigbasket.com' + item.querySelector('a').getAttribute('href') : '',
                    rating: ratingElement ? parseFloat(ratingElement.textContent) : null,
                    ratingCount: ratingCountElement ? parseInt(ratingCountElement.textContent.match(/\d+/)[0]) : 0
                };
            });
        });
        console.log('BB: Products:', products);

        // Filter products with missing values
        // const filteredProducts = products.filter(product => product.name && product.weight && product.price && product.mrp && product.image && product.url);
        // console.log('Filtered Products:', filteredProducts);

        // Clean up
        if (page) {
            await page.close();
        }

        res.status(200).json(products);

    } catch (error) {
        console.error('BB: BigBasket scraping error:', error);
        if (page) {
            await page.close();
        }
        // If there was an error setting location, don't store the context
        if (context && !hasStoredLocation(pincode)) {
            await context.close();
        }
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch BigBasket products'));
    }
};

// Add cleanup endpoint
export const cleanupBrowser = async (req, res, next) => {
    try {
        await cleanup();
        res.status(200).json({ message: 'Browser and contexts cleaned up successfully' });
    } catch (error) {
        next(error);
    }
};

export const fetchCategories = async () => {
    try {
        if (bigBasketCategories.length > 0) {
            return bigBasketCategories;
        }

        const response = await axios.get('https://www.bigbasket.com/ui-svc/v1/category-tree?x-channel=BB-PWA', {
            headers: {
                'accept': '*/*',
                'cookie': 'x-entry-context-id=100; x-entry-context=bb-b2c; _bb_locSrc=default; x-channel=pwa; PWA=1; _bb_bhid=; _bb_nhid=1723; _bb_vid=NTMwOTY4NTcxNTgzMjYwOTEw; _bb_dsevid=; _bb_dsid=; csrftoken=sSY3i39IumZPWGeSdiLTrk75ZfiRARjhsKQW4tBVAB5OBhjBY07myny3Q4z2PAnd; _bb_home_cache=952471fd.1.visitor; _bb_bb2.0=1; _is_tobacco_enabled=0; _is_bb1.0_supported=0; bb2_enabled=true; csurftoken=QrCMGQ.NTMwOTY4NTcxNTgzMjYwOTEw.1735715394543.joobZl7rDu+lkAhAiKkTSPXZkhnQY2GUAUBioJOeYso=; jarvis-id=5852cfbd-07cc-40a0-b3fb-58880d96fc00; ts=2025-01-01%2012:39:59.443; _bb_lat_long=MTcuMzU1ODcwNXw3OC40NTQ0Mjkz; _bb_cid=3; _bb_aid="MzAwNzQ5NTU2Nw=="; is_global=0; _bb_addressinfo=MTcuMzU1ODcwNXw3OC40NTQ0MjkzfE11cmlnaSBDaG93a3w1MDAwNjR8SHlkZXJhYmFkfDF8ZmFsc2V8dHJ1ZXx0cnVlfEJpZ2Jhc2tldGVlcg==; _bb_pin_code=500064; _bb_sa_ids=14657,15113; _bb_cda_sa_info=djIuY2RhX3NhLjEwMC4xNDY1NywxNTExMw==; is_integrated_sa=1'
            }
        });

        let processedCategories = [];

        // Process the categories recursively
        const processCategories = (categories) => {
            if (!Array.isArray(categories)) return [];

            categories.map(category => {
                if (category?.level === 2) {
                    processedCategories.push(category);
                }

                if (category?.children && Array.isArray(category?.children)) {
                    processCategories(category?.children);
                }
            });
        };


        processCategories(response.data?.categories);
        bigBasketCategories = processedCategories;

        return processedCategories;

    } catch (error) {
        console.error('Error fetching categories:', error.response?.data || error.message);
        throw AppError.internalError('Failed to fetch categories');
    }
};



