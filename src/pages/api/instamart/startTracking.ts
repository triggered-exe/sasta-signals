import { NextApiRequest, NextApiResponse } from "next";
import { MongoClient } from "mongodb";
import axios from "axios";

let trackingInterval: NodeJS.Timeout | null = null; // Variable to store the interval reference
const ONE_HOUR = 60 * 60 * 1000; // 1-hour interval

// Function to establish a MongoDB connection
async function getMongoClient() {
  console.log("Connecting to MongoDB...");
  const client = new MongoClient(process.env.MONGO_URI as string);
  await client.connect();
  console.log("Connected to MongoDB.");
  return client;
}

// Helper function to fetch product categories and subcategories from Instamart API
async function fetchProductPrices() {
  try {
    console.log("Fetching product categories and subcategories from Instamart API...");
    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL}/api/instamart/store`);
    console.log("response", response);
    const data = response.data?.data?.widgets[1]?.data.map((item: any) => ({
      nodeId: item.nodeId,
      name: item.displayName,
      image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${item.imageId}`,
      subCategories: item.nodes.map((node: any) => ({
        nodeId: node.nodeId,
        name: node.displayName,
        image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${node.imageId}`,
        productCount: node.productCount,
      })),
    }));
    console.log("Categories and subcategories fetched successfully.");
    return data;
  } catch (error) {
    console.error("Error fetching product prices:", error);
    return null; // Return null if there's an error
  }
}

// Function to fetch product data for a specific subcategory with pagination
async function fetchInstamartSubcategoryData(subcategoryId: string, offset: number = 0) {
  try {
    const response = await axios.post(`${process.env.NEXT_PUBLIC_BASE_URL}/api/instamart/fetchSubcategory`, {
      filterId: subcategoryId,
      offset,
    });

    const { totalItems, widgets } = response.data?.data;
    const products =
      widgets
        ?.filter((item: any) => item.type === "PRODUCT_LIST")
        .flatMap((item: any) => item.data) || [];

    return { products, totalItems };
  } catch (error) {
    console.error("Error fetching subcategory data:", error);
    return { products: [], totalItems: 0 }; // Return an empty array in case of error
  }
}

// Function to process each product
async function processProduct(product: any, category: any, subcategory: any, collection: any) {
  const productId = product.product_id;
  const currentPrice = product.variations?.[0]?.price?.offer_price || product.variations?.[0]?.price?.store_price || 0;

  // Fetch the current product details from the database
  const existingProduct = await collection.findOne({ productId });

  // Initialize previous price and priceDroppedAt
  let previousPrice = currentPrice;
  let priceDroppedAt = null;

  // Check if the product already exists and compare prices
  if (existingProduct) {
    previousPrice = existingProduct.price;
    if (currentPrice < previousPrice) {
      priceDroppedAt = new Date(); // Mark the time of the price drop
    }
  }

  const productData = {
    categoryName: category.name,
    categoryId: category.nodeId,
    subcategoryName: subcategory.name,
    subcategoryId: subcategory.nodeId,
    productId: productId,
    inStock: product.in_stock,
    imageUrl: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${product.variations?.[0]?.images?.[0] || 'default_image'}`,
    productName: product.display_name,
    price: currentPrice,
    previousPrice: previousPrice,
    priceDroppedAt: priceDroppedAt,
    discount: parseInt(product.variations?.[0]?.price?.offer_applied?.listing_description?.match(/\d+/)?.[0]) || 0,
    variations: product.variations?.map((variation: any) => ({
      id: variation.id,
      display_name: variation.display_name,
      offer_price: variation.price.offer_price,
      store_price: variation.price.store_price,
      discount: parseInt(variation.price?.offer_applied?.listing_description?.match(/\d+/)?.[0]) || 0,
      image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${variation.images?.[0] || 'default_image'}`,
      quantity: variation.quantity,
      unit_of_measure: variation.unit_of_measure,
    })) || [],
    trackedAt: new Date(),
  };

  // Create upsert operation
  return {
    updateOne: {
      filter: { productId },
      update: { $set: productData },
      upsert: true, // If the product doesn't exist, insert it
    },
  };
}

// Function to track product prices and store them in the database
async function trackProductPrices() {
  let client;
  try {
    console.log("Tracking product prices... process.env.NEXT_PUBLIC_BASE_URL", process.env.NEXT_PUBLIC_BASE_URL);
    const categories = await fetchProductPrices();
    if (!categories) {
      console.log("No product data available.");
      return;
    }else{
      console.log("Categories fetched successfully.");
    }

    client = await getMongoClient();
    const db = client.db("price-tracker");
    const collection = db.collection("instamartProducts");

    // Create indexes for better performance
    await collection.createIndex({ productId: 1 }, { unique: true });
    await collection.createIndex({ categoryId: 1 });
    await collection.createIndex({ subcategoryId: 1 });
    await collection.createIndex({ price: 1 });

    // Process categories and subcategories concurrently using Promise.all
    await Promise.all(
      categories.map(async (category: any) => {
        await Promise.all(
          category.subCategories.map(async (subcategory: any) => {
            let hasMore = true;
            let offset = 0;
            let allProducts: any[] = [];

            while (hasMore) {
              const { products: subcategoryProducts, totalItems } = await fetchInstamartSubcategoryData(subcategory.nodeId, offset);
              allProducts = [...allProducts, ...subcategoryProducts];

              if (allProducts.length >= totalItems) {
                hasMore = false;
              } else {
                offset += subcategoryProducts.length;
              }
            }

            // Process products concurrently and perform bulk write in parallel
            const bulkOperations = await Promise.all(
              allProducts.map((product) => processProduct(product, category, subcategory, collection))
            );

            if (bulkOperations.length > 0) {
              // Perform bulk write
              await collection.bulkWrite(bulkOperations);
              console.log(`Processed ${bulkOperations.length} products for subcategory: ${subcategory.name}`);
            }
          })
        );
      })
    );

    console.log("Product prices updated in the database.");
  } catch (error) {
    console.error("Error tracking product prices:", error);
  } finally {
    if (client) {
      await client.close();
      console.log("MongoDB connection closed.");
    }
  }
}

// API route handler to start or stop tracking
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed" });
  }

  const { action } = req.body;

  if (action === "start") {
    // Start the price tracking process if not already running
    if (!trackingInterval) {
      console.log("Starting price tracking...");
      trackProductPrices(); // Initial fetch before setting the interval
      trackingInterval = setInterval(() => {
        console.log("Running price tracking at 1-hour interval...");
        trackProductPrices(); // Execute price tracking every 1 hour
      }, ONE_HOUR);
      console.log("Price tracking started, running every hour.");
      res.status(200).json({ message: "Price tracking started" });
    } else {
      console.log("Price tracking is already running.");
      res.status(400).json({ message: "Price tracking is already running" });
    }
  } else if (action === "stop") {
    // Stop the price tracking process
    if (trackingInterval) {
      console.log("Stopping price tracking...");
      clearInterval(trackingInterval); // Stop the interval
      trackingInterval = null;
      console.log("Price tracking stopped.");
      res.status(200).json({ message: "Price tracking stopped" });
    } else {
      console.log("Price tracking is not running.");
      res.status(400).json({ message: "Price tracking is not running" });
    }
  } else {
    console.log("Invalid action received:", action);
    res.status(400).json({ error: "Invalid action" });
  }
}
