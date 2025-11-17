import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const DEFAULT_INCIDENT_FILE = path.join(DATA_DIR, "list_filtered.json");
const DEFAULT_CATEGORY_FILE = path.join(DATA_DIR, "conf", "weather-categories.json");
const DEFAULT_OUTPUT_FILE = path.join(DATA_DIR, "weather-incidents.txt");
const DEFAULT_MAIL_DIR = path.join(DATA_DIR, "mail", "taernwetter");
const DEFAULT_WARNING_DATE_FILE = path.join(DATA_DIR, "weather-warning-dates.txt");

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeCategory(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

async function readJsonArray(file, fallback = []) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function loadCategories(file) {
  const entries = await readJsonArray(file, []);
  const set = new Set(entries.map(normalizeCategory).filter(Boolean));
  return set;
}

function parseHeaderDate(headerValue) {
  if (!headerValue) return null;
  const date = new Date(headerValue.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateKey(raw) {
  const match = String(raw || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const fullYear = year < 100 ? 2000 + year : year;
  const parsed = new Date(Date.UTC(fullYear, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : todayKey(parsed);
}

function extractWarningDates(content) {
  if (!content || !/warnug\s*f\u00fcr/i.test(content)) return [];
  const normalized = content.replace(/\r\n/g, "\n");
  const matches = normalized.match(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g) || [];
  const parsed = [];

  for (const raw of matches) {
    const key = parseDateKey(raw);
    if (key && !parsed.includes(key)) parsed.push(key);
  }

  return parsed;
}

function normalizeAddress(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  const match = str.match(/<([^<>]+)>/);
  const address = match ? match[1] : str;
  const normalized = address.trim().toLowerCase();
  return normalized || null;
}

function normalizeAllowedFrom(value) {
  if (!value) return [];
  const source = Array.isArray(value) ? value : String(value).split(/[\n,;]+/);
  const seen = new Set();
  const result = [];

  for (const entry of source) {
    const normalized = normalizeAddress(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function isAllowedSender(headerLine, allowedFrom) {
  if (!allowedFrom?.length) return true;
  const normalized = normalizeAddress(headerLine?.split(":", 2)?.[1] ?? headerLine);
  if (!normalized) return false;
  return allowedFrom.includes(normalized);
}

async function collectWarningDates({ mailDir, allowedFrom }) {
  const dates = new Set();
  try {
    const entries = await fsp.readdir(mailDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => path.join(mailDir, e.name));
    for (const file of files) {
      const content = await fsp.readFile(file, "utf8");
      const fromMatch = content.match(/^from:\s*(.+)$/gim);
      if (!fromMatch || !fromMatch.some((line) => isAllowedSender(line, allowedFrom))) continue;

      const bodyDates = extractWarningDates(content);
      const dateMatch = content.match(/^date:\s*(.+)$/gim);
      const parsedDate = parseHeaderDate(dateMatch?.[0]?.split(":", 2)?.[1]);
      const fallbackKey = todayKey(parsedDate || (await fsp.stat(file)).mtime);

      if (bodyDates.length === 0) {
        dates.add(fallbackKey);
        continue;
      }

      for (const dateKey of bodyDates) {
        dates.add(dateKey);
      }
    }
  } catch (err) {
    if (err?.code !== "ENOENT") console.error("[weather-warning] Mail-Check fehlgeschlagen:", err?.message || err);
  }

  return Array.from(dates);
}

function extractLocation(incident) {
  if (!incident || typeof incident !== "object") return "";
  const candidates = [
    incident.ort,
    incident.ortschaft,
    incident.einsatzort,
    incident.einsatzOrt,
    incident.location,
    incident.place,
    incident.city,
    incident.plzOrt,
  ];
  const found = candidates.find((v) => v != null && String(v).trim());
  return found ? String(found).trim() : "";
}

function collectTextCandidates(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap(collectTextCandidates);
  }

  if (typeof value === "object") {
    const nestedKeys = ["name", "description", "desc", "text", "title", "label", "value"];
    const nestedValues = nestedKeys.map((key) => value[key]);
    return collectTextCandidates(nestedValues);
  }

  const text = String(value).trim();
  return text ? [text] : [];
}

function extractCategories(incident) {
  if (!incident || typeof incident !== "object") return [];

  const rawCandidates = [
    incident.kategorie,
    incident.category,
    incident.kat,
    incident.type,
    incident.typ,
    incident.einsatzart,
    incident.description,
  ];

  const collected = rawCandidates.flatMap(collectTextCandidates);

  const unique = [];
  for (const entry of collected) {
    if (!unique.includes(entry)) unique.push(entry);
  }
  return unique;
}

async function readIncidents(file, fallback = []) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    console.error("[weather-warning] Einsätze konnten nicht gelesen werden:", err?.message || err);
    return fallback;
  }
}

async function writeWeatherIncidents({
  incidents,
  categories,
  outFile,
}) {
  const rows = [];
  const allowed = categories && categories.size ? categories : null;
  for (const incident of incidents) {
    const incidentCategories = extractCategories(incident);
    const category = allowed
      ? incidentCategories.find((cat) => allowed.has(normalizeCategory(cat)))
      : incidentCategories[0];
    if (!category) continue;

    const location = extractLocation(incident);
    if (!location) continue;
    rows.push(`${location} – ${category}`);
  }

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, rows.join("\n"), "utf8");
  console.log(`[weather-warning] ${rows.length} Einträge nach ${outFile} geschrieben.`);
}

async function writeWarningDatesFile({ warningDates, outFile }) {
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, (warningDates || []).join("\n"), "utf8");
}

export async function generateWeatherFileIfWarning({
  incidents = null,
  incidentFile = process.env.FF_OUT_FILE || DEFAULT_INCIDENT_FILE,
  categoryFile = process.env.WEATHER_CATEGORY_FILE || DEFAULT_CATEGORY_FILE,
  outFile = process.env.WEATHER_OUTPUT_FILE || DEFAULT_OUTPUT_FILE,
  mailDir = process.env.WEATHER_MAIL_DIR || DEFAULT_MAIL_DIR,
  allowedFrom = normalizeAllowedFrom(process.env.MAIL_ALLOWED_FROM),
  warningDateFile = process.env.WEATHER_WARNING_DATE_FILE || DEFAULT_WARNING_DATE_FILE,
} = {}) {
  const warningDates = await collectWarningDates({ mailDir, allowedFrom });
  const hasWarning = warningDates.includes(todayKey());

  try {
    await writeWarningDatesFile({ warningDates, outFile: warningDateFile });
  } catch (err) {
    console.error("[weather-warning] Schreiben der Datumsdatei fehlgeschlagen:", err?.message || err);
  }

  if (!hasWarning) {
    try {
      await fsp.unlink(outFile);
      console.log(`[weather-warning] Keine aktuelle Warnung – ${outFile} entfernt.`);
    } catch (err) {
      if (err?.code !== "ENOENT") {
        console.error("[weather-warning] Entfernen der Ausgabedatei fehlgeschlagen:", err?.message || err);
      }
    }
    return;
  }

  const categorySet = await loadCategories(categoryFile);
  if (!categorySet.size) {
    console.warn("[weather-warning] Kategorien-Konfiguration ist leer – keine Filterung möglich.");
  }

  const sourceIncidents = incidents || (await readIncidents(incidentFile, []));
  await writeWeatherIncidents({
    incidents: sourceIncidents,
    categories: categorySet,
    outFile,
  });
}
