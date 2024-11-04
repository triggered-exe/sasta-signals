import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './src/utils/errorHandling.js';
import './src/database.js'; // Import the database connection
import instamartRouter from './src/utils/routes/api/instamart/instamart.js'; // Import the instamart route
import meeshoRouter from './src/utils/routes/api/meesho/meesho.js';

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

// Global error handler
app.use(errorHandler);

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
