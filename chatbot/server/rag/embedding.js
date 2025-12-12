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
  // Limitiere Text-Länge um Timeouts zu vermeiden
  const normalized = text.trim().slice(0, 2000);
  
  if (CONFIG.embeddingCacheSize > 0 && embeddingCache.has(normalized)) {
    const cached = embeddingCache.get(normalized);
    logDebug("Embedding aus Cache", { dim: cached.length });
    return cached;
  }

  const body = {
    model: CONFIG.llmEmbedModel,
    prompt: normalized
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
      CONFIG.llmEmbedTimeoutMs || CONFIG.llmRequestTimeoutMs
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
      body: t.slice(0, 200)
    });
    throw new Error(`Embedding error: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json();
  const vec = json.embedding || json.data?.[0]?.embedding;
  
  if (!Array.isArray(vec)) {
    logError("Ungültige Embedding-Antwort", { json });
    throw new Error("Invalid embedding response");
  }
  
  // Dimension prüfen
  if (vec.length !== CONFIG.rag.dim) {
    logDebug("Embedding-Dimension weicht ab", { 
      expected: CONFIG.rag.dim, 
      actual: vec.length 
    });
  }
  
  const arr = Float32Array.from(vec);
  rememberEmbedding(normalized, arr);
  logDebug("Embedding erzeugt", { dim: arr.length });
  return arr;
}

/**
 * Batch-Embedding für mehrere Texte
 * @param {string[]} texts - Array von Texten
 * @param {number} batchSize - Parallele Anfragen (default: 4)
 * @returns {Promise<Float32Array[]>}
 */
export async function embedTextBatch(texts, batchSize = 4) {
  const results = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    const embeddings = await Promise.all(
      batch.map(text => 
        embedText(text).catch(err => {
          logError("Batch-Embedding-Fehler", { error: String(err) });
          return new Float32Array(CONFIG.rag.dim);
        })
      )
    );
    
    results.push(...embeddings);
    
    // Kleine Pause zwischen Batches
    if (i + batchSize < texts.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return results;
}
