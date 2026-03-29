import contextManager from "./src/utils/contextManager.js";
import { setLocation, extractCategories, extractProductsFromPage } from "./src/controllers/FlipkartMinutesController.js";
import dotenv from "dotenv";

dotenv.config();

const address = "misri gym 500064";

const testCategoryExtraction = async () => {
    console.log("=== FK Minutes Category Extraction Test (Tab-Based) ===\n");

    console.log("--- Step 1: Extract Categories ---");
    const categories = await extractCategories(address);

    console.log(`\nTotal subcategories found: ${categories.length}\n`);

    // Group by parent tab
    const grouped = {};
    for (const cat of categories) {
        if (!grouped[cat.category]) grouped[cat.category] = [];
        grouped[cat.category].push(cat.subcategory);
    }

    console.log("--- Category Hierarchy ---");
    for (const [parent, subs] of Object.entries(grouped)) {
        console.log(`\n${parent} (${subs.length} subcategories):`);
        for (const sub of subs) {
            console.log(`   -> ${sub}`);
        }
    }

    // Step 2: Test product extraction from first 2 categories
    console.log("\n--- Step 2: Test Product Extraction (first 2 categories) ---");
    const context = await setLocation(address);

    for (let i = 0; i < Math.min(2, categories.length); i++) {
        const cat = categories[i];
        const pg = await contextManager.createPage(context, "flipkart-minutes");
        const { products } = await extractProductsFromPage(pg, cat.url, cat.subcategory);
        await pg.close();

        console.log(`\n  "${cat.category} > ${cat.subcategory}": ${products.length} products`);
        if (products.length > 0) {
            const sample = products[0];
            console.log(`    Sample: ${sample.productName} | Rs ${sample.price} (MRP Rs ${sample.mrp}) | ${sample.discount}% off`);
        }
    }

    console.log("\n=== Test Complete ===");
    await contextManager.cleanup();
    process.exit(0);
};

testCategoryExtraction().catch(err => {
    console.error("Test failed:", err);
    contextManager.cleanup().then(() => process.exit(1));
});
