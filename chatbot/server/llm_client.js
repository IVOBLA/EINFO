// chatbot/server/llm_client.js
// LLM-Client mit Multi-Modell Unterstützung

import { CONFIG, getModelForTask, getActiveModelConfig } from "./config.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildStartPrompts,
  buildSystemPromptChat,
  buildUserPromptChat,
  jsonRepairSystemPrompt
} from "./prompts.js";

import { logDebug, logError, logLLMExchange } from "./logger.js";
import { getKnowledgeContextVector } from "./rag/rag_vector.js";
import { extractJsonObject, validateOperationsJson } from "./json_sanitizer.js";
import { setLLMHistoryMeta } from "./state_store.js";

// Imports für Disaster Context und Learned Responses
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

// ============================================================
// Multi-Modell Unterstützung
// ============================================================

/**
 * Baut die Ollama-Options basierend auf Modell-Config
 * @param {Object} modelConfig - Modell-Konfiguration aus CONFIG.llm.models
 * @param {Object} overrides - Optionale Überschreibungen
 * @returns {Object} - Ollama options
 */
function buildModelOptions(modelConfig, overrides = {}) {
  return {
    temperature: overrides.temperature ?? modelConfig.temperature ?? 0.05,
    seed: overrides.seed ?? Math.floor(Math.random() * 1000000),
    num_ctx: overrides.numCtx ?? modelConfig.numCtx ?? CONFIG.llmNumCtx ?? 4096,
    num_batch: CONFIG.llmNumBatch || 512,
    num_gpu: modelConfig.numGpu ?? 99,
    num_predict: overrides.numPredict ?? 4000,
    top_p: overrides.topP ?? 0.92,
    top_k: overrides.topK ?? 50,
    repeat_penalty: overrides.repeatPenalty ?? 1.15,
    stop: overrides.stop ?? ["```", "<|eot_id|>", "</s>"]
  };
}

/**
 * Loggt Modell-Auswahl für Debugging
 */
function logModelSelection(taskType, modelConfig) {
  logDebug("Modell ausgewählt", {
    taskType,
    modelKey: modelConfig.key,
    modelName: modelConfig.name,
    timeout: modelConfig.timeout,
    numGpu: modelConfig.numGpu
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
  memorySnippets = [],
  scenario = null  // NEU: Szenario-Parameter
}) {
  const { compressedBoard, compressedAufgaben, compressedProtokoll } = llmInput;
  let systemPrompt;
  let userPrompt;

  if (llmInput.firstStep) {
    // NEU: Szenario an Start-Prompt übergeben
    const start = buildStartPrompts({ roles: llmInput.roles, scenario });
    systemPrompt = start.systemPrompt;
    userPrompt = start.userPrompt;
  } else {
    // Knowledge Context aus RAG
    const knowledgeContext = await getKnowledgeContextVector(
      "Stabsarbeit Kat-E Einsatzleiter LdStb Meldestelle S1 S2 S3 S4 S5 S6"
    );

    // Disaster Context abrufen
    const disasterContext = getDisasterContextSummary({ maxLength: 1500 });

    // Learned Responses abrufen (basierend auf aktuellem Board-Context)
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
      disasterContext,
      learnedResponses
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

  // ============================================================
  // Multi-Modell Auswahl basierend auf Task-Typ
  // ============================================================
  const taskType = llmInput.firstStep ? "start" : "operations";
  const modelConfig = getModelForTask(taskType);
  logModelSelection(taskType, modelConfig);

  const body = {
    model: modelConfig.name,
    stream: false,
    options: buildModelOptions(modelConfig, {
      temperature: taskType === "start" ? 0.1 : 0.2,  // Start braucht mehr Konsistenz
      numPredict: 6000,
      stop: ["```", "<|eot_id|>", "</s>"]
    }),
    messages
  };

  const { parsed, rawText } = await doLLMCall(body, "ops", null, {
    returnFullResponse: true,
    timeoutMs: modelConfig.timeout || CONFIG.llmSimTimeoutMs || CONFIG.llmRequestTimeoutMs
  });

  // Validierung
  if (parsed) {
    const validation = validateOperationsJson(parsed);
    if (!validation.valid) {
      logError("Operations-JSON ungültig", { error: validation.error });
    }
  }

  setLLMHistoryMeta(parsed?.meta || {});

  return { parsed, rawText, systemPrompt, userMessage: userPrompt, messages, model: modelConfig.name };
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

  // Disaster Context abrufen
  const disasterContext = getDisasterContextSummary({ maxLength: 1000 });

  // Learned Responses abrufen (basierend auf Frage)
  const learnedResponses = await getLearnedResponsesContext(question, { maxLength: 800 });

  const systemPrompt = buildSystemPromptChat();
  const userPrompt = buildUserPromptChat(question, knowledgeContext, disasterContext, learnedResponses);

  // ============================================================
  // Multi-Modell Auswahl für Chat
  // ============================================================
// Bei explizitem Modell: numGpu aus Config ermitteln oder Default 20 für Offloading
const modelConfig = model 
  ? { 
      key: "explicit", 
      name: model, 
      timeout: 120000,  // GEÄNDERT: 120s statt 60s
      numGpu: 20,
      temperature: 0.4 
    }
  : getModelForTask("chat");
  
  logModelSelection("chat", modelConfig);

  const body = {
    model: modelConfig.name,
    stream,
    options: buildModelOptions(modelConfig, {
      temperature: 0.4,           // Höher für natürlichere Sprache
      numPredict: 2048,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.1,
      stop: []                    // Keine stop-Tokens für natürlichen Textfluss
    }),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const answer = await doLLMCall(body, "chat", onToken, {
    timeoutMs: modelConfig.timeout || CONFIG.llmChatTimeoutMs || CONFIG.llmRequestTimeoutMs
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
    const dataText = extractDataText(part);
    if (!dataText) continue;

    try {
      const json = JSON.parse(dataText);
      processPayload(json);
    } catch {
      // Ignoriere ungültiges JSON
    }
  }

  return remainder;
}


// ------------------- JSON-Reparatur --------------------------------------

async function requestJsonRepairFromLLM({
  invalidJson,
  model,
  phaseLabel,
  messageCount
}) {
  const repairBody = {
    model,
    stream: false,
    format: "json",
    options: {
      temperature: 0,
      seed: CONFIG.defaultSeed,
      num_ctx: CONFIG.llmNumCtx || 4096,
      num_predict: 4000
    },
    messages: [
      {
        role: "system",
        content: jsonRepairSystemPrompt
      },
      {
        role: "user",
        content: `Repariere dieses JSON:\n\n${invalidJson.slice(0, 4000)}`
      }
    ]
  };

  let resp;
  let rawText = "";
  let parsed = null;

  try {
    resp = await fetchWithTimeout(
      `${CONFIG.llmBaseUrl}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json; charset=utf-8"
        },
        body: JSON.stringify(repairBody)
      },
      CONFIG.llmRequestTimeoutMs
    );

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
  // JSON-Format nur für Ops/Simulation, NICHT für Chat
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

  // Anfrage IMMER in LLM.log protokollieren
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

  // Content-Type Header validieren
  const contentType = resp.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("utf-8")) {
    logDebug("LLM-Response Content-Type ohne explizites UTF-8", {
      contentType,
      phase: phaseLabel,
      hint: "Response wird trotzdem als UTF-8 dekodiert"
    });
  }

  // STREAMING-FALL
  if (body.stream) {
    const reader = resp.body?.getReader();
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

  // NON-STREAMING-FALL
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
      // CHAT-MODUS: Text direkt zurückgeben, KEIN JSON-Parsing!
      if (phaseLabel === "chat") {
        parsed = content;
      } else {
        // Für Ops/Simulation: JSON parsen
        parsed = extractJsonObject(content);
      }
    }
  }

  // JSON-Reparatur NUR für Nicht-Chat-Modi
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


// ============================================================
// Exports für Multi-Modell Management
// ============================================================

export { getModelForTask };

/**
 * Prüft welche konfigurierten Modelle in Ollama verfügbar sind
 * @returns {Promise<Object>} - { available, missing, installed }
 */
export async function checkConfiguredModels() {
  try {
    const installedModels = await listAvailableLlmModels();
    const installedSet = new Set(installedModels.map(m => m.split(":")[0]));
    
    const configuredModels = Object.entries(CONFIG.llm.models).map(([key, config]) => ({
      key,
      name: config.name,
      baseName: config.name.split(":")[0]
    }));
    
    const available = [];
    const missing = [];
    
    for (const model of configuredModels) {
      if (installedSet.has(model.baseName) || installedSet.has(model.name)) {
        available.push(model);
      } else {
        missing.push(model);
      }
    }
    
    return {
      available,
      missing,
      installed: installedModels,
      activeConfig: getActiveModelConfig()
    };
  } catch (err) {
    logError("Fehler beim Prüfen der Modelle", { error: String(err) });
    return {
      available: [],
      missing: [],
      installed: [],
      error: String(err)
    };
  }
}
