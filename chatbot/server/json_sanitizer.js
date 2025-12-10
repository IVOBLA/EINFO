// chatbot/server/json_sanitizer.js
// Robustes Extrahieren eines JSON-Objekts aus LLM-Antworten

/**
 * Versucht, ein JSON-Objekt aus einem beliebigen Text zu extrahieren.
 * - Erst normaler JSON.parse
 * - Fallback: Suche nach erstem schließenden Block anhand von Klammer-Balancing
 * - Gibt bei Fehlschlag null zurück
 */
function stripLlamaArtifacts(text) {
  if (typeof text !== "string") return "";

  let cleaned = text;

  cleaned = cleaned.replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, "$1");

  const llamaTokens = [
    "<s>",
    "</s>",
    "<|begin_of_text|>",
    "<|end_of_text|>",
    "<|eot_id|>",
    "<|eom_id|>",
    "<|start_header_id|>",
    "<|end_header_id|>"
  ];

  for (const token of llamaTokens) {
    cleaned = cleaned.split(token).join("");
  }

  return cleaned;
}

export function extractJsonObject(text) {
  if (typeof text !== "string") return null;

  const trimmed = stripLlamaArtifacts(text).trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // weiter unten Fallback
  }

  const startIndex = trimmed.indexOf("{");
  if (startIndex === -1) return null;

  let depth = 0;
  for (let i = startIndex; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;

    if (depth === 0) {
      const candidate = trimmed.slice(startIndex, i + 1);
      try {
        return JSON.parse(candidate);
      } catch (error) {
        // nächster Versuch
      }
    }
  }

  return null;
}
