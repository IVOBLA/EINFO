import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { logDirCandidates } from "./logDirectories.mjs";

let activeLogDir = null;
let lastLoggedErrorKey = null;

function getLogFile(dir) {
  return path.join(dir, "WMS_TILES.log");
}

async function writeToLogDir(dir, line) {
  await mkdir(dir, { recursive: true });
  await appendFile(getLogFile(dir), `${line}\n`, "utf8");
}

const truthy = new Set(["1", "true", "yes", "y", "on"]);
const rawDebug = process.env.WMS_Debug ?? process.env.WMS_DEBUG ?? "";
export const isWmsDebugEnabled = truthy.has(String(rawDebug).trim().toLowerCase());

async function appendLogLine(line) {
  try {
    const firstChoice = activeLogDir ? [activeLogDir] : [];
    const candidates = [...firstChoice, ...logDirCandidates.filter((dir) => dir !== activeLogDir)];

    for (const dir of candidates) {
      try {
        await writeToLogDir(dir, line);
        activeLogDir = dir;
        lastLoggedErrorKey = null;
        return;
      } catch (error) {
        const message = error && typeof error === "object" && "message" in error
          ? error.message
          : String(error);
        const errorKey = `${dir}:${message}`;
        if (lastLoggedErrorKey !== errorKey) {
          console.error(`[WMS LOG ERROR] ${message} (${dir})`);
          lastLoggedErrorKey = errorKey;
        }
        if (activeLogDir === dir) {
          activeLogDir = null;
        }
      }
    }
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
