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
import readline from "readline";
import crypto from "crypto";
import { CONFIG } from "../config.js";
import { logInfo, logError, logWarn } from "../logger.js";
import { chunkText } from "./chunk.js";
import { embedTextBatch } from "./embedding.js";
import { buildChunkMetadata } from "./jsonl_utils.js";
import { validateAndNormalizeJsonlRecord } from "./jsonl_schema_validator.js";
import {
  buildDedupeKey,
  buildStreetStatsRecords,
  createIngestReport,
  ensureFileReport,
  recordWarning,
  updateEntityIndex,
  updateStreetAggregation
} from "./ingest_helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const knowledgeDir = path.resolve(__dirname, CONFIG.knowledgeDir);
const indexDir = path.resolve(__dirname, CONFIG.knowledgeIndexDir);
if (!fs.existsSync(indexDir)) fs.mkdirSync(indexDir, { recursive: true });

const metaPath = path.join(indexDir, "meta.json");
const embeddingsPath = path.join(indexDir, "embeddings.json");
const ingestReportPath = path.join(__dirname, "ingest_report.json");
const entityIndexPath = path.join(__dirname, "entity_index.json");

async function loadFiles() {
  if (!fs.existsSync(knowledgeDir)) {
    logInfo("Knowledge-Verzeichnis existiert nicht", { dir: knowledgeDir });
    return [];
  }

  const allowedExt = new Set([
    ".txt",
    ".md",
    ".pdf",
    ".json",
    ".jsonl",
    ".mp4",
    ".mkv",
    ".mov",
    ".avi",
    ".webm"
  ]);
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

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm"]);

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
  if (VIDEO_EXTS.has(file.ext)) {
    return await extractVideoText(file);
  }
  const raw = await fsPromises.readFile(file.path, "utf8");
  return raw;
}

async function extractVideoText(file) {
  const baseName = file.path.replace(path.extname(file.path), "");
  const sidecarCandidates = [".txt", ".jsonl", ".json"].map((ext) => `${baseName}${ext}`);
  for (const sidecarPath of sidecarCandidates) {
    if (fs.existsSync(sidecarPath)) {
      const sidecarExt = path.extname(sidecarPath).toLowerCase();
      if (sidecarExt === ".jsonl") {
        return await extractJsonlChunks(sidecarPath, file.name, { sidecar: true });
      }
      if (sidecarExt === ".json") {
        const raw = await fsPromises.readFile(sidecarPath, "utf8");
        try {
          const parsed = JSON.parse(raw);
          return JSON.stringify(parsed, null, 2);
        } catch (err) {
          logError("Video-Sidecar JSON konnte nicht geparsed werden, verwende Rohinhalt", {
            file: file.name,
            error: String(err)
          });
          return raw;
        }
      }
      return await fsPromises.readFile(sidecarPath, "utf8");
    }
  }

  const stats = await fsPromises.stat(file.path);
  return [
    `Video: ${file.name}`,
    `Größe: ${stats.size} Bytes`,
    `Geändert: ${stats.mtime.toISOString()}`
  ].join("\n");
}

async function extractJsonlChunks(
  filePath,
  fileName,
  { sidecar = false, report, seenKeys, streetStats, entityIndex } = {}
) {
  const chunks = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  const fileReport = report ? ensureFileReport(report, fileName) : null;

  for await (const line of rl) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (fileReport) {
      fileReport.lines += 1;
      report.totals.lines += 1;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      logError("JSONL-Zeile konnte nicht geparsed werden, überspringe", {
        file: fileName,
        line: lineNumber,
        error: String(err)
      });
      if (fileReport) {
        fileReport.skipped += 1;
        report.totals.skipped += 1;
      }
      continue;
    }

    const hasDocId = Boolean(parsed.doc_id);
    const result = validateAndNormalizeJsonlRecord(parsed, {
      filePath: fileName,
      lineNo: lineNumber
    });
    if (!result.ok) {
      logWarn(`[JSONL] skip ${fileName}:${lineNumber} - ${result.error}`);
      if (fileReport) {
        fileReport.skipped += 1;
        report.totals.skipped += 1;
      }
      continue;
    }

    if (result.warnings?.length) {
      logWarn("JSONL-Zeile normalisiert mit Warnungen", {
        file: fileName,
        line: lineNumber,
        warnings: result.warnings
      });
      if (fileReport) {
        for (const warning of result.warnings) {
          recordWarning(report, fileReport, warning);
        }
      }
    }

    const record = result.record;
    if (seenKeys) {
      const dedupeKey = buildDedupeKey(record, { preferDocId: hasDocId });
      if (seenKeys.has(dedupeKey)) {
        if (fileReport) {
          fileReport.deduped += 1;
          report.totals.deduped += 1;
        }
        continue;
      }
      seenKeys.add(dedupeKey);
    }

    if (fileReport) {
      fileReport.ok += 1;
      report.totals.ok += 1;
    }

    if (streetStats) {
      updateStreetAggregation(record, streetStats);
    }
    if (entityIndex) {
      updateEntityIndex(record, entityIndex);
    }

    const baseMeta = {
      ...buildChunkMetadata(record),
      source_file: fileName,
      is_sidecar: sidecar
    };

    const contentChunks =
      record.content.length > 1200
        ? chunkText(record.content, 1000, 200).slice(0, 3)
        : [record.content];

    contentChunks.forEach((text, idx) => {
      const meta = {
        ...baseMeta,
        chunk_index: idx,
        chunk_total: contentChunks.length
      };
      chunks.push({ text, meta });
    });
  }

  return chunks;
}

function buildFallbackId(fileName, index) {
  const hash = crypto.createHash("sha1").update(`${fileName}:${index}`).digest("hex");
  return `file:${fileName}:chunk:${hash}`;
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
  const report = createIngestReport();
  const seenKeys = new Set();
  const streetStats = new Map();
  const entityIndex = new Map();

  for (const file of files) {
    logInfo("Verarbeite Knowledge-Datei", { file: file.name });
    let chunksWithMeta = [];
    if (file.ext === ".jsonl") {
      chunksWithMeta = await extractJsonlChunks(file.path, file.name, {
        report,
        seenKeys,
        streetStats,
        entityIndex
      });
    } else if (VIDEO_EXTS.has(file.ext)) {
      const extracted = await extractText(file);
      if (Array.isArray(extracted)) {
        chunksWithMeta = extracted;
      } else {
        const text = extracted.replace(/\s+/g, " ").trim();
        if (!text) continue;
        chunksWithMeta = chunkText(text, 1000, 200).map((chunk, idx) => ({
          text: chunk,
          meta: { fallback_id: buildFallbackId(file.name, idx) }
        }));
      }
    } else {
      const text = (await extractText(file)).replace(/\s+/g, " ").trim();
      if (!text) continue;
      chunksWithMeta = chunkText(text, 1000, 200).map((chunk, idx) => ({
        text: chunk,
        meta: { fallback_id: buildFallbackId(file.name, idx) }
      }));
    }

    if (!chunksWithMeta.length) continue;
    meta.files.push({ name: file.name, chunks: chunksWithMeta.length });

    // Performance-Optimierung: Batch-Embeddings statt einzeln
    const BATCH_SIZE = 8; // 8 Chunks parallel embedden

    for (let i = 0; i < chunksWithMeta.length; i += BATCH_SIZE) {
      if (curId >= maxElements) {
        logInfo("MaxElements erreicht, breche ab", { maxElements });
        break;
      }

      const batch = chunksWithMeta.slice(i, Math.min(i + BATCH_SIZE, chunksWithMeta.length));
      const batchTexts = batch.map((entry) => entry.text);

      try {
        logInfo("Embedde Batch", {
          file: file.name,
          batch: `${i + 1}-${i + batch.length}/${chunksWithMeta.length}`
        });

        const embeddings = await embedTextBatch(batchTexts, BATCH_SIZE);

        for (let j = 0; j < embeddings.length; j++) {
          if (curId >= maxElements) break;

          const emb = embeddings[j];
          const ch = batch[j];

          meta.chunks.push({
            id: curId,
            fileName: file.name,
            text: ch.text,
            meta: ch.meta
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

  const streetStatsRecords = buildStreetStatsRecords(streetStats);
  if (streetStatsRecords.length) {
    const streetStatsChunks = [];
    for (const record of streetStatsRecords) {
      const contentChunks =
        record.content.length > 1200
          ? chunkText(record.content, 1000, 200).slice(0, 3)
          : [record.content];

      contentChunks.forEach((text, idx) => {
        const metaInfo = {
          ...buildChunkMetadata(record),
          source_file: "generated:street_stats",
          is_generated: true,
          chunk_index: idx,
          chunk_total: contentChunks.length
        };
        streetStatsChunks.push({ text, meta: metaInfo });
      });
    }

    if (streetStatsChunks.length) {
      meta.files.push({ name: "generated:street_stats", chunks: streetStatsChunks.length });
      const BATCH_SIZE = 8;
      for (let i = 0; i < streetStatsChunks.length; i += BATCH_SIZE) {
        if (curId >= maxElements) {
          logInfo("MaxElements erreicht, breche ab", { maxElements });
          break;
        }

        const batch = streetStatsChunks.slice(i, Math.min(i + BATCH_SIZE, streetStatsChunks.length));
        const batchTexts = batch.map((entry) => entry.text);

        try {
          logInfo("Embedde Street-Stats Batch", {
            batch: `${i + 1}-${i + batch.length}/${streetStatsChunks.length}`
          });

          const embeddings = await embedTextBatch(batchTexts, BATCH_SIZE);

          for (let j = 0; j < embeddings.length; j++) {
            if (curId >= maxElements) break;
            const emb = embeddings[j];
            const ch = batch[j];

            meta.chunks.push({
              id: curId,
              fileName: "generated:street_stats",
              text: ch.text,
              meta: ch.meta
            });

            vectors.push(Array.from(emb));
            curId++;
          }
        } catch (err) {
          logError("Fehler beim Street-Stats-Embedding", { error: String(err) });
        }
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

  try {
    await fsPromises.writeFile(ingestReportPath, JSON.stringify(report, null, 2), "utf8");
  } catch (err) {
    logWarn("Ingest-Report konnte nicht geschrieben werden", { error: String(err) });
  }

  if (entityIndex.size) {
    try {
      const entityPayload = Object.fromEntries(entityIndex.entries());
      await fsPromises.writeFile(entityIndexPath, JSON.stringify(entityPayload, null, 2), "utf8");
    } catch (err) {
      logWarn("Entity-Index konnte nicht geschrieben werden", { error: String(err) });
    }
  }

  logInfo("Vector-Index (JS) gebaut", {
    dim,
    elements: curId,
    metaPath,
    embeddingsPath
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  buildIndex().catch((err) => {
    logError("Index-Build fehlgeschlagen", { error: String(err) });
    process.exit(1);
  });
}
export { buildIndex };
