import { firefox } from "playwright";

class ContextManager {
    constructor() {
        this.browser = null;
        this.contextMap = new Map(); // Map to store contexts by pincode 
        this.MAX_CONTEXTS = 5;
    }

    async initBrowser() {
        if (!this.browser) {
            this.browser = await firefox.launch({
                headless: process.env.ENVIRONMENT === "development" ? false : true,
                args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
            });
        }
        return this.browser;
    }

    // Get or create context for a pincode
    async getContext(pincode) {
        // Return existing context if available
        if (this.contextMap.has(pincode)) {
            console.log(`Using cached context for pincode: ${pincode}`);
            return this.contextMap.get(pincode).context;
        }

        // Clean up old contexts if needed
        if (this.contextMap.size >= this.MAX_CONTEXTS) {
            const oldestPincode = Array.from(this.contextMap.keys())[0];
            const oldestData = this.contextMap.get(oldestPincode);
            await oldestData.context.close();
            this.contextMap.delete(oldestPincode);
            console.log(`Cleaned up context for pincode: ${oldestPincode}`);
        }

        // Create new context
        const browser = await this.initBrowser();
        const context = await browser.newContext();
        
        // Store context with metadata
        this.contextMap.set(pincode, {
            context,
            websites: new Set(), // Track which websites are set up
            createdAt: new Date()
        });
        
        console.log(`Created new context for pincode: ${pincode}`);
        return context;
    }

    // Mark a website as set up for a pincode
    markWebsiteAsSet(pincode, website) {
        if (this.contextMap.has(pincode)) {
            this.contextMap.get(pincode).websites.add(website);
            console.log(`Marked ${website} as set up for pincode: ${pincode}`);
        }
    }

    // Check if a website is set up for a pincode
    isWebsiteSet(pincode, website) {
        return this.contextMap.has(pincode) && 
               this.contextMap.get(pincode).websites.has(website);
    }

    // Get all set up websites for a pincode
    getSetWebsites(pincode) {
        return this.contextMap.has(pincode) ? 
               Array.from(this.contextMap.get(pincode).websites) : 
               [];
    }

    // Cleanup specific pincode
    async cleanupPincode(pincode) {
        if (this.contextMap.has(pincode)) {
            const data = this.contextMap.get(pincode);
            await data.context.close();
            this.contextMap.delete(pincode);
            console.log(`Closed context for pincode: ${pincode}`);
        }
    }

    // Cleanup all contexts
    async cleanup() {
        try {
            for (const [pincode, data] of this.contextMap.entries()) {
                await data.context.close();
                console.log(`Closed context for pincode: ${pincode}`);
            }
            this.contextMap.clear();

            if (this.browser) {
                await this.browser.close();
                this.browser = null;
                console.log('Browser closed successfully');
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
            throw error;
        }
    }
}

const contextManager = new ContextManager();
export default contextManager; 