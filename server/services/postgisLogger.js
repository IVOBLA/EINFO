/**
 * PostGIS Logger
 * Ring-buffer in memory + optional persistent JSONL append to server/logs/postgis.log.
 */
import fs from "fs/promises";
import path from "path";

const RING_SIZE = 500;
const ring = [];
let logFilePath = "";

export function initLogger(serverRoot) {
  logFilePath = path.join(serverRoot, "logs", "postgis.log");
}

function maskValue(value, config) {
  if (!config?.maskSensitive) return value;
  if (typeof value !== "string") return value;
  // Mask anything that looks like a password or secret in connection strings
  return value.replace(/password\s*=\s*'[^']*'/gi, "password='***'")
    .replace(/password\s*=\s*[^\s;]+/gi, "password=***");
}

function maskSql(sql, config) {
  if (!sql) return sql;
  return maskValue(sql, config);
}

function truncateRows(rows, max = 3) {
  if (!Array.isArray(rows)) return { rows: [], truncated: false };
  if (rows.length <= max) return { rows, truncated: false };
  return { rows: rows.slice(0, max), truncated: true };
}

export function createLogEntry({ action, sql, durationMs, rowCount, success, error, rows, config, user }) {
  const entry = {
    timestamp: new Date().toISOString(),
    requestId: Math.random().toString(36).slice(2, 10),
    user: user || "unknown",
    action,
    durationMs: durationMs ?? null,
    rowCount: rowCount ?? null,
    success: !!success,
  };

  if (config?.logSql && sql) {
    entry.sql = maskSql(sql, config);
  }

  if (!success && error) {
    if (config?.logErrors !== false) {
      entry.error = typeof error === "string" ? error : (error.message || String(error));
      // Never log passwords in errors
      entry.error = maskValue(entry.error, config);
    }
  }

  if (success && config?.logResponse && rows) {
    const { rows: sample, truncated } = truncateRows(rows);
    entry.sampleRows = sample;
    entry.truncated = truncated;
  }

  return entry;
}

export async function appendLog(entry, config) {
  // Always push to ring buffer
  ring.push(entry);
  while (ring.length > RING_SIZE) ring.shift();

  // Persist if configured
  if (config?.persistLogs) {
    try {
      const dir = path.dirname(logFilePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(logFilePath, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      console.error("[postgisLogger] Failed to persist log:", err.message);
    }
  }
}

export function getRecentLogs(limit = 200) {
  const n = Math.min(Math.max(1, Number(limit) || 200), RING_SIZE);
  return ring.slice(-n);
}
