import express from "express";
import { AppError } from "../../utils/errorHandling.js";
import { InstamartProduct } from "../../models/InstamartProduct.js";
import { ZeptoProduct } from "../../models/ZeptoProduct.js";
import { BigBasketProduct } from "../../models/BigBasketProduct.js";
import { FlipkartGroceryProduct } from "../../models/FlipkartGroceryProduct.js";
import { AmazonFreshProduct } from "../../models/AmazonFreshProduct.js";
import { BlinkitProduct } from "../../models/BlinkitProduct.js";
import { JiomartProduct } from "../../models/JiomartProduct.js";
import { FlipkartMinutesProduct } from "../../models/FlipkartMinutesProduct.js";
import { buildSortCriteria, buildMatchCriteria } from "../../utils/priceTracking.js";
import { PAGE_SIZE } from "../../utils/constants.js";

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

// Factory: turns a Mongoose Model into a GET /:provider/products handler
const makeProductsHandler = (Model) => async (req, res, next) => {
    try {
        const { page = "1", pageSize = PAGE_SIZE.toString(), sortOrder = "price", timePeriod = "all", notUpdated = "false", search = "" } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const matchCriteria = buildMatchCriteria(timePeriod, notUpdated, search);
        const totalProducts = await Model.countDocuments(matchCriteria);
        const products = await Model.aggregate([
            { $match: matchCriteria },
            { $sort: buildSortCriteria(sortOrder) },
            { $skip: skip },
            { $limit: parseInt(pageSize) },
            { $project: { productId: 1, productName: 1, price: 1, mrp: 1, discount: 1, quantity: 1, unit: 1, weight: 1, imageUrl: 1, inStock: 1, priceDroppedAt: 1, categoryName: 1, subcategoryName: 1, brand: 1, url: 1 } },
        ]);
        res.status(200).json({ data: products, totalPages: Math.ceil(totalProducts / parseInt(pageSize)), currentPage: parseInt(page), total: totalProducts, source: req.params.provider });
    } catch (error) {
        next(error);
    }
};

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
    "amazon-fresh": { track: amazonFreshStartTracking, products: makeProductsHandler(AmazonFreshProduct) },
    "bigbasket": { track: BigBasketController.startTracking, categories: BigBasketController.fetchCategories, products: makeProductsHandler(BigBasketProduct) },
    "blinkit": { track: blinkitStartTracking, search: blinkitSearch, products: makeProductsHandler(BlinkitProduct) },
    "flipkart-grocery": { track: flipkartGroceryStartTracking, "start-crawler": flipkartGroceryStartCrawler, products: makeProductsHandler(FlipkartGroceryProduct) },
    "flipkart-minutes": { track: flipkartMinutesStartTracking, search: flipkartMinutesSearchHandler, products: makeProductsHandler(FlipkartMinutesProduct) },
    "instamart": { track: InstamartController.trackPrices, search: InstamartController.search, products: makeProductsHandler(InstamartProduct) },
    "jiomart": { track: JioMartController.startTracking, products: makeProductsHandler(JiomartProduct) },
    "meesho": { search: MeeshoController.search },
    "zepto": { track: zeptoStartTracking, products: makeProductsHandler(ZeptoProduct) },
};

// ── Dynamic provider route (/api/:provider/:action) ───────────────────────────
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

