import { isNightTimeIST } from '../utils/priceTracking.js';
import axios from 'axios';
import { BigBasketProduct } from '../models/BigBasketProduct.js';
import { HALF_HOUR } from "../utils/constants.js";
import { bigBasketCategories } from '../utils/bigBasketCategories.js';
import { Resend } from 'resend';
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";
import { AppError } from '../utils/errorHandling.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Global variables
const pincodeData = {};
let trackingInterval = null;

const setCookiesAganstPincode = async (pincode) => {
    let page = null;
    try {
        // Get or create context for this pincode
        const context = await contextManager.getContext(pincode);

        // Return existing context if already set up and serviceable
        if (
            contextManager.isWebsiteSet(pincode, "bigbasket") &&
            contextManager.isWebsiteServiceable(pincode, "bigbasket")
        ) {
            console.log(`BB: Using existing serviceable context for ${pincode}`);
            // Get the stored data from the context
            const contextData = contextManager.contextMap.get(pincode);
            return contextData.bigbasketData || {};
        }

        // Set up BigBasket for this context
        page = await context.newPage();

        // Navigate to BigBasket
        await page.goto('https://www.bigbasket.com/', { waitUntil: 'networkidle' });

        // Wait for the page to be fully loaded
        await page.waitForTimeout(5000);

        // Get all cookies from the browser session
        const cookies = await context.cookies();
        const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

        // Extract csurftoken from cookies
        const csurfCookie = cookies.find(cookie => cookie.name === 'csurftoken');
        const csurfTokenValue = csurfCookie ? csurfCookie.value : '';

        // Initialize cookie data
        const bigbasketData = {
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

        if (!autocompleteData.success) {
            // Mark as not serviceable and clean up
            contextManager.markServiceability(pincode, "bigbasket", false);
            throw AppError.badRequest(`Error in autocomplete request: ${JSON.stringify(autocompleteData.error)}`);
        }

        if (!autocompleteData.data?.predictions) {
            // Mark as not serviceable and clean up
            contextManager.markServiceability(pincode, "bigbasket", false);
            throw AppError.badRequest(`Error fetching autocomplete options for pincode: ${pincode}`);
        }

        // Extract the placeId from the autocomplete response
        const placeId = autocompleteData.data?.predictions?.[0]?.placeId;

        if (!placeId) {
            // Mark as not serviceable and clean up
            contextManager.markServiceability(pincode, "bigbasket", false);
            throw AppError.badRequest(`No placeId found for pincode: ${pincode}`);
        }

        bigbasketData.placeId = placeId;
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

        if (!addressData.success) {
            // Mark as not serviceable and clean up
            contextManager.markServiceability(pincode, "bigbasket", false);
            throw AppError.badRequest(`BB: Error in address details request: ${JSON.stringify(addressData.error)}`);
        }

        // Step 4: check serviceability with cookies
        bigbasketData.lat = addressData.data?.geometry?.location?.lat;
        bigbasketData.lng = addressData.data?.geometry?.location?.lng;

        if (!bigbasketData.lat || !bigbasketData.lng) {
            // Mark as not serviceable and clean up
            contextManager.markServiceability(pincode, "bigbasket", false);
            throw AppError.badRequest(`BB: No location data found for placeId: ${placeId}`);
        }

        console.log('BB: lat', bigbasketData.lat, 'lng', bigbasketData.lng);

        // Close page as we don't need it anymore
        await page.close();
        page = null;

        // Step 5: check serviceability with cookies
        try {
            const serviceabilityResponse = await axios.get(
                `https://www.bigbasket.com/ui-svc/v1/serviceable/?lat=${bigbasketData.lat}&lng=${bigbasketData.lng}&send_all_serviceability=true`,
                {
                    headers: {
                        'accept': '*/*',
                        'cookie': cookieString
                    }
                }
            );

            const area = serviceabilityResponse.data?.places_info?.area || '';
            const contact_zipcode = serviceabilityResponse.data?.places_info?.pincode || '';

            bigbasketData.area = area;
            bigbasketData.contact_zipcode = contact_zipcode;

            // Step 6: Set delivery address with updated cookies
            const deliveryAddressResponse = await axios.put(
                'https://www.bigbasket.com/member-svc/v2/member/current-delivery-address',
                {
                    lat: bigbasketData.lat,
                    long: bigbasketData.lng,
                    return_hub_cookies: false,
                    area: bigbasketData.area,
                    contact_zipcode: bigbasketData.contact_zipcode
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
                        'cookie': bigbasketData.cookieString,
                        'x-csurftoken': bigbasketData.csurfTokenValue
                    }
                }
            );

            // Update cookie string with new cookies from delivery address response
            const newCookies = deliveryAddressResponse.headers['set-cookie'] || [];
            const newCookieString = newCookies.map(cookie => cookie.split(';')[0]).join('; ');
            bigbasketData.cookieStringWithLatLang = bigbasketData.cookieString + '; ' + newCookieString;

            // Store the data in the context and mark as serviceable
            if (contextManager.contextMap.has(pincode)) {
                contextManager.contextMap.get(pincode).bigbasketData = bigbasketData;
                contextManager.contextMap.get(pincode).websites.add("bigbasket");
                contextManager.markServiceability(pincode, "bigbasket", true);
            }

            console.log(`BB: Successfully set up for location: ${pincode}`);
            return bigbasketData;
        } catch (error) {
            // Mark as not serviceable if there's an error in serviceability check
            contextManager.markServiceability(pincode, "bigbasket", false);
            throw error;
        }
    } catch (error) {
        // Mark as not serviceable and clean up
        contextManager.markServiceability(pincode, "bigbasket", false);
        console.error('BB: Error setting cookies for pincode:', error);
        throw error;
    } finally {
        if (page) await page.close();
    }
};

export const searchProducts = async (req, res, next) => {
    const { query, pincode } = req.body;
    try {
        if (!query || !pincode) {
            throw AppError.badRequest("Query and pincode are required");
        }

        // Get or set up cookies for the pincode
        const pincodeData = await setCookiesAganstPincode(pincode);

        // Check if the location is serviceable
        if (!contextManager.isWebsiteServiceable(pincode, "bigbasket")) {
            throw AppError.badRequest(`Location ${pincode} is not serviceable by BigBasket`);
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
                        'cookie': pincodeData.cookieStringWithLatLang,
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
            cookieString: pincodeData.cookieStringWithLatLang
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
        // Transform BigBasket API products to our standard format
        const transformedProducts = products
            .filter(product => product.availability?.avail_status === '001')
            .map(product => {
                const currentPrice = Number(product.pricing?.discount?.prim_price?.sp) || 0;
                const mrp = product.pricing?.discount?.mrp || 0;

                return {
                    productId: product.id,
                    productName: product.desc,
                    categoryName: category.name,
                    categoryId: category.id,
                    subcategoryName: product.category?.mlc_name,
                    subcategoryId: product.category?.mlc_id,
                    inStock: product.availability?.avail_status === '001',
                    imageUrl: product.images?.[0]?.s,
                    mrp: mrp,
                    price: currentPrice,
                    discount: Math.floor(
                        ((mrp - currentPrice) / (mrp || 1)) * 100
                    ),
                    weight: product.w,
                    brand: product.brand?.name,
                    url: `https://www.bigbasket.com${product.absolute_url}`,
                    eta: product.availability?.medium_eta
                };
            });

        // Use the global processProducts function with BigBasket-specific options
        const processedCount = await globalProcessProducts(transformedProducts, category.name, {
            model: BigBasketProduct,
            source: "BigBasket",
            emailNotification: true,
            telegramNotification: true,
        });

        return { processedCount };
    } catch (error) {
        console.error('BB: Error processing products:', error);
        return { processedCount: 0 };
    }
};

const fetchProductsForCategoryInChunks = async (category, pincode) => {
    // Get the BigBasket data from the context
    const contextData = contextManager.contextMap.get(pincode);
    const bigbasketData = contextData?.bigbasketData || {};
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
                        'cookie': bigbasketData.cookieStringWithLatLang,
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
            const result = await processProducts(allProducts, category);
            const processedCount = typeof result === 'number' ? result : result.processedCount;
            console.log(`BB: Completed processing category ${category.name}. Processed ${processedCount} products.`);
        }
    } catch (error) {
        console.error(`BB: Error bulk processing products for category ${category.name}:`, error);
    }
    return allProducts;
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
const trackPrices = async (pincode = "500064") => {
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

            // Set up cookies for the pincode using contextManager
            await setCookiesAganstPincode(pincode);

            // Check if the location is serviceable
            if (!contextManager.isWebsiteServiceable(pincode, "bigbasket")) {
                console.log(`BB: Location ${pincode} is not serviceable, skipping tracking`);
                // Wait for 30 minutes before trying again
                await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000));
                continue;
            }

            const categories = await fetchCategories(); // Contains all the final categories in flattened format
            if (!categories || categories.length === 0) {
                console.log("BB: No categories found");
                continue;
            }

            // Process categories in parallel chunks
            const CATEGORY_CHUNK_SIZE = 2;
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

        } catch (error) {
            console.error('BB: Failed to track prices:', error);
        } finally {
            console.log("BB: Tracking cycle completed at:", new Date().toISOString());
            // Add a small delay before starting the next cycle to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));
        }
    }
};

export const startTrackingHandler = async (pincode = "500064") => {
    console.log("BB: starting tracking");
    // Start the continuous tracking loop without awaiting it
    trackPrices(pincode).catch(error => {
        console.error('BB: Failed in tracking loop:', error);
    });
    return "BigBasket price tracking started";
};

// Route handler for starting the tracking
export const startTracking = async (_, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        console.error('BB: Error starting price tracking:', error);
        next(error instanceof AppError ? error : AppError.internalError('Failed to start price tracking'));
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
export const cleanupBrowser = async (_, res, next) => {
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



