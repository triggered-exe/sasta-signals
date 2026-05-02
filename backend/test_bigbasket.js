/**
 * BigBasket scraper test — uses real contextManager for stealth
 * Run: node test_bigbasket.js
 */
import contextManager from "./src/utils/contextManager.js";

const PINCODE = "500064";
const LISTING_HEADERS = {
  "accept": "*/*",
  "x-channel": "BB-WEB",
  "x-entry-context": "bbnow",
  "x-entry-context-id": "10",
  "osmos-enabled": "true",
};

async function main() {
  console.log("=== BigBasket Scraper Test ===\n");
  let page = null;
  const context = await contextManager.getContext(PINCODE);

  try {
    // ── Step 1: Open page, set location ──────────────────────────────────────
    console.log(`[1] Setting location (pincode: ${PINCODE})...`);
    page = await contextManager.createPage(context, "bigbasket");
    await page.goto("https://www.bigbasket.com/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const blocked = await page.evaluate(() => document.querySelector("h1")?.textContent.includes("Access Denied"));
    if (blocked) { console.error("BLOCKED: Access Denied"); process.exit(1); }

    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, div[role="button"]'))
        .find(b => b.textContent?.toLowerCase().includes("select location"));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) {
      const input = await page.waitForSelector('input[placeholder="Search for area or street name"]', { timeout: 5000 }).catch(() => null);
      if (input) {
        await input.fill(PINCODE);
        await page.waitForTimeout(3000);
        await page.evaluate(() => {
          const opt = document.querySelector('[role="option"]') || document.querySelector('[role="listbox"] li');
          if (opt) opt.click();
        });
        await page.waitForTimeout(4000);
      }
    }
    console.log("    done\n");

    // ── Step 2: Category tree ─────────────────────────────────────────────────
    console.log("[2] Fetching category tree...");
    const categories = await page.evaluate(async () => {
      try {
        const res = await fetch("https://www.bigbasket.com/ui-svc/v1/category-tree?x-channel=BB-PWA", { credentials: "include" });
        const text = await res.text();
        if (!res.ok || !text) return { error: `HTTP ${res.status} empty=${!text}` };
        const data = JSON.parse(text);
        const results = [];
        const walk = (cats) => {
          if (!Array.isArray(cats)) return;
          for (const cat of cats) {
            if (cat.level === 0) results.push({ id: cat.id, name: cat.name, slug: (cat.url || "").replace(/^\/|\/$/g, "") });
            if (cat.children) walk(cat.children);
          }
        };
        walk(data.categories);
        return results;
      } catch (e) { return { error: String(e) }; }
    });

    if (!Array.isArray(categories)) { console.error("FAILED:", categories); process.exit(1); }
    console.log(`    Got ${categories.length} categories:`);
    categories.forEach(c => console.log(`    - ${c.name} (slug: ${c.slug})`));
    console.log();

    // ── Step 3: Test listing-svc — try different slug formats ────────────────
    for (const testCat of [categories.find(c => c.name.toLowerCase().includes("beverage")) || categories[0]]) {
      const slugFull = testCat.slug;            // cl/beverages
      const slugStripped = slugFull.replace(/^cl\//, "");  // beverages

      for (const [label, slug] of [["full (cl/...)", slugFull], ["stripped", slugStripped]]) {
        console.log(`[3] listing-svc slug=${slug} (${label})...`);
        const r = await page.evaluate(async ({ slug, headers }) => {
          const url = `https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=${slug}&page=1&sort=dphtl`;
          const res = await fetch(url, { credentials: "include", headers });
          const text = await res.text();
          return { status: res.status, length: text.length, preview: text.slice(0, 200) };
        }, { slug, headers: LISTING_HEADERS });
        console.log(`    status=${r.status} bodyLen=${r.length}`);
        if (r.length > 0) console.log(`    preview: ${r.preview}`);

        if (r.status === 200 && r.length > 10) {
          console.log("\n[4] Parsing products from that response...");
          const parsed = await page.evaluate(async ({ slug, headers }) => {
            const url = `https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=${slug}&page=1&sort=dphtl`;
            const res = await fetch(url, { credentials: "include", headers });
            const data = await res.json();
            const info = data.tabs?.[0]?.product_info;
            return {
              totalPages: info?.number_of_pages,
              totalCount: info?.total_count,
              productsOnPage: info?.products?.length,
              first: info?.products?.[0]
                ? { id: info.products[0].id, name: info.products[0].desc, price: info.products[0].pricing?.discount?.prim_price?.sp }
                : null,
            };
          }, { slug, headers: LISTING_HEADERS });
          console.log("    Result:", JSON.stringify(parsed, null, 2));
          console.log("\n✅ WORKING slug format:", slug);
          return;
        }
        console.log();
      }
    }
    console.log("❌ Neither slug format worked — investigate further.");

  } catch (err) {
    console.error("FATAL:", err.message, "\n", err.stack);
  } finally {
    if (page && !page.isClosed()) await page.close();
    try { await contextManager.cleanupAllContexts(); } catch (_) {}
    console.log("\n=== Test complete ===");
  }
}

main();
