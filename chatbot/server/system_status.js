// chatbot/server/system_status.js
import os from "os";

/**
 * Liefert den aktuellen System-Status (CPU und Arbeitsspeicher)
 * @returns {object} System-Status mit CPU- und RAM-Informationen
 */
export function getSystemStatus() {
  try {
    // CPU-Informationen
    const cpus = os.cpus();
    const cpuCount = cpus.length;

    // CPU-Auslastung berechnen (Durchschnitt über alle Kerne)
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    const cpuUsagePercent = totalTick > 0
      ? Math.round((1 - totalIdle / totalTick) * 100)
      : null;

    // RAM-Informationen
    const totalMemoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();
    const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;

    // Konvertierung in MB
    const totalMemoryMb = Math.round(totalMemoryBytes / (1024 * 1024));
    const freeMemoryMb = Math.round(freeMemoryBytes / (1024 * 1024));
    const usedMemoryMb = Math.round(usedMemoryBytes / (1024 * 1024));
    const memoryUsagePercent = Math.round((usedMemoryBytes / totalMemoryBytes) * 100);

    // System-Uptime
    const uptimeSeconds = os.uptime();

    // Load Average (nur auf Unix-Systemen verfügbar)
    const loadAverage = os.loadavg();

    return {
      available: true,
      cpu: {
        count: cpuCount,
        model: cpus[0]?.model || "Unbekannt",
        usagePercent: cpuUsagePercent,
        loadAverage: {
          oneMin: loadAverage[0] ? Math.round(loadAverage[0] * 100) / 100 : null,
          fiveMin: loadAverage[1] ? Math.round(loadAverage[1] * 100) / 100 : null,
          fifteenMin: loadAverage[2] ? Math.round(loadAverage[2] * 100) / 100 : null
        }
      },
      memory: {
        totalMb: totalMemoryMb,
        usedMb: usedMemoryMb,
        freeMb: freeMemoryMb,
        usagePercent: memoryUsagePercent
      },
      uptime: uptimeSeconds,
      platform: os.platform(),
      hostname: os.hostname()
    };
  } catch (err) {
    return {
      available: false,
      error: String(err?.message || err)
    };
  }
}

/**
 * Snapshot der aktuellen CPU-Zeiten für präzise Auslastungsberechnung
 * @returns {object} CPU-Zeiten Snapshot
 */
export function getCpuTimesSnapshot() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  return { idle: totalIdle, total: totalTick };
}

/**
 * Berechnet CPU-Auslastung zwischen zwei Snapshots
 * @param {object} startSnapshot - Start-Snapshot von getCpuTimesSnapshot()
 * @param {object} endSnapshot - End-Snapshot von getCpuTimesSnapshot()
 * @returns {number|null} CPU-Auslastung in Prozent
 */
export function calculateCpuUsage(startSnapshot, endSnapshot) {
  const idleDiff = endSnapshot.idle - startSnapshot.idle;
  const totalDiff = endSnapshot.total - startSnapshot.total;

  if (totalDiff === 0) return null;

  return Math.round((1 - idleDiff / totalDiff) * 100);
}

/**
 * Sammelt System-Metriken für einen Zeitstempel
 * @param {number} timestamp - Zeitstempel in ms seit Test-Start
 * @param {object} previousCpuSnapshot - Vorheriger CPU-Snapshot für präzise Berechnung
 * @returns {object} Metriken mit Zeitstempel
 */
export function collectSystemMetrics(timestamp, previousCpuSnapshot = null) {
  const currentSnapshot = getCpuTimesSnapshot();

  // CPU-Auslastung berechnen (präzise wenn vorheriger Snapshot verfügbar)
  let cpuUsagePercent = null;
  if (previousCpuSnapshot) {
    cpuUsagePercent = calculateCpuUsage(previousCpuSnapshot, currentSnapshot);
  } else {
    // Fallback: Instantane Berechnung (weniger präzise)
    const status = getSystemStatus();
    cpuUsagePercent = status.available ? status.cpu.usagePercent : null;
  }

  // RAM-Informationen
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryMb = Math.round((totalMemoryBytes - freeMemoryBytes) / (1024 * 1024));
  const totalMemoryMb = Math.round(totalMemoryBytes / (1024 * 1024));

  return {
    timestamp,
    cpuUsagePercent,
    memoryUsedMb: usedMemoryMb,
    memoryTotalMb: totalMemoryMb,
    _cpuSnapshot: currentSnapshot // Für nächste Messung
  };
}
