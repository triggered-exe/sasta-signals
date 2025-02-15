import express from 'express';
import { 
    searchProductsUsingCrawler,
} from '../../../controllers/AmazonFreshController.js';

const router = express.Router();

// Search products
router.post('/search', searchProductsUsingCrawler);


export default router; 