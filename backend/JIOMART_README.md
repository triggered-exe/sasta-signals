# JioMart Controller

Scrapes and tracks product prices from **JioMart** (`jiomart.com`).

Last verified: **2026-10-18**

---

## Current working flow

### 1. Location setup (`setLocation`)

JioMart replaced the old `#location_popup` / `#delivery_popup` dialogs with an
AllowLocation modal and a Google Places address search.

1. Navigate to `https://www.jiomart.com/`.
2. If the `app_location_details` cookie already matches the requested pincode,
   skip setup.
3. Otherwise click **Select location manually**.
4. Type the pincode into `input[placeholder="Search for area, landmark"]`.
5. Pick the first suggestion from `.pac-container .pac-item`.
6. Poll the `app_location_details` cookie until the pincode matches.
7. Write the same location to `localStorage.pin` (the header and collection
   pages use it).
8. Reload and mark the location as serviceable.

Retries handle slow modal rendering and missing suggestions.

### 2. Category discovery (`fetchJiomartCategories`)

JioMart stores its category tree in localStorage:

```
localStorage.shop_all_categories_trees
```

Fallback: `localStorage.quick_categories_trees`.

For the **Groceries** department the tree currently contains:

| Level | Count |
| --- | --- |
| l1 | 20 |
| l2 | 96 |
| l3 | 482 |

The controller uses the l2 subcategories and maps each one to its parent l1 via
`parentL1Uids` / `hierarchy`. It builds product-listing URLs of the form:

```
https://www.jiomart.com/products?department=groceries&l1_category=<l1-value>&l2_category=<l2-value>
```

`filterCategories` then applies the existing removals (fashion/electronics/baby
care/etc.), leaving about **88 categories** to process.

If the tree is unavailable, the controller falls back to the known collection
pages:

```
/collection/all-vegetable--fruits
/collection/premium-fruits
/collection/beauty--cosmetic
/collection/kitchen-appliance
```

### 3. Product listing (`extractProductsFromPage`)

The current site renders cards as:

```
.productCard__productCard
```

Each card contains a `.gtmEvents` element with product metadata:

| Attribute | Field |
| --- | --- |
| `data-id` | `productId` |
| `data-name` | `productName` |
| `data-price` | `price` |
| `data-image` | `imageUrl` |
| `data-slug` | URL slug |
| `data-manu` | brand |
| `data-cate` | category |
| `data-subcate` | subcategory |

Additional fields:

- `mrp` / `discount` — from the price values in the card text (`₹...`); the
  largest value above `data-price` is treated as MRP.
- `weight` — `.productCard__sizeSpan`.
- `inStock` — false when the card text contains `out of stock` / `sold out`.
- `url` — `https://www.jiomart.com/product/<data-slug>`.

The scraper scrolls / clicks **Load more** until the card count stops growing.

### 4. Search (`search`)

JioMart search moved to:

```
https://www.jiomart.com/products?q=<query>
```

The same card scraper is used.

### 5. Tracking loop (`startTrackingHandler`)

1. Set the location.
2. Read the localStorage category tree.
3. Shuffle and process each category sequentially.
4. Save through `globalProcessProducts`.
5. Skip night hours (12 AM–6 AM IST).

With ~88 categories a full cycle takes noticeably longer than the old
4-collection fallback.

---

## Why the old flow stopped working (2026-10-18)

| Problem | Cause | Fix |
| --- | --- | --- |
| `Cannot read properties of null (reading 'evaluate')` | Old `#location_popup` / `#delivery_popup` elements were removed | New AllowLocation modal + Google Places flow |
| Location appeared set but products still used Mumbai | Autocomplete updated cookies but not `localStorage.pin` | Persist the location to `localStorage.pin` and reload |
| `/all-category` returned 404 | JioMart removed the page | Read `shop_all_categories_trees` from localStorage |
| `trex/search` and `a.plp_product_list` no longer existed | Site moved to Vertex APIs and new React cards | Scrape `.productCard__productCard` / `.gtmEvents` |
| Search returned 0 / 404 | `/search?q=` was retired | Use `/products?q=` |

---

## Endpoints and notes

| Purpose | Value |
| --- | --- |
| Homepage | `https://www.jiomart.com/` |
| Category tree | `localStorage.shop_all_categories_trees` |
| Product listing | `https://www.jiomart.com/products?department=groceries&l1_category=...&l2_category=...` |
| Search | `https://www.jiomart.com/products?q=...` |
| Product URL | `https://www.jiomart.com/product/<slug>` |
| Location cookie | `app_location_details` |
| Location state | `localStorage.pin` |
| Fallback collections | `/collection/all-vegetable--fruits`, `/collection/premium-fruits`, `/collection/beauty--cosmetic`, `/collection/kitchen-appliance` |

Verified example:

```
JIO: Extracted 94 subcategories from localStorage category tree
JIO: Successfully extracted 33 products from ...l1_category=beauty&l2_category=face
JIO: Successfully extracted 21 products from ...l1_category=school-office-stationery&l2_category=art-craft-hobby
JIO: Categories Processed: 1 of 88
```

Search example:

```
JIO: Successfully extracted 48 products from .../products?q=milk
```

Some l2 categories can return 0 products for a given pincode (for example
`Bathroom & Laundry` at 500064).
