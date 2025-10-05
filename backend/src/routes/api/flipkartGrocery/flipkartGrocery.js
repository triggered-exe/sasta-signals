import express from 'express';
import {
    startTracking,
    startTrackingHandler,
} from '../../../controllers/FlipkartGroceryController.js';

const router = express.Router();

// Start price tracking
router.post('/track', startTracking);


router.post('/start-crawler', startTrackingHandler);

export default router;