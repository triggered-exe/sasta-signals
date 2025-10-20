import { firefox } from "playwright";

// Real Firefox user agents that are commonly used
const REAL_FIREFOX_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0'
];

// Function to get a random Firefox user agent
const getRandomUserAgent = () => {
  return REAL_FIREFOX_USER_AGENTS[Math.floor(Math.random() * REAL_FIREFOX_USER_AGENTS.length)];
};

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
        firefoxUserPrefs: {
          // Stealth preferences to avoid detection
          "general.useragent.override": getRandomUserAgent(),

          // Memory optimization preferences for low-RAM VMs
          "browser.cache.disk.enable": true,
          "browser.cache.memory.enable": true,
          "browser.cache.memory.capacity": 65536, // 64MB cache

          // Disable memory-intensive features
          "browser.sessionhistory.max_total_viewers": 2,
          "browser.tabs.animate": false,
          "browser.fullscreen.animate": false,

          // Disable unnecessary features
          "browser.safebrowsing.enabled": false,
          "browser.safebrowsing.malware.enabled": false,
          "browser.safebrowsing.phishing.enabled": false,
          "extensions.update.enabled": false,
          "app.update.enabled": false,

          // Performance optimizations
          "dom.ipc.processCount": 2,
          "browser.tabs.remote.autostart": true,

          // Disable telemetry and data collection
          "toolkit.telemetry.enabled": false,
          "datareporting.healthreport.uploadEnabled": false,
          "datareporting.policy.dataSubmissionEnabled": false,

          // Privacy settings to look more like a real browser
          "privacy.trackingprotection.enabled": false,
          "privacy.trackingprotection.pbmode.enabled": false,
          "privacy.donottrackheader.enabled": false,

          // Disable WebDriver flag
          "marionette.enabled": false,
          "marionette.port": 0,

          // Disable automation indicators
          "dom.webdriver.enabled": false,
          "useAutomationExtension": false,

          // Set realistic preferences
          "media.peerconnection.enabled": true,
          "media.navigator.enabled": true,
          "geo.enabled": false,
          "geo.provider.use_corelocation": true,
          "geo.prompt.testing": false,
          "geo.prompt.testing.allow": false,

          // Network settings
          "network.http.connection-timeout": 90,
          "network.http.response.timeout": 300,

          // Disable Firefox-specific automation detection
          "devtools.console.stdout.chrome": false,
          "devtools.debugger.remote-enabled": false,

          // Make it look like a real browser
          "browser.startup.homepage": "about:blank",
          "browser.newtabpage.enabled": false,
          "browser.newtab.preload": false,

          // Disable features that might cause detection
          "browser.contentblocking.category": "standard",
          "privacy.resistFingerprinting": false, // Don't use this as it can be detected

          // Set language preferences
          "intl.accept_languages": "en-US, en",
          "intl.locale.requested": "en-US",
        },
        args: [
          // Firefox-specific stealth arguments
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
        console.log("Reached maximum concurrent contexts, cleaning up oldest one");
        const oldestPincode = Array.from(this.contextMap.keys())[0];
        await this.cleanupPincode(oldestPincode);
      }

      // Create new context with stealth configuration
      const browser = await this.initBrowser();
      const userAgent = getRandomUserAgent();

      const context = await browser.newContext({
        // Use a real Firefox user agent
        userAgent: userAgent,
        // Emulate a real desktop screen size
        viewport: { width: 1920, height: 1080 },
        // Set realistic screen properties
        screen: { width: 1920, height: 1080 },
        // Set device scale factor
        deviceScaleFactor: 1,
        // Set timezone to match India
        timezoneId: 'Asia/Kolkata',
        // Set locale to English India
        locale: 'en-IN',
        // Set geolocation to a random location in India
        // geolocation: {
        //   latitude: 17.3850 + (Math.random() - 0.5) * 0.1, // Hyderabad area with some randomness
        //   longitude: 78.4867 + (Math.random() - 0.5) * 0.1
        // },
        // Set permissions
        // permissions: ['geolocation'],
        // Set extra HTTP headers to look more like a real Firefox browser
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0'
        },
        // Enable JavaScript
        javaScriptEnabled: true,
        // Set realistic color scheme
        colorScheme: 'light',
        // Set reduced motion preference
        reducedMotion: 'no-preference',
        // Set Firefox-specific options
        hasTouch: false,
        isMobile: false
      });

      // Add stealth scripts to the context to hide automation
      await context.addInitScript(() => {
        // Remove webdriver property (Firefox-specific)
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        // Mock realistic plugins for Firefox
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            return [
              {
                name: 'PDF Viewer',
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                length: 2
              },
              {
                name: 'Chrome PDF Viewer',
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                length: 1
              },
              {
                name: 'Chromium PDF Viewer',
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                length: 1
              },
              {
                name: 'Microsoft Edge PDF Viewer',
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                length: 1
              },
              {
                name: 'WebKit built-in PDF',
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                length: 1
              }
            ];
          },
        });

        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });

        // Override the permissions query
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );

        // Add realistic properties
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8,
        });

        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8,
        });

        // Remove automation indicators
        delete window._phantom;
        delete window._selenium;
        delete window.callPhantom;
        delete window.callSelenium;
        delete window.__nightmare;
        delete window.__webdriver_script_fn;
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
