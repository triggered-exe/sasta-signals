import { firefox } from "playwright";

// Real Firefox user agents that are commonly used
const REAL_FIREFOX_USER_AGENTS = [
  //'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 OPR/118.0.0.0', // Not working for Blinkit
  // 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.3a/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 OPR/117.0.0.', //Chrome 134.0.0, Linux // Working for 

  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0', // Working for Blinkit
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3', //Chrome 107.0.0, Windows // Working for Blinkit
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', // Edge on Linux // Working for Blinkit
];

// Function to get a random Firefox user agent
const getRandomUserAgent = () => {
  return REAL_FIREFOX_USER_AGENTS[Math.floor(Math.random() * REAL_FIREFOX_USER_AGENTS.length)];
};

class ContextManager {
  constructor() {
    this.browser = null;
    this.contextMap = new Map(); // Map to store contexts by address
    this.MAX_CONTEXTS = 3; // Reduced from 5 to 3 for memory efficiency - critical for t1.micro instances
  }

  // Helper function to get current time in IST
  getCurrentIST() {
    const now = new Date();
    return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  }

  // Function to clean and normalize address to create a consistent key
  cleanAddressKey(address) {
    if (!address) return '';
    
    // Convert to string and normalize
    const cleaned = String(address)
      .toLowerCase()
      .trim()
      // Remove extra spaces and normalize whitespace
      .replace(/\s+/g, ' ')
      // Normalize comma spacing (remove spaces around commas, then add single space after)
      .replace(/\s*,\s*/g, ', ')
      // Remove special characters except alphanumeric, spaces, and common address separators
      .replace(/[^\w\s,-]/g, '')
      // Remove leading/trailing commas and spaces
      .replace(/^[,\s]+|[,\s]+$/g, '')
      // Normalize common address abbreviations
      .replace(/\bstreet\b/g, 'st')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\bapartment\b/g, 'apt')
      .replace(/\bbuilding\b/g, 'bldg')
      // Final cleanup of multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
    
    return cleaned;
  }


  async initBrowser() {
    console.log("Environment", process.env.ENVIRONMENT);
    if (!this.browser) {
      const isDevMode = process.env.ENVIRONMENT === "development";

      this.browser = await firefox.launch({
        headless: !isDevMode,
        // Additional args for development mode
        args: isDevMode ? [
          '--start-maximized',  // Start maximized to be more visible and prevent being hidden
        ] : [],
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

          // Disable service workers to avoid extra navigations/iframes caused by
          // third-party scripts (helps on Linux where service workers may cause
          // additional frame navigations like googletagmanager service worker iframe)
          // This is low-risk and prevents service-worker-driven reloads.
          "dom.serviceWorkers.enabled": false,
          "dom.serviceWorkers.testing.enabled": false,
          "dom.serviceWorkers.controller.enabled": false,

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

  // Get or create context for an address with improved error handling
  async getContext(address) {
    try {
      const addressKey = this.cleanAddressKey(address);
      
      // Return existing context if available
      if (this.contextMap.has(addressKey)) {
        const contextData = this.contextMap.get(addressKey);
        // Check if context is still valid before using it - prevents the "Target closed" error
        try {
          await contextData.context.pages();
          console.log(`Using cached context for address: ${address}`);
          return contextData.context;
        } catch (error) {
          // If context is invalid, clean it up and create a new one
          console.log(
            `Context for address ${address} is invalid, creating new one`
          );
          await this.cleanupAddress(addressKey);
        }
      }

      // Memory management: limit concurrent contexts
      if (this.contextMap.size >= this.MAX_CONTEXTS) {
        console.log("Reached maximum concurrent contexts, cleaning up oldest one");
        const oldestAddressKey = Array.from(this.contextMap.keys())[0];
        await this.cleanupAddress(oldestAddressKey);
      }

      // Create new context with stealth configuration
      const browser = await this.initBrowser();
      const userAgent = getRandomUserAgent();

      const context = await browser.newContext({
        // Use a real Firefox user agent
        userAgent: userAgent,
        // Emulate a larger desktop screen size
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
      this.contextMap.set(addressKey, {
        context,
        createdAt: this.getCurrentIST(),
        lastUsed: this.getCurrentIST(), // Track last usage for better cleanup decisions
        serviceability: {}, // Track which websites are serviceable for this location
        originalAddress: address, // Store original address for reference
      });

      console.log(`Created new context for address: ${address}`);
      return context;
    } catch (error) {
      console.error(`Error getting context for address ${address}:`, error);
      throw error;
    }
  }

  // Update last used time for a context
  updateLastUsed(address) {
    const addressKey = this.cleanAddressKey(address);
    if (this.contextMap.has(addressKey)) {
      this.contextMap.get(addressKey).lastUsed = this.getCurrentIST();
    }
  }

  // Mark a website as serviceable or not for an address
  async markServiceability(address, website, isServiceable) {
    const addressKey = this.cleanAddressKey(address);
    if (this.contextMap.has(addressKey)) {
      const contextData = this.contextMap.get(addressKey);
      contextData.serviceability[website] = isServiceable;
      
      this.updateLastUsed(address);
      await contextManager.cleanupNonServiceableContexts();
      console.log(`Marked ${website} as ${isServiceable ? 'serviceable' : 'not serviceable'} for address: ${address}`);
    } else {
      // If context doesn't exist, create a minimal entry for serviceability tracking
      this.contextMap.set(addressKey, {
        context: null,
        createdAt: this.getCurrentIST(),
        lastUsed: this.getCurrentIST(),
        serviceability: { [website]: isServiceable },
        originalAddress: address,
      });
      console.log(`Created serviceability entry and marked ${website} as ${isServiceable ? 'serviceable' : 'not serviceable'} for address: ${address}`);
    }
  }

  // Get the serviceability status of a website for an address
  getWebsiteServiceabilityStatus(address, website) {
    const addressKey = this.cleanAddressKey(address);
    if (!this.contextMap.has(addressKey)) {
      return false;
    }
    return this.contextMap.get(addressKey).serviceability[website] === true;
  }

  // Get all serviceable websites for an address
  getServiceableWebsites(address) {
    const addressKey = this.cleanAddressKey(address);
    if (!this.contextMap.has(addressKey)) return [];

    const serviceability = this.contextMap.get(addressKey).serviceability;
    return Object.keys(serviceability).filter(website => serviceability[website] === true);
  }

  // Cleanup specific address
  async cleanupAddress(addressKey) {
    if (this.contextMap.has(addressKey)) {
      const data = this.contextMap.get(addressKey);
      try {
        await data.context.close();
        this.contextMap.delete(addressKey);
        console.log(`Closed context for address: ${data.originalAddress || addressKey}`);
      } catch (error) {
        console.error(`Error closing context for address ${data.originalAddress || addressKey}:`, error);
      }
    }
  }

  // Cleanup all non-serviceable contexts
  async cleanupNonServiceableContexts() {
    try {
      const addressesToCleanup = [];

      // Find all addresses where no website is serviceable
      for (const [addressKey, data] of this.contextMap.entries()) {
        const serviceability = data.serviceability;
        const hasAnyServiceable = Object.values(serviceability).some(isServiceable => isServiceable === true);

        if (!hasAnyServiceable) {
          addressesToCleanup.push(addressKey);
        }
      }

      // Cleanup each identified address
      for (const addressKey of addressesToCleanup) {
        const data = this.contextMap.get(addressKey);
        console.log(`Cleaning up non-serviceable context for address: ${data?.originalAddress || addressKey}`);
        await this.cleanupAddress(addressKey);
      }

      return addressesToCleanup.length;
    } catch (error) {
      console.error("Error during non-serviceable contexts cleanup:", error);
      throw error;
    }
  }

  // Cleanup all contexts
  async cleanup() {
    try {
      for (const [addressKey, data] of this.contextMap.entries()) {
        await this.cleanupAddress(addressKey);
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