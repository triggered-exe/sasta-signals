import express from "express";
import { startTracking, search } from "../../../controllers/FlipkartMinutesController.js";

const router = express.Router();

router.get("/start-tracking", startTracking);
router.post("/search", async (req, res, next) => {
    try {
        const { location, query } = req.body;
        const result = await search(location, query);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

export default router;
