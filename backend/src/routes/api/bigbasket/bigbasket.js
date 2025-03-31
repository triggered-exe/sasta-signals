import express from 'express';
import * as BigBasketController from '../../../controllers/BigBasketController.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        message: 'BigBasket API is running'
    });
});

router.post('/search', BigBasketController.searchProducts);
router.post('/search-crawler', BigBasketController.searchProductsUsingCrawler);
router.get('/categories', BigBasketController.fetchCategories);
router.post('/start-tracking', BigBasketController.startTracking);
router.post('/cleanup', BigBasketController.cleanupBrowser);

export default router; 