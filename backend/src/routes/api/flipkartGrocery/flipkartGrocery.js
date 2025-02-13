import express from 'express';
import { 
    getProducts, 
    startTracking, 
    searchProductsUsingCrawler,
} from '../../../controllers/FlipkartGroceryController.js';

const router = express.Router();

// Get all products with pagination and filters
router.get('/products', getProducts);

// Start price tracking
router.post('/track', startTracking);

router.post('/search', searchProductsUsingCrawler);


export default router; 