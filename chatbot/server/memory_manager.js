// chatbot/server/memory_manager.js

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { embedText } from "./rag/embedding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORY_DIR = path.join(__dirname, "../data");
const MEMORY_FILE = path.join(MEMORY_DIR, "memory_store.jsonl");

let memoryItems = [];

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

export async function initMemoryStore() {
  ensureMemoryDir();

  if (!fs.existsSync(MEMORY_FILE)) {
    memoryItems = [];
    return;
  }

  const raw = await fsPromises.readFile(MEMORY_FILE, "utf8");
  const lines = raw.split("\n").filter(Boolean);

  memoryItems = lines
    .map((line) => {
      try {
        const parsed = JSON.parse(line);
        return {
          ...parsed,
          embedding: Array.isArray(parsed.embedding)
            ? Float32Array.from(parsed.embedding)
            : parsed.embedding || new Float32Array()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function addMemory({ text, meta }) {
  if (!text || !text.trim()) return;

  ensureMemoryDir();
  const embedding = await embedText(text);

  const item = {
    id: Date.now().toString(),
    text,
    meta,
    embedding
  };

  memoryItems.push(item);
  const fileItem = { ...item, embedding: Array.from(item.embedding) };
  await fsPromises.appendFile(MEMORY_FILE, JSON.stringify(fileItem) + "\n");
}

export async function searchMemory({
  query,
  topK = 5,
  now = new Date(),
  maxAgeMinutes = null,
  recencyHalfLifeMinutes = null,
  longScenarioMinItems = null
} = {}) {
  if (!query || !query.trim() || memoryItems.length === 0) return [];

  const nowTs = now instanceof Date ? now.getTime() : Date.now();
  const qEmb = await embedText(query);

  const scored = memoryItems
    .map((item) => {
      let ageMinutes = 0;
      if (item.meta?.ts) {
        const ts = Date.parse(item.meta.ts);
        if (!Number.isNaN(ts)) {
          ageMinutes = (nowTs - ts) / 60000;
        }
      }

      const baseScore = cosineSimilarity(qEmb, item.embedding);

      if (maxAgeMinutes !== null && ageMinutes > maxAgeMinutes) {
        return null;
      }

      let finalScore = baseScore;
      if (recencyHalfLifeMinutes !== null) {
        const decay = Math.exp(
          -Math.log(2) * (ageMinutes / recencyHalfLifeMinutes)
        );
        finalScore = baseScore * decay;
      }

      return { ...item, score: finalScore, ageMinutes };
    })
    .filter(
      (item) =>
        item && typeof item.score === "number" && !Number.isNaN(item.score)
    );

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) + 1e-8;
  return denom === 0 ? 0 : dot / denom;
}
