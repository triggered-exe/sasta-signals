import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logger from './utils/logger.js';

// Load environment variables from .env file
dotenv.config();

const mongoURI = process.env.MONGO_URI;

// Create a connection promise that we can await
const connectDB = async () => {
  try {
    await mongoose.connect(mongoURI);
    logger.info('MongoDB connected successfully');
  } catch (err) {
    logger.error(`MongoDB connection error: ${err.message || err}`, { error: err });
    process.exit(1); // Exit the process if database connection fails
  }
};

export { connectDB };
export default mongoose;
