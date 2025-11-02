import express from "express";
import contextManager from "../../utils/contextManager.js";

const router = express.Router();

/**
 * GET /api/monitoring/contexts
 * Returns detailed information about all open browser contexts and their pages
 */
router.get("/contexts", async (req, res) => {
  try {
    // Helper function to convert date to IST
    const toIST = (date) => {
      return new Date(date.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().replace('Z', '+05:30');
    };

    const contextStatus = {
      timestamp: toIST(new Date()),
      timezone: "Asia/Kolkata (IST)",
      totalContexts: contextManager.contextMap.size,
      maxContexts: contextManager.MAX_CONTEXTS,
      browserStatus: contextManager.browser ? "running" : "not initialized",
      contexts: []
    };

    // Iterate through all contexts to gather detailed information
    for (const [addressKey, contextData] of contextManager.contextMap.entries()) {
      const contextInfo = {
        addressKey: addressKey,
        originalAddress: contextData.originalAddress || addressKey,
        createdAt: toIST(contextData.createdAt),
        lastUsed: toIST(contextData.lastUsed),
        ageInMinutes: Math.round((new Date() - contextData.createdAt) / (1000 * 60)),
        minutesSinceLastUse: Math.round((new Date() - contextData.lastUsed) / (1000 * 60)),
        serviceability: contextData.serviceability || {},
        serviceableWebsites: Object.keys(contextData.serviceability || {}).filter(
          website => contextData.serviceability[website] === true
        ),
        allWebsites: Object.keys(contextData.serviceability || {}),
        contextStatus: "unknown",
        totalPages: 0,
        pages: []
      };

      // Check if context exists and get page information
      if (contextData.context) {
        try {
          const pages = await contextData.context.pages();
          contextInfo.contextStatus = "active";
          contextInfo.totalPages = pages.length;
          
          // Get details for each page
          for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            try {
              const url = page.url();
              const title = await page.title();
              
              contextInfo.pages.push({
                index: i,
                url: url,
                title: title,
                isClosed: page.isClosed()
              });
            } catch (pageError) {
              contextInfo.pages.push({
                index: i,
                url: "error retrieving URL",
                title: "error retrieving title",
                isClosed: true,
                error: pageError.message
              });
            }
          }
        } catch (contextError) {
          contextInfo.contextStatus = "invalid";
          contextInfo.error = contextError.message;
        }
      } else {
        contextInfo.contextStatus = "not created";
      }

      contextStatus.contexts.push(contextInfo);
    }

    // Sort contexts by last used (most recent first)
    contextStatus.contexts.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));

    // Add summary statistics
    contextStatus.summary = {
      activeContexts: contextStatus.contexts.filter(c => c.contextStatus === "active").length,
      invalidContexts: contextStatus.contexts.filter(c => c.contextStatus === "invalid").length,
      notCreatedContexts: contextStatus.contexts.filter(c => c.contextStatus === "not created").length,
      totalPages: contextStatus.contexts.reduce((sum, c) => sum + c.totalPages, 0),
      averagePagesPerContext: contextStatus.totalContexts > 0 
        ? Math.round((contextStatus.contexts.reduce((sum, c) => sum + c.totalPages, 0) / contextStatus.totalContexts) * 100) / 100 
        : 0,
    };

    res.json(contextStatus);
  } catch (error) {
    console.error("Error getting context status:", error);
    res.status(500).json({
      error: "Failed to get context status",
      message: error.message,
      timestamp: toIST(new Date()),
      timezone: "Asia/Kolkata (IST)"
    });
  }
});

/**
 * GET /api/monitoring/contexts/summary
 * Returns a quick summary of context status (lighter endpoint)
 */
router.get("/contexts/summary", async (req, res) => {
  try {
    // Helper function to convert date to IST
    const toIST = (date) => {
      return new Date(date.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().replace('Z', '+05:30');
    };

    const summary = {
      timestamp: toIST(new Date()),
      timezone: "Asia/Kolkata (IST)",
      totalContexts: contextManager.contextMap.size,
      maxContexts: contextManager.MAX_CONTEXTS,
      browserStatus: contextManager.browser ? "running" : "not initialized",
      utilizationPercentage: Math.round((contextManager.contextMap.size / contextManager.MAX_CONTEXTS) * 100)
    };

    let activeContexts = 0;
    let totalPages = 0;

    // Quick check of context status without detailed page info
    for (const [addressKey, contextData] of contextManager.contextMap.entries()) {
      if (contextData.context) {
        try {
          const pages = await contextData.context.pages();
          activeContexts++;
          totalPages += pages.length;
        } catch (error) {
          // Context is invalid but still counts toward total
        }
      }
    }

    summary.activeContexts = activeContexts;
    summary.totalPages = totalPages;
    summary.averagePagesPerContext = activeContexts > 0 
      ? Math.round((totalPages / activeContexts) * 100) / 100 
      : 0;

    res.json(summary);
  } catch (error) {
    console.error("Error getting context summary:", error);
    res.status(500).json({
      error: "Failed to get context summary",
      message: error.message,
      timestamp: toIST(new Date()),
      timezone: "Asia/Kolkata (IST)"
    });
  }
});

/**
 * POST /api/monitoring/contexts/cleanup
 * Trigger cleanup of non-serviceable contexts
 */
router.post("/contexts/cleanup", async (req, res) => {
  try {
    // Helper function to convert date to IST
    const toIST = (date) => {
      return new Date(date.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().replace('Z', '+05:30');
    };

    const cleanedCount = await contextManager.cleanupNonServiceableContexts();
    
    res.json({
      message: "Cleanup completed",
      cleanedContexts: cleanedCount,
      remainingContexts: contextManager.contextMap.size,
      timestamp: toIST(new Date()),
      timezone: "Asia/Kolkata (IST)"
    });
  } catch (error) {
    console.error("Error during cleanup:", error);
    res.status(500).json({
      error: "Failed to cleanup contexts",
      message: error.message,
      timestamp: toIST(new Date()),
      timezone: "Asia/Kolkata (IST)"
    });
  }
});

export default router;