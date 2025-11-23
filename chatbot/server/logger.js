import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDirAbs = path.resolve(__dirname, CONFIG.logDir);
if (!fs.existsSync(logDirAbs)) {
  fs.mkdirSync(logDirAbs, { recursive: true });
}

const logFilePath = path.join(
  logDirAbs,
  `chatbot-${new Date().toISOString().slice(0, 10)}.log`
);

export function logInfo(msg, extra) {
  writeLog("INFO", msg, extra);
}

export function logError(msg, extra) {
  writeLog("ERROR", msg, extra);
}

export function logDebug(msg, extra) {
  if (!CONFIG.enableDebugLogging) return;
  writeLog("DEBUG", msg, extra);
}

function writeLog(level, msg, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    extra: extra ?? null
  };

  const line = JSON.stringify(entry) + "\n";
  process.stdout.write(`[${entry.level}] ${entry.ts} ${entry.msg}\n`);
  fsPromises.appendFile(logFilePath, line).catch(() => {
    // Ignorieren, wenn Logging-Disk voll etc.
  });
}
