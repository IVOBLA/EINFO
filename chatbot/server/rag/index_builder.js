// chatbot/server/rag/index_builder.js
// Build-Script für Vector-RAG ohne native Module (pure JS)
//
// - Liest knowledge/ (txt, md, pdf)
// - extrahiert Text
// - chunked Text
// - Embeddings per LLM-Embedding-API
// - schreibt meta.json + embeddings.json

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pdfParse from "pdf-parse";
import { CONFIG } from "../config.js";
import { logInfo, logError } from "../logger.js";
import { chunkText } from "./chunk.js";
import { embedText, embedTextBatch } from "./embedding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const knowledgeDir = path.resolve(__dirname, CONFIG.knowledgeDir);
const indexDir = path.resolve(__dirname, CONFIG.knowledgeIndexDir);
if (!fs.existsSync(indexDir)) fs.mkdirSync(indexDir, { recursive: true });

const metaPath = path.join(indexDir, "meta.json");
const embeddingsPath = path.join(indexDir, "embeddings.json");

async function loadFiles() {
  if (!fs.existsSync(knowledgeDir)) {
    logInfo("Knowledge-Verzeichnis existiert nicht", { dir: knowledgeDir });
    return [];
  }

  const allowedExt = new Set([".txt", ".md", ".pdf", ".json"]);
  const files = [];

  async function walk(dir) {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExt.has(ext)) continue;
      const relativeName = path.relative(knowledgeDir, fullPath);
      files.push({ name: relativeName, path: fullPath, ext });
    }
  }

  await walk(knowledgeDir);
  return files;
}

async function extractText(file) {
  if (file.ext === ".pdf") {
    const buf = await fsPromises.readFile(file.path);
    const data = await pdfParse(buf);
    return data.text || "";
  }
  if (file.ext === ".json") {
    const raw = await fsPromises.readFile(file.path, "utf8");
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch (err) {
      logError("JSON konnte nicht geparsed werden, verwende Rohinhalt", {
        file: file.name,
        error: String(err)
      });
      return raw;
    }
  }
  const raw = await fsPromises.readFile(file.path, "utf8");
  return raw;
}

async function buildIndex() {
  const files = await loadFiles();
  if (!files.length) {
    logInfo("Keine Knowledge-Files gefunden", null);
    return;
  }

  logInfo("Knowledge-Files gefunden", { count: files.length });

  const dim = CONFIG.rag.dim;
  const maxElements = CONFIG.rag.indexMaxElements;

  const meta = {
    dim,
    files: [],
    chunks: [] // { id, fileName, text }
  };

  const vectors = []; // Array von Float32Array / Arrays

  let curId = 0;

  for (const file of files) {
    logInfo("Verarbeite Knowledge-Datei", { file: file.name });
    const text = (await extractText(file)).replace(/\s+/g, " ").trim();
    if (!text) continue;

    const chunks = chunkText(text, 1000, 200);
    meta.files.push({ name: file.name, chunks: chunks.length });

    // Performance-Optimierung: Batch-Embeddings statt einzeln
    const BATCH_SIZE = 8; // 8 Chunks parallel embedden

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      if (curId >= maxElements) {
        logInfo("MaxElements erreicht, breche ab", { maxElements });
        break;
      }

      const batch = chunks.slice(i, Math.min(i + BATCH_SIZE, chunks.length));

      try {
        logInfo("Embedde Batch", {
          file: file.name,
          batch: `${i + 1}-${i + batch.length}/${chunks.length}`
        });

        const embeddings = await embedTextBatch(batch, BATCH_SIZE);

        for (let j = 0; j < embeddings.length; j++) {
          if (curId >= maxElements) break;

          const emb = embeddings[j];
          const ch = batch[j];

          meta.chunks.push({
            id: curId,
            fileName: file.name,
            text: ch
          });

          // Für JSON speichern wir einfach als Array von Numbers
          vectors.push(Array.from(emb));
          curId++;
        }
      } catch (err) {
        logError("Fehler beim Batch-Embedding", {
          file: file.name,
          batch: `${i + 1}-${i + batch.length}`,
          error: String(err)
        });
      }
    }
  }

  await fsPromises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  await fsPromises.writeFile(
    embeddingsPath,
    JSON.stringify(
      {
        dim,
        vectors
      },
      null,
      0
    ),
    "utf8"
  );

  logInfo("Vector-Index (JS) gebaut", {
    dim,
    elements: curId,
    metaPath,
    embeddingsPath
  });
}

buildIndex().catch((err) => {
  logError("Index-Build fehlgeschlagen", { error: String(err) });
  process.exit(1);
});
