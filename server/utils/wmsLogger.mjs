import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.resolve(__dirname, "..", "logs");
const LOG_FILE = path.join(logsDir, "wms.log");

const truthy = new Set(["1", "true", "yes", "y", "on"]);
const rawDebug = process.env.WMS_Debug ?? process.env.WMS_DEBUG ?? "";
export const isWmsDebugEnabled = truthy.has(String(rawDebug).trim().toLowerCase());

async function appendLogLine(line) {
  try {
    await mkdir(logsDir, { recursive: true });
    await appendFile(LOG_FILE, `${line}\n`, "utf8");
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error
      ? error.message
      : String(error);
    console.error(`[WMS LOG ERROR] ${message}`);
  }
}

export function logWmsRequest(req) {
  if (!isWmsDebugEnabled) return;
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.socket?.remoteAddress || "-";
  const method = req.method || "GET";
  const url = req.originalUrl || req.url || "/";
  let query = "";
  try {
    if (req.query && Object.keys(req.query).length > 0) {
      query = ` ${JSON.stringify(req.query)}`;
    }
  } catch {
    query = "";
  }
  appendLogLine(`${timestamp} ${ip} ${method} ${url}${query}`);
}

export function wmsLogMiddleware(req, _res, next) {
  logWmsRequest(req);
  next();
}
