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

app.get('/api/test-telegram', async (req, res) => {
  try {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    // Log configuration (remove in production)
    console.log('Bot Token:', TELEGRAM_BOT_TOKEN?.slice(0, 5) + '...');
    console.log('Channel ID:', TELEGRAM_CHANNEL_ID);

    // Verify Telegram configuration
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
      return res.status(500).json({ 
        error: "Missing Telegram configuration. Please check your .env file" 
      });
    }

    // First, try to get bot info
    const botInfo = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`
    );
    
    console.log('Bot Info:', botInfo.data);

    // Send test message
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHANNEL_ID,
        text: "👋 Hello World! This is a test message from your Instamart Price Tracker bot.",
        parse_mode: 'HTML'
      }
    );

    res.json({ 
      success: true, 
      botInfo: botInfo.data,
      message: "Telegram test message sent successfully",
      response: response.data 
    });

  } catch (error) {
    console.error("Full error:", error);
    console.error("Error response:", error.response?.data);
    
    // Modified error response to use variables from within try block scope
    res.status(500).json({ 
      error: "Failed to send Telegram message", 
      details: error.response?.data || error.message
    });
  }
});

// Add the BigBasket routes
app.use('/api/bigbasket', bigbasketRoutes);

// Global error handler
app.use(errorHandler);

// Start the server and initialize price tracking
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  // trackProductPrices(); // Start the price tracking when server starts
});
