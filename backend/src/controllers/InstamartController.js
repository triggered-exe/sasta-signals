import axios from "axios";
import { AppError } from "../utils/errorHandling.js";
import { InstamartProduct } from "../models/InstamartProduct.js";
import { HALF_HOUR, ONE_HOUR, PAGE_SIZE } from "../utils/constants.js";
import { Resend } from 'resend';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Constants and configuration for Instamart API requests
const INSTAMART_HEADERS = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.7",
  "content-type": "application/json",
  matcher: "cefb98e9gefbb99beeceecb",
  priority: "u=1, i",
  referer: "https://www.swiggy.com/instamart?",
  "sec-ch-ua": '"Chromium";v="130", "Brave";v="130", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "sec-gpc": "1",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
};

// Interval reference for price tracking
let trackingInterval = null;

// Initialize Resend client (replace MailerSend initialization)
const resend = new Resend(process.env.RESEND_API_KEY);

// Controller to fetch and return all product categories
export const getStoreData = async (req, res, next) => {
  try {
    const categories = await fetchProductCategories();
    console.log("sending categories", categories?.length);
    res.status(200).json(categories);
  } catch (error) {
    next(error);
  }
};

// Controller to fetch products within a specific subcategory
export const getSubcategoryProducts = async (req, res, next) => {
  try {
    const { filterId, filterName, categoryName, offset = 0 } = req.body;

    if (!filterId || !filterName || !categoryName) {
      throw AppError.badRequest("Missing required parameters");
    }

    const response = await axios.post(
      `https://www.swiggy.com/api/instamart/category-listing/filter`,
      { facets: {}, sortAttribute: "" },
      {
        params: {
          filterId,
          storeId: "1311100",
          primaryStoreId: "1311100",
          secondaryStoreId: "",
          type: "Speciality taxonomy 1",
          pageNo: 0,
          limit: 20,
          offset,
          filterName,
          categoryName,
        },
        headers: INSTAMART_HEADERS,
      }
    );
    if (!response.data || !response.data.data) {
      console.error("Swiggy API Response:", response?.data);
      throw AppError.serviceUnavailable("Failed to fetch products from Swiggy");
    }

    res.status(200).json(response.data);
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("Unexpected Error:", error);
      error = new AppError("An unexpected error occurred", 500);
    }
    next(error);
  }
};

// Controller to start periodic price tracking
export const trackPrices = async (req, res, next) => {
  try {
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
    trackProductPrices();
    trackingInterval = setInterval(() => trackProductPrices(), HALF_HOUR);
    res.status(200).json({ message: "Price tracking started" });
  } catch (error) {
    next(error);
  }
};

// Controller to fetch products with pagination and filtering
export const getProducts = async (req, res, next) => {
  try {
    const {
      page = "1",
      pageSize = PAGE_SIZE.toString(),
      sortOrder = "price",
      priceDropped = "false",
      notUpdated = "false",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const sortCriteria = buildSortCriteria(sortOrder);
    const matchCriteria = buildMatchCriteria(priceDropped, notUpdated);
    const totalProducts = await InstamartProduct.countDocuments(matchCriteria);
    const products = await InstamartProduct.aggregate([
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
    ]);

    res.status(200).json({
      data: products,
      totalPages: Math.ceil(totalProducts / parseInt(pageSize)),
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to build MongoDB sort criteria based on user preference
const buildSortCriteria = (sortOrder) => {
  const criteria = {};
  if (sortOrder === "price") criteria.price = 1;
  else if (sortOrder === "price_desc") criteria.price = -1;
  else if (sortOrder === "discount") criteria.discount = -1;
  return criteria;
};

// Helper function to build MongoDB match criteria for filtering products
const buildMatchCriteria = (priceDropped, notUpdated) => {
  const criteria = { inStock: true };
  if (priceDropped === "true") {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    criteria.priceDroppedAt = {
      $exists: true,
      $type: "date",
      $gte: oneHourAgo,
    };
  }
  console.log(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), "notUpdated");
  if (notUpdated === "true") {
    return {
      ...criteria,
      updatedAt: { $gt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    };
  }
  return criteria;
};

// Fetches all product categories from Instamart API
const fetchProductCategories = async () => {
  let allCategories = [];

  // Fetch data for pages 1-3
  for (let pageNo = 1; pageNo <= 2; pageNo++) {
    const response = await axios.get(
      "https://www.swiggy.com/api/instamart/home",
      {
        params: {
          pageNo,
          layoutId: 2671,
          storeId: 1311100,
          primaryStoreId: 1311100,
          secondaryStoreId: "",
          clientId: "INSTAMART-APP",
        },
        headers: INSTAMART_HEADERS,
      }
    );

    const widgets = response.data?.data?.widgets
      ?.filter((widget) => widget.type === "TAXONOMY")
      ?.flatMap((widget) => {
        const taxonomyType = widget.widgetInfo?.taxonomyType || "";
        return (widget.data || []).map((item) => ({
          ...item,
          taxonomyType,
        }));
      });

    const pageCategories =
      widgets?.map((item) => ({
        nodeId: item.nodeId,
        name: item.displayName,
        taxonomyType: item.taxonomyType,
        image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${item.imageId}`,
        subCategories: item.nodes.map((node) => ({
          nodeId: node.nodeId,
          name: node.displayName,
          image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${node.imageId}`,
          productCount: node.productCount,
        })),
      })) || [];

    allCategories = [...allCategories, ...pageCategories];
  }

  return allCategories;
};

// Fetches products for a specific subcategory with pagination
const fetchInstamartSubcategoryData = async (
  filterId,
  subcategoryName,
  categoryName,
  taxonomyType,
  offset = 0
) => {
  try {
    const response = await axios.post(
      `https://www.swiggy.com/api/instamart/category-listing/filter`,
      { facets: {}, sortAttribute: "" },
      {
        params: {
          filterId,
          storeId: "1311100",
          primaryStoreId: "1311100",
          secondaryStoreId: "",
          type: taxonomyType,
          pageNo: 0,
          limit: 20,
          offset,
          filterName: "",
          categoryName,
        },
        headers: INSTAMART_HEADERS,
      }
    );

    // Add debug logging
    // console.log('API Response:', JSON.stringify(response.data?.data, null, 2));

    const { totalItems = 0, widgets = [] } = response.data?.data || {};

    // Extract products from PRODUCT_LIST widgets
    const products = widgets
      .filter((widget) => widget.type === "PRODUCT_LIST")
      .flatMap((widget) => widget.data || [])
      .filter((product) => product); // Filter out any null/undefined products

    // console.log(`Found ${products.length} products in subcategory ${subcategoryName}`);

    return {
      products: Array.isArray(products) ? products : [],
      totalItems,
    };
  } catch (error) {
    console.error("Error fetching subcategory data:", error);
    return { products: [], totalItems: 0 };
  }
};

// Processes a single product for database storage and tracks price changes
const processProduct = async (product, category, subcategory) => {
  const currentPrice = product.variations?.[0]?.price?.offer_price || 0;

  const existingProduct = await InstamartProduct.findOne({
    productId: product.product_id,
  });

  // If product exists and price hasn't changed, skip the update
  if (existingProduct && existingProduct.price === currentPrice) {
    return null;
  }

  // Initialize previous price and priceDroppedAt
  let previousPrice = currentPrice;
  let priceDroppedAt = null;

  // Check if product exists and price has dropped
  if (existingProduct) {
    previousPrice = existingProduct.price;
    if (currentPrice < previousPrice) {
      priceDroppedAt = new Date();
    }
  }

  const productData = {
    categoryName: category.name,
    categoryId: category.nodeId,
    subcategoryName: subcategory.name,
    subcategoryId: subcategory.nodeId,
    productId: product.product_id,
    inStock: product.in_stock,
    imageUrl: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${product.variations?.[0]?.images?.[0] || "default_image"
      }`,
    productName: product.display_name,
    price: currentPrice,
    previousPrice,
    priceDroppedAt,
    discount: Math.floor(
      ((product.variations?.[0]?.price.store_price - currentPrice) /
        product.variations?.[0]?.price.store_price) *
      100
    ),
    variations:
      product.variations?.map((variation) => ({
        id: variation.id,
        display_name: variation.display_name,
        offer_price: variation.price.offer_price,
        store_price: variation.price.store_price,
        discount: Math.floor(
          ((variation.price.store_price - variation.price.offer_price) /
            variation.price.store_price) *
          100
        ),
        image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${variation.images?.[0] || "default_image"
          }`,
        quantity: variation.quantity,
        unit_of_measure: variation.unit_of_measure,
      })) || [],
    trackedAt: new Date(),
  };

  return {
    updateOne: {
      filter: { productId: product.product_id },
      update: { $set: productData },
      upsert: true,
    },
  };
};

// Sends email notification for products with price drops
const sendEmailWithDroppedProducts = async (droppedProducts) => {
  try {
    // Skip sending email if no dropped products
    if (!droppedProducts || droppedProducts.length === 0) {
      console.log("No dropped products to send email for");
      return;
    }

    console.log(`Attempting to send email for ${droppedProducts.length} dropped products`);

    const emailContent = `
      <h2>Recently Dropped Products</h2>
      <div style="font-family: Arial, sans-serif;">
        ${droppedProducts.map(product => `
          <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #eee; border-radius: 8px;">
            <a href="https://www.swiggy.com/stores/instamart/item/${product.productId}"  
               style="text-decoration: none; color: inherit; display: block;">
              <div style="display: flex; align-items: center;">
                <img src="${product.imageUrl}" 
                     alt="${product.productName}" 
                     style="width: 100px; height: 100px; object-fit: cover; border-radius: 4px; margin-right: 15px;">
                <div>
                  <h3 style="margin: 0 0 8px 0;">${product.productName}</h3>
                  <p style="margin: 4px 0; color: #2f80ed;">
                    Current Price: ₹${product.price}
                    <span style="text-decoration: line-through; color: #666; margin-left: 8px;">
                      ₹${product.previousPrice}
                    </span>
                  </p>
                  <p style="margin: 4px 0; color: #219653;">
                    Price Drop: ₹${(product.previousPrice - product.price).toFixed(2)} (${product.discount}% off)
                  </p>
                </div>
              </div>
            </a>
          </div>
        `).join('')}
      </div>
    `;

    // Verify Resend API key is set
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const response = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'harishanker.500apps@gmail.com',
      subject: '🔥 Price Drops Alert - Instamart Products',
      html: emailContent,
    });

    console.log("Email sent successfully", response);
  } catch (error) {
    console.error("Error sending email:", error?.response?.data || error);
    throw error;
  }
};

// Sends Telegram message for products with price drops
const sendTelegramMessage = async (droppedProducts) => {
  try {
    if (!droppedProducts || droppedProducts.length === 0) {
      console.log("No dropped products to send Telegram message for");
      return;
    }

    // Verify Telegram configuration
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
      console.error("Missing Telegram configuration. Please check your .env file");
      return;
    }

    // Filter products with discount > 49% and sort by highest discount
    const filteredProducts = droppedProducts
      .filter(product => product.discount > 49)
      .sort((a, b) => b.discount - a.discount);

    if (filteredProducts.length === 0) {
      console.log("No products with discount > 49%");
      return;
    }

    // Create a single message with all products
    const messageText = 
      `🔥 <b>Latest Price Drops (${filteredProducts.length} items)</b>\n\n` +
      filteredProducts.map(product => {
        const priceDrop = product.previousPrice - product.price;
        return `<b>${product.productName}</b>\n` +
               `💰 ₹${product.price} (was ₹${product.previousPrice})\n` +
               `📉 Drop: ₹${priceDrop.toFixed(2)} (${product.discount}%)\n` +
               `<a href="https://www.swiggy.com/stores/instamart/item/${product.productId}">View on Instamart</a>\n`;
      }).join('\n');

    // Send as a text message
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHANNEL_ID,
        text: messageText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }
    );

  } catch (error) {
    console.error("Error in Telegram message preparation:", error);
  }
};

// Main function to track product prices across all categories
const trackProductPrices = async () => {
  try {
    console.log("Fetching categories...");
    const categories = await fetchProductCategories();

    if (!categories?.length) {
      console.error("No categories found or invalid categories data");
      return;
    }

    console.log("Categories fetched:", categories.length);

    // Process categories in parallel
    await Promise.all(
      categories.map(async (category) => {
        console.log("processing category", category.name);
        if (!category.subCategories?.length) {
          console.log(
            `Skipping category ${category.name} - no subcategories found`
          );
          return;
        }

        // Process subcategories in parallel (in groups of 3 to avoid rate limiting)
        const subCategoryGroups = chunk(category.subCategories, 5);
        for (const subCategoryGroup of subCategoryGroups) {
          await Promise.all(
            subCategoryGroup.map(async (subCategory) => {
              try {
                let offset = 0;
                let allProducts = [];
                const BATCH_SIZE = 40; // Increased batch size

                while (true) {
                  const { products, totalItems } =
                    await fetchInstamartSubcategoryData(
                      subCategory.nodeId,
                      subCategory.name,
                      category.name,
                      category.taxonomyType,
                      offset
                    );

                  const validProducts = Array.isArray(products) ? products : [];
                  if (!validProducts.length) break;

                  allProducts = [...allProducts, ...validProducts];

                  if (allProducts.length >= totalItems || totalItems === 0)
                    break;
                  offset += BATCH_SIZE;
                }

                console.log(
                  `Found ${allProducts.length} products in subcategory ${subCategory.name}`
                );

                if (allProducts.length > 0) {
                  const bulkOperations = (
                    await Promise.all(
                      allProducts.map((product) =>
                        processProduct(product, category, subCategory)
                      )
                    )
                  ).filter(Boolean);

                  if (bulkOperations.length > 0) {
                    await InstamartProduct.bulkWrite(bulkOperations, {
                      ordered: false,
                    });
                  }
                }
              } catch (error) {
                console.error(
                  `Error processing subcategory ${subCategory.name}:`,
                  error
                );
              }
            })
          );
        }
      })
    );

    const droppedProducts = await InstamartProduct.find({
      priceDroppedAt: { $gte: new Date(Date.now() - HALF_HOUR) },
    }).sort({ discount: -1 });
    
    // Send both email and Telegram notifications
    await Promise.all([
      sendEmailWithDroppedProducts(droppedProducts),
      sendTelegramMessage(droppedProducts)
    ]);

    console.log("droppedProducts", droppedProducts.length);
    console.log("at", new Date());
  } catch (error) {
    console.error("Error tracking prices:", error);
    throw error;
  }
};

// Utility function to split arrays into smaller chunks for batch processing
const chunk = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// Controller to search products using Instamart's search API
export const search = async (req, res, next) => {
  try {
    const { query, offset = 0 } = req.body;

    if (!query) {
      throw AppError.badRequest("Query parameter is required");
    }

    const response = await axios.post(
      `https://www.swiggy.com/api/instamart/search`,
      { facets: {}, sortAttribute: "" },
      {
        params: {
          searchResultsOffset: offset,
          limit: 40,
          query,
          storeId: "1311100",
          primaryStoreId: "1311100",
          secondaryStoreId: "",
        },
        headers: {
          ...INSTAMART_HEADERS,
          Cookie:
            "deviceId=s%253A32b79aff-414d-4fb0-a759-df85f541312e.H1m4Tr18pypEEkkBIa%252BCo87Ft4iraHpp4mKmAKYhaKE; tid=s%253A04235f7c-720b-4708-81ed-fb8e66252512.UUMQhremwF41QpB9G7ytmOA%252Bodh2kypFE1p%252BwMRQi4M; versionCode=1200; platform=web; subplatform=mweb; statusBarHeight=0; bottomOffset=0; genieTrackOn=false; ally-on=false; isNative=false; strId=; openIMHP=false; userLocation=%257B%2522lat%2522%253A17.3585585%252C%2522lng%2522%253A78.4553883%252C%2522address%2522%253A%2522%2522%252C%2522id%2522%253A%2522%2522%252C%2522annotation%2522%253A%2522%2522%252C%2522name%2522%253A%2522%2522%257D",
        },
      }
    );

    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};
