import contextManager from "./src/utils/contextManager.js";
import { setLocation } from "./src/controllers/FlipkartMinutesController.js";
import dotenv from "dotenv";
dotenv.config();

const address = "misri gym 500064";

const explore = async () => {
    console.log("=== FK Minutes: Sidebar Categories Approach ===\n");

    const context = await setLocation(address);
    const page = await contextManager.createPage(context, "flipkart-minutes");

    // Navigate to any product page
    const productUrl = "https://www.flipkart.com/7up-soft-drink-pet-bottle/p/itma5d9c8df05d05?pid=ARDEUATW3MZWKR2H&lid=LSTARDEUATW3MZWKR2HKDI2SC&marketplace=HYPERLOCAL";
    console.log("Navigating to product page...");
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Click the "Categories" button in the nav bar (identified by img[alt="Categories"])
    console.log("Clicking Categories button...");
    const clicked = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img[alt="Categories"]'));
        if (imgs.length === 0) return { ok: false, reason: 'no Categories img found' };
        // Click the parent div
        const btn = imgs[0].closest('div');
        if (!btn) return { ok: false, reason: 'no parent div found' };
        btn.click();
        return { ok: true };
    });
    console.log("Categories button click result:", clicked);

    // Wait for sidebar to open
    await page.waitForTimeout(2000);

    // Check if sidebar appeared
    const sidebarExists = await page.evaluate(() => {
        return !!document.getElementById('msite-bottomsheet');
    });
    console.log(`Sidebar #msite-bottomsheet exists: ${sidebarExists}`);

    if (!sidebarExists) {
        // Try waiting longer
        await page.waitForTimeout(3000);
        const sidebarExistsRetry = await page.evaluate(() => !!document.getElementById('msite-bottomsheet'));
        console.log(`Retry - Sidebar exists: ${sidebarExistsRetry}`);
    }

    // Extract all category links from the sidebar
    const sidebarData = await page.evaluate(() => {
        const sidebar = document.getElementById('msite-bottomsheet');
        if (!sidebar) {
            // Dump what we can see at the top level
            const allIds = Array.from(document.querySelectorAll('[id]')).map(el => el.id).slice(0, 30);
            return { found: false, allIds };
        }

        const anchors = Array.from(sidebar.querySelectorAll('a'));
        const categoryLinks = anchors
            .filter(a => {
                const href = a.href || a.getAttribute('href') || '';
                return href.includes('/pr?') && href.includes('marketplace=HYPERLOCAL');
            })
            .map(a => ({
                href: a.href || a.getAttribute('href'),
                text: a.innerText?.trim() || '',
                imgAlt: a.querySelector('img')?.getAttribute('alt') || '',
            }))
            .filter((item, idx, self) => self.findIndex(t => t.href === item.href) === idx);

        return {
            found: true,
            sidebarHtml: sidebar.innerHTML.substring(0, 1000),
            categoryLinks,
        };
    });

    if (!sidebarData.found) {
        console.log("Sidebar NOT found. Available IDs:", sidebarData.allIds);
    } else {
        console.log(`\nFound ${sidebarData.categoryLinks.length} category links in sidebar`);
        console.log("\nFirst 1000 chars of sidebar HTML:");
        console.log(sidebarData.sidebarHtml);
        console.log("\nCategory links:");
        sidebarData.categoryLinks.forEach((link, i) => {
            console.log(`  ${i + 1}. text="${link.text}" | alt="${link.imgAlt}" | ${link.href?.substring(0, 120)}`);
        });
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
