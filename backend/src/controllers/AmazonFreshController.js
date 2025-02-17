import { firefox } from "playwright";
import { AppError } from "../utils/errorHandling.js";
import { AmazonFreshProduct } from "../models/AmazonFreshProduct.js";
import { HALF_HOUR, ONE_HOUR, PAGE_SIZE } from "../utils/constants.js";
import { isNightTimeIST, chunk, buildSortCriteria, buildMatchCriteria } from "../utils/priceTracking.js";
import contextManager from "../utils/contextManager.js";
import { productQueries } from "../utils/productQueries.js";
import axios from "axios";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Set location for pincode
const setPincodeLocation = async (pincode) => {
  try {
    // Get or create context
    const context = await contextManager.getContext(pincode);

    // If Amazon Fresh is already set up for this pincode, return the context
    if (contextManager.isWebsiteSet(pincode, "amazonFresh")) {
      return context;
    }

    // Set up Amazon Fresh for this context
    const page = await context.newPage();

    // Navigate and set pincode
    await page.goto("https://www.amazon.in/alm/storefront?almBrandId=ctnow", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForSelector('input[id="GLUXZipUpdateInput"]', { timeout: 5000 });
    await page.fill('input[id="GLUXZipUpdateInput"]', pincode);

    const applyButton = await page.waitForSelector("#GLUXZipUpdate", { timeout: 5000 });
    await applyButton.click();
    await page.waitForTimeout(2000);

    // Check if location is serviceable
    const notServiceableElement = await page.$(".a-alert-content");
    if (notServiceableElement) {
      const message = await notServiceableElement.textContent();
      if (message.includes("not serviceable")) {
        throw AppError.badRequest(`Location ${pincode} is not serviceable by Amazon Fresh`);
      }
    }

    // Mark Amazon Fresh as set up for this pincode
    contextManager.markWebsiteAsSet(pincode, "amazonFresh");

    await page.close();
    return context;
  } catch (error) {
    console.error(`AF: Error setting pincode ${pincode}:`, error);
    throw error;
  }
};

export const getProducts = async (req, res, next) => {
  try {
    const { page = "1", pageSize = PAGE_SIZE.toString(), sortOrder = "price", priceDropped = "false", notUpdated = "false" } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const sortCriteria = buildSortCriteria(sortOrder);
    const matchCriteria = buildMatchCriteria(priceDropped, notUpdated);

    const totalProducts = await AmazonFreshProduct.countDocuments(matchCriteria);
    const products = await AmazonFreshProduct.aggregate([
      { $match: matchCriteria },
      { $sort: sortCriteria },
      { $skip: skip },
      { $limit: parseInt(pageSize) },
      {
        $project: {
          productId: 1,
          productName: 1,
          price: 1,
          mrp: 1,
          discount: 1,
          weight: 1,
          brand: 1,
          imageUrl: 1,
          url: 1,
          priceDroppedAt: 1,
          categoryName: 1,
          subcategoryName: 1,
          inStock: 1,
        },
      },
    ]);

    res.status(200).json({
      data: products,
      totalPages: Math.ceil(totalProducts / parseInt(pageSize)),
      currentPage: parseInt(page),
      pageSize: parseInt(pageSize),
      total: totalProducts,
    });
  } catch (error) {
    next(error);
  }
};

// Function to extract products from current page
const extractProductsFromPage = async (page) => {
  return await page.evaluate(() => {
    const results = document.querySelectorAll('div[role="listitem"]');
    console.log("AF: Found results:", results.length);

    return Array.from(results)
      .map((el) => {
        try {
          // Get product title and URL
          const titleEl = el.querySelector("h2 span");
          const titleLink = el.querySelector("a.a-link-normal.s-no-outline");

          // Get price elements - updated selectors for Amazon Fresh
          const priceEl = el.querySelector('.a-price[data-a-size="xl"] .a-offscreen');
          const mrpEl = el.querySelector('.a-price[data-a-strike="true"] .a-offscreen');
          const imageEl = el.querySelector(".s-image");

          // Extract numeric values with better error handling
          const priceText = priceEl?.textContent.trim() || "";
          const mrpText = mrpEl?.textContent.trim() || "";

          // Improved price parsing
          const parsePrice = (priceStr) => {
            // Remove currency symbol and commas, then parse
            const numStr = priceStr.replace(/[₹,]/g, "");
            return parseFloat(numStr);
          };

          const price = parsePrice(priceText);
          const mrp = parsePrice(mrpText) || price;

          const data = {
            productId: el.getAttribute("data-asin"),
            productName: titleEl?.textContent.trim() || "",
            url: titleLink?.getAttribute("href") ? `https://www.amazon.in${titleLink?.getAttribute("href")}` : "",
            imageUrl: imageEl?.getAttribute("src") || "",
            price,
            mrp,
            discount: mrp > price ? Math.floor(((mrp - price) / mrp) * 100) : 0,
            inStock: !el.querySelector(".s-result-unavailable-section"),
          };

          // Validate the data
          if (isNaN(data.price) || data.price <= 0) {
            console.log("AF: Invalid price for product:", data.productName);
            return null;
          }

          return data;
        } catch (err) {
          console.error("AF: Error extracting product:", err);
          return null;
        }
      })
      .filter((product) => product && product.productId && product.productName && product.price > 0);
  });
};

// Function to get next page URL
const getNextPageUrl = async (page) => {
  const allPaginationButtons = await page.$$eval(".s-list-item-margin-right-adjustment", (elements) => {
    return elements.map((el) => ({
      text: el.textContent.trim(),
      href: el.querySelector("a")?.getAttribute("href"),
    }));
  });

  const lastButton = allPaginationButtons?.[allPaginationButtons.length - 1];
  return lastButton?.text === "Next" && lastButton.href ? `https://www.amazon.in${lastButton.href}` : null;
};

// Search endpoint handler
export const searchQuery = async (req, res, next) => {
  let page = null;

  try {
    const { query, pincode } = req.body;

    if (!query || !pincode) {
      throw AppError.badRequest("Query and pincode are required");
    }

    // Get or create context for this pincode
    const context = await setPincodeLocation(pincode);
    page = await context.newPage();

    const allProducts = await searchAndExtractProducts(page, query, 3);

    // Sort by price
    allProducts.sort((a, b) => a.price - b.price);

    // console.log(`AF: Found total ${allProducts.length} products for query "${query}"`);

    res.status(200).json({
      success: true,
      products: allProducts,
      total: allProducts.length,
      totalPages: Math.ceil(allProducts.length / allProducts.length),
      processedPages: Math.ceil(allProducts.length / allProducts.length),
    });
  } catch (error) {
    console.error("AF: Amazon Fresh error:", error);
    next(error);
  } finally {
    if (page) await page.close();
  }
};

// Function to search and extract products for a query
const searchAndExtractProducts = async (page, query, maxPages = 10) => {
  try {
    console.log(`AF: Searching for "${query}"`);

    // Navigate to search  page
    const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}&i=nowstore`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    // Wait for products
    await page.waitForSelector('div[data-asin][data-component-type="s-search-result"]', { timeout: 5000 });

    let allProducts = [];
    let hasNextPage = true;
    let currentPage = 1;
    const MAX_PAGES = maxPages || 10; // Default to 10 if not set

    while (hasNextPage && currentPage <= MAX_PAGES) {
      // Extract products from current page
      const products = await extractProductsFromPage(page);

      allProducts = allProducts.concat(products);
      // console.log(`AF: Found ${products.length} products on page ${currentPage} for ${query}`);

      // Check for next page
      const nextPageUrl = await getNextPageUrl(page);
      if (nextPageUrl && currentPage < MAX_PAGES) {
        await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('div[data-asin][data-component-type="s-search-result"]', { timeout: 5000 });
        currentPage++;
      } else {
        hasNextPage = false;
      }
    }
    const uniqueProducts = Array.from(new Map(allProducts.map((item) => [item.productId, item])).values());
    console.log(`AF: Found ${uniqueProducts.length} unique products out of ${allProducts.length} for ${query}`);
    return uniqueProducts;
  } catch (error) {
    console.error(`AF: Error searching for "${query}":`, error);
    return [];
  }
};

// Function to process and store products
const processProducts = async (products, categoryName) => {
  try {
    const bulkOps = [];
    const droppedProducts = [];
    const now = new Date();

    // Get existing products for price comparison
    const productIds = products.filter((p) => p.inStock).map((p) => p.productId);

    const existingProducts = await AmazonFreshProduct.find({
      productId: { $in: productIds },
    }).lean();

    const existingProductsMap = new Map(existingProducts.map((p) => [p.productId, p]));

    // Process each product
    for (const product of products) {
      const existingProduct = existingProductsMap.get(product.productId);
      const productData = {
        ...product,
        productId: product.productId,
        productName: product.productName,
        categoryName: categoryName,
        inStock: product.inStock,
        mrp: product.mrp,
        price: product.price,
        discount: product.discount,
        imageUrl: product.imageUrl,
        url: product.url,
        priceDroppedAt: now,
      };

      if (existingProduct) {
        if (existingProduct.price === product.price && product.inStock === existingProduct.inStock) {
          continue; // Skip if price hasn't changed
        }

        // Update price history if price has changed
        productData.previousPrice = existingProduct.price;
        const currentDiscount = productData.discount;
        const previousDiscount = existingProduct.discount || 0;

        if (currentDiscount > previousDiscount) {
          productData.priceDroppedAt = now;
          if (currentDiscount - previousDiscount >= 10) {
            droppedProducts.push({
              ...productData,
              previousPrice: existingProduct.price,
            });
          }
        } else {
          if (existingProduct.priceDroppedAt) {
            productData.priceDroppedAt = existingProduct.priceDroppedAt;
          }
        }
      }

      bulkOps.push({
        updateOne: {
          filter: { productId: product.productId },
          update: { $set: productData },
          upsert: true,
        },
      });
    }

    // Send notifications for price drops
    if (droppedProducts.length > 0) {
      console.log(`AF: Found ${droppedProducts.length} dropped products from ${categoryName}`);
      try {
        await sendTelegramMessage(droppedProducts);
      } catch (error) {
        console.error("AF: Error sending Telegram notification:", error);
      }
    }

    // Perform bulk write operation
    if (bulkOps.length > 0) {
      await AmazonFreshProduct.bulkWrite(bulkOps, { ordered: false });
      console.log(`AF: Updated ${bulkOps.length} products from ${categoryName}`);
    }

    return bulkOps.length;
  } catch (error) {
    console.error("AF: Error processing products:", error);
    throw error;
  }
};

// Helper function to send Telegram notifications
const sendTelegramMessage = async (droppedProducts) => {
  try {
    const filteredProducts = droppedProducts.filter((product) => product.discount >= 50).sort((a, b) => b.discount - a.discount);

    if (filteredProducts.length === 0) return;
    console.log(`AF: Sending Telegram messages for ${filteredProducts.length} products`);

    const chunks = chunk(filteredProducts, 15);
    for (let i = 0; i < chunks.length; i++) {
      const messageText =
        `🔥 <b>Amazon Fresh Price Drops</b>\n\n` +
        chunks[i]
          .map((product) => {
            const priceDrop = product.previousPrice - product.price;
            return (
              `<b>${product.productName}</b>\n` +
              `💰 Current: ₹${product.price}\n` +
              `📊 Previous: ₹${product.previousPrice}\n` +
              `📉 Drop: ₹${priceDrop.toFixed(2)} (${product.discount}% off)\n` +
              `🔗 <a href="${product.url}">View on Amazon Fresh</a>\n`
            );
          })
          .join("\n");

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHANNEL_ID,
        text: messageText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });

      // Add delay between messages
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error("AF: Error sending Telegram message:", error);
    throw error;
  }
};

let isTrackingActive = false;

export const startTracking = async (req, res, next) => {
  try {
    const message = await startTrackingHandler();
    res.status(200).json({ message });
  } catch (error) {
    next(error);
  }
};

export const startTrackingHandler = async () => {
  // Prevent multiple tracking instances
  if (isTrackingActive) {
    console.log("AF: Tracking is already active");
    return;
  }

  isTrackingActive = true;
  while (true) {
    // Skip if it's night time (12 AM to 6 AM IST)
    if (isNightTimeIST()) {
      console.log("AF: Skipping price tracking during night hours");
      // Wait for 5 minutes before checking night time status again
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      continue;
    }

    try {
      const startTime = new Date();
      console.log("AF: Starting product search at:", startTime.toLocaleString());

      // Get all queries from productQueries
      const queries = [];
      Object.values(productQueries).forEach((category) => {
        Object.values(category).forEach((subcategory) => {
          subcategory.forEach((query) => {
            queries.push(query);
          });
        });
      });

      console.log(`AF: Found ${queries.length} unique search queries`);

      const CONCURRENT_SEARCHES = 3;
      const pincode = "500064"; // Default pincode
      let totalProcessedProducts = 0;

      // Process queries in parallel batches
      const taskChunks = chunk(queries, CONCURRENT_SEARCHES);

      for (const taskChunk of taskChunks) {
        const context = await setPincodeLocation(pincode);
        const pages = await Promise.all(taskChunk.map(() => context.newPage()));

        try {
          // Run searches in parallel
          const results = await Promise.all(
            taskChunk.map(async (query, index) => {
              console.log(`AF: Processing ${query}`);
              try {
                const products = await searchAndExtractProducts(pages[index], query);
                const processedCount = await processProducts(products, query);
                return processedCount;
              } catch (error) {
                console.error(`AF: Error processing ${query}:`, error);
                return 0;
              }
            })
          );

          totalProcessedProducts += results.reduce((a, b) => a + b, 0);
        } finally {
          // Close pages after each chunk
          await Promise.all(pages.map((page) => page.close()));
        }

        // Add delay between chunks
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const totalDuration = (Date.now() - startTime) / 1000 / 60; // in minutes
      console.log(`AF: Completed crawling. Processed ${totalProcessedProducts} products in ${totalDuration.toFixed(2)} minutes`);

      // Wait for 5 minutes before next iteration
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
    } catch (error) {
      console.error("AF: Error in tracking handler:", error);
      // Wait for 5 minutes before retrying
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
    }
  }
};
