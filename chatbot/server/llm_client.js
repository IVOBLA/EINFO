// chatbot/server/llm_client.js

import { CONFIG } from "./config.js";
import {
  buildSystemPrompt,          // allgemeiner Ops-Prompt
  buildUserPrompt,            // allgemeiner Ops-Prompt
  buildStartPrompts,          // Start-Prompt
  buildSystemPromptChat,
  buildUserPromptChat
} from "./prompts.js";

import { logDebug, logError, logLLMExchange } from "./logger.js";
import { getKnowledgeContextVector } from "./rag/rag_vector.js";
import { extractJsonObject, validateOperationsJson } from "./json_sanitizer.js";
import { setLLMHistoryMeta } from "./state_store.js";

// NEU: Imports für Disaster Context und Learned Responses
import { getDisasterContextSummary } from "./disaster_context.js";
import { getLearnedResponsesContext } from "./llm_feedback.js";


function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const finalOptions = { ...options, signal: controller.signal };

  return fetch(url, finalOptions).finally(() => {
    clearTimeout(id);
  });
}

export async function listAvailableLlmModels() {
  const url = `${CONFIG.llmBaseUrl}/api/tags`;
  let resp;

  try {
    resp = await fetchWithTimeout(
      url,
      { method: "GET" },
      CONFIG.llmRequestTimeoutMs
    );
  } catch (err) {
    logError("LLM-Modelle konnten nicht geladen werden", {
      error: String(err)
    });
    throw new Error("Ollama-Modelle nicht erreichbar");
  }

  if (!resp.ok) {
    logError("LLM-Modelle-HTTP-Fehler", {
      status: resp.status,
      statusText: resp.statusText
    });
    throw new Error(`Fehler ${resp.status} beim Laden der Modellliste`);
  }

  const data = await resp.json().catch(() => null);
  const models = Array.isArray(data?.models) ? data.models : [];
  const names = Array.from(
    new Set(
      models
        .map((entry) => entry?.name)
        .filter((name) => typeof name === "string" && name.trim())
    )
  );

  if (!names.length) {
    throw new Error("Keine Ollama-Modelle gefunden");
  }

  return names;
}


/** LLM für OPERATIONS (Simulation) */
export async function callLLMForOps({
  llmInput,
  memorySnippets = []
}) {
  const { compressedBoard, compressedAufgaben, compressedProtokoll } = llmInput;
  let systemPrompt;
  let userPrompt;

  if (llmInput.firstStep) {
    const start = buildStartPrompts({ roles: llmInput.roles });
    systemPrompt = start.systemPrompt;
    userPrompt = start.userPrompt;
  } else {
    // Knowledge Context aus RAG
    const knowledgeContext = await getKnowledgeContextVector(
      "Stabsarbeit Kat-E Einsatzleiter LdStb Meldestelle S1 S2 S3 S4 S5 S6"
    );

    // NEU: Disaster Context abrufen
    const disasterContext = getDisasterContextSummary({ maxLength: 1500 });

    // NEU: Learned Responses abrufen (basierend auf aktuellem Board-Context)
    const contextQuery = `${compressedBoard.substring(0, 200)} Katastrophenmanagement Einsatzleitung`;
    const learnedResponses = await getLearnedResponsesContext(contextQuery, { maxLength: 1000 });

    systemPrompt = buildSystemPrompt({ memorySnippets });
    userPrompt = buildUserPrompt({
      llmInput,
      compressedBoard,
      compressedAufgaben,
      compressedProtokoll,
      knowledgeContext,
      memorySnippets,
      messagesNeedingResponse: llmInput.messagesNeedingResponse || null,
      disasterContext,    // NEU
      learnedResponses    // NEU
    });
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  // Token-Schätzung
  const totalChars = systemPrompt.length + userPrompt.length;
  const estimatedTokens = Math.ceil(totalChars / 4);
  
  logDebug("OPS-Prompt aufgebaut", {
    systemLen: systemPrompt.length,
    userLen: userPrompt.length,
    estimatedTokens,
    memorySnippets: Array.isArray(memorySnippets) ? memorySnippets.length : 0
  });

  if (estimatedTokens > 6000) {
    logDebug("WARNUNG: Prompt sehr groß", { estimatedTokens });
  }

  const body = {
    model: CONFIG.llmChatModel,
    stream: false,
    options: {
      // ============================================================
      // GEÄNDERT: Mehr "Denkraum" für umfangreiche Antworten
      // ============================================================
      temperature: 0.2,              // War: 0.05 → Jetzt: 0.2 für mehr Kreativität
      seed: Math.floor(Math.random() * 1000000),
      num_ctx: CONFIG.llmNumCtx || 8192,
      num_batch: CONFIG.llmNumBatch || 512,
      num_predict: 6000,             // War: 2048 → Jetzt: 6000 für längere Antworten
      
      // NEU: Zusätzliche Sampling-Parameter für bessere Qualität
      top_p: 0.92,                    // Nucleus Sampling
      top_k: 50,                     // Begrenze auf top 40 Tokens
      repeat_penalty: 1.15,           // Verhindere Wiederholungen
      
      stop: ["```", "<|eot_id|>", "</s>"]
    },
    messages
  };

  const { parsed, rawText } = await doLLMCall(body, "ops", null, {
    returnFullResponse: true,
    timeoutMs: CONFIG.llmSimTimeoutMs || CONFIG.llmRequestTimeoutMs
  });

  // Validierung
  if (parsed) {
    const validation = validateOperationsJson(parsed);
    if (!validation.valid) {
      logError("Operations-JSON ungültig", { error: validation.error });
    }
  }

  setLLMHistoryMeta(parsed?.meta || {});

  return { parsed, rawText, systemPrompt, userMessage: userPrompt, messages };
}



/** LLM für QA-Chat (auch Streaming) */
export async function callLLMForChat({
  question,
  stream = false,
  onToken,
  model
}) {
  // Knowledge Context aus RAG
  const knowledgeContext = await getKnowledgeContextVector(question);

  // NEU: Disaster Context abrufen
  const disasterContext = getDisasterContextSummary({ maxLength: 1000 });

  // NEU: Learned Responses abrufen (basierend auf Frage)
  const learnedResponses = await getLearnedResponsesContext(question, { maxLength: 800 });

  const systemPrompt = buildSystemPromptChat();
  const userPrompt = buildUserPromptChat(question, knowledgeContext, disasterContext, learnedResponses);

  const modelName = model || CONFIG.llmChatModel;

  const body = {
    model: modelName,
    stream,
    options: {
      // ============================================================
      // CHAT-OPTIMIERTE PARAMETER für ausführliche deutsche Antworten
      // ============================================================
      temperature: 0.4,            // Höher als Ops für natürlichere Sprache
      seed: CONFIG.defaultSeed,
      num_ctx: CONFIG.llmNumCtx || 8192,
      num_batch: CONFIG.llmNumBatch || 512,
      num_predict: 2048,           // Erhöht von 1024 für ausführliche Antworten

      // Sampling-Parameter für bessere Textqualität
      top_p: 0.9,                  // Nucleus Sampling für Vielfalt
      top_k: 40,                   // Begrenzt Wortschatz auf wahrscheinlichste
      repeat_penalty: 1.1,         // Leichte Strafe für Wiederholungen

      // KEINE stop-Tokens für natürlichen Textfluss
      // (``` würde mitten in Erklärungen abbrechen)
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  // Chat-Modus: KEIN JSON-Format, natürlicher deutscher Text!

  const answer = await doLLMCall(body, "chat", onToken, {
    timeoutMs: CONFIG.llmChatTimeoutMs || CONFIG.llmRequestTimeoutMs
  });
  return answer;
}


// ------------------- Streaming-Helfer ------------------------------------

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

// ------------------- Zentrale LLM-Funktion -------------------------------

async function requestJsonRepairFromLLM({
  invalidJson,
  model,
  phaseLabel,
  messageCount
}) {
  const systemPrompt =
    "Du bist ein JSON-Reparatur-Assistent. " +
    "Korrigiere nur Syntaxfehler und gib NUR das reparierte JSON zurück. " +
    "KEINE Markdown-Codeblöcke (keine ```). " +
    "KEIN Text vor oder nach dem JSON.";

  // Limitiere die Länge des ungültigen JSON
  const limitedJson = invalidJson.slice(0, 4000);

  const userPrompt =
    "Repariere dieses ungültige JSON. Antworte NUR mit dem korrigierten JSON:\n\n" +
    limitedJson;

  const repairBody = {
    model: model || CONFIG.llmChatModel,
    stream: false,
    options: {
      temperature: 0,
      seed: CONFIG.defaultSeed,
      num_predict: 2048,
      stop: ["```"]
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const serializedRequest = JSON.stringify(repairBody);

  logLLMExchange({
    phase: "json_repair_request",
    model: repairBody.model,
    systemPrompt,
    userPrompt: userPrompt.slice(0, 200) + "...",
    rawRequest: null,
    rawResponse: null,
    parsedResponse: null,
    extra: { phase: phaseLabel, messageCount }
  });

  let rawText = "";
  let parsed = null;

  try {
    const resp = await fetchWithTimeout(
      `${CONFIG.llmBaseUrl}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Accept": "application/json; charset=utf-8",
          "Accept-Charset": "utf-8"
        },
        body: serializedRequest
      },
      CONFIG.llmChatTimeoutMs || CONFIG.llmRequestTimeoutMs
    );

    // Response als ArrayBuffer lesen und manuell mit UTF-8 dekodieren
    const buffer = await resp.arrayBuffer();
    const utf8Decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
    rawText = utf8Decoder.decode(buffer);
    if (resp.ok && typeof rawText === "string" && rawText.trim()) {
      parsed = extractJsonObject(rawText);
    }

    if (!resp.ok) {
      logError("LLM-JSON-Reparatur-HTTP-Fehler", {
        status: resp.status,
        statusText: resp.statusText,
        body: rawText.slice(0, 200)
      });
    }
  } catch (error) {
    rawText = String(error);
    logError("LLM-JSON-Reparatur-Fehler", { error: rawText });
  }

  logLLMExchange({
    phase: "json_repair_response",
    model: repairBody.model,
    rawResponse: rawText.slice(0, 500),
    parsedResponse: parsed ? "OK" : null,
    extra: { phase: phaseLabel, messageCount }
  });

  return { parsed, rawText };
}
async function doLLMCall(body, phaseLabel, onToken, options = {}) {
  // WICHTIG: JSON-Format nur für Ops/Simulation, NICHT für Chat!
  // Chat soll natürlichen deutschen Text liefern, kein JSON.
  if (phaseLabel !== "chat") {
    body.format = "json";
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serializedRequest = JSON.stringify(body);
  const systemPrompt =
    messages.find((m) => m.role === "system")?.content || messages[0]?.content || "";
  const userPrompt =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const messageCount = messages.length;

  logDebug("LLM-Request", { model: body.model, phase: phaseLabel });

  // Anfrage IMMER in LLM.log protokollieren (direkt & unverändert)
  logLLMExchange({
    phase: "request",
    model: body.model,
    systemPrompt,
    userPrompt,
    rawRequest: serializedRequest,
    rawResponse: null,
    parsedResponse: null,
    extra: { phase: phaseLabel, messageCount }
  });

  let resp;
  try {
    resp = await fetchWithTimeout(
      `${CONFIG.llmBaseUrl}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Accept": "application/json; charset=utf-8",
          "Accept-Charset": "utf-8"
        },
        body: serializedRequest
      },
       options.timeoutMs || CONFIG.llmRequestTimeoutMs
    );
  } catch (error) {
    const errorStr = String(error);
    logError("LLM-HTTP-Fehler", { error: errorStr, phase: phaseLabel });

    // Auch Netzwerk-/Timeout-Fehler ins LLM.log
    logLLMExchange({
      phase: "response_error",
      model: body.model,
      systemPrompt,
      userPrompt,
      rawRequest: serializedRequest,
      rawResponse: errorStr,
      parsedResponse: null,
      extra: { phase: phaseLabel, error: errorStr, messageCount }
    });

    throw error;
  }

  if (!resp.ok) {
    const rawText = await resp.text().catch(() => "");
    let parsedError = "";

    try {
      const parsed = JSON.parse(rawText);
      parsedError = parsed?.error || parsed?.message || "";
    } catch (err) {
      if (err) parsedError = "";
    }

    const responseSummary = parsedError || rawText || resp.statusText;
    const detailedMessage = `LLM-Fehler ${resp.status}: ${responseSummary}`;

    logError("LLM-HTTP-Fehler", {
      status: resp.status,
      statusText: resp.statusText,
      body: rawText
    });

    // HTTP-Fehler inkl. Body im LLM.log
    logLLMExchange({
      phase: "response_error",
      model: body.model,
      systemPrompt,
      userPrompt,
      rawRequest: serializedRequest,
      rawResponse: rawText,
      parsedResponse: null,
      extra: {
        httpStatus: resp.status,
        httpStatusText: resp.statusText,
        phase: phaseLabel,
        messageCount
      }
    });

    throw new Error(detailedMessage);
  }

  // Content-Type Header validieren und warnen wenn UTF-8 nicht explizit
  const contentType = resp.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("utf-8")) {
    logDebug("LLM-Response Content-Type ohne explizites UTF-8", {
      contentType,
      phase: phaseLabel,
      hint: "Response wird trotzdem als UTF-8 dekodiert"
    });
  }

  // STREAMING-FALL ----------------------------------------------------------
  if (body.stream) {
    const reader = resp.body?.getReader();
    // UTF-8 explizit erzwingen mit fatal: true für Encoding-Fehler-Erkennung
    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
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

    // Gesamter Stream + finaler Text ins LLM.log
    logLLMExchange({
      phase: "response_stream",
      model: body.model,
      systemPrompt,
      userPrompt,
      rawRequest: serializedRequest,
      rawResponse: rawStream,
      parsedResponse: content,
      extra: { phase: phaseLabel, messageCount }
    });

    if (options?.returnFullResponse) {
      return { parsed: content, rawText: rawStream };
    }

    return content;
  }

  // NON-STREAMING-FALL ------------------------------------------------------
  // Response als ArrayBuffer lesen und manuell mit UTF-8 dekodieren
  // um Encoding-Probleme bei Sonderzeichen (ü, ö, ä, ß) zu vermeiden
  const buffer = await resp.arrayBuffer();
  const utf8Decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const rawText = utf8Decoder.decode(buffer);
  let parsed = null;

if (typeof rawText === "string" && rawText.trim()) {
  // Zuerst: Parse die Ollama-Response
  const ollamaResponse = JSON.parse(rawText);

  // Extrahiere den eigentlichen Content
  const content = ollamaResponse?.message?.content;

  if (content && typeof content === "string") {
    // ============================================================
    // CHAT-MODUS: Text direkt zurückgeben, KEIN JSON-Parsing!
    // ============================================================
    if (phaseLabel === "chat") {
      // Für Chat: Einfach den Text-Content zurückgeben
      parsed = content;
    } else {
      // Für Ops/Simulation: JSON parsen
      parsed = extractJsonObject(content);
    }
  }
}

  // JSON-Reparatur NUR für Nicht-Chat-Modi (Ops/Simulation)
  if (!parsed && phaseLabel !== "chat" && typeof rawText === "string" && rawText.trim()) {
    const { parsed: repaired } = await requestJsonRepairFromLLM({
      invalidJson: rawText,
      model: body.model,
      phaseLabel,
      messageCount
    });

    if (repaired) {
      parsed = repaired;
    }
  }

  // Antwort IMMER in LLM.log
  logLLMExchange({
    phase: "response",
    model: body.model,
    systemPrompt,
    userPrompt,
    rawRequest: serializedRequest,
    rawResponse: rawText,
    parsedResponse: parsed,
    extra: { phase: phaseLabel, messageCount }
  });

  if (options?.returnFullResponse) {
    return { parsed, rawText };
  }

  return parsed ?? rawText;
}
