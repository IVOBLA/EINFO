// C:\kanban\chatbot\server\logger.js
// Zentrales Logging inkl. separater LLM-Logdatei

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

// Allgemeines Log (Info/Debug/Error)
const baseDate = new Date().toISOString().slice(0, 10);
const logFilePath = path.join(logDirAbs, `chatbot-${baseDate}.log`);

// Spezielle LLM-Logdatei (Prompts + Antworten)
const llmLogFilePath = path.join(logDirAbs, `llm-${baseDate}.log`);

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

// NEU: spezielles Logging für alle LLM-Prompts und -Antworten
export function logLLMExchange(entry) {
  const ts = new Date().toISOString();
  const payload = {
    ts,
    type: "LLM",
    // z.B. "request" oder "response"
    phase: entry.phase || "unknown",
    model: entry.model || null,
    // komplettes Material
    systemPrompt: entry.systemPrompt || null,
    userPrompt: entry.userPrompt || null,
    rawResponse: entry.rawResponse || null,
    parsedResponse: entry.parsedResponse || null,
    extra: entry.extra || null
  };

  const line = JSON.stringify(payload) + "\n";

  // In eigener LLM-Logdatei speichern
  fsPromises.appendFile(llmLogFilePath, line).catch(() => {
    // Im Fehlerfall nichts tun, damit die App nicht abstürzt
  });
}

function writeLog(level, msg, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    extra: extra ?? null
  };

  const line = JSON.stringify(entry) + "\n";
  // Kurz auf stdout für schnelle Sichtbarkeit
  process.stdout.write(`[${entry.level}] ${entry.ts} ${entry.msg}\n`);

  fsPromises.appendFile(logFilePath, line).catch(() => {
    // Ignorieren, wenn Logging-Disk voll etc.
  });
}
