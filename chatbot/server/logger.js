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
const PROMPT_COMPOSITION_LOG_FILE = path.join(LOG_DIR, "LLM_prompt_composition.log");


function appendLine(filePath, line) {
  return fsPromises.appendFile(filePath, line + "\n").catch((err) => {
    // Im Fehlerfall wenigstens auf der Konsole ausgeben
    console.error("[LOGGER] Fehler beim Schreiben in Logdatei:", filePath, err);
  });
}

function toPrettyPrintedString(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  return JSON.stringify(value, null, 2);
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

export function logWarn(msg, extra) {
  const entry = baseEntry("WARN", msg, extra);
  console.warn(`[WARN] ${entry.ts} ${msg}`, extra || "");
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

  // REQUEST-LOG (vollständiger Request inkl. Prompts in rawRequest)
  if (phase === "request") {
    const entry = {
      ...base,
      rawRequest: toPrettyPrintedString(payload.rawRequest ?? null)
    };
    const entryText = [
      JSON.stringify(
        {
          ts: entry.ts,
          type: entry.type,
          phase: entry.phase,
          model: entry.model,
          extra: entry.extra
        },
        null,
        2
      ),
      "rawRequest:",
      entry.rawRequest
    ].join("\n");
    return appendLine(LLM_REQUEST_LOG_FILE, entryText);
  }

  // RESPONSE-/ERROR-/STREAM-LOG
  const entry = {
    ...base,
    // Wichtig: hier KEINE Request-Daten mehr mitschleppen
    rawResponse: toPrettyPrintedString(payload.rawResponse ?? null),
    parsedResponse: toPrettyPrintedString(payload.parsedResponse ?? null)
  };

  const entryText = [
    JSON.stringify(
      {
        ts: entry.ts,
        type: entry.type,
        phase: entry.phase,
        model: entry.model,
        extra: entry.extra
      },
      null,
      2
    ),
    "rawResponse:",
    entry.rawResponse,
    "parsedResponse:",
    entry.parsedResponse
  ].join("\n");

  return appendLine(LLM_RESPONSE_LOG_FILE, entryText);
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

// --------- Prompt-Composition-Log ------------------------------------------
//
// Dokumentiert detailliert, welche Regeln angewendet wurden und
// welche Komponenten in den finalen Prompt geflossen sind.
//

/**
 * Loggt die Prompt-Zusammenstellung mit Regel-Debug-Informationen.
 *
 * @param {object} composition - Objekt mit allen Komponenten
 * @param {object} composition.rules - Debug-Info zu angewendeten Regeln
 * @param {object} composition.components - Prompt-Komponenten mit Größen
 * @param {object} composition.filtering - Was wurde gefiltert (vorher/nachher)
 */
export function logPromptComposition(composition = {}) {
  const entry = {
    ts: new Date().toISOString(),
    type: "PROMPT_COMPOSITION",
    ...composition
  };

  // Formatiere als lesbaren Text
  const lines = [
    "═══════════════════════════════════════════════════════════════════════════════",
    `PROMPT-KOMPOSITION @ ${entry.ts}`,
    "═══════════════════════════════════════════════════════════════════════════════",
    ""
  ];

  // Regeln-Übersicht
  if (entry.rules) {
    lines.push("┌─────────────────────────────────────────────────────────────────────────────");
    lines.push("│ ANGEWENDETE FILTERREGELN");
    lines.push("├─────────────────────────────────────────────────────────────────────────────");

    for (const [ruleName, ruleInfo] of Object.entries(entry.rules)) {
      const status = ruleInfo.enabled ? "✅ AKTIV" : "❌ DEAKTIVIERT";
      lines.push(`│ ${ruleName}: ${status}`);
      if (ruleInfo.enabled && ruleInfo.details) {
        lines.push(`│   └─ ${ruleInfo.details}`);
      }
    }
    lines.push("└─────────────────────────────────────────────────────────────────────────────");
    lines.push("");
  }

  // Filterung-Details
  if (entry.filtering) {
    lines.push("┌─────────────────────────────────────────────────────────────────────────────");
    lines.push("│ FILTERUNG (vorher → nachher)");
    lines.push("├─────────────────────────────────────────────────────────────────────────────");

    for (const [category, stats] of Object.entries(entry.filtering)) {
      const before = stats.before ?? "?";
      const after = stats.after ?? "?";
      const filtered = stats.filtered ?? (before - after);
      lines.push(`│ ${category}: ${before} → ${after} (${filtered} gefiltert)`);
      if (stats.reason) {
        lines.push(`│   └─ Grund: ${stats.reason}`);
      }
    }
    lines.push("└─────────────────────────────────────────────────────────────────────────────");
    lines.push("");
  }

  // Prompt-Komponenten
  if (entry.components) {
    lines.push("┌─────────────────────────────────────────────────────────────────────────────");
    lines.push("│ PROMPT-KOMPONENTEN (Zeichen / geschätzte Tokens)");
    lines.push("├─────────────────────────────────────────────────────────────────────────────");

    let totalChars = 0;
    let totalTokens = 0;

    for (const [name, info] of Object.entries(entry.components)) {
      const chars = info.chars ?? 0;
      const tokens = info.tokens ?? Math.ceil(chars / 4);
      const included = info.included !== false;
      const marker = included ? "✓" : "✗";

      lines.push(`│ ${marker} ${name.padEnd(25)} ${String(chars).padStart(6)} chars  (~${String(tokens).padStart(5)} tokens)`);

      if (info.preview) {
        const preview = info.preview.substring(0, 80).replace(/\n/g, "↵");
        lines.push(`│   └─ "${preview}${info.preview.length > 80 ? "..." : ""}"`);
      }

      if (included) {
        totalChars += chars;
        totalTokens += tokens;
      }
    }

    lines.push("├─────────────────────────────────────────────────────────────────────────────");
    lines.push(`│ GESAMT: ${totalChars} chars (~${totalTokens} tokens)`);
    lines.push("└─────────────────────────────────────────────────────────────────────────────");
    lines.push("");
  }

  // JSON-Dump für maschinelle Auswertung
  lines.push("───────────────────────────────────────────────────────────────────────────────");
  lines.push("RAW JSON:");
  lines.push(JSON.stringify(entry, null, 2));
  lines.push("");

  return appendLine(PROMPT_COMPOSITION_LOG_FILE, lines.join("\n"));
}

export default {
  logInfo,
  logDebug,
  logError,
  logLLMExchange,
  logLLMRequest,
  logLLMResponse,
  logPromptComposition
};
