// chatbot/server/llm_client.js

// chatbot/server/llm_client.js

import { CONFIG } from "./config.js";
import {
  buildSystemPrompt,          // allgemeiner Ops-Prompt
  buildUserPrompt,            // allgemeiner Ops-Prompt
  buildStartPrompts,          // Start-Prompt für Nicht-phi3
  buildSystemPromptChat,
  buildUserPromptChat
} from "./prompts.js";

import { logDebug, logError, logLLMExchange } from "./logger.js";
import { getKnowledgeContextVector } from "./rag/rag_vector.js";
import { extractJsonObject } from "./json_sanitizer.js";
import { setLLMHistoryMeta } from "./state_store.js";


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
/** LLM für OPERATIONS (Simulation) */
export async function callLLMForOps({
  llmInput,
  memorySnippets = []
}) {
  const { compressedBoard, compressedAufgaben, compressedProtokoll } = llmInput;
  const modelName = (CONFIG.llmChatModel || "").toLowerCase();

  let systemPrompt;
  let userPrompt;

  // ---------------------------------------------------------
  // SPEZIALFALL: ERSTER SIMULATIONSSCHRITT
  // ---------------------------------------------------------
  if (llmInput.firstStep) {
    // Für phi3_cpu: kompakter Start-Prompt mit Beispiel-JSON, OHNE RAG/History
    if (modelName.includes("phi3")) {
      const rolesJson = JSON.stringify(llmInput.roles || {}, null, 2);

      systemPrompt = `
Du bist ein Simulationsmodul für den Bezirks-Einsatzstab.
Sprache: Du schreibst ALLES auf Deutsch.

Du musst GENAU EIN JSON-Objekt zurückgeben. Nichts davor, nichts danach.

Erlaubtes Format:
{
  "operations": {
    "board": { "createIncidentSites": [...], "updateIncidentSites": [] },
    "aufgaben": { "create": [...], "update": [] },
    "protokoll": { "create": [...] }
  },
  "analysis": "kurzer deutscher Text",
  "meta": {
    "historySummary": "max. 2 Sätze",
    "historyState": { "openIncidents": [], "closedIncidents": [], "openTasksByRole": {}, "lastMajorEvents": [] }
  }
}

Rollenregeln:
- originRole, fromRole, assignedBy NUR Rollen aus missingRoles.
- "via" ist IMMER "Meldestelle" oder "Meldestelle/S6".
- meta.historyState ist dein strukturierter Speicher über alle Schritte und muss gepflegt werden.

BEISPIEL (Struktur und Stil):

{
  "operations": {
    "board": {
      "createIncidentSites": [
        {
          "originRole": "Einsatzleiter",
          "fromRole": "Einsatzleiter",
          "via": "Meldestelle",
          "title": "Hochwasser Bereich Tiebel",
          "description": "Überflutung im Uferbereich, Wasserstand steigend.",
          "priority": "critical",
          "locationHint": "Tiebel, Feldkirchen",
          "linkedProtocolId": null
        }
      ],
      "updateIncidentSites": []
    },
    "aufgaben": {
      "create": [
        {
          "originRole": "LdStb",
          "assignedBy": "Einsatzleiter",
          "via": "Meldestelle",
          "forRole": "S2",
          "title": "Lagebild Hochwasser",
          "description": "Pegelstände sammeln und Lagekarte aktualisieren.",
          "priority": "high",
          "linkedIncidentId": "incident-1",
          "linkedProtocolId": null
        }
      ],
      "update": []
    },
    "protokoll": {
      "create": [
        {
          "originRole": "Einsatzleiter",
          "fromRole": "Einsatzleiter",
          "toRole": "LdStb",
          "via": "Meldestelle",
          "subject": "Lagemeldung Hochwasser",
          "content": "Überflutung im Bereich Tiebel, mehrere Objekte gefährdet.",
          "category": "Lagemeldung"
        }
      ]
    }
  },
  "analysis": "Beispielausgabe, tatsächliche IDs und Texte an die aktuelle Lage anpassen.",
  "meta": {
    "historySummary": "Kurz zusammengefasster Schritt",
    "historyState": { "openIncidents": [], "closedIncidents": [], "openTasksByRole": {}, "lastMajorEvents": [] }
  }
}

Dies ist NUR ein Beispiel. Du musst eigene Inhalte erzeugen, aber GENAU dieses Format einhalten.
`;

      userPrompt = `
START-SCHRITT – Hochwasser-Katastrophenszenario im Bezirk Feldkirchen.

ROLES (active/missing):
${rolesJson}

Lage:
- Nach Starkregen steigen die Pegel von Tiebel und Glan deutlich.
- Erste Überflutungen im Uferbereich und in Unterführungen.
- Der Bezirks-Einsatzstab wird eingerichtet.

Aufgabe:
- Erzeuge 1–3 neue Einsatzstellen in "operations.board.createIncidentSites"
  passend zur Hochwasserlage (z.B. überflutete Straßenzüge, gefährdete Objekte).
- Erzeuge mindestens einen Protokolleintrag in "operations.protokoll.create"
  (z.B. Lagemeldung Einsatzleiter -> LdStb).
- Erzeuge mindestens eine Aufgabe in "operations.aufgaben.create"
  für eine fehlende Stabsrolle (z.B. S2, S3, S4 oder S5).

Regeln:
- originRole, fromRole, assignedBy NUR Rollen aus missingRoles verwenden.
- "via" IMMER "Meldestelle" oder "Meldestelle/S6".
- Gib NUR EIN JSON-Objekt im beschriebenen Format aus. Keine weiteren Texte.
`;
    } else {
      // Nicht-phi3-Modelle: bestehenden (umfangreicheren) Start-Prompt nutzen
      const start = buildStartPrompts({ roles: llmInput.roles });
      systemPrompt = start.systemPrompt;
      userPrompt = start.userPrompt;
    }
  } else {
    // -------------------------------------------------------
    // NORMALFALL: laufende Simulation
    // -------------------------------------------------------
    const knowledgeContext = await getKnowledgeContextVector(
      "Stabsarbeit Kat-E Einsatzleiter LdStb Meldestelle S1 S2 S3 S4 S5 S6"
    );

    systemPrompt = buildSystemPrompt({ memorySnippets });
    userPrompt = buildUserPrompt({
      llmInput,
      compressedBoard,
      compressedAufgaben,
      compressedProtokoll,
      knowledgeContext,
      memorySnippets
    });
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const body = {
    model: CONFIG.llmChatModel,
    stream: false,
    options: {
      temperature: CONFIG.defaultTemperature,
      seed: CONFIG.defaultSeed
    },
    messages
  };

  logDebug("OPS-Prompt aufgebaut", {
    systemPrompt,
    userPrompt,
    memorySnippets: Array.isArray(memorySnippets)
      ? memorySnippets.length
      : 0
  });

  const { parsed, rawText } = await doLLMCall(body, "ops", null, {
    returnFullResponse: true
  });

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
  const knowledgeContext = await getKnowledgeContextVector(question);

  const systemPrompt = buildSystemPromptChat();
  const userPrompt = buildUserPromptChat(question, knowledgeContext);

  const modelName = model || CONFIG.llmChatModel;

  const body = {
    model: modelName,
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

async function doLLMCall(body, phaseLabel, onToken, options = {}) {
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
        headers: { "Content-Type": "application/json" },
        body: serializedRequest
      },
      CONFIG.llmRequestTimeoutMs
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
    const t = await resp.text().catch(() => "");
    logError("LLM-HTTP-Fehler", {
      status: resp.status,
      statusText: resp.statusText,
      body: t
    });

    // HTTP-Fehler inkl. Body im LLM.log
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
        phase: phaseLabel,
        messageCount
      }
    });

    throw new Error(`LLM error: ${resp.status} ${resp.statusText}`);
  }

  // STREAMING-FALL ----------------------------------------------------------
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
  const rawText = await resp.text();
  let parsed = null;
  if (typeof rawText === "string" && rawText.trim()) {
    parsed = extractJsonObject(rawText);
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
