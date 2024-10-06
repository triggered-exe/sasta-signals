import { NextApiRequest, NextApiResponse } from "next";
import { MongoClient } from "mongodb";

const PAGE_SIZE = 10;

// Function to establish a MongoDB connection
async function getMongoClient() {
  const client = new MongoClient(process.env.MONGO_URI as string);
  await client.connect();
  return client;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const {
      page = "1",
      pageSize = PAGE_SIZE.toString(),
      sortOrder = "price",
      priceDropped = "false",
    } = req.query;

    const client = await getMongoClient();
    const db = client.db("price-tracker");
    const collection = db.collection("instamartProducts");

    const skip = (parseInt(page) - 1) * parseInt(pageSize);

    // Define sort criteria
    const sortCriteria: Record<string, 1 | -1> = {};
    if (sortOrder === "price") {
      sortCriteria.price = 1; // Ascending
    } else if (sortOrder === "price_desc") {
      sortCriteria.price = -1; // Descending
    } else if (sortOrder === "discount") {
      sortCriteria.discount = -1; // Discount descending
    }

    // Define match criteria for price drops
    const matchCriteria: Record<string, unknown> = { inStock: true };

    if (priceDropped === "true") {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      matchCriteria.priceDroppedAt = { $exists: true, $type: "date", $gte: oneHourAgo }; // Ensure priceDroppedAt is a Date and recent
    }

    // Fetch total count for pagination
    const totalProducts = await collection.countDocuments(matchCriteria);

    // Use aggregation pipeline with allowDiskUse option
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

    const totalPages = Math.ceil(totalProducts / parseInt(pageSize));

    res.status(200).json({ data: products, totalPages });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
}
