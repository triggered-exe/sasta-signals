import express from "express";
import { AppError } from "../../utils/errorHandling.js";
import { buildSortCriteria, buildMatchCriteria } from "../../utils/priceTracking.js";
import { PAGE_SIZE } from "../../utils/constants.js";
import { PROVIDER_REGISTRY } from "../../config/providers.js";

const router = express.Router();

// ── Internal handler factories ────────────────────────────────────────────────

// Adapts a raw (location, query) domain function into an Express handler
const makeSearchHandler = (searchFn) => async (req, res, next) => {
    try {
        const { location, query } = req.body;
        const result = await searchFn(location, query);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

// Turns a Mongoose model into a paginated GET products Express handler
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

// Registry fields that carry provider metadata — not HTTP actions
const METADATA_KEYS = new Set([
    "displayName", "model", "locationParam", "searchFn",
    "trackingHandler", "trackingDefault", "trackingDelay",
]);

// Build { [provider]: { [action]: expressHandler } } from the central registry
const PROVIDERS = Object.fromEntries(
    Object.entries(PROVIDER_REGISTRY).map(([key, config]) => {
        const actions = {};
        // Copy all non-metadata fields (track, search, categories, start-crawler, …)
        for (const [k, v] of Object.entries(config)) {
            if (!METADATA_KEYS.has(k)) actions[k] = v;
        }
        // Auto-generate search handler from raw domain function when no explicit handler
        if (config.searchFn && !actions.search) {
            actions.search = makeSearchHandler(config.searchFn);
        }
        // Auto-generate products handler from Mongoose model
        if (config.model) {
            actions.products = makeProductsHandler(config.model);
        }
        return [key, actions];
    })
);

// ── Cross-provider routes ─────────────────────────────────────────────────────

// Source models for providers that persist products to the database
const sourceModels = Object.fromEntries(
    Object.entries(PROVIDER_REGISTRY)
        .filter(([, config]) => config.model)
        .map(([key, config]) => [key, config.model])
);

router.get("/deals/all", async (req, res, next) => {
    try {
        const { page = "1", pageSize = PAGE_SIZE.toString(), minDiscount = "40" } = req.query;
        const pageNum = parseInt(page);
        const pageSizeNum = parseInt(pageSize);
        const minDiscountNum = parseInt(minDiscount);

        const sourcePromises = Object.entries(sourceModels).map(async ([source, Model]) => {
            const products = await Model.find({
                inStock: true,
                discount: { $gte: minDiscountNum },
                priceDroppedAt: { $exists: true, $type: "date", $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            }).sort({ discount: -1, _id: 1 }).limit(50).lean();
            return products.map((p) => ({ ...p, source }));
        });

        const allDeals = (await Promise.all(sourcePromises)).flat().sort((a, b) => b.discount - a.discount);
        const skip = (pageNum - 1) * pageSizeNum;
        res.status(200).json({
            data: allDeals.slice(skip, skip + pageSizeNum),
            totalPages: Math.ceil(allDeals.length / pageSizeNum),
            currentPage: pageNum,
            total: allDeals.length,
        });
    } catch (error) {
        next(error);
    }
});

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

