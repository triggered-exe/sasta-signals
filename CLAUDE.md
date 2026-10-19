# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sasta Signals tracks grocery / quick-commerce prices across Indian platforms (Amazon Fresh, BigBasket, Blinkit,
Flipkart Grocery, Flipkart Minutes, Instamart, JioMart, Meesho, Zepto), stores them in MongoDB, and posts Telegram
alerts on price drops. `backend/` is an Express + Playwright scraper service; `frontend/` is a Next.js app that reads
stored products through the backend API.

## Commands

Both packages use **pnpm** (`packageManager: pnpm@10.11.1`); each has its own `pnpm-lock.yaml`. Don't add npm/yarn lockfiles.

```bash
# Backend (port from PORT, default 8000)
cd backend && pnpm install
pnpm start            # node index.js
pnpm dev              # nodemon — restarts on every file save (and Playwright closes the browser when it does)
npx playwright install chromium   # the scraper uses Chromium (readme.md still says Firefox; it is outdated)

# Frontend (http://localhost:3000, needs NEXT_PUBLIC_BACKEND_URL)
cd frontend && pnpm install
pnpm dev | pnpm build | pnpm lint
```

There is no test suite (`pnpm test` just exits 1). The `backend/test_*.js` files are manual scripts run with
`node test_xxx.js`. Syntax-check edits with `node --check <file>`.

### Which trackers run

`backend/index.js` starts tracking loops after the DB connects:
- `ENVIRONMENT=production` → every provider with a `trackingHandler`, staggered by its `trackingDelay`.
- Otherwise → only the single hard-coded line in the `else` branch (the developer edits it locally to pick one
  provider; don't commit that change).
- `ENVIRONMENT=development` also launches Chromium headful.

### Logs

Winston writes to the console and `backend/logs/{combined,error}.log` unless `DISABLE_FILE_LOGGING=true`. By default
(`REDUCE_CRAWLER_FILE_LOGS` not `false`) info lines from crawler prefixes (`BLINKIT:`, `IM:`, `ZEPTO:`, `JIOMART:`,
`BIGBASKET:`, `FK-MINUTES:` …) are dropped from the file. Set `REDUCE_CRAWLER_FILE_LOGS=false` when debugging a scraper.

## Architecture

### Provider registry drives everything

`backend/src/config/providers.js` (`PROVIDER_REGISTRY`) is the single source of truth. Each entry's fields generate
behaviour elsewhere:
- `model` → `GET /api/:provider/products` (paginated, from MongoDB) via `src/routes/api/providers.js`.
- `searchFn(location, query)` → `POST /api/:provider/search` **and** inclusion in unified search
  (`UnifiedSearchController`, `/api/search`). It must return `{ success, products, total }`. `locationParam`
  (`"pincode"` | `"location"`) controls unified-search validation.
- `search` → a raw Express handler used instead, when the API doesn't fit `(location, query)`.
- `track` / `trackingHandler` / `trackingDefault` / `trackingDelay` → manual trigger and background loop.

The `/api/:provider/:action` router is mounted last in `index.js` so it doesn't shadow `/api/search`,
`/api/monitoring`, `/api/dashboard`.

### Shared browser: `src/utils/contextManager.js`

One Chromium instance; one `BrowserContext` per **location key** (`cleanAddressKey(address)`), shared by every
provider using that location (all pincode-based trackers share `"500064"`). Each context entry carries
`serviceability[website]`, which providers use to skip location setup when it is already done.
- `createPage(context, website)` sets per-site user agents/headers (BigBasket and Instamart need specific ones).
- `markServiceability` is synchronous and must not trigger cleanup.
- Idle cleanup runs only when `MAX_CONTEXTS` (5) is reached, and only reclaims contexts with **no pages and ≥5 min
  idle** (`IDLE_CONTEXT_GRACE_MS`).
- Closed contexts are removed from the map on their `close` event; on browser `disconnected` the map is cleared and
  the next `getContext` relaunches Chromium.

Tracking uses three locations permanently (`500064`, `bahadurpura police station`, `misri gym bahadurpura`).

### Provider pattern

Each controller (`src/controllers/*Controller.js`) implements its own loop: skip 12–6 AM IST (`isNightTimeIST`) →
set location → discover categories → fetch products per category → save → sleep → repeat. Blinkit is the one provider
split into a scraper service (`src/services/scraping/providers/BlinkitScraper.js`) plus a thin controller; that is the
preferred shape for refactors.

Data is fetched either by calling the site's JSON API **from inside the page** (`page.evaluate(fetch(...))`, so
cookies/WAF tokens apply: Blinkit, Instamart) or by DOM scraping (Flipkart Grocery, JioMart).

### Saving and alerts: `src/utils/productProcessor.js`

`processProducts(products, categoryName, { model, source, ... })` bulk-upserts by `productId` but **only writes
products whose price or stock changed**, so "saved 0 products" in logs usually means nothing changed, not a failure.
It sends Telegram alerts when a price dropped and discount rose by ≥ `significantDiscountThreshold` (and for new
products at ≥90% off).

### Provider docs

`backend/*_README.md` (BigBasket, JioMart, Flipkart Grocery, Flipkart Minutes) describe each site's current flow,
endpoints and why previous versions broke. Update the relevant one when changing a scraper; add one for providers
that lack it.

## Testing scrapers safely

Running a tracker for real writes to the production MongoDB (`MONGO_URI` in `backend/.env`) and can post Telegram
alerts. To exercise scraper code without side effects:
- Call the scraper/extract functions directly from a script and don't call the save path. Most helpers aren't
  exported, so copy the controller to a temp file (e.g. `src/controllers/_probe_tmp.js`), append an
  `export { ... }` line, and replace the `globalProcessProducts` import with a stub that logs counts. Delete the
  temp file afterwards.
- Run with `ENVIRONMENT=production` set in the script for headless Chromium.
- Read-only DB checks are fine (`countDocuments`, `diffIndexes`); don't write.

## Key decisions

Why things are the way they are; check here before "simplifying" any of these.

| Area | Decision | Rejected alternative and why |
|---|---|---|
| Blinkit | Category links are `/dc/<cat>/<sub>/?collection_uuid=…&collection_group_id=…`; `listing_widgets` is called with the same query params from inside the page. Wait for `/categories` to hydrate (>20 links) before reading it. | `l0_cat`/`l1_cat` from `/cn/.../cid/` URLs: retired, returns no data. A JSON body for `listing_widgets` needs extra session headers. |
| Blinkit | The listing API returns 429 (Cloudflare) after ~37 fast requests; it clears in ~10 s. The 10/20/40 s backoff in `extractProducts` is required. | Faster pacing without backoff loses categories. |
| Instamart | Stop paging a subcategory only when a **whole page** is out of stock. | Stopping at the first out-of-stock item: stray ones appear among in-stock items, so most subcategories were cut to page 1 (~⅔ of products lost). |
| Instamart | Empty `data` with a `statusMessage` (e.g. "filter id is not present", brand tabs like `nectr`) is skipped; empty without one (wrapped 429) is retried. | Treating every empty response as "no products". |
| Instamart | After a 403, delete `deviceId`/`aws-waf-token`, reload `/instamart` and wait with `ensurePageLoaded` (the WAF challenge page navigates a second time) before retrying. | Continuing after `domcontentloaded`: requests hit the challenge page and the context gets destroyed mid-`evaluate`. |
| Instamart | Search uses `instamart.in/api/instamart/search/v2`, called **from a browser page**, with the location's `storeId` (from `setLocation` + `extractBrowserData`). No hard-coded cookies. | `www.swiggy.com/api/instamart/search`: retired (403). Server-side axios to v2: works ~15 requests, then CloudFront/WAF returns empty bodies. Without `storeId`, results come from a default (Bangalore) store. |
| Instamart | `discount` is computed from `mrp` and offer price in `transformProducts`. | The API's `discountValue` is sometimes `"0"` even when price < MRP. |
| Instamart | `Health and Pharma` is skipped at 500064 (its category page redirects to search, no subcategory tabs). | — |
| Flipkart Grocery | Categories come from walking the tree: store page + `grocery/pr?sid=73z` root → each top-level `/grocery/<cat>/pr` page; de-duplicated by `<cat>/<sub>` with `page=` stripped (~49 subcategories). | Store page links only: 13 subcategories, with duplicates (`page=3` variants returning 0). |
| Flipkart Grocery | Location setup waits for any input selector at once (15 s), waits for a suggestion matching the pincode, and retries the whole flow up to 3× on a fresh page. Only "Minutes is active" counts as definitively unserviceable. | Per-selector 5 s waits gave up before the slow modal opened; an unmatched suggestion was silently skipped and reported as "not serviceable". |
| contextManager | Cleanup = no pages **and** idle ≥5 min, only at the context limit; never from `markServiceability`. `MAX_CONTEXTS = 5`. | Closing any context with 0 pages on every `markServiceability`: closed contexts other providers were between pages on. A cap of 3 left no room for searches. |
| Models | `productId` is indexed once, via `unique: true` on the field (Instamart's unique key is `variationId`, so its plain `productId` index is intentional). | Also declaring `schema.index({ productId: 1 })`: duplicates the key and makes `syncIndexes()` fail with an index-options conflict. |
| Tooling | pnpm only, one `pnpm-lock.yaml` per package; root-level and npm/yarn lockfiles are git-ignored. | Mixed npm/pnpm lockfiles (non-reproducible installs). |

Known limitation: Flipkart Grocery's `chips-namkeen-snacks` redirects to `/chipsnamkeen-snacks/`, which shows 40
products with no pagination.
