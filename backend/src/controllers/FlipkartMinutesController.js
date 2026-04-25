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

        await page.waitForTimeout(3000);

        // Type address in the search box
        const searchInputSelector = '#search';
        await page.waitForSelector(searchInputSelector, { timeout: 10000 });
        await page.focus(searchInputSelector);

        // Use keyboard type to be safe
        await page.keyboard.type(address);
        logger.info(`FK-MINUTES: Typed address: ${address}`);

        await page.waitForTimeout(3000);

        // Click the first suggestion - Use image-based detection as requested
        const selectionDone = await page.evaluate(() => {
            const iconPart = 'LocationDrop-2c16dee9.svg';
            const allImages = [...document.querySelectorAll('img')];
            const locationIcon = allImages.find(img => img.src && img.src.includes(iconPart));

            if (locationIcon) {
                // Find the parent item (usually an li or a div)
                let parent = locationIcon.parentElement;
                while (parent && parent.tagName !== 'LI' && !parent.className.includes('_') && parent.tagName !== 'DIV') {
                    parent = parent.parentElement;
                }
                if (parent) {
                    parent.click();
                    return true;
                }
            }

            return false;
        });

        if (!selectionDone) {
            logger.warn(`FK-MINUTES: Image-based suggestion click failed, trying coordinate-based click as ultimate fallback`);
            await page.mouse.click(400, 200);
        }

        // Check for Confirm button - it only appears if serviceable
        const confirmSelector = '.sVrZD1, input[type="submit"][value="Confirm"]';
        try {
            await page.waitForSelector(confirmSelector, { timeout: 10000 });
        } catch (e) {
            logger.warn("FK-MINUTES: Confirm button did not appear within 10s");
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
        await page.click(confirmSelector);

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

// Grid category selector class (shared by all category grid items on the Minutes home page)
const GRID_CATEGORY_SELECTOR = 'a._3n8fna1co._3n8fna10j._3n8fnaod._3n8fna1._3n8fnac7._1i2djtb9._1i2djtk9._1i2djtir._1i2djtja._1i2djtjb';

// Cached Flipkart API data center base URL — auto-updated on 406 DC Change responses
let cachedDcBaseUrl = "https://1.rome.api.flipkart.com";

// Read the pincode from the browser's localStorage ("mypin" key set by Flipkart after location is confirmed).
// Falls back to parsing a 6-digit number from the address string.
const extractPincode = async (page, address) => {
    try {
        const fromStorage = await page.evaluate(() => {
            const val = localStorage.getItem("mypin");
            return val ? parseInt(val, 10) : null;
        });
        if (fromStorage && !isNaN(fromStorage)) return fromStorage;
    } catch (e) { /* page may not be on a flipkart.com origin yet */ }
    const m = String(address).match(/\b(\d{6})\b/);
    return m ? parseInt(m[1]) : null;
};

// One call to the Flipkart Minutes JSON API (/api/4/page/fetch).
// Runs fetch() inside page.evaluate so the browser handles DNS, cookies, and DC routing.
// Handles 406 DC Change by retrying on the correct regional DC and caching the new base URL.
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

    const result = await page.evaluate(async ({ body, baseUrl }) => {
        const postApi = async (url, b) => {
            const res = await fetch(url + "?cacheFirst=false", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "*/*",
                    "X-User-Agent": navigator.userAgent + " FKUA/msite/0.0.4/msite/Mobile",
                    "flipkart_secure": "true",
                    "Origin": "https://www.flipkart.com",
                    "Referer": "https://www.flipkart.com/",
                },
                body: JSON.stringify(b),
            });
            const data = await res.json().catch(() => ({}));
            return { status: res.status, data };
        };

        try {
            let apiUrl = baseUrl + "/api/4/page/fetch";
            let { status, data } = await postApi(apiUrl, body);

            // On DC Change (406), retry on the correct regional DC
            if (status === 406 && data.RESPONSE?.id && data.RESPONSE?.dc) {
                const newBase = `https://${data.RESPONSE.id}.${String(data.RESPONSE.dc).toLowerCase()}.api.flipkart.com`;
                ({ status, data } = await postApi(newBase + "/api/4/page/fetch", body));
                return { ok: true, status, data, newBaseUrl: newBase };
            }

            return { ok: true, status, data, newBaseUrl: null };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }, { body, baseUrl: cachedDcBaseUrl });

    if (result.newBaseUrl) {
        cachedDcBaseUrl = result.newBaseUrl;
        logger.info(`FK-MINUTES API: DC updated to ${cachedDcBaseUrl}`);
    }

    return result;
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
            const mrp = value.pricing?.mrp?.value ?? price;
            if (price === 0) continue;

            const discount = mrp > price && mrp > 0
                ? Math.round((1 - price / mrp) * 100) : 0;

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

        while (pageNum <= 30) {
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

// Get a dedup key from a category URL using the sid param
const getDedupeKey = (url) => {
    try {
        const urlObj = new URL(url);
        const sid = urlObj.searchParams.get('sid') || '';
        if (sid) return `sid:${sid}`;
        const collectionTab = urlObj.searchParams.get('collection-tab-name') || '';
        if (collectionTab) return `col:${collectionTab}`;
        return `url:${url}`;
    } catch (e) { }
    return `url:${url}`;
};

// Extract a readable category name from a grid link URL
const getCategoryNameFromUrl = (url) => {
    try {
        const urlObj = new URL(url);
        // 1. collection-tab-name (e.g., "Tablets", "Mobiles", "Fragrances")
        const collectionTab = urlObj.searchParams.get('collection-tab-name');
        if (collectionTab) return collectionTab;

        // 2. Readable path segment from /hyperlocal/{Name}/pr
        const pathMatch = urlObj.pathname.match(/\/hyperlocal\/([^/]+)\/pr/);
        if (pathMatch) {
            const raw = decodeURIComponent(pathMatch[1]).replace(/-/g, ' ');
            // Skip coded slugs like "hloc", short codes, or pure digits
            if (raw !== 'hloc' && !/^[a-z0-9]{2,5}$/i.test(raw)) {
                return raw;
            }
        }

        // 3. Store pages: hyperlocal-gifting-nornal-at-store → "Gifting"
        const storeMatch = urlObj.pathname.match(/hyperlocal-(.+?)-(?:at-)?store/);
        if (storeMatch) {
            return storeMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
    } catch (e) { }
    return null;
};

// Extract all categories from Flipkart Minutes home page grid:
// 1. Scroll home page to load the category grid
// 2. Select grid links using exact class selector
// 3. Use fetch() from page context to get sub-nav links from each grid URL (no page navigation needed)
export const extractCategories = async (address) => {
    let page = null;
    try {
        const context = await setLocation(address);

        if (!contextManager.getWebsiteServiceabilityStatus(address, "flipkart-minutes")) {
            throw AppError.badRequest(`Location ${address} is not serviceable by Flipkart Minutes`);
        }

        page = await contextManager.createPage(context, "flipkart-minutes");

        // Step 1: Navigate to a known hyperlocal product page and open the Categories sidebar
        const HYPERLOCAL_PRODUCT_URL = "https://www.flipkart.com/7up-soft-drink-pet-bottle/p/itma5d9c8df05d05?pid=ARDEUATW3MZWKR2H&lid=LSTARDEUATW3MZWKR2HKDI2SC&marketplace=HYPERLOCAL";
        logger.info("FK-MINUTES: Navigating to product page to open categories sidebar...");
        await page.goto(HYPERLOCAL_PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);

        // Click the Categories button in the nav bar (identified by img[alt="Categories"])
        logger.info("FK-MINUTES: Opening categories sidebar...");
        const clickResult = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img[alt="Categories"]'));
            if (imgs.length === 0) return { ok: false, reason: "no Categories img found" };
            const btn = imgs[0].closest("div");
            if (!btn) return { ok: false, reason: "no parent div found" };
            btn.click();
            return { ok: true };
        });
        if (!clickResult.ok) {
            logger.warn(`FK-MINUTES: Categories button click issue: ${clickResult.reason}`);
        }
        await page.waitForTimeout(3000);

        // Step 2: Collect category links from the sidebar (#msite-bottomsheet)
        const listingLinks = await page.evaluate(() => {
            const sidebar = document.getElementById("msite-bottomsheet");
            if (!sidebar) return [];
            return Array.from(sidebar.querySelectorAll("a"))
                .map(a => a.href)
                .filter(href => href && href.includes("www.flipkart.com") && href.includes("/pr?") && href.includes("marketplace=HYPERLOCAL"));
        });

        // Deduplicate by sid
        const seenKeys = new Set();
        const uniqueGridLinks = listingLinks.filter(url => {
            const key = getDedupeKey(url);
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });

        logger.info(`FK-MINUTES: Found ${listingLinks.length} sidebar links → ${uniqueGridLinks.length} unique by sid`);

        // Track how many times each path name is used (to detect "Fruits" reuse)
        const pathNameCounts = {};
        for (const url of uniqueGridLinks) {
            const name = getCategoryNameFromUrl(url);
            if (name) pathNameCounts[name] = (pathNameCounts[name] || 0) + 1;
        }

        // Step 3: Use fetch() from page context to extract sub-nav from each grid URL
        const allCategories = [];
        const seenSubKeys = new Set();

        for (let i = 0; i < uniqueGridLinks.length; i++) {
            const gridUrl = uniqueGridLinks[i];

            try {
                // Fetch HTML and parse sub-nav links inside the browser (has cookies/session)
                const fetchResult = await page.evaluate(async (fetchUrl) => {
                    try {
                        const res = await fetch(fetchUrl, { credentials: 'include', headers: { 'Accept': 'text/html' } });
                        const html = await res.text();

                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');
                        const anchors = Array.from(doc.querySelectorAll('a'));

                        const subNavLinks = anchors
                            .filter(a => {
                                const href = a.getAttribute('href') || '';
                                const text = a.innerText?.trim() || '';
                                return (href.includes('/hyperlocal/') || href.includes('/all/') || href.includes('/eat/')) &&
                                    href.includes('/pr?') &&
                                    href.includes('marketplace=HYPERLOCAL') &&
                                    text.length > 2 &&
                                    text.length < 50 &&
                                    !text.includes('\u20B9') &&
                                    !text.includes('%') &&
                                    text !== 'More';
                            })
                            .map(a => ({
                                name: a.innerText.trim(),
                                href: a.getAttribute('href'),
                            }))
                            .filter((item, idx, self) =>
                                self.findIndex(t => t.href === item.href) === idx
                            );

                        return { ok: true, subNavLinks };
                    } catch (err) {
                        return { ok: false, error: err.message };
                    }
                }, gridUrl);

                if (!fetchResult.ok) {
                    logger.warn(`FK-MINUTES: Fetch failed for grid page ${i + 1}: ${fetchResult.error}`);
                    continue;
                }

                const subNavLinks = fetchResult.subNavLinks;

                // Determine category name
                let categoryName = getCategoryNameFromUrl(gridUrl);
                const isReusedName = categoryName && pathNameCounts[categoryName] > 1;

                if ((!categoryName || isReusedName) && subNavLinks.length > 0) {
                    categoryName = subNavLinks[0].name;
                } else if (!categoryName) {
                    categoryName = `Category ${i + 1}`;
                }

                if (subNavLinks.length > 0) {
                    let addedCount = 0;
                    for (const sub of subNavLinks) {
                        // Convert relative href to absolute URL
                        const subUrl = sub.href.startsWith('http') ? sub.href : `https://www.flipkart.com${sub.href}`;
                        const subKey = getDedupeKey(subUrl);
                        if (!seenSubKeys.has(subKey)) {
                            seenSubKeys.add(subKey);
                            allCategories.push({
                                category: categoryName,
                                subcategory: sub.name,
                                url: subUrl,
                            });
                            addedCount++;
                        }
                    }
                    if (addedCount > 0) {
                        logger.info(`FK-MINUTES: [${i + 1}/${uniqueGridLinks.length}] "${categoryName}" → ${addedCount} subcategories`);
                    }
                } else {
                    // No sub-nav — leaf listing
                    const dedupeKey = getDedupeKey(gridUrl);
                    if (!seenSubKeys.has(dedupeKey)) {
                        seenSubKeys.add(dedupeKey);
                        allCategories.push({
                            category: categoryName,
                            subcategory: categoryName,
                            url: gridUrl,
                        });
                        logger.info(`FK-MINUTES: [${i + 1}/${uniqueGridLinks.length}] "${categoryName}" → leaf listing`);
                    }
                }
            } catch (error) {
                logger.warn(`FK-MINUTES: Error processing grid page ${i + 1}: ${error.message}`);
            }
        }

        logger.info(`FK-MINUTES: Total unique categories/subcategories: ${allCategories.length}`);
        await page.close();
        return allCategories;
    } catch (error) {
        logger.error(`FK-MINUTES: Error extracting categories: ${error.message || error}`, { error });
        if (page) await page.close();
        throw error;
    }
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
                        categoryName: category.category,
                        subcategoryName: category.subcategory,
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
