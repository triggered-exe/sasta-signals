/**
 * src/config/providers.js
 *
 * Single source of truth for every provider's metadata.
 * Consumed by:
 *   - src/routes/api/providers.js  → builds the /:provider/:action HTTP router
 *   - src/controllers/UnifiedSearchController.js → scope of unified search
 *   - backend/index.js             → schedules background tracking loops
 *
 * Per-entry fields
 * ─────────────────
 *   displayName      Human-readable name used in logs and API responses.
 *   model            Mongoose model. Presence auto-generates GET /:provider/products.
 *   locationParam    "pincode" | "location" — hint used by unified-search validation.
 *   searchFn         Raw (location, query) → Promise<{products,total}> function.
 *                    Presence auto-generates POST /:provider/search Express handler
 *                    AND includes the provider in unified search.
 *   search           Express (req,res,next) handler used directly as POST /:provider/search
 *                    when the search API doesn't fit the (location,query) pattern.
 *   track            Express (req,res,next) handler for POST /:provider/track.
 *   [extra]          Any extra named actions (e.g. categories, start-crawler).
 *   trackingHandler  Background loop fn — called at server startup in production.
 *   trackingDefault  Default location/address passed to trackingHandler.
 *   trackingDelay    Milliseconds after server start before starting the loop.
 */

// ── Models ────────────────────────────────────────────────────────────────────
import { AmazonFreshProduct } from "../models/AmazonFreshProduct.js";
import { BigBasketProduct } from "../models/BigBasketProduct.js";
import { BlinkitProduct } from "../models/BlinkitProduct.js";
import { FlipkartGroceryProduct } from "../models/FlipkartGroceryProduct.js";
import { FlipkartMinutesProduct } from "../models/FlipkartMinutesProduct.js";
import { InstamartProduct } from "../models/InstamartProduct.js";
import { JiomartProduct } from "../models/JiomartProduct.js";
import { ZeptoProduct } from "../models/ZeptoProduct.js";

// ── Controllers ───────────────────────────────────────────────────────────────
import {
    startTracking as amazonFreshStartTracking,
    startAmazonTrackingWithoutBrowswer,
    search as amazonFreshSearch,
} from "../controllers/AmazonFreshController.js";

import {
    startTracking as bigBasketStartTracking,
    startTrackingHandler as bigBasketStartTrackingHandler,
    search as bigBasketSearch,
    fetchCategories as bigBasketFetchCategories,
} from "../controllers/BigBasketController.js";

import {
    searchQuery as blinkitSearchHandler,
    startTracking as blinkitStartTracking,
    startTrackingHandler as blinkitStartTrackingHandler,
} from "../controllers/BlinkitController.js";

import {
    startTracking as flipkartGroceryStartTracking,
    startTrackingHandler as flipkartGroceryStartTrackingHandler,
    search as flipkartGrocerySearch,
} from "../controllers/FlipkartGroceryController.js";

import {
    startTracking as flipkartMinutesStartTracking,
    startTrackingHandler as flipkartMinutesStartTrackingHandler,
    search as flipkartMinutesSearch,
} from "../controllers/FlipkartMinutesController.js";

import {
    trackPrices as instamartStartTracking,
    trackProductPrices as instamartStartTrackingHandler,
    search as instamartSearchHandler,
} from "../controllers/InstamartController.js";

import {
    startTracking as jiomartStartTracking,
    startTrackingHandler as jiomartStartTrackingHandler,
    search as jiomartSearch,
} from "../controllers/jiomartController.js";

import { search as meeshoSearchHandler } from "../controllers/MeeshoController.js";

import {
    startTracking as zeptoStartTracking,
    startTrackingHelper as zeptoStartTrackingHandler,
    search as zeptoSearch,
} from "../controllers/ZeptoController.js";

// ── Registry ──────────────────────────────────────────────────────────────────
export const PROVIDER_REGISTRY = {
    "amazon-fresh": {
        displayName: "Amazon Fresh",
        model: AmazonFreshProduct,
        locationParam: "pincode",
        searchFn: amazonFreshSearch,
        track: amazonFreshStartTracking,
        trackingHandler: startAmazonTrackingWithoutBrowswer,
        trackingDefault: "500064",
        trackingDelay: 0,
    },

    "bigbasket": {
        displayName: "BigBasket",
        model: BigBasketProduct,
        locationParam: "pincode",
        searchFn: bigBasketSearch,
        track: bigBasketStartTracking,
        // bigBasketFetchCategories returns data, not Express response — wrap it here
        categories: async (req, res, next) => {
            try {
                const data = await bigBasketFetchCategories();
                res.status(200).json({ data });
            } catch (error) {
                next(error);
            }
        },
        trackingHandler: bigBasketStartTrackingHandler,
        trackingDefault: "500064",
        trackingDelay: 90 * 1000,
    },

    "blinkit": {
        displayName: "Blinkit",
        model: BlinkitProduct,
        // blinkitSearchHandler is an Express handler — no raw (location, query) fn available
        search: blinkitSearchHandler,
        track: blinkitStartTracking,
        trackingHandler: blinkitStartTrackingHandler,
        trackingDefault: "bahadurpura police station",
        trackingDelay: 150 * 1000,
    },

    "flipkart-grocery": {
        displayName: "Flipkart Grocery",
        model: FlipkartGroceryProduct,
        locationParam: "pincode",
        searchFn: flipkartGrocerySearch,
        track: flipkartGroceryStartTracking,
        trackingHandler: flipkartGroceryStartTrackingHandler,
        trackingDefault: "500064",
        trackingDelay: 60 * 1000,
    },

    "flipkart-minutes": {
        displayName: "Flipkart Minutes",
        model: FlipkartMinutesProduct,
        searchFn: flipkartMinutesSearch,
        track: flipkartMinutesStartTracking,
        trackingHandler: flipkartMinutesStartTrackingHandler,
        trackingDefault: "misri gym bahadurpura",
        trackingDelay: 210 * 1000,
    },

    "instamart": {
        displayName: "Instamart",
        model: InstamartProduct,
        // instamartSearchHandler is an Express handler — no raw (location, query) fn exposed
        search: instamartSearchHandler,
        track: instamartStartTracking,
        trackingHandler: instamartStartTrackingHandler,
        trackingDefault: "500064",
        trackingDelay: 30 * 1000,
    },

    "jiomart": {
        displayName: "JioMart",
        model: JiomartProduct,
        locationParam: "pincode",
        searchFn: jiomartSearch,
        track: jiomartStartTracking,
        trackingHandler: jiomartStartTrackingHandler,
        trackingDefault: "500064",
        trackingDelay: 180 * 1000,
    },

    "meesho": {
        displayName: "Meesho",
        // search-only provider: no DB model, no background tracker
        search: meeshoSearchHandler,
    },

    "zepto": {
        displayName: "Zepto",
        model: ZeptoProduct,
        locationParam: "location",
        searchFn: zeptoSearch,
        track: zeptoStartTracking,
        trackingHandler: zeptoStartTrackingHandler,
        trackingDefault: "500064",
        trackingDelay: 120 * 1000,
    },
};
