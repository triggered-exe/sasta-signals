import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import logger from "./logger.js";

const execAsync = promisify(exec);

/**
 * Get memory usage of browser processes launched by Playwright
 * This function queries the OS for Firefox/browser processes and aggregates their memory usage
 */
export async function getBrowserProcessMetrics() {
  try {
    const platform = os.platform();
    let browserProcesses = [];
    let totalMemoryMB = 0;
    let processCount = 0;

    if (platform === "linux" || platform === "darwin") {
      // Use ps command for Linux and macOS
      // Look for firefox processes (Playwright launches Firefox)
      // ps aux shows: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      // We're interested in RSS (Resident Set Size) which is actual physical memory used
      try {
        const { stdout } = await execAsync(
          "ps aux | grep -E '[f]irefox|[p]laywright'"
        );
        
        const lines = stdout.trim().split("\n").filter(line => line.length > 0);
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 11) {
            const pid = parseInt(parts[1]);
            const cpuPercent = parseFloat(parts[2]);
            const memPercent = parseFloat(parts[3]);
            const vsz = parseInt(parts[4]); // Virtual memory size in KB
            const rss = parseInt(parts[5]); // Resident set size in KB (actual physical memory)
            const command = parts.slice(10).join(" ");
            
            // Convert RSS from KB to MB
            const rssMB = Math.round(rss / 1024);
            totalMemoryMB += rssMB;
            processCount++;
            
            browserProcesses.push({
              pid,
              cpuPercent,
              memPercent,
              memoryMB: rssMB,
              vszMB: Math.round(vsz / 1024),
              command: command.length > 100 ? command.substring(0, 100) + "..." : command
            });
          }
        }
      } catch (error) {
        // No browser processes found or command failed
        logger.debug("[browserMetrics]: No browser processes found or ps command failed");
      }
    } else if (platform === "win32") {
      // Use tasklist command for Windows
      try {
        const { stdout } = await execAsync(
          'tasklist /FI "IMAGENAME eq firefox.exe" /FO CSV /NH'
        );
        
        const lines = stdout.trim().split("\n").filter(line => line.length > 0);
        
        for (const line of lines) {
          // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
          const parts = line.split('","').map(p => p.replace(/"/g, ""));
          if (parts.length >= 5) {
            const pid = parseInt(parts[1]);
            const memStr = parts[4].replace(/[^\d]/g, ""); // Remove "K" or "," from memory string
            const memoryKB = parseInt(memStr);
            const memoryMB = Math.round(memoryKB / 1024);
            
            totalMemoryMB += memoryMB;
            processCount++;
            
            browserProcesses.push({
              pid,
              memoryMB,
              command: parts[0]
            });
          }
        }
      } catch (error) {
        logger.debug("[browserMetrics]: No browser processes found or tasklist command failed");
      }
    }

    return {
      platform,
      processCount,
      totalMemoryMB,
      averageMemoryMB: processCount > 0 ? Math.round(totalMemoryMB / processCount) : 0,
      processes: browserProcesses,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error("[browserMetrics]: Error getting browser process metrics:", error);
    return {
      platform: os.platform(),
      processCount: 0,
      totalMemoryMB: 0,
      averageMemoryMB: 0,
      processes: [],
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}