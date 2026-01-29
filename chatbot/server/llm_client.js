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

import { logDebug, logError, logLLMExchange, logPromptComposition } from "./logger.js";
import { getKnowledgeContextVector } from "./rag/rag_vector.js";
import { getEnhancedContext } from "./rag/query_router.js";
import { extractJsonObject, validateOperationsJson } from "./json_sanitizer.js";
import { setLLMHistoryMeta } from "./state_store.js";

// Imports für Disaster Context und Learned Responses
import { getFilteredDisasterContextSummary } from "./disaster_context.js";
import { getLearnedResponsesContext } from "./llm_feedback.js";

// ============================================================
// Retry-Konfiguration
// ============================================================
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,        // 1s
  maxDelay: 10000,        // 10s
  timeoutMultiplier: 1.5  // Timeout erhöht sich bei jedem Retry
};

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
 * Baut die Ollama-Options basierend auf Task-Config
 * @param {Object} taskConfig - Task-Konfiguration aus CONFIG.llm.tasks
 * @param {Object} overrides - Optionale Überschreibungen (für spezielle Fälle)
 * @returns {Object} - Ollama options
 */
function buildModelOptions(taskConfig, overrides = {}) {
  return {
    temperature: overrides.temperature ?? taskConfig.temperature,
    seed: overrides.seed ?? Math.floor(Math.random() * 1000000),
    num_ctx: overrides.numCtx ?? taskConfig.numCtx,
    num_batch: CONFIG.llmNumBatch || 512,
    num_gpu: overrides.numGpu ?? taskConfig.numGpu,
    num_predict: overrides.maxTokens ?? taskConfig.maxTokens,
    top_p: overrides.topP ?? taskConfig.topP,
    top_k: overrides.topK ?? taskConfig.topK,
    repeat_penalty: overrides.repeatPenalty ?? taskConfig.repeatPenalty,
    stop: overrides.stop ?? ["```", "<|eot_id|>", "</s>"]
  };
}

/**
 * Loggt Task-Konfiguration für Debugging
 */
function logTaskSelection(taskType, taskConfig) {
  logDebug("Task-Config ausgewählt", {
    taskType,
    model: taskConfig.model,
    temperature: taskConfig.temperature,
    maxTokens: taskConfig.maxTokens,
    timeout: taskConfig.timeout,
    numGpu: taskConfig.numGpu
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

  // Filtere ungültige Modelle und entferne Duplikate
  const seenNames = new Set();
  const validModels = models.filter((entry) => {
    if (!entry?.name || typeof entry.name !== "string" || !entry.name.trim()) {
      return false;
    }
    if (seenNames.has(entry.name)) {
      return false; // Duplikat überspringen
    }
    seenNames.add(entry.name);
    return true;
  });

  if (!validModels.length) {
    throw new Error("Keine Ollama-Modelle gefunden");
  }

  return validModels;
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

  // Debug-Infos für Prompt-Composition-Log
  let promptCompositionDebug = null;

  if (llmInput.firstStep) {
    // NEU: Szenario an Start-Prompt übergeben
    const start = buildStartPrompts({ roles: llmInput.roles, scenario });
    systemPrompt = start.systemPrompt;
    userPrompt = start.userPrompt;

    // Debug-Info für Start-Phase
    promptCompositionDebug = {
      phase: "start",
      rules: {},
      filtering: {},
      components: {
        systemPrompt: { chars: systemPrompt.length, tokens: Math.ceil(systemPrompt.length / 4) },
        userPrompt: { chars: userPrompt.length, tokens: Math.ceil(userPrompt.length / 4) },
        scenarioContext: { chars: scenario ? JSON.stringify(scenario).length : 0, included: !!scenario }
      }
    };
  } else {
    // Knowledge Context aus RAG
    const knowledgeContext = await getKnowledgeContextVector(
      "Stabsarbeit Kat-E Einsatzleiter LdStb Meldestelle S1 S2 S3 S4 S5 S6"
    );

    // Disaster Context abrufen (mit Filterregeln + Admin-Status Update + Debug-Infos)
    const {
      summary: disasterContext,
      filterDebug,
      appliedRules,
      tokensUsed: disasterTokens
    } = await getFilteredDisasterContextSummary({ maxLength: 1500 });

    // Learned Responses abrufen (basierend auf aktuellem Board-Context)
    const contextQuery = `${compressedBoard.substring(0, 200)} Katastrophenmanagement Einsatzleitung`;
    const learnedResponses = await getLearnedResponsesContext(contextQuery, { maxLength: 1000 });

    systemPrompt = buildSystemPrompt();
    userPrompt = buildUserPrompt({
      llmInput,
      compressedBoard,
      compressedAufgaben,
      compressedProtokoll,
      knowledgeContext,
      memorySnippets,
      openQuestions: llmInput.openQuestions || null,  // NEU: Offene Rückfragen
      disasterContext,
      learnedResponses,
      scenario
    });

    // Debug-Info für Operations-Phase (vollständig)
    promptCompositionDebug = {
      phase: "operations",
      rules: filterDebug?.rules || {},
      filtering: filterDebug?.filtering || {},
      appliedRules,
      components: {
        systemPrompt: {
          chars: systemPrompt.length,
          tokens: Math.ceil(systemPrompt.length / 4),
          preview: systemPrompt.substring(0, 100)
        },
        userPrompt: {
          chars: userPrompt.length,
          tokens: Math.ceil(userPrompt.length / 4)
        },
        compressedBoard: {
          chars: compressedBoard?.length || 0,
          tokens: Math.ceil((compressedBoard?.length || 0) / 4),
          preview: compressedBoard?.substring(0, 80)
        },
        compressedAufgaben: {
          chars: compressedAufgaben?.length || 0,
          tokens: Math.ceil((compressedAufgaben?.length || 0) / 4)
        },
        compressedProtokoll: {
          chars: compressedProtokoll?.length || 0,
          tokens: Math.ceil((compressedProtokoll?.length || 0) / 4)
        },
        knowledgeContext: {
          chars: knowledgeContext?.length || 0,
          tokens: Math.ceil((knowledgeContext?.length || 0) / 4),
          included: !!knowledgeContext && knowledgeContext !== "(kein Knowledge-Kontext verfügbar)"
        },
        disasterContext: {
          chars: disasterContext?.length || 0,
          tokens: disasterTokens || Math.ceil((disasterContext?.length || 0) / 4),
          preview: disasterContext?.substring(0, 80)
        },
        learnedResponses: {
          chars: learnedResponses?.length || 0,
          tokens: Math.ceil((learnedResponses?.length || 0) / 4),
          included: !!learnedResponses && learnedResponses !== "(keine gelernten Antworten verfügbar)"
        },
        memorySnippets: {
          chars: memorySnippets?.join?.("\n")?.length || 0,
          count: Array.isArray(memorySnippets) ? memorySnippets.length : 0
        },
        openQuestions: {
          count: llmInput.openQuestions?.length || 0,
          included: (llmInput.openQuestions?.length || 0) > 0
        }
      }
    };
  }

  // Prompt-Composition-Log schreiben
  if (promptCompositionDebug) {
    logPromptComposition(promptCompositionDebug);
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
  // Task-Config holen (alle Parameter aus zentraler Config)
  // ============================================================
  const taskType = llmInput.firstStep ? "start" : "operations";
  const taskConfig = getModelForTask(taskType);  // Gibt jetzt Task-Config zurück

  if (!taskConfig || !taskConfig.model) {
    throw new Error(`Keine gültige Task-Konfiguration für Task-Typ: ${taskType}`);
  }

  logTaskSelection(taskType, taskConfig);

  const body = {
    model: taskConfig.model,
    stream: false,
    options: buildModelOptions(taskConfig),  // Alle Werte aus Task-Config
    messages
  };

  const { parsed, rawText } = await doLLMCallWithRetry(body, "ops", null, {
    returnFullResponse: true,
    timeoutMs: taskConfig.timeout
  });

  // Validierung
  if (parsed) {
    const validation = validateOperationsJson(parsed);
    if (!validation.valid) {
      logError("Operations-JSON ungültig", { error: validation.error });
    }
  }

  setLLMHistoryMeta(parsed?.meta || {});

  return { parsed, rawText, systemPrompt, userMessage: userPrompt, messages, model: taskConfig.model };
}



/** LLM für QA-Chat (auch Streaming) */
export async function callLLMForChat(arg1, arg2, arg3) {
  if (typeof arg1 === "string" && typeof arg2 === "string") {
    const systemPrompt = arg1;
    const userPrompt = arg2;
    const overrides = arg3 || {};
    const taskType = overrides.taskType || "chat";
    const useStreaming = overrides.stream !== false;
    const externalOnToken = overrides.onToken || null;  // NEU: Externer Token-Callback

    // JSON-Format erzwingen für analysis Task-Typ (außer explizit deaktiviert)
    const requireJsonFormat = overrides.requireJson !== false && taskType === "analysis";

    // Task-Config holen (alle Defaults aus zentraler Config)
    const taskConfig = getModelForTask(taskType);

    // Wenn explizites Modell angegeben, nur Modellname überschreiben
    if (overrides.model) {
      taskConfig.model = overrides.model;
    }
    if (Number.isFinite(overrides.timeout)) {
      taskConfig.timeout = overrides.timeout;
    }

    logTaskSelection(taskType, taskConfig);

    const body = {
      model: taskConfig.model,
      stream: useStreaming,
      options: buildModelOptions(taskConfig, overrides),  // overrides nur für Spezialfälle
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    };

    // JSON-Format für analysis erzwingen
    if (requireJsonFormat) {
      body.format = "json";
    }

    // Bei Streaming: Tokens intern sammeln und am Ende zurückgeben
    let collectedResponse = "";
    const tokenCollector = useStreaming ? (token) => {
      collectedResponse += token;
      // NEU: Auch externen Callback aufrufen wenn vorhanden
      if (externalOnToken) {
        externalOnToken(token);
      }
    } : null;

    // phaseLabel bestimmt das Antwortformat: "analysis" = JSON, "chat"/"situation-question" = Text
    const phaseLabel = taskType === "analysis" ? "analysis" :
                       taskType === "situation-question" ? "situation-question" : "chat";
    const result = await doLLMCallWithRetry(body, phaseLabel, tokenCollector, {
      timeoutMs: taskConfig.timeout
    });

    // Bei Streaming ist result leer, daher gesammelten Response zurückgeben
    return useStreaming ? collectedResponse : result;
  }

  const {
    question,
    stream = false,
    onToken,
    model
  } = arg1 || {};
  // Enhanced Context via Query-Router (inkl. Geo, Session, Memory)
  const { context: enhancedContext, intent, stats } = await getEnhancedContext(question, {
    maxChars: 3000
  });

  logDebug("Chat: Enhanced Context", {
    intentType: intent.type,
    confidence: intent.confidence,
    contextLength: stats.contextLength
  });

  // Falls Query-Router semantisch ist, zusätzlich statisches RAG
  const knowledgeContext = intent.type === "semantic"
    ? await getKnowledgeContextVector(question)
    : enhancedContext;

  // Disaster Context abrufen (mit Filterregeln + Admin-Status Update)
  const { summary: disasterContext } = await getFilteredDisasterContextSummary({ maxLength: 1000 });

  // Learned Responses abrufen (basierend auf Frage)
  const learnedResponses = await getLearnedResponsesContext(question, { maxLength: 800 });

  const systemPrompt = buildSystemPromptChat();
  const userPrompt = buildUserPromptChat(question, knowledgeContext, disasterContext, learnedResponses);

  // ============================================================
  // Task-Config holen (alle Parameter aus zentraler Config)
  // ============================================================
  const taskConfig = getModelForTask("chat");

  if (!taskConfig || !taskConfig.model) {
    throw new Error("Keine gültige Task-Konfiguration für Chat");
  }

  // Wenn explizites Modell angegeben, nur Modellname überschreiben
  if (model) {
    taskConfig.model = model;
  }

  logTaskSelection("chat", taskConfig);

  const body = {
    model: taskConfig.model,
    stream,
    options: buildModelOptions(taskConfig),  // Alle Werte aus Task-Config
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const answer = await doLLMCallWithRetry(body, "chat", onToken, {
    timeoutMs: taskConfig.timeout
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


/**
 * Wrapper für doLLMCall mit Retry-Logik
 * @param {Object} body - Request Body
 * @param {string} phaseLabel - Phase (ops/chat)
 * @param {Function} onToken - Streaming Callback
 * @param {Object} options - Optionen
 * @param {number} maxRetries - Max Anzahl Retries (default: 3)
 * @returns {Promise<any>}
 */
async function doLLMCallWithRetry(body, phaseLabel, onToken, options = {}, maxRetries = RETRY_CONFIG.maxRetries) {
  let lastError;
  let currentTimeout = options.timeoutMs || CONFIG.llmRequestTimeoutMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logDebug("LLM-Call Versuch", {
        attempt,
        maxRetries,
        phase: phaseLabel,
        timeout: currentTimeout
      });

      return await doLLMCall(body, phaseLabel, onToken, {
        ...options,
        timeoutMs: currentTimeout
      });
    } catch (err) {
      lastError = err;
      const errorMsg = String(err);

      // Prüfe ob Retry sinnvoll ist
      const isRetryable =
        errorMsg.includes('timeout') ||
        errorMsg.includes('abort') ||
        errorMsg.includes('AbortError') ||
        errorMsg.includes('ECONNREFUSED') ||
        errorMsg.includes('ECONNRESET') ||
        errorMsg.includes('fetch failed') ||
        errorMsg.includes('network') ||
        errorMsg.includes('500') ||
        errorMsg.includes('502') ||
        errorMsg.includes('503') ||
        errorMsg.includes('504');

      if (!isRetryable || attempt >= maxRetries) {
        logError("LLM-Call endgültig fehlgeschlagen", {
          attempt,
          maxRetries,
          phase: phaseLabel,
          error: errorMsg,
          retryable: isRetryable
        });
        throw lastError;
      }

      // Exponential Backoff berechnen
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1),
        RETRY_CONFIG.maxDelay
      );

      // Timeout für nächsten Versuch erhöhen
      currentTimeout = Math.floor(currentTimeout * RETRY_CONFIG.timeoutMultiplier);

      logDebug("LLM-Call Retry", {
        attempt,
        maxRetries,
        delayMs: delay,
        nextTimeout: currentTimeout,
        phase: phaseLabel,
        error: errorMsg.slice(0, 100)
      });

      // Warten vor erneutem Versuch
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function doLLMCall(body, phaseLabel, onToken, options = {}) {
  // JSON-Format nur für Ops/Simulation/Analysis, NICHT für Chat oder Situation-Question
  // Situation-Question erwartet Text-Antworten, nicht JSON
  const textOnlyPhases = ["chat", "situation-question"];
  if (!textOnlyPhases.includes(phaseLabel)) {
    body.format = "json";
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serializedRequest = JSON.stringify(body);
  const messageCount = messages.length;

  logDebug("LLM-Request", { model: body.model, phase: phaseLabel });

  // Anfrage IMMER in LLM.log protokollieren (vollständiger Request inkl. Prompts in rawRequest)
  logLLMExchange({
    phase: "request",
    model: body.model,
    rawRequest: serializedRequest,
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
      rawRequest: serializedRequest,
      rawResponse: errorStr,
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
      rawRequest: serializedRequest,
      rawResponse: rawText,
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
    const installedSet = new Set(installedModels.map(m => m.name.split(":")[0]));

    // CONFIG.llm.models existiert nicht mehr - stattdessen aus tasks extrahieren
    if (!CONFIG.llm || !CONFIG.llm.tasks) {
      return {
        available: [],
        missing: [],
        installed: installedModels,
        activeConfig: getActiveModelConfig(),
        error: "CONFIG.llm.tasks nicht definiert"
      };
    }

    // Modelle aus allen Tasks sammeln (dedupliziert)
    const modelSet = new Set();
    for (const [taskKey, taskConfig] of Object.entries(CONFIG.llm.tasks)) {
      if (taskConfig && taskConfig.model) {
        modelSet.add(taskConfig.model);
      }
    }

    const configuredModels = Array.from(modelSet).map(modelName => ({
      key: modelName,  // Verwende Modellname als Key für Kompatibilität
      name: modelName,
      baseName: modelName.split(":")[0]
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
