import express from 'express';
import { 
    getProducts, 
    startTracking, 
} from '../../../controllers/FlipkartGroceryController.js';

const router = express.Router();

// Get all products with pagination and filters
router.get('/products', getProducts);

// Start price tracking
router.post('/track', startTracking);



export default router; 