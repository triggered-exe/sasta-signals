import express from "express";
import * as InstamartController from '../../../controllers/InstamartController.js';

const router = express.Router();

router.get("/store-data", InstamartController.getStoreData);
router.post("/subcategory-products", InstamartController.getSubcategoryProducts);
router.post("/track-prices", InstamartController.trackPrices);
router.post("/search", InstamartController.search);

export default router;
