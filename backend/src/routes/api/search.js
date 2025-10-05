import express from "express";
import * as UnifiedSearchController from "../../controllers/UnifiedSearchController.js";

const router = express.Router();

// Unified search across multiple providers
router.post("/", UnifiedSearchController.unifiedSearch);

export default router;