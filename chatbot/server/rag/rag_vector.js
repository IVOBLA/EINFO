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
import { normalizeStreet } from "./jsonl_utils.js";
import { findMunicipalityInQuery, getMunicipalityIndex } from "./geo_search.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexDir = path.resolve(__dirname, CONFIG.knowledgeIndexDir);
const metaPath = path.join(indexDir, "meta.json");
const embeddingsPath = path.join(indexDir, "embeddings.json");
const entityIndexPath = path.join(__dirname, "entity_index.json");

let meta = null;
let vectors = null; // Array<Array<number>>
let lastMetaMtimeMs = 0;
let lastEmbeddingsMtimeMs = 0;
let entityIndex = null;
let lastEntityMtimeMs = 0;

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

async function ensureEntityIndexLoaded() {
  if (!fs.existsSync(entityIndexPath)) {
    entityIndex = null;
    lastEntityMtimeMs = 0;
    return;
  }

  const stat = await fsPromises.stat(entityIndexPath);
  if (entityIndex && lastEntityMtimeMs === stat.mtimeMs) return;

  try {
    const raw = await fsPromises.readFile(entityIndexPath, "utf8");
    const parsed = JSON.parse(raw);
    entityIndex = parsed && typeof parsed === "object" ? parsed : null;
    lastEntityMtimeMs = stat.mtimeMs;
  } catch (error) {
    logError("Entity-Index konnte nicht geladen werden", { error: String(error) });
    entityIndex = null;
    lastEntityMtimeMs = 0;
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
  await ensureEntityIndexLoaded();

  if (!meta || !vectors || !meta.chunks?.length || !vectors.length) {
    logDebug("RAG nicht geladen - kein Kontext", null);
    return { context: "", sources: [] };
  }

  const structured = await getStructuredMatches(query, options, filters, meta.chunks);
  const candidateIndices = filterChunkIndices(meta.chunks, structured.filters);
  const structuredIndices = structured.matches.map((hit) => hit.index);
  const structuredIndexSet = new Set(structuredIndices);

  let embeddingResults = [];
  if (structured.matches.length < topK) {
    const queryEmbedding = await embedText(query);
    const results = [];

    for (const i of candidateIndices) {
      if (structuredIndexSet.has(i)) continue;
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

    results.sort((a, b) => b.score - a.score);
    embeddingResults = results.slice(0, Math.max(0, topK - structured.matches.length));
  }

  const mergedResults = [
    ...structured.matches.map((hit) => ({
      index: hit.index,
      score: hit.score ?? 1,
      text: meta.chunks[hit.index]?.text || "",
      fileName: meta.chunks[hit.index]?.fileName || "unbekannt",
      structured: true,
      reason: hit.reason
    })),
    ...embeddingResults
  ].slice(0, topK);

  // Context aufbauen
  let context = "";
  let charCount = 0;
  const sources = [];

  for (const r of mergedResults) {
    if (charCount + r.text.length > maxChars) break;
    
    context += r.text + "\n\n";
    charCount += r.text.length;
    
    sources.push({
      fileName: r.fileName,
      score: Math.round((r.score ?? 1) * 100),
      preview: r.text.slice(0, 100) + "...",
      structured: Boolean(r.structured),
      reason: r.reason
    });
  }

  logDebug("RAG mit Quellen", { 
    query: query.slice(0, 50), 
    resultsFound: mergedResults.length,
    sourcesUsed: sources.length,
    structuredHits: structured.matches.length
  });

  return { context: context.trim(), sources };
}

/**
 * Liefert einen String mit Knowledge-Kontext (Top-K Chunks).
 */
export async function getKnowledgeContextVector(query, options = {}) {
  await ensureLoaded();
  await ensureEntityIndexLoaded();
  if (!meta || !vectors || !meta.chunks.length || !vectors.length) return "";

  let qEmb;
  const n = Math.min(vectors.length, CONFIG.rag.indexMaxElements);
  const topK = options.topK || CONFIG.rag.topK;
  const maxChars = options.maxChars || CONFIG.rag.maxContextChars;
  const scoreThreshold = options.threshold || CONFIG.rag.scoreThreshold || 0.3;
  const k = Math.min(topK, n);
  
  if (k === 0) return "";

  const structured = await getStructuredMatches(query, options, options.filters || {}, meta.chunks);
  const candidateIndices = filterChunkIndices(meta.chunks, structured.filters);
  const structuredIndices = structured.matches.map((hit) => hit.index);
  const structuredIndexSet = new Set(structuredIndices);

  let sims = [];
  if (structured.matches.length < k) {
    try {
      qEmb = await embedText(query);
    } catch (error) {
      logError("Embedding für Query fehlgeschlagen", { error: String(error) });
      return "";
    }
    const qArr = Array.from(qEmb);
    const heap = [];

    for (const i of candidateIndices) {
      if (structuredIndexSet.has(i)) continue;
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

    sims = heap.sort((a, b) => b.s - a.s);
  }

  const structuredSorted = structured.matches
    .slice(0, k)
    .map((hit) => ({ idx: hit.index, s: hit.score ?? 1, structured: true, reason: hit.reason }));

  const parts = [];
  let remaining = maxChars;
  const combined = [...structuredSorted, ...sims].slice(0, k);

  for (let i = 0; i < combined.length; i++) {
    const { idx, s, structured: isStructured, reason } = combined[i];
    const ch = meta.chunks[idx];
    if (!ch) continue;
    
    // Kompakteres Format
    const header = isStructured
      ? `[${ch.fileName}|structured${reason ? `:${reason}` : ""}]\n`
      : `[${ch.fileName}|${s.toFixed(2)}]\n`;
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
    topScore: combined[0]?.s?.toFixed(3) || "N/A",
    structuredHits: structured.matches.length
  });

  return ctx;
}

function filterChunkIndices(chunks, filters = {}) {
  const {
    doc_type: docTypeFilter,
    category: categoryFilter,
    municipality,
    bbox,
    useMunicipalityOrBbox
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

    let municipalityMatch = true;
    let bboxMatch = true;

    if (municipality) {
      const muni = metaInfo.address?.municipality || metaInfo.address?.city || "";
      municipalityMatch = muni.toLowerCase() === municipality.toLowerCase();
    }

    if (bbox && Array.isArray(bbox) && bbox.length === 4) {
      const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
      if (metaInfo.geo?.lat !== undefined && metaInfo.geo?.lon !== undefined) {
        const { lat, lon } = metaInfo.geo;
        bboxMatch = !(lat < minLat || lat > maxLat || lon < minLon || lon > maxLon);
      } else if (Array.isArray(metaInfo.geo?.bbox) && metaInfo.geo.bbox.length === 4) {
        const [bMinLon, bMinLat, bMaxLon, bMaxLat] = metaInfo.geo.bbox;
        bboxMatch = !(bMaxLon < minLon || bMinLon > maxLon || bMaxLat < minLat || bMinLat > maxLat);
      } else {
        bboxMatch = false;
      }
    }

    if (municipality || bbox) {
      if (useMunicipalityOrBbox) {
        if (!(municipalityMatch || bboxMatch)) continue;
      } else if (!municipalityMatch || !bboxMatch) {
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

function normalizeQueryText(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "");
}

function detectStructuredFilters(query) {
  const lower = query.toLowerCase();
  const docTypes = [];
  let category = null;

  const wantsStreetStats =
    /(wieviele|wie viele|anzahl)/i.test(lower) &&
    /(gebäude|gebaeude)/i.test(lower) &&
    /(straße|strasse|weg|gasse)/i.test(lower);

  if (wantsStreetStats) {
    docTypes.push("street_stats");
  }

  if (/adresse|wo ist/i.test(lower)) {
    docTypes.push("address", "poi");
  }

  if (/krankenhaus/i.test(lower)) {
    category = "amenity:hospital";
  }

  return {
    docTypes,
    category,
    wantsStreetStats
  };
}

function extractStreetCandidate(query) {
  const patterns = [
    /\bam\s+([A-Za-zÄÖÜäöüß0-9.\-\s]+?)\b/i,
    /\bin der\s+([A-Za-zÄÖÜäöüß0-9.\-\s]+?)\b/i,
    /\bin\s+([A-Za-zÄÖÜäöüß0-9.\-\s]+?)\b/i,
    /\bauf dem\s+([A-Za-zÄÖÜäöüß0-9.\-\s]+?)\b/i
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function extractEntityQuery(query) {
  const quotedMatch = query.match(/["„“”']([^"„“”']+)["„“”']/);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();
  const firmaMatch = query.match(/firma\s+([^\n,.!?]+)/i);
  if (firmaMatch?.[1]) return firmaMatch[1].trim();
  return "";
}

function mergeFilterValue(existing, incoming) {
  if (!incoming || (Array.isArray(incoming) && incoming.length === 0)) return existing;
  if (!existing || (Array.isArray(existing) && existing.length === 0)) return incoming;
  const existingArr = Array.isArray(existing) ? existing : [existing];
  const incomingArr = Array.isArray(incoming) ? incoming : [incoming];
  return Array.from(new Set([...existingArr, ...incomingArr]));
}

async function getStructuredMatches(query, options, baseFilters, chunks) {
  const normalizedQuery = normalizeQueryText(query);
  const detected = detectStructuredFilters(query);
  const filters = {
    ...baseFilters
  };

  if (!filters.doc_type && detected.docTypes.length) {
    filters.doc_type = detected.docTypes;
  } else if (filters.doc_type && detected.docTypes.length) {
    filters.doc_type = mergeFilterValue(filters.doc_type, detected.docTypes);
  }

  if (!filters.category && detected.category) {
    filters.category = detected.category;
  }

  const explicitMunicipality = filters.municipality;
  if (!explicitMunicipality && !filters.bbox) {
    const municipalityHit = await findMunicipalityInQuery(query);
    if (municipalityHit) {
      filters.municipality = municipalityHit.municipality;
      filters.bbox = municipalityHit.bbox;
      filters.useMunicipalityOrBbox = true;
    }
  } else if (explicitMunicipality && !filters.bbox) {
    const index = await getMunicipalityIndex();
    const entry = index.find(
      (item) => item.municipality?.toLowerCase() === explicitMunicipality.toLowerCase()
    );
    if (entry?.bbox) {
      filters.bbox = entry.bbox;
      filters.useMunicipalityOrBbox = true;
    }
  }

  const candidateIndices = filterChunkIndices(chunks, filters);
  const matches = new Map();

  const streetCandidate = extractStreetCandidate(query);
  if (streetCandidate) {
    const streetNorm = normalizeStreet(streetCandidate);
    for (const idx of candidateIndices) {
      const ch = chunks[idx];
      const street = ch?.meta?.address?.street_norm || "";
      if (street && street === streetNorm) {
        matches.set(idx, {
          index: idx,
          score: 1.2,
          reason: "street"
        });
      } else if (streetCandidate) {
        const title = normalizeQueryText(ch?.meta?.title || "");
        if (title.includes(normalizeQueryText(streetCandidate))) {
          matches.set(idx, {
            index: idx,
            score: 1.1,
            reason: "street_title"
          });
        }
      }
    }
  }

  const entityQuery = extractEntityQuery(query);
  const normalizedEntity = normalizeQueryText(entityQuery);
  if (normalizedEntity) {
    if (entityIndex && entityIndex[normalizedEntity]) {
      const docIds = entityIndex[normalizedEntity];
      for (const idx of candidateIndices) {
        const ch = chunks[idx];
        if (docIds.includes(ch?.meta?.doc_id)) {
          matches.set(idx, {
            index: idx,
            score: 1.5,
            reason: "entity_index"
          });
        }
      }
    } else {
      for (const idx of candidateIndices) {
        const ch = chunks[idx];
        const title = normalizeQueryText(ch?.meta?.title || "");
        const name = normalizeQueryText(ch?.meta?.name || "");
        if (title.includes(normalizedEntity) || name.includes(normalizedEntity)) {
          matches.set(idx, {
            index: idx,
            score: 1.3,
            reason: "entity_match"
          });
        }
      }
    }
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 2);
  if (queryTokens.length) {
    for (const idx of candidateIndices) {
      const ch = chunks[idx];
      if (!ch?.text) continue;
      const text = normalizeQueryText(ch.text);
      const hasAll = queryTokens.every((token) => text.includes(token));
      if (hasAll) {
        const existing = matches.get(idx);
        const score = (existing?.score || 1) + 0.3;
        matches.set(idx, {
          index: idx,
          score,
          reason: existing?.reason || "keyword"
        });
      }
    }
  }

  const sorted = Array.from(matches.values()).sort((a, b) => b.score - a.score);
  return {
    matches: sorted,
    filters
  };
}

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
