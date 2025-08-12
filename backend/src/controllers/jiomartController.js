import { AppError } from "../utils/errorHandling.js";
import { isNightTimeIST } from "../utils/priceTracking.js";
import contextManager from "../utils/contextManager.js";
// Removed axios and cheerio; using Playwright context exclusively

const setLocation = async (location) => {
  let page = null;
  try {
    // Get or create context
    const context = await contextManager.getContext(location);

    // Return existing context if already set up and serviceable
    if (contextManager.isWebsiteServiceable(location, "jiomart-grocery")) {
      console.log(`JIO: Using existing serviceable context for ${location}`);
      return context;
    }

    // Set up JioMart for this context
    page = await context.newPage();

    // Navigate to JioMart
    console.log("JIO: Navigating to JioMart...");
    await page.goto("https://www.jiomart.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20000, // 20 second timeout
    });

    await page.waitForTimeout(5000); // Increased timeout

    // Step 1: check if enable location modal is present and visible
    const enableLocationModal = await page.$("#location_popup");
    const modalVisible = await enableLocationModal.evaluate(
      (el) => el.style.display !== "none"
    );
    if (modalVisible) {
      // Click on the close modal button
      await page.click("#btn_location_close_icon");
    }

    // Step 2: check if location input popup with form is present and visible
    const pincodePopup = await page.$("#delivery_popup");
    const pincodePopupVisible = await pincodePopup.evaluate(
      (el) => el.style.display !== "none"
    );
    if (pincodePopupVisible) {
      // Fill the input , by focusing on the input field
      await page.focus("#rel_pincode");
      await page.keyboard.type(location);
      await page.waitForTimeout(5000); // Wait for 5 seconds
      // Check if the delivery is availale at the location by checking the info message in the modal
      const deliveryInfo = await page.$("#delivery_pin_msg");
      const deliveryInfoText = await deliveryInfo.evaluate(
        (el) => el.textContent
      );
      if (deliveryInfoText.includes("not delivering")) {
        throw AppError.badRequest(
          `Location ${location} is not serviceable by JioMart`
        );
      }
      await page.keyboard.press("Enter");
      await page.waitForTimeout(5000); // Wait for 5 seconds for page to reload and setup
    }

    // Location is serviceable - mark it as such
    contextManager.markServiceability(location, "jiomart-grocery", true);
    console.log(`JIO: Successfully set up for location: ${location}`);
    await page.close();
    return context;
  } catch (error) {
    // Mark location as not serviceable for any initialization errors too
    try {
      if (page) await page.close();
    } catch (cleanupError) {
      // Don't let cleanup errors override the original error
      console.error(`JIO: Error during cleanup for ${location}:`, cleanupError);
    }

    console.error(`JIO: Error initializing context for ${location}:`, error);
    throw error;
  }
};

const fetchJiomartCategories = async (context) => {
  console.log("JIO: Fetching categories...");
  let page = null;
  try {
    // Open page and scrape using Playwright DOM APIs
    page = await context.newPage();
    await page.goto("https://www.jiomart.com/all-category", {
      waitUntil: "networkidle",
      timeout: 20000,
    });
    // Extract links directly in the page context (no Cheerio needed)
    const allCategories = await page.$$eval(
      "a[data-category][data-subcategory]",
      (els) =>
        els.map((el) => ({
          category: el.getAttribute("data-category") || "",
          subcategory: el.getAttribute("data-subcategory") || "",
          subSubCategory: (el.textContent || "").trim(),
          // el.href returns an absolute URL in the browser context
          url: el.href || null,
        }))
    );
    // Build nested structure and dedupe entries per subcategory
    // Result shape: { [category]: { [subcategory]: [{ name, url }] } }
    const categorized = {};
    for (const item of allCategories) {
      const cat = item.category || "Unknown";
      const sub = item.subcategory || "Misc";
      const name = item.subSubCategory || "";
      const href = item.url || null;

      if (!categorized[cat]) categorized[cat] = {};
      if (!categorized[cat][sub]) categorized[cat][sub] = [];

      // Deduplicate by name+url within a subcategory
      const list = categorized[cat][sub];
      const exists = list.some((e) => e.name === name && e.url === href);
      if (!exists) list.push({ name, url: href });
    }
    console.log(
      "JIO: Categories fetched successfully",
      Object.keys(categorized)
    );
    return categorized;
  } catch (error) {
    console.error("JIO: Error fetching categories:", error);
    throw error;
  } finally {
    if (page) await page.close();
  }
};

const filterCategories = (categories) => {
  const categoriesToRemove = [
    "lifestyle",
    "electronics",
    "fashion",
    "industrial",
    "jewellery",
    "luggage",
    "furniture",
  ];

  let filteredCategories = {};
  Object.keys(categories).forEach((category) => {
    const shouldRemove = categoriesToRemove.some((categoryToRemove) =>
      category.toLowerCase().includes(categoryToRemove.toLowerCase())
    );

    if (!shouldRemove) {
      console.log(`Adding: ${category}`);
      filteredCategories[category] = categories[category];
    } else {
      console.log(`Skipping: ${category}`);
    }
  });
  const subCategoriesToRemove = [
    "baby care",
    "Home",
    "wipes",
    "Kitchenware",
    "Bakeware",
    "Tableware",
    "Disposables",
    "crafts",
    "Exam Central",
    "Mom & Baby",
    "Covid Essentials",
    "Make-Up",
    "Treatments",
    "Tools & Appliances",
  ];
  // Lets create a single array of categories
  let allCategories = [];
  Object.keys(filteredCategories).forEach((category) => {
    Object.entries(filteredCategories[category]).forEach(
      ([subCategoryKey, subCategoryValue]) => {
        console.log("subcategory : ", subCategoryKey);
        console.log(
          "all categories : ",
          filteredCategories[category][subCategoryKey].map((item) => item.name)
        );
        const shouldRemove = subCategoriesToRemove.some((subCategoryToRemove) =>
          subCategoryKey
            .toLowerCase()
            .includes(subCategoryToRemove.toLowerCase())
        );
        if (!shouldRemove) {
          console.log(`Adding: ${subCategoryKey}`);
          subCategoryValue.forEach((subCategory) => {
            allCategories.push({
              category,
              subCategory: subCategoryKey,
              name: subCategory.name,
              url: subCategory.url,
            });
          });
        }
      }
    );
  });

  return allCategories;
};

const extractProductsFromPage = async (page, url) => {
  try {
    // Navigate to current page
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

      // Wait for products to load
      // can a[class*="plp_product_list"]
      await page.waitForSelector("a.plp_product_list", {
        timeout: 10000,
        state: "attached",
      });

    // Extract products

    return { products };
  } catch (error) {
    console.error("JIO: Error extracting products from page:", error);
    return { products: [] };
  }
};

let isJioMartCrawlerRunning = false;
export const startTrackingHandler = async (location) => {
  if (isJioMartCrawlerRunning) {
    throw AppError.badRequest("JioMart crawler is already running");
  }
  isJioMartCrawlerRunning = true;
  while (true) {
    try {
      // Skip if it's night time (12 AM to 6 AM IST)
      if (isNightTimeIST()) {
        console.log("JIO: Skipping price tracking during night hours");
        // Wait for 5 minutes before checking night time status again
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }

      const startTime = new Date();
      console.log(
        "JIO: Starting product search at:",
        startTime.toLocaleString()
      );

      // Setup the context for the location
      const context = await setLocation(location);

      const categories = await fetchJiomartCategories(context);

      const filteredCategories = await filterCategories(categories);
      // Check if the location is serviceable
      if (!contextManager.isWebsiteServiceable(location, "jiomart-grocery")) {
        console.log(
          `JIO: Location ${location} is not serviceable, stopping crawler`
        );
        break;
      }

      // Process queries in parallel batches
      const PARALLEL_SEARCHES = 1;
      let totalProcessedProducts = 0;

      for (let i = 0; i < filteredCategories.length; i += PARALLEL_SEARCHES) {
        const currentBatch = filteredCategories.slice(i, i + PARALLEL_SEARCHES);
        console.log(
          `JIO: Processing categories ${i + 1} to ${
            i + currentBatch.length
          } of ${filteredCategories.length}`
        );

        const batchPromises = currentBatch.map(async (category) => {
          try {
            let page = null;

            try {
              page = await context.newPage();

              // Extract products using the new function
              const { products } = await extractProductsFromPage(
                page,
                category.url,
                category.name
              );

              totalProcessedProducts += products.length;
              console.log(
                `JIO: Processed ${products.length} products for ${category.name}`
              );
            } catch (error) {
              console.error(
                `JIO: Error processing category ${category.name}:`,
                error
              );
            } finally {
              if (page) await page.close();
            }
          } catch (error) {
            console.error(
              `JIO: Error processing category ${category.name}:`,
              error
            );
          }
        });

        await Promise.all(batchPromises);
        console.log(
          `JIO: Categories Processed: ${i + currentBatch.length} of ${
            filteredCategories.length
          } and Time taken: ${new Date().getTime() - startTime.getTime()} ms`
        );
      }

      console.log(`JIO: Total processed products: ${totalProcessedProducts}`);
      console.log(
        `JIO: Total time taken: ${
          new Date().getTime() - startTime.getTime()
        } ms`
      );
    } catch (error) {
      // Wait for 5 minutes
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      console.error("JIO: Error in crawler:", error);
    }
  }
};

export const startTracking = async (req, res, next) => {
  try {
    const location = req.query.location;
    if (!location) {
      throw AppError.badRequest("Location is required");
    }
    // Start the search process in the background
    startTrackingHandler(location).catch((error) => {
      console.error("JIO: Error in search handler:", error);
    });

    res.status(200).json({
      success: true,
      message: "Product search started",
    });
  } catch (error) {
    next(error);
  }
};
