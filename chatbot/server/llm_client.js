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

async function doLLMCall(body, phaseLabel) {
  const systemPrompt = body.messages[0]?.content || "";
  const userPrompt = body.messages[1]?.content || "";
  const requestBody = JSON.stringify(body);

  logDebug("LLM-Request", { model: body.model, phase: phaseLabel });

  logLLMExchange({
    phase: "request",
    model: body.model,
    systemPrompt,
    userPrompt,
    requestBody,
    responseBody: null,
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
        body: requestBody
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
      requestBody,
      responseBody: t,
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

  const responseBody = await resp.text();
  let json;
  try {
    json = JSON.parse(responseBody);
  } catch (error) {
    logError("LLM-Response kein gültiges JSON", {
      phase: phaseLabel,
      error: String(error)
    });
    logLLMExchange({
      phase: "response_parse_error",
      model: body.model,
      systemPrompt,
      userPrompt,
      requestBody,
      responseBody,
      rawResponse: responseBody,
      parsedResponse: null,
      extra: { phase: phaseLabel }
    });
    throw error;
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
      requestBody,
      responseBody,
      rawResponse: responseBody,
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
    requestBody,
    responseBody,
    rawResponse: responseBody,
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
