import express from 'express';
import { searchProducts, cleanupBrowser, fetchCategories } from '../../../controllers/BigBasketController.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        message: 'BigBasket API is running'
    });
});

router.post('/search', searchProducts);
router.get('/categories', fetchCategories);
router.post('/cleanup', cleanupBrowser);

export default router; 