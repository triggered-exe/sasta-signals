import express from "express";
import { startTracking } from "../../../controllers/ZeptoController.js";

const router = express.Router();

router.get("/", (req, res) => {
    res.json({
        message: "Zepto API is running",
    });
});

router.post("/start-tracking", startTracking);

export default router;
