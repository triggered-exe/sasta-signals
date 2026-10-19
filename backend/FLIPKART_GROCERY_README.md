# Flipkart Grocery Controller

Scrapes and tracks product prices from **Flipkart Grocery** (`flipkart.com/grocery`),
the classic (non-10-minute) grocery marketplace.

Last verified: **2026-10-20**

---

## Current working flow

### 1. Location setup (`setLocation` / `selectLocationOnPage`)

The location modal is flaky (it can take over 5s to open, and suggestions for a
partially typed term can show first), so each attempt runs on a fresh page and
`setLocation` retries up to **3 times**, 3s apart, before failing the cycle.

One attempt (`selectLocationOnPage`):

1. Navigate to `https://www.flipkart.com` and press Escape / close the login modal.
2. Click **Select delivery location**.
3. Wait up to 15s for any of the location inputs at once
   (`input[placeholder*="Search by area, street name, pin code"]` and variants).
4. Type the pincode.
5. Wait up to 10s for a suggestion row (`div[style*="cursor: pointer;"]` with
   `svg[width="16"]`) whose text contains the pincode, and click it.
6. Wait for the **Confirm** button and click it.

After a successful attempt, if the page links to
`/grocery-xtra-saver-at-store?marketplace=HYPERLOCAL`, Flipkart Minutes is active
for the location and classic Grocery is not; that is the only case treated as
definitively not serviceable (no retry).

Each failed attempt logs a warning with the reason (visible inputs, the
suggestions shown, or the missing Confirm button).

### 2. Category discovery (`extractCategories`)

The grocery store page only links a handful of subcategories, so the controller
walks the category tree:

1. `https://www.flipkart.com/grocery-supermart-store?marketplace=GROCERY` — store page links.
2. `https://www.flipkart.com/grocery/pr?sid=73z&marketplace=GROCERY` — grocery root,
   which links every top-level category (`/grocery/<category>/pr?sid=...`).
3. Each top-level page, which links all of its subcategories
   (`/grocery/<category>/<subcategory>/pr?sid=...`).

Links are read from the page HTML (`parseCategoriesFromHtml` /
`parseTopCategoriesFromHtml`), de-duplicated by `<category>/<subcategory>`, and
any `page=` parameter is removed so every listing starts from page 1.

`sid` encodes the hierarchy: `73z` = grocery, `73z,bpe` = staples,
`73z,bpe,3uv` = dals & pulses.

At 500064 the tree currently contains:

| Top-level category | Subcategories |
| --- | --- |
| staples | 7 |
| personal-baby-care | 12 |
| packaged-food | 9 |
| snacks-beverages | 9 (+ store-page extras) |
| household-care | 7 |
| dairy-bakery-and-eggs | 3 |
| home-kitchen | 1 |
| fruits-vegetables | 1 |

About **49 subcategories** in total. Discovery takes ~1–1.5 minutes per cycle.

### 3. Product listing (`extractProductsFromPage`)

Each listing page shows 40 products as `div[data-id]` cards:

| Selector | Field |
| --- | --- |
| `data-id` | `productId` |
| `a[title]` (`title`, `href`) | `productName`, `url` |
| `div.hZ3P6w.UqO8i8` | `price` |
| `div.kRYCnD` | `mrp` (defaults to price) |
| `img.UCc1lI` | `imageUrl` |
| `div.tSXtJx` containing "unavailable" | `inStock = false` |

Cards without a price are skipped. Pagination follows the `Next` link
(`...&page=N`) until there is none. `processProducts` adds weight / unit /
price-per-100g parsed from the product name before saving.

### 4. Tracking loop (`startTrackingHandler`)

1. Skip night hours (12 AM–6 AM IST).
2. Discover categories (sets the location first).
3. Process each subcategory sequentially, 3s apart.
4. Save through `globalProcessProducts`.
5. Wait 1 minute and start the next cycle.

`Processed and saved 0 products` is normal when nothing changed:
`globalProcessProducts` only writes products whose price or stock status changed.

---

## Why the old flow stopped working (2026-10-20)

| Problem | Cause | Fix |
| --- | --- | --- |
| `Could not find the location search input field` on every retry | The modal sometimes took over 5s to open; the code waited 5s per placeholder pattern in turn, gave up on the matching one first, then spent 20s on patterns that never match | Wait for all patterns at once for up to 15s |
| `Confirm button not found` → marked not serviceable | Suggestions were checked 1.5s after typing; when none matched yet, the click was silently skipped | Wait for a suggestion matching the pincode; log what was shown |
| One failure stopped the whole cycle for a minute | No retry inside `setLocation` | Up to 3 attempts on a fresh page |
| Only 13 subcategories tracked | Categories came only from links on the grocery store page | Walk the root → top-level → subcategory tree (~49) |
| Duplicate categories, one always returning 0 products | Store-page links differ only by tracking / `page=` params (e.g. `page=3` of a 2-page listing) | De-duplicate by subcategory path and drop `page=` |

---

## Endpoints and notes

| Purpose | Value |
| --- | --- |
| Homepage / location | `https://www.flipkart.com` |
| Grocery store page | `https://www.flipkart.com/grocery-supermart-store?marketplace=GROCERY` |
| Grocery root (top-level categories) | `https://www.flipkart.com/grocery/pr?sid=73z&marketplace=GROCERY` |
| Subcategory listing | `https://www.flipkart.com/grocery/<category>/<subcategory>/pr?sid=...&marketplace=GROCERY` |
| Minutes-active marker | `a[href*='/grocery-xtra-saver-at-store?marketplace=HYPERLOCAL']` |

Verified example:

```
FK: Location setup attempt 1/3 for 500064 failed: FK: Could not find the location search input field (...)
FK: Clicked matching location suggestion for "500064"
FK: Successfully set up for location: 500064
FK: Found 8 top-level categories: personal-baby-care, staples, packaged-food, snacks-beverages, household-care, home-kitchen, dairy-bakery-and-eggs, fruits-vegetables
FK: Extracted 49 subcategories from the category tree
```

Known limitation: `snacks-beverages/chips-namkeen-snacks` redirects to
`/chipsnamkeen-snacks/`, which shows 40 products with no pagination, so only
those 40 are tracked.
