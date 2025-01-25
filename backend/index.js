import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './src/utils/errorHandling.js';
import './src/database.js'; // Import the database connection
import instamartRouter from './src/routes/api/instamart/instamart.js'; // Import the instamart route
import meeshoRouter from './src/routes/api/meesho/meesho.js';
import axios from 'axios';
import { trackProductPrices } from './src/controllers/InstamartController.js'; // Import the function
import bigbasketRoutes from './src/routes/api/bigbasket/bigbasket.js';
import { startTrackingHandler } from './src/controllers/BigBasketController.js';
import { startTrackingHandler as zeptoStartTrackingHandler } from './src/controllers/ZeptoController.js';

import zeptoRouter from './src/routes/api/zepto/zepto.js';

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
app.get('/', (req, res) => {
  res.send('Hello World!'); // Define a simple route for the root path
});

app.use('/api/instamart', instamartRouter); // Use the instamart route
app.use('/api/meesho', meeshoRouter);

// Add the BigBasket routes
app.use('/api/bigbasket', bigbasketRoutes);

app.use('/api/zepto', zeptoRouter);

// Global error handler
app.use(errorHandler);

// Start the server and initialize price tracking
app.listen(port, () => {
  console.log(`Server is running on port - ${port}`);
  // trackProductPrices(); // Start the price tracking when server starts
  // startTrackingHandler(); // For BigBasket?
  zeptoStartTrackingHandler(); // For Zepto
});
