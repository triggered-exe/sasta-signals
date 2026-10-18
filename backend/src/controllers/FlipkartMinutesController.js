import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandling.js";
import { FlipkartMinutesProduct } from "../models/FlipkartMinutesProduct.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";

// Set location for Flipkart Minutes using direct manual location URL
export const setLocation = async (address) => {
    let page = null;
    try {
        // Get or create context
        const context = await contextManager.getContext(address);

        // Return existing context if already set up and serviceable
        if (contextManager.getWebsiteServiceabilityStatus(address, "flipkart-minutes")) {
            logger.info(`FK-MINUTES: Using existing serviceable context for ${address}`);
            return context;
        }

        // Set up Flipkart Minutes for this context
        page = await contextManager.createPage(context, "flipkart-minutes");

        // Direct URL for manual location entry
        const directLocationUrl = "https://www.flipkart.com/rv/checkout/changeShippingAddress/add?marketplace=HYPERLOCAL&source=entry&hideAddressForm=true&isMap=true&addressBSTouchpoint=ENTER_LOCATION_MANUALLY";

        logger.info(`FK-MINUTES: Navigating directly to manual location setting page...`);
        await page.goto(directLocationUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        // Give the checkout page time to initialize the Google autocomplete.
        await page.waitForTimeout(5000);

        // Type address in the search box
        const searchInputSelector = '#search';
        await page.waitForSelector(searchInputSelector, { timeout: 15000 });

        const typeAddress = async () => {
            await page.fill(searchInputSelector, "");
            await page.focus(searchInputSelector);
            // Small delay between keystrokes so the autocomplete request fires reliably
            await page.keyboard.type(address, { delay: 60 });
            logger.info(`FK-MINUTES: Typed address: ${address}`);
            try {
                await page.waitForSelector('img[src*="LocationDrop"]', { timeout: 15000 });
                return true;
            } catch (e) {
                return false;
            }
        };

        let suggestionsVisible = await typeAddress();
        if (!suggestionsVisible) {
            logger.warn("FK-MINUTES: Address suggestions not found, retrying...");
            await page.waitForTimeout(3000);
            suggestionsVisible = await typeAddress();
        }

        if (!suggestionsVisible) {
            throw AppError.badRequest(`Location ${address} is not serviceable by Flipkart Minutes (address suggestion not found)`);
        }

        const selectionDone = await page.evaluate(() => {
            const locationIcon = [...document.querySelectorAll('img')]
                .find(img => img.src && img.src.includes('LocationDrop'));
            const suggestion = locationIcon?.closest('li');
            if (!suggestion) return false;
            suggestion.click();
            return true;
        });

        if (!selectionDone) {
            throw AppError.badRequest(`Location ${address} is not serviceable by Flipkart Minutes (address suggestion not found)`);
        }

        await page.waitForTimeout(2000);

        // Check for Confirm button - it only appears if serviceable
        const confirmSelector = '.sVrZD1, input[type="submit"][value="Confirm"]';
        try {
            await page.waitForSelector(confirmSelector, { timeout: 15000 });
        } catch (e) {
            logger.warn("FK-MINUTES: Confirm button did not appear within 15s");
        }

        const isConfirmVisible = await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.offsetParent !== null;
        }, confirmSelector);

        if (!isConfirmVisible) {
            contextManager.markServiceability(address, "flipkart-minutes", false);
            throw AppError.badRequest(`Location ${address} is not serviceable by Flipkart Minutes (Confirm button not visible after selection)`);
        }

        // Click Confirm
        logger.info("FK-MINUTES: Location is serviceable, clicking Confirm...");
        await page.locator(confirmSelector).first().click();

        // Wait for page to close or redirect
        await page.waitForTimeout(3000);

        // Verify if we actually set it - if we are back to about:blank or store page
        contextManager.markServiceability(address, "flipkart-minutes", true);
        logger.info(`FK-MINUTES: Successfully set location for: ${address}`);

        await page.close();
        return context;
    } catch (error) {
        if (page) {
            try {
                await page.screenshot({ path: `fk_minutes_error_${Date.now()}.png` });
            } catch (e) { }
            await page.close();
        }
        contextManager.markServiceability(address, "flipkart-minutes", false);
        logger.error(`FK-MINUTES: Error setting location for ${address}: ${error.message || error}`);
        throw error;
    }
};

// Cached Flipkart API data center base URL — auto-updated on 406 DC Change responses
let cachedDcBaseUrl = "https://1.rome.api.flipkart.com";

// Read the pincode from the browser's localStorage ("mypin" key set by Flipkart after location is confirmed).
// Falls back to parsing a 6-digit number from the address string.
const extractPincode = async (page, address) => {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const fromStorage = await page.evaluate(() => {
                const val = localStorage.getItem("mypin");
                return val ? parseInt(val, 10) : null;
            });
            if (fromStorage && !isNaN(fromStorage)) return fromStorage;
        } catch (e) { /* page may not be on a flipkart.com origin yet */ }
        await page.waitForTimeout(1000);
    }
    const m = String(address).match(/\b(\d{6})\b/);
    return m ? parseInt(m[1]) : null;
};

// One call to the Flipkart Minutes JSON API (/api/4/page/fetch).
// Uses Playwright's request context so cookies are shared and CORS is bypassed.
// Handles 406 DC Change by retrying across the public *.rome API hosts.
const fkApiPageFetch = async (page, pageUri, pincode, paginationCtx = null, pageNum = 1) => {
    const requestContext = {
        type: "BROWSE_PAGE",
        ssid: "fkmhyperlocal0000",
        sqid: Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10),
    };

    const body = paginationCtx
        ? {
            pageUri,
            pageContext: {
                slotContextMap: {},
                pageHashKey: paginationCtx.pageHash,
                paginatedFetch: true,
                fetchAllPages: false,
                paginationContextMap: { federator: paginationCtx.federatorCtx },
                pageNumber: pageNum,
                trackingContext: { context: { eVar51: "direct_browse", eVar61: "direct_browse" } },
                networkSpeed: 10000,
            },
            requestContext,
            locationContext: { pincode, changed: false },
        }
        : {
            pageUri,
            pageContext: {
                trackingContext: { context: { eVar51: "direct_browse", eVar61: "direct_browse" } },
                networkSpeed: 10000,
            },
            requestContext,
            locationContext: { pincode, changed: false },
        };

    const headers = {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "X-User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 FKUA/msite/0.0.4/msite/Mobile",
        "flipkart_secure": "true",
        "Origin": "https://www.flipkart.com",
        "Referer": "https://www.flipkart.com/",
    };

    try {
        // Use Playwright's request context instead of page.evaluate(fetch()).
        // The API blocks cross-origin browser fetch in some sessions, but the
        // request context shares cookies and is not subject to CORS.
        const fetchPage = async (baseUrl) => {
            const res = await page.request.post(`${baseUrl}/api/4/page/fetch?cacheFirst=false`, {
                data: body,
                headers,
            });
            const data = await res.json().catch(() => ({}));
            return { status: res.status(), data };
        };

        // Try the cached base first, then known working public DC hosts.
        // The 406 response can point at a regional host (e.g. *.hyd.*) that
        // isn't resolvable from every network, so fall back to *.rome.*.
        const candidates = [cachedDcBaseUrl, "https://2.rome.api.flipkart.com", "https://1.rome.api.flipkart.com"];
        const seen = new Set();
        let lastError = null;

        for (const baseUrl of candidates) {
            if (seen.has(baseUrl)) continue;
            seen.add(baseUrl);

            try {
                const { status, data } = await fetchPage(baseUrl);

                if (status === 406) {
                    if (data.RESPONSE?.id) {
                        const next = `https://${data.RESPONSE.id}.rome.api.flipkart.com`;
                        if (!seen.has(next)) candidates.push(next);
                    }
                    continue;
                }

                if (status === 200) {
                    cachedDcBaseUrl = baseUrl;
                    return { ok: true, status, data };
                }

                return { ok: true, status, data };
            } catch (e) {
                lastError = e.message;
            }
        }

        return { ok: false, error: lastError || "All Flipkart API hosts failed" };
    } catch (e) {
        return { ok: false, error: e.message };
    }
};

// Parse product objects from a /api/4/page/fetch JSON response.
// Products live in PRODUCT_SUMMARY_EXTENDED widget slots.
const parseProductsFromApiResponse = (data) => {
    const slots = data?.RESPONSE?.slots || [];
    const products = [];
    const seen = new Set();

    for (const slot of slots) {
        if (slot.widget?.type !== "PRODUCT_SUMMARY_EXTENDED") continue;
        for (const item of (slot.widget?.data?.products || [])) {
            const value = item.productInfo?.value;
            if (!value) continue;

            const actionUrl = item.productInfo?.action?.url || value.baseUrl || "";
            const pid = actionUrl.match(/pid=([^&]+)/)?.[1] || value.id;
            if (!pid || seen.has(pid)) continue;
            seen.add(pid);

            const price = value.pricing?.finalPrice?.value ?? 0;
            const mrpEntry = value.pricing?.prices?.find(p => p.priceType === "MRP");
            const mrp = mrpEntry?.value ?? value.pricing?.mrp?.value ?? price;
            if (price === 0) continue;

            const discount = value.pricing?.totalDiscount
                ?? (mrp > price && mrp > 0 ? Math.round((1 - price / mrp) * 100) : 0);

            // Product name from the SEO-friendly URL slug (e.g. /veeba-instant-noodles.../p/...)
            const slugMatch = actionUrl.match(/^\/([^/]+)\/p\//);
            const productName = slugMatch
                ? slugMatch[1].replace(/-+/g, " ").replace(/\b\w/g, c => c.toUpperCase())
                : "";
            if (!productName) continue;

            const rawImg = value.media?.images?.[0]?.url || "";
            const imageUrl = rawImg
                .replace("{@width}", "200")
                .replace("{@height}", "200")
                .replace("{@quality}", "90");

            products.push({
                productId: pid,
                productName,
                categoryName: value.analyticsData?.category || "",
                subcategoryName: value.analyticsData?.subCategory || "",
                price,
                mrp,
                discount,
                imageUrl,
                url: `https://www.flipkart.com${actionUrl}`,
                inStock: value.availability?.displayState === "IN_STOCK",
            });
        }
    }

    return products;
};

// Fetch all products for a category listing URL via the JSON API.
// Uses a single shared page; no page.goto() required between calls.
export const extractProductsViaAPI = async (page, categoryUrl, pincode) => {
    try {
        const urlObj = new URL(categoryUrl);
        const pageUri = urlObj.pathname + urlObj.search;

        const allProducts = [];
        let paginationCtx = null;
        let pageNum = 1;
        const maxPages = Number(process.env.FK_MINUTES_MAX_PAGES) || (pageUri.includes("sid=all") ? 500 : 30);

        while (pageNum <= maxPages) {
            const result = await fkApiPageFetch(page, pageUri, pincode, paginationCtx, pageNum);

            if (!result.ok || result.status !== 200) {
                logger.warn(`FK-MINUTES API: page ${pageNum} failed (status ${result.status || "error"}, err=${result.error || ""}) for ${pageUri.substring(0, 80)}`);
                break;
            }

            const pageProducts = parseProductsFromApiResponse(result.data);
            allProducts.push(...pageProducts);

            const pageData = result.data?.RESPONSE?.pageData;
            if (!pageData?.hasMorePages || !pageData?.paginationContextMap?.federator) break;

            paginationCtx = {
                pageHash: pageData.pageHash,
                federatorCtx: pageData.paginationContextMap.federator,
            };
            pageNum++;
            // Brief pause between paginated fetches
            await new Promise(r => setTimeout(r, 300));
        }

        // Deduplicate by productId
        const seen = new Set();
        return allProducts.filter(p => {
            if (seen.has(p.productId)) return false;
            seen.add(p.productId);
            return true;
        });
    } catch (error) {
        logger.error(`FK-MINUTES API: Error fetching ${categoryUrl}: ${error.message}`);
        return [];
    }
};

// Extract the category cards from the Flipkart Minutes homepage. The sections
// are rendered lazily as the page is scrolled. Per-product categories are also
// read from analyticsData, which is more specific than the card path.
export const extractCategories = async (address) => {
    let page = null;
    try {
        const context = await setLocation(address);
        page = await contextManager.createPage(context, "flipkart-minutes");
        await page.goto("https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL", {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        await page.waitForTimeout(3000);

        // Scroll until the lazily loaded category sections stop growing.
        await page.evaluate(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            let previousHeight = 0;
            for (let round = 0; round < 3; round++) {
                const height = document.body.scrollHeight;
                if (height === previousHeight) break;
                previousHeight = height;
                for (let y = 0; y < height; y += 700) {
                    window.scrollTo(0, y);
                    await sleep(300);
                }
                window.scrollTo(0, document.body.scrollHeight);
                await sleep(1500);
            }
        });
        await page.waitForTimeout(1000);

        const categories = await page.evaluate(() => {
            let section = "Flipkart Minutes";
            const results = [];
            const seen = new Set();
            const nodes = document.querySelectorAll('div._58bkzqq, a[href*="/pr?sid="]');

            for (const el of nodes) {
                if (el.classList && el.classList.contains("_58bkzqq")) {
                    section = (el.innerText || "").trim();
                    continue;
                }

                const href = el.getAttribute("href") || "";
                let url;
                try {
                    url = new URL(href, window.location.origin);
                } catch (e) {
                    continue;
                }

                if (url.searchParams.get("marketplace") !== "HYPERLOCAL") continue;
                const match = url.pathname.match(/^\/hyperlocal\/([^/]+)\/pr$/);
                if (!match) continue;

                const sid = decodeURIComponent(url.searchParams.get("sid") || "");
                // Main category cards use numeric hloc IDs. Ad/recommendation
                // cards use random IDs (e.g. hloc/8l5j) and are skipped.
                if (!/^hloc\/\d{4}$/.test(sid)) continue;
                if (seen.has(sid)) continue;
                seen.add(sid);

                const name = decodeURIComponent(match[1]).replace(/-/g, " ");
                // Some cards (notably Beauty) reuse the generic /hyperlocal/Fruits/
                // path, so keep the sid in the label. Product analyticsData still
                // provides the real category for stored products.
                const isGenericFruits = name.toLowerCase() === "fruits" && section.toLowerCase() !== "grocery";
                const subcategory = isGenericFruits ? `${name} (${sid.split("/")[1]})` : name;
                results.push({
                    category: section,
                    subcategory,
                    url: `https://www.flipkart.com${url.pathname}${url.search}`,
                });
            }

            return results;
        });

        logger.info(`FK-MINUTES: Extracted ${categories.length} homepage categories`);
        if (categories.length > 0) {
            return categories;
        }
    } catch (error) {
        logger.error(`FK-MINUTES: Error extracting categories: ${error.message || error}`);
    } finally {
        if (page) await page.close();
    }

    logger.warn("FK-MINUTES: Category extraction failed; using the All listing");
    return [{
        category: "All",
        subcategory: "All",
        url: "https://www.flipkart.com/all/pr?sid=all&marketplace=HYPERLOCAL",
    }];
};

// Function to extract products from a Flipkart Minutes listing page
// Minutes uses a React/RN web layout without div[data-id] - products are identified by a[href*="/p/"] links
export const extractProductsFromPage = async (page, url, query) => {
    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await page.waitForTimeout(2000);

        // Check if "no results found" or error page
        const pageState = await page.evaluate(() => {
            const text = document.body.innerText || '';
            if (text.includes('Sorry, no results found')) return 'no-results';
            if (text.includes('Oops! Something broke')) return 'error';
            return 'ok';
        });

        if (pageState !== 'ok') {
            logger.info(`FK-MINUTES: Page state "${pageState}" for "${query}"`);
            return { products: [], nextPageUrl: null };
        }

        // Wait for product links to appear
        try {
            await page.waitForSelector('a[href*="/p/"]', { timeout: 10000 });
        } catch (e) {
            logger.info(`FK-MINUTES: No product links found for "${query}"`);
            return { products: [], nextPageUrl: null };
        }

        // Extract products using product page links
        const products = await page.evaluate(() => {
            const productLinks = document.querySelectorAll('a[href*="/p/"]');
            const seen = new Set();

            return Array.from(productLinks)
                .map(link => {
                    try {
                        const href = link.href;
                        // Extract pid from URL
                        const pidMatch = href.match(/pid=([^&]+)/);
                        const productId = pidMatch ? pidMatch[1] : null;
                        if (!productId || seen.has(productId)) return null;
                        seen.add(productId);

                        // Walk up to the product card container (3 levels up from the link)
                        let container = link.parentElement?.parentElement?.parentElement;
                        if (!container) container = link.parentElement;

                        const text = container.innerText || '';

                        // Product name from the link text
                        const productName = link.innerText?.trim() || '';

                        // Extract prices in order: first ₹ value is MRP (strikethrough), second is selling price
                        const priceMatches = text.match(/₹(\d[\d,]*)/g) || [];
                        const prices = priceMatches.map(p => parseInt(p.replace(/[₹,]/g, '')));

                        let price = 0, mrp = 0;
                        if (prices.length >= 2) {
                            mrp = prices[0];   // First ₹ = MRP (original/strikethrough)
                            price = prices[1]; // Second ₹ = selling price
                        } else if (prices.length === 1) {
                            price = prices[0];
                            mrp = prices[0];
                        }

                        // Extract discount from badge
                        const discountMatch = text.match(/(\d+)%\s*Off/i);
                        const discount = discountMatch
                            ? parseInt(discountMatch[1])
                            : (mrp > price && mrp > 0 ? Math.floor(((mrp - price) / mrp) * 100) : 0);

                        // Find image
                        const img = container.querySelector('img') || link.querySelector('img');
                        const imageUrl = img ? (img.src || img.getAttribute('data-src') || '') : '';

                        if (!productName || price === 0) return null;

                        return {
                            productId,
                            productName,
                            url: href,
                            imageUrl,
                            price,
                            mrp,
                            discount,
                            inStock: !text.toLowerCase().includes('out of stock') && !text.toLowerCase().includes('unavailable'),
                        };
                    } catch (err) {
                        return null;
                    }
                })
                .filter(p => p && p.productName && p.url);
        });

        // Check for "Next" page link
        const nextPageUrl = await page.evaluate(() => {
            const anchors = document.querySelectorAll('a');
            const next = Array.from(anchors).find(a => a.innerText?.trim().toLowerCase() === 'next');
            return next ? next.href : null;
        });

        return {
            products,
            nextPageUrl: nextPageUrl || null,
        };
    } catch (error) {
        logger.error(`FK-MINUTES: Error extracting products from page: ${error.message || error}`, { error });
        return { products: [], nextPageUrl: null };
    }
};

export const startTracking = async (_, res, next) => {
    try {
        startTrackingHandler().catch((error) => {
            logger.error(`FK-MINUTES: Error in tracking handler: ${error.message || error}`, { error });
        });

        res.status(200).json({
            success: true,
            message: "Flipkart Minutes Tracking started",
        });
    } catch (error) {
        next(error);
    }
};

let isTrackingCrawlerRunning = false;

export const startTrackingHandler = async (address = "misri gym 500064") => {
    if (isTrackingCrawlerRunning) {
        logger.info("FK-MINUTES: Tracking is already in progress");
        return;
    }
    isTrackingCrawlerRunning = true;

    while (true) {
        try {
            // Skip if it's night time (12 AM to 6 AM IST)
            if (isNightTimeIST()) {
                logger.info("FK-MINUTES: Skipping price tracking during night hours");
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            const startTime = new Date();
            logger.info(`FK-MINUTES: Starting tracking cycle at: ${startTime.toLocaleString()}`);

            // Set up context with location once for all categories
            const context = await setLocation(address);

            // Check if the location is serviceable
            if (!contextManager.getWebsiteServiceabilityStatus(address, "flipkart-minutes")) {
                logger.info(`FK-MINUTES: Location ${address} is not serviceable, stopping tracking`);
                break;
            }

            // Extract all categories
            const categories = await extractCategories(address);
            logger.info(`FK-MINUTES: Found ${categories.length} categories to process`);

            // Shuffle categories to distribute load evenly
            const shuffledCategories = [...categories].sort(() => Math.random() - 0.5);

            let totalProcessedProducts = 0;

            // Create a page on flipkart.com so page.evaluate(fetch()) runs in the correct
            // browser origin and can resolve regional DC URLs (e.g. 2.hyd.api.flipkart.com).
            // This also makes localStorage (including "mypin") accessible.
            let apiPage = null;
            try {
                apiPage = await contextManager.createPage(context, "flipkart-minutes");
                await apiPage.goto("https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL", {
                    waitUntil: "domcontentloaded",
                    timeout: 30000,
                });
            } catch (err) {
                logger.error(`FK-MINUTES: Failed to create/navigate API page: ${err.message}`);
            }

            // Read pincode from localStorage (set by Flipkart after location confirmation),
            // falling back to parsing the address string
            const pincode = await extractPincode(apiPage, address);
            if (!pincode) {
                logger.warn(`FK-MINUTES: Could not determine pincode for "${address}", API extraction may fail`);
            } else {
                logger.info(`FK-MINUTES: Using pincode ${pincode} for API calls`);
            }

            // Process categories one at a time
            for (let i = 0; i < shuffledCategories.length; i++) {
                const category = shuffledCategories[i];
                const categoryStartTime = new Date();

                try {
                    let categoryProducts = [];

                    if (apiPage && pincode) {
                        // Fast path: JSON API (no page navigation per category)
                        categoryProducts = await extractProductsViaAPI(apiPage, category.url, pincode);
                    } else {
                        // Fallback: HTML scraping
                        const scrapePage = await contextManager.createPage(context, "flipkart-minutes");
                        try {
                            let currentUrl = category.url;
                            let hasNextPage = true;
                            let pageNum = 1;
                            while (hasNextPage) {
                                const { products: pageProducts, nextPageUrl } = await extractProductsFromPage(scrapePage, currentUrl, `${category.category} ${category.subcategory}`);
                                categoryProducts.push(...pageProducts);
                                if (nextPageUrl) { currentUrl = nextPageUrl; pageNum++; await scrapePage.waitForTimeout(1000); }
                                else hasNextPage = false;
                            }
                        } finally {
                            await scrapePage.close();
                        }
                    }

                    // Deduplicate
                    const seen = new Set();
                    const uniqueCategoryProducts = categoryProducts.filter(p => {
                        const key = p.productId || `${p.productName}|${p.price}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });

                    logger.info(`FK-MINUTES: Found ${uniqueCategoryProducts.length} unique products for "${category.category} > ${category.subcategory}"`);

                    // Add category information to products
                    const productsWithCategory = uniqueCategoryProducts.map(product => ({
                        ...product,
                        categoryName: product.categoryName || category.category,
                        subcategoryName: product.subcategoryName || category.subcategory,
                    }));

                    // Process and save products for this category
                    if (productsWithCategory.length > 0) {
                        const processedCount = await processProducts(productsWithCategory);
                        totalProcessedProducts += processedCount;

                        const categoryTime = ((new Date().getTime() - categoryStartTime.getTime()) / 1000).toFixed(2);
                        logger.info(`FK-MINUTES: Processed ${processedCount} products for "${category.category} > ${category.subcategory}" in ${categoryTime}s`);
                    }
                } catch (error) {
                    logger.error(`FK-MINUTES: Error processing category "${category.category} > ${category.subcategory}": ${error.message || error}`, { error });
                }

                // Small delay between categories
                if (i < shuffledCategories.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
            }

            // Close the shared API page
            if (apiPage) {
                await apiPage.close();
                apiPage = null;
            }

            const endTime = new Date();
            const totalDuration = (endTime - startTime) / 1000 / 60;
            logger.info(`FK-MINUTES: Tracking cycle complete. Total processed: ${totalProcessedProducts} in ${totalDuration.toFixed(2)} minutes`);

            // Wait 1 minute before next cycle
            await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
        } catch (error) {
            logger.error(`FK-MINUTES: Error in tracking cycle: ${error.message || error}`, { error });
            // Wait 1 minute before retrying
            await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
        }
    }
};

// Core search function for unified search
export const search = async (location, query) => {
    try {
        const context = await setLocation(location);

        if (!contextManager.getWebsiteServiceabilityStatus(location, "flipkart-minutes")) {
            throw new Error(`Location ${location} is not serviceable by Flipkart Minutes`);
        }

        const page = await contextManager.createPage(context, "flipkart-minutes");

        try {
            let allProducts = [];
            let currentUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}&otracker=search&marketplace=HYPERLOCAL&page=1`;
            let hasNextPage = true;
            let pageNum = 1;

            // Search across multiple pages (limit to 3 for performance)
            while (hasNextPage && pageNum <= 3) {
                logger.info(`FK-MINUTES: Processing search page ${pageNum} for "${query}"`);

                const { products: pageProducts, nextPageUrl } = await extractProductsFromPage(page, currentUrl, query);
                allProducts = [...allProducts, ...pageProducts];
                logger.info(`FK-MINUTES: Found ${pageProducts.length} products on page ${pageNum}`);

                if (nextPageUrl) {
                    currentUrl = nextPageUrl;
                    pageNum++;
                    await page.waitForTimeout(1000);
                } else {
                    hasNextPage = false;
                }
            }

            // Deduplicate
            const uniqueProducts = allProducts.filter(
                (product, index, self) =>
                    index === self.findIndex(
                        (p) =>
                            p.productId === product.productId ||
                            (p.productName === product.productName && p.price === product.price && p.mrp === product.mrp)
                    )
            );

            logger.info(`FK-MINUTES: Found ${uniqueProducts.length} unique products for "${query}"`);

            return {
                success: true,
                products: uniqueProducts,
                total: uniqueProducts.length,
            };
        } finally {
            await page.close();
        }
    } catch (error) {
        logger.error(`FK-MINUTES: Search error: ${error.message || error}`, { error });
        throw error;
    }
};

const processProducts = async (products) => {
    try {
        // Extract weight and unit from product names before processing
        const enrichedProducts = products.map((product) => {
            const weightMatch = product.productName.match(/(\d+\.?\d*)\s*(kg|g|ml|l)\b/i);
            let weight = null;
            let unit = null;

            if (weightMatch) {
                weight = parseFloat(weightMatch[1]);
                unit = weightMatch[2].toLowerCase();

                // Convert to grams/ml for consistency
                if (unit === "kg") {
                    weight *= 1000;
                    unit = "g";
                } else if (unit === "l") {
                    weight *= 1000;
                    unit = "ml";
                }
            }

            let pricePerUnit = null;
            if (weight && (unit === "g" || unit === "ml")) {
                pricePerUnit = (product.price / weight) * 100;
                pricePerUnit = Math.round(pricePerUnit * 100) / 100;
            }

            return {
                ...product,
                weight,
                unit,
                pricePerUnit,
            };
        });

        return await globalProcessProducts(enrichedProducts, "Flipkart Minutes", {
            model: FlipkartMinutesProduct,
            source: "Flipkart Minutes",
            significantDiscountThreshold: 10,
            telegramNotification: true,
            emailNotification: false,
        });
    } catch (error) {
        logger.error(`FK-MINUTES: Error processing products: ${error.message}`);
        return 0;
    }
};
