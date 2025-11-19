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

// Prüfen, ob HEUTE in warning-dates steht
export async function isWeatherWarningToday() {
  const dates = await readWarningDateFile();
  return dates.includes(todayKey());
}
