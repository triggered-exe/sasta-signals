import contextManager from "./src/utils/contextManager.js";
import { setLocation } from "./src/controllers/FlipkartMinutesController.js";
import dotenv from "dotenv";
dotenv.config();

const address = "misri gym 500064";
const PINCODE = 500064;

// A known subcategory URL - use the exact format from the curl sample
const TEST_CATEGORY_URL = "https://www.flipkart.com/hyperlocal/hloc/2001/pr?sid=hloc%2F0020%2F2001&marketplace=HYPERLOCAL";

const explore = async () => {
    console.log("=== FK Minutes: API Fetch Exploration ===\n");

    const context = await setLocation(address);
    const page = await contextManager.createPage(context, "flipkart-minutes");

    // Navigate to flipkart.com so we're in the right domain (cookies are domain-scoped)
    await page.goto("https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Build pageUri from the category URL
    const urlObj = new URL(TEST_CATEGORY_URL);
    const pageUri = urlObj.pathname + urlObj.search;
    console.log("pageUri:", pageUri);

    // Make the API call from within the browser context (inherits session cookies)
    const result = await page.evaluate(async ({ pageUri, pincode }) => {
        const makeApiCall = async (baseUrl, body) => {
            const res = await fetch(baseUrl + "?cacheFirst=false", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "*/*",
                    "X-User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 FKUA/msite/0.0.4/msite/Mobile",
                    "flipkart_secure": "true",
                    "Origin": "https://www.flipkart.com",
                    "Referer": "https://www.flipkart.com/",
                },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            return { status: res.status, data };
        };

        const body = {
            pageUri,
            pageContext: {
                trackingContext: { context: { eVar51: "direct_browse", eVar61: "direct_browse" } },
                networkSpeed: 10000,
            },
            requestContext: {
                type: "BROWSE_PAGE",
                ssid: "fkminutes0000000",
                sqid: crypto.randomUUID(),
            },
            locationContext: { pincode, changed: false },
        };

        try {
            let url = "https://1.rome.api.flipkart.com/api/4/page/fetch";
            let { status, data } = await makeApiCall(url, body);

            // Handle DC Change (406) - retry on the correct DC
            if (status === 406 && data.RESPONSE?.id && data.RESPONSE?.dc) {
                const dcId = data.RESPONSE.id;
                const dcName = data.RESPONSE.dc.toLowerCase();
                url = `https://${dcId}.${dcName}.api.flipkart.com/api/4/page/fetch`;
                console.log(`DC Change: retrying on ${url}`);
                ({ status, data } = await makeApiCall(url, { ...body, requestContext: { ...body.requestContext, sqid: crypto.randomUUID() } }));
            }

            return { ok: true, status, data, finalUrl: url };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }, { pageUri, pincode: PINCODE });

    if (!result.ok) {
        console.error("API call failed:", result.error);
        process.exit(1);
    }

    console.log("HTTP status:", result.status, "| DC URL:", result.finalUrl);
    if (result.status !== 200) {
        console.log("Error response:", JSON.stringify(result.data).substring(0, 500));
        process.exit(1);
    }

    const data = result.data;
    console.log("\nTop-level keys:", Object.keys(data));

    // Try to find slots/widgets
    const pageData = data.RESPONSE || data.data || data;
    console.log("\npageData keys:", Object.keys(pageData));

    // Look for slots
    if (pageData.slots) {
        console.log("\nSlots count:", pageData.slots.length);
        pageData.slots.forEach((slot, i) => {
            const wtype = slot.widget?.type || 'none';
            const pcount = slot.widget?.data?.products?.length || 0;
            console.log(`  Slot ${i}: widget.type=${wtype} | products=${pcount}`);
        });

        // Find product slot(s)
        const productSlots = pageData.slots.filter(s => s.widget?.type === "PRODUCT_SUMMARY_EXTENDED");
        console.log(`\nProduct slots: ${productSlots.length}`);

        const firstSlot = productSlots[0];
        if (firstSlot) {
            const products = firstSlot.widget?.data?.products || [];
            if (products.length > 0) {
                const p = products[0];
                const value = p.productInfo?.value;
                console.log("\nFull pricing object:");
                console.log(JSON.stringify(value?.pricing, null, 2));
                console.log("\nFull value keys:", Object.keys(value || {}));
                // Search for title/name
                const valueStr = JSON.stringify(value);
                const titleMatch = valueStr.match(/"title":"([^"]+)"/);
                const nameMatch = valueStr.match(/"name":"([^"]+)"/);
                console.log("title field:", titleMatch?.[1]);
                console.log("name field:", nameMatch?.[1]);
                // Print segment around "title"
                const idx = valueStr.indexOf('"title"');
                if (idx !== -1) console.log("Around 'title':", valueStr.substring(idx - 20, idx + 200));
            }
        }
    }

    // Test pagination - fetch page 2
    const fedCtx = data.RESPONSE?.pageData?.paginationContextMap?.federator;
    const hasMore = data.RESPONSE?.pageData?.hasMorePages;
    const pageHash = data.RESPONSE?.pageData?.pageHash;
    console.log("\n--- Pagination ---");
    console.log("hasMorePages:", hasMore, "| pageHash:", pageHash);

    if (hasMore && fedCtx) {
        console.log("\nFetching page 2...");
        const page2Result = await page.evaluate(async ({ pageUri, pincode, fedCtx, pageHash }) => {
            const makeApiCall = async (baseUrl, body) => {
                const res = await fetch(baseUrl + "?cacheFirst=false", {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "*/*",
                        "X-User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 FKUA/msite/0.0.4/msite/Mobile",
                        "flipkart_secure": "true",
                        "Origin": "https://www.flipkart.com",
                        "Referer": "https://www.flipkart.com/",
                    },
                    body: JSON.stringify(body),
                });
                return { status: res.status, data: await res.json() };
            };

            const body = {
                pageUri,
                pageContext: {
                    slotContextMap: {},
                    pageHashKey: pageHash,
                    paginatedFetch: true,
                    fetchAllPages: false,
                    paginationContextMap: { federator: fedCtx },
                    pageNumber: 2,
                    trackingContext: { context: { eVar51: "direct_browse", eVar61: "direct_browse" } },
                    networkSpeed: 10000,
                },
                requestContext: { type: "BROWSE_PAGE", ssid: "fkminutes0000000", sqid: crypto.randomUUID() },
                locationContext: { pincode, changed: false },
            };

            try {
                let url = "https://1.rome.api.flipkart.com/api/4/page/fetch";
                let { status, data } = await makeApiCall(url, body);
                if (status === 406 && data.RESPONSE?.id && data.RESPONSE?.dc) {
                    url = `https://${data.RESPONSE.id}.${data.RESPONSE.dc.toLowerCase()}.api.flipkart.com/api/4/page/fetch`;
                    ({ status, data } = await makeApiCall(url, { ...body, requestContext: { ...body.requestContext, sqid: crypto.randomUUID() } }));
                }
                return { ok: true, status, data };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }, { pageUri, pincode: PINCODE, fedCtx, pageHash });

        if (page2Result.ok && page2Result.status === 200) {
            const r2 = page2Result.data.RESPONSE;
            console.log("Page 2 status: 200");
            console.log("Page 2 slots:");
            r2?.slots?.forEach((s, i) => {
                const wtype = s.widget?.type || 'none';
                const pcount = s.widget?.data?.products?.length || 0;
                console.log(`  [${i}] ${wtype} | products=${pcount}`);
            });

            // Find SHOP_PRODUCT_CARD slots or any with products
            const p2Slots = r2?.slots?.filter(s => (s.widget?.data?.products?.length || 0) > 0) || [];
            if (p2Slots.length > 0) {
                const firstProd = p2Slots[0].widget.data.products[0];
                console.log("\nPage 2 first product value:");
                console.log(JSON.stringify(firstProd.productInfo?.value, null, 2).substring(0, 3000));
            }
        } else {
            console.log("Page 2 failed:", page2Result.status, JSON.stringify(page2Result.data).substring(0, 200));
        }
    }

    await page.close();
    await contextManager.cleanup();
    process.exit(0);
};

explore().catch(err => {
    console.error(err);
    contextManager.cleanup().then(() => process.exit(1));
});
