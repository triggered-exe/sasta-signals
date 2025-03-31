import express from 'express';
import * as ZeptoController from '../../../controllers/ZeptoController.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        message: 'Zepto API is running'
    });
});

router.get('/search', ZeptoController.searchProducts);
router.get('/categories', ZeptoController.getCategoriesHandler);
router.post('/start-tracking', ZeptoController.startTracking);

export default router; 