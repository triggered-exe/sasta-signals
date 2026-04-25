import express from "express";

import { startTracking as amazonFreshStartTracking } from "../../controllers/AmazonFreshController.js";
import * as BigBasketController from "../../controllers/BigBasketController.js";
import { searchQuery as blinkitSearch, startTracking as blinkitStartTracking } from "../../controllers/BlinkitController.js";
import { startTracking as flipkartGroceryStartTracking, startTrackingHandler as flipkartGroceryStartCrawler } from "../../controllers/FlipkartGroceryController.js";
import { startTracking as flipkartMinutesStartTracking, search as flipkartMinutesSearch } from "../../controllers/FlipkartMinutesController.js";
import * as InstamartController from "../../controllers/InstamartController.js";
import * as JioMartController from "../../controllers/jiomartController.js";
import { startTracking as zeptoStartTracking } from "../../controllers/ZeptoController.js";
import * as MeeshoController from "../../controllers/MeeshoController.js";

const router = express.Router();

// ── Inline handlers for non-controller logic ───────────────────────────────────

const flipkartMinutesSearchHandler = async (req, res, next) => {
    try {
        const { location, query } = req.body;
        const result = await flipkartMinutesSearch(location, query);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

// ── Provider registry ─────────────────────────────────────────────────────────
// Keys are URL-safe provider names; values map action names to Express handlers.
const PROVIDERS = {
    "amazon-fresh": { track: amazonFreshStartTracking },
    "bigbasket": { track: BigBasketController.startTracking, categories: BigBasketController.fetchCategories },
    "blinkit": { track: blinkitStartTracking, search: blinkitSearch },
    "flipkart-grocery": { track: flipkartGroceryStartTracking, "start-crawler": flipkartGroceryStartCrawler },
    "flipkart-minutes": { track: flipkartMinutesStartTracking, search: flipkartMinutesSearchHandler },
    "instamart": { track: InstamartController.trackPrices, search: InstamartController.search },
    "jiomart": { track: JioMartController.startTracking },
    "meesho": { search: MeeshoController.search },
    "zepto": { track: zeptoStartTracking },
};

// ── Single dynamic route ───────────────────────────────────────────────────────
router.all("/:provider/:action", (req, res, next) => {
    const handler = PROVIDERS[req.params.provider]?.[req.params.action];
    if (!handler) {
        return next(AppError.notFound(
            `Unknown provider/action: ${req.params.provider}/${req.params.action}`
        ));
    }
    return handler(req, res, next);
});

export default router;

