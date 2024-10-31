import express from "express";
import { InstamartController } from '../../../controllers/InstamartController.js';

const router = express.Router();

router.get("/store-data", InstamartController.getStoreData);
router.post("/subcategory-products", InstamartController.getSubcategoryProducts);
router.post("/track-prices", InstamartController.trackPrices);
router.get("/products", InstamartController.getProducts);

export default router;
