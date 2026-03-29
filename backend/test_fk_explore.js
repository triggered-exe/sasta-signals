import contextManager from "./src/utils/contextManager.js";
import { setLocation } from "./src/controllers/FlipkartMinutesController.js";
import dotenv from "dotenv";
dotenv.config();

const address = "misri gym 500064";

const explore = async () => {
    console.log("=== FK Minutes: fetch() vs page.goto() comparison ===\n");

    const context = await setLocation(address);
    const page = await contextManager.createPage(context, "flipkart-minutes");

    // Visit home page and scroll to load the grid
    const homeUrl = "https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL";
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2000);

    const gridSelector = 'a._3n8fna1co._3n8fna10j._3n8fnaod._3n8fna1._3n8fnac7._1i2djtb9._1i2djtk9._1i2djtir._1i2djtja._1i2djtjb';

    const gridLinks = await page.evaluate((sel) => {
        return Array.from(document.querySelectorAll(sel)).map(a => a.href).filter(Boolean);
    }, gridSelector);

    // Filter to listing pages only
    const listingLinks = gridLinks.filter(url => url.includes('/pr?') && url.includes('marketplace=HYPERLOCAL'));
    console.log(`Found ${listingLinks.length} listing grid links\n`);

    // Test 3 different URLs with fetch() from the page context
    const testUrls = listingLinks.slice(0, 5);

    for (let i = 0; i < testUrls.length; i++) {
        const url = testUrls[i];
        console.log(`\n--- Test ${i + 1}: ${url.substring(0, 100)}... ---`);

        // Approach: use page.evaluate to run fetch() inside the browser (has cookies/session)
        const fetchResult = await page.evaluate(async (fetchUrl) => {
            try {
                const res = await fetch(fetchUrl, {
                    credentials: 'include',
                    headers: { 'Accept': 'text/html' }
                });
                const html = await res.text();

                // Parse the HTML to find sub-nav links
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

                // Also check the title
                const titleMatch = html.match(/<title>([^<]+)<\/title>/);
                const title = titleMatch ? titleMatch[1] : '';

                return {
                    ok: true,
                    htmlLength: html.length,
                    title,
                    subNavLinks,
                    sampleHtml: html.substring(0, 500),
                };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }, url);

        if (fetchResult.ok) {
            console.log(`  HTML length: ${fetchResult.htmlLength}`);
            console.log(`  Title: "${fetchResult.title}"`);
            console.log(`  Sub-nav links: ${fetchResult.subNavLinks.length}`);
            if (fetchResult.subNavLinks.length > 0) {
                console.log(`  Sub-nav names: [${fetchResult.subNavLinks.map(s => s.name).join(', ')}]`);
                console.log(`  Sample href: ${fetchResult.subNavLinks[0].href?.substring(0, 120)}`);
            } else {
                console.log(`  First 500 chars of HTML:`);
                console.log(`  ${fetchResult.sampleHtml}`);
            }
        } else {
            console.log(`  FETCH FAILED: ${fetchResult.error}`);
        }
    }

    await page.close();
    console.log("\n=== Exploration Complete ===");
    await contextManager.cleanup();
    process.exit(0);
};

explore().catch(err => {
    console.error(err);
    contextManager.cleanup().then(() => process.exit(1));
});
