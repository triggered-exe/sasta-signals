import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import logger from "./src/utils/logger.js";
import { errorHandler } from "./src/utils/errorHandling.js";
import { connectDB } from "./src/database.js"; // Import the database connection function
import instamartRouter from "./src/routes/api/instamart/instamart.js"; // Import the instamart route
import meeshoRouter from "./src/routes/api/meesho/meesho.js";
import { trackProductPrices as instamartStartTrackingHandler } from "./src/controllers/InstamartController.js"; // Import the function
import bigbasketRoutes from "./src/routes/api/bigbasket/bigbasket.js";
import { startTrackingHandler as BigBasketStartTrackingHandler } from "./src/controllers/BigBasketController.js";
import { startTrackingHelper as zeptoStartTrackingHandler } from "./src/controllers/ZeptoController.js";
import { startTrackingHandler as flipkartStartTrackingHandler } from "./src/controllers/FlipkartGroceryController.js";
import flipkartGroceryRouter from "./src/routes/api/flipkartGrocery/flipkartGrocery.js";
import amazonFreshRouter from "./src/routes/api/amazonFresh/amazonFresh.js";
import {
  startTrackingHandler as amazonFreshStartTrackingHandler,
  startAmazonTrackingWithoutBrowswer,
} from "./src/controllers/AmazonFreshController.js";
import { startTrackingHandler as jiomartStartTrackingHandler } from "./src/controllers/jiomartController.js";
import zeptoRouter from "./src/routes/api/zepto/zepto.js";
import productsRouter from "./src/routes/api/products.js"; // Import the new common products route
import blinkitRouter from "./src/routes/api/blinkit/blinkit.js";
import jiomartRouter from "./src/routes/api/jiomart/jiomart.js";
import { startTrackingHandler as blinkitStartTrackingHandler } from "./src/controllers/BlinkitController.js";
import searchRouter from "./src/routes/api/search.js";
import monitoringRouter from "./src/routes/api/monitoring.js";
import dashboardRouter from "./src/routes/api/dashboard.js";

// Load environment variables from .env file
dotenv.config();

// Create an Express application
const app = express();
// Set the port number, use the PORT environment variable if available, otherwise use 3000
const port = process.env.PORT || 8000;

// Middleware
app.use(cors()); // Enable Cross-Origin  Resource Sharing (CORS)
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies

// Routes
app.get("/", (req, res) => {
  res.send("Hello World!"); // Define a simple route for the root path
});

// Individual platform routes
app.use("/api/instamart", instamartRouter); // Use the instamart route
app.use("/api/meesho", meeshoRouter);
app.use("/api/bigbasket", bigbasketRoutes);
app.use("/api/zepto", zeptoRouter);
app.use("/api/flipkart-grocery", flipkartGroceryRouter);
app.use("/api/amazon-fresh", amazonFreshRouter);
app.use("/api/blinkit", blinkitRouter);
app.use("/api/jiomart", jiomartRouter);

// Unified search across multiple providers
app.use("/api/search", searchRouter);

// Common products route that aggregates all platforms
app.use("/api/products", productsRouter);

// Monitoring routes for system health and context management
app.use("/api/monitoring", monitoringRouter);

// Dashboard route for visual monitoring
app.use("/api/dashboard", dashboardRouter);

// Global error handler
app.use(errorHandler);

// Start the server and initialize price tracking
const startServer = async () => {
  try {
    // Wait for database connection before starting the server
    await connectDB();
    logger.info("Database connected, starting server...");

    app.listen(port, () => {
      logger.info(`Server is running on port - ${port}`);

      if (process.env.ENVIRONMENT === "production") {
        setTimeout(() => startAmazonTrackingWithoutBrowswer("500064"), 0); // For Amazon Fresh
        setTimeout(() => zeptoStartTrackingHandler("500064"), 60 * 1000); // For Zepto
        setTimeout(() => BigBasketStartTrackingHandler("500064"), 90 * 1000); // For BigBasket
        setTimeout(() => flipkartStartTrackingHandler("500064"), 120 * 1000); // For Flipkart
        setTimeout(() => instamartStartTrackingHandler("500064"), 150 * 1000); // For Instamart
        setTimeout(() => blinkitStartTrackingHandler("500064"), 180 * 1000); // For Blinkit
        setTimeout(() => jiomartStartTrackingHandler("500064"), 210 * 1000); // For JioMart
      } else {
        // setTimeout(() => jiomartStartTrackingHandler("500064"), 0); // For BigBasket
      }
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
