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
const DEFAULT_BOARD_FILE = path.join(DATA_DIR, "board.json");
const DEFAULT_BOARD_WARN_OPTIONS = {
  categoryFile: process.env.WEATHER_CATEGORY_FILE || DEFAULT_CATEGORY_FILE,
  outFile: process.env.WEATHER_OUTPUT_FILE || DEFAULT_OUTPUT_FILE,
  warningDateFile: process.env.WEATHER_WARNING_DATE_FILE || DEFAULT_WARNING_DATE_FILE,
};

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

async function readLines(file) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.error("[weather-warning] Datei konnte nicht gelesen werden:", err?.message || err);
    }
    return [];
  }
}

function parseHeaderDate(headerValue) {
  if (!headerValue) return null;
  const date = new Date(headerValue.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateKey(raw) {
  const match = String(raw || "").match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] == null ? new Date().getFullYear() : Number(match[3]);
  const fullYear = year < 100 ? 2000 + year : year;
  const parsed = new Date(Date.UTC(fullYear, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : todayKey(parsed);
}

function extractWarningDates(content) {
  if (!content || !/warnung\s*f\u00fcr/i.test(content)) return [];
  const normalized = content.replace(/\r\n/g, "\n");
  const matches = normalized.match(/\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/g) || [];
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
  if (!allowedFrom?.length) return false;
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

export function collectWarningDatesFromMails(mails = []) {
  const dates = new Set();

  for (const mail of mails) {
    if (!mail) continue;

    const bodyDates = extractWarningDates(mail.body ?? mail.text);
    const fallbackKey = todayKey(mail.date ? new Date(mail.date) : new Date());

    if (!bodyDates.length) {
      dates.add(fallbackKey);
      continue;
    }

    for (const dateKey of bodyDates) {
      dates.add(dateKey);
    }
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

function dedupeLines(lines = []) {
  const seen = new Set();
  const result = [];

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
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

async function buildWeatherIncidentLines({
  incidents,
  categories,
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

  return rows;
}

async function readWarningDateFile(file) {
  const existing = await readLines(file);
  return existing.filter(Boolean);
}

async function loadBoardIncidents(boardFile) {
  try {
    const raw = await fsp.readFile(boardFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.error("[weather-warning] Board.json konnte nicht gelesen werden:", err?.message || err);
    }
  }

  return [];
}

function dateKeyFromCreatedAt(value) {
  if (value == null) return null;
  const date = new Date(typeof value === "string" ? Number(value) || value : value);
  return Number.isNaN(date.getTime()) ? null : todayKey(date);
}

function findCategoryInBoardEntry(entry, categories) {
  if (!categories?.size) return null;
  const haystacks = [entry?.description, entry?.desc, entry?.content, entry?.typ];
  for (const hay of haystacks) {
    const text = normalizeCategory(hay);
    if (!text) continue;
    for (const cat of categories) {
      if (text.includes(cat)) return cat;
    }
  }
  return null;
}

function formatBoardLine({ entry, category, dateKey }) {
  const titleCandidates = [entry?.title, entry?.typ, entry?.description, entry?.content];
  const title = titleCandidates.find((v) => v != null && String(v).trim()) || "Einsatz";
  const idSuffix = entry?.id ? ` #${entry.id}` : "";
  return `[${dateKey}] ${String(title).trim()}${idSuffix} – ${category}`;
}

async function collectBoardIncidentLines({ boardFile, warningDates, categories }) {
  const dateSet = new Set(warningDates || []);
  if (!dateSet.size) return [];
  const incidents = await loadBoardIncidents(boardFile);
  const lines = [];

  for (const entry of incidents) {
    const dateKey = dateKeyFromCreatedAt(entry?.createdAt);
    if (!dateKey || !dateSet.has(dateKey)) continue;

    const category = findCategoryInBoardEntry(entry, categories);
    if (!category) continue;

    lines.push(formatBoardLine({ entry, category, dateKey }));
  }

  return lines;
}

async function hasCurrentWarningDate(warningDateFile, dateKey = todayKey()) {
  const warningDates = await readWarningDateFile(warningDateFile);
  const dateSet = new Set(warningDates);
  return dateSet.has(dateKey);
}

export async function appendWeatherIncidentFromBoardEntry(
  entry,
  {
    categoryFile = DEFAULT_BOARD_WARN_OPTIONS.categoryFile,
    outFile = DEFAULT_BOARD_WARN_OPTIONS.outFile,
    warningDateFile = DEFAULT_BOARD_WARN_OPTIONS.warningDateFile,
    now = new Date(),
  } = {},
) {
  if (!entry) return { appended: false, reason: "entry-missing" };

  const dateKey = todayKey(now);
  const warningToday = await hasCurrentWarningDate(warningDateFile, dateKey);
  if (!warningToday) return { appended: false, reason: "no-warning-today" };

  const categories = await loadCategories(categoryFile);
  const category = findCategoryInBoardEntry(entry, categories);
  if (!category) return { appended: false, reason: "no-category-match" };

  const line = formatBoardLine({ entry, category, dateKey });
  const existing = await readLines(outFile);
  if (existing.includes(line)) return { appended: false, reason: "duplicate" };

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, [...existing, line].join("\n"), "utf8");
  return { appended: true, line };
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
  warningDates: providedWarningDates = null,
  boardFile = process.env.BOARD_FILE || DEFAULT_BOARD_FILE,
} = {}) {
  const warningDatesFromFile = await readWarningDateFile(warningDateFile);
  const warningDatesFromMails =
    providedWarningDates ?? (await collectWarningDates({ mailDir, allowedFrom }));
  const warningDates = dedupeLines([...warningDatesFromFile, ...warningDatesFromMails]);
  const warningDateSet = new Set(warningDates);
  const hasWarning = warningDateSet.has(todayKey());

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
  const existingLines = await readLines(outFile);
  const boardLines = await collectBoardIncidentLines({
    boardFile,
    warningDates: warningDateSet,
    categories: categorySet,
  });

  const rows = dedupeLines([
    ...existingLines,
    ...(await buildWeatherIncidentLines({
      incidents: sourceIncidents,
      categories: categorySet,
    })),
    ...boardLines,
  ]);

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, rows.join("\n"), "utf8");
  console.log(`[weather-warning] ${rows.length} Einträge nach ${outFile} geschrieben.`);
}
