// chatbot/server/rag/embedding.js

import { CONFIG } from "../config.js";
import { logDebug, logError } from "../logger.js";

export async function embedText(text) {
  const body = {
    model: CONFIG.llmEmbedModel,
    prompt: text
  };

  const resp = await fetch(`${CONFIG.llmBaseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    logError("Embedding-HTTP-Fehler", {
      status: resp.status,
      statusText: resp.statusText,
      body: t
    });
    throw new Error(`Embedding error: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json();
  const vec = json.embedding || json.data?.[0]?.embedding;
  if (!Array.isArray(vec)) {
    logError("Ungültige Embedding-Antwort", { json });
    throw new Error("Invalid embedding response");
  }
  logDebug("Embedding erzeugt", { dim: vec.length });
  return Float32Array.from(vec);
}
