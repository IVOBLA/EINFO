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
import { embedText } from "./embedding.js";

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
  const entries = await fsPromises.readdir(knowledgeDir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (![".txt", ".md", ".pdf"].includes(ext)) continue;
    files.push({ name: e.name, path: path.join(knowledgeDir, e.name), ext });
  }
  return files;
}

async function extractText(file) {
  if (file.ext === ".pdf") {
    const buf = await fsPromises.readFile(file.path);
    const data = await pdfParse(buf);
    return data.text || "";
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

    for (const ch of chunks) {
      if (curId >= maxElements) {
        logInfo("MaxElements erreicht, breche ab", { maxElements });
        break;
      }
      try {
        const emb = await embedText(ch); // Float32Array
        meta.chunks.push({
          id: curId,
          fileName: file.name,
          text: ch
        });
        // Für JSON speichern wir einfach als Array von Numbers
        vectors.push(Array.from(emb));
        curId++;
      } catch (err) {
        logError("Fehler beim Embedding eines Chunks", {
          file: file.name,
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
