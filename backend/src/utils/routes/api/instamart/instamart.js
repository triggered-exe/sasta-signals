import express from "express";
import {
  getStoreData,
  getSubcategoryProducts,
  trackPrices,
  getProducts,
  search,
} from "../../../../controllers/InstamartController.js";

const router = express.Router();

router.get("/store-data", getStoreData);
router.post("/subcategory-products", getSubcategoryProducts);
router.post("/track-prices", trackPrices);
router.get("/products", getProducts);
router.post("/search", search);

export default router;
