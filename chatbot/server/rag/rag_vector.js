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

function cosineSimilarity(a, b) {
  let dot = 0.0;
  let na = 0.0;
  let nb = 0.0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Liefert einen String mit Knowledge-Kontext (Top-K Chunks).
 */
export async function getKnowledgeContextVector(query) {
  await ensureLoaded();
  if (!meta || !vectors || !meta.chunks.length || !vectors.length) return "";

  let qEmb;
  try {
    qEmb = await embedText(query); // Float32Array
  } catch (error) {
    logError("Embedding für Query fehlgeschlagen", { error: String(error) });
    return "";
  }
  const qArr = Array.from(qEmb);

  const sims = [];
  const n = Math.min(vectors.length, CONFIG.rag.indexMaxElements);

  for (let i = 0; i < n; i++) {
    const v = vectors[i];
    const s = cosineSimilarity(qArr, v);
    sims.push({ idx: i, s });
  }

  sims.sort((a, b) => b.s - a.s);

  const k = Math.min(CONFIG.rag.topK, sims.length);
  const parts = [];
  let remaining = CONFIG.rag.maxContextChars;

  for (let i = 0; i < k; i++) {
    const { idx, s } = sims[i];
    const ch = meta.chunks[idx];
    if (!ch) continue;
    const header = `# ${ch.fileName} (Chunk ${ch.id}, sim=${s.toFixed(3)})\n`;
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
  logDebug("Vector-Knowledge-Kontext (JS) erzeugt", {
    length: ctx.length,
    parts: parts.length
  });
  return ctx;
}
