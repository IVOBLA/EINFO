// chatbot/server/logger.js

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logs-Verzeichnis relativ zum Server-Verzeichnis
const LOG_DIR = path.resolve(__dirname, "../logs");

// Stelle sicher, dass das Verzeichnis existiert
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}


// Hauptlog & LLM-Logs (feste Dateinamen)
const MAIN_LOG_FILE = path.join(LOG_DIR, "chatbot.log");
const LLM_REQUEST_LOG_FILE = path.join(LOG_DIR, "LLM_request.log");
const LLM_RESPONSE_LOG_FILE = path.join(LOG_DIR, "LLM_response.log");


function appendLine(filePath, line) {
  return fsPromises.appendFile(filePath, line + "\n").catch((err) => {
    // Im Fehlerfall wenigstens auf der Konsole ausgeben
    console.error("[LOGGER] Fehler beim Schreiben in Logdatei:", filePath, err);
  });
}

// --------- Standard-Logs (Info / Debug / Error) ---------------------------

function baseEntry(level, msg, extra) {
  return {
    ts: new Date().toISOString(),
    level,
    msg,
    extra: extra || null
  };
}

export function logInfo(msg, extra) {
  const entry = baseEntry("INFO", msg, extra);
  console.log(`[INFO] ${entry.ts} ${msg}`, extra || "");
  return appendLine(MAIN_LOG_FILE, JSON.stringify(entry));
}

export function logDebug(msg, extra) {
  const entry = baseEntry("DEBUG", msg, extra);
  console.debug(`[DEBUG] ${entry.ts} ${msg}`, extra || "");
  return appendLine(MAIN_LOG_FILE, JSON.stringify(entry));
}

export function logError(msg, extra) {
  const entry = baseEntry("ERROR", msg, extra);
  console.error(`[ERROR] ${entry.ts} ${msg}`, extra || "");
  return appendLine(MAIN_LOG_FILE, JSON.stringify(entry));
}

// --------- LLM-Logs -------------------------------------------------------
//
// WICHTIG: Hier steht ALLES, was an das LLM gesendet wird und zurückkommt.
// - rawRequest:  exakt der JSON-Body, der an /api/chat gesendet wird (string)
// - rawResponse: exakt der Text/Stream, der vom LLM zurückkommt (string)
// - parsedResponse: evtl. geparstes JSON (oder null)
// Nichts wird verändert, beschnitten oder anonymisiert.

// --------- LLM-Logs -------------------------------------------------------
//
// Request und Response werden in getrennte Dateien geschrieben:
//
// - LLM_request.log: System-/User-Prompt + rawRequest
// - LLM_response.log: nur rawResponse + parsedResponse
//   (KEIN rawRequest/systemPrompt/userPrompt mehr im Response-Log)

export function logLLMExchange(payload = {}) {
  const phase = payload.phase || "unknown";

  const base = {
    ts: new Date().toISOString(),
    type: "LLM",
    phase,
    model: payload.model || null,
    extra: payload.extra || null
  };

  // REQUEST-LOG
  if (phase === "request") {
    const entry = {
      ...base,
      systemPrompt: payload.systemPrompt || null,
      userPrompt: payload.userPrompt || null,
      rawRequest: payload.rawRequest || null
    };
    return appendLine(LLM_REQUEST_LOG_FILE, JSON.stringify(entry));
  }

  // RESPONSE-/ERROR-/STREAM-LOG
  const entry = {
    ...base,
    // Wichtig: hier KEINE Request-Daten mehr mitschleppen
    rawResponse: payload.rawResponse ?? null,
    parsedResponse: payload.parsedResponse ?? null
  };

  return appendLine(LLM_RESPONSE_LOG_FILE, JSON.stringify(entry));
}


// Optional: alte API beibehalten (falls irgendwo noch verwendet)
export function logLLMRequest(model, rawRequest) {
  return logLLMExchange({
    phase: "request",
    model,
    rawRequest,
    rawResponse: null,
    parsedResponse: null
  });
}

export function logLLMResponse(model, rawResponse, parsedResponse = null) {
  return logLLMExchange({
    phase: "response",
    model,
    rawRequest: null,
    rawResponse,
    parsedResponse
  });
}

export default {
  logInfo,
  logDebug,
  logError,
  logLLMExchange,
  logLLMRequest,
  logLLMResponse
};
