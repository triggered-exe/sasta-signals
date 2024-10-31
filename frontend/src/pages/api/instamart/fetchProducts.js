import { MongoClient } from "mongodb";

const PAGE_SIZE = 10;

// Function to establish a MongoDB connection
async function getMongoClient() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in environment variables");
    }
    console.log("MONGO_URI type:", typeof process.env.MONGO_URI);
    console.log("MONGO_URI value:", process.env.MONGO_URI.substring(0, 20) + "..."); // Log first 20 chars for security

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    return client;
  } catch (error) {
    console.error("Error in getMongoClient:", error);
    throw error;
  }
}

export default async function handler(req, res) {
  let client;
  try {
    const {
      page = "1",
      pageSize = PAGE_SIZE.toString(),
      sortOrder = "price",
      priceDropped = "false",
    } = req.query;

    console.log("Query parameters:", { page, pageSize, sortOrder, priceDropped });

    client = await getMongoClient();
    console.log("MongoDB connection established");

    const db = client.db("price-tracker");
    const collection = db.collection("instamartProducts");

    const skip = (parseInt(page) - 1) * parseInt(pageSize);

    // Define sort criteria
    const sortCriteria = {};
    if (sortOrder === "price") {
      sortCriteria.price = 1; // Ascending
    } else if (sortOrder === "price_desc") {
      sortCriteria.price = -1; // Descending
    } else if (sortOrder === "discount") {
      sortCriteria.discount = -1; // Discount descending
    }

    // Define match criteria for price drops
    const matchCriteria = { inStock: true };

    if (priceDropped === "true") {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      matchCriteria.priceDroppedAt = { $exists: true, $type: "date", $gte: oneHourAgo };
    }

    console.log("Match criteria:", matchCriteria);
    console.log("Sort criteria:", sortCriteria);

    // Fetch total count for pagination
    const totalProducts = await collection.countDocuments(matchCriteria);
    console.log("Total products:", totalProducts);

    // Use aggregation pipeline
    const products = await collection
      .aggregate([
        { $match: matchCriteria },
        { $sort: sortCriteria },
        { $skip: skip },
        { $limit: parseInt(pageSize) },
        {
          $project: {
            productId: 1,
            productName: 1,
            price: 1,
            discount: 1,
            variations: 1,
            subcategoryName: 1,
            imageUrl: 1,
            priceDroppedAt: 1,
          },
        },
      ])
      .toArray();

    console.log("Fetched products count:", products.length);

    const totalPages = Math.ceil(totalProducts / parseInt(pageSize));

    res.status(200).json({ data: products, totalPages });
  } catch (error) {
    console.error("Error in handler:", error);
    res.status(500).json({ error: "Failed to fetch products", details: error.message });
  } finally {
    if (client) {
      try {
        await client.close();
        console.log("MongoDB connection closed");
      } catch (closeError) {
        console.error("Error closing MongoDB connection:", closeError);
      }
    }
  }
}
