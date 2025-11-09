import express from "express";
import * as JioMartController from "../../../controllers/jiomartController.js";

const router = express.Router();

router.post("/track", JioMartController.startTracking);

export default router;
