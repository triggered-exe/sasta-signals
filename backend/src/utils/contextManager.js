import { firefox } from "playwright";

class ContextManager {
  constructor() {
    this.browser = null;
    this.contextMap = new Map(); // Map to store contexts by pincode
    this.MAX_CONTEXTS = 3; // Reduced from 5 to 3 for memory efficiency - critical for t1.micro instances
  }

  async initBrowser() {
    console.log("Environment", process.env.ENVIRONMENT);
    if (!this.browser) {
      this.browser = await firefox.launch({
        headless: process.env.ENVIRONMENT === "development" ? false : true,
        args: [
          // Core arguments for security and compatibility
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",

          // Memory optimization arguments for low-RAM VMs
          "--disable-dev-shm-usage", // Prevents browser from running out of memory in containers
          "--no-sandbox", // Reduces memory overhead but slightly reduces security
          "--disable-setuid-sandbox", // Works with no-sandbox for compatibility

          // Disable memory-intensive features
          "--disable-gpu", // Saves significant memory on VMs
          "--disable-software-rasterizer", // Reduces rendering memory usage
          "--disable-extensions", // Extensions consume extra memory

          // More memory optimizations for resource-constrained environments
          "--disable-default-apps",
          "--disable-translate",
          "--disable-sync",
          "--disable-background-networking",

          // Performance optimizations
          "--metrics-recording-only",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",

          // Additional memory-saving flags
          "--disable-breakpad", // Crash reporting uses memory
          "--disable-component-extensions-with-background-pages",
          "--disable-features=TranslateUI,BlinkGenPropertyTrees",
          "--disable-ipc-flooding-protection",

          // Network and rendering optimizations
          "--enable-features=NetworkService,NetworkServiceInProcess",
          "--force-color-profile=srgb",
          "--hide-scrollbars",
          "--ignore-gpu-blacklist",
          "--mute-audio",

          // Startup optimizations
          "--no-default-browser-check",
          "--no-first-run",
          "--password-store=basic",
          "--use-gl=swiftshader", // Software rendering that uses less memory
          "--use-mock-keychain",
          "--window-size=1920,1080",
        ],
      });
    }
    return this.browser;
  }

  // Get or create context for a pincode with improved error handling
  async getContext(pincode) {
    try {
      // Return existing context if available
      if (this.contextMap.has(pincode)) {
        const contextData = this.contextMap.get(pincode);
        // Check if context is still valid before using it - prevents the "Target closed" error
        try {
          await contextData.context.pages();
          console.log(`Using cached context for pincode: ${pincode}`);
          return contextData.context;
        } catch (error) {
          // If context is invalid, clean it up and create a new one
          console.log(
            `Context for pincode ${pincode} is invalid, creating new one`
          );
          await this.cleanupPincode(pincode);
        }
      }

      // Memory management: limit concurrent contexts
      if (this.contextMap.size >= this.MAX_CONTEXTS) {
        const oldestPincode = Array.from(this.contextMap.keys())[0];
        await this.cleanupPincode(oldestPincode);
      }

      // Create new context with reduced memory footprint
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        viewport: { width: 1280, height: 1080 }, // Increased height for better page rendering
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        javaScriptEnabled: true,
        bypassCSP: true,
        ignoreHTTPSErrors: true,
      });

      // Store context with metadata including tracking when it was last used
      this.contextMap.set(pincode, {
        context,
        websites: new Set(),
        createdAt: new Date(),
        lastUsed: new Date(), // Track last usage for better cleanup decisions
        serviceability: {}, // Track which websites are serviceable for this location
      });

      console.log(`Created new context for pincode: ${pincode}`);
      return context;
    } catch (error) {
      console.error(`Error getting context for pincode ${pincode}:`, error);
      throw error;
    }
  }

  // Update last used time for a context
  updateLastUsed(pincode) {
    if (this.contextMap.has(pincode)) {
      this.contextMap.get(pincode).lastUsed = new Date();
    }
  }

  // Mark a website as serviceable or not for a pincode
  async markServiceability(pincode, website, isServiceable) {
    if (this.contextMap.has(pincode)) {
      this.contextMap.get(pincode).serviceability[website] = isServiceable;
      this.updateLastUsed(pincode);
      await contextManager.cleanupNonServiceableContexts();
      console.log(`Marked ${website} as ${isServiceable ? 'serviceable' : 'not serviceable'} for pinc ode: ${pincode}`);
    }
  }

  // Check if a website is serviceable for a pincode
  isWebsiteServiceable(pincode, website) {
    return (
      this.contextMap.has(pincode) &&
      this.contextMap.get(pincode).serviceability[website] === true
    );
  }

  // Get all serviceable websites for a pincode
  getServiceableWebsites(pincode) {
    if (!this.contextMap.has(pincode)) return [];

    const serviceability = this.contextMap.get(pincode).serviceability;
    return Object.keys(serviceability).filter(website => serviceability[website] === true);
  }

  // Check if a website is set up for a pincode
  isWebsiteSet(pincode, website) {
    return (
      this.contextMap.has(pincode) &&
      this.contextMap.get(pincode).websites.has(website)
    );
  }

  // Cleanup specific pincode
  async cleanupPincode(pincode) {
    if (this.contextMap.has(pincode)) {
      const data = this.contextMap.get(pincode);
      try {
        await data.context.close();
        this.contextMap.delete(pincode);
        console.log(`Closed context for pincode: ${pincode}`);
      } catch (error) {
        console.error(`Error closing context for pincode ${pincode}:`, error);
      }
    }
  }

  // Cleanup all non-serviceable contexts
  async cleanupNonServiceableContexts() {
    try {
      const pincodesToCleanup = [];

      // Find all pincodes where no website is serviceable
      for (const [pincode, data] of this.contextMap.entries()) {
        const serviceability = data.serviceability;
        const hasAnyServiceable = Object.values(serviceability).some(isServiceable => isServiceable === true);

        if (!hasAnyServiceable) {
          pincodesToCleanup.push(pincode);
        }
      }

      // Cleanup each identified pincode
      for (const pincode of pincodesToCleanup) {
        console.log(`Cleaning up non-serviceable context for pincode: ${pincode}`);
        await this.cleanupPincode(pincode);
      }

      return pincodesToCleanup.length;
    } catch (error) {
      console.error("Error during non-serviceable contexts cleanup:", error);
      throw error;
    }
  }

  // Cleanup all contexts
  async cleanup() {
    try {
      for (const [pincode, data] of this.contextMap.entries()) {
        await this.cleanupPincode(pincode);
      }
      this.contextMap.clear();

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        console.log("Browser closed successfully");
      }
    } catch (error) {
      console.error("Error during cleanup:", error);
      throw error;
    }
  }
}

const contextManager = new ContextManager();
export default contextManager;
