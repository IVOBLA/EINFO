// chatbot/server/rag/embedding.js

import { CONFIG } from "../config.js";
import { logDebug, logError } from "../logger.js";

const embeddingCache = new Map();

function rememberEmbedding(key, value) {
  if (CONFIG.embeddingCacheSize <= 0) return;
  if (embeddingCache.has(key)) {
    embeddingCache.delete(key);
  }
  embeddingCache.set(key, value);
  if (embeddingCache.size > CONFIG.embeddingCacheSize) {
    const oldestKey = embeddingCache.keys().next().value;
    embeddingCache.delete(oldestKey);
  }
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const finalOptions = { ...options, signal: controller.signal };

  return fetch(url, finalOptions).finally(() => {
    clearTimeout(id);
  });
}

export async function embedText(text) {
  const normalized = text.trim();
  if (CONFIG.embeddingCacheSize > 0 && embeddingCache.has(normalized)) {
    const cached = embeddingCache.get(normalized);
    logDebug("Embedding aus Cache", { dim: cached.length });
    return cached;
  }

  const body = {
    model: CONFIG.llmEmbedModel,
    prompt: text
  };

  let resp;
  try {
    resp = await fetchWithTimeout(
      `${CONFIG.llmBaseUrl}/api/embeddings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      },
      CONFIG.llmRequestTimeoutMs
    );
  } catch (error) {
    logError("Embedding-HTTP-Fehler", { error: String(error) });
    throw error;
  }

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
  const arr = Float32Array.from(vec);
  rememberEmbedding(normalized, arr);
  logDebug("Embedding erzeugt", { dim: arr.length });
  return arr;
}
