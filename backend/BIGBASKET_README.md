# BigBasket Controller

Scrapes and tracks product prices from **BigBasket** (`bigbasket.com`).

Last verified: **2026-10-18**

---

## Current working flow

### 1. Location setup (`setLocation`)

1. Navigate to `https://www.bigbasket.com/`.
2. Click the button whose text contains `select location` (falls back to `change location`, then a location-related attribute selector).
3. Fill `input[placeholder="Search for area or street name"]` with the pincode.
4. Click the first visible suggestion.
5. Verify the "Select Location" button is gone, then mark the location as serviceable.

The location button text is dynamic (for example `Delivery in 45 mins Select Location`), so matching on the stable `select location` substring is intentional.

### 2. Category discovery (`fetchCategories`)

Runs inside the browser so it inherits the location cookies:

```
GET https://www.bigbasket.com/ui-svc/v1/category-tree?x-channel=BB-PWA
```

Only level-0 categories are kept. Each entry stores:

```js
{ id, name, slug, path }
```

`path` is the full category path from the tree (for example `cl/fruits-vegetables`) and is required by the product data route.

### 3. Product listing (`extractProductsFromPage`)

BigBasket's category HTML pages and the legacy product API are blocked by Akamai, so the controller uses the **Next.js data route** instead:

```
GET https://www.bigbasket.com/_next/data/<buildId>/<categoryPath>.json?page=<N>
```

- `<buildId>` comes from `window.__NEXT_DATA__.buildId` on the homepage.
  It is cached in `bigBasketBuildId` and refreshed by `fetchCategories` on every cycle.
- `<categoryPath>` is the category's full path, for example `cl/fruits-vegetables`.
- Each page returns **up to 48 products**.
- Pagination uses `product_info.number_of_pages`; the controller follows pages up to `maxPagesToFetch` (currently **500**).
- Products are read from:

```
pageProps.SSRData.tabs[0].product_info.products
```

The rest of the pipeline (`parseRawProducts`, `globalProcessProducts`, price-drop detection, Telegram alerts) is unchanged.

---

## Category filtering

Filtering is done on the top-level category list only; individual products are not filtered.

`fetchCategories` removes categories whose name contains any of these keywords:

`baby`, `kids`, `child`, `toys`, `women`, `woman`, `girls`, `feminine`, `maternity`, `jewellery`, `jewelry`, `fashion`, `meat`, `fish`, `egg`, `chicken`, `mutton`, `seafood`, `non-veg`, `non veg`.

Currently this removes:

- `Baby Care`
- `Fashion` (BigBasket groups Women's Apparel, Kids Apparel, and Jewellery under Fashion, so the whole category is skipped)
- `Eggs, Meat & Fish`

Example log:

```
BB: Filtered out categories: Fashion, Eggs, Meat & Fish, Baby Care
BB: Fetched N categories
```

Note: filtering is top-level only. Mixed categories such as `Beauty & Hygiene`, `Snacks & Branded Foods`, `Pharmacy & Wellness`, `Food Court`, and `Gourmet & World Food` are kept, so any kids/women's/non-veg products inside them will still be tracked.

---

## Why the legacy API is not used

These return **403 Access Denied** from Akamai:

```
GET /listing-svc/v2/products?type=pc&slug=<slug>&page=<N>
GET /cl/<category>/
GET /pc/<category>/<subcategory>/
```

### UA / browser-fingerprint investigation

Tested on 2026-10-18:

| Fingerprint | Homepage | `v2/products` |
| --- | --- | --- |
| Playwright Chromium 136 (real UA) | 403 | 403 |
| Chrome 131 Linux (project stealth UA) | 200 | 403 |
| Chrome 131 Windows + matching client hints | 200 | 403 |
| Chrome 131 + matching `sec-ch-ua` + `navigator.userAgentData` | 200 | 403 |

Conclusion: the block is **Akamai bot detection / session validation**, not just a user-agent mismatch. A real browser can pass intermittently because it may hold a valid Akamai sensor cookie. Automation consistently fails on `v2/products`, while the `_next/data` route consistently returns **200**.

### `short-list` fallback (limited)

```
GET /listing-svc/v1/short-list?type=pc&slug=<slug>
```

- Returns **200**.
- Returns at most **12 products**.
- Reports `number_of_pages: 1`.
- Ignores `page`, `limit`, `offset`, `bucket_id`, and `sort`.

This was used briefly but is not sufficient for full tracking.

---

## Observed catalog size (2026-10-18)

Measured from the data route across all 15 level-0 categories:

| Metric | Value |
| --- | --- |
| Top-level categories | 15 |
| Total pages | 2,147 |
| Total products | ~102,658 |
| Products per page | up to 48 |

Examples:

| Category | Pages | Products |
| --- | --- | --- |
| Cleaning & Household | 350 | 16,781 |
| Beauty & Hygiene | 338 | 16,187 |
| Kitchen, Garden & Pets | 268 | 12,826 |
| Snacks & Branded Foods | 265 | 12,706 |
| Gourmet & World Food | 146 | 6,980 |
| Beverages | 64 | 3,027 |
| Eggs, Meat & Fish | 31 | 1,466 |
| Baby Care | 32 | 1,524 |
| Fruits & Vegetables | 30 | 1,394 |
| Paan Corner | 1 | 36 |

---

## Operational notes

- **Build ID is deployment-specific.** It changes when BigBasket deploys. The controller reads it from the homepage each cycle and caches it; if the data route starts returning 404s, refresh the build id.
- **Full cycle time:** at roughly 2 seconds per page, 2,147 pages is about **1+ hour** per full cycle, plus the 5-minute pause between cycles.
- **Faster/partial cycles:** lower the `maxPagesToFetch` value passed from `startTrackingHandler` (currently `500`).
- **Rate limiting:** the existing retry loop handles `429` with 30s / 60s / 90s backoff. Other non-OK responses stop that category after logging.
- **Empty categories:** some slugs return an empty response (for example `RX Medicine`); these are skipped safely.
- **Same-origin requirement:** product fetches run via `page.evaluate(fetch(...))`, so the page must first navigate to `https://www.bigbasket.com/`.
- **Do not reintroduce `listing-svc/v2/products`** for tracking without a working Akamai session/proxy; it will make every category fail with 403.

---

## Endpoint reference

| Purpose | Endpoint | Notes |
| --- | --- | --- |
| Category tree | `GET /ui-svc/v1/category-tree?x-channel=BB-PWA` | Works |
| Product listing (full, paginated) | `GET /_next/data/<buildId>/<path>.json?page=<N>` | Works; 48 products/page |
| Legacy product listing | `GET /listing-svc/v2/products?...` | 403 Akamai |
| Short listing | `GET /listing-svc/v1/short-list?...` | 200; only 12 products |
| Category HTML | `GET /cl/<category>/` / `GET /pc/<category>/<subcategory>/` | 403 Akamai |

Example data route:

```
https://www.bigbasket.com/_next/data/mMULtwPCp_FPQcRii8dWw/cl/fruits-vegetables.json?page=2
```

The build id above is only an example; always read the current value from the homepage.

---

## Related provider fixes

- **Zepto**: the category sitemap is blocked; categories are now scraped from the rendered homepage.
- **Instamart**: the old `STORES_MENU` layout API returns 403; categories and subcategory tabs are now read from the current `instamart.in` client state.
