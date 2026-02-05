import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import { getLogDirCandidates } from "./logDirectories.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR_CANDIDATES = [
  ...getLogDirCandidates(),
  path.join(__dirname, "../logs"),
  path.join(__dirname, "../../data/logs"),
];

const LAGEKARTE_LOG_FILE = "Lagekarte.log";
const LAGEKARTE_TRAFFIC_LOG_FILE = "LagekarteTraffic.log";
const MAX_BODY_LOG_BYTES = 512 * 1024;
const BINARY_HASH_BYTES = 64 * 1024;
const BINARY_PREVIEW_BYTES = 256;

let activeLogDir = null;

const SENSITIVE_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie", "x-auth-token"]);
const SENSITIVE_QUERY_KEYS = /^(token|auth|session|sid)$/i;
const SENSITIVE_BODY_KEYS = /(token|auth|authorization|bearer|session|sid|pw|password|pass|user|login-token|auth_token|access_token|refresh_token)/i;

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function appendLine(fileName, line) {
  const candidates = activeLogDir
    ? [activeLogDir, ...LOG_DIR_CANDIDATES.filter((d) => d !== activeLogDir)]
    : LOG_DIR_CANDIDATES;

  for (const dir of candidates) {
    try {
      await ensureDir(dir);
      await fs.appendFile(path.join(dir, fileName), line + "\n", "utf8");
      activeLogDir = dir;
      return;
    } catch {
      // Try next directory
    }
  }
  console.error(`[LagekarteLogger] Could not write to ${fileName}:`, line);
}

export function generateRequestId() {
  return crypto.randomBytes(4).toString("hex");
}

export function generateUpstreamId() {
  return crypto.randomBytes(6).toString("hex");
}

export function maskA(s) {
  if (s === null || s === undefined || s === "") return "";
  const str = String(s);
  const len = str.length;
  const head = str.slice(0, Math.min(2, len));
  const tail = len > 4 ? str.slice(len - 2) : "";
  return `${head}***${tail} (len=${len})`;
}

export function sanitizeSnippet(str) {
  if (!str) return "";
  let s = String(str);
  if (s.length > 200) s = s.slice(0, 200) + "...";
  return sanitizeBody(s, "text/plain");
}

export function sanitizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://www.lagekarte.info");
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) {
        parsed.searchParams.set(key, "***");
      }
    }
    return parsed.toString();
  } catch {
    return String(url)
      .replace(/([?&])(token|auth|session|sid)=([^&#]*)/gi, "$1$2=***")
      .replace(/(login-token=)[^;\s]+/gi, "$1***");
  }
}

function sanitizeCookieHeaderValue(value) {
  if (!value) return "***";
  const items = String(value).split(";").map((part) => part.trim());
  return items.map((part) => {
    const eq = part.indexOf("=");
    if (eq === -1) return part;
    const name = part.slice(0, eq).trim();
    return `${name}=***`;
  }).join("; ");
}

function sanitizeSetCookieHeaderValue(value) {
  if (!value) return "***";
  return String(value)
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => {
      const trimmed = cookie.trim();
      const [first, ...rest] = trimmed.split(";");
      const eq = first.indexOf("=");
      if (eq === -1) return trimmed;
      const name = first.slice(0, eq).trim();
      return [`${name}=***`, ...rest].join(";");
    })
    .join(", ");
}

export function sanitizeHeaders(headersObj = {}) {
  const out = {};
  const entries = headersObj instanceof Headers
    ? [...headersObj.entries()]
    : Object.entries(headersObj || {});

  for (const [rawKey, rawValue] of entries) {
    if (rawValue == null) continue;
    const key = String(rawKey);
    const lower = key.toLowerCase();
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);

    if (!SENSITIVE_HEADER_NAMES.has(lower)) {
      out[key] = value;
      continue;
    }

    if (lower === "set-cookie") {
      out[key] = sanitizeSetCookieHeaderValue(value);
    } else if (lower === "cookie") {
      out[key] = sanitizeCookieHeaderValue(value);
    } else {
      out[key] = "***";
    }
  }

  return out;
}

function redactDeep(value) {
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_BODY_KEYS.test(k) ? "***" : redactDeep(v);
    }
    return out;
  }
  return value;
}

function sanitizePlainTextBody(text) {
  return String(text)
    .replace(/("(?:token|auth_token|login-token|access_token|refresh_token|bearer|session|sid|pw|password|pass|user|authorization)"\s*:\s*")[^"]*(")/gi, "$1***$2")
    .replace(/((?:token|auth|session|sid|pw|password|pass|user|login-token)\s*=\s*)[^&\s"';]+/gi, "$1***")
    .replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***")
    .replace(/(login-token=)[^;\s]+/gi, "$1***");
}

export function sanitizeBody(bodyText, contentType = "") {
  if (bodyText == null) return "";
  const text = typeof bodyText === "string" ? bodyText : String(bodyText);
  const type = String(contentType || "").toLowerCase();

  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(redactDeep(parsed));
    } catch {
      return sanitizePlainTextBody(text);
    }
  }

  if (type.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    for (const key of [...params.keys()]) {
      if (SENSITIVE_BODY_KEYS.test(key)) params.set(key, "***");
    }
    return params.toString();
  }

  return sanitizePlainTextBody(text);
}

export function isTextBasedContentType(contentType = "") {
  const type = String(contentType || "").toLowerCase();
  return [
    "application/json",
    "application/javascript",
    "application/x-javascript",
    "application/x-www-form-urlencoded",
    "application/xml",
    "application/xhtml+xml",
    "text/",
    "image/svg+xml",
  ].some((token) => type.includes(token));
}

export function limitLoggedBody(bodyText, maxBytes = MAX_BODY_LOG_BYTES) {
  const source = bodyText == null ? "" : String(bodyText);
  const buffer = Buffer.from(source, "utf8");
  if (buffer.length <= maxBytes) {
    return { body: source, truncated: false, totalBytes: buffer.length };
  }
  return {
    body: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true,
    totalBytes: buffer.length,
  };
}

export function summarizeBinaryBody(buffer, contentType = "", contentLength = null) {
  const binary = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const firstChunk = binary.subarray(0, BINARY_HASH_BYTES);
  return {
    contentType,
    contentLength: contentLength ?? binary.length,
    sha256First64kb: crypto.createHash("sha256").update(firstChunk).digest("hex"),
    firstBytesBase64: binary.subarray(0, BINARY_PREVIEW_BYTES).toString("base64"),
  };
}

export async function logLagekarte(level, msg, meta = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  await appendLine(LAGEKARTE_LOG_FILE, line);
  const consoleMsg = `[Lagekarte] [${level}] ${msg}`;
  if (level === "ERROR") console.error(consoleMsg, meta);
  else if (level === "WARN") console.warn(consoleMsg, meta);
  else console.log(consoleMsg, meta);
}

export async function logLkTraffic(event = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  await appendLine(LAGEKARTE_TRAFFIC_LOG_FILE, line);
}

export const logLagekarteInfo = (msg, meta) => logLagekarte("INFO", msg, meta);
export const logLagekarteWarn = (msg, meta) => logLagekarte("WARN", msg, meta);
export const logLagekarteError = (msg, meta) => logLagekarte("ERROR", msg, meta);

export {
  MAX_BODY_LOG_BYTES,
};

export default {
  maskA,
  sanitizeSnippet,
  sanitizeUrl,
  sanitizeHeaders,
  sanitizeBody,
  isTextBasedContentType,
  limitLoggedBody,
  summarizeBinaryBody,
  generateRequestId,
  generateUpstreamId,
  logLagekarte,
  logLagekarteInfo,
  logLagekarteWarn,
  logLagekarteError,
  logLkTraffic,
  MAX_BODY_LOG_BYTES,
};
