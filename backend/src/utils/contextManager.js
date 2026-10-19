import logger from "./logger.js";
import { chromium } from "playwright";
import { getCurrentIST } from "./dateUtils.js";
import { getBrowserProcessMetrics } from "./browserMetrics.js";

// Real Chromium user agents that are commonly used
const REAL_CHROMIUM_USER_AGENTS = [
  // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', // Not working for bigbasket
  // 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', // Not working for bibbasket
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', // Ipad mini user agent
  // 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
];

// Function to get a random Chromium user agent
const getRandomUserAgent = () => {
  return REAL_CHROMIUM_USER_AGENTS[Math.floor(Math.random() * REAL_CHROMIUM_USER_AGENTS.length)];
};

class ContextManager {
  constructor() {
    this.browser = null;
    this.browserLaunchPromise = null; // Shared by concurrent initBrowser calls so only one browser is launched
    this.contextMap = new Map(); // Map to store contexts by address
    // Tracking alone keeps 3 locations open, so 3 left no room for searches. Idle contexts are still reclaimed.
    this.MAX_CONTEXTS = 5;
    this.IDLE_CONTEXT_GRACE_MS = 5 * 60 * 1000; // Only reclaim contexts with no pages that have been idle this long
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
    if (this.browser) return this.browser;
    if (!this.browserLaunchPromise) {
      this.browserLaunchPromise = this.launchBrowser().finally(() => {
        this.browserLaunchPromise = null;
      });
    }
    return this.browserLaunchPromise;
  }

  async launchBrowser() {
    logger.info(`[ctx]: Environment: ${process.env.ENVIRONMENT}`);
    if (!this.browser) {
      const isDevMode = process.env.ENVIRONMENT === "development";

      // Chromium launch args for memory optimization and stealth
      const chromiumArgs = [
        // Memory optimization flags
        '--disable-dev-shm-usage', // Reduce shared memory usage
        '--disable-gpu', // Disable GPU acceleration
        '--disable-software-rasterizer',
        '--disk-cache-size=67108864', // 64MB cache (matching Firefox config)
        '--renderer-process-limit=2', // Limit renderer processes (matching Firefox dom.ipc.processCount)

        // Disable unnecessary features
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--metrics-recording-only',
        '--disable-default-apps',
        '--mute-audio',
        '--no-first-run',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',

        // Stealth flags to avoid detection
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-web-security', // May help with CORS issues during scraping
        '--disable-features=IsolateOrigins,site-per-process',

        // Network and timeout settings
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',

        // Additional performance flags
        '--no-sandbox', // Use cautiously - only in controlled environments
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-ipc-flooding-protection',
      ];

      // Add development mode specific args
      if (isDevMode) {
        chromiumArgs.push('--start-maximized');
      }

      const browser = await chromium.launch({
        headless: !isDevMode,
        args: chromiumArgs,
      });

      // If Chromium crashes or is closed, every cached context is dead. Drop them so the next
      // getContext() launches a fresh browser instead of handing out closed contexts forever.
      browser.on("disconnected", () => {
        if (this.browser !== browser) return;
        logger.warn("[ctx]: Browser disconnected, dropping all contexts; it will be relaunched on the next request");
        this.browser = null;
        this.contextMap.clear();
      });

      this.browser = browser;
    }
    return this.browser;
  }

  // Get or create context for an address with improved error handling
  async getContext(address) {
    try {
      const addressKey = this.cleanAddressKey(address);

      // Return existing context if available. Closed contexts are removed from the map by their
      // "close" handler (and all of them when the browser disconnects), so a cached context is live.
      if (this.contextMap.has(addressKey)) {
        const contextData = this.contextMap.get(addressKey);
        if (contextData.context) {
          contextData.lastActivityAt = Date.now();
          logger.info(`[ctx]: Using cached context for address: ${address} (${contextData.context.pages().length} pages)`);
          return contextData.context;
        }
        // Serviceability-only entry without a browser context: replace it with a fresh context below
        this.contextMap.delete(addressKey);
      }

      // Memory management: prevent exceeding context limit
      if (this.contextMap.size >= this.MAX_CONTEXTS) {
        logger.info("[ctx]: Context limit reached, attempting cleanup...");

        const cleanedCount = await this.cleanupIdleContexts();

        if (cleanedCount === 0) {
          // No contexts were cleaned up, all are busy
          const activeContexts = Array.from(this.contextMap.entries())
            .map(([key, data]) => ({
              address: data.originalAddress,
              serviceableWebsites: Object.keys(data.serviceability).filter(w => data.serviceability[w] === true).length,
              lastUsed: data.lastUsed
            }));

          throw new Error(
            `All ${this.MAX_CONTEXTS} contexts are in use or were used in the last ${this.IDLE_CONTEXT_GRACE_MS / 60000} minutes. ` +
            `Active contexts: ${activeContexts.map(c => `${c.address} (${c.serviceableWebsites} serviceable)`).join(', ')}. ` +
            `Please wait for operations to complete.`
          );
        } else {
          logger.info(`[ctx]: Successfully cleaned up ${cleanedCount} idle context(s), proceeding with new context creation.`);
        }
      }

      // Create new context with stealth configuration
      const browser = await this.initBrowser();
      const userAgent = getRandomUserAgent();
      logger.info(`[ctx]: Selected User Agent for ${address}: ${userAgent}`);

      // let platformHeader = '"Windows"';
      // if (userAgent.includes('Macintosh')) {
      //   platformHeader = '"macOS"';
      // } else if (userAgent.includes('Linux')) {
      //   platformHeader = '"Linux"';
      // }

      const context = await browser.newContext({
        // Use a real Chromium user agent
        // userAgent: userAgent,  // This is causing the BgBasket 403 issue
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
        // Set permissions - explicitly empty to disable location access prompts
        permissions: [],
        // Set extra HTTP headers to look more like a real Chromium browser
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          // 'Sec-Ch-Ua-Platform': platformHeader,
          'Cache-Control': 'max-age=0'
        },
        // Enable JavaScript
        javaScriptEnabled: true,
        // Set realistic color scheme
        colorScheme: 'light',
        // Set reduced motion preference
        reducedMotion: 'no-preference',
        // Set Chromium-specific options
        hasTouch: false,
        isMobile: false
      });

      // Add stealth scripts to the context to hide automation
      await context.addInitScript((ua) => {
        // Explicitly override user agent
        Object.defineProperty(navigator, 'userAgent', {
          get: () => ua,
          configurable: true
        });

        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        // Override the automation flag
        Object.defineProperty(navigator, 'automation', {
          get: () => false,
        });

        // Mock realistic plugins for Chromium
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            return [
              {
                name: 'Chrome PDF Plugin',
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                length: 1
              },
              {
                name: 'Chrome PDF Viewer',
                description: 'Portable Document Format',
                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                length: 1
              },
              {
                name: 'Native Client',
                description: '',
                filename: 'internal-nacl-plugin',
                length: 2
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

        // Override chrome runtime
        if (!window.chrome) {
          window.chrome = {};
        }
        if (!window.chrome.runtime) {
          window.chrome.runtime = {};
        }

        // Remove automation indicators
        delete window._phantom;
        delete window._selenium;
        delete window.callPhantom;
        delete window.callSelenium;
        delete window.__nightmare;
        delete window.__webdriver_script_fn;
        delete window.__webdriver_evaluate;
        delete window.__webdriver_script_function;
        delete window.__driver_evaluate;
        delete window.__webdriver_unwrapped;
        delete window.__driver_unwrapped;

        // Override vendor
        Object.defineProperty(navigator, 'vendor', {
          get: () => 'Google Inc.',
        });

        // Override platform to match the header we set
        let platform = 'Win32';
        if (ua.includes('Macintosh')) {
          platform = 'MacIntel';
        } else if (ua.includes('Linux')) {
          platform = 'Linux x86_64';
        }
        Object.defineProperty(navigator, 'platform', {
          get: () => platform,
        });

      }, userAgent);

      // Store context with metadata including tracking when it was last used
      const contextData = {
        context,
        createdAt: getCurrentIST(),
        lastUsed: getCurrentIST(), // Track last usage for better cleanup decisions
        lastActivityAt: Date.now(), // Epoch ms of the last getContext/new page, used by idle cleanup
        serviceability: {}, // Track which websites are serviceable for this location
        originalAddress: address, // Store original address for reference
      };
      this.contextMap.set(addressKey, contextData);

      // Every new page (from createPage or context.newPage) counts as activity
      context.on("page", () => {
        contextData.lastActivityAt = Date.now();
      });
      // Forget the context as soon as it closes, so it is never handed out again
      context.on("close", () => {
        if (this.contextMap.get(addressKey)?.context === context) {
          this.contextMap.delete(addressKey);
          logger.info(`[ctx]: Context for address ${address} closed (remaining contexts: ${this.contextMap.size})`);
        }
      });

      logger.info(`[ctx]: Created new context for address: ${address} (total contexts: ${this.contextMap.size})`);
      return context;
    } catch (error) {
      logger.error(`[ctx]: Error getting context for address ${address}: ${error.message || error}`, { error });
      throw error;
    }
  }

  // Update last used time for a context
  updateLastUsed(address) {
    const addressKey = this.cleanAddressKey(address);
    if (this.contextMap.has(addressKey)) {
      this.contextMap.get(addressKey).lastUsed = getCurrentIST();
    }
  }

  // Mark a website as serviceable or not for an address.
  // Synchronous on purpose: callers don't await it, and it used to trigger idle cleanup, which could
  // close another provider's context in the gap between two of its pages.
  markServiceability(address, website, isServiceable) {
    const addressKey = this.cleanAddressKey(address);
    if (this.contextMap.has(addressKey)) {
      const contextData = this.contextMap.get(addressKey);
      contextData.serviceability[website] = isServiceable;

      this.updateLastUsed(address);
      logger.info(`[ctx]: Marked ${website} as ${isServiceable ? 'serviceable' : 'not serviceable'} for address: ${address}`);
    } else {
      // If context doesn't exist, create a minimal entry for serviceability tracking
      this.contextMap.set(addressKey, {
        context: null,
        createdAt: getCurrentIST(),
        lastUsed: getCurrentIST(),
        serviceability: { [website]: isServiceable },
        originalAddress: address,
      });
      logger.info(`[ctx]: Created serviceability entry and marked ${website} as ${isServiceable ? 'serviceable' : 'not serviceable'} for address: ${address}`);
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

  // Check if a website is set up for an address (alias for getWebsiteServiceabilityStatus)
  isWebsiteSet(address, website) {
    return this.getWebsiteServiceabilityStatus(address, website);
  }

  // Cleanup specific address
  async cleanupAddress(addressKey) {
    if (this.contextMap.has(addressKey)) {
      const data = this.contextMap.get(addressKey);
      try {
        // If there's no browser context (serviceability-only entry), just remove it safely
        if (!data || !data.context) {
          logger.info(`[ctx]: No browser context for ${data?.originalAddress || addressKey}, removing entry`);
          this.contextMap.delete(addressKey);
          logger.info(`[ctx]: Removed entry for address: ${data?.originalAddress || addressKey} (remaining contexts: ${this.contextMap.size})`);
          return;
        }

        // Log page count before cleanup
        let pagesBefore = [];
        try {
          pagesBefore = await data.context.pages();
        } catch (e) {
          // Ignore errors if context is already closed or invalid
        }
        logger.info(`[ctx]: Cleaning up context for ${data.originalAddress || addressKey} (${pagesBefore.length} pages)`);

        try {
          await data.context.close();
        } catch (closeErr) {
          logger.warn(`[ctx]: Failed to close context for ${data.originalAddress || addressKey}: ${closeErr?.message || closeErr}`);
        }

        this.contextMap.delete(addressKey);
        logger.info(`[ctx]: Closed context for address: ${data.originalAddress || addressKey} (remaining contexts: ${this.contextMap.size})`);
      } catch (error) {
        logger.error(`[ctx]: Error closing context for address ${data.originalAddress || addressKey}: ${error.message || error}`, { error });
        // Ensure the map entry is removed to avoid repeated failures
        try {
          this.contextMap.delete(addressKey);
        } catch (e) {
          logger.warn(`[ctx]: Failed to delete map entry for ${addressKey}: ${e?.message || e}`);
        }
      }
    }
  }

  // Cleanup idle and non-serviceable contexts
  async cleanupIdleContexts() {
    try {
      const addressesToCleanup = [];
      const beforeCount = this.contextMap.size;

      // If size is only one context, skip cleanup
      if (beforeCount <= 1) {
        logger.info("[ctx]: Only one or zero contexts present, skipping idle cleanup");
        return 0;
      }

      // Find contexts to cleanup: entries without a browser context, and contexts with no open pages
      // that have been idle past the grace period. A context with 0 pages may just be between two pages
      // of a tracking loop (or freshly created), so "no pages" alone is not enough.
      const now = Date.now();
      for (const [addressKey, data] of this.contextMap.entries()) {
        if (!data.context) {
          addressesToCleanup.push({ addressKey, reason: 'no browser context' });
          continue;
        }

        const idleMs = now - (data.lastActivityAt || 0);
        if (data.context.pages().length === 0 && idleMs >= this.IDLE_CONTEXT_GRACE_MS) {
          const hasAnyServiceable = Object.values(data.serviceability).some(isServiceable => isServiceable === true);
          const reason = `no pages, idle ${Math.round(idleMs / 60000)}m${hasAnyServiceable ? '' : ', non-serviceable'}`;
          addressesToCleanup.push({ addressKey, reason });
        }
      }

      logger.info(`[ctx]: Found ${addressesToCleanup.length} contexts to cleanup out of ${beforeCount} total`);

      // Cleanup each identified address
      for (const { addressKey, reason } of addressesToCleanup) {
        const data = this.contextMap.get(addressKey);
        logger.info(`[ctx]: Cleaning up context for address: ${data?.originalAddress || addressKey} (reason: ${reason})`);
        await this.cleanupAddress(addressKey);
      }

      const cleanedCount = addressesToCleanup.length;
      if (cleanedCount > 0) {
        logger.info(`[ctx]: Cleanup completed - removed ${cleanedCount} contexts, ${this.contextMap.size} remaining`);
      }

      return cleanedCount;
    } catch (error) {
      logger.error(`[ctx]: Error during idle contexts cleanup: ${error.message || error}`, { error });
      throw error;
    }
  }


  getUserAgent(website) {
    let userAgent = getRandomUserAgent();
    if (website === 'bigbasket') {
      // Specific user agent for BigBasket to avoid 403
      const workingAgentForBB = [
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      ]
      userAgent = workingAgentForBB[Math.floor(Math.random() * workingAgentForBB.length)];
    } else if (website === 'instamart') {
      const workingAgentForIM = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
      ]
      userAgent = workingAgentForIM[Math.floor(Math.random() * workingAgentForIM.length)];
    }

    return userAgent;
  }

  // Centralized method to create a new page with User-Agent set
  async createPage(context, website) {
    try {
      let userAgent = this.getUserAgent(website);

      const page = await context.newPage();

      // Override navigator.userAgent for this specific page
      await page.addInitScript((ua) => {
        try {
          Object.defineProperty(navigator, 'userAgent', {
            get: () => ua,
            configurable: true
          });
        } catch (e) {
          console.error("Error overriding page userAgent:", e);
        }
      }, userAgent);

      await page.setExtraHTTPHeaders({
        "User-Agent": userAgent,
        "accept-language": "en-US,en;q=0.9",
        "upgrade-insecure-requests": "1",
        "sec-ch-ua": userAgent.includes('Macintosh') ? '"Not/A)Brand";v="8", "Chromium";v="140", "Google Chrome";v="140"' : '"Chromium";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": userAgent.includes('Macintosh') ? '"macOS"' : '"Windows"',
      });
      return page;
    } catch (error) {
      logger.error(`[ctx]: Error creating page: ${error.message || error}`, { error });
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
        logger.info("[ctx]: Browser closed successfully");
      }
    } catch (error) {
      logger.error(`[ctx]: Error during cleanup: ${error.message || error}`, { error });
      throw error;
    }
  }
}

const contextManager = new ContextManager();
export default contextManager;