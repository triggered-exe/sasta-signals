import { AppError } from "../utils/errorHandling.js";
import { AmazonFreshProduct } from "../models/AmazonFreshProduct.js";
import { isNightTimeIST, chunk } from "../utils/priceTracking.js";
import contextManager from "../utils/contextManager.js";
import { productQueries } from "../utils/productQueries.js";
import { sendPriceDropNotifications } from "../services/NotificationService.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import axios from "axios";
import * as cheerio from "cheerio";

// Set location for pincode
const setLocation = async (pincode) => {
    let page = null;
    try {
        // Get or create context
        const context = await contextManager.getContext(pincode);

        // If Amazon Fresh is already set up for this pincode, return the context
        if (
            contextManager.getWebsiteServiceabilityStatus(pincode, "amazonFresh")
        ) {
            console.log(`AF: Using existing serviceable context for ${pincode}`);
            return context;
        }

        // Set up Amazon Fresh for this context
        page = await context.newPage();

        // Navigate and set pincode
        await page.goto("https://www.amazon.in/alm/storefront?almBrandId=ctnow", {
            waitUntil: "domcontentloaded",
        });

        // Refresh the page once
        await page.reload({ waitUntil: "domcontentloaded" });

        // Click on the update location button to open the modal
        await page.waitForSelector("#glow-ingress-block", { timeout: 5000 });
        const updateLocationButton = await page.$("#glow-ingress-block");
        await updateLocationButton.click();

        // Wait for the modal to appear and set the pincode
        await page.waitForSelector("#a-popover-1", { timeout: 5000 });
        // check if the modal visibility is true
        const modalVisible = await page.$eval("#a-popover-1", (el) => el.style.display !== "none");
        if (!modalVisible) {
            throw new Error("Modal is not visible to set location");
        }

        // Fill the pincode input and apply
        await page.waitForSelector('input[id="GLUXZipUpdateInput"]', { timeout: 5000 });
        await page.fill('input[id="GLUXZipUpdateInput"]', pincode);

        const applyButton = await page.waitForSelector("#GLUXZipUpdate", { timeout: 5000 });
        await applyButton.click();
        await page.waitForTimeout(5000);

        // Check if location is serviceable, or the modal still visible
        const notServiceableElement = await page.$(".a-alert-content");
        if (notServiceableElement) {
            const message = await notServiceableElement.textContent();
            if (message.includes("not serviceable")) {
                throw AppError.badRequest(`Location ${pincode} is not serviceable by Amazon Fresh`);
            }
        }

        contextManager.markServiceability(pincode, "amazonFresh", true);
        console.log(`AF: Successfully set up for pincode: ${pincode}`);
        await page.close();
        return context;
    } catch (error) {
        if (page) await page.close();
        contextManager.markServiceability(pincode, "amazonFresh", false);
        console.error(`AF: Error setting pincode ${pincode}:`, error);
        throw error;
    }
};

// Function to extract products from current page
const extractProductsFromPage = async (page) => {
    return await page.evaluate(() => {
        const results = document.querySelectorAll('div[role="listitem"]');
        console.log("AF: Found results:", results.length);

        return Array.from(results)
            .map((el) => {
                try {
                    // Get product title and URL
                    const titleEl = el.querySelector("h2 span");
                    const titleLink = el.querySelector("a.a-link-normal.s-no-outline");

                    // Get price elements - updated selectors for Amazon Fresh
                    const priceEl = el.querySelector('.a-price[data-a-size="xl"] .a-offscreen');
                    const mrpEl = el.querySelector('.a-price[data-a-strike="true"] .a-offscreen');
                    const imageEl = el.querySelector(".s-image");

                    // Extract numeric values with better error handling
                    const priceText = priceEl?.textContent.trim() || "";
                    const mrpText = mrpEl?.textContent.trim() || "";

                    // Improved price parsing
                    const parsePrice = (priceStr) => {
                        // Remove currency symbol and commas, then parse
                        const numStr = priceStr.replace(/[₹,]/g, "");
                        return parseFloat(numStr);
                    };

                    const price = parsePrice(priceText);
                    const mrp = parsePrice(mrpText) || price;

                    const data = {
                        productId: el.getAttribute("data-asin"),
                        productName: titleEl?.textContent.trim() || "",
                        url: titleLink?.getAttribute("href")
                            ? `https://www.amazon.in${titleLink?.getAttribute("href")}`
                            : "",
                        imageUrl: imageEl?.getAttribute("src") || "",
                        price,
                        mrp,
                        discount: mrp > price ? Math.floor(((mrp - price) / mrp) * 100) : 0,
                        inStock: !el.querySelector(".s-result-unavailable-section"),
                    };

                    // Validate the data
                    if (isNaN(data.price) || data.price <= 0) {
                        console.log("AF: Invalid price for product:", data.productName);
                        return null;
                    }

                    return data;
                } catch (err) {
                    console.error("AF: Error extracting product:", err);
                    return null;
                }
            })
            .filter((product) => product && product.productId && product.productName && product.price > 0);
    });
};

// Function to get next page URL
const getNextPageUrl = async (page) => {
    const allPaginationButtons = await page.$$eval(".s-list-item-margin-right-adjustment", (elements) => {
        return elements.map((el) => ({
            text: el.textContent.trim(),
            href: el.querySelector("a")?.getAttribute("href"),
        }));
    });

    const lastButton = allPaginationButtons?.[allPaginationButtons.length - 1];
    return lastButton?.text === "Next" && lastButton.href ? `https://www.amazon.in${lastButton.href}` : null;
};

// Search endpoint handler
export const searchQuery = async (req, res, next) => {
    let page = null;

    try {
        const { query, pincode } = req.body;

        if (!query || !pincode) {
            throw AppError.badRequest("Query and pincode are required");
        }

        // Get or create context for this pincode
        const context = await setLocation(pincode);
        page = await context.newPage();

        const allProducts = await searchAndExtractProducts(page, query, 3);

        // Sort by price
        allProducts.sort((a, b) => a.price - b.price);

        // console.log(`AF: Found total ${allProducts.length} products for query "${query}"`);

        res.status(200).json({
            success: true,
            products: allProducts,
            total: allProducts.length,
            totalPages: Math.ceil(allProducts.length / allProducts.length),
            processedPages: Math.ceil(allProducts.length / allProducts.length),
        });
    } catch (error) {
        console.error("AF: Amazon Fresh error:", error);
        next(error);
    } finally {
        if (page) await page.close();
    }
};

// Function to search and extract products for a query
const searchAndExtractProducts = async (page, query, maxPages = 10) => {
    try {
        console.log(`AF: Searching for "${query}"`);

        // Navigate to search  page
        const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}&i=nowstore`;
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

        // Wait for products
        await page.waitForSelector('div[data-asin][data-component-type="s-search-result"]', { timeout: 5000 });

        let allProducts = [];
        let hasNextPage = true;
        let currentPage = 1;
        const MAX_PAGES = maxPages;

        while (hasNextPage && currentPage <= MAX_PAGES) {
            // Extract products from current page
            const products = await extractProductsFromPage(page);

            allProducts = allProducts.concat(products);
            // console.log(`AF: Found ${products.length} products on page ${currentPage} for ${query}`);

            // Check for next page
            const nextPageUrl = await getNextPageUrl(page);
            if (nextPageUrl && currentPage < MAX_PAGES) {
                await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });
                await page.waitForSelector('div[data-asin][data-component-type="s-search-result"]', { timeout: 5000 });
                currentPage++;
            } else {
                hasNextPage = false;
            }
        }
        const uniqueProducts = Array.from(new Map(allProducts.map((item) => [item.productId, item])).values());
        console.log(`AF: Found ${uniqueProducts.length} unique products out of ${allProducts.length} for ${query}`);
        return uniqueProducts;
    } catch (error) {
        console.error(`AF: Error searching for "${query}":`, error);
        return [];
    }
};

let isTrackingActive = false;

export const startTracking = async (_, res, next) => {
    try {
        const message = await startTrackingHandler();
        res.status(200).json({ message });
    } catch (error) {
        next(error);
    }
};

export const startTrackingHandler = async (pincode = "500064") => {
    // Prevent multiple tracking instances
    if (isTrackingActive) {
        console.log("AF: Tracking is already active");
        return;
    }

    isTrackingActive = true;
    while (true) {
        // Skip if it's night time (12 AM to 6 AM IST)
        if (isNightTimeIST()) {
            console.log("AF: Skipping price tracking during night hours");
            // Wait for 5 minutes before checking night time status again
            await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
            continue;
        }

        try {
            const startTime = new Date();
            console.log("AF: Starting product search at:", startTime.toLocaleString());

            // Get all queries from productQueries
            const queries = [];
            Object.values(productQueries).forEach((category) => {
                Object.values(category).forEach((subcategory) => {
                    subcategory.forEach((query) => {
                        queries.push(query);
                    });
                });
            });

            console.log(`AF: Found ${queries.length} unique search queries`);

            const CONCURRENT_SEARCHES = 2;
            let totalProcessedProducts = 0;

            // Process queries in parallel batches
            const taskChunks = chunk(queries, CONCURRENT_SEARCHES);
            const context = await setLocation(pincode);
            for (const taskChunk of taskChunks) {
                const pages = await Promise.all(taskChunk.map(() => context.newPage()));

                try {
                    // Run searches in parallel
                    const results = await Promise.all(
                        taskChunk.map(async (query, index) => {
                            console.log(`AF: Processing ${query}`);
                            try {
                                const products = await searchAndExtractProducts(pages[index], query, 10);
                                const result = await globalProcessProducts(products, query, {
                                    model: AmazonFreshProduct,
                                    source: "Amazon Fresh",
                                    telegramNotification: true,
                                    emailNotification: false,
                                });
                                const processedCount = typeof result === "number" ? result : result.processedCount;
                                return processedCount;
                            } catch (error) {
                                console.error(`AF: Error processing ${query}:`, error);
                                return 0;
                            }
                        })
                    );

                    totalProcessedProducts += results.reduce((a, b) => a + b, 0);
                } finally {
                    // Close pages after each chunk
                    await Promise.all(pages.map((page) => page.close()));
                }

                // Add delay between chunks
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            const totalDuration = (Date.now() - startTime) / 1000 / 60; // in minutes
            console.log(
                `AF: Completed crawling. Processed ${totalProcessedProducts} products in ${totalDuration.toFixed(
                    2
                )} minutes`
            );

            // Wait for 5 minutes before next iteration
            await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        } catch (error) {
            console.error("AF: Error in tracking handler:", error);
            // Wait for 5 minutes before retrying
            await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        }
    }
};

// Extract Amazon-specific cookies from context
const extractAmazonCookies = async (pincode) => {
    try {
        // Check if we already have stored Amazon Fresh data
        const addressKey = contextManager.cleanAddressKey(pincode);
        if (contextManager.contextMap.has(addressKey)) {
            const contextData = contextManager.contextMap.get(addressKey);
            if (contextData.amazonFreshData) {
                console.log(`AF-API: Using existing Amazon Fresh cookies for ${pincode}`);
                // Return a copy to avoid reference issues
                return { ...contextData.amazonFreshData };
            }
        }

        // Get the context (should already be set up by setLocation)
        const context = await contextManager.getContext(pincode);

        // Extract cookies - filter for Amazon-specific cookies only
        const allCookies = await context.cookies();

        // Filter for Amazon-specific cookies only
        const amazonCookies = allCookies.filter(cookie =>
            cookie.domain.includes('amazon.in') ||
            cookie.domain.includes('.amazon.in') ||
            cookie.domain === 'amazon.in'
        );

        const cookieString = amazonCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

        // Extract important session data from Amazon cookies
        const sessionId = amazonCookies.find(cookie => cookie.name === 'session-id')?.value || '';

        // Store Amazon Fresh data in context
        const amazonFreshData = {
            cookieString,
            sessionId,
            pincode,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        // Store the data in the context
        if (contextManager.contextMap.has(addressKey)) {
            contextManager.contextMap.get(addressKey).amazonFreshData = amazonFreshData;
        }

        console.log(`AF-API: Successfully extracted and stored cookies for pincode: ${pincode}`);
        return amazonFreshData;
    } catch (error) {
        console.error(`AF-API: Error extracting cookies for pincode ${pincode}:`, error);
        throw error;
    }
};

// Extract products from HTML using cheerio - returns both products and next page status
const extractProductsAndPaginationFromHTML = (html) => {
    const $ = cheerio.load(html, {
        // Cheerio options to reduce memory usage
        xml: false,
        decodeEntities: false,
    });

    const products = [];

    $('div[data-component-type="s-search-result"]').each((index, element) => {
        try {
            const $el = $(element);

            // Get product title and URL
            const titleEl = $el.find('h2 span').first();
            const titleLink = $el.find('a.a-link-normal.s-no-outline').first();

            // Get price elements
            const priceEl = $el.find('.a-price[data-a-size="xl"] .a-offscreen').first();
            const mrpEl = $el.find('.a-price[data-a-strike="true"] .a-offscreen').first();
            const imageEl = $el.find('.s-image').first();

            // Extract text values
            const priceText = priceEl.text().trim();
            const mrpText = mrpEl.text().trim();

            // Parse prices
            const parsePrice = (priceStr) => {
                const numStr = priceStr.replace(/[₹,]/g, "");
                return parseFloat(numStr);
            };

            const price = parsePrice(priceText);
            const mrp = parsePrice(mrpText) || price;

            const product = {
                productId: $el.attr('data-asin'),
                productName: titleEl.text().trim(),
                url: titleLink.attr('href') ? `https://www.amazon.in${titleLink.attr('href')}` : '',
                imageUrl: imageEl.attr('src') || '',
                price,
                mrp,
                discount: mrp > price ? Math.floor(((mrp - price) / mrp) * 100) : 0,
                inStock: !$el.find('.s-result-unavailable-section').length,
            };

            // Validate the product data
            if (product.productId && product.productName && !isNaN(product.price) && product.price > 0) {
                products.push(product);
            }
        } catch (err) {
            console.error("AF-API: Error extracting product:", err);
        }
    });

    // Check for next page in the same DOM pass
    const hasNextPage = $('.s-pagination-next').length > 0;

    return { products, hasNextPage };
};

// Search using direct API calls with cookies
const searchWithCookies = async (amazonFreshData, query, maxPages = 3) => {
    let allProducts = [];

    try {
        let currentPage = 1;

        while (currentPage <= maxPages) {
            const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}&i=nowstore&page=${currentPage}`;

            let response;
            try {
                response = await axios.get(searchUrl, {
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'User-Agent': amazonFreshData.userAgent,
                        'Cookie': amazonFreshData.cookieString,
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    },
                    timeout: 15000,
                    maxRedirects: 5,
                    decompress: true,
                    responseType: 'text', // Ensure we get text

                });
            } catch (axiosError) {
                console.error(`AF-API: Axios error for page ${currentPage}:`, axiosError.message);
                break;
            }

            if (response.status !== 200) {
                console.error(`AF-API: HTTP ${response.status} for page ${currentPage}`);
                break;
            }

            // Extract products AND check pagination in a single pass
            const { products, hasNextPage } = extractProductsAndPaginationFromHTML(response.data);

            if (products.length === 0) {
                console.log(`AF-API: No products found on page ${currentPage}, stopping`);
                break;
            }

            allProducts.push(...products); // Use spread instead of concat to avoid array recreation
            console.log(`AF-API: Found ${products.length} products on page ${currentPage}`);

            if (!hasNextPage || currentPage >= maxPages) {
                console.log(`AF-API: ${!hasNextPage ? 'No next page found' : 'Max pages reached'}, stopping at page ${currentPage}`);
                break;
            }

            currentPage++;

            // Add delay between requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Remove duplicates based on productId
        const uniqueProducts = Array.from(new Map(allProducts.map(item => [item.productId, item])).values());
        console.log(`AF-API: Found ${uniqueProducts.length} unique products out of ${allProducts.length} for "${query}"`);

        return uniqueProducts;
    } catch (error) {
        console.error(`AF-API: Error searching for "${query}":`, error.message);
        throw error;
    }
};

// New search endpoint using cookies
export const searchQueryWithCookies = async (req, res, next) => {
    try {
        const { query, pincode } = req.body;

        if (!query || !pincode) {
            throw AppError.badRequest("Query and pincode are required");
        }

        // First ensure location is set up using existing setLocation function
        await setLocation(pincode);

        // Check if the location is serviceable
        if (!contextManager.getWebsiteServiceabilityStatus(pincode, "amazonFresh")) {
            throw AppError.badRequest(`Location ${pincode} is not serviceable by Amazon Fresh`);
        }

        // Extract Amazon cookies for API calls
        const amazonFreshData = await extractAmazonCookies(pincode);

        // Search using direct API calls
        const products = await searchWithCookies(amazonFreshData, query, 3);

        // Sort by price
        products.sort((a, b) => a.price - b.price);

        res.status(200).json({
            success: true,
            products: products,
            total: products.length,
            method: "cookie-based-api",
            totalPages: Math.ceil(products.length / products.length),
            processedPages: Math.ceil(products.length / products.length),
        });
    } catch (error) {
        console.error("AF-API: Amazon Fresh cookie-based search error:", error);

        // Fallback to browser-based search if API fails
        console.log("AF-API: Falling back to browser-based search...");
        try {
            return await searchQuery(req, res, next);
        } catch (fallbackError) {
            console.error("AF-API: Fallback also failed:", fallbackError);
            next(error);
        }
    }
};

// Function to extract categories from Amazon Fresh storefront
export const extractCategories = async (req, res, next) => {
    let page = null;

    try {
        const { pincode } = req.body;

        if (!pincode) {
            throw AppError.badRequest("Pincode is required");
        }

        // Get or create context for this pincode
        const context = await setLocation(pincode);
        page = await context.newPage();

        // Navigate to Amazon Fresh storefront
        await page.goto("https://www.amazon.in/alm/storefront/fresh?almBrandId=ctnow", {
            waitUntil: "domcontentloaded"
        });

        // Wait for categories to load
        await page.waitForSelector('a[href*="/alm/category/"]', { timeout: 10000 });

        // Extract categories using page evaluation
        const categories = await page.evaluate(() => {
            const categories = [];

            // Look for category links in the storefront
            const categoryLinks = document.querySelectorAll('a[href*="/alm/category/"]');

            categoryLinks.forEach(link => {
                try {
                    const href = link.getAttribute('href');
                    const ariaLabel = link.getAttribute('aria-label');
                    const img = link.querySelector('img');

                    // Extract node ID from href
                    const nodeMatch = href.match(/node=(\d+)/);
                    const nodeId = nodeMatch ? nodeMatch[1] : null;

                    // Extract category name from aria-label or img alt
                    let categoryName = ariaLabel;
                    if (!categoryName && img) {
                        categoryName = img.getAttribute('alt');
                    }

                    // Clean up category name
                    if (categoryName) {
                        categoryName = categoryName.replace(/&amp;/g, '&').trim();
                    }

                    // Get image URL
                    const imageUrl = img ? img.getAttribute('src') : '';

                    if (nodeId && categoryName) {
                        categories.push({
                            nodeId,
                            categoryName,
                            imageUrl,
                            url: href.startsWith('http') ? href : `https://www.amazon.in${href}`
                        });
                    }
                } catch (error) {
                    console.error('Error extracting category:', error);
                }
            });

            // Remove duplicates based on nodeId
            const uniqueCategories = Array.from(
                new Map(categories.map(cat => [cat.nodeId, cat])).values()
            );

            return uniqueCategories;
        });

        console.log(`AF: Found ${categories.length} categories for pincode ${pincode}`);

        res.status(200).json({
            success: true,
            categories: categories,
            total: categories.length,
            pincode: pincode
        });

    } catch (error) {
        console.error("AF: Error extracting categories:", error);
        next(error);
    } finally {
        if (page) await page.close();
    }
};

// New tracking handler using cookies
export const startAmazonTrackingWithoutBrowswer = async (pincode = "500064") => {
    console.log("AF-API: Starting cookie-based tracking");

    // Prevent multiple tracking instances
    if (isTrackingActive) {
        console.log("AF-API: Tracking is already active");
        return "Amazon Fresh cookie-based tracking already running";
    }

    // Start the continuous tracking loop
    trackPricesWithoutBrowser(pincode).catch(error => {
        console.error('AF-API: Failed in cookie-based tracking loop:', error);
    });

    return "Amazon Fresh cookie-based price tracking started";
};

// Main tracking function using cookies
const trackPricesWithoutBrowser = async (pincode = "500064") => {
    isTrackingActive = true;

    while (true) {
        // Skip if it's night time (12 AM to 6 AM IST)
        if (isNightTimeIST()) {
            console.log("AF-API: Skipping price tracking during night hours");
            await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
            continue;
        }

        try {
            const startTime = new Date();
            console.log("AF-API: Starting cookie-based product search at:", startTime.toLocaleString());

            // First ensure location is set up using existing setLocation function
            await setLocation(pincode);

            // Extract Amazon cookies for API calls
            const amazonFreshData = await extractAmazonCookies(pincode);

            // Get all queries from productQueries
            const queries = [];
            Object.values(productQueries).forEach((category) => {
                Object.values(category).forEach((subcategory) => {
                    subcategory.forEach((query) => {
                        queries.push(query);
                    });
                });
            });

            console.log(`AF-API: Found ${queries.length} unique search queries`);

            const CONCURRENT_SEARCHES = 1; // for 2 CONCURRENT_SEARCHES, takes around 8 minutes per cycle
            let totalProcessedProducts = 0;

            // Process queries in sequential batches to avoid overwhelming the API
            const taskChunks = chunk(queries, CONCURRENT_SEARCHES);

            for (let i = 0; i < taskChunks.length; i++) {
                try {
                    const taskChunk = taskChunks[i];
                    // Run searches sequentially to avoid rate limiting
                    for (const query of taskChunk) {
                        console.log(`AF-API: Processing ${query}, chunk ${i + 1} of ${taskChunks.length}`);
                        try {
                            const products = await searchWithCookies(amazonFreshData, query, 10);
                                const result = await globalProcessProducts(products, query, {
                                    model: AmazonFreshProduct,
                                    source: "Amazon Fresh (API)",
                                    telegramNotification: true,
                                    emailNotification: false,
                                });
                                const processedCount = typeof result === "number" ? result : result.processedCount;
                                totalProcessedProducts += processedCount;
                        } catch (error) {
                            console.error(`AF-API: Error processing ${query}:`, error);
                        }

                        // Add delay between queries to avoid rate limiting
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                    }
                } catch (error) {
                    console.error("AF-API: Error processing query chunk:", error);
                }

                // Add delay between chunks
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }

            const totalDuration = (Date.now() - startTime) / 1000 / 60; // in minutes
            console.log(
                `AF-API: Completed cookie-based crawling. Processed ${totalProcessedProducts} products in ${totalDuration.toFixed(
                    2
                )} minutes`
            );

            // Wait for 1 minutes before next iteration
            await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
        } catch (error) {
            console.error("AF-API: Error in cookie-based tracking handler:", error);
            // Wait for 1 minutes before retrying
            await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
        }
    }
};