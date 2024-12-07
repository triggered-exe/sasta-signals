import express from "express";
import {
  getStoreData,
  getSubcategoryProducts,
  trackPrices,
  getProducts,
  search,
} from "../../../../controllers/InstamartController.js";

const router = express.Router();

router.get("/store-data", getStoreData); // For fetching store data
router.post("/subcategory-products", getSubcategoryProducts); // For fetching products by subcategory
router.get("/track-prices", trackPrices); // For starting the price tracking
router.get("/products", getProducts); // For fetching products with pagination and filtering
router.post("/search", search); // For searching products

export default router;
