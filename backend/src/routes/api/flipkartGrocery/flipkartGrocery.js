import express from 'express';
import {
    startTracking,
    searchProductsUsingCrawler,
    startTrackingHandler,
} from '../../../controllers/FlipkartGroceryController.js';

const router = express.Router();

// Start price tracking
router.post('/track', startTracking);

router.post('/search', searchProductsUsingCrawler);

router.post('/start-crawler', startTrackingHandler);

export default router;