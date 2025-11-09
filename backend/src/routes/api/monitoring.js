import logger from "../../utils/logger.js";
import express from "express";
import os from "os";
import process from "process";
import contextManager from "../../utils/contextManager.js";
import { formatISTString, getISTInfo } from "../../utils/dateUtils.js";

const router = express.Router();

/**
 * Get system resource utilization metrics
 */
const getSystemMetrics = () => {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercent = Math.round((usedMemory / totalMemory) * 100);

  // Get process-specific memory usage
  // Note: This only includes the Node.js process memory. Browser processes (e.g., Firefox via Playwright)
  // run in separate OS processes and are not included here. Total app memory = Node.js + browser processes.
  const processMemory = process.memoryUsage();
  const processMemoryMB = {
    rss: Math.round(processMemory.rss / 1024 / 1024), // Resident Set Size - total physical memory used by the process
    heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024), // Total size of the V8 JavaScript heap (allocated memory)
    heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024), // Portion of the heap actually used by JavaScript objects
    external: Math.round(processMemory.external / 1024 / 1024), // Memory used by external resources (e.g., C++ objects, buffers)
    arrayBuffers: Math.round(processMemory.arrayBuffers / 1024 / 1024) // Memory used by ArrayBuffer instances
  };

  // Log memory usage for monitoring
  logger.info(`[memory]: RSS=${processMemoryMB.rss}MB, HeapUsed=${processMemoryMB.heapUsed}MB, HeapTotal=${processMemoryMB.heapTotal}MB, External=${processMemoryMB.external}MB, ArrayBuffers=${processMemoryMB.arrayBuffers}MB`);

  // Get CPU information
  const cpus = os.cpus();
  const cpuCount = cpus.length;

  // Calculate average CPU load (1, 5, 15 minute averages)
  const loadAvg = os.loadavg();
  const cpuLoadPercent = {
    '1min': Math.round((loadAvg[0] / cpuCount) * 100),
    '5min': Math.round((loadAvg[1] / cpuCount) * 100),
    '15min': Math.round((loadAvg[2] / cpuCount) * 100)
  };

  // Get system uptime
  const systemUptime = os.uptime();
  const processUptime = process.uptime();

  return {
    memory: {
      total: Math.round(totalMemory / 1024 / 1024), // MB
      free: Math.round(freeMemory / 1024 / 1024), // MB
      used: Math.round(usedMemory / 1024 / 1024), // MB
      usagePercent: memoryUsagePercent
    },
    process: {
      memory: processMemoryMB,
      uptime: Math.round(processUptime), // seconds
      pid: process.pid,
      nodeVersion: process.version
    },
    cpu: {
      count: cpuCount,
      model: cpus[0]?.model || 'Unknown',
      loadPercent: cpuLoadPercent,
      architecture: os.arch(),
      platform: os.platform()
    },
    system: {
      uptime: Math.round(systemUptime), // seconds
      hostname: os.hostname(),
      type: os.type(),
      release: os.release()
    }
  };
};

/**
 * GET /api/monitoring/contexts
 * Returns detailed information about all open browser contexts and their pages
 */
router.get("/contexts", async (req, res) => {
  try {
    const istInfo = getISTInfo();
    const systemMetrics = getSystemMetrics();

    const contextStatus = {
      timestamp: formatISTString(new Date()),
      timezone: istInfo.timezone,
      totalContexts: contextManager.contextMap.size,
      maxContexts: contextManager.MAX_CONTEXTS,
      browserStatus: contextManager.browser ? "running" : "not initialized",
      systemMetrics: systemMetrics,
      contexts: []
    };

    // Iterate through all contexts to gather detailed information
    for (const [addressKey, contextData] of contextManager.contextMap.entries()) {
      const contextInfo = {
        addressKey: addressKey,
        originalAddress: contextData.originalAddress || addressKey,
        createdAt: formatISTString(contextData.createdAt),
        lastUsed: formatISTString(contextData.lastUsed),
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

    // Log context summary for monitoring
    logger.info(`[contexts]: Total=${contextStatus.totalContexts}, Active=${contextStatus.summary.activeContexts}, Invalid=${contextStatus.summary.invalidContexts}, TotalPages=${contextStatus.summary.totalPages}`);

    res.json(contextStatus);
  } catch (error) {
    logger.error("Error getting context status:", error);
    res.status(500).json({
      error: "Failed to get context status",
      message: error.message,
      timestamp: formatISTString(new Date()),
      timezone: getISTInfo().timezone
    });
  }
});

/**
 * GET /api/monitoring/contexts/summary
 * Returns a quick summary of context status (lighter endpoint)
 */
router.get("/contexts/summary", async (req, res) => {
  try {
    const istInfo = getISTInfo();
    const systemMetrics = getSystemMetrics();

    const summary = {
      timestamp: formatISTString(new Date()),
      timezone: istInfo.timezone,
      totalContexts: contextManager.contextMap.size,
      maxContexts: contextManager.MAX_CONTEXTS,
      browserStatus: contextManager.browser ? "running" : "not initialized",
      utilizationPercentage: Math.round((contextManager.contextMap.size / contextManager.MAX_CONTEXTS) * 100),
      systemMetrics: {
        memory: systemMetrics.memory,
        cpu: {
          count: systemMetrics.cpu.count,
          loadPercent: systemMetrics.cpu.loadPercent
        },
        process: {
          memory: systemMetrics.process.memory,
          uptime: systemMetrics.process.uptime
        }
      }
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
    logger.error("Error getting context summary:", error);
    res.status(500).json({
      error: "Failed to get context summary",
      message: error.message,
      timestamp: formatISTString(new Date()),
      timezone: getISTInfo().timezone
    });
  }
});

/**
 * GET /api/monitoring/system
 * Returns detailed system resource utilization metrics
 */
router.get("/system", (req, res) => {
  try {
    const istInfo = getISTInfo();
    const systemMetrics = getSystemMetrics();

    const response = {
      timestamp: formatISTString(new Date()),
      timezone: istInfo.timezone,
      ...systemMetrics,
      alerts: []
    };

    // Add performance alerts
    if (systemMetrics.memory.usagePercent > 85) {
      response.alerts.push({
        type: "warning",
        message: `High memory usage: ${systemMetrics.memory.usagePercent}%`,
        threshold: "85%"
      });
    }

    if (systemMetrics.cpu.loadPercent['1min'] > 80) {
      response.alerts.push({
        type: "warning",
        message: `High CPU load (1min): ${systemMetrics.cpu.loadPercent['1min']}%`,
        threshold: "80%"
      });
    }

    if (systemMetrics.process.memory.heapUsed > 500) {
      response.alerts.push({
        type: "info",
        message: `Process heap usage: ${systemMetrics.process.memory.heapUsed}MB`,
        threshold: "500MB"
      });
    }

    // Add external memory alerts
    if (systemMetrics.process.memory.external > 200) {
      response.alerts.push({
        type: "warning",
        message: `High external memory usage: ${systemMetrics.process.memory.external}MB`,
        threshold: "200MB"
      });
    }

    if (systemMetrics.process.memory.arrayBuffers > 100) {
      response.alerts.push({
        type: "warning",
        message: `High ArrayBuffer memory usage: ${systemMetrics.process.memory.arrayBuffers}MB`,
        threshold: "100MB"
      });
    }

    // Log memory metrics for monitoring
    logger.info(`[system]: Memory - RSS:${systemMetrics.process.memory.rss}MB, Heap:${systemMetrics.process.memory.heapUsed}MB, External:${systemMetrics.process.memory.external}MB, ArrayBuffers:${systemMetrics.process.memory.arrayBuffers}MB`);

    res.json(response);
  } catch (error) {
    logger.error("Error getting system metrics:", error);
    res.status(500).json({
      error: "Failed to get system metrics",
      message: error.message,
      timestamp: formatISTString(new Date()),
      timezone: getISTInfo().timezone
    });
  }
});

/**
 * POST /api/monitoring/contexts/cleanup
 * Trigger cleanup of non-serviceable contexts
 */
router.post("/contexts/cleanup", async (req, res) => {
  try {
    const memBefore = process.memoryUsage();
    logger.info(`[cleanup]: Starting cleanup - RSS: ${Math.round(memBefore.rss / 1024 / 1024)}MB, External: ${Math.round(memBefore.external / 1024 / 1024)}MB, ArrayBuffers: ${Math.round(memBefore.arrayBuffers / 1024 / 1024)}MB`);

    const cleanedCount = await contextManager.cleanupIdleContexts();

    const memAfter = process.memoryUsage();
    const memDelta = {
      rss: Math.round((memAfter.rss - memBefore.rss) / 1024 / 1024),
      external: Math.round((memAfter.external - memBefore.external) / 1024 / 1024),
      arrayBuffers: Math.round((memAfter.arrayBuffers - memBefore.arrayBuffers) / 1024 / 1024)
    };

    logger.info(`[cleanup]: Completed - cleaned ${cleanedCount} contexts, Memory delta - RSS: ${memDelta.rss}MB, External: ${memDelta.external}MB, ArrayBuffers: ${memDelta.arrayBuffers}MB`);

    res.json({
      message: "Cleanup completed",
      cleanedContexts: cleanedCount,
      remainingContexts: contextManager.contextMap.size,
      memoryDelta: memDelta,
      timestamp: formatISTString(new Date()),
      timezone: getISTInfo().timezone
    });
  } catch (error) {
    logger.error("Error during cleanup:", error);
    res.status(500).json({
      error: "Failed to cleanup contexts",
      message: error.message,
      timestamp: formatISTString(new Date()),
      timezone: getISTInfo().timezone
    });
  }
});

export default router;