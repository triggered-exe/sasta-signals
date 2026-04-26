import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import logger from "./src/utils/logger.js";
import { errorHandler } from "./src/utils/errorHandling.js";
import { connectDB } from "./src/database.js"; // Import the database connection function
import { PROVIDER_REGISTRY } from "./src/config/providers.js";
import providersRouter from "./src/routes/api/providers.js";
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

// Specific routes first — must come before the dynamic /api/:provider/:action router
app.use("/api/search", searchRouter);
app.use("/api/monitoring", monitoringRouter);
app.use("/api/dashboard", dashboardRouter);

// All provider routes (amazon-fresh, bigbasket, blinkit, flipkart-*, instamart, jiomart, meesho, zepto)
// Mounted last so /:provider/:action doesn't shadow the routes above
app.use("/api", providersRouter);

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

      // NOTE: BigBasket tracking has been re-enabled with updated headers and scraping logic to bypass bot detection.
      // BigBasketStartTrackingHandler("500064"); // For Blinkit
      if (process.env.ENVIRONMENT === "production") {
        Object.entries(PROVIDER_REGISTRY)
          .filter(([, c]) => c.trackingHandler)
          .forEach(([, c]) => setTimeout(() => c.trackingHandler(c.trackingDefault), c.trackingDelay));
      } else {
        // setTimeout(() => PROVIDER_REGISTRY["jiomart"].trackingHandler("500064"), 0);
      }
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message || error}`, { error });
    process.exit(1);
  }
};

// Start the server
startServer();
