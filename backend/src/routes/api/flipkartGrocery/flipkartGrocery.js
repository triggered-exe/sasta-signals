import express from 'express';
import { 
    startTracking, 
    searchProductsUsingCrawler,
    startCrawlerSearchHandler,
} from '../../../controllers/FlipkartGroceryController.js';

const router = express.Router();

// Start price tracking
router.post('/track', startTracking);

router.post('/search', searchProductsUsingCrawler);

router.post('/start-crawler', startCrawlerSearchHandler);

export default router; 