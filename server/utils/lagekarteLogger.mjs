/**
 * Lagekarte-Logger
 * Dediziertes Logging für /lagekarte SSO-Proxy Requests.
 *
 * Security (Option A Masking):
 * - Username/Passwort: max 2 Zeichen vorne + "***" + max 2 Zeichen hinten + (len=...)
 * - Keine vollständigen Credentials, keine Tokens im Log
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import { getLogDirCandidates } from "./logDirectories.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log directory candidates (same pattern as main server)
const LOG_DIR_CANDIDATES = [
  ...getLogDirCandidates(),
  path.join(__dirname, "../logs"),
  path.join(__dirname, "../../data/logs"),
];

const LAGEKARTE_LOG_FILE = "Lagekarte.log";
let activeLogDir = null;

/**
 * Ensure directory exists
 */
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a log line to the Lagekarte log file.
 * Tries multiple log directories, uses first successful one.
 */
async function appendLogLine(line) {
  const candidates = activeLogDir
    ? [activeLogDir, ...LOG_DIR_CANDIDATES.filter((d) => d !== activeLogDir)]
    : LOG_DIR_CANDIDATES;

  for (const dir of candidates) {
    try {
      await ensureDir(dir);
      const filePath = path.join(dir, LAGEKARTE_LOG_FILE);
      await fs.appendFile(filePath, line + "\n", "utf8");
      activeLogDir = dir;
      return;
    } catch {
      // Try next directory
    }
  }
  // Fallback to console if all directories fail
  console.error("[LagekarteLogger] Could not write to log file:", line);
}

// ============================================================================
// Option A Masking: max 2 chars head + "***" + max 2 chars tail + (len=...)
// ============================================================================

/**
 * Masks a string according to Option A:
 * - max 2 chars at start
 * - "***"
 * - max 2 chars at end (only if length > 4)
 * - (len=...) suffix
 *
 * Examples:
 * - "admin" -> "ad***in (len=5)"
 * - "a" -> "a*** (len=1)"
 * - "ab" -> "ab*** (len=2)"
 * - "abcd" -> "ab*** (len=4)"
 */
export function maskA(s) {
  if (s === null || s === undefined || s === "") {
    return "";
  }
  const str = String(s);
  const len = str.length;
  const head = str.slice(0, Math.min(2, len));
  const tail = len > 4 ? str.slice(len - 2) : "";
  return `${head}***${tail} (len=${len})`;
}

// ============================================================================
// Sanitize Response Snippet: Remove potential secrets
// ============================================================================

/**
 * Sanitizes a response snippet to remove potential secrets.
 * - Truncates to max 200 chars
 * - Replaces sensitive patterns (password, pass, token, etc.)
 */
export function sanitizeSnippet(str) {
  if (!str) return "";
  let s = String(str);

  // Truncate to 200 chars
  if (s.length > 200) {
    s = s.slice(0, 200) + "...";
  }

  // Replace potential secrets (case-insensitive)
  // Pattern: key=value or "key":"value" style
  s = s.replace(/password\s*[=:]\s*["']?[^"'\s&]+["']?/gi, "password=***");
  s = s.replace(/pass\s*[=:]\s*["']?[^"'\s&]+["']?/gi, "pass=***");
  s = s.replace(/p\s*=\s*["']?[^"'\s&]+["']?/gi, "p=***");
  s = s.replace(/u\s*=\s*["']?[^"'\s&]+["']?/gi, "u=***");
  s = s.replace(/token\s*[=:]\s*["']?[^"'\s&]+["']?/gi, "token=***");
  s = s.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"***"');
  s = s.replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"***"');
  s = s.replace(/"pass"\s*:\s*"[^"]*"/gi, '"pass":"***"');

  return s;
}

// ============================================================================
// Request ID Generator
// ============================================================================

/**
 * Generates a random request ID (6-10 chars).
 */
export function generateRequestId() {
  return crypto.randomBytes(4).toString("hex");
}

// ============================================================================
// Main Logging Function
// ============================================================================

/**
 * Log a Lagekarte event.
 *
 * @param {"INFO"|"WARN"|"ERROR"} level - Log level
 * @param {string} msg - Short message describing the event
 * @param {object} meta - Metadata object (rid, path, phase, elapsedMs, httpStatus, etc.)
 *
 * Allowed meta fields:
 * - rid: Request ID
 * - path: Request path
 * - phase: Current phase (start, creds_load, master_locked, token_cache, login_request, login_failed, login_parse_failed, login_ok, proxy_failed)
 * - elapsedMs: Elapsed time in milliseconds
 * - httpStatus: HTTP status code
 * - remoteUrl: Remote URL (without sensitive query params)
 * - credsPresent: boolean
 * - masterLocked: boolean
 * - tokenCacheHit: boolean
 * - username_masked: Masked username (Option A)
 * - password_masked: Masked password (Option A)
 * - responseSnippet: Sanitized response snippet (max 200 chars)
 * - error: Error message (sanitized)
 *
 * FORBIDDEN in meta:
 * - username, password, token (full or partial beyond Option A)
 */
export async function logLagekarte(level, msg, meta = {}) {
  const ts = new Date().toISOString();

  // Build log entry
  const entry = {
    ts,
    level,
    msg,
    ...meta,
  };

  // JSON format, one line per event
  const line = JSON.stringify(entry);

  await appendLogLine(line);

  // Also log to console for immediate visibility during debugging
  const consoleMsg = `[Lagekarte] [${level}] ${msg}`;
  if (level === "ERROR") {
    console.error(consoleMsg, meta);
  } else if (level === "WARN") {
    console.warn(consoleMsg, meta);
  } else {
    console.log(consoleMsg, meta);
  }
}

// Convenience functions
export const logLagekarteInfo = (msg, meta) => logLagekarte("INFO", msg, meta);
export const logLagekarteWarn = (msg, meta) => logLagekarte("WARN", msg, meta);
export const logLagekarteError = (msg, meta) => logLagekarte("ERROR", msg, meta);

/**
 * Sanitize a URL for logging (remove token query parameter).
 */
export function sanitizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.searchParams.has("token")) {
      u.searchParams.set("token", "***");
    }
    return u.href;
  } catch {
    // If URL parsing fails, do basic replacement
    return String(url).replace(/token=[^&]+/gi, "token=***");
  }
}

export default {
  maskA,
  sanitizeSnippet,
  sanitizeUrl,
  generateRequestId,
  logLagekarte,
  logLagekarteInfo,
  logLagekarteWarn,
  logLagekarteError,
};
