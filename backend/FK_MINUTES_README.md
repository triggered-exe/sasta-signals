# Flipkart Minutes Controller

Scrapes and tracks product prices from **Flipkart Minutes** (hyperlocal quick-delivery marketplace).

## Architecture

```
FlipkartMinutesController.js
├── setLocation(address)          — Set hyperlocal delivery location
├── extractCategories(address)    — Discover all categories from home page grid
├── extractProductsFromPage()     — Extract products from a listing page
├── startTrackingHandler(address) — Continuous tracking loop
├── search(location, query)       — Unified search across Minutes
└── processProducts(products)     — Enrich & save to MongoDB
```

## How It Works

### 1. Location Setup (`setLocation`)

Navigates to Flipkart's manual location entry page, types the address, selects the first suggestion, and clicks Confirm. Uses `contextManager` to persist the browser context across calls.

- URL: `flipkart.com/rv/checkout/changeShippingAddress/add?marketplace=HYPERLOCAL`
- Detects serviceability via Confirm button visibility
- Caches context — subsequent calls reuse the existing session

### 2. Category Extraction (`extractCategories`)

Discovers all product categories from the Minutes home page in two steps:

**Step 1 — Grid discovery:** Scrolls the home page to load the category grid (image tiles). Uses a specific CSS class selector (`GRID_CATEGORY_SELECTOR`) to precisely target the ~40 grid `<a>` tags. Filters to listing pages (`/pr?` URLs) and deduplicates by `sid` param.

**Step 2 — Sub-nav extraction via `fetch()`:** For each grid link, runs `fetch()` inside the browser context (inherits cookies/session) and parses the response HTML with `DOMParser`. Extracts sub-nav links (subcategories) from the fetched HTML. This avoids navigating to each page (~40s total vs ~3min with page navigation).

**Category naming logic:**

- Uses `collection-tab-name` URL param if present (e.g., "Tablets", "Mobiles")
- Uses readable path segment from `/hyperlocal/{Name}/pr` (e.g., "Atta-Rice-Dal" → "Atta Rice Dal")
- If the path name is reused across multiple sids (e.g., "Fruits" appears 10+ times for unrelated categories), falls back to the first sub-nav link text (e.g., "Shower Gels", "Bedsheets", "Women's Ethnic")
- Skips coded URL slugs (e.g., "3001", "olpe", "vzsp")

**Output:** Array of `{ category, subcategory, url }` — typically ~490 entries across ~39 parent categories.

### 3. Product Extraction (`extractProductsFromPage`)

Extracts products from a listing page using `a[href*="/p/"]` selectors (Flipkart Minutes uses React/RN web layout without `div[data-id]`).

For each product link:

- `productId` — extracted from `pid` query param
- `productName` — link inner text
- **Price ordering:** 1st `₹` value = MRP (strikethrough), 2nd `₹` value = selling price
- `discount` — from `X% Off` badge, or calculated from MRP vs price
- `imageUrl` — from nearest `<img>` in parent container
- `inStock` — checks for "out of stock" / "unavailable" text
- Follows "Next" pagination links

### 4. Tracking Loop (`startTrackingHandler`)

Runs continuously:

1. Extracts all categories
2. For each category, opens a page, extracts products (with pagination), saves to DB
3. Skips night hours (12 AM – 6 AM IST)
4. Waits 1 minute between cycles
5. 2-second delay between categories

### 5. Product Processing (`processProducts`)

Before saving to MongoDB:

- Extracts weight/unit from product name (e.g., "500g", "1kg", "250ml")
- Normalizes to grams/ml
- Calculates price per 100g/100ml
- Uses `globalProcessProducts` for bulk upsert, price drop detection, and Telegram notifications

## URL Patterns

| Type             | Pattern                                                      | Example                                           |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| Home page        | `/flipkart-minutes-store?marketplace=HYPERLOCAL`             | —                                                 |
| Category listing | `/hyperlocal/{Name}/pr?sid=hloc/{id}&marketplace=HYPERLOCAL` | `/hyperlocal/Vegetables/pr?sid=hloc%2F0072`       |
| Coded category   | `/hyperlocal/hloc/{code}/pr?sid=hloc/{parent}/{code}`        | `/hyperlocal/hloc/3001/pr?sid=hloc%2F0030%2F3001` |
| Collection tab   | `/all/~cs-{id}/pr?sid=all&collection-tab-name={Name}`        | `collection-tab-name=Tablets`                     |
| Product page     | `/.../{name}/p/{slug}?pid={id}`                              | `?pid=FRUBEV4CZZA3HGHZ`                           |
| Search           | `/search?q={query}&marketplace=HYPERLOCAL`                   | —                                                 |

## Deduplication

- **Grid links:** Deduplicated by `sid` query param
- **Subcategories:** Deduplicated by `sid` of the sub-nav link URL
- **Products:** Deduplicated by `productId` (pid), or by name+price+mrp combo

## Model

`FlipkartMinutesProduct` — MongoDB schema fields:

- `productId` (unique), `productName`, `categoryName`, `subcategoryName`
- `price`, `mrp`, `discount`, `weight`, `unit`, `pricePerUnit`
- `imageUrl`, `url`, `inStock`, `brand`
- `priceDroppedAt`, `updatedAt`

## Running

Tracking starts automatically via `index.js`:

```js
flipkartMinutesStartTrackingHandler("misri gym 500064");
```

Test script:

```bash
cd backend && node test_fk_minutes.js
```
