# Flipkart Minutes Controller

Scrapes and tracks product prices from **Flipkart Minutes**
(`flipkart.com/flipkart-minutes-store`).

Last verified: **2026-10-18**

---

## Current working flow

### 1. Location setup (`setLocation`)

1. Navigate to the manual location page:

   ```
   https://www.flipkart.com/rv/checkout/changeShippingAddress/add?marketplace=HYPERLOCAL&source=entry&hideAddressForm=true&isMap=true&addressBSTouchpoint=ENTER_LOCATION_MANUALLY
   ```

2. Wait ~5s so the Google Places autocomplete initializes.
3. Type the address into `#search` with a small delay between keystrokes.
4. Wait for the `LocationDrop` suggestion icon. If no suggestions appear,
   clear the input and retry once.
5. Click the first suggestion's `<li>`.
6. Wait for the Confirm button and click it:

   ```
   .sVrZD1, input[type="submit"][value="Confirm"]
   ```

7. Mark the location as serviceable.

The address is also used to read the pincode. `extractPincode` checks
`localStorage.mypin` (retried for up to 5 seconds) and falls back to a 6-digit
number in the address string.

### 2. Category discovery (`extractCategories`)

Flipkart's **All Categories** bottom sheet (`all-categories-quickhp-store`)
currently returns an empty page, so the controller discovers categories from
the dynamically rendered Minutes homepage:

1. Navigate to:

   ```
   https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL
   ```

2. Scroll until the lazily loaded category sections stop growing.
3. Collect anchors matching:

   ```
   /hyperlocal/<name>/pr?sid=hloc%2F<4-digit-id>&marketplace=HYPERLOCAL&...
   ```

   Random ad/recommendation IDs (for example `hloc%2F8l5j`) are skipped.

4. Associate each card with the nearest section heading:
   - `Grocery`
   - `Snacks & drinks`
   - `Beauty & personal care`
   - `Household & lifestyle`
   - `Gadgets & more`

5. Deduplicate by `sid`.

This currently yields **26 categories** in our tests (the exact count can vary
by location and A/B test).

If homepage extraction fails, the controller falls back to the All listing:

```
https://www.flipkart.com/all/pr?sid=all&marketplace=HYPERLOCAL
```

Some Beauty cards reuse the generic `/hyperlocal/Fruits/` path. The stored
product category is taken from each product's `analyticsData`, so values are
still correct (for example `Grooming > BathAndSpa`).

### 3. Product listing (`extractProductsViaAPI`)

Products are read from the Flipkart page JSON API:

```
POST https://<dc>.rome.api.flipkart.com/api/4/page/fetch?cacheFirst=false
```

Example body:

```json
{
  "pageUri": "/hyperlocal/Fruits/pr?sid=hloc%2F0071&marketplace=HYPERLOCAL&param=23846385&BU=Minutes",
  "pageContext": {
    "trackingContext": { "context": { "eVar51": "direct_browse", "eVar61": "direct_browse" } },
    "networkSpeed": 10000
  },
  "requestContext": {
    "type": "BROWSE_PAGE",
    "ssid": "fkmhyperlocal0000",
    "sqid": "<random>"
  },
  "locationContext": { "pincode": 500064, "changed": false }
}
```

Key details:

- Requests use Playwright's `page.request`, not `page.evaluate(fetch())`.
  This shares the browser context cookies and bypasses CORS.
- Products are in `RESPONSE.slots[].widget.type === "PRODUCT_SUMMARY_EXTENDED"`.
- Pagination uses:
  - `pageData.hasMorePages`
  - `pageData.pageHash`
  - `pageData.paginationContextMap.federator`
- Defaults:
  - **30 pages** per category
  - **500 pages** for the `/all` fallback
  - `FK_MINUTES_MAX_PAGES` overrides the limit (useful for local tests)
- On **406 DC Change**, the API returns `RESPONSE.id` / `RESPONSE.dc`. The
  controller retries across the public `*.rome.api.flipkart.com` hosts. The
  regional `*.hyd.*` hosts are not resolvable from every network.

Each product is normalized with:

| Field | Source |
| --- | --- |
| `productId` | `pid` from the action URL, or `value.id` |
| `productName` | SEO slug from the action URL |
| `price` | `pricing.finalPrice.value` |
| `mrp` | `pricing.prices[].priceType === "MRP"`, else `pricing.mrp.value` |
| `discount` | `pricing.totalDiscount`, else computed from MRP/price |
| `categoryName` | `analyticsData.category` |
| `subcategoryName` | `analyticsData.subCategory` |
| `imageUrl` | `media.images[0].url` with size/quality placeholders replaced |
| `inStock` | `availability.displayState === "IN_STOCK"` |

### 4. Tracking loop (`startTrackingHandler`)

1. Set the location once per cycle.
2. Extract homepage categories.
3. Create one shared API page and read the pincode.
4. Shuffle categories and process each one.
5. Deduplicate products by `productId`.
6. Save through `globalProcessProducts` (price-drop detection, DB upsert,
   Telegram alerts).
7. Wait 1 minute before the next cycle.
8. Skip tracking between 12 AM and 6 AM IST.

---

## Why the old flow stopped working (2026-10-18)

| Problem | Cause | Fix |
| --- | --- | --- |
| Location marked unserviceable | Autocomplete was typed before Google Places was ready; coordinate fallback clicked the wrong element | Wait + type with delay + retry, then click the suggestion `<li>` |
| 0 categories | The All Categories bottom sheet returns an empty page | Extract the homepage category cards after scrolling |
| `Failed to fetch` | `page.evaluate(fetch())` was blocked by CORS in some sessions | Use Playwright `page.request` with the same headers/cookies |
| API 406 | Response pointed to `*.hyd.api.flipkart.com`, which does not resolve everywhere | Retry across the `*.rome.api.flipkart.com` hosts |
| Missing pincode on first cycle | `mypin` in `localStorage` was not ready yet | Retry the read for up to 5 seconds |

---

## Endpoints and notes

| Purpose | Value |
| --- | --- |
| Minutes homepage | `https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL` |
| Category cards | `/hyperlocal/<name>/pr?sid=hloc%2F<id>&marketplace=HYPERLOCAL&param=...&BU=Minutes` |
| Product API | `POST https://<dc>.rome.api.flipkart.com/api/4/page/fetch?cacheFirst=false` |
| All fallback | `https://www.flipkart.com/all/pr?sid=all&marketplace=HYPERLOCAL` |
| Pincode source | `localStorage.mypin` |

Example verified cycle (1 page per category):

```
FK-MINUTES: Extracted 26 homepage categories
FK-MINUTES: Using pincode 500064 for API calls
FK-MINUTES: Tracking cycle complete. Total processed: 232 in 1.28 minutes
```
