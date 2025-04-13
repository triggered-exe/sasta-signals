import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { errorHandler } from "./src/utils/errorHandling.js";
import "./src/database.js"; // Import the database connection
import instamartRouter from "./src/routes/api/instamart/instamart.js"; // Import the instamart route
import meeshoRouter from "./src/routes/api/meesho/meesho.js";
import axios from "axios";
import { trackProductPrices } from "./src/controllers/InstamartController.js"; // Import the function
import bigbasketRoutes from "./src/routes/api/bigbasket/bigbasket.js";
import { startTrackingHandler } from "./src/controllers/BigBasketController.js";
import { startTrackingHandler as zeptoStartTrackingHandler } from "./src/controllers/ZeptoController.js";
import { startTrackingHandler as flipkartStartTrackingHandler } from "./src/controllers/FlipkartGroceryController.js";
import flipkartGroceryRouter from "./src/routes/api/flipkartGrocery/flipkartGrocery.js";
import { searchAllProductsUsingCrawler } from "./src/controllers/FlipkartGroceryController.js";
import amazonFreshRouter from "./src/routes/api/amazonFresh/amazonFresh.js";
import { startTrackingHandler as amazonFreshStartTrackingHandler } from "./src/controllers/AmazonFreshController.js";
import zeptoRouter from "./src/routes/api/zepto/zepto.js";
import productsRouter from "./src/routes/api/products.js"; // Import the new common products route

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

// Common products route that aggregates all platforms
app.use("/api/products", productsRouter);

// Global error handler
app.use(errorHandler);

// Start the server and initialize price tracking
app.listen(port, () => {
  console.log(`Server is running on port - ${port}`);
  trackProductPrices(); // For Instamart
  // zeptoStartTrackingHandler(); // For Zepto
  startTrackingHandler(); // For BigBasket
  searchAllProductsUsingCrawler(); // For Flipkart
  amazonFreshStartTrackingHandler(); // For Amazon Fresh
});
