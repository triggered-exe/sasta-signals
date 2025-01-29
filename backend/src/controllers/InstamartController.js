import axios from "axios";
import { AppError } from "../utils/errorHandling.js";
import { InstamartProduct } from "../models/InstamartProduct.js";
import { HALF_HOUR, ONE_HOUR, PAGE_SIZE } from "../utils/constants.js";
import { Resend } from "resend";
import { isNightTimeIST, chunk, buildSortCriteria, buildMatchCriteria } from "../utils/priceTracking.js";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const placesData = {};
const CATEGORY_CHUNK_SIZE = 3;
const SUBCATEGORY_CHUNK_SIZE = 2;
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

// Remove trackingInterval variable as we'll use continuous tracking
let isTrackingActive = false;

// Initialize Resend client (replace MailerSend initialization)
const resend = new Resend(process.env.RESEND_API_KEY);

// Controller to fetch and return all product categories
export const getStoreData = async (req, res, next) => {
  try {
    const categories = await fetchProductCategories();
    console.log("IM:sending categories", categories?.length);
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
      console.error("IM:Swiggy API Response:", response?.data);
      throw AppError.serviceUnavailable("Failed to fetch products from Swiggy");
    }

    res.status(200).json(response.data);
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("IM:Unexpected Error:", error);
      error = new AppError("An unexpected error occurred", 500);
    }
    next(error);
  }
};

// Controller to start periodic price tracking
export const trackPrices = async (req, res, next) => {
  try {
    const message = await startTrackingHandler();
    res.status(200).json({ message });
  } catch (error) {
    next(error);
  }
};

// Handler to start tracking
export const startTrackingHandler = async () => {
  console.log("IM: starting tracking");
  // Start the continuous tracking loop without awaiting it
  trackProductPrices().catch(error => {
    console.error('IM: Failed in tracking loop:', error);
  });
  return "Instamart price tracking started";
};

// Process categories linearly instead of in parallel
const processCategoriesChunk = async (categoryChunk, storeId, cookie) => {
  try {
    // Process each category sequentially
    for (const category of categoryChunk) {
      try {
        console.log("IM: processing category", category.name);
        if (!category.subCategories?.length) {
          console.log(`IM: Skipping category ${category.name} - no subcategories found`);
          continue;
        }

        // Process subcategories sequentially
        for (const subCategory of category.subCategories) {
          try {
            let offset = 0;
            let pageNo = 0;
            let limit = 20;
            let allProducts = [];
            const BATCH_SIZE = 20;

            while (true) {
              let retryCount = 0;
              const MAX_RETRIES = 3;

              try {
                // Fetch subcategory data
                const response = await axios.post(
                  `https://www.swiggy.com/api/instamart/category-listing/filter`,
                  { facets: {}, sortAttribute: "" },
                  {
                    params: {
                      filterId: subCategory.nodeId,
                      storeId,
                      offset,
                      primaryStoreId: storeId,
                      secondaryStoreId: "",
                      type: category.taxonomyType,
                      pageNo: pageNo,
                      limit: limit,
                      filterName: subCategory.name,
                      categoryName: category.name
                    },
                    headers: {
                      'accept': '*/*',
                      'accept-language': 'en-US,en;q=0.5',
                      'content-type': 'application/json',
                      'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
                      'cookie': cookie
                    }
                  }
                );

                const { totalItems = 0, widgets = [], hasMore = false, offset: offsetResponse = 0, pageNo: pageNoResponse = 0 } = response.data?.data || {};

                // Check if the response is empty and rate limit is hit
                if (!response.data.data) {
                  if (!allProducts.length) {
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                      console.log(`IM: Max retries (${MAX_RETRIES}) reached for subcategory ${subCategory.name}`);
                      break;
                    }
                    // Wait for progressively longer times between retries (1m, 2m, 3m)
                    const waitTime = retryCount * 60 * 1000;

                    console.log(`IM: Rate limit hit (attempt ${retryCount}/${MAX_RETRIES}), waiting for ${waitTime / 1000} seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue; // Retry the same request
                  } else {
                    break; // Only break if we have some products already
                  }
                }

                // Extract products from PRODUCT_LIST widgets
                const products = widgets
                  .filter((widget) => widget.type === "PRODUCT_LIST")
                  .flatMap((widget) => widget.data || [])
                  .filter((product) => product);

                // console.log(`IM: Found ${products.length} products in subcategory ${subCategory.name}`);

                if (!products.length) {
                  console.log("IM: no products found in subcategory", subCategory.name);
                  break;
                }

                allProducts = [...allProducts, ...products];

                // Break if no more products or reached total
                if (!hasMore || allProducts.length >= totalItems) break;

                offset = offsetResponse;
                pageNo = pageNoResponse + 1;

              } catch (error) {
                throw error;
              }
            }

            // After processing products in each subcategory
            if (allProducts.length > 0) {
              console.log("IM: Processing products for subcategory", subCategory.name, "length", allProducts.length);
              const updatedCount = await processProducts(allProducts, category, subCategory);
              console.log(`IM: Processed ${updatedCount} products in ${subCategory.name}`);
            }
          } catch (error) {
            console.error(`IM: Error processing subcategory ${subCategory.name}:`, error.response);
            await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
            // Continue with next subcategory even if one fails
            continue;
          }
        }
      } catch (error) {
        console.error(`IM: Error processing category ${category.name}:`, error);
        // Continue with next category even if one fails
        continue;
      }
    }
  } catch (error) {
    console.error('IM: Error processing category chunk:', error);
  }
};

// Main function to track product prices across all categories
export const trackProductPrices = async () => {
  // Prevent multiple tracking instances
  if (isTrackingActive) {
    console.log("IM: Tracking is already active");
    return;
  }

  isTrackingActive = true;

  while (true) {
    try {
      // Skip if it's night time (12 AM to 6 AM IST)
      if (isNightTimeIST()) {
        console.log("IM: Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      console.log("IM: Starting new tracking cycle at:", new Date().toISOString());

      const { categories, storeId, cookie } = await fetchProductCategories();

      if (!categories?.length) {
        console.error("IM: No categories found or invalid categories data");
        continue;
      }

      console.log("IM: Categories fetched:", categories.length);

      // Process categories in parallel (in groups of 3 to avoid rate limiting)
      const categoryChunks = chunk(categories, CATEGORY_CHUNK_SIZE);

      for (const categoryChunk of categoryChunks) {
        await processCategoriesChunk(categoryChunk, storeId, cookie);
      }

      console.log("IM: Tracking cycle completed at:", new Date().toISOString());

      // Add a delay before starting the next cycle
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));

    } catch (error) {
      console.error("IM: Error in tracking cycle:", error);
      // Wait before retrying after error
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
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

// Fetches all product categories from Instamart API
const fetchProductCategories = async (address = "500064") => {
  try {
    if (placesData[address]) {
      return placesData[address];
    }
    // Step1: Get the place suggestions using the pincode/address
    const placeResponse = await axios.get(
      `https://www.swiggy.com/mapi/misc/place-autocomplete`,
      {
        params: { input: address },
        headers: {
          '__fetch_req__': 'true',
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.5',
          'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'
        }
      }
    );

    if (!placeResponse.data?.data?.length) {
      throw new Error('No locations found for the given address');
    }

    // Step2: Get complete address using place_id
    const placeId = placeResponse.data.data[0].place_id;
    const storeResponse = await axios.get(
      `https://www.swiggy.com/dapi/misc/address-recommend`,
      {
        params: { place_id: placeId },
        headers: {
          'accept': '*/*',
          'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
        }
      }
    );

    if (!storeResponse.data?.data) {
      throw new Error('Failed to get store details');
    }

    const { lat, lng } = storeResponse.data.data[0].geometry.location;
    console.log("IM: got lat and lng", lat, lng);

    // Step3: Get the store id using location
    const userLocation = {
      lat,
      lng,
      id: "",
      annotation: "",
      name: ""
    };

    const locationCookie = `userLocation=${JSON.stringify(userLocation)}`;
    const response = await axios.get(
      "https://www.swiggy.com/api/instamart/home",
      {
        params: {
          clientId: "INSTAMART-APP"
        },
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.5',
          'cache-control': 'no-cache',
          'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
          'cookie': locationCookie
        }
      }
    );

    if (!response.data?.data?.storeId) {
      console.log("IM: response", response);
      throw new Error('Failed to get store details');
    }

    const storeId = response.data.data.storeId;
    console.log("IM: got store id", storeId);

    // Step4: Fetch categories using storeId
    const categoriesResponse = await axios.get(
      `https://www.swiggy.com/api/instamart/layout`,
      {
        params: {
          layoutId: '3742',
          limit: '40',
          pageNo: '0',
          serviceLine: 'INSTAMART',
          customerPage: 'STORES_MENU',
          hasMasthead: 'false',
          storeId: storeId,
          primaryStoreId: storeId,
          secondaryStoreId: ''
        },
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.5',
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'
        }
      }
    );

    if (!categoriesResponse.data?.data?.widgets) {
      throw new Error('Failed to fetch categories');
    }

    // Process categories from widgets
    const widgets = categoriesResponse.data.data.widgets
      .filter(widget => widget.widgetInfo?.widgetType === "TAXONOMY");

    // From widgets get the categories
    const allCategoriesWithSubCategories = widgets.flatMap(widget =>
      widget.data.map(category => ({
        nodeId: category.nodeId,
        name: category.displayName,
        taxonomyType: widget.widgetInfo.taxonomyType,
        subCategories: category.nodes.map(node => ({
          nodeId: node.nodeId,
          name: node.displayName,
          image: node.imageId,
          productCount: node.productCount
        }))
      }))
    );

    placesData[address] = {
      categories: allCategoriesWithSubCategories,
      storeId: storeId,
      cookie: locationCookie,
      lat,
      lng
    };

    return placesData[address];
  } catch (error) {
    console.error('IM: Error fetching categories:', error?.response?.data || error);
    throw new AppError('Failed to fetch categories', 500);
  }
};

// Process multiple products and their variations in bulk
const processProducts = async (products, category, subcategory) => {
  try {
    // Flatten all variations into a single array
    const allVariations = products.flatMap(product =>
      product.variations?.map(variation => ({
        ...variation,
        product_id: product.product_id,
        product_name: product.display_name,
        product_description: variation.meta?.short_description || '',
        sourcing_time: variation.sourcing_time || '',
        sourced_from: variation.sourced_from || '',
      })) || []
    );

    // Get all existing variations
    const existingProducts = await InstamartProduct.find({
      variationId: { $in: allVariations.map(v => v.id) }
    }).lean();

    const existingProductsMap = new Map(
      existingProducts.map(product => [product.variationId, product])
    );

    const droppedProducts = [];

    const bulkOperations = allVariations
      .map(variation => {
        const currentPrice = variation.price?.offer_price || 0;
        const existingProduct = existingProductsMap.get(variation.id);

        // Skip if price hasn't changed
        if (existingProduct && existingProduct.price === currentPrice) {
          return null;
        }

        let previousPrice = currentPrice;
        let priceDroppedAt = null;
        let priceDropNotificationSent = true;

        if (existingProduct) {
          previousPrice = existingProduct.price;
          if (currentPrice < previousPrice) {
            priceDroppedAt = new Date();
            priceDropNotificationSent = false;
            currentDiscount = Math.floor(((variation.price?.discount_value) / variation.price?.mrp) * 100);
            previousDiscount = existingProduct.discount;
            // The current discount should be greater than or equal to 20% more than the previous discount
            if (currentDiscount >= previousDiscount - 20) {
              // Add the complete product data to droppedProducts
              droppedProducts.push({
                productId: variation.product_id,
                productName: variation.product_name,
                price: currentPrice,
                previousPrice,
                discount: currentDiscount,
                variationId: variation.id
              });
            }
          }
        }

        const productData = {
          categoryName: category.name,
          categoryId: category.nodeId,
          subcategoryName: subcategory.name,
          subcategoryId: subcategory.nodeId,
          productId: variation.product_id,
          variationId: variation.id,
          productName: variation.product_name,
          displayName: variation.display_name,
          description: variation.product_description,
          inStock: variation.inventory?.in_stock || true,
          imageUrl: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${variation.images?.[0] || "default_image"}`,
          price: currentPrice,
          previousPrice,
          priceDroppedAt,
          priceDropNotificationSent,
          mrp: variation.price?.mrp || 0,
          storePrice: variation.price?.store_price || 0,
          discount: Math.floor(
            ((variation.price?.discount_value) /
              variation.price?.mrp) *
            100
          ),
          quantity: variation.quantity,
          unit: variation.unit_of_measure,
          weight: variation.weight_in_grams,
        };

        return {
          updateOne: {
            filter: { variationId: variation.id },
            update: { $set: productData },
            upsert: true,
          },
        };
      })
      .filter(Boolean);

    if (droppedProducts.length > 0) {
      console.log(`IM: Found ${droppedProducts.length} dropped products in ${subcategory.name}`);
      try {
        await sendTelegramMessage(droppedProducts);
      } catch (error) {
        console.error('IM: Error sending Telegram notification:', error);
        // Don't throw the error to continue processing
      }
    }

    if (bulkOperations.length > 0) {
      await InstamartProduct.bulkWrite(bulkOperations, { ordered: false });
      console.log(`IM: Updated ${bulkOperations.length} variations in ${subcategory.name}`);
    } else {
      console.log("IM: No variations to update in", subcategory.name);
    }

    return bulkOperations.length;
  } catch (error) {
    console.error('IM: Error processing products:', error);
    return 0;
  }
};

// Sends email notification for products with price drops
const sendEmailWithDroppedProducts = async (droppedProducts) => {
  try {
    // Skip sending email if no dropped products
    if (!droppedProducts || droppedProducts.length === 0) {
      console.log("IM: No dropped products to send email for");
      return;
    }

    // Chunk products into groups of 10
    const productChunks = chunk(droppedProducts, 10);
    console.log(`IM: Sending email for ${droppedProducts.length} products in ${productChunks.length} chunks`);

    for (const products of productChunks) {
      const emailContent = `
        <h2>Recently Dropped Products</h2>
        <div style="font-family: Arial, sans-serif;">
          ${products
          .map(
            (product) => `
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
          `
          )
          .join("")}
        </div>
      `;

      await resend.emails.send({
        from: "onboarding@resend.dev",
        to: "harishanker.500apps@gmail.com",
        subject: "🔥 Price Drops Alert - Instamart Products",
        html: emailContent,
      });

      // Mark these products as notified
      const variationIds = products.map(p => p.variationId);
      await InstamartProduct.updateMany(
        { variationId: { $in: variationIds } },
        { $set: { priceDropNotificationSent: true } }
      );
    }

    console.log("IM: Email notifications sent and products marked as notified");
  } catch (error) {
    console.error("IM: Error sending email:", error);
  }
};

// Sends Telegram notification for products with price drops
const sendTelegramMessage = async (droppedProducts) => {
  try {
    if (!droppedProducts || droppedProducts.length === 0) {
      console.log("IM: No dropped products to send Telegram message for");
      return;
    }

    // Filter products with discount > 59% and sort by highest discount
    const filteredProducts = droppedProducts
      .filter((product) => product.discount > 59)
      .sort((a, b) => b.discount - a.discount);

    if (filteredProducts.length === 0) {
      return;
    }

    // Chunk products into groups of 10
    const productChunks = chunk(filteredProducts, 10);
    console.log(`IM: Sending Telegram messages for ${filteredProducts.length} products`);

    for (let i = 0; i < productChunks.length; i++) {
      const products = productChunks[i];
      const messageText = `🔥 <b>Instamart Price Drops</b>\n\n` +
        products.map((product) => {
          const priceDrop = product.previousPrice - product.price;
          return (
            `<b>${product.productName}</b>\n` +
            `💰 Current: ₹${product.price}\n` +
            `📊 Previous: ₹${product.previousPrice}\n` +
            `📉 Drop: ₹${priceDrop.toFixed(2)} (${product.discount}% off)\n` +
            `🔗 <a href="https://www.swiggy.com/stores/instamart/item/${product.productId}">View on Instamart</a>\n`
          );
        }).join("\n");

      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHANNEL_ID,
          text: messageText,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }
      );

      // Add delay between chunks
      if (i < productChunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`IM: Sent notifications for ${filteredProducts.length} products`);
  } catch (error) {
    console.error("IM: Error sending Telegram message:", error?.response?.data || error);
    throw error; // Rethrow to handle in the calling function
  }
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
