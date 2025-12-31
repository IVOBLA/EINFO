import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";
import pdfParse from "pdf-parse";
import { CONFIG } from "../server/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const knowledgeDirAbs = path.resolve(__dirname, CONFIG.knowledgeDir);
const indexDirAbs = path.resolve(__dirname, CONFIG.knowledgeIndexDir);
const indexPath = path.join(indexDirAbs, "index.json");

async function ensureDirs() {
  await fsPromises.mkdir(knowledgeDirAbs, { recursive: true });
  await fsPromises.mkdir(indexDirAbs, { recursive: true });
}

async function loadTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".txt") {
    return fsPromises.readFile(filePath, "utf8");
  } else if (ext === ".pdf") {
    const data = await fsPromises.readFile(filePath);
    const pdfData = await pdfParse(data);
    return pdfData.text || "";
  } else if (ext === ".json") {
    const raw = await fsPromises.readFile(filePath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch (err) {
      console.warn(`[ingest] JSON konnte nicht geparsed werden, verwende Rohinhalt: ${filePath}`);
      return raw;
    }
  } else {
    // z.B. .md oder .log kannst du bei Bedarf ergänzen
    return fsPromises.readFile(filePath, "utf8");
  }
}

async function buildIndex() {
  await ensureDirs();
  const pattern = path.join(knowledgeDirAbs, "**/*.{txt,pdf,json}");
  const files = await glob(pattern, { nodir: true });

  const docs = [];
  for (const file of files) {
    const rel = path.relative(knowledgeDirAbs, file);
    const id = rel.replace(/\\/g, "/");
    try {
      const text = await loadTextFromFile(file);
      if (!text.trim()) continue;
      docs.push({ id, path: rel, text });
      console.log(`[ingest] Indexiere ${rel}, Länge ${text.length}`);
    } catch (err) {
      console.error(`[ingest] Fehler bei ${file}:`, err);
    }
  }

  await fsPromises.writeFile(
    indexPath,
    JSON.stringify({ docs }, null, 2),
    "utf8"
  );
  console.log(`[ingest] Index geschrieben: ${indexPath}, Dokumente: ${docs.length}`);
}

buildIndex().catch(err => {
  console.error("[ingest] Fehler:", err);
  process.exit(1);
});
