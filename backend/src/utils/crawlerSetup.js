import { firefox } from "playwright";

let browser = null;
let locationContexts = new Map(); // Store contexts by pincode
const MAX_CONTEXTS = 5; // Maximum number of stored contexts

export const createBrowser = async () => {
  if (!browser) {
    console.log("Environment: ", process.env.ENVIRONMENT);
    browser = await firefox.launch({
      headless: process.env.ENVIRONMENT === "development" ? false : true,
      args: [
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });
  }
  return browser;
};

export const createPage = async (pincode, isNewLocation = true) => {
  try {
    // Check if we have a stored context for this pincode
    if (!isNewLocation) {
      const context = locationContexts.get(pincode);
      return await context.newPage();
    }

    // If we've reached max contexts, remove the oldest one
    if (locationContexts.size >= MAX_CONTEXTS) {
      try {
        const oldestPincode = locationContexts.keys().next().value;
        const oldestContext = locationContexts.get(oldestPincode);
        await oldestContext.close();
        locationContexts.delete(oldestPincode);
        console.log(`Cleaned up context for pincode: ${oldestPincode}`);
      } catch (error) {
        console.error(`Error cleaning up old context: ${error.message}`);
      }
    }

    // Create new context
    const browser = await createBrowser();
    const context = await browser.newContext({
      viewport: {
        width: 1920,
        height: 1080,
      },
    });

    return await context.newPage();
  } catch (error) {
    console.error(
      `Error creating page for pincode ${pincode}: ${error.message}`
    );
    throw error; // Re-throw the error to handle it in the calling function
  }
};

// Add function to store context after location is set
export const storeContext = async (pincode, context) => {
  locationContexts.set(pincode, context);
  console.log(
    `Stored context for pincode: ${pincode}. Total contexts: ${locationContexts.size}`
  );
};

export const cleanup = async () => {
  // Clear all stored contexts
  for (const [pincode, context] of locationContexts.entries()) {
    try {
      await context.close();
      console.log(`Closed context for pincode: ${pincode}`);
    } catch (error) {
      console.error(`Error closing context for pincode: ${pincode}:`, error);
    }
  }
  locationContexts.clear();

  if (browser) {
    try {
      await browser.close();
      browser = null;
      console.log("Browser closed successfully");
    } catch (error) {
      console.error("Error cleaning up browser:", error);
    }
  }
};

// Add function to check if location is already set
export const hasStoredLocation = (pincode) => {
  return locationContexts.has(pincode);
};

// Add function to get context stats
export const getContextStats = () => {
  return {
    totalContexts: locationContexts.size,
    storedPincodes: Array.from(locationContexts.keys()),
    maxContexts: MAX_CONTEXTS,
  };
};
