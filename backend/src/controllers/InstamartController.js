import axios from "axios";
import { AppError } from "../utils/errorHandling.js";
import { InstamartProduct } from "../models/InstamartProduct.js";
import { HALF_HOUR, ONE_HOUR, PAGE_SIZE } from "../utils/constants.js";
import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";

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

let trackingInterval = null;

const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY,
});

export const getStoreData = async (req, res, next) => {
  try {
    const categories = await fetchProductCategories()
    console.log('sending categories', categories?.length)
    res.status(200).json(categories);
  } catch (error) {
    next(error);
  }
};

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
    )
    if(!response.data || !response.data.data) {
      console.error('Swiggy API Response:', response?.data);
      throw AppError.serviceUnavailable("Failed to fetch products from Swiggy");
    }

    res.status(200).json(response.data);
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error('Unexpected Error:', error);
      error = new AppError("An unexpected error occurred", 500);
    }
    next(error);
  }
};

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

export const getProducts = async (req, res, next) => {
  try {
    const {
      page = "1",
      pageSize = PAGE_SIZE.toString(),
      sortOrder = "price",
      priceDropped = "false",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const sortCriteria = buildSortCriteria(sortOrder);
    const matchCriteria = buildMatchCriteria(priceDropped);

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

const buildSortCriteria = (sortOrder) => {
  const criteria = {};
  if (sortOrder === "price") criteria.price = 1;
  else if (sortOrder === "price_desc") criteria.price = -1;
  else if (sortOrder === "discount") criteria.discount = -1;
  return criteria;
};

const buildMatchCriteria = (priceDropped) => {
  const criteria = { inStock: true };
  if (priceDropped === "true") {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    criteria.priceDroppedAt = {
      $exists: true,
      $type: "date",
      $gte: oneHourAgo,
    };
  }
  return criteria;
};

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
        return (widget.data || []).map(item => ({
          ...item,
          taxonomyType
        }));
      });

    const pageCategories = widgets?.map((item) => ({
      nodeId: item.nodeId,
      name: item.displayName,
      taxonomyType: item.taxonomyType,
      image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${item.imageId}`,
      subCategories: item.nodes.map((node) => ({
        nodeId: node.nodeId,
        name: node.displayName,
        image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${node.imageId}`,
        productCount: node.productCount
      })),
    })) || [];

    allCategories = [...allCategories, ...pageCategories];
  }

  return allCategories;
};

const fetchInstamartSubcategoryData = async (filterId, subcategoryName, categoryName, taxonomyType, offset = 0) => {
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
      .filter(widget => widget.type === "PRODUCT_LIST")
      .flatMap(widget => widget.data || [])
      .filter(product => product); // Filter out any null/undefined products

    // console.log(`Found ${products.length} products in subcategory ${subcategoryName}`);

    return { 
      products: Array.isArray(products) ? products : [], 
      totalItems 
    };
  } catch (error) {
    console.error('Error fetching subcategory data:', error);
    return { products: [], totalItems: 0 };
  }
};

const processProduct = async (product, category, subcategory) => {
  const currentPrice = product.variations?.[0]?.price?.offer_price || 0;
  
  const existingProduct = await InstamartProduct.findOne({ productId: product.product_id });
  
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
    imageUrl: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${
      product.variations?.[0]?.images?.[0] || "default_image"
    }`,
    productName: product.display_name,
    price: currentPrice,
    previousPrice,
    priceDroppedAt,
    discount: Math.floor(
      ((product.variations?.[0]?.price.store_price - currentPrice) / 
      product.variations?.[0]?.price.store_price) * 100
    ),
    variations: product.variations?.map((variation) => ({
      id: variation.id,
      display_name: variation.display_name,
      offer_price: variation.price.offer_price,
      store_price: variation.price.store_price,
      discount: Math.floor(
        ((variation.price.store_price - variation.price.offer_price) / 
        variation.price.store_price) * 100
      ),
      image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${
        variation.images?.[0] || "default_image"
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

const sendEmailWithDroppedProducts = async (droppedProducts) => {
  const emailContent = `
    <h2>Recently Dropped Products</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th>Product Name</th>
          <th>Current Price</th>
          <th>Previous Price</th>
          <th>Discount</th>
        </tr>
      </thead>
      <tbody>
        ${droppedProducts.map(product => `
          <tr>
            <td>${product.productName}</td>
            <td>${product.price}</td>
            <td>${product.previousPrice}</td>
            <td>${product.discount}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const sentFrom = new Sender("MS_Dle5Er@trial-jy7zpl96zzol5vx6.mlsender.net", "Instamart Price dropped");
  const recipients = [new Recipient("harishankersharma648@gmail.com", "Your Client")];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject("Recently Dropped Products")
    .setHtml(emailContent);

  await mailerSend.email.send(emailParams);
};

const trackProductPrices = async () => {
  try {
    console.log("Fetching categories...");
    const categories = await fetchProductCategories();
    
    if (!categories || !Array.isArray(categories)) {
      console.error("No categories found or invalid categories data");
      return;
    }
    
    console.log("Categories fetched:", categories.length);

    for (const category of categories) {
      console.log('processing category', category.name)
      if (!category.subCategories || !Array.isArray(category.subCategories)) {
        console.log(`Skipping category ${category.name} - no subcategories found`);
        continue;
      }

      for (const subCategory of category.subCategories) {
        try {
          let offset = 0;
          let hasMore = true;
          let allProducts = [];

          while (hasMore) {
            const { products, totalItems } = await fetchInstamartSubcategoryData(
              subCategory.nodeId,
              subCategory.name,
              category.name,
              category.taxonomyType,
              offset
            );

            // Ensure products is an array
            const validProducts = Array.isArray(products) ? products : [];

            if (validProducts.length === 0) {
              hasMore = false;
              continue;
            }

            allProducts = [...allProducts, ...validProducts];
            
            if (allProducts.length >= totalItems || totalItems === 0) {
              hasMore = false;
            } else {
              offset += 20;
            }
          }

          console.log(`Found ${allProducts.length} products in subcategory ${subCategory.name}`);

          if (allProducts.length > 0) {
            const bulkOperations = (await Promise.all(
              allProducts.map(product => processProduct(product, category, subCategory))
            )).filter(operation => operation !== null);

            if (bulkOperations.length > 0) {
              await InstamartProduct.bulkWrite(bulkOperations);
            //   console.log(`Processed ${bulkOperations.length} products for ${subCategory.name}`);
            }
          } else {
            console.log(`No products found for subcategory: ${subCategory.name}`);
          }
        } catch (error) {
          console.error(`Error processing subcategory ${subCategory.name}:`, error);
          // Continue with next subcategory
          continue;
        }
      }
    }

    // Send email for dropped prices
    const droppedProducts = await InstamartProduct.find({
      priceDroppedAt: { $gte: new Date(Date.now() - ONE_HOUR) }
    });

    console.log('droppedProducts', droppedProducts.length, "at", new Date().toISOString())
    console.log("Price tracking completed");
  } catch (error) {
    console.error("Error tracking prices:", error);
    throw error;
  }
};

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
