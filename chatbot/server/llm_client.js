import fetch from "node-fetch";
import { CONFIG } from "./config.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { retrieveContextChunks } from "./rag_engine.js";
import { logDebug, logError } from "./logger.js";

export async function callLLMWithRAG({ stateBefore, einfoData }) {
  const contextChunks = await retrieveContextChunks({ stateBefore, einfoData });

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ stateBefore, einfoData, contextChunks });

  const body = {
    model: CONFIG.model,
    stream: false,
    options: {
      temperature: CONFIG.defaultTemperature,
      seed: CONFIG.defaultSeed
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  logDebug("LLM-Request wird gesendet", {
    model: CONFIG.model
  });

  const resp = await fetch(`${CONFIG.llmBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    logError("LLM-HTTP-Fehler", {
      status: resp.status,
      statusText: resp.statusText,
      body: text
    });
    throw new Error(`LLM error: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json();
  // Ollama: { message: { content: "..." }, ... }
  const content =
    json.message?.content ??
    json.choices?.[0]?.message?.content ??
    "";

  logDebug("LLM-Rohantwort erhalten", {
    length: content.length
  });

  const parsed = safeParseJSON(content);
  return parsed;
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    // Versuchen, den ersten JSON-Block herauszuziehen
    const match = text.match(/\{[\s\S]*\}$/m);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        logError("Fehler beim JSON-Parse (extrahierter Block)", {
          error: String(e2),
          snippet: match[0].slice(0, 200)
        });
        throw e2;
      }
    } else {
      logError("LLM-Antwort enthielt kein parsebares JSON", {
        snippet: text.slice(0, 200)
      });
      throw new Error("LLM-Antwort ist kein gültiges JSON");
    }
  }
}
