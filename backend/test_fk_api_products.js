import contextManager from "./src/utils/contextManager.js";
import { setLocation, extractProductsViaAPI } from "./src/controllers/FlipkartMinutesController.js";
import dotenv from "dotenv";
dotenv.config();

const address = "misri gym 500064";
const PINCODE = 500064;

// Test with the Noodles subcategory URL (known to have data)
const TEST_URL = "https://www.flipkart.com/hyperlocal/hloc/2001/pr?sid=hloc%2F0020%2F2001&marketplace=HYPERLOCAL";

const test = async () => {
    console.log("=== FK Minutes: API Product Extraction Test ===\n");

    const context = await setLocation(address);
    const page = await contextManager.createPage(context, "flipkart-minutes");
    // No navigation needed — page.context().request uses the cookie jar from setLocation

    console.log(`\nFetching products from: ${TEST_URL}\n`);
    const start = Date.now();

    const products = await extractProductsViaAPI(page, TEST_URL, PINCODE);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nFound ${products.length} products in ${elapsed}s`);

    // Print samples
    products.slice(0, 10).forEach((p, i) => {
        const pct = p.mrp > p.price ? ` (${p.discount}% off MRP ₹${p.mrp})` : "";
        console.log(`  ${i + 1}. ${p.productName} | ₹${p.price}${pct} | ${p.inStock ? "In Stock" : "OOS"}`);
    });

    if (products.length > 10) {
        console.log(`  ... and ${products.length - 10} more`);
    }

    await page.close();
    console.log("\n=== Test Complete ===");
    await contextManager.cleanup();
    process.exit(0);
};

test().catch(err => {
    console.error(err);
    contextManager.cleanup().then(() => process.exit(1));
});
