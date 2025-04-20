import express from "express";
import { InstamartProduct } from "../../models/InstamartProduct.js";
import { ZeptoProduct } from "../../models/ZeptoProduct.js";
import { BigBasketProduct } from "../../models/BigBasketProduct.js";
import { FlipkartGroceryProduct } from "../../models/FlipkartGroceryProduct.js";
import { AmazonFreshProduct } from "../../models/AmazonFreshProduct.js";
import { BlinkitProduct } from "../../models/BlinkitProduct.js";
import { buildSortCriteria, buildMatchCriteria } from "../../utils/priceTracking.js";
import { PAGE_SIZE } from "../../utils/constants.js";
import { AppError } from "../../utils/errorHandling.js";

const router = express.Router();

// Map of source names to their respective models
const sourceModels = {
    'instamart': InstamartProduct,
    'zepto': ZeptoProduct,
    'bigbasket': BigBasketProduct,
    'flipkart-grocery': FlipkartGroceryProduct,
    'amazon-fresh': AmazonFreshProduct,
    'blinkit': BlinkitProduct
};

// Get list of available sources
router.get("/sources", (req, res) => {
    res.json({
        sources: Object.keys(sourceModels),
        message: "Available product sources",
    });
});

// Get products from a specific source
router.get("/:source", async (req, res, next) => {
    try {
        const { source } = req.params;
        const Model = sourceModels[source.toLowerCase()];

        if (!Model) {
            throw AppError.notFound(`Source '${source}' not found`);
        }

        const {
            page = "1",
            pageSize = PAGE_SIZE.toString(),
            sortOrder = "price",
            priceDropped = "false",
            notUpdated = "false",
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const sortCriteria = buildSortCriteria(sortOrder);
        const matchCriteria = buildMatchCriteria(priceDropped, notUpdated);

        const totalProducts = await Model.countDocuments(matchCriteria);
        const products = await Model.aggregate([
            { $match: matchCriteria },
            { $sort: sortCriteria },
            { $skip: skip },
            { $limit: parseInt(pageSize) },
            {
                $project: {
                    productId: 1,
                    productName: 1,
                    price: 1,
                    mrp: 1,
                    discount: 1,
                    quantity: 1,
                    unit: 1,
                    weight: 1,
                    imageUrl: 1,
                    inStock: 1,
                    priceDroppedAt: 1,
                    categoryName: 1,
                    subcategoryName: 1,
                    brand: 1,
                    url: 1,
                },
            },
        ]);

        res.status(200).json({
            data: products,
            totalPages: Math.ceil(totalProducts / parseInt(pageSize)),
            currentPage: parseInt(page),
            total: totalProducts,
            source: source,
        });
    } catch (error) {
        next(error);
    }
});

// Get products from all sources with price drops
router.get("/deals/all", async (req, res, next) => {
    try {
        const { page = "1", pageSize = PAGE_SIZE.toString(), minDiscount = "40" } = req.query;

        const pageNum = parseInt(page);
        const pageSizeNum = parseInt(pageSize);
        const minDiscountNum = parseInt(minDiscount);

        // Create promises for all sources
        const sourcePromises = Object.entries(sourceModels).map(async ([source, Model]) => {
            const matchCriteria = {
                inStock: true,
                discount: { $gte: minDiscountNum },
                priceDroppedAt: {
                    $exists: true,
                    $type: "date",
                    $gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                },
            };

            // Get products from this source
            const products = await Model.find(matchCriteria).sort({ discount: -1 }).limit(50).lean();

            // Add source field to each product
            return products.map((product) => ({
                ...product,
                source,
            }));
        });

        // Wait for all promises to resolve
        const allSourceResults = await Promise.all(sourcePromises);

        // Flatten results and sort by discount
        const allDeals = allSourceResults.flat().sort((a, b) => b.discount - a.discount);

        // Paginate results
        const totalDeals = allDeals.length;
        const skip = (pageNum - 1) * pageSizeNum;
        const paginatedDeals = allDeals.slice(skip, skip + pageSizeNum);

        res.status(200).json({
            data: paginatedDeals,
            totalPages: Math.ceil(totalDeals / pageSizeNum),
            currentPage: pageNum,
            total: totalDeals,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
