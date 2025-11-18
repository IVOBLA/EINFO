// server/utils/weatherWarning.mjs
// Verantwortlich NUR für: Wetter-Mails → weather-warning-dates.txt aktualisieren

import fsp from "node:fs/promises";
import path from "node:path";

export const WARNING_DATE_FILE = path.resolve("server/data/weather-warning-dates.txt");

// Heutiges Datum YYYY-MM-DD
function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// Datum aus E-Mail-Text extrahieren (TT.MM oder TT.MM.JJJJ)
function extractWarningDates(content) {
  if (!content) return [];
  const matches = content.match(/\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/g) || [];
  const unique = new Set();

  for (const m of matches) {
    const [day, month, yearRaw] = m.split(".");
    const year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : new Date().getFullYear();
    unique.add(new Date(Date.UTC(year, Number(month) - 1, Number(day))).toISOString().slice(0, 10));
  }

  return [...unique];
}

// Bestehende Datei lesen
async function readWarningDates() {
  try {
    const raw = await fsp.readFile(WARNING_DATE_FILE, "utf8");
    return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Datei schreiben
async function writeWarningDates(lines) {
  await fsp.writeFile(WARNING_DATE_FILE, lines.join("\n"), "utf8");
}

// -----------------------------------------------------------------------------

// Hauptfunktion: Wird bei jeder neuen Wetter-Mail aufgerufen
export async function updateWarningDatesFromMail(mailContent) {
  const existing = new Set(await readWarningDates());
  const extracted = extractWarningDates(mailContent);

  for (const d of extracted) existing.add(d);

  await writeWarningDates([...existing]);

  console.log("[weather-warning] Aktualisiert:", [...existing]);
}

// Prüfen, ob heute Wetterwarnung aktiv ist
export async function isWeatherWarningToday() {
  const dates = await readWarningDates();
  return dates.includes(todayKey());
}
