import express from 'express';
import * as ZeptoController from '../../../controllers/ZeptoController.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        message: 'Zepto API is running'
    });
});

router.get('/', (req,res) => res.send('Zepto API is running') )
router.get('/search', ZeptoController.searchProducts);
router.get('/categories', ZeptoController.fetchCategories);
router.get('/products', ZeptoController.getProducts);
router.post('/start-tracking', ZeptoController.startTracking);
router.post('/cleanup', ZeptoController.cleanupBrowser);

export default router; 