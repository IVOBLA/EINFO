// chatbot/server/json_sanitizer.js
// Robustes Extrahieren und Reparieren von JSON aus LLM-Antworten

/**
 * Entfernt Llama/Mixtral-spezifische Artefakte
 */
function stripLlamaArtifacts(text) {
  if (typeof text !== "string") return "";

  let cleaned = text;

  // Markdown-Codeblöcke entfernen
  cleaned = cleaned.replace(/```json\s*/gi, "");
  cleaned = cleaned.replace(/```\s*/g, "");

  // Llama/Mixtral Tokens entfernen
  const llamaTokens = [
    "<s>",
    "</s>",
    "<|begin_of_text|>",
    "<|end_of_text|>",
    "<|eot_id|>",
    "<|eom_id|>",
    "<|start_header_id|>",
    "<|end_header_id|>",
    "[INST]",
    "[/INST]",
    "<<SYS>>",
    "<</SYS>>"
  ];

  for (const token of llamaTokens) {
    cleaned = cleaned.split(token).join("");
  }

  return cleaned;
}

/**
 * Versucht häufige JSON-Fehler zu reparieren
 */
function repairCommonJsonErrors(text) {
  if (typeof text !== "string") return text;
  
  let repaired = text;
  
  // Trailing Commas vor } oder ] entfernen
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  
  // Doppelte Kommas entfernen
  repaired = repaired.replace(/,\s*,/g, ",");
  
  // NaN und Infinity durch null ersetzen
  repaired = repaired.replace(/:\s*NaN\b/g, ": null");
  repaired = repaired.replace(/:\s*Infinity\b/g, ": null");
  repaired = repaired.replace(/:\s*-Infinity\b/g, ": null");
  
  // Unescapte Newlines in Strings reparieren (häufig bei Llama)
  repaired = repaired.replace(/([^\\])\\n(?!["\s\]}])/g, "$1\\\\n");
  
  // Fehlende Kommas zwischen Objekten in Arrays
  repaired = repaired.replace(/\}(\s*)\{/g, "},$1{");
  
  return repaired;
}

/**
 * Validiert die Struktur eines Operations-JSON
 */
export function validateOperationsJson(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, error: "Kein Objekt" };
  }
  
  if (!parsed.operations || typeof parsed.operations !== "object") {
    return { valid: false, error: "operations fehlt" };
  }
  
  const ops = parsed.operations;
  
  // Board prüfen
  if (ops.board) {
    if (ops.board.createIncidentSites && !Array.isArray(ops.board.createIncidentSites)) {
      return { valid: false, error: "createIncidentSites ist kein Array" };
    }
    if (ops.board.updateIncidentSites && !Array.isArray(ops.board.updateIncidentSites)) {
      return { valid: false, error: "updateIncidentSites ist kein Array" };
    }
  }
  
  // Aufgaben prüfen
  if (ops.aufgaben) {
    if (ops.aufgaben.create && !Array.isArray(ops.aufgaben.create)) {
      return { valid: false, error: "aufgaben.create ist kein Array" };
    }
    if (ops.aufgaben.update && !Array.isArray(ops.aufgaben.update)) {
      return { valid: false, error: "aufgaben.update ist kein Array" };
    }
  }
  
  // Protokoll prüfen
  if (ops.protokoll) {
    if (ops.protokoll.create && !Array.isArray(ops.protokoll.create)) {
      return { valid: false, error: "protokoll.create ist kein Array" };
    }
  }
  
  return { valid: true };
}

/**
 * Extrahiert ein JSON-Objekt aus einem beliebigen Text
 * Multi-Stage Fallback:
 * 1. Direkter Parse
 * 2. Nach Artefakt-Entfernung
 * 3. Bracket-Matching
 * 4. Mit Reparatur
 */
export function extractJsonObject(text) {
  if (typeof text !== "string") return null;

  // Stage 1: Direkter Parse
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // weiter
  }

  // Stage 2: Nach Artefakt-Entfernung
  const cleaned = stripLlamaArtifacts(trimmed).trim();
  
  try {
    return JSON.parse(cleaned);
  } catch {
    // weiter
  }

  // Stage 3: Erstes JSON-Objekt via Bracket-Matching finden
  const startIndex = cleaned.indexOf("{");
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === "\\") {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") depth--;

    if (depth === 0) {
      const candidate = cleaned.slice(startIndex, i + 1);
      
      // Direkter Parse-Versuch
      try {
        return JSON.parse(candidate);
      } catch {
        // Stage 4: Mit Reparatur versuchen
        try {
          const repaired = repairCommonJsonErrors(candidate);
          return JSON.parse(repaired);
        } catch {
          // Weitersuchen nach nächstem Objekt
        }
      }
    }
  }

  // Letzter Versuch: Gesamten bereinigten Text reparieren
  try {
    const repaired = repairCommonJsonErrors(cleaned);
    const start = repaired.indexOf("{");
    if (start !== -1) {
      const end = repaired.lastIndexOf("}");
      if (end > start) {
        return JSON.parse(repaired.slice(start, end + 1));
      }
    }
  } catch {
    // Fehlgeschlagen
  }

  return null;
}
