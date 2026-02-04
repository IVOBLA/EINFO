// server/utils/weatherWarning.mjs
// Verantwortlich für Wetterwarnungs-Daten (Datumslogik):
//  - Datumsangaben aus Mails extrahieren
//  - weather-warning-dates.txt pflegen
//  - prüfen, ob heute ein Warn-Datum ist

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const WARNING_DATE_FILE =
  process.env.WEATHER_WARNING_DATE_FILE ||
  path.join(DATA_DIR, "weather-warning-dates.txt");
const WEATHER_INCIDENTS_FILE = path.join(DATA_DIR, "weather-incidents.txt");
const WEATHER_CATEGORY_FILE = path.join(
  DATA_DIR,
  "conf",
  "weather-categories.json"
);

// Hilfsfunktion: YYYY-MM-DD
function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// dd.mm[.yy|yyyy] → YYYY-MM-DD oder null
function parseDateKey(raw) {
  const match = String(raw || "").match(
    /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/
  );
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3]
    ? Number(match[3].length === 2 ? 2000 + Number(match[3]) : match[3])
    : new Date().getFullYear();

  const d = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(d.getTime()) ? null : todayKey(d);
}

function normalizeCategories(raw = []) {
  return (Array.isArray(raw) ? raw : [])
    .map((name) => ({
      raw: String(name).trim(),
      normalized: String(name).trim().toLowerCase(),
    }))
    .filter((item) => Boolean(item.normalized));
}

async function readCategories(file = WEATHER_CATEGORY_FILE) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return normalizeCategories(JSON.parse(raw));
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn(
        "[weather-warning] Wetterkategorien konnten nicht geladen werden:",
        err?.message || err
      );
    }
    return [];
  }
}

// Datumsangaben aus E-Mail-Text extrahieren
function extractWarningDatesFromText(content) {
  if (!content) return [];
  const normalized = String(content).replace(/\r\n/g, "\n");

  const matches =
    normalized.match(/\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/g) || [];

  const out = new Set();
  for (const m of matches) {
    const key = parseDateKey(m);
    if (key) out.add(key);
  }
  return [...out];
}

// Datei lesen/schreiben
async function readWarningDateFile(file = WARNING_DATE_FILE) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.error(
        "[weather-warning] Datei konnte nicht gelesen werden:",
        err?.message || err
      );
    }
    return [];
  }
}

async function writeWarningDateFile(dates, file = WARNING_DATE_FILE) {
  const lines = Array.from(new Set(dates || [])).sort();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, lines.join("\n"), "utf8");
  console.log(
    "[weather-warning] warning-dates aktualisiert:",
    lines.join(", ")
  );
}

async function readIncidentRecords(file = WEATHER_INCIDENTS_FILE) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.warn(
            "[weather-warning] Ungültige Incident-Zeile wird ignoriert",
            err?.message || err
          );
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

function findCategoryForEntry(entry, categories = []) {
  if (!entry) return null;

  const hay = [entry.typ, entry.description, entry.content, entry.title]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ");

  return categories.find((cat) => hay.includes(cat.normalized)) || null;
}

function normalizeCreatedAt(createdAt, fallbackDate = new Date()) {
  const d = createdAt ? new Date(createdAt) : null;
  if (d && Number.isFinite(d.getTime())) return d.toISOString();

  const fallback = fallbackDate instanceof Date ? fallbackDate : new Date();
  return fallback.toISOString();
}

// -----------------------------------------------------------------------------
// Dedupe-Set (In-Memory, Reset bei Restart)
// -----------------------------------------------------------------------------
const DEDUPE_MAX = 2000;
const _dedupeSet = new Set();

function dedupeKey(card, todayUtc, category) {
  const id = card?.id || card?.externalId || card?.title || "unknown";
  return `${id}-${todayUtc}-${category}`;
}

function addDedupeKey(key) {
  if (_dedupeSet.size >= DEDUPE_MAX) {
    const first = _dedupeSet.values().next().value;
    _dedupeSet.delete(first);
  }
  _dedupeSet.add(key);
}

// -----------------------------------------------------------------------------
// Diagnose-Ringbuffer (letzte N Hook-Calls)
// -----------------------------------------------------------------------------
const HOOK_LOG_MAX = 20;
const _hookLog = [];

function pushHookLog(entry) {
  _hookLog.push(entry);
  if (_hookLog.length > HOOK_LOG_MAX) _hookLog.shift();
}

const DEBUG = () => process.env.WEATHER_DEBUG === "1";

function debugLog(...args) {
  if (DEBUG()) console.log("[weather-hook]", ...args);
}

// -----------------------------------------------------------------------------
// SVG-Regeneration + Cache-Invalidierung (lazy-import um Zirkularität zu vermeiden)
// -----------------------------------------------------------------------------

async function regenerateAndInvalidateSvg(overrides = {}) {
  // Dynamischer Import, damit weatherWarning.mjs nicht statisch von
  // generateFeldkirchenSvg.mjs abhängt (vermeidet zirkuläre Abhängigkeiten).
  const {
    generateFeldkirchenSvg: genSvg,
    invalidateFeldkirchenMapCache: invalCache,
  } = overrides._svgModule ||
    (await import("./generateFeldkirchenSvg.mjs"));

  const gen = overrides._generateFeldkirchenSvg || genSvg;
  const inval = overrides._invalidateFeldkirchenMapCache || invalCache;

  const cacheResult = await inval({ show: "weather", hours: 24 });
  debugLog("cache invalidated", cacheResult);

  const svgPath = await gen({ show: "weather", hours: 24, force: true });
  debugLog("svg regenerated", svgPath);

  return { svgPath, cacheResult };
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

// Wird vom Mail-Poll aufgerufen: bekommt eine Liste von Mails { body|text }
export function collectWarningDatesFromMails(mails = []) {
  const set = new Set();
  for (const mail of mails) {
    const body = mail?.body ?? mail?.text ?? "";
    for (const d of extractWarningDatesFromText(body)) {
      set.add(d);
    }
  }
  return [...set];
}

// Convenience-Name für server.js (dein server nutzt collectWarningDates(relevant))
export function collectWarningDates(mails = []) {
  return collectWarningDatesFromMails(mails);
}

// server.js ruft generateWeatherFileIfWarning(warningDates) auf.
// Wir interpretieren das jetzt als: warning-dates.txt pflegen.
// Rückgabe: true, wenn neue Datumswerte hinzugekommen sind.
export async function generateWeatherFileIfWarning(warningDates = []) {
  const existing = await readWarningDateFile();
  const set = new Set(existing);

  let added = 0;
  for (const d of warningDates || []) {
    if (!d) continue;
    if (!set.has(d)) {
      set.add(d);
      added++;
    }
  }

  if (!added) {
    // nichts Neues
    return false;
  }

  await writeWarningDateFile([...set]);
  return true;
}

export async function appendWeatherIncidentFromBoardEntry(entry, options = {}) {
  const {
    categoryFile = WEATHER_CATEGORY_FILE,
    outFile = WEATHER_INCIDENTS_FILE,
    warningDateFile = WARNING_DATE_FILE,
    now = new Date(),
  } = options;

  const today = todayKey(now);
  const dates = await readWarningDateFile(warningDateFile);
  if (!dates.includes(today)) {
    return { appended: false, reason: "no-active-warning" };
  }

  const categories = await readCategories(categoryFile);
  const matchedCategory = findCategoryForEntry(entry, categories);
  if (!matchedCategory) {
    return { appended: false, reason: "no-weather-category" };
  }

  const existing = await readIncidentRecords(outFile);
  const entryIdNorm = entry?.id ? String(entry.id).trim().toLowerCase() : null;

  if (entryIdNorm && existing.some((item) => {
    const itemIdNorm = item?.id ? String(item.id).trim().toLowerCase() : null;
    return itemIdNorm === entryIdNorm;
  })) {
    return { appended: false, reason: "duplicate" };
  }

  const description =
    entry?.description || entry?.content || entry?.title || entry?.typ || "";

  // Fallback duplicate check when ID is missing: same date + category + description
  if (!entryIdNorm) {
    const categoryNorm = String(matchedCategory.raw).trim().toLowerCase();
    const descNorm = String(description).trim().toLowerCase();
    if (existing.some((item) =>
      item.date === today &&
      String(item.category || "").trim().toLowerCase() === categoryNorm &&
      String(item.description || "").trim().toLowerCase() === descNorm
    )) {
      return { appended: false, reason: "duplicate" };
    }
  }

  const incident = {
    id: entry?.id ?? null,
    date: today,
    category: matchedCategory.raw,
    description,
    createdAt: normalizeCreatedAt(entry?.createdAt, now),
  };

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.appendFile(outFile, `${JSON.stringify(incident)}\n`, "utf8");

  return { appended: true, incident };
}

// Prüfen, ob HEUTE in warning-dates steht
export async function isWeatherWarningToday() {
  const dates = await readWarningDateFile();
  return dates.includes(todayKey());
}

// -----------------------------------------------------------------------------
// Zentraler Hook: handleNewIncidentCard
// Wird nach jedem erfolgreichen Card-Create aufgerufen (UI, Fetcher, Import).
// -----------------------------------------------------------------------------
export async function handleNewIncidentCard(card, { source = "unknown" } = {}, options = {}) {
  const {
    categoryFile = WEATHER_CATEGORY_FILE,
    outFile = WEATHER_INCIDENTS_FILE,
    warningDateFile = WARNING_DATE_FILE,
    now = new Date(),
    _skipDedupe = false,
  } = options;

  const ts = new Date().toISOString();
  const today = todayKey(now);

  console.log("[weather-hook] handleNewIncidentCard called", { source, cardId: card?.id, today });

  // Gate 1: Wetterwarnung aktiv?
  const dates = await readWarningDateFile(warningDateFile);
  if (!dates.includes(today)) {
    const result = { appended: false, reason: "no-active-warning", source };
    pushHookLog({ ts, source, reason: result.reason });
    debugLog("skip", source, result.reason);
    return result;
  }

  // Gate 2: Kategorie matcht?
  const categories = await readCategories(categoryFile);
  const matchedCategory = findCategoryForEntry(card, categories);
  if (!matchedCategory) {
    const result = { appended: false, reason: "no-weather-category", source };
    pushHookLog({ ts, source, reason: result.reason });
    debugLog("skip", source, result.reason);
    return result;
  }

  // Gate 3: Dedupe
  if (!_skipDedupe) {
    const dk = dedupeKey(card, today, matchedCategory.raw);
    if (_dedupeSet.has(dk)) {
      const result = { appended: false, reason: "deduped", source };
      pushHookLog({ ts, source, reason: result.reason, dedupeKey: dk });
      debugLog("skip", source, result.reason, dk);
      return result;
    }
    addDedupeKey(dk);
  }

  // Gate 4: Datei-basiertes Duplikat (case-insensitive)
  const existing = await readIncidentRecords(outFile);
  const cardIdNorm = card?.id ? String(card.id).trim().toLowerCase() : null;

  if (cardIdNorm && existing.some((item) => {
    const itemIdNorm = item?.id ? String(item.id).trim().toLowerCase() : null;
    return itemIdNorm === cardIdNorm;
  })) {
    const result = { appended: false, reason: "duplicate", source };
    pushHookLog({ ts, source, reason: result.reason });
    debugLog("skip", source, result.reason, card.id);
    return result;
  }

  const description =
    card?.description || card?.content || card?.title || card?.typ || "";

  // Fallback duplicate check when ID is missing: same date + category + description
  if (!cardIdNorm) {
    const categoryNorm = String(matchedCategory.raw).trim().toLowerCase();
    const descNorm = String(description).trim().toLowerCase();
    if (existing.some((item) =>
      item.date === today &&
      String(item.category || "").trim().toLowerCase() === categoryNorm &&
      String(item.description || "").trim().toLowerCase() === descNorm
    )) {
      const result = { appended: false, reason: "duplicate", source };
      pushHookLog({ ts, source, reason: result.reason });
      debugLog("skip", source, result.reason, "fallback-dedupe");
      return result;
    }
  }

  // Append
  const incident = {
    id: card?.id ?? null,
    date: today,
    category: matchedCategory.raw,
    description,
    source,
    createdAt: normalizeCreatedAt(card?.createdAt, now),
  };

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.appendFile(outFile, `${JSON.stringify(incident)}\n`, "utf8");

  // Harte Regel: logged=true → SVG-Regeneration + Cache-Invalidierung
  try {
    await regenerateAndInvalidateSvg(options);
    debugLog("svg+cache sync done", source, matchedCategory.raw);
  } catch (svgErr) {
    // SVG-Fehler darf den Card-Create-Flow nicht crashen
    console.error(
      "[weather-hook] SVG-Regeneration/Cache-Invalidierung fehlgeschlagen:",
      svgErr?.message || svgErr
    );
    if (DEBUG()) console.error(svgErr);
  }

  const result = { appended: true, incident, source, matchedCategory: matchedCategory.raw };
  pushHookLog({ ts, source, reason: "appended", category: matchedCategory.raw });
  debugLog("appended", source, matchedCategory.raw, card?.id || card?.title);
  return result;
}

// -----------------------------------------------------------------------------
// Diagnose-Daten für GET /api/internal/weather/diagnose
// -----------------------------------------------------------------------------
export function getWeatherHookDiagnose() {
  return {
    lastHookCalls: [..._hookLog],
    dedupeSize: _dedupeSet.size,
  };
}

// -----------------------------------------------------------------------------
// Zentraler Einstiegspunkt (Single Source of Truth)
// Vereinigt Incident-Logging + SVG-Regeneration + Cache-Invalidierung.
// Soll von UI, Fetcher und Import identisch aufgerufen werden.
// -----------------------------------------------------------------------------
export async function handleWeatherIncidentAndSvgForNewCard(card, { source = "unknown" } = {}, options = {}) {
  return handleNewIncidentCard(card, { source }, options);
}
