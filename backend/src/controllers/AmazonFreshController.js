import { firefox } from "playwright";
import { AppError } from "../utils/errorHandling.js";
import { AmazonFreshProduct } from "../models/AmazonFreshProduct.js";
import { HALF_HOUR, ONE_HOUR, PAGE_SIZE } from "../utils/constants.js";
import { isNightTimeIST, chunk, buildSortCriteria, buildMatchCriteria } from "../utils/priceTracking.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

let isTrackingActive = false;
let isTrackingCrawlerRunning = false;

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

export const searchProductsUsingCrawler = async (req, res, next) => {
  let page = null;
  let browser = null;
  let context = null;

  try {
    const { query, pincode } = req.body;

    if (!query || !pincode) {
      throw AppError.badRequest("Query and pincode are required", 400);
    }

    browser = await firefox.launch({
      headless: process.env.ENVIRONMENT === "development" ? false : true,
      args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
    });

    context = await browser.newContext({
      viewport: {
        width: 1366,
        height: 768,
      },
    });
    page = await context.newPage();

    console.log("AF: Starting search for", query, "in", pincode);

    // Navigate to Amazon Fresh
    await page.goto("https://www.amazon.in/alm/storefront?almBrandId=ctnow", { waitUntil: "domcontentloaded" });
    console.log("AF: Loaded initial page");

    try {
      // Wait for and click on location selector
      await page.waitForSelector('input[id="GLUXZipUpdateInput"]', { timeout: 5000 });
      await page.fill('input[id="GLUXZipUpdateInput"]', pincode);

      // Wait for the Apply button and click it
      console.log("AF: Clicking apply button");
      const applyButton = await page.waitForSelector("#GLUXZipUpdate", { timeout: 5000 });
      await page.waitForTimeout(500);
      await applyButton.click();
      console.log("AF: Entered pincode");

      // Wait for location to be updated
      await page.waitForTimeout(3000);

      // Check if location is serviceable
      const notServiceableElement = await page.$(".a-alert-content");
      if (notServiceableElement) {
        throw AppError.badRequest(`Location ${pincode} is not serviceable by Amazon Fresh`, 400);
      }

      // Wait for search box and search
      await page.waitForSelector("#twotabsearchtextbox", { timeout: 5000 });
      await page.fill("#twotabsearchtextbox", query);
      const searchIcon = await page.$("#nav-search-submit-text");
      await searchIcon.click();
      console.log("AF: Performed search");

      // Wait for search results with longer timeout
      await page.waitForTimeout(3000);
      await page.waitForSelector('div[data-asin][data-component-type="s-search-result"]', { timeout: 5000 });

      // Check if we have any search results
      const hasResults = await page.$$eval(".s-result-item", (elements) => elements.length > 0);
      console.log("AF: Has results:", hasResults);

      //   total products
      const totalProducts = await page.$$eval("div[role='listitem']", (elements) => elements.length);
      console.log("AF: Total products:", totalProducts);

      // Function to extract products from current page
      const extractProductsFromPage = async () => {
        return await page.evaluate(() => {
          const results = document.querySelectorAll('div[role="listitem"]');
          console.log("Found results:", results.length);

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

                const price = parseInt(priceText.replace(/[^0-9]/g, "")) || 0;
                const mrp = parseInt(mrpText.replace(/[^0-9]/g, "")) || price;

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
                return data;
              } catch (err) {
                console.error("Error extracting product:", err);
                return null;
              }
            })
            .filter((product) => product && product.productId && product.productName && product.price > 0);
        });
      };

      // Function to get next page URL
      const getNextPageUrl = async () => {
        const allPaginationButtons = await page.$$eval(".s-list-item-margin-right-adjustment", (elements) => {
          return elements.map(el => ({
            text: el.textContent.trim(),
            href: el.querySelector('a')?.getAttribute("href")
          }));
        });

        const lastButton = allPaginationButtons?.[allPaginationButtons.length - 1];
        return lastButton?.text === "Next" && lastButton.href ? `https://www.amazon.in${lastButton.href}` : null;
      };

      let allProducts = [];
      let currentPage = 1;
      let hasNextPage = true;
      const MAX_PAGES = 3; // Limit to 3 pages to avoid too many requests

      while (hasNextPage && currentPage <= MAX_PAGES) {
        console.log(`AF: Processing page ${currentPage}`);

        // Extract products from current page
        const products = await extractProductsFromPage();
        console.log(`AF: Found ${products.length} products on page ${currentPage}`);
        
        // Add to collection
        allProducts = allProducts.concat(products);

        // Check for next page
        const nextPageUrl = await getNextPageUrl();
        if (nextPageUrl && currentPage < MAX_PAGES) {
          console.log(`AF: Navigating to page ${currentPage + 1}`);
          await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });
          await page.waitForSelector('div[role="listitem"]', { timeout: 5000 });
          await page.waitForTimeout(2000); // Wait for products to load
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }

      // Remove duplicates based on productId
      const uniqueProducts = Array.from(new Map(allProducts.map(item => [item.productId, item])).values());
      
      // Sort by price
      uniqueProducts.sort((a, b) => a.price - b.price);

      console.log(`AF: Found total ${allProducts.length} products (${uniqueProducts.length} unique) for query "${query}" across ${currentPage} pages`);

      res.status(200).json({
        success: true,
        products: uniqueProducts,
        total: uniqueProducts.length,
        totalPages: currentPage,
        processedPages: currentPage
      });

    } catch (error) {
      console.error("AF: Error during search process:", error);
      throw error;
    }
  } catch (error) {
    console.error("Amazon Fresh error:", error);
    next(error);
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
};
