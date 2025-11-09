import express from 'express';
import { 
    startTracking
} from '../../../controllers/AmazonFreshController.js';

const router = express.Router();

router.post('/track', startTracking);

export default router;  