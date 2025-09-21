import axios from "axios";
import { AppError } from "../utils/errorHandling.js";
import { InstamartProduct } from "../models/InstamartProduct.js";
import { Resend } from "resend";
import { isNightTimeIST, chunk } from "../utils/priceTracking.js";
import { processProducts as globalProcessProducts } from "../utils/productProcessor.js";
import contextManager from "../utils/contextManager.js";

const placesData = {};
const CATEGORY_CHUNK_SIZE = 2;
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

// Set location for pincode using web scraping (similar to other controllers)
const setLocation = async (location) => {
  let page = null;
  try {
    // Get or create context
    const context = await contextManager.getContext(location);

    // If Instamart is already set up for this pincode, return the context
    if (contextManager.isWebsiteServiceable(location, "instamart")) {
      console.log(`IM: Using existing serviceable context for ${location}`);
      return context;
    }

    // Set up Instamart for this context
    page = await context.newPage();

    // Navigate to Instamart
    await page.goto("https://www.swiggy.com", { waitUntil: "domcontentloaded" });

    // Wait for the page to be fully loaded
    await page.waitForTimeout(3000);

    // Look for location selector - this will need to be updated with correct selectors
    console.log("IM: Setting location...");

    // Try to find and click location selector
    try {

      // Fill the pincode using the correct selector from HTML structure
      const pincodeInput = await page.waitForSelector('input[id="location"]', {
        timeout: 4000,
      });
      if (pincodeInput) {
        console.log("IM: Pincode input field found");

        await pincodeInput.fill(location);

        // Wait for suggestions to appear
        await page.waitForTimeout(3000);

        // Check if suggestions are visible - looking for the dropdown structure you provided
        const firstSuggestion = await page.waitForSelector('div._2BgUI[role="button"]', {
          timeout: 5000,
        });

        if (firstSuggestion) {
          // Click the first suggestion (skip "Use my current location" and "Search Result" header)
          firstSuggestion.click();

          await page.waitForTimeout(5000);

          // Check whether a div with text (Shop groceries on Instamart) exists if not its not serviceable
          const shopGroceriesDiv = await page.$("//div[text()='Shop groceries on Instamart']");
          if (!shopGroceriesDiv) {
            throw AppError.badRequest(`IM: Delivery not available for pincode: ${location}`);
          }
        } else {
          // If no suggestion then the address is not serviceable
          throw AppError.badRequest(`IM: Delivery not available for pincode: ${location}`);
        }
      } else {
        throw new Error("IM: Pincode input field not found");
      }
    } catch (error) {
      console.error("IM: Error setting location:", error);
      contextManager.markServiceability(location, "instamart", false);
      throw AppError.badRequest(`IM: Could not set location for pincode: ${location}`);
    }

    // Mark as serviceable and register the website
    contextManager.markServiceability(location, "instamart", true);
    contextManager.contextMap.get(location).websites.add("instamart");
    console.log(`IM: Successfully set up for pincode: ${location}`);

    await page.close();
    return context;
  } catch (error) {
    if (page) await page.close();
    contextManager.markServiceability(location, "instamart", false);
    console.error(`IM: Error setting pincode ${location}:`, error);
    throw error;
  }
};

// Extract browser data (cookies, storeId, lat/lng) from the browser context
const extractBrowserData = async (location, refresh = false) => {
  try {
    // Check if we already have cached browser data for this location
    if (placesData[location] && placesData[location].cookies && placesData[location].storeId && !refresh) {
      console.log(`IM: Using cached browser data for location ${location}`);
      return {
        cookies: placesData[location].cookies,
        storeId: placesData[location].storeId,
        lat: placesData[location].lat || 0,
        lng: placesData[location].lng || 0
      };
    }

    // Get the context for this location (should already be set up by setLocation)
    const context = await contextManager.getContext(location);
    
    // Check if the location is serviceable
    if (!contextManager.isWebsiteServiceable(location, "instamart")) {
      throw AppError.badRequest(`IM: Location ${location} is not serviceable`);
    }

    let page = null;
    try {
      page = await context.newPage();
      
      // Navigate to Instamart to get the cookies and store data
      await page.goto("https://www.swiggy.com/instamart", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      //  Store id is not available in the above page, so we need to extract it from the page source. the above was loaded so that the cookies are set properly.

      await page.goto("view-source:https://www.swiggy.com/instamart", { waitUntil: "domcontentloaded" });

      // Extract cookies from the browser
      const cookies = await page.context().cookies();
      const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      console.log("IM: Extracted cookies from browser");

      // Extract store ID from the HTML response
      const html = await page.content();
      const storeIdMatch = html.match(/"storeId":"(\d+)"/);
      
      if (!storeIdMatch || !storeIdMatch[1]) {
        throw new Error("IM: Could not extract storeId from webpage");
      }

      const storeId = storeIdMatch[1];
      console.log("IM: Extracted store ID from webpage:", storeId);

      // Extract lat/lng from cookies or page data
      let lat, lng;
      const userLocationCookie = cookies.find(cookie => cookie.name === 'userLocation');
      if (userLocationCookie) {
        try {
          const locationData = JSON.parse(decodeURIComponent(userLocationCookie.value));
          lat = locationData.lat;
          lng = locationData.lng;
          console.log("IM: Extracted lat/lng from cookies:", lat, lng);
        } catch (e) {
          console.log("IM: Could not parse userLocation cookie, will extract from page");
        }
      }

      // If we couldn't get lat/lng from cookies, try to extract from page
      if (!lat || !lng) {
        const latLngMatch = html.match(/"lat":([^,]+),"lng":([^}]+)/);
        if (latLngMatch) {
          lat = parseFloat(latLngMatch[1]);
          lng = parseFloat(latLngMatch[2]);
          console.log("IM: Extracted lat/lng from page:", lat, lng);
        }
      }

      const browserData = {
        cookies: cookieString,
        storeId: storeId,
        lat: lat || 0,
        lng: lng || 0
      };

      // Update placesData cache with the extracted browser data
      if (!placesData[location]) {
        placesData[location] = {};
      }
      
      placesData[location] = {
        ...placesData[location],
        ...browserData
      };

      console.log(`IM: Successfully cached browser data for location ${location}`);
      return browserData;

    } finally {
      if (page) await page.close();
    }
  } catch (error) {
    console.error("IM: Error extracting browser data:", error);
    throw AppError.internalError("Failed to extract browser data");
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
    console.log("INSTAMART: starting tracking");
    // Start the continuous tracking loop without awaiting it
    trackProductPrices().catch((error) => {
        console.error("INSTAMART: Failed in tracking loop:", error);
    });
    return "Instamart price tracking started";
};

// Process categories linearly instead of in parallel
const fetchProductsForCategoriesChunk = async (categoryChunk, location) => {
    try {
        const { storeId, cookies } = await extractBrowserData(location, false);
        // Common headers to use across all API calls
        const headers = {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            "content-type": "application/json",
            "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            cookie: cookies, // Already using the full cookie from fetchProductCategories
            referer: "https://www.swiggy.com/instamart",
            priority: "u=1, i",
            matcher: "ea8778ebaf9d9bde8ab7ag7",
            "sec-ch-ua": '"Brave";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "sec-gpc": "1",
        };

        // Process each category sequentially
        for (const category of categoryChunk) {
            try {
                console.log("INSTAMART: processing category", category.name);
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
                                            categoryName: category.name,
                                        },
                                        headers: headers,
                                    }
                                );

                                const {
                                    totalItems = 0,
                                    widgets = [],
                                    hasMore = false,
                                    offset: offsetResponse = 0,
                                    pageNo: pageNoResponse = 0,
                                } = response.data?.data || {};

                                // Check if the response is empty and rate limit is hit
                                if (!response.data?.data) {
                                    // If the response status is 202 , then it means the cookies are expired and we have to refresh them
                                    if(response.status === 202){
                                        const { cookies : refreshedCookies } = await extractBrowserData(location, true);
                                        headers.cookie = refreshedCookies;
                                    }
                                    retryCount++;
                                    if (retryCount > MAX_RETRIES) {
                                        console.log(
                                            `IM: Max retries (${MAX_RETRIES}) reached for subcategory ${subCategory.name}`
                                        );
                                        break;
                                    }
                                    // Wait for progressively longer times between retries (1m, 2m, 3m)
                                    const waitTime = retryCount * 60 * 1000;

                                    console.log(
                                        `IM: Rate limit hit (attempt ${retryCount}/${MAX_RETRIES}), waiting for ${waitTime / 1000
                                        } seconds before retry...`
                                    );
                                    await new Promise((resolve) => setTimeout(resolve, waitTime));
                                    continue; // Retry the same request
                                }

                                // Extract products from PRODUCT_LIST widgets
                                const products = widgets
                                    .filter((widget) => widget.type === "PRODUCT_LIST")
                                    .flatMap((widget) => widget.data || [])
                                    .filter((product) => product);

                                // console.log(`IM: Found ${products.length} products in subcategory ${subCategory.name}`);

                                if (!products.length) {
                                    console.log("INSTAMART: no products found in subcategory", subCategory.name);
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
                            console.log(
                                "IM: Processing products for subcategory",
                                subCategory.name,
                                "length",
                                allProducts.length
                            );
                            const updatedCount = await processProducts(allProducts, category, subCategory, location);
                            console.log(`IM: Extracted products ${updatedCount} products in ${subCategory.name}`);
                        }
                    } catch (error) {
                        console.error(`IM: Error processing subcategory ${subCategory.name}:`, error.response);
                        await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
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
        console.error("INSTAMART: Error processing category chunk:", error);
    }
};

// Main function to track product prices across all categories
export const trackProductPrices = async (location = "500064") => {
    // Prevent multiple tracking instances
    if (isTrackingActive) {
        console.log("INSTAMART: Tracking is already active");
        return;
    }

    isTrackingActive = true;

    while (true) {
        try {
            // Skip if it's night time (12 AM to 6 AM IST)
            if (isNightTimeIST()) {
                console.log("INSTAMART: Skipping price tracking during night hours");
                // Wait for 5 minutes before checking night time status again
                await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
                continue;
            }

            console.log("INSTAMART: Starting new tracking cycle at:", new Date().toISOString());

            // Setup the context for the location
            const context = await setLocation(location);

            // Check if the location is serviceable
            if (!contextManager.isWebsiteServiceable(location, "instamart")) {
                console.log(`BB: Location ${location} is not serviceable, stopping crawler`);
                break;
            }

            const { categories, storeId, cookie } = await fetchProductCategories(location);

            if (!categories?.length) {
                console.error("INSTAMART: No categories found or invalid categories data");
                continue;
            }

            console.log("INSTAMART: Categories fetched:", categories.length);

            // Process categories in parallel (in groups of 3 to avoid rate limiting)
            const categoryChunks = chunk(categories, CATEGORY_CHUNK_SIZE);

            for (const categoryChunk of categoryChunks) {
                await fetchProductsForCategoriesChunk(categoryChunk, location);
            }

            console.log("INSTAMART: Tracking cycle completed at:", new Date().toISOString());

            // Add a delay before starting the next cycle
            await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        } catch (error) {
            console.error("INSTAMART: Error in tracking cycle:", error);
            // Wait before retrying after error
            await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        }
    }
};

// Fetches all product categories from Instamart API using browser cookies
const fetchProductCategories = async (location = "500064") => {
    try {
        // Check if we already have cached categories for this location
        if (placesData[location] && placesData[location].categories) {
            console.log(`IM: Using cached categories for location ${location}`);
            return placesData[location];
        }

        // Extract browser data (cookies, storeId, lat/lng)
        const { cookies, storeId } = await extractBrowserData(location, true);

        // Get the context for this location to make API calls
        const context = await contextManager.getContext(location);
        let page = null;

        try {
            page = await context.newPage();

            const categoriesResponse = await axios.get(`https://www.swiggy.com/api/instamart/layout`, {
                params: {
                    layoutId: "3742",
                    limit: "40",
                    pageNo: "0",
                    serviceLine: "INSTAMART",
                    customerPage: "STORES_MENU",
                    hasMasthead: "false",
                    storeId: storeId,
                    primaryStoreId: storeId,
                    secondaryStoreId: "",
                },
                headers: {
                    accept: "*/*",
                    "accept-language": "en-US,en;q=0.9",
                    "content-type": "application/json",
                    "user-agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                    cookie: cookies,
                },
            });

            if (!categoriesResponse.data?.data?.widgets) {
                throw new Error("Failed to fetch categories");
            }
            
            const widgets = categoriesResponse.data.data.widgets.filter(
                (widget) => widget.widgetInfo?.widgetType === "TAXONOMY"
            );

            // From widgets get the categories
            const allCategoriesWithSubCategories = widgets.flatMap((widget) =>
                widget.data.map((category) => ({
                    nodeId: category.nodeId,
                    name: category.displayName,
                    taxonomyType: widget.widgetInfo.taxonomyType,
                    subCategories: category.nodes.map((node) => ({
                        nodeId: node.nodeId,
                        name: node.displayName,
                        image: node.imageId,
                        productCount: node.productCount,
                    })),
                }))
            );

            // Filter out categories with certain names
            const unwantedCategories = ["pet supplies", "puja", "grooming", "cleaning essentials", "sexual wellness", "women", "feminine", "girls", "jewellery", "kitchen", "purse", "decor", "hair-color",
                "fish", "kids", "boys", "toys", "unlisted", "books", "pet-care", "elderly", "cleaning-essentials",
                "home-needs", "makeup", "home",
                "lips", "face", "eyes", "nail", "beauty", "gardening"]
            const filteredCategories = allCategoriesWithSubCategories.filter((category => {
                // Check if the category name contains any unwanted keywords
                if (unwantedCategories.some(unwanted => category.name.toLowerCase().includes(unwanted))) {
                    return false;
                }
                return true
            })).map((category) => {
                // Filter subcategories for unwanted keywords
                const filteredSubCategories = category.subCategories.filter(subCategory => {
                    return !unwantedCategories.some(unwanted => subCategory.name.toLowerCase().includes(unwanted));
                });
                // Return a new category object with filtered subcategories
                return {
                    ...category,
                    subCategories: filteredSubCategories
                };
            });

            // Update placesData with categories (merge with existing browser data)
            placesData[location] = {
                ...placesData[location], // Keep existing browser data
                categories: filteredCategories,
            };

            console.log(`IM: Successfully cached categories for location ${location}`);
            return placesData[location];

        } finally {
            if (page) await page.close();
        }
    } catch (error) {
        console.error("IM: Error fetching categories with browser cookies:", error);
        throw AppError.internalError("Failed to fetch categories");
    }
};

// Legacy: Fetches all product categories from Instamart API (original implementation)
const fetchProductCategoriesLegacy = async (location = "500064") => {
    try {

        // Step1: Get the place suggestions using the pincode/address
        const placeResponse = await axios.get(`https://www.swiggy.com/mapi/misc/place-autocomplete`, {
            params: { input: location },
            headers: {
                __fetch_req__: "true",
                accept: "*/*",
                "accept-language": "en-US,en;q=0.5",
                "user-agent":
                    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
            },
        });

        if (!placeResponse.data?.data?.length) {
            throw new Error("No locations found for the given address");
        }

        // Step2: Get complete address using place_id
        const placeId = placeResponse.data.data[0].place_id;
        const storeResponse = await axios.get(`https://www.swiggy.com/dapi/misc/address-recommend`, {
            params: { place_id: placeId },
            headers: {
                accept: "*/*",
                "user-agent":
                    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
            },
        });

        if (!storeResponse.data?.data) {
            throw new Error("Failed to get store details");
        }

        const { lat, lng } = storeResponse.data.data[0].geometry.location;
        console.log("INSTAMART: got lat and lng", lat, lng);

        // Step3: Get the store id using location
        // Create a complete userLocation object similar to one from working cookie
        const userLocation = {
            address: `Hyderabad, Telangana ${address}, India`, // Format address similar to working cookie
            lat,
            lng,
            id: "",
            annotation: "",
            name: "",
        };

        // Create cookie without URL encoding - direct JSON format
        // This matches the format seen in working curl commands
        const locationCookie = `userLocation=${JSON.stringify(userLocation)}`;
        console.log("INSTAMART: using cookie:", locationCookie);

        // Full cookie with additional required fields from working curl command
        const fullCookie = `deviceId=s%3A1ce58713-498a-4aec-bab1-493c2d86d249.LKtG1bUIkqwIQmPUzUlLyzBMoFZjQIow0rLiaXWXiVE; ${locationCookie}`;

        try {
            // First try with our dynamic but complete cookie
            // Fetch the webpage first to get the store ID
            const response = await axios.get("https://www.swiggy.com/instamart", {
                headers: {
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    "accept-language": "en-US,en;q=0.9",
                    "cache-control": "no-cache",
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                    cookie: fullCookie,
                },
            });

            // Extract store ID from the HTML response
            const html = response.data;
            const storeIdMatch = html.match(/"storeId":"(\d+)"/);
            
            if (storeIdMatch && storeIdMatch[1]) {
                const storeId = storeIdMatch[1];
                console.log("INSTAMART: got store id from webpage:", storeId);

                // Step4: Fetch categories using dynamic storeId from webpage
                const categoriesResponse = await axios.get(`https://www.swiggy.com/api/instamart/layout`, {
                    params: {
                        layoutId: "3742",
                        limit: "40",
                        pageNo: "0",
                        serviceLine: "INSTAMART",
                        customerPage: "STORES_MENU",
                        hasMasthead: "false",
                        storeId: storeId,
                        primaryStoreId: storeId,
                        secondaryStoreId: "",
                    },
                    headers: {
                        accept: "*/*",
                        "accept-language": "en-US,en;q=0.9",
                        "content-type": "application/json",
                        "user-agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                        cookie: fullCookie,
                    },
                });

                if (!categoriesResponse.data?.data?.widgets) {
                    throw new Error("Failed to fetch categories");
                }

                // Process categories from widgets
                const widgets = categoriesResponse.data.data.widgets.filter(
                    (widget) => widget.widgetInfo?.widgetType === "TAXONOMY"
                );

                // From widgets get the categories
                const allCategoriesWithSubCategories = widgets.flatMap((widget) =>
                    widget.data.map((category) => ({
                        nodeId: category.nodeId,
                        name: category.displayName,
                        taxonomyType: widget.widgetInfo.taxonomyType,
                        subCategories: category.nodes.map((node) => ({
                            nodeId: node.nodeId,
                            name: node.displayName,
                            image: node.imageId,
                            productCount: node.productCount,
                        })),
                    }))
                );

                // Filter out categories with cetain names
                const unwantedCategories = ["pet supplies", "puja", "grooming", "cleaning essentials", "sexual wellness", "women", "feminine", "girls", "jewellery", "kitchen", "purse", "decor", "hair-color",
                    "fish", "kids", "boys", "toys", "unlisted", "books", "pet-care", "elderly", "cleaning-essentials",
                    "home-needs", "makeup", "home",
                    "lips", "face", "eyes", "nail", "beauty", "gardening"]
                const filteredCategories = allCategoriesWithSubCategories.filter((category => {
                    // Check if the category name contains any unwanted keywords
                    if (unwantedCategories.some(unwanted => category.name.toLowerCase().includes(unwanted))) {
                        return false;
                    }
                    return true
                })).map((category) => {
                    // Filter subcategories for unwanted keywords
                    const filteredSubCategories = category.subCategories.filter(subCategory => {
                        return !unwantedCategories.some(unwanted => subCategory.name.toLowerCase().includes(unwanted));
                    });
                    // Return a new category object with filtered subcategories
                    return {
                        ...category,
                        subCategories: filteredSubCategories
                    };
                });

                placesData[location] = {
                    categories: filteredCategories,
                    storeId: storeId,
                    cookie: fullCookie,
                    lat,
                    lng,
                };

                return placesData[location];
            } else {
                console.log("INSTAMART: No storeId in response");
            }
        } catch (error) {
            console.log("INSTAMART: Error with dynamic cookie:", error.message);
        }
    } catch (error) {
        console.error("INSTAMART: Error fetching categories:", error?.response?.data || error);
        throw new AppError("Failed to fetch categories", 500);
    }
};

// Process multiple products and their variations in bulk
const processProducts = async (products, category, subcategory, location = "500064") => {
    try {
        // Flatten all variations into a single array and transform to standard format
        const transformedProducts = products.flatMap(
            (product) =>
                product.variations?.map((variation) => {
                    const currentPrice = variation.price?.offer_price || 0;
                    const mrp = variation.price?.mrp || 0;
                    const discount = mrp > 0 ? Math.floor((variation.price?.discount_value / mrp) * 100) : 0;

                    return {
                        productId: variation.id, // Using variation.id as the unique identifier
                        variationId: variation.id,
                        productName: product.display_name,
                        categoryName: category.name,
                        subcategoryName: subcategory.name,
                        inStock: variation.inventory?.in_stock,
                        imageUrl: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${variation.images?.[0] || "default_image"
                            }`,
                        price: currentPrice,
                        mrp: mrp,
                        discount: discount,
                        quantity: variation.quantity,
                        unit: variation.unit_of_measure,
                        weight: variation.sku_quantity_with_combo || variation.weight_in_grams || 0,
                        url: `https://www.swiggy.com/instamart/item/${product.product_id}?storeId=${placesData[location].storeId}`,
                        // Additional Instamart-specific fields
                        categoryId: category.nodeId,
                        subcategoryId: subcategory.nodeId,
                        mainProductId: product.product_id,
                    };
                }) || []
        );

        // Use the global processProducts function with Instamart-specific options
        const result = await globalProcessProducts(transformedProducts, category.name, {
            model: InstamartProduct,
            source: "Instamart",
            telegramNotification: true,
            emailNotification: false,
            significantDiscountThreshold: 10,
        });

        const processedCount = typeof result === "number" ? result : 0;
        console.log(`IM: Processed ${processedCount} products in ${subcategory.name}`);
        return processedCount;
    } catch (error) {
        console.error("INSTAMART: Error processing products:", error);
        return 0;
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
                    Cookie: "deviceId=s%253A32b79aff-414d-4fb0-a759-df85f541312e.H1m4Tr18pypEEkkBIa%252BCo87Ft4iraHpp4mKmAKYhaKE; tid=s%253A04235f7c-720b-4708-81ed-fb8e66252512.UUMQhremwF41QpB9G7ytmOA%252Bodh2kypFE1p%252BwMRQi4M; versionCode=1200; platform=web; subplatform=mweb; statusBarHeight=0; bottomOffset=0; genieTrackOn=false; ally-on=false; isNative=false; strId=; openIMHP=false; userLocation=%257B%2522lat%2522%253A17.3585585%252C%2522lng%2522%253A78.4553883%252C%2522address%2522%253A%2522%2522%252C%2522id%2522%253A%2522%2522%252C%2522annotation%2522%253A%2522%2522%252C%2522name%2522%253A%2522%2522%257D",
                },
            }
        );

        res.status(200).json(response.data);
    } catch (error) {
        next(error);
    }
};
