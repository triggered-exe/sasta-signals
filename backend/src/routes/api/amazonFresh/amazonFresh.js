import express from 'express';
import { 
    searchQuery,
    getProducts,
    startTracking
} from '../../../controllers/AmazonFreshController.js';

const router = express.Router();

// Search products
router.get('/products', getProducts);
router.post('/search', searchQuery);
router.post('/track', startTracking);

export default router; 