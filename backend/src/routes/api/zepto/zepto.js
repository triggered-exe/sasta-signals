import express from "express";
import * as ZeptoController from "../../../controllers/ZeptoController.js";

const router = express.Router();

router.get("/", (req, res) => {
    res.json({
        message: "Zepto API is running",
    });
});

router.post("/search", ZeptoController.searchQuery);
router.post("/start-tracking", ZeptoController.startTracking);

export default router;
