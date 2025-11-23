// C:\kanban\chatbot\server\llm_client.js
// Spricht mit dem LLM (Ollama) und loggt alle Prompts/Antworten
// Nutzt das globale fetch von Node (ab Node 18 verfügbar).

import { CONFIG } from "./config.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { retrieveContextChunks } from "./rag_engine.js";
import { logDebug, logError, logLLMExchange } from "./logger.js";

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

  // LLM-Request im allgemeinen Log
  logDebug("LLM-Request wird gesendet", {
    model: CONFIG.model
  });

  // LLM-Request zusätzlich vollständig in LLM-Logdatei
  logLLMExchange({
    phase: "request",
    model: CONFIG.model,
    systemPrompt,
    userPrompt,
    rawResponse: null,
    parsedResponse: null,
    extra: {
      from: "callLLMWithRAG",
      note: "LLM request with system+user prompt"
    }
  });

  // Hier verwenden wir das globale fetch von Node.js (kein node-fetch mehr nötig)
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

    // LLM-Fehler ebenfalls im LLM-Log vermerken
    logLLMExchange({
      phase: "response_error",
      model: CONFIG.model,
      systemPrompt,
      userPrompt,
      rawResponse: text,
      parsedResponse: null,
      extra: {
        httpStatus: resp.status,
        httpStatusText: resp.statusText
      }
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

  // Vollständige LLM-Antwort im LLM-Log
  logLLMExchange({
    phase: "response",
    model: CONFIG.model,
    systemPrompt,
    userPrompt,
    rawResponse: content,
    parsedResponse: parsed,
    extra: {
      from: "callLLMWithRAG",
      note: "Parsed LLM JSON response"
    }
  });

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
        // Fehler wird geworfen, damit der Aufrufer es sieht
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
