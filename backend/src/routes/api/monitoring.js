import logger from "../../utils/logger.js";
import express from "express";
import os from "os";
import process from "process";
import contextManager from "../../utils/contextManager.js";
import { formatISTString, getISTInfo, getCurrentIST } from "../../utils/dateUtils.js";
import { getBrowserProcessMetrics, getSystemCpuUsage } from "../../utils/browserMetrics.js";

const router = express.Router();

/**
 * Gathers comprehensive system, process, and browser metrics.
 */
const getComprehensiveMetrics = async () => {
  // System Info
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const cpus = os.cpus();
  const cpuCount = cpus.length;
  const loadAvg = os.loadavg();
  const currentCpuUsage = await getSystemCpuUsage();

  const system = {
    hostname: os.hostname(),
    platform: os.platform(),
    architecture: os.arch(),
    osType: os.type(),
    osRelease: os.release(),
    uptimeSeconds: Math.round(os.uptime())
  };

  const cpu = {
    model: cpus[0]?.model || 'Unknown',
    coreCount: cpuCount,
    loadAveragePercent: {
      '1min': currentCpuUsage || Math.round((loadAvg[0] / cpuCount) * 100),
      '5min': Math.round((loadAvg[1] / cpuCount) * 100),
      '15min': Math.round((loadAvg[2] / cpuCount) * 100)
    }
  };

  const memory = {
    system: {
      totalMB: Math.round(totalMemory / 1024 / 1024),
      freeMB: Math.round(freeMemory / 1024 / 1024),
      usedMB: Math.round(usedMemory / 1024 / 1024),
      usagePercent: Math.round((usedMemory / totalMemory) * 100)
    }
  };

  // Process Info
  const processMemory = process.memoryUsage();
  const processMemoryMB = {
    rss: Math.round(processMemory.rss / 1024 / 1024),
    heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024),
    heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024),
    external: Math.round(processMemory.external / 1024 / 1024),
    arrayBuffers: Math.round(processMemory.arrayBuffers / 1024 / 1024)
  };

  const nodeProcess = {
    pid: process.pid,
    version: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMB: processMemoryMB
  };

  // Browser Info
  const browserMetrics = await getBrowserProcessMetrics();
  const browserProcesses = {
    processCount: browserMetrics.processCount,
    totalMemoryMB: browserMetrics.totalMemoryMB,
    averageMemoryMB: browserMetrics.averageMemoryMB,
    list: browserMetrics.processes
  };

  // Application Memory
  const totalAppMemoryMB = nodeProcess.memoryMB.rss + browserProcesses.totalMemoryMB;
  memory.application = {
    totalMB: totalAppMemoryMB,
    nodeMB: nodeProcess.memoryMB.rss,
    browserMB: browserProcesses.totalMemoryMB,
    breakdownPercent: {
      node: totalAppMemoryMB > 0 ? Math.round((nodeProcess.memoryMB.rss / totalAppMemoryMB) * 100) : 0,
      browser: totalAppMemoryMB > 0 ? Math.round((browserProcesses.totalMemoryMB / totalAppMemoryMB) * 100) : 0
    }
  };

  // Browser Contexts
  const contextList = [];
  for (const [addressKey, contextData] of contextManager.contextMap.entries()) {
    const contextInfo = {
      addressKey: addressKey,
      originalAddress: contextData.originalAddress || addressKey,
      createdAt: formatISTString(contextData.createdAt),
      lastUsed: formatISTString(contextData.lastUsed),
      ageMinutes: Math.round((getCurrentIST() - contextData.createdAt) / (1000 * 60)),
      minutesSinceLastUse: Math.round((getCurrentIST() - contextData.lastUsed) / (1000 * 60)),
      serviceability: contextData.serviceability || {},
      status: "not-created",
      pages: []
    };

    if (contextData.context) {
      try {
        const pages = await contextData.context.pages();
        contextInfo.status = "active";
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          try {
            contextInfo.pages.push({
              url: page.url(),
              title: await page.title(),
              isClosed: page.isClosed()
            });
          } catch (pageError) {
            contextInfo.pages.push({
              url: "error-retrieving-url",
              title: "error-retrieving-title",
              isClosed: true,
              error: pageError.message
            });
          }
        }
      } catch (contextError) {
        contextInfo.status = "invalid";
        contextInfo.error = contextError.message;
      }
    }
    contextList.push(contextInfo);
  }
  contextList.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));

  const totalPages = contextList.reduce((sum, c) => sum + c.pages.length, 0);
  const activeContexts = contextList.filter(c => c.status === "active").length;
  const totalContexts = contextManager.contextMap.size;

  const browserContexts = {
    status: contextManager.browser ? "running" : "not-initialized",
    max: contextManager.MAX_CONTEXTS,
    total: totalContexts,
    active: activeContexts,
    invalid: contextList.filter(c => c.status === "invalid").length,
    notCreated: contextList.filter(c => c.status === "not-created").length,
    utilizationPercent: totalContexts > 0 ? Math.round((totalContexts / contextManager.MAX_CONTEXTS) * 100) : 0,
    totalPages: totalPages,
    averagePagesPerContext: totalContexts > 0 ? Math.round((totalPages / totalContexts) * 100) / 100 : 0,
    list: contextList
  };

  return {
    system,
    cpu,
    memory,
    processes: {
      node: nodeProcess,
      browser: browserProcesses
    },
    browserContexts
  };
};

/**
 * GET /api/monitoring/system
 * Returns a comprehensive overview of system, process, and browser metrics.
 */
router.get("/system", async (req, res) => {
  try {
    const istInfo = getISTInfo();
    const metrics = await getComprehensiveMetrics();

    const response = {
      timestamp: formatISTString(new Date()),
      timezone: istInfo.timezone,
      ...metrics
    };

    logger.info(`[system-metrics]: App Memory (Total: ${metrics.memory.application.totalMB}MB, Node: ${metrics.memory.application.nodeMB}MB, Browser: ${metrics.memory.application.browserMB}MB), Contexts (Total: ${metrics.browserContexts.total}, Active: ${metrics.browserContexts.active})`);

    res.json(response);
  } catch (error) {
    logger.error("Error getting comprehensive system metrics:", error);
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
 * Trigger cleanup of ALL contexts (force clear, regardless of usage)
 */
router.post("/contexts/cleanup", async (req, res) => {
  try {
    const memBefore = process.memoryUsage();
    logger.info(`[cleanup]: Starting FORCE cleanup - RSS: ${Math.round(memBefore.rss / 1024 / 1024)}MB, External: ${Math.round(memBefore.external / 1024 / 1024)}MB, ArrayBuffers: ${Math.round(memBefore.arrayBuffers / 1024 / 1024)}MB`);

    const contextsBefore = contextManager.contextMap.size;
    await contextManager.cleanup();
    const cleanedCount = contextsBefore;

    const memAfter = process.memoryUsage();
    const memDelta = {
      rss: Math.round((memAfter.rss - memBefore.rss) / 1024 / 1024),
      external: Math.round((memAfter.external - memBefore.external) / 1024 / 1024),
      arrayBuffers: Math.round((memAfter.arrayBuffers - memBefore.arrayBuffers) / 1024 / 1024)
    };

    logger.info(`[cleanup]: FORCE cleanup completed - cleaned ALL contexts, Memory delta - RSS: ${memDelta.rss}MB, External: ${memDelta.external}MB, ArrayBuffers: ${memDelta.arrayBuffers}MB`);

    res.json({
      message: "FORCE cleanup completed - ALL contexts cleared",
      cleanedContexts: cleanedCount,
      remainingContexts: contextManager.contextMap.size,
      memoryDelta: memDelta,
      timestamp: formatISTString(new Date()),
      timezone: getISTInfo().timezone
    });
  } catch (error) {
    logger.error("Error during FORCE cleanup:", error);
    res.status(500).json({
      error: "Failed to FORCE cleanup contexts",
      message: error.message,
      timestamp: formatISTString(new Date()),
      timezone: getISTInfo().timezone
    });
  }
});

export default router;