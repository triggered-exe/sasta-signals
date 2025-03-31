import express from 'express';
import { 
    searchQuery,
    startTracking
} from '../../../controllers/AmazonFreshController.js';

const router = express.Router();

// Search products
router.post('/search', searchQuery);
router.post('/track', startTracking);

export default router; 