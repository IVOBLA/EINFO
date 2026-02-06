// chatbot/server/rag/rag_vector.js
// Vector-RAG ohne native Module (pure JS):
// - lädt meta.json + embeddings.json
// - berechnet Cosine-Similarity in JS
// - liefert Top-K Chunks als Knowledge-Kontext

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "../config.js";
import { embedText } from "./embedding.js";
import { logDebug, logError } from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexDir = path.resolve(__dirname, CONFIG.knowledgeIndexDir);
const metaPath = path.join(indexDir, "meta.json");
const embeddingsPath = path.join(indexDir, "embeddings.json");

let meta = null;
let vectors = null; // Array<Array<number>>
let lastMetaMtimeMs = 0;
let lastEmbeddingsMtimeMs = 0;

async function ensureLoaded() {
  const metaExists = fs.existsSync(metaPath);
  const embExists = fs.existsSync(embeddingsPath);
  if (!metaExists || !embExists) {
    logError("Vector-Index oder Embeddings nicht gefunden", {
      metaPath,
      embeddingsPath
    });
    meta = { dim: CONFIG.rag.dim, chunks: [] };
    vectors = [];
    lastMetaMtimeMs = 0;
    lastEmbeddingsMtimeMs = 0;
    return;
  }

  const [metaStat, embStat] = await Promise.all([
    fsPromises.stat(metaPath),
    fsPromises.stat(embeddingsPath)
  ]);

  if (
    meta &&
    vectors &&
    lastMetaMtimeMs === metaStat.mtimeMs &&
    lastEmbeddingsMtimeMs === embStat.mtimeMs
  ) {
    return;
  }

  try {
    const [rawMeta, rawEmb] = await Promise.all([
      fsPromises.readFile(metaPath, "utf8"),
      fsPromises.readFile(embeddingsPath, "utf8")
    ]);

    meta = JSON.parse(rawMeta);
    const embData = JSON.parse(rawEmb);

    if (!Array.isArray(embData.vectors)) {
      throw new Error("Embeddings-Datei hat kein gültiges Format");
    }

    vectors = embData.vectors;
    lastMetaMtimeMs = metaStat.mtimeMs;
    lastEmbeddingsMtimeMs = embStat.mtimeMs;

    if (meta.chunks.length !== vectors.length) {
      logError("Anzahl Chunks != Anzahl Vektoren", {
        chunks: meta.chunks.length,
        vectors: vectors.length
      });
    }

    logDebug("Vector-Index (JS) geladen", {
      elements: meta.chunks.length,
      dim: meta.dim
    });
  } catch (error) {
    logError("Fehler beim Laden des Vector-Index", { error: String(error) });
    meta = { dim: CONFIG.rag.dim, chunks: [] };
    vectors = [];
    lastMetaMtimeMs = 0;
    lastEmbeddingsMtimeMs = 0;
  }
}

// ERSETZEN: Optimierte Version mit Loop-Unrolling
function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0.0;
  let na = 0.0;
  let nb = 0.0;
  
  // Loop-Unrolling für bessere Performance
  const unrollLen = len - (len % 4);
  let i = 0;
  
  for (; i < unrollLen; i += 4) {
    dot += a[i] * b[i] + a[i+1] * b[i+1] + a[i+2] * b[i+2] + a[i+3] * b[i+3];
    na += a[i] * a[i] + a[i+1] * a[i+1] + a[i+2] * a[i+2] + a[i+3] * a[i+3];
    nb += b[i] * b[i] + b[i+1] * b[i+1] + b[i+2] * b[i+2] + b[i+3] * b[i+3];
  }
  
  // Rest
  for (; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent].s <= item.s) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = item;
}

function heapReplaceRoot(heap, item) {
  let i = 0;
  const length = heap.length;
  const half = length >> 1;
  while (i < half) {
    let left = (i << 1) + 1;
    let right = left + 1;
    let smallest = left;
    if (right < length && heap[right].s < heap[left].s) {
      smallest = right;
    }
    if (heap[smallest].s >= item.s) break;
    heap[i] = heap[smallest];
    i = smallest;
  }
  heap[i] = item;
}

// ============================================================
// NEU: Funktion für RAG mit Quellenangaben
// ============================================================

/**
 * Wie getKnowledgeContextVector, aber mit detaillierten Quelleninfos
 * @param {string} query - Suchanfrage
 * @param {object} options - Optionen
 * @returns {Promise<{context: string, sources: Array}>}
 */
export async function getKnowledgeContextWithSources(query, options = {}) {
  const topK = options.topK || CONFIG.rag.topK || 5;
  const maxChars = options.maxChars || CONFIG.rag.maxContextChars || 2500;
  const threshold = options.threshold || CONFIG.rag.scoreThreshold || 0.35;
  const filters = options.filters || {};

  await ensureLoaded();

  if (!meta || !vectors || !meta.chunks?.length || !vectors.length) {
    logDebug("RAG nicht geladen - kein Kontext", null);
    return { context: "", sources: [] };
  }

  const queryEmbedding = await embedText(query);
  const results = [];
  const candidateIndices = filterChunkIndices(meta.chunks, filters);

  for (const i of candidateIndices) {
    const docVec = vectors[i];
    const score = cosineSimilarity(queryEmbedding, docVec);

    if (score >= threshold) {
      results.push({
        index: i,
        score,
        text: meta.chunks[i]?.text || "",
        fileName: meta.chunks[i]?.fileName || "unbekannt"
      });
    }
  }

  // Nach Score sortieren
  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, topK);

  // Context aufbauen
  let context = "";
  let charCount = 0;
  const sources = [];

  for (const r of topResults) {
    if (charCount + r.text.length > maxChars) break;
    
    context += r.text + "\n\n";
    charCount += r.text.length;
    
    sources.push({
      fileName: r.fileName,
      score: Math.round(r.score * 100),
      preview: r.text.slice(0, 100) + "..."
    });
  }

  logDebug("RAG mit Quellen", { 
    query: query.slice(0, 50), 
    resultsFound: results.length,
    sourcesUsed: sources.length 
  });

  return { context: context.trim(), sources };
}

/**
 * Liefert einen String mit Knowledge-Kontext (Top-K Chunks).
 */
export async function getKnowledgeContextVector(query, options = {}) {
  await ensureLoaded();
  if (!meta || !vectors || !meta.chunks.length || !vectors.length) return "";

  let qEmb;
  try {
    qEmb = await embedText(query);
  } catch (error) {
    logError("Embedding für Query fehlgeschlagen", { error: String(error) });
    return "";
  }
  const qArr = Array.from(qEmb);

  const n = Math.min(vectors.length, CONFIG.rag.indexMaxElements);
  const topK = options.topK || CONFIG.rag.topK;
  const maxChars = options.maxChars || CONFIG.rag.maxContextChars;
  const scoreThreshold = options.threshold || CONFIG.rag.scoreThreshold || 0.3;
  const k = Math.min(topK, n);
  
  if (k === 0) return "";

  const heap = [];
  const candidateIndices = filterChunkIndices(meta.chunks, options.filters || {});

  for (const i of candidateIndices) {
    const v = vectors[i];
    const s = cosineSimilarity(qArr, v);
    
    // Score-Threshold prüfen
    if (s < scoreThreshold) continue;
    
    const entry = { idx: i, s };

    if (heap.length < k) {
      heapPush(heap, entry);
      continue;
    }

    if (s > heap[0].s) {
      heapReplaceRoot(heap, entry);
    }
  }

  const sims = heap.sort((a, b) => b.s - a.s);

  const parts = [];
  let remaining = maxChars;

  for (let i = 0; i < sims.length; i++) {
    const { idx, s } = sims[i];
    const ch = meta.chunks[idx];
    if (!ch) continue;
    
    // Kompakteres Format
    const header = `[${ch.fileName}|${s.toFixed(2)}]\n`;
    const text = ch.text;
    const need = header.length + text.length + 2;
    
    if (need > remaining) {
      if (remaining <= header.length + 10) break;
      const cut = text.slice(0, remaining - header.length - 2);
      parts.push(header + cut);
      break;
    }
    
    parts.push(header + text);
    remaining -= need;
    if (remaining <= 0) break;
  }

  const ctx = parts.join("\n\n");

  logDebug("Vector-Knowledge-Kontext erzeugt", {
    length: ctx.length,
    parts: parts.length,
    topScore: sims[0]?.s?.toFixed(3) || "N/A"
  });

  return ctx;
}

function filterChunkIndices(chunks, filters = {}) {
  const {
    doc_type: docTypeFilter,
    category: categoryFilter,
    municipality,
    bbox
  } = filters;

  const docTypes = normalizeFilterValues(docTypeFilter);
  const categories = normalizeFilterValues(categoryFilter);

  const indices = [];
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const metaInfo = ch?.meta || {};

    if (docTypes.length) {
      if (!docTypes.includes(metaInfo.doc_type)) continue;
    }

    if (categories.length) {
      if (!categories.includes(metaInfo.category)) continue;
    }

    if (municipality) {
      const muni = metaInfo.address?.municipality || metaInfo.address?.city || "";
      if (muni.toLowerCase() !== municipality.toLowerCase()) continue;
    }

    if (bbox && Array.isArray(bbox) && bbox.length === 4) {
      const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
      if (metaInfo.geo?.lat !== undefined && metaInfo.geo?.lon !== undefined) {
        const { lat, lon } = metaInfo.geo;
        if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) {
          continue;
        }
      } else if (Array.isArray(metaInfo.geo?.bbox) && metaInfo.geo.bbox.length === 4) {
        const [bMinLon, bMinLat, bMaxLon, bMaxLat] = metaInfo.geo.bbox;
        const overlaps = !(bMaxLon < minLon || bMinLon > maxLon || bMaxLat < minLat || bMinLat > maxLat);
        if (!overlaps) continue;
      } else {
        continue;
      }
    }

    indices.push(i);
  }

  return indices;
}

function normalizeFilterValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}

export { filterChunkIndices };

// ============================================================
// Funktion zum Hinzufügen von Einträgen ins Vector-RAG
// ============================================================

/**
 * Fügt einen neuen Eintrag zum Vector-RAG hinzu (persistiert in meta.json + embeddings.json)
 * @param {string} text - Der Text für das Embedding
 * @param {object} options - Optionen
 * @param {string} options.fileName - Quellenname (z.B. "user_feedback")
 * @param {string} options.id - Optionale eindeutige ID zur Duplikat-Erkennung
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
export async function addToVectorRAG(text, { fileName = "user_feedback", id = null } = {}) {
  if (!text || !text.trim()) {
    return { success: false, error: "Leerer Text" };
  }

  try {
    await ensureLoaded();

    // Embedding generieren
    const embedding = await embedText(text.trim());
    if (!embedding || !Array.isArray(embedding)) {
      return { success: false, error: "Embedding fehlgeschlagen" };
    }

    // Duplikat-Check falls ID angegeben
    if (id) {
      const existingIndex = meta.chunks.findIndex(c => c.id === id);
      if (existingIndex >= 0) {
        logDebug("Vector-RAG: Eintrag existiert bereits", { id });
        return { success: true, id, duplicate: true };
      }
    }

    const entryId = id || `vrag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Zum Memory-Cache hinzufügen
    meta.chunks.push({
      id: entryId,
      text: text.trim(),
      fileName,
      addedAt: Date.now()
    });
    vectors.push(Array.from(embedding));

    // Persistieren
    await Promise.all([
      fsPromises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8"),
      fsPromises.writeFile(embeddingsPath, JSON.stringify({ vectors }, null, 2), "utf8")
    ]);

    // Cache-Zeiten aktualisieren
    const [metaStat, embStat] = await Promise.all([
      fsPromises.stat(metaPath),
      fsPromises.stat(embeddingsPath)
    ]);
    lastMetaMtimeMs = metaStat.mtimeMs;
    lastEmbeddingsMtimeMs = embStat.mtimeMs;

    logDebug("Vector-RAG: Eintrag hinzugefügt", {
      id: entryId,
      fileName,
      totalChunks: meta.chunks.length
    });

    return { success: true, id: entryId };

  } catch (error) {
    logError("Vector-RAG: Fehler beim Hinzufügen", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Entfernt einen Eintrag aus dem Vector-RAG anhand der ID
 * @param {string} id - Die ID des Eintrags
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function removeFromVectorRAG(id) {
  if (!id) {
    return { success: false, error: "Keine ID angegeben" };
  }

  try {
    await ensureLoaded();

    const index = meta.chunks.findIndex(c => c.id === id);
    if (index < 0) {
      logDebug("Vector-RAG: Eintrag nicht gefunden", { id });
      return { success: false, error: "Eintrag nicht gefunden" };
    }

    // Aus Memory-Cache entfernen
    meta.chunks.splice(index, 1);
    vectors.splice(index, 1);

    // Persistieren
    await Promise.all([
      fsPromises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8"),
      fsPromises.writeFile(embeddingsPath, JSON.stringify({ vectors }, null, 2), "utf8")
    ]);

    // Cache-Zeiten aktualisieren
    const [metaStat, embStat] = await Promise.all([
      fsPromises.stat(metaPath),
      fsPromises.stat(embeddingsPath)
    ]);
    lastMetaMtimeMs = metaStat.mtimeMs;
    lastEmbeddingsMtimeMs = embStat.mtimeMs;

    logDebug("Vector-RAG: Eintrag entfernt", { id });

    return { success: true };

  } catch (error) {
    logError("Vector-RAG: Fehler beim Entfernen", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
