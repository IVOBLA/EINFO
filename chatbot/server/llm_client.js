// chatbot/server/llm_client.js

import { CONFIG } from "./config.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { logDebug, logError, logLLMExchange } from "./logger.js";
import { getKnowledgeContextVector } from "./rag/rag_vector.js";

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const finalOptions = { ...options, signal: controller.signal };

  return fetch(url, finalOptions).finally(() => {
    clearTimeout(id);
  });
}

/** LLM für OPERATIONS (Simulation) */
export async function callLLMForOps({ llmInput }) {
  const { compressedBoard, compressedAufgaben, compressedProtokoll } = llmInput;

  const knowledgeContext = await getKnowledgeContextVector(
    "Stabsarbeit Kat-E Einsatzleiter LdStb Meldestelle S1 S2 S3 S4 S5 S6"
  );

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    llmInput,
    compressedBoard,
    compressedAufgaben,
    compressedProtokoll,
    knowledgeContext
  });

  const body = {
    model: CONFIG.llmChatModel,
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

  const parsed = await doLLMCall(body, "ops");
  return parsed;
}

/** LLM für QA-Chat */
export async function callLLMForChat({ question, stream = false, onToken }) {
  const knowledgeContext = await getKnowledgeContextVector(question);

  const systemPrompt = `
Du bist ein lokaler Feuerwehr-Chatbot für den Bezirks-Einsatzstab.
Du beantwortest Fragen ausschließlich anhand des KnowledgeContext.
Wenn etwas dort nicht steht, sag das ehrlich.
Sprache: Deutsch, kurze, klare Antworten, Feuerwehr-Jargon erlaubt.
Keine personenbezogenen Daten.
`;

  const userPrompt = `
FRAGE:
${question}

KnowledgeContext:
${knowledgeContext || "(kein Knowledge-Kontext verfügbar)"}

Antwort:
- Kurz, präzise, anwendungsnah.
- Wenn nicht geregelt: sag das.
`;

  const body = {
    model: CONFIG.llmChatModel,
    stream,
    options: {
      temperature: CONFIG.defaultTemperature,
      seed: CONFIG.defaultSeed
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const answer = await doLLMCall(body, "chat", onToken);
  return answer;
}

function extractTokenFromStreamPayload(payload) {
  if (typeof payload !== "object" || payload === null) return "";
  const direct = payload.message?.content || payload.delta?.content;
  if (typeof direct === "string") return direct;
  if (typeof payload.response === "string") return payload.response;
  if (typeof payload.output === "string") return payload.output;
  return "";
}

function extractDataText(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "[DONE]") return null;

  if (trimmed.startsWith("data:")) return trimmed.slice(5).trim();

  // Ollama liefert standardmäßig newline-getrennte JSON-Objekte ohne SSE-Präfix
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  return trimmed;
}

function parseStreamBuffer(buffer, processPayload) {
  const parts = buffer.split("\n");
  const remainder = parts.pop();

  for (const part of parts) {
    const payloadText = extractDataText(part);
    if (!payloadText) continue;
    try {
      processPayload(JSON.parse(payloadText));
    } catch (err) {
      logError("LLM-Stream-Parsefehler", { error: String(err), line: payloadText });
    }
  }

  return remainder;
}

async function doLLMCall(body, phaseLabel, onToken) {
  const systemPrompt = body.messages[0]?.content || "";
  const userPrompt = body.messages[1]?.content || "";
  const serializedRequest = JSON.stringify(body);

  logDebug("LLM-Request", { model: body.model, phase: phaseLabel });

  logLLMExchange({
    phase: "request",
    model: body.model,
    systemPrompt,
    userPrompt,
    rawRequest: serializedRequest,
    rawResponse: null,
    parsedResponse: null,
    extra: { phase: phaseLabel }
  });

  let resp;
  try {
    resp = await fetchWithTimeout(
      `${CONFIG.llmBaseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializedRequest
      },
      CONFIG.llmRequestTimeoutMs
    );
  } catch (error) {
    logError("LLM-HTTP-Fehler", { error: String(error), phase: phaseLabel });
    throw error;
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    logError("LLM-HTTP-Fehler", {
      status: resp.status,
      statusText: resp.statusText,
      body: t
    });
    logLLMExchange({
      phase: "response_error",
      model: body.model,
      systemPrompt,
      userPrompt,
      rawRequest: serializedRequest,
      rawResponse: t,
      parsedResponse: null,
      extra: {
        httpStatus: resp.status,
        httpStatusText: resp.statusText,
        phase: phaseLabel
      }
    });
    throw new Error(`LLM error: ${resp.status} ${resp.statusText}`);
  }

  if (body.stream) {
    const reader = resp.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      throw new Error("Keine Streaming-Quelle für LLM verfügbar");
    }

    let buffer = "";
    let content = "";
    let rawStream = "";

    const processPayload = (json) => {
      const token = extractTokenFromStreamPayload(json);
      if (token) {
        content += token;
        onToken?.(token);
      }
      if (json.done && typeof json.response === "string") {
        content = json.response;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawStream += chunk;
      buffer += chunk;

      buffer = parseStreamBuffer(buffer, processPayload);
    }

    const rest = decoder.decode();
    rawStream += rest;
    buffer += rest;
    buffer = parseStreamBuffer(buffer, processPayload);

    const finalPayloadText = extractDataText(buffer);
    if (finalPayloadText) {
      try {
        processPayload(JSON.parse(finalPayloadText));
      } catch (err) {
        logError("LLM-Stream-Parsefehler", {
          error: String(err),
          line: finalPayloadText
        });
      }
    }

    logLLMExchange({
      phase: "response",
      model: body.model,
      systemPrompt,
      userPrompt,
      rawRequest: serializedRequest,
      rawResponse: rawStream,
      parsedResponse: content,
      extra: { phase: phaseLabel }
    });
    return content.trim();
  }

  const rawText = await resp.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch (err) {
    logError("LLM-HTTP-Parsefehler", {
      error: String(err),
      phase: phaseLabel,
      snippet: rawText.slice(0, 200)
    });
    throw err;
  }
  const content =
    json.message?.content ??
    json.choices?.[0]?.message?.content ??
    "";

  logDebug("LLM-Rohantwort", {
    phase: phaseLabel,
    length: content.length
  });

  if (phaseLabel === "chat") {
    logLLMExchange({
      phase: "response",
      model: body.model,
      systemPrompt,
      userPrompt,
      rawRequest: serializedRequest,
      rawResponse: rawText,
      parsedResponse: content,
      extra: { phase: phaseLabel }
    });
    return content.trim();
  }

  const parsed = safeParseJSON(content);
  logLLMExchange({
    phase: "response",
    model: body.model,
    systemPrompt,
    userPrompt,
    rawRequest: serializedRequest,
    rawResponse: rawText,
    parsedResponse: parsed,
    extra: { phase: phaseLabel }
  });
  return parsed;
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}$/m);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        logError("JSON-Parse-Fehler (Block)", {
          error: String(e2),
          snippet: match[0].slice(0, 200)
        });
        throw e2;
      }
    } else {
      logError("LLM-Antwort kein gültiges JSON", {
        snippet: text.slice(0, 200)
      });
      throw new Error("LLM JSON parse failed");
    }
  }
}
