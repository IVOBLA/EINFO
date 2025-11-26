import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexPath = path.resolve(__dirname, CONFIG.knowledgeIndexDir, "index.json");

let indexCache = null;

async function loadIndex() {
  if (indexCache) return indexCache;
  try {
    const raw = await fsPromises.readFile(indexPath, "utf8");
    indexCache = JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      logError("Fehler beim Lesen des RAG-Index", { error: String(err) });
    } else {
      logDebug("Kein RAG-Index gefunden, knowledge_index/index.json fehlt.");
    }
    indexCache = { docs: [] };
  }
  return indexCache;
}

// Sehr einfache Volltext-Suche: Scoring nach Häufigkeit von Suchwörtern
export async function retrieveContextChunks({ stateBefore, einfoData }) {
  const idx = await loadIndex();
  if (!idx.docs || idx.docs.length === 0) return [];

  const keywords = collectKeywords(stateBefore, einfoData);
  const uniqueKeywords = [...new Set(keywords.map((k) => k.toLowerCase()))];
  if (uniqueKeywords.length === 0) {
    return idx.docs.slice(0, 3).map(doc => ({
      id: doc.id,
      path: doc.path,
      excerpt: doc.text.slice(0, 1000)
    }));
  }

  const scored = idx.docs
    .map(doc => {
      const textLower = doc.text.toLowerCase();
      let score = 0;
      for (const kw of uniqueKeywords) {
        if (!kw) continue;
        if (!textLower.includes(kw)) continue;
        let pos = textLower.indexOf(kw);
        while (pos !== -1) {
          score += 1;
          pos = textLower.indexOf(kw, pos + kw.length);
        }
      }
      return { doc, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored.map(item => ({
    id: item.doc.id,
    path: item.doc.path,
    excerpt: item.doc.text.slice(0, 1500)
  }));
}

function collectKeywords(stateBefore, einfoData) {
  const kw = [];
  const sc = stateBefore.scenarioConfig || {};
  if (sc.artDesEreignisses) kw.push(sc.artDesEreignisses);
  if (sc.geografischerBereich) kw.push(sc.geografischerBereich);
  if (sc.zeit) kw.push(sc.zeit);
  if (sc.wetter) kw.push(sc.wetter);

  const messages = einfoData.stabMessages || [];
  for (const m of messages) {
    if (typeof m.kurztext === "string") kw.push(m.kurztext);
    if (typeof m.details === "string") kw.push(m.details);
  }

  const lage = einfoData.lageInputs || [];
  for (const l of lage) {
    if (typeof l.beschreibung === "string") kw.push(l.beschreibung);
  }

  return kw.filter(x => typeof x === "string" && x.trim().length > 0).slice(0, 20);
}
