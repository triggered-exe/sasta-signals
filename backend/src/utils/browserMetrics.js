import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import logger from "./logger.js";

const execAsync = promisify(exec);
const BROWSER_PROCESS_PATTERN = /chrome|chromium|playwright|headless[_-]?shell|msedge/i;

function parseUnixProcessTable(stdout) {
  const processes = [];
  const lines = stdout.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;

    processes.push({
      pid: parseInt(match[1], 10),
      ppid: parseInt(match[2], 10),
      rssKB: parseInt(match[3], 10),
      commandName: match[4],
      command: match[5],
    });
  }

  return processes;
}

function collectDescendantProcesses(processes, rootPid) {
  const byParent = new Map();
  for (const proc of processes) {
    let bucket = byParent.get(proc.ppid);
    if (!bucket) {
      bucket = [];
      byParent.set(proc.ppid, bucket);
    }
    bucket.push(proc);
  }

  const descendants = [];
  const queue = byParent.get(rootPid) ? [...byParent.get(rootPid)] : [];
  // Use an index pointer instead of Array.shift() to keep BFS at O(n).
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    descendants.push(current);
    const children = byParent.get(current.pid);
    if (children) queue.push(...children);
  }

  return descendants;
}

/**
 * Get system CPU usage percentage (0-100)
 */
export async function getSystemCpuUsage() {
  try {
    const platform = os.platform();
    if (platform === "win32") {
      const { stdout } = await execAsync('wmic cpu get loadpercentage');
      const lines = stdout.trim().split("\n");
      if (lines.length >= 2) {
        const load = parseInt(lines[1].trim());
        if (!isNaN(load)) return load;
      }
    } else {
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length || 1;
      return Math.round((loadAvg[0] / cpuCount) * 100);
    }
  } catch (error) {
    logger.debug(`[browserMetrics]: Error getting system CPU usage: ${error.message || error}`, { error });
  }
  return 0;
}

/**
 * Get memory usage of browser processes launched by Playwright
 * This function queries the OS for Chromium/browser processes and aggregates their memory usage
 */
export async function getBrowserProcessMetrics() {
  try {
    const platform = os.platform();
    let browserProcesses = [];
    let totalMemoryMB = 0;
    let processCount = 0;

    if (platform === "linux" || platform === "darwin") {
      // Only count browser processes owned by this Node backend.
      // This avoids mixing in the user's regular Chrome windows/tabs.
      try {
        const { stdout } = await execAsync("ps -eo pid=,ppid=,rss=,comm=,args=");
        const processes = parseUnixProcessTable(stdout);
        const descendants = collectDescendantProcesses(processes, process.pid);
        const browserDescendants = descendants.filter(proc =>
          BROWSER_PROCESS_PATTERN.test(proc.commandName) || BROWSER_PROCESS_PATTERN.test(proc.command)
        );

        for (const proc of browserDescendants) {
          const rssMB = Math.round(proc.rssKB / 1024);
          totalMemoryMB += rssMB;
          processCount++;

          browserProcesses.push({
            pid: proc.pid,
            ppid: proc.ppid,
            memoryMB: rssMB,
            command: proc.command.length > 120 ? proc.command.substring(0, 120) + "..." : proc.command
          });
        }
      } catch (error) {
        logger.debug(`[browserMetrics]: Could not inspect descendant browser processes: ${error.message || error}`);
      }
    } else if (platform === "win32") {
      // Use tasklist command for Windows
      try {
        // We check for common browser names used by Playwright
        // On Windows 11, Playwright Chromium often appears as "headless_shell.exe" or "chrome.exe"
        const browserNames = ["chrome.exe", "headless_shell.exe", "msedge.exe", "chromium.exe"];

        // Get CPU usage for processes first using wmic (it's reliable for formatted data)
        let processCpuMap = new Map();
        try {
          const { stdout: cpuStdout } = await execAsync(
            'wmic path Win32_PerfFormattedData_PerfProc_Process get IDProcess,PercentProcessorTime /format:csv'
          );
          const cpuLines = cpuStdout.trim().split("\n").filter(line => line.includes(","));
          for (const line of cpuLines) {
            const parts = line.split(",");
            if (parts.length >= 3) {
              const pid = parseInt(parts[1]);
              const cpu = parseInt(parts[2]);
              if (!isNaN(pid) && !isNaN(cpu)) {
                processCpuMap.set(pid, cpu);
              }
            }
          }
        } catch (cpuError) {
          logger.debug(`[browserMetrics]: Could not get CPU metrics via wmic: ${cpuError.message}`);
        }

        // Run tasklist once and filter in JS
        const { stdout } = await execAsync(
          'tasklist /FO CSV /NH'
        );

        const lines = stdout.trim().split("\n").filter(line => line.length > 0);

        for (const line of lines) {
          // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
          const parts = line.split('","').map(p => p.replace(/"/g, ""));
          if (parts.length >= 5) {
            const imageName = parts[0].toLowerCase();

            if (browserNames.includes(imageName)) {
              const pid = parseInt(parts[1]);
              const memStr = parts[4].replace(/[^\d]/g, ""); // Remove "K" or "," from memory string
              const memoryKB = parseInt(memStr);
              const memoryMB = Math.round(memoryKB / 1024);
              const cpuPercent = processCpuMap.get(pid) || 0;

              totalMemoryMB += memoryMB;
              processCount++;

              browserProcesses.push({
                pid,
                memoryMB,
                cpuPercent, // Added CPU percent for Windows
                command: parts[0]
              });
            }
          }
        }
      } catch (error) {
        logger.debug(`[browserMetrics]: Error querying browser processes on Windows: ${error.message || error}`, { error });
      }
    }

    return {
      platform,
      scope: platform === "win32" ? "system-browser-processes" : "descendants-of-node-process",
      ownerPid: process.pid,
      processCount,
      totalMemoryMB,
      averageMemoryMB: processCount > 0 ? Math.round(totalMemoryMB / processCount) : 0,
      processes: browserProcesses,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error(`[browserMetrics]: Error getting browser process metrics: ${error.message || error}`, { error });
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
