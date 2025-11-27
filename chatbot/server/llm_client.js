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
export async function callLLMForChat({ question }) {
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

  const answer = await doLLMCall(body, "chat");
  return answer;
}

/** Streamt das LLM für den QA-Chat und liefert Text-Tokens zurück. */
export async function* streamLLMChatTokens({ question }) {
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
    stream: true,
    options: {
      temperature: CONFIG.defaultTemperature,
      seed: CONFIG.defaultSeed
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const resp = await fetchWithTimeout(
    `${CONFIG.llmBaseUrl}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    CONFIG.llmRequestTimeoutMs
  );

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    logError("LLM-HTTP-Fehler (stream)", {
      status: resp.status,
      statusText: resp.statusText,
      body: t
    });
    throw new Error(`LLM error: ${resp.status} ${resp.statusText}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error("LLM liefert keinen Stream-Körper");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { tokens, remaining } = parseStreamBuffer(buffer, false);
    buffer = remaining;
    for (const token of tokens) {
      if (token) {
        yield token;
      }
    }
  }

  buffer += decoder.decode();
  const { tokens } = parseStreamBuffer(buffer, true);
  for (const token of tokens) {
    if (token) {
      yield token;
    }
  }
}

async function doLLMCall(body, phaseLabel) {
  const systemPrompt = body.messages[0]?.content || "";
  const userPrompt = body.messages[1]?.content || "";

  logDebug("LLM-Request", { model: body.model, phase: phaseLabel });

  logLLMExchange({
    phase: "request",
    model: body.model,
    systemPrompt,
    userPrompt,
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
        body: JSON.stringify(body)
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

  const json = await resp.json();
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
      rawResponse: content,
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
    rawResponse: content,
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

function parseStreamBuffer(buffer, flushAll) {
  const parts = buffer.split("\n\n");
  let remaining = "";
  if (!flushAll) {
    remaining = parts.pop() ?? "";
  }

  const tokens = [];
  for (const part of parts) {
    const dataText = extractDataText(part);
    if (!dataText || dataText === "[DONE]") continue;
    const token = extractTokenFromPayload(dataText);
    if (token) tokens.push(token);
  }

  return { tokens, remaining };
}

function extractDataText(block) {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, ""));

  const joined = dataLines.join("\n").trim();
  return joined;
}

function extractTokenFromPayload(dataText) {
  let payload;
  try {
    payload = JSON.parse(dataText);
  } catch (_) {
    return dataText;
  }

  const choice = payload.choices?.[0];
  const delta = choice?.delta?.content;
  const messageContent = choice?.message?.content;
  const directMessage = payload.message?.content;
  const tokenField = payload.token ?? payload.text ?? payload.response;

  const token =
    delta ?? directMessage ?? messageContent ?? tokenField ?? payload.content;

  if (Array.isArray(token)) {
    return token.join("");
  }

  if (typeof token === "number") {
    return String(token);
  }

  if (typeof token === "string") {
    return token;
  }

  return null;
}
