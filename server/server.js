import "./utils/loadEnv.mjs";
import express from "express";
import compression from "compression";
import cors from "cors";
import crypto from "node:crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import puppeteer from "puppeteer";
import protocolRouter from "./routes/protocol.js";
import attachPrintRoutes from "./printRoutes.js";
import attachIncidentPrintRoutes from "./routes/incidentPrintRoutes.js";
import aufgabenRoutes from "./routes/aufgabenRoutes.js";
import userRolesRouter from "./routes/userRoles.js";
import createMailRouter from "./routes/mail.js";
import createMailInboxRouter from "./routes/mailInbox.js";
import { isMailConfigured, sendMail } from "./utils/mailClient.mjs";
import { getMailInboxConfig, readAndEvaluateInbox } from "./utils/mailEvaluator.mjs";
import { appendCsvRow } from "./auditLog.mjs";
import createServerPrintRoutes from "./routes/serverPrintRoutes.js";
import { getProtocolCreatedAt, parseAutoPrintTimestamp } from "./utils/autoPrintHelpers.js";
import { getLogDirCandidates } from "./utils/logDirectories.mjs";
import { DATA_ROOT } from "./utils/pdfPaths.mjs";
import {
  generateWeatherFileIfWarning,
  collectWarningDates,
  collectWarningDatesFromMails,
  isWeatherWarningToday,
  handleWeatherIncidentAndSvgForNewCard,
  getWeatherHookDiagnose,
} from "./utils/weatherWarning.mjs";
import {
  generateFeldkirchenSvg,
  deleteFeldkirchenSvg,
  invalidateFeldkirchenMapCache,
} from "./utils/generateFeldkirchenSvg.mjs";
import {
  createMailScheduleRunner,
  sanitizeMailScheduleEntry,
  validateMailScheduleEntry,
} from "./utils/mailSchedule.mjs";
import {
  createApiScheduleRunner,
  sanitizeApiScheduleEntry,
  validateApiScheduleEntry,
} from "./utils/apiSchedule.mjs";

import { appendHistoryEntriesToCsv } from "./utils/protocolCsv.mjs";
import { ensureTaskForRole } from "./utils/tasksService.mjs";
import { fileMutex } from "./utils/fileMutex.mjs";

// 🔐 Neues User-Management
import { User_authMiddleware, User_createRouter, User_requireAuth, User_hasRole } from "./User_auth.mjs";
import { User_update, User_getGlobalFetcher, User_hasGlobalFetcher, User_getGlobalLagekarte } from "./User_store.mjs";

// Fetcher Runner
import { ffStart, ffStop, ffStatus, ffRunOnce } from "./ffRunner.js";
import { syncAiAnalysisLoop } from "./chatbotRunner.js";

// Lagekarte Logger
import {
  maskA,
  sanitizeSnippet,
  sanitizeUrl,
  generateRequestId,
  logLagekarteInfo,
  logLagekarteWarn,
  logLagekarteError,
} from "./utils/lagekarteLogger.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 4040;
const SECURE_COOKIES = process.env.KANBAN_COOKIE_SECURE === "1";

const ROOT      = path.join(__dirname);
const DATA_DIR  = DATA_ROOT;
const DIST_DIR  = path.join(ROOT, "dist");
const PUBLIC_DIR = path.join(ROOT, "public");
const VEH_OVERRIDES = path.join(DATA_DIR, "vehicles-overrides.json");
const VEH_AVAILABILITY_FILE = path.join(DATA_DIR, "vehicles-availability.json");

const BOARD_FILE  = path.join(DATA_DIR, "board.json");
const VEH_BASE    = path.join(DATA_DIR, "conf","vehicles.json");
const VEH_EXTRA   = path.join(DATA_DIR, "vehicles-extra.json");
const GPS_FILE    = path.join(DATA_DIR, "vehicles_gps.json");
const TYPES_FILE  = path.join(DATA_DIR, "conf","types.json");
const LOG_FILE    = path.join(DATA_DIR, "Lage_log.csv");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const ERROR_LOG_FILE_NAME = "Log.txt";
const MAIL_ARCHIVE_DIR = path.join(DATA_DIR, "mail");
const MAIL_SCHEDULE_FILE = path.join(DATA_DIR, "conf", "mail-schedule.json");
const API_SCHEDULE_FILE = path.join(DATA_DIR, "conf", "api-schedule.json");
const errorLogDirCandidates = dedupeDirs([
  ...getLogDirCandidates(),
  path.join(DATA_DIR, "logs"),
  DATA_DIR,
]);
let activeErrorLogDir = null;
let lastErrorLogKey = null;
const GROUPS_FILE = path.join(DATA_DIR, "group_locations.json");
const GROUP_AVAILABILITY_FILE = path.join(DATA_DIR, "group-availability.json");
const GROUP_ALERTED_FILE = path.join(DATA_DIR, "conf", "group-alerted.json");
const PROTOCOL_JSON_FILE = path.join(DATA_DIR, "protocol.json");
const PROTOCOL_CSV_FILE = path.join(DATA_DIR, "protocol.csv");
const AUTO_PRINT_CFG_FILE = path.join(DATA_DIR, "conf", "auto-print.json");
const AI_ANALYSIS_CFG_FILE = path.join(DATA_DIR, "conf", "ai-analysis.json");
const AUTO_PRINT_OUTPUT_DIR = path.resolve(
  process.env.KANBAN_PROTOKOLL_PRINT_DIR || path.join(DATA_DIR, "prints", "protokoll"),
);

const DEFAULT_BOARD_COLUMNS = {
  neu: "Neu",
  "in-bearbeitung": "In Bearbeitung",
  erledigt: "Erledigt",
};

function parseIntervalEnv(name, fallback, { min = 1, allowZero = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  const baseMin = allowZero ? 0 : 1;
  const effectiveMin = Math.max(baseMin, min ?? baseMin);
  if (normalized < effectiveMin) return fallback;
  return normalized;
}

const BOARD_CACHE_MAX_AGE_MS = parseIntervalEnv("BOARD_CACHE_MAX_AGE_MS", 5_000, { min: 0, allowZero: true });
const UI_STATUS_POLL_INTERVAL_MS = parseIntervalEnv("UI_STATUS_POLL_INTERVAL_MS", 3_000);
const UI_ACTIVITY_POLL_INTERVAL_MS = parseIntervalEnv("UI_ACTIVITY_POLL_INTERVAL_MS", 1_000);
const VEHICLE_CACHE_TTL_MS = parseIntervalEnv("VEHICLE_CACHE_TTL_MS", 10_000, { min: 0, allowZero: true });
const AUTO_IMPORT_DEFAULT_INTERVAL_SEC = parseIntervalEnv("AUTO_IMPORT_DEFAULT_INTERVAL_SEC", 30);
const AUTO_PRINT_DEFAULT_INTERVAL_MINUTES = parseIntervalEnv("AUTO_PRINT_DEFAULT_INTERVAL_MINUTES", 10);
const AUTO_PRINT_MIN_INTERVAL_MINUTES = parseIntervalEnv("AUTO_PRINT_MIN_INTERVAL_MINUTES", 1);
const AI_ANALYSIS_DEFAULT_INTERVAL_MINUTES = parseIntervalEnv("AI_ANALYSIS_DEFAULT_INTERVAL_MINUTES", 5);
const AI_ANALYSIS_MIN_INTERVAL_MINUTES = parseIntervalEnv("AI_ANALYSIS_MIN_INTERVAL_MINUTES", 1, { min: 1 });
const FF_ACTIVITY_SWEEP_INTERVAL_MS = parseIntervalEnv("FF_ACTIVITY_SWEEP_INTERVAL_MS", 60_000);
const MAIL_INBOX_POLL_INTERVAL_SEC = parseIntervalEnv("MAIL_INBOX_POLL_INTERVAL_SEC", null);
const MAIL_INBOX_POLL_LIMIT = parseIntervalEnv("MAIL_INBOX_POLL_LIMIT", 50);
const MAIL_SCHEDULE_DEFAULT_INTERVAL_MINUTES = parseIntervalEnv("MAIL_SCHEDULE_DEFAULT_INTERVAL_MINUTES", 60, { min: 1 });
const MAIL_SCHEDULE_MIN_INTERVAL_MINUTES = parseIntervalEnv("MAIL_SCHEDULE_MIN_INTERVAL_MINUTES", 1, { min: 1 });
const MAIL_SCHEDULE_SWEEP_INTERVAL_MS = parseIntervalEnv("MAIL_SCHEDULE_SWEEP_INTERVAL_MS", 60_000, { min: 5_000 });
const API_SCHEDULE_DEFAULT_INTERVAL_MINUTES = parseIntervalEnv("API_SCHEDULE_DEFAULT_INTERVAL_MINUTES", 60, { min: 1 });
const API_SCHEDULE_MIN_INTERVAL_MINUTES = parseIntervalEnv("API_SCHEDULE_MIN_INTERVAL_MINUTES", 1, { min: 1 });
const API_SCHEDULE_SWEEP_INTERVAL_MS = parseIntervalEnv("API_SCHEDULE_SWEEP_INTERVAL_MS", 60_000, { min: 5_000 });

let boardCacheValue = null;
let boardCacheExpiresAt = 0;
let boardCachePromise = null;


// maybeRegenerateFeldkirchenMapForNewCard ist jetzt in
// handleWeatherIncidentAndSvgForNewCard (weatherWarning.mjs) integriert.


const cloneBoard = (value) => {
  if (!value) return value;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

function updateBoardCache(nextBoard) {
  boardCacheValue = cloneBoard(nextBoard);
  boardCacheExpiresAt = Date.now() + BOARD_CACHE_MAX_AGE_MS;
}

function invalidateBoardCache() {
  boardCacheValue = null;
  boardCacheExpiresAt = 0;
  boardCachePromise = null;
}


async function saveBoard(board) {
  await writeJson(BOARD_FILE, board);
  updateBoardCache(board);
}

let vehiclesCacheValue = null;
let vehiclesCacheExpiresAt = 0;
let vehiclesCachePromise = null;

const EINSATZ_HEADERS = [
"Zeitpunkt",
  "Benutzer",
  "EinsatzID",
  "Einsatz",
  "Aktion",
  "Von",
  "Nach",
  "Einheit",
  "Bemerkung",
  "InternID"
];
const AUTO_IMPORT_LOG_OPTIONS = { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" };

function columnDisplayName(board, key) {
  if (!key) return "";
  return board?.columns?.[key]?.name || DEFAULT_BOARD_COLUMNS[key] || key || "";
}

async function appendAutoImportCsvLog({ action, card, columnKey, board }) {
  const logRow = buildEinsatzLog({
    action,
    card,
    from: columnDisplayName(board, columnKey),
    note: card?.ort || "",
    board,
    user: AUTO_IMPORT_USER,
  });

  if (!logRow.Benutzer) logRow.Benutzer = AUTO_IMPORT_USER;

  await appendCsvRow(
    LOG_FILE,
    EINSATZ_HEADERS,
    logRow,
    null,
    AUTO_IMPORT_LOG_OPTIONS,
  );
}

// ==== Auto-Import ====
const AUTO_CFG_FILE         = path.join(DATA_DIR, "conf","auto-import.json");
const AUTO_DEFAULT_FILENAME = "list_filtered.json";
const AUTO_DEFAULT          = { enabled:false, intervalSec:AUTO_IMPORT_DEFAULT_INTERVAL_SEC, filename:AUTO_DEFAULT_FILENAME, demoMode:false };
const AUTO_IMPORT_USER      = "EinsatzInfo";
const AUTO_PRINT_DEFAULT    = { enabled:false, intervalMinutes:AUTO_PRINT_DEFAULT_INTERVAL_MINUTES, lastRunAt:null, entryScope:"interval", scope:"interval" };

function resolveAutoIntervalSeconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : AUTO_DEFAULT.intervalSec;
}

function resolveAutoIntervalMs(value) {
  return resolveAutoIntervalSeconds(value) * 1_000;
}

// Merker für Import-Status
let importLastLoadedAt = null;   // ms
let importLastFile     = null;   // string
let autoNextAt         = null;   // ms – nächster geplanter Auto-Import
let autoPrintTimer     = null;
let autoPrintRunning   = false;

// ----------------- Helpers -----------------
async function ensureDir(p){ await fs.mkdir(p,{ recursive:true }); }

function dedupeDirs(dirs) {
  const seen = new Set();
  const out = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const normalized = path.resolve(dir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function buildEmlFilename(mail) {
  const date = mail.date ? new Date(mail.date) : new Date();
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const safeSubject = (mail.subject || "mail")
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  const base = safeSubject || "mail";
  return `${stamp}_${base}.eml`;
}

async function archiveRelevantMail(mail) {
  try {
    await ensureDir(MAIL_ARCHIVE_DIR);

    const filename = buildEmlFilename(mail);
    const fullPath = path.join(MAIL_ARCHIVE_DIR, filename);

    const from = mail.from || "";
    const to = Array.isArray(mail.to) ? mail.to.join(", ") : (mail.to || "");
    const date = mail.date
      ? new Date(mail.date).toUTCString()
      : new Date().toUTCString();
    const subject = mail.subject || "";
    const body = (mail.body || mail.text || "").replace(/\r\n/g, "\n");

    const content = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
      "",
    ].join("\r\n");

    await fs.writeFile(fullPath, content, "utf8");

    console.log("[mail-archive] .eml gespeichert", {
      id: mail.id,
      file: fullPath,
    });
  } catch (err) {
    console.error("[mail-archive] Fehler beim Speichern der Mail", {
      id: mail.id,
      error: err?.message || String(err),
    });
  }
}



// === Mail-Inbox Polling =====================================================
let mailInboxPollTimer = null;

async function pollMailInboxOnce() {
  try {
    const cfg = getMailInboxConfig();
    const limit = cfg.limit ?? MAIL_INBOX_POLL_LIMIT;

    const { mails } = await readAndEvaluateInbox({ ...cfg, limit });

    // ALLE Mails von MAIL_ALLOWED_FROM sind bereits mit score=1 bewertet
    const relevant = mails.filter((m) => (m.evaluation?.score ?? 0) > 0);

    if (!relevant.length) {
      console.log("[mail-poll] Keine relevanten Mails gefunden");
      return;
    }

    const ids = relevant.map((m) => m.id).join(", ");
    console.log(`[mail-poll] Relevante Mails gefunden: ${ids}`);

    // 1) Alle relevanten Mails als .eml unter DATA_DIR/mail archivieren
    for (const mail of relevant) {
      await archiveRelevantMail(mail);
    }

    // 2) Für jede relevante Mail einen Protokolleintrag erzeugen
    for (const mail of relevant) {
      try {
        await appendProtocolEntryFromMail(mail);
      } catch (err) {
        console.error("[mail-poll] Fehler beim Erzeugen des Protokolleintrags", {
          id: mail.id,
          error: err?.message || String(err),
        });
      }
    }

    // 3) Wetterwarnungs-Dateien anhand der gleichen Mails erzeugen
    try {
      const warningDates = collectWarningDatesFromMails(relevant);
      await generateWeatherFileIfWarning(warningDates);
      console.log("[mail-poll] Wetterwarnungs-Dateien aktualisiert");
    } catch (err) {
      console.error(
        "[mail-poll] Fehler beim Aktualisieren der Wetterwarnungs-Dateien",
        err?.message || err
      );
    }
  } catch (err) {
    console.error("[mail-poll] Fehler beim Lesen des Postfachs", err);
  }
}


// === Mail → Protokoll-Eintrag ===============================================

function snapshotForHistory(src) {
  const seen = new WeakSet();
  const clone = (v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return undefined;
      seen.add(v);
      if (Array.isArray(v)) return v.map(clone);
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === "history") continue;
        o[k] = clone(val);
      }
      return o;
    }
    return v;
  };
  return clone(src);
}

const infoText = (value) =>
  String(value?.information ?? value?.beschreibung ?? value?.text ?? "").trim();

const titleFromAnVon = (value) =>
  String(
    value?.anvon ?? value?.an_von ?? value?.anVon ?? value?.name_stelle ?? value?.nameStelle ?? value?.name ?? "",
  ).trim() || "An/Von";

const collectResponsibleRoles = (value) => {
  const set = new Set();

  if (Array.isArray(value?.verantwortliche)) {
    value.verantwortliche.forEach((role) => {
      const normalized = typeof role === "string" ? role.trim() : String(role ?? "").trim();
      if (normalized) set.add(normalized);
    });
  }

  for (const measure of value?.massnahmen || []) {
    const normalized = typeof measure?.verantwortlich === "string"
      ? measure.verantwortlich.trim()
      : String(measure?.verantwortlich ?? "").trim();
    if (normalized) set.add(normalized);
  }

  return [...set];
};

function senderAddress(mail) {
  const from = mail?.from;
  if (!from) return "";
  if (typeof from?.address === "string") return from.address.trim();
  if (Array.isArray(from) && typeof from[0]?.address === "string") return from[0].address.trim();
  if (Array.isArray(from?.value) && typeof from.value[0]?.address === "string") return from.value[0].address.trim();
  if (typeof from === "string") return from.trim();
  if (typeof from?.text === "string") return from.text.trim();
  return "";
}

async function appendProtocolEntryFromMail(mail) {
  // Aktuelle Protokoll-Liste laden
  const list = await readJson(PROTOCOL_JSON_FILE, []);

  // Datum/Zeit aus Mail (Fallback: jetzt)
  const mailDate = mail.date ? new Date(mail.date) : new Date();
  const iso = mailDate.toISOString();
  const datum = iso.slice(0, 10);   // YYYY-MM-DD
  const zeit = iso.slice(11, 16);   // HH:MM

  // Nächste laufende Nummer ermitteln
  const nextNr =
    list.length > 0
      ? Math.max(
          ...list.map((p) => {
            const n = Number(p.nr || p.NR || 0);
            return Number.isFinite(n) ? n : 0;
          }),
        ) + 1
      : 1;

  // Text aus Body (Fallback: Betreff) und Absender-Adresse
  const subject = (mail.subject || "").trim();
  const body = (mail.text || mail.body || "").trim();
  const information = (body || subject).slice(0, 2000);
  const fromAddress = senderAddress(mail);
  const anvon = fromAddress ? `Von ${fromAddress}` : "Mail-Eingang";
  const actorLabel = "MAIL-AUTO";

  const isWeatherMail = collectWarningDatesFromMails([mail]).length > 0;

  const entry = {
    id: crypto.randomUUID(),
    nr: String(nextNr),

    datum,
    zeit,

    infoTyp: "Lagemeldung",           // oder „Information“ – nach Wunsch anpassbar
    anvon,
    uebermittlungsart: {
      kanalNr: "MAIL",
      kanal: "Mail",
      art: "eingehend",
      ein: true,
      aus: false,
    },

    information,

    ergehtAn: ["LtStb", "S2"],
    verantwortliche: isWeatherMail ? ["S2"] : [],
    bemerkung: "",
    vermerk: "",

    // Basis-Metadaten – ähnlich wie beim normalen Protokoll
    erstelltAm: iso,
    erstelltVon: actorLabel,
    geaendertAm: iso,
    geaendertVon: actorLabel,
    createdBy: actorLabel,
    lastBy: actorLabel,

    printCount: 0,
    history: [],

    otherRecipientConfirmation: {
      confirmed: false,
      by: null,
      byRole: null,
      at: null,
    },

    meta: {
      createdVia: isWeatherMail ? "weather-mail" : "mail",
    },
  };

  if (isWeatherMail) {
    entry.massnahmen = Array.from({ length: 5 }, (_, idx) => ({
      massnahme: "",
      verantwortlich: idx === 0 ? "S2" : "",
      done: false,
    }));
  }

  const historyEntry = {
    ts: Date.now(),
    action: "create",
    by: actorLabel,
    after: snapshotForHistory(entry),
  };

  entry.history.push(historyEntry);
  list.push(entry);
  await writeJson(PROTOCOL_JSON_FILE, list);

  appendHistoryEntriesToCsv(entry, [historyEntry], PROTOCOL_CSV_FILE);

  if (isWeatherMail) {
    try {
      const roles = collectResponsibleRoles(entry);
      const desc = infoText(entry);
      const baseTitle = titleFromAnVon(entry);

      for (const responsible of roles) {
        await ensureTaskForRole({
          roleId: responsible,
          responsibleLabel: responsible,
          protoNr: entry.nr,
          actor: actorLabel,
          actorRole: null,
          item: {
            title: baseTitle,
            type: entry.infoTyp ?? "",
            desc,
            meta: { source: "protokoll", protoNr: entry.nr },
          },
        });
      }
    } catch (err) {
      console.warn("[mail-poll] Aufgabe aus Wettermail konnte nicht erstellt werden", err?.message || err);
    }
  }

  console.log("[mail-poll] Protokolleintrag aus Mail erzeugt", {
    id: entry.id,
    nr: entry.nr,
    from: fromAddress,
    subject,
  });
}



function startMailInboxPolling() {
  if (mailInboxPollTimer || MAIL_INBOX_POLL_INTERVAL_SEC === null) return;
  const intervalMs = MAIL_INBOX_POLL_INTERVAL_SEC * 1_000;
  console.log(
    `[mail-poll] Zyklisches Lesen aktiviert (${MAIL_INBOX_POLL_INTERVAL_SEC}s Intervall, Limit ${MAIL_INBOX_POLL_LIMIT})`,
  );
  pollMailInboxOnce();
  mailInboxPollTimer = setInterval(pollMailInboxOnce, intervalMs);
}

startMailInboxPolling();
attachPrintRoutes(app, "/api/protocol");
attachIncidentPrintRoutes(app, "/api/incidents");

function areaLabel(card = {}, board = null) {
  if (!card) return "";
  const format = (c) => {
    if (!c) return "";
    const idPart = c.humanId ? String(c.humanId) : "";
    const titlePart = c.content ? String(c.content) : "";
    const composed = [idPart, titlePart].filter(Boolean).join(" – ");
    return composed || idPart || titlePart || "";
  };
  if (card.isArea) return format(card) || "Bereich";
  const targetId = card.areaCardId;
  if (!targetId || !board) return "";
  const area = findCardById(board, targetId);
  return format(area);
}

const DEFAULT_AREA_COLOR = "#2563eb";
function normalizeAreaColor(input, fallback = DEFAULT_AREA_COLOR) {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function buildEinsatzLog({ action, card = {}, from = "", to = "", einheit = "", note = "", board = null, user = "" }) {
  const userName = typeof user === "string" ? user.trim() : "";
  return {
    Benutzer: userName,
    EinsatzID: card.humanId || "",
    InternID: card.id || "",
    Einsatz:   card.content || "",
    Aktion:    action || "",
    Von:       from || "",
    Nach:      to || "",
    Einheit:   einheit || "",
    Bemerkung: note || ""
  };
}

// === Aktivität & Auto-Stop (Fetcher) =========================================
let lastActivityMs = Date.now();
function markActivity(reason=""){
  lastActivityMs = Date.now();
  if (reason) console.log(`[activity] ${reason} @ ${new Date().toISOString()}`);
}
const rawAutoStop = process.env.FF_AUTO_STOP_MIN;
const AUTO_STOP_MIN = (() => {
  if (rawAutoStop === undefined || rawAutoStop === "") return null;
  const parsed = Number(rawAutoStop);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 60;
})();
// Ohne FF_AUTO_STOP_MIN (oder leerem Wert) bleibt der Fetcher dauerhaft aktiv.
// Bei ungültigen Werten greifen wir auf 60 Minuten zurück, um bestehendes Verhalten zu erhalten.
const AUTO_STOP_ENABLED = AUTO_STOP_MIN !== null;
let autoStopTimer = null;
autoStopTimer = setInterval(async () => {
  try{
    if (!AUTO_STOP_ENABLED) return;
    const idleMin = (Date.now() - lastActivityMs) / 60000;
    if (idleMin >= AUTO_STOP_MIN) {
      const st = ffStatus();
      if (st.running) {
        console.log(`[auto-stop] ${idleMin.toFixed(1)} min idle → Fetcher stoppen`);
        await ffStop();
        // Auto-Import ebenfalls stoppen & deaktivieren
        try {
          const cfg = await readAutoCfg();
          if (cfg.enabled) {
            await writeAutoCfg({ enabled: false });
            clearAutoTimer();
            autoNextAt = null;
            console.log("[auto-stop] Auto-Import deaktiviert (wegen Fetcher-Auto-Stop)");
          }
        } catch (e) {
          await appendError("auto-stop/disable-autoimport", e);
        }
      }
    }
  }catch(e){
    await appendError("auto-stop", e);
  }
}, FF_ACTIVITY_SWEEP_INTERVAL_MS);

async function writeFileAtomic(file, data, enc="utf8"){
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, data, enc);
  await fs.rename(tmp, file);
}
async function writeJson(file, obj){ await writeFileAtomic(file, JSON.stringify(obj, null, 2), "utf8"); }

async function readJson(file, fallback){
  try{ const txt = await fs.readFile(file, "utf8"); return JSON.parse(txt); }
  catch(e){
    try{ await new Promise(r=>setTimeout(r,50)); const txt2 = await fs.readFile(file, "utf8"); return JSON.parse(txt2); }
    catch{ return fallback; }
  }
}

async function ensureTypeKnown(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return;
  try {
    const current = await readJson(TYPES_FILE, []);
    const entries = Array.isArray(current)
      ? current.filter((entry) => typeof entry === "string" && entry.trim())
      : [];
    const normalized = raw.toLowerCase();
    const exists = entries.some((entry) => entry.trim().toLowerCase() === normalized);
    if (exists) return;
    await writeJson(TYPES_FILE, [...entries, raw]);
  } catch (err) {
    console.warn("[types] konnte types.json nicht aktualisieren:", err?.message || err);
  }
}

async function readOverrides(){ return await readJson(VEH_OVERRIDES, {}); }
async function writeOverrides(next){
  await writeJson(VEH_OVERRIDES, next);
  invalidateVehiclesCache();
}

function collectAssignedVehicleIds(board){
  const assigned = new Set();
  if (!board || typeof board !== "object") return assigned;
  const columns = board.columns && typeof board.columns === "object" ? board.columns : {};
  for (const col of Object.values(columns)) {
    const items = Array.isArray(col?.items) ? col.items : [];
    for (const card of items) {
      const vehicles = Array.isArray(card?.assignedVehicles) ? card.assignedVehicles : [];
      for (const id of vehicles) {
        if (id === null || id === undefined) continue;
        const key = String(id);
        if (key) assigned.add(key);
      }
    }
  }
  return assigned;
}

async function cleanupVehicleOverrides({ board = null, candidateIds = null } = {}){
  const overrides = await readOverrides();
  const keys = Object.keys(overrides || {});
  if (keys.length === 0) return;

  const candidates = candidateIds ? new Set(Array.from(candidateIds, (id) => String(id))) : null;
  let refBoard = board;
  if (!refBoard) {
    try {
      refBoard = await ensureBoard();
    } catch {
      refBoard = null;
    }
  }
  const assigned = collectAssignedVehicleIds(refBoard);

  let changed = false;
  for (const key of keys) {
    const idStr = String(key);
    if (candidates && !candidates.has(idStr)) continue;
    if (!assigned.has(idStr)) {
      delete overrides[key];
      changed = true;
    }
  }

  if (changed) {
    await writeOverrides(overrides);
  }
}

function parseAvailabilityTimestamp(raw) {
  if (raw === null || typeof raw === "undefined") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function sanitizeAvailabilityValue(value) {
  if (value === false) {
    return { unavailable: true, untilMs: null };
  }
  if (value && typeof value === "object") {
    const flag = value.available;
    const unavailable = flag === undefined || flag === null ? true : flag === false;
    if (!unavailable) {
      return { unavailable: false, untilMs: null };
    }
    const untilMs = parseAvailabilityTimestamp(value.until ?? value.untilMs ?? value.untilTimestamp);
    return { unavailable: true, untilMs };
  }
  return { unavailable: false, untilMs: null };
}

function normalizeAvailabilityMap(map = {}) {
  const cleaned = {};
  const now = Date.now();
  let changed = false;

  for (const [key, value] of Object.entries(map || {})) {
    const { unavailable, untilMs } = sanitizeAvailabilityValue(value);
    if (!unavailable) {
      if (value !== undefined) changed = true;
      continue;
    }
    if (Number.isFinite(untilMs) && untilMs <= now) {
      changed = true;
      continue;
    }
    if (Number.isFinite(untilMs)) {
      const iso = new Date(untilMs).toISOString();
      const prevUntilMs =
        value && typeof value === "object"
          ? parseAvailabilityTimestamp(value.until ?? value.untilMs ?? value.untilTimestamp)
          : null;
      const prevIso = Number.isFinite(prevUntilMs) ? new Date(prevUntilMs).toISOString() : null;
      if (value && typeof value === "object" && value.available === false && prevIso === iso) {
        cleaned[key] = value;
      } else {
        cleaned[key] = { available: false, until: iso };
        if (!value || typeof value !== "object" || value.available !== false || prevIso !== iso) {
          changed = true;
        }
      }
    } else {
      cleaned[key] = false;
      if (value !== false) changed = true;
    }
  }

  return { map: cleaned, changed };
}

function getAvailabilityInfo(map, key) {
  const raw = map ? map[key] : undefined;
  const { unavailable, untilMs } = sanitizeAvailabilityValue(raw);
  const untilIso = Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : null;
  return { unavailable, untilIso };
}

async function readVehicleAvailability(){
  const raw = await readJson(VEH_AVAILABILITY_FILE, {});
  const { map, changed } = normalizeAvailabilityMap(raw);
  if (changed) await writeJson(VEH_AVAILABILITY_FILE, map);
  return map;
}
async function writeVehicleAvailability(next){ await writeJson(VEH_AVAILABILITY_FILE, next); }

async function readGroupAvailability(){
  const raw = await readJson(GROUP_AVAILABILITY_FILE, {});
  const { map, changed } = normalizeAvailabilityMap(raw);
  if (changed) await writeJson(GROUP_AVAILABILITY_FILE, map);
  return map;
}
async function writeGroupAvailability(next){ await writeJson(GROUP_AVAILABILITY_FILE, next); }

async function readGroupAlerted(){ return await readJson(GROUP_ALERTED_FILE, {}); }
async function writeGroupAlerted(next){ await writeJson(GROUP_ALERTED_FILE, next); }

// GPS > manuell > leer
async function getAllVehiclesMerged(){
  const base = await getAllVehicles();
  const ov   = await readOverrides();
  return base.map(v=>{
    const hasGps = Number.isFinite(v?.latitude) && Number.isFinite(v?.longitude);
    if (hasGps) return { ...v, source:"gps" };
    const o = ov[v.id];
    if (o && Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
      return { ...v, latitude:o.lat, longitude:o.lng, source:o.source||"manual" };
    }
    return v;
  });
}

// --- Near-Radius aus .env ---
const NEAR_MIN = Number(process.env.NEARBY_RADIUS_MIN_KM) || 0.1;
const NEAR_MAX = Number(process.env.NEARBY_RADIUS_MAX_KM) || 50;
const NEAR_DEFAULT = Number(process.env.NEARBY_RADIUS_KM) || 10;
function resolveRadiusKm(q) {
  const n = Number(q);
  const wanted = (Number.isFinite(n) && n > 0) ? n : NEAR_DEFAULT;
  return Math.max(NEAR_MIN, Math.min(NEAR_MAX, wanted));
}

const pad=n=>String(n).padStart(2,"0");
function tsFile(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; }
function tsHuman(){ return new Intl.DateTimeFormat("de-AT",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()); }
function fmt24(iso){ return new Intl.DateTimeFormat("de-AT",{year:"2-digit",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(iso||Date.now())); }
function uid(){ return Math.random().toString(36).slice(2,10); }
const stripTypePrefix = raw => String(raw||"").replace(/^T\d+\s*,?\s*/i,"").trim();

const HUMAN_ID_PATTERN=/^([EMB])-(\d+)$/i;
const HUMAN_ID_PREFIX_MANUAL = "M";
const HUMAN_ID_PREFIX_AREA = "B";
const HUMAN_ID_PREFIX_IMPORT = "E";

const CLONE_SUFFIX_RE = /(.*?)-(\d+)$/;
const normalizeLabel = (value) => String(value || "").trim().toLowerCase();

async function readExtraVehiclesRaw() {
  return await readJson(VEH_EXTRA, []);
}

function invalidateVehiclesCache() {
  vehiclesCacheValue = null;
  vehiclesCacheExpiresAt = 0;
  vehiclesCachePromise = null;
}

function snapshotVehiclesData(source) {
  if (!source) {
    return { base: [], extra: [], extraRaw: [], labelIndex: new Map() };
  }
  return {
    base: [...source.base],
    extra: [...source.extra],
    extraRaw: [...source.extraRaw],
    labelIndex: new Map(source.labelIndex),
  };
}

function buildVehicleLabelIndex(baseList = [], extraList = []) {
  const index = new Map();
  const push = (veh) => {
    if (!veh) return;
    const key = normalizeLabel(veh.label);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(veh);
  };
  for (const v of baseList) push(v);
  for (const v of extraList) push(v);
  return index;
}

function isCloneMarker(value) {
  return value === true || value === "clone";
}

function detectCloneMeta(entry, labelIndex) {
  if (!entry) return { isClone: false, baseId: null };
  const cloneOfRaw = typeof entry.cloneOf === "string" ? entry.cloneOf.trim() : "";
  if (cloneOfRaw) return { isClone: true, baseId: cloneOfRaw };
  const explicitClone = entry.isClone === true || isCloneMarker(entry.clone);
  if (!explicitClone) return { isClone: false, baseId: null };

  const label = String(entry.label || "");
  const match = label.match(CLONE_SUFFIX_RE);
  if (match) {
    const baseLabel = match[1].trim();
    if (baseLabel) {
      const candidates = labelIndex.get(normalizeLabel(baseLabel)) || [];
      const baseCandidate = candidates.find((veh) => veh.id !== entry.id);
      if (baseCandidate?.id) return { isClone: true, baseId: String(baseCandidate.id) };
      if (baseCandidate) return { isClone: true, baseId: baseLabel };
      return { isClone: true, baseId: baseLabel };
    }
  }
  return { isClone: true, baseId: null };
}

function applyCloneMetadata(extraList, labelIndex) {
  return extraList.map((entry) => {
    if (!entry) return entry;
    const meta = detectCloneMeta(entry, labelIndex);
    if (!meta.isClone) {
      if (typeof entry.cloneOf === "string") {
        return { ...entry, cloneOf: entry.cloneOf };
      }
      return entry;
    }
    const baseId = meta.baseId || "";
    const cloneOf = baseId || (typeof entry.cloneOf === "string" ? entry.cloneOf : "");
    const payload = { ...entry, isClone: true, clone: isCloneMarker(entry.clone) ? entry.clone : "clone" };
    if (cloneOf) payload.cloneOf = cloneOf;
    return payload;
  });
}

async function getVehiclesData() {
  const now = Date.now();
  if (vehiclesCacheValue && vehiclesCacheExpiresAt > now) {
    return snapshotVehiclesData(vehiclesCacheValue);
  }

  if (!vehiclesCachePromise) {
    vehiclesCachePromise = (async () => {
      const base = await readJson(VEH_BASE, []);
      const extraRaw = await readExtraVehiclesRaw();
      const labelIndex = buildVehicleLabelIndex(base, extraRaw);
      const extra = applyCloneMetadata(extraRaw, labelIndex);
      return { base, extra, extraRaw, labelIndex };
    })();
  }

  try {
    const loaded = await vehiclesCachePromise;
    vehiclesCacheValue = loaded;
    vehiclesCacheExpiresAt = Date.now() + VEHICLE_CACHE_TTL_MS;
    return snapshotVehiclesData(loaded);
  } catch (error) {
    vehiclesCacheValue = null;
    vehiclesCacheExpiresAt = 0;
    throw error;
  } finally {
    vehiclesCachePromise = null;
  }
}

function boardHasVehicle(board, vehicleId) {
  if (!board) return false;
  const wanted = String(vehicleId);
  for (const colId of ["neu", "in-bearbeitung", "erledigt"]) {
    const items = board?.columns?.[colId]?.items || [];
    for (const card of items) {
      if ((card?.assignedVehicles || []).some((id) => String(id) === wanted)) return true;
    }
  }
  return false;
}

async function removeClonesByIds(ids, board = null) {
  if (!ids || ids.size === 0) return;
  const normalized = new Set([...ids].map((id) => String(id)));
  if (normalized.size === 0) return;
  const { extraRaw, labelIndex } = await getVehiclesData();
  let changed = false;
  const next = [];
  for (const entry of extraRaw) {
    if (!entry) {
      next.push(entry);
      continue;
    }
    const vid = String(entry?.id || "");
    if (!normalized.has(vid)) {
      next.push(entry);
      continue;
    }
    if (board && boardHasVehicle(board, vid)) {
      next.push(entry);
      continue;
    }
    const meta = detectCloneMeta(entry, labelIndex);
    if (!meta.isClone) {
      next.push(entry);
      continue;
    }
    const cloneOf = meta.baseId || (typeof entry.cloneOf === "string" ? entry.cloneOf : "");
    const payload = { ...entry, isClone: true, clone: isCloneMarker(entry.clone) ? entry.clone : "clone" };
    if (cloneOf) payload.cloneOf = cloneOf;
    if (!isCloneMarker(entry.clone) || !entry.isClone || payload.cloneOf !== entry.cloneOf) {
      changed = true;
    }
    next.push(payload);
  }
  if (changed) {
    await writeJson(VEH_EXTRA, next);
    invalidateVehiclesCache();
  }
}

function ensureHumanIdWithPrefix(value, prefix, allocateNumber) {
  const parsed = parseHumanIdNumber(value);
  if (Number.isFinite(parsed)) {
    return `${prefix}-${parsed}`;
  }
  if (typeof allocateNumber === "function") {
    const next = allocateNumber();
    if (Number.isFinite(next)) {
      return `${prefix}-${next}`;
    }
  }
  return `${prefix}-${Date.now()}`;
}

const ensureAreaHumanIdValue = (value, allocateNumber) =>
  ensureHumanIdWithPrefix(value, HUMAN_ID_PREFIX_AREA, allocateNumber);

const ensureManualHumanIdValue = (value, allocateNumber) =>
  ensureHumanIdWithPrefix(value, HUMAN_ID_PREFIX_MANUAL, allocateNumber);


function parseHumanIdNumber(value){
  if(typeof value!=="string") return null;
  const match=value.trim().match(HUMAN_ID_PATTERN);
  if(!match) return null;
  const num=Number.parseInt(match[2],10);
  return Number.isFinite(num)?num:null;
}

function collectHumanIdStats(board){
  let total=0;
  let max=0;
  const cols=board?.columns||{};
  for(const key of Object.keys(cols)){
    const items=cols[key]?.items||[];
    total+=items.length;
    for(const card of items){
      const n=parseHumanIdNumber(card?.humanId);
      if(Number.isFinite(n)&&n>max) max=n;
    }
  }
  return { total, max };
}

function nextHumanNumber(board){
  const { total, max }=collectHumanIdStats(board);
  return Math.max(total,max)+1;
}


// ---- Fehler-Logging ----
async function appendError(where, err, extra){
  const ts = tsHuman();
  const msg = (err && err.stack) ? String(err.stack) : String(err?.message || err || "-");
  const extraStr = extra ? " " + JSON.stringify(extra) : "";
  const line = `[${ts}] [${where}] ${msg}${extraStr}`;

  const firstChoice = activeErrorLogDir ? [activeErrorLogDir] : [];
  const candidates = [...firstChoice, ...errorLogDirCandidates.filter((dir) => dir !== activeErrorLogDir)];

  for (const dir of candidates) {
    try {
      await ensureDir(dir);
      await fs.appendFile(path.join(dir, ERROR_LOG_FILE_NAME), `${line}\n`, "utf8");
      activeErrorLogDir = dir;
      lastErrorLogKey = null;
      return;
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? error.message
        : String(error);
      const errorKey = `${dir}:${message}`;
      if (lastErrorLogKey !== errorKey) {
        console.error(`[Log.txt] write failed: ${message} (${dir})`);
        lastErrorLogKey = errorKey;
      }
      if (activeErrorLogDir === dir) {
        activeErrorLogDir = null;
      }
    }
  }

  console.error(`[Log.txt] ${line}`);
}

// Für CSV-Log
async function ensureLogFile(){
  await ensureDir(path.dirname(LOG_FILE));
  try{ await fs.access(LOG_FILE); }
  catch{
    await fs.writeFile(
      LOG_FILE,
      "\uFEFFZeitpunkt;Benutzer;EinsatzID;Einsatz;Aktion;Von;Nach;Einheit;Bemerkung\n",
      "utf8"
    );
  }
}


function createEmptyBoard() {
  const columns = {};
  for (const [key, name] of Object.entries(DEFAULT_BOARD_COLUMNS)) {
    columns[key] = { name, items: [] };
  }
  return { columns };
}

function normalizeBoardStructure(inputBoard) {
  const board = (inputBoard && typeof inputBoard === "object") ? inputBoard : createEmptyBoard();
  if (!board.columns || typeof board.columns !== "object") {
    board.columns = {};
  }

  for (const [key, name] of Object.entries(DEFAULT_BOARD_COLUMNS)) {
    const col = board.columns[key];
    if (!col || typeof col !== "object") {
      board.columns[key] = { name, items: [] };
    } else {
      if (typeof col.name !== "string" || !col.name.trim()) col.name = name;
      if (!Array.isArray(col.items)) col.items = [];
    }
  }

  for (const key of Object.keys(board.columns)) {
    const col = board.columns[key];
    if (!Array.isArray(col.items)) col.items = [];
    if (typeof col.name !== "string" || !col.name.trim()) col.name = key;
  }

  const isoNow = new Date().toISOString();
  let highestHumanId = 0;
  for (const col of Object.values(board.columns)) {
    for (const card of col.items) {
      if (!card || typeof card !== "object") continue;
      const parsed = parseHumanIdNumber(card?.humanId);
      if (Number.isFinite(parsed) && parsed > highestHumanId) highestHumanId = parsed;
    }
  }

  const areaIds = new Set();
  const areaColorById = new Map();

  for (const col of Object.values(board.columns)) {
    for (const card of col.items) {
      if (!card || typeof card !== "object") continue;
      card.createdAt ||= isoNow;
      card.statusSince ||= isoNow;
      card.assignedVehicles ||= [];
      card.everVehicles ||= [];
      if (!card.everVehicleLabels || typeof card.everVehicleLabels !== "object" || Array.isArray(card.everVehicleLabels)) {
        card.everVehicleLabels = {};
      }
      if (typeof card.everPersonnel !== "number") card.everPersonnel = 0;
      if (!("externalId" in card)) card.externalId = "";
      if (!("alerted" in card)) card.alerted = "";
      if (!("latitude" in card)) card.latitude = null;
      if (!("longitude" in card)) card.longitude = null;
      if (!("location" in card)) card.location = "";
      if (!("description" in card)) card.description = "";
      if (!("timestamp" in card)) card.timestamp = null;
      if (!("updated" in card)) card.updated = null;
      if (!("isArea" in card)) card.isArea = false;
      if (!("areaCardId" in card)) card.areaCardId = null;
      if (!("areaColor" in card)) card.areaColor = null;

      if (card.isArea) {
        card.areaCardId = null;
        card.areaColor = normalizeAreaColor(card.areaColor || DEFAULT_AREA_COLOR, DEFAULT_AREA_COLOR);
        if (card.id) {
          const idStr = String(card.id);
          areaIds.add(idStr);
          areaColorById.set(idStr, card.areaColor);
        }
      } else if (!card.areaCardId) {
        card.areaColor = null;
      }

      if (typeof card.humanId !== "string" || !card.humanId.trim()) {
        const prefix = card.externalId
          ? HUMAN_ID_PREFIX_IMPORT
          : (card.isArea ? HUMAN_ID_PREFIX_AREA : HUMAN_ID_PREFIX_MANUAL);
        highestHumanId += 1;
        card.humanId = `${prefix}-${highestHumanId}`;
      } else if (card.isArea) {
        card.humanId = ensureAreaHumanIdValue(card.humanId, () => {
          highestHumanId += 1;
          return highestHumanId;
        });
      } else if (!card.externalId && /^B-/i.test(String(card.humanId))) {
        card.humanId = ensureManualHumanIdValue(card.humanId, () => {
          highestHumanId += 1;
          return highestHumanId;
        });
      }
    }
  }

  if (areaIds.size) {
    for (const col of Object.values(board.columns)) {
      for (const card of col.items) {
        if (!card || typeof card !== "object" || card.isArea) continue;
        if (!card.areaCardId) {
          card.areaCardId = null;
          card.areaColor = null;
          continue;
        }
        const refId = String(card.areaCardId);
        if (!areaIds.has(refId)) {
          card.areaCardId = null;
          card.areaColor = null;
        } else {
          card.areaColor = areaColorById.get(refId) || null;
        }
      }
    }
  } else {
    for (const col of Object.values(board.columns)) {
      for (const card of col.items) {
        if (!card || typeof card !== "object") continue;
        card.areaCardId = null;
        card.areaColor = null;
      }
    }
  }

  return board;
}

async function normalizeBoardVehicleRefs(board) {
  if (!board || typeof board !== "object") {
    return { board, changed: false };
  }

  const { base, extra } = await getVehiclesData();
  const vehicles = [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])];

  const knownIds = new Set();
  const labelToIds = new Map();

  for (const veh of vehicles) {
    if (!veh) continue;
    const idStr = String(veh.id ?? "").trim();
    if (!idStr) continue;
    knownIds.add(idStr);
    const labelKey = normalizeLabel(veh.label);
    if (labelKey) {
      if (!labelToIds.has(labelKey)) labelToIds.set(labelKey, new Set());
      labelToIds.get(labelKey).add(idStr);
    }
  }

  const resolveVehicleId = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (knownIds.has(raw)) return raw;
    const labelKey = normalizeLabel(raw);
    if (labelKey && labelToIds.has(labelKey)) {
      const hits = Array.from(labelToIds.get(labelKey)).sort();
      if (hits.length > 0) return hits[0];
    }
    return raw;
  };

  const normalizeIdList = (list) => {
    const arr = Array.isArray(list) ? list : [];
    const next = [];
    const seen = new Set();
    let localChanged = false;
    for (const entry of arr) {
      const resolved = resolveVehicleId(entry);
      if (!resolved) {
        if (entry != null && String(entry).trim() !== "") localChanged = true;
        continue;
      }
      const key = String(resolved);
      if (seen.has(key)) {
        if (String(entry) !== key) localChanged = true;
        continue;
      }
      seen.add(key);
      next.push(key);
      if (String(entry) !== key) localChanged = true;
    }
    if (next.length !== arr.length) localChanged = true;
    return { list: next, changed: localChanged };
  };

  const normalizeLabelMap = (map) => {
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      return { map, changed: false };
    }
    const next = {};
    let localChanged = false;
    for (const [rawKey, value] of Object.entries(map)) {
      const resolved = resolveVehicleId(rawKey);
      const key = resolved ? String(resolved) : String(rawKey);
      if (!(key in next)) next[key] = value;
      if (key !== rawKey) localChanged = true;
    }
    return { map: next, changed: localChanged };
  };

  let changed = false;
  for (const col of Object.values(board.columns || {})) {
    const items = Array.isArray(col?.items) ? col.items : [];
    for (const card of items) {
      if (!card || typeof card !== "object") continue;
      const assigned = normalizeIdList(card.assignedVehicles);
      if (assigned.changed) {
        card.assignedVehicles = assigned.list;
        changed = true;
      }
      const ever = normalizeIdList(card.everVehicles);
      if (ever.changed) {
        card.everVehicles = ever.list;
        changed = true;
      }
      const labelMap = normalizeLabelMap(card.everVehicleLabels);
      if (labelMap.changed) {
        card.everVehicleLabels = labelMap.map;
        changed = true;
      }
    }
  }

  return { board, changed };
}

async function loadBoardFresh() {
  await ensureDir(DATA_DIR);
  const raw = await readJson(BOARD_FILE, null);
  const board = normalizeBoardStructure(raw ?? createEmptyBoard());
  const { changed: idsChanged } = await normalizeBoardVehicleRefs(board);
  await cleanupVehicleOverrides({ board });
  if (!raw || idsChanged) {
    await saveBoard(board);
  } else {
    updateBoardCache(board);
  }
  return board;
}

// --- Distanz (Haversine) ---
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(s1), Math.sqrt(1 - s1));
  return R * c;
}

// ----------------- Middlewares -----------------



app.use(compression({
   filter: (req, res) => {
     // Admin-ZIP-Routen niemals komprimieren
     if (req.path && req.path.startsWith("/api/user/admin/archive")) return false;
     const type = String(res.getHeader?.("Content-Type") || "").toLowerCase();
     if (type.includes("application/zip") || type.includes("application/octet-stream")) return false;
     return compression.filter(req, res);
   }
 }));
app.use(cors({ origin:true, credentials:true }));
app.use(express.json({ limit:"10mb" }));

// ============================================================
// Chatbot-API-Proxy: CRITICAL für Admin Panel Funktionalität
// ============================================================
// WARUM NOTWENDIG:
// 1. Browser Same-Origin Policy (CORS): Frontend kann nicht direkt Port 3100 ansprechen
//    -> Alle Requests müssen vom gleichen Origin kommen (Port 4040)
// 2. Netzwerk-Isolation: Port 3100 oft nicht erreichbar (Docker, Firewall, Reverse Proxy)
//    -> Nur Port 4040 muss exponiert werden
// 3. Deployment-Flexibilität: Chatbot-Server URL konfigurierbar via CHATBOT_BASE_URL
//
// BETROFFENE FEATURES (ohne Proxy nicht funktionsfähig):
// - LLM Model Manager: Modellkonfiguration, GPU-Monitoring, Model Testing
// - Situation Analysis Panel: KI-gestützte Lageanalyse
// - LLM Action History: Protokoll aller LLM-Aktionen
//
// Leitet alle /api/llm/* Anfragen an Chatbot Server weiter (Standard: http://127.0.0.1:3100)
// ============================================================
// Generische Proxy-Funktion für Chatbot-Server Anfragen
async function proxyChatbotRequest(req, res) {
  const CHATBOT_BASE_URL = process.env.CHATBOT_BASE_URL || "http://127.0.0.1:3100";
  const targetUrl = `${CHATBOT_BASE_URL}${req.originalUrl}`;
  const proxyLogPath = path.resolve(process.cwd(), "Proxy.log");

  async function logProxyDebug(lines) {
    if (process.env.DEBUG_PROXY !== "1") return;
    const timestamp = new Date().toISOString();
    const entries = Array.isArray(lines) ? lines : [lines];
    const payload = `${entries.map((line) => `[${timestamp}] ${line}`).join("\n")}\n`;

    try {
      await fs.appendFile(proxyLogPath, payload, "utf8");
    } catch (error) {
      console.error(`[Chatbot Proxy] Failed to write ${proxyLogPath}:`, error.message);
    }
  }

  try {
    // Nur sichere Headers weiterleiten (keine hop-by-hop Headers)
    const safeHeaders = {};
    const hopByHopHeaders = [
      "host", "connection", "keep-alive", "proxy-authenticate",
      "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
      "content-length" // Will be recalculated by fetch
    ];

    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (!hopByHopHeaders.includes(lowerKey) && lowerKey !== "content-type") {
        safeHeaders[key] = value;
      }
    }

    const rawContentType = req.headers["content-type"];
    const contentType = Array.isArray(rawContentType)
      ? rawContentType[0]
      : String(rawContentType || "application/json").split(",")[0].trim();

    const fetchOptions = {
      method: req.method,
      headers: {
        ...safeHeaders,
        "Content-Type": contentType || "application/json"
      }
    };

    // Forward body for POST/PUT/PATCH requests
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      // Always serialize body, even if empty (ensures Content-Length is set correctly)
      const bodyData = req.body && Object.keys(req.body).length > 0 ? req.body : {};
      fetchOptions.body = JSON.stringify(bodyData);

      // Debug logging for troubleshooting body issues
      if (process.env.DEBUG_PROXY === "1") {
        await logProxyDebug([
          `[Chatbot Proxy] ${req.method} ${req.originalUrl}`,
          `[Chatbot Proxy] req.body type: ${typeof req.body}`,
          `[Chatbot Proxy] req.body keys: ${req.body ? Object.keys(req.body).join(", ") : "undefined"}`,
          `[Chatbot Proxy] Forwarding body: ${fetchOptions.body.substring(0, 200)}`
        ]);
      }
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Check if response is SSE stream (Server-Sent Events)
    const responseContentType = response.headers.get("content-type") || "";
    if (responseContentType.includes("text/event-stream")) {
      // SSE streaming: pipe the response directly without parsing
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      // Pipe the stream from chatbot server to client
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (streamError) {
        console.error(`[Chatbot Proxy] SSE stream error:`, streamError.message);
        res.end();
      }
      return;
    }

    // Normal JSON response handling
    const data = await response.json();

    // Debug logging for response
    if (process.env.DEBUG_PROXY === "1" && !data.ok) {
      await logProxyDebug(`[Chatbot Proxy] Response error: ${JSON.stringify(data)}`);
    }

    res.status(response.status).json(data);
  } catch (error) {
    console.error(`[Chatbot Proxy] Error forwarding request to ${targetUrl}:`, error.message);
    res.status(503).json({
      ok: false,
      error: "Chatbot-Server nicht erreichbar. Bitte sicherstellen, dass der Chatbot-Server läuft."
    });
  }
}

// Proxy für /api/llm/* Anfragen an Chatbot Server
app.use("/api/llm", proxyChatbotRequest);
app.use("/api/sim", proxyChatbotRequest);

// Proxy für spezifische /api/situation/* Anfragen an Chatbot Server (KI-Situationsanalyse)
// Hinweis: /api/situation/analysis-config wird lokal im Main-Server verarbeitet (Zeile ~3811)
app.get("/api/situation/status", proxyChatbotRequest);
app.post("/api/situation/analysis-loop/sync", proxyChatbotRequest);
app.get("/api/situation/analysis", proxyChatbotRequest);
app.post("/api/situation/question", proxyChatbotRequest);
app.post("/api/situation/suggestion/feedback", proxyChatbotRequest);
app.post("/api/situation/question/feedback", proxyChatbotRequest);

app.use("/api/protocol", protocolRouter);

app.use("/api/user", userRolesRouter({ dataDir: DATA_DIR }));

app.use(User_authMiddleware({ secureCookies: SECURE_COOKIES }));
app.use("/api/user", User_createRouter({
  dataDir: DATA_DIR,
  secureCookies: SECURE_COOKIES
}));

const INTERNAL_AUTO_PRINT_HEADER = "x-internal-auto-print";
const FELDKIRCHEN_MAP_PATH = "/api/internal/feldkirchen-map";

function isLoopbackAddress(address) {
  if (!address) return false;
  if (address === "127.0.0.1" || address === "::1") return true;
  if (address.startsWith("::ffff:")) {
    const stripped = address.slice("::ffff:".length);
    return stripped === "127.0.0.1";
  }
  return false;
}

function isInternalAutoPrintRequest(req) {
  const raw = req?.headers?.[INTERNAL_AUTO_PRINT_HEADER];
  if (!raw) return false;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (String(value).trim() !== "1") return false;
  const remote = req?.socket?.remoteAddress;
  return isLoopbackAddress(remote);
}

// ===================================================================
// =                         LOG: DOWNLOAD                           =
// ===================================================================
app.get("/api/log.csv", async (_req, res) => {
  await ensureLogFile();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="log.csv"');
  return res.sendFile(LOG_FILE);
});

// Öffentliche Status-Route (ohne Login ok)
app.get("/api/activity/status", async (_req,res)=>{
  const now = Date.now();
  const idleMin = (now - lastActivityMs) / 60000;
  const fetcher = ffStatus();
  const lastIso = importLastLoadedAt ? new Date(importLastLoadedAt).toISOString() : null;
  const autoCfg = await readAutoCfg();
  res.json({
    lastActivityIso: new Date(lastActivityMs).toISOString(),
    idleMinutes: +idleMin.toFixed(2),
    autoStopMin: AUTO_STOP_MIN,
    fetcher,
    auto: { enabled: !!autoCfg.enabled },
    import: { file: importLastFile || AUTO_DEFAULT_FILENAME, lastLoadedIso: lastIso }
  });
});

// 🔒 Ab hier alle /api-Routen (außer /api/user/* & /api/activity/status) nur mit Login
app.use((req,res,next)=>{
  if (!req.path?.startsWith("/api")) return next();
  if (req.path.startsWith("/api/user/")) return next();
  if (req.path === "/api/activity/status") return next();
  if (req.path.startsWith("/api/print/server") && isInternalAutoPrintRequest(req)) return next();
  if (req.path === FELDKIRCHEN_MAP_PATH && isLoopbackAddress(req?.socket?.remoteAddress)) return next();
  if (!req.user) return res.status(401).json({ ok:false, error:"UNAUTHORIZED" });
  next();
});

function normalizeFeldkirchenShowParam(value) {
  if (typeof value !== "string") return "weather";
  const normalized = value.trim().toLowerCase();
  if (["weather", "all"].includes(normalized)) return normalized;
  return null;
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

// ===================================================================
// =           FELDKIRCHEN-KARTE: MANUELLER GET-ENDPUNKT              =
// ===================================================================
app.get(FELDKIRCHEN_MAP_PATH, async (req, res) => {
  const show = normalizeFeldkirchenShowParam(req.query?.show);
  if (!show) {
    return res.status(400).json({
      ok: false,
      error: 'Parameter "show" muss "weather" oder "all" sein.',
    });
  }

  const hours = normalizePositiveNumber(req.query?.hours, 24);

  try {
    const outputFile = await generateFeldkirchenSvg({ show, hours });
    res.type("image/svg+xml");
    return res.sendFile(outputFile);
  } catch (err) {
    await appendError("feldkirchen-map", err);
    res
      .status(500)
      .json({ ok: false, error: "Karte konnte nicht erzeugt werden." });
  }
});

app.delete(FELDKIRCHEN_MAP_PATH, async (req, res) => {
  const show = normalizeFeldkirchenShowParam(req.query?.show);
  if (!show) {
    return res.status(400).json({
      ok: false,
      error: 'Parameter "show" muss "weather" oder "all" sein.',
    });
  }

  const hours = normalizePositiveNumber(req.query?.hours, 24);

  try {
    const result = await deleteFeldkirchenSvg({ show, hours });
    return res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    await appendError("feldkirchen-map", err);
    res
      .status(500)
      .json({ ok: false, error: "Karte konnte nicht gelöscht werden." });
  }
});

// ==== Wetter-Diagnose ====
app.get("/api/internal/weather/diagnose", async (_req, res) => {
  try {
    const warningToday = await isWeatherWarningToday();
    const hookDiagnose = getWeatherHookDiagnose();
    res.json({
      ok: true,
      warningToday,
      lastHookCalls: hookDiagnose.lastHookCalls,
      dedupeSize: hookDiagnose.dedupeSize,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ==== Zeitgesteuerte Mails ====

const MAIL_SCHEDULE_OPTIONS = {
  defaultIntervalMinutes: MAIL_SCHEDULE_DEFAULT_INTERVAL_MINUTES,
  minIntervalMinutes: MAIL_SCHEDULE_MIN_INTERVAL_MINUTES,
};

const API_SCHEDULE_OPTIONS = {
  defaultIntervalMinutes: API_SCHEDULE_DEFAULT_INTERVAL_MINUTES,
  minIntervalMinutes: API_SCHEDULE_MIN_INTERVAL_MINUTES,
};

const mailSchedule = createMailScheduleRunner({
  dataDir: DATA_DIR,
  scheduleFile: MAIL_SCHEDULE_FILE,
  defaultIntervalMinutes: MAIL_SCHEDULE_OPTIONS.defaultIntervalMinutes,
  minIntervalMinutes: MAIL_SCHEDULE_OPTIONS.minIntervalMinutes,
  sweepIntervalMs: MAIL_SCHEDULE_SWEEP_INTERVAL_MS,
  sendMail,
  isMailConfigured,
  appendError,
  readJson,
  writeJson,
});

const { startMailScheduleTimer, clearMailScheduleTimer, readMailSchedule, writeMailSchedule } = mailSchedule;

const apiSchedule = createApiScheduleRunner({
  scheduleFile: API_SCHEDULE_FILE,
  defaultIntervalMinutes: API_SCHEDULE_OPTIONS.defaultIntervalMinutes,
  minIntervalMinutes: API_SCHEDULE_OPTIONS.minIntervalMinutes,
  sweepIntervalMs: API_SCHEDULE_SWEEP_INTERVAL_MS,
  appendError,
  readJson,
  writeJson,
});

const { startApiScheduleTimer, clearApiScheduleTimer, readApiSchedule, writeApiSchedule } = apiSchedule;

app.use("/api/mail/inbox", createMailInboxRouter());
app.use("/api/mail", createMailRouter());

app.get("/api/mail/schedule", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const schedules = await readMailSchedule();
  res.json({ ok:true, schedules });
});

app.post("/api/mail/schedule", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  try {
    const base = sanitizeMailScheduleEntry(
      { ...req.body, id: crypto.randomUUID(), lastSentAt: null },
      MAIL_SCHEDULE_OPTIONS
    );
    const validationError = validateMailScheduleEntry(base, MAIL_SCHEDULE_OPTIONS);
    if (validationError) {
      return res.status(400).json({ ok:false, error: validationError });
    }
    const current = await readMailSchedule();
    const schedules = await writeMailSchedule([...current, base]);
    await startMailScheduleTimer({ immediate: true });
    res.json({ ok:true, entry: base, schedules });
  } catch (err) {
    await appendError("mail-schedule/create", err);
    res.status(400).json({ ok:false, error: err?.message || "Speichern fehlgeschlagen" });
  }
});

app.put("/api/mail/schedule/:id", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const scheduleId = String(req.params?.id || "");
  try {
    const current = await readMailSchedule();
    const idx = current.findIndex((entry) => entry.id === scheduleId);
    if (idx < 0) {
      return res.status(404).json({ ok:false, error:"NOT_FOUND" });
    }
    const merged = { ...current[idx], ...req.body, id: current[idx].id };
    if (req.body?.resetLastSent) {
      merged.lastSentAt = null;
    }
    const normalized = sanitizeMailScheduleEntry(merged, MAIL_SCHEDULE_OPTIONS);
    const validationError = validateMailScheduleEntry(normalized, MAIL_SCHEDULE_OPTIONS);
    if (validationError) {
      return res.status(400).json({ ok:false, error: validationError });
    }
    const next = current.slice();
    next[idx] = normalized;
    const schedules = await writeMailSchedule(next);
    await startMailScheduleTimer({ immediate: true });
    res.json({ ok:true, entry: normalized, schedules });
  } catch (err) {
    await appendError("mail-schedule/update", err, { id: scheduleId });
    res.status(400).json({ ok:false, error: err?.message || "Speichern fehlgeschlagen" });
  }
});

app.delete("/api/mail/schedule/:id", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const scheduleId = String(req.params?.id || "");
  try {
    const current = await readMailSchedule();
    const next = current.filter((entry) => entry.id !== scheduleId);
    if (next.length === current.length) {
      return res.status(404).json({ ok:false, error:"NOT_FOUND" });
    }
    const schedules = await writeMailSchedule(next);
    await startMailScheduleTimer({ immediate: true });
    res.json({ ok:true, schedules });
  } catch (err) {
    await appendError("mail-schedule/delete", err, { id: scheduleId });
    res.status(400).json({ ok:false, error: err?.message || "Löschen fehlgeschlagen" });
  }
});


app.get("/api/http/schedule", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const schedules = await readApiSchedule();
  res.json({ ok:true, schedules });
});

app.post("/api/http/schedule", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  try {
    const base = sanitizeApiScheduleEntry(
      { ...req.body, id: crypto.randomUUID(), lastRunAt: null },
      API_SCHEDULE_OPTIONS
    );
    const validationError = validateApiScheduleEntry(base, API_SCHEDULE_OPTIONS);
    if (validationError) {
      return res.status(400).json({ ok:false, error: validationError });
    }
    const current = await readApiSchedule();
    const schedules = await writeApiSchedule([...current, base]);
    await startApiScheduleTimer({ immediate: true });
    res.json({ ok:true, entry: base, schedules });
  } catch (err) {
    await appendError("api-schedule/create", err);
    res.status(400).json({ ok:false, error: err?.message || "Speichern fehlgeschlagen" });
  }
});

app.put("/api/http/schedule/:id", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const scheduleId = String(req.params?.id || "");
  try {
    const current = await readApiSchedule();
    const idx = current.findIndex((entry) => entry.id === scheduleId);
    if (idx < 0) {
      return res.status(404).json({ ok:false, error:"NOT_FOUND" });
    }
    const merged = { ...current[idx], ...req.body, id: current[idx].id };
    if (req.body?.resetLastRun) {
      merged.lastRunAt = null;
    }
    const normalized = sanitizeApiScheduleEntry(merged, API_SCHEDULE_OPTIONS);
    const validationError = validateApiScheduleEntry(normalized, API_SCHEDULE_OPTIONS);
    if (validationError) {
      return res.status(400).json({ ok:false, error: validationError });
    }
    const next = current.slice();
    next[idx] = normalized;
    const schedules = await writeApiSchedule(next);
    await startApiScheduleTimer({ immediate: true });
    res.json({ ok:true, entry: normalized, schedules });
  } catch (err) {
    await appendError("api-schedule/update", err, { id: scheduleId });
    res.status(400).json({ ok:false, error: err?.message || "Speichern fehlgeschlagen" });
  }
});

app.delete("/api/http/schedule/:id", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const scheduleId = String(req.params?.id || "");
  try {
    const current = await readApiSchedule();
    const next = current.filter((entry) => entry.id !== scheduleId);
    if (next.length === current.length) {
      return res.status(404).json({ ok:false, error:"NOT_FOUND" });
    }
    const schedules = await writeApiSchedule(next);
    await startApiScheduleTimer({ immediate: true });
    res.json({ ok:true, schedules });
  } catch (err) {
    await appendError("api-schedule/delete", err, { id: scheduleId });
    res.status(400).json({ ok:false, error: err?.message || "Löschen fehlgeschlagen" });
  }
});


app.use("/api/print/server", createServerPrintRoutes({ baseDir: DATA_DIR }));

// ===================================================================
// =                         BOARD & VEHICLES                        =
// ===================================================================
async function ensureBoard(){
  const now = Date.now();
  if (boardCacheValue && boardCacheExpiresAt > now) {
    return cloneBoard(boardCacheValue);
  }

  if (!boardCachePromise) {
    boardCachePromise = loadBoardFresh()
      .catch((error) => {
        invalidateBoardCache();
        throw error;
      })
      .finally(() => {
        boardCachePromise = null;
      });
  }

  const board = await boardCachePromise;
  return cloneBoard(boardCacheValue ?? board);
}
async function getAllVehicles(){
  const { base, extra } = await getVehiclesData();
  const availability = await readVehicleAvailability().catch(() => ({}));
  const groupAvailability = await readGroupAvailability().catch(() => ({}));
  const list = [...base, ...extra];
  return list.map((veh) => {
    if (!veh) return veh;
    const idStr = String(veh.id ?? "");
    const ortStr = String(veh.ort ?? "");
    const vehicleInfo = getAvailabilityInfo(availability || {}, idStr);
    const groupInfo = getAvailabilityInfo(groupAvailability || {}, ortStr);
    const vehicleAvailable = !vehicleInfo.unavailable;
    const groupAvailable = !groupInfo.unavailable;
    const combinedAvailable = vehicleAvailable && groupAvailable;
    let unavailableUntil = null;
    if (!combinedAvailable) {
      const candidates = [];
      if (vehicleInfo.untilIso) candidates.push(vehicleInfo.untilIso);
      if (groupInfo.untilIso) candidates.push(groupInfo.untilIso);
      if (candidates.length > 0) {
        unavailableUntil = candidates.reduce((latest, candidate) => {
          if (!latest) return candidate;
          const latestMs = Date.parse(latest);
          const candidateMs = Date.parse(candidate);
          if (!Number.isFinite(latestMs)) return candidate;
          if (!Number.isFinite(candidateMs)) return latest;
          return candidateMs > latestMs ? candidate : latest;
        }, null);
      }
    }
    return { ...veh, available: combinedAvailable, groupAvailable, unavailableUntil };
  });
}
const vehiclesByIdMap = list => new Map(list.map(v=>[v.id,v]));
const computedPersonnel = (card,vmap)=>(card.assignedVehicles||[]).reduce((s,vid)=>s+(vmap.get(vid)?.mannschaft??0),0);

function extractVehicleLabelParts(entry) {
  if (!entry) return { label: "", ort: "" };
  if (typeof entry === "string") return { label: entry, ort: "" };
  const label = typeof entry.label === "string" ? entry.label : "";
  const ort = typeof entry.ort === "string" ? entry.ort : "";
  return { label, ort };
}

function formatVehicleDisplay(veh, fallbackEntry, fallbackId = "") {
  const { label: fallbackLabel, ort: fallbackOrt } = extractVehicleLabelParts(fallbackEntry);
  const rawLabel = typeof veh?.label === "string" ? veh.label : fallbackLabel;
  const rawOrt = typeof veh?.ort === "string" ? veh.ort : fallbackOrt;
  const idStr = (() => {
    if (veh?.id !== undefined && veh?.id !== null) return String(veh.id);
    if (fallbackId !== undefined && fallbackId !== null && fallbackId !== "") return String(fallbackId);
    return "";
  })();
  const label = String(rawLabel || "").trim();
  const ort = String(rawOrt || "").trim();
  const finalLabel = label || idStr || "Unbekannt";
  const finalOrt = ort || "Unbekannt";
  return `${finalLabel} (${finalOrt})`;
}

function formatVehicleDisplayById(id, vmap, labelStore) {
  const idKey = id != null ? String(id) : "";
  const map = vmap instanceof Map ? vmap : null;
  const vehicle = map?.get?.(id) ?? map?.get?.(idKey) ?? map?.get?.(Number(idKey)) ?? null;
  const fallbackEntry = labelStore ? labelStore[idKey] : undefined;
  return formatVehicleDisplay(vehicle, fallbackEntry, idKey);
}
function findCardRef(board,cardId){
  for(const k of ["neu","in-bearbeitung","erledigt"]){
    const arr = board.columns[k].items||[];
    const i = arr.findIndex(c=>c.id===cardId);
    if(i>=0) return { col:k, arr, i, card:arr[i] };
  }
  return null;
}

function findCardById(board,id){
  if(!id) return null;
  const wanted=String(id);
  for(const k of ["neu","in-bearbeitung","erledigt"]){
    const hit=(board.columns[k].items||[]).find(c=>String(c?.id||"")===wanted);
    if(hit) return hit;
  }
  return null;
}

function listAreaCards(board){
  const out=[];
  for(const k of ["neu","in-bearbeitung","erledigt"]){
    for(const c of (board.columns[k].items||[])){
      if(c?.isArea) out.push(c);
    }
  }
  return out;
}

function findCardByExternalId(board,extId){
  if(!extId) return null;
  for(const k of ["neu","in-bearbeitung","erledigt"]){
    const hit=(board.columns[k].items||[]).find(c=>String(c.externalId||"")===String(extId));
    if(hit) return hit;
  }
  return null;
}

function findCardByCoordinates(board, lat, lng, columnKeys = ["neu", "in-bearbeitung"]) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  const epsilon = 1e-6;
  for (const key of columnKeys) {
    const items = board?.columns?.[key]?.items || [];
    const match = items.find((card) => {
      const cLat = Number(card?.latitude);
      const cLng = Number(card?.longitude);
      if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) return false;
      return Math.abs(cLat - latNum) <= epsilon && Math.abs(cLng - lngNum) <= epsilon;
    });
    if (match) return match;
  }
  return null;
}

// --- API: Basics ---
app.get("/api/board",    async (_req,res)=>res.json(await ensureBoard()));
app.get("/api/vehicles", async (_req,res)=>res.json(await getAllVehiclesMerged()));
app.get("/api/groups/availability", async (_req,res)=>{
  const availability = await readGroupAvailability().catch(() => ({}));
  res.json({ availability });
});
app.get("/api/groups/alerted", async (_req,res)=>{
  const alerted = await readGroupAlerted().catch(() => ({}));
  res.json({ alerted });
});

app.get("/api/gps", async (_req,res)=>{
  try{ const txt = await fs.readFile(GPS_FILE, "utf8"); res.type("json").send(txt); }
  catch{ res.json([]); }
});

app.get("/api/types", async (_req,res)=>{ try{ res.json(await readJson(TYPES_FILE,[])); }catch{ res.json([]); } });

// Note: /api/llm/action-history is handled by the chatbot server via proxy
// See server.js:1479-1515 for proxy implementation

app.post("/api/vehicles", async (req,res)=>{
  const { ort, label, mannschaft=0, cloneOf="" } = req.body||{};
  if(!ort||!label) return res.status(400).json({ error:"ort und label sind erforderlich" });

  const cloneTag = typeof cloneOf === "string" ? cloneOf.trim() : "";
  const isCloneRequest = !!cloneTag;

  const result = await fileMutex.withLock("vehicles-extra", async () => {
    const extra = await readExtraVehiclesRaw();
    if (!isCloneRequest) {
      const exists = extra.find(v => {
        if ((v.ort||"")!==ort) return false;
        if ((v.label||"")!==label) return false;
        const existingCloneTag = typeof v.cloneOf === "string" ? v.cloneOf.trim() : "";
        if (existingCloneTag) return false;
        if (v.isClone === true) return false;
        if (isCloneMarker(v.clone)) return false;
        return true;
      });
      if(exists) return { conflict: true };
    }

    const id = `X${Math.random().toString(36).slice(2,8)}`;
    const v  = { id, ort, label, mannschaft: Number(mannschaft)||0 };
    if (isCloneRequest) {
      v.cloneOf = cloneTag;
      v.isClone = true;
      v.clone = "clone";
    }
    extra.push(v);
    await writeJson(VEH_EXTRA, extra);
    invalidateVehiclesCache();
    return { vehicle: v };
  });
  if (result.conflict) return res.status(409).json({ error:"Einheit existiert bereits" });

  const action = isCloneRequest ? "Einheit geteilt" : "Einheit angelegt";
  await appendCsvRow(
    LOG_FILE,
    EINSATZ_HEADERS,
    buildEinsatzLog({ action, note: `${label} (${ort})` }),
    req,
    { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
  );
  res.json({ ok:true, vehicle:result.vehicle });
});

app.patch("/api/vehicles/:id/availability", async (req,res)=>{
  const id = String(req.params?.id || "").trim();
  if(!id) return res.status(400).json({ ok:false, error:"vehicle id erforderlich" });
  const all = await getAllVehicles();
  const exists = all.find(v=>String(v?.id||"")===id);
  if(!exists) return res.status(404).json({ ok:false, error:"vehicle not found" });
  const available = req.body?.available !== false;
  let untilIso = null;
  if (!available) {
    const untilMs = parseAvailabilityTimestamp(
      req.body?.until ?? req.body?.untilMs ?? req.body?.untilTimestamp
    );
    if (Number.isFinite(untilMs) && untilMs > Date.now()) {
      untilIso = new Date(untilMs).toISOString();
    }
  }
  await fileMutex.withLock("vehicle-availability", async () => {
    const map = await readVehicleAvailability().catch(() => ({}));
    if (available) delete map[id];
    else if (untilIso) map[id] = { available: false, until: untilIso };
    else map[id] = false;
    await writeVehicleAvailability(map);
  });
  res.json({ ok:true, id, available, until: untilIso });
});

app.patch("/api/groups/:name/availability", async (req,res)=>{
  const name = String(req.params?.name || "").trim();
  if(!name) return res.status(400).json({ ok:false, error:"group name erforderlich" });
  const available = req.body?.available !== false;
  let untilIso = null;
  if (!available) {
    const untilMs = parseAvailabilityTimestamp(
      req.body?.until ?? req.body?.untilMs ?? req.body?.untilTimestamp
    );
    if (Number.isFinite(untilMs) && untilMs > Date.now()) {
      untilIso = new Date(untilMs).toISOString();
    }
  }
  // Lock both group and vehicle availability together to prevent partial updates
  await fileMutex.withLock("vehicle-availability", async () => {
    const map = await readGroupAvailability().catch(() => ({}));
    if (available) delete map[name];
    else if (untilIso) map[name] = { available: false, until: untilIso };
    else map[name] = false;
    await writeGroupAvailability(map);

    const vehicleAvailability = await readVehicleAvailability().catch(() => ({}));
    const allVehicles = await getAllVehicles();
    for (const vehicle of allVehicles) {
      if (!vehicle) continue;
      const ort = String(vehicle.ort ?? "");
      if (ort !== name) continue;
      const idStr = String(vehicle.id ?? "");
      if (!idStr) continue;
      if (available) delete vehicleAvailability[idStr];
      else if (untilIso) vehicleAvailability[idStr] = { available: false, until: untilIso };
      else vehicleAvailability[idStr] = false;
    }
    await writeVehicleAvailability(vehicleAvailability);
  });

  res.json({ ok:true, name, available, until: untilIso });
});

// ---- Karten anlegen (mit Koordinaten) ----
app.post("/api/cards", async (req, res) => {
  let {
    title,
    columnId = "neu",
    toIndex = 0,
    ort = "",
    typ = "",
    externalId = "",
    alerted = "",
    latitude = null,
    longitude = null,
    location = "",
    description = "",
    timestamp = null,
	isArea = false,
    areaCardId = null,
	areaColor = null
  } = req.body || {};

  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title erforderlich" });
  }

  const { board, card, key } = await fileMutex.withLock("board", async () => {
    const board = await ensureBoard();

    const now = new Date().toISOString();
    const cleanTitle = stripTypePrefix(title);
    const key = ["neu", "in-bearbeitung", "erledigt"].includes(columnId) ? columnId : "neu";

    const nextHumanIdNumber = nextHumanNumber(board);
    const manualHumanId = `${HUMAN_ID_PREFIX_MANUAL}-${nextHumanIdNumber}`;
    const areaHumanId = `${HUMAN_ID_PREFIX_AREA}-${nextHumanIdNumber}`;

    const latIn = latitude ?? req.body?.lat;
    const lngIn = longitude ?? req.body?.lng;

    const isAreaBool = !!isArea;
    const areaIdStr = areaCardId ? String(areaCardId) : null;
    const requestedAreaColor = areaColor;

    const card = {
      id: uid(),
      content: cleanTitle,
      createdAt: now,
      statusSince: now,
      assignedVehicles: [],
      everVehicles: [],
      everVehicleLabels: {},
      everPersonnel: 0,
      ort,
      typ,
      externalId,
      alerted,
      humanId: isAreaBool ? areaHumanId : manualHumanId,
      latitude: Number.isFinite(+latIn) ? +latIn : null,
      longitude: Number.isFinite(+lngIn) ? +lngIn : null,
      location: String(location || ""),
      description: String(description || "").trim(),
      timestamp: timestamp ? new Date(timestamp).toISOString() : null,
      isArea: isAreaBool,
      areaCardId: null,
      areaColor: null,
    };

    if (!card.isArea && areaIdStr) {
      const area = findCardById(board, areaIdStr);
      if (area?.isArea) card.areaCardId = String(area.id);
    }

    if (card.isArea) {
      card.areaColor = normalizeAreaColor(requestedAreaColor || DEFAULT_AREA_COLOR, DEFAULT_AREA_COLOR);
    } else if (card.areaCardId) {
      const area = findCardById(board, card.areaCardId);
      card.areaColor = area?.areaColor || null;
    }
    const arr = board.columns[key].items;
    arr.splice(Math.max(0, Math.min(Number(toIndex) || 0, arr.length)), 0, card);

    await ensureTypeKnown(card.typ);
    await saveBoard(board);
    return { board, card, key };
  });

  await appendCsvRow(
    LOG_FILE, EINSATZ_HEADERS,
    buildEinsatzLog({ action:"Einsatz erstellt", card, from:board.columns[key].name, note:card.ort || "", board }),
    req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
  );

  await handleWeatherIncidentAndSvgForNewCard(card, { source: "ui" });
  markActivity("card:create");
  res.json({ ok: true, card, column: key });
});

app.post("/api/cards/:id/move", async (req,res)=>{
  const { id }=req.params;
  const { from, to, toIndex=0 }=req.body||{};

  const result = await fileMutex.withLock("board", async () => {
    const board=await ensureBoard();
    const src=board.columns[from]?.items||[];
    const idx=src.findIndex(c=>c.id===id);
    if(idx<0) return { notFound: true };

    const [card]=src.splice(idx,1);
    const dst=board.columns[to]?.items||[];
    if(from!==to) card.statusSince=new Date().toISOString();
    const fromName = board.columns[from]?.name || from || "";
    const toName   = board.columns[to]?.name   || to   || "";

    let clonesToRemove = null;
    let groupsToResolve = null;
    let overridesToCleanup = null;
    if(to==="erledigt"){
      const allVehicles = await getAllVehicles();
      const vmap=vehiclesByIdMap(allVehicles);
      const removedIds = [...(card.assignedVehicles||[])];
      const snapshotLabels = { ...(card.everVehicleLabels || {}) };
      const prevEver = Array.isArray(card.everVehicles) ? card.everVehicles : [];
      const dedupedEver = [];
      const seenEver = new Set();
      for (const rawId of [...prevEver, ...removedIds]) {
        const idKey = String(rawId);
        if (seenEver.has(idKey)) continue;
        seenEver.add(idKey);
        dedupedEver.push(rawId);
      }
      for (const vid of removedIds) {
        const veh = vmap.get(vid);
        const vidStr = String(vid);
        const prev = snapshotLabels[vidStr];
        const prevLabel = typeof prev === "string" ? prev : prev?.label;
        const prevOrt = typeof prev === "object" && prev ? prev.ort : null;
        const label = veh?.label || prevLabel || veh?.id || vidStr;
        const ort = typeof veh?.ort === "string" ? veh.ort : prevOrt;
        snapshotLabels[vidStr] = { label, ort };
      }
      card.everVehicleLabels = snapshotLabels;
      card.everVehicles = dedupedEver;
      card.everPersonnel=Number.isFinite(card?.manualPersonnel)?card.manualPersonnel:computedPersonnel(card,vmap);
      // CSV: aktuell zugeordnete Einheiten als "entfernt" loggen
      for (const vid of removedIds) {
        const veh = vmap.get(vid);
        const vidStr = String(vid);
        const snapshotEntry = snapshotLabels[vidStr];
        const einheitsLabel = formatVehicleDisplay(veh, snapshotEntry, vidStr);
        await appendCsvRow(
          LOG_FILE, EINSATZ_HEADERS,
          buildEinsatzLog({ action:"Einheit entfernt", card, einheit: einheitsLabel, board }),
          req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
        );
      }
      card.assignedVehicles=[];
      clonesToRemove = new Set(removedIds);
      overridesToCleanup = new Set(removedIds);

      const resolveNames = new Set();
      for (const token of collectAlertedTokens(card?.alerted)) {
        resolveNames.add(token);
      }
      for (const entry of Object.values(snapshotLabels)) {
        if (!entry) continue;
        if (typeof entry === "string") {
          resolveNames.add(entry);
          continue;
        }
        const ortName = typeof entry?.ort === "string" ? entry.ort : "";
        if (ortName) resolveNames.add(ortName);
        else if (typeof entry?.label === "string" && entry.label) resolveNames.add(entry.label);
      }
      for (const vid of removedIds) {
        const veh = vmap.get(vid);
        if (veh?.ort) resolveNames.add(veh.ort);
      }
      if (resolveNames.size > 0) groupsToResolve = resolveNames;
    }
    dst.splice(Math.max(0,Math.min(Number(toIndex)||0,dst.length)),0,card);
    await saveBoard(board);
    return { board, card, fromName, toName, clonesToRemove, groupsToResolve, overridesToCleanup };
  });
  if (result.notFound) return res.status(404).json({ error:"card not found" });
  const { board, card, fromName, toName, clonesToRemove, groupsToResolve, overridesToCleanup } = result;

  if (overridesToCleanup && overridesToCleanup.size) {
    try {
      await cleanupVehicleOverrides({ board, candidateIds: overridesToCleanup });
    } catch (error) {
      await appendError("vehicle:cleanup-overrides", error);
    }
  }

  if (clonesToRemove) {
    try {
      await removeClonesByIds(clonesToRemove, board);
    } catch (e) {
      await appendError("vehicle:cleanup-done", e);
    }
  }

  await appendCsvRow(
    LOG_FILE, EINSATZ_HEADERS,
    buildEinsatzLog({ action:"Status gewechselt", card, from:fromName, to:toName, board }),
    req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
  );
  if (groupsToResolve) {
    for (const name of groupsToResolve) {
      await markGroupAlertedResolved(name);
    }
  }
  markActivity("card:move");
  res.json({ ok:true, card, from, to });
});

app.post("/api/cards/:id/assign", async (req,res)=>{
  const { id }=req.params; const { vehicleId }=req.body||{};
  if(!vehicleId) return res.status(400).json({ error:"vehicleId fehlt" });

  const result = await fileMutex.withLock("board", async () => {
    const board=await ensureBoard();
    const ref=findCardRef(board,id);
    if(!ref) return { notFound: true };

    const vmap=vehiclesByIdMap(await getAllVehicles());
    const veh=vmap.get(vehicleId);

    if(!ref.card.assignedVehicles.includes(vehicleId)) ref.card.assignedVehicles.push(vehicleId);
    ref.card.everVehicles=Array.from(new Set([...(ref.card.everVehicles||[]), vehicleId]));
    const labelStore = { ...(ref.card.everVehicleLabels || {}) };
    const vehicleIdStr = String(vehicleId);
    const prev = labelStore[vehicleIdStr];
    const prevLabel = typeof prev === "string" ? prev : prev?.label;
    const prevOrt = typeof prev === "object" && prev ? prev.ort : null;
    const snapshotLabel = veh?.label || prevLabel || veh?.id || vehicleIdStr;
    const snapshotOrt = typeof veh?.ort === "string" ? veh.ort : prevOrt;
    labelStore[vehicleIdStr] = { label: snapshotLabel, ort: snapshotOrt };
    ref.card.everVehicleLabels = labelStore;

    const einheitsLabel = formatVehicleDisplay(veh, labelStore[vehicleIdStr], vehicleIdStr);
    await appendCsvRow(
      LOG_FILE, EINSATZ_HEADERS,
      buildEinsatzLog({ action:"Einheit zugewiesen", card: ref.card, einheit: einheitsLabel, board }),
      req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
    );

    if(ref.col==="neu"){
      const [c]=ref.arr.splice(ref.i,1);
      c.statusSince=new Date().toISOString();
      board.columns["in-bearbeitung"].items.unshift(c);
      await appendCsvRow(
        LOG_FILE, EINSATZ_HEADERS,
        buildEinsatzLog({
          action:"Status gewechselt", card:c,
          from:board.columns["neu"].name, to:board.columns["in-bearbeitung"].name,
          note:"durch Zuweisung",
          board,
        }),
        req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
      );
    }
    await saveBoard(board);
    return { card: ref.card, snapshotOrt, vehicleId };
  });
  if (result.notFound) return res.status(404).json({ error:"card not found" });
  const { card: assignedCard, snapshotOrt } = result;
  if (snapshotOrt) {
    await markGroupAlertedResolved(snapshotOrt);
  }
  markActivity("vehicle:assign");
  res.json({ ok:true, card:assignedCard });

  // Manuelle Koordinaten verwerfen, wenn das Fahrzeug neu zugeordnet wird
  try {
    const ov = await readOverrides();
    if (ov[vehicleId]) {
      delete ov[vehicleId];
      await writeOverrides(ov);
    }
  } catch {}
});

app.post("/api/cards/:id/unassign", async (req,res)=>{
  const { id }=req.params; const { vehicleId }=req.body||{};

  const result = await fileMutex.withLock("board", async () => {
    const board=await ensureBoard();
    const ref=findCardRef(board,id);
    if(!ref) return { notFound: true };

    ref.card.assignedVehicles=(ref.card.assignedVehicles||[]).filter(v=>v!==vehicleId);
    await saveBoard(board);
    return { board, card: ref.card };
  });
  if (result.notFound) return res.status(404).json({ error:"card not found" });
  const { board, card: unassignedCard } = result;

  const vmap=vehiclesByIdMap(await getAllVehicles());
  const veh = vmap.get(vehicleId);
  const labelStore = unassignedCard.everVehicleLabels || {};
  const einheitsLabel = formatVehicleDisplay(veh, labelStore[String(vehicleId)], vehicleId);
  await appendCsvRow(
    LOG_FILE, EINSATZ_HEADERS,
    buildEinsatzLog({ action:"Einheit entfernt", card: unassignedCard, einheit: einheitsLabel, board }),
    req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
  );

  try {
    await removeClonesByIds(new Set([vehicleId]), board);
  } catch (e) {
    await appendError("vehicle:cleanup-unassign", e);
  }
  markActivity("vehicle:unassign");
  res.json({ ok:true, card:unassignedCard });

  // Manuelle Koordinaten löschen, wenn das Fahrzeug vom Einsatz entfernt wird
  try {
    const ov = await readOverrides();
    if (ov[vehicleId]) {
      delete ov[vehicleId];
      await writeOverrides(ov);
    }
  } catch {}
});

app.patch("/api/cards/:id/personnel", async (req,res)=>{
  const { id }=req.params; const { manualPersonnel }=req.body||{};

  if(manualPersonnel!==null&&manualPersonnel!==""&&manualPersonnel!==undefined){
    const n=Number(manualPersonnel);
    if(!Number.isFinite(n)||n<0) return res.status(400).json({ error:"manualPersonnel ungültig" });
  }

  const result = await fileMutex.withLock("board", async () => {
    const board=await ensureBoard(); const ref=findCardRef(board,id);
    if(!ref) return { notFound: true };

    const vmap = vehiclesByIdMap(await getAllVehicles());
    const prevAuto = (ref.card.assignedVehicles||[]).reduce((s,vid)=>s+(vmap.get(vid)?.mannschaft??0),0);
    const prev = Number.isFinite(ref.card?.manualPersonnel) ? ref.card.manualPersonnel : prevAuto;

    if(manualPersonnel===null||manualPersonnel===""||manualPersonnel===undefined){
      delete ref.card.manualPersonnel;
      await saveBoard(board);
      const autoNow = computedPersonnel(ref.card, vehiclesByIdMap(await getAllVehicles()));
      return { board, card: ref.card, prev, next: autoNow, cleared: true };
    }else{
      ref.card.manualPersonnel=Number(manualPersonnel);
    }
    await saveBoard(board);
    return { board, card: ref.card, prev, next: ref.card.manualPersonnel, cleared: false };
  });
  if (result.notFound) return res.status(404).json({ error:"card not found" });
  const { board, card: updatedCard, prev: prevVal, next: nextVal } = result;

  await appendCsvRow(
    LOG_FILE, EINSATZ_HEADERS,
    buildEinsatzLog({
      action: "Personenzahl geändert",
      card: updatedCard,
      note: `${prevVal}→${nextVal}`,
      board,
    }),
    req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
  );
  markActivity("personnel:update");
  res.json({ ok:true, card:updatedCard });
});

app.patch("/api/cards/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};

  // Pre-validate title outside lock to allow early return
  if (Object.prototype.hasOwnProperty.call(updates, "title")) {
    const nextTitle = String(updates.title || "").trim();
    if (!nextTitle) return res.status(400).json({ error: "Titel darf nicht leer sein" });
  }

  const result = await fileMutex.withLock("board", async () => {
    const board = await ensureBoard();
    const ref = findCardRef(board, id);
    if (!ref) return { notFound: true };

    const prevSnapshot = {
      content: ref.card.content,
      humanId: ref.card.humanId,
      ort: ref.card.ort,
      typ: ref.card.typ,
      isArea: !!ref.card.isArea,
      areaCardId: ref.card.areaCardId ? String(ref.card.areaCardId) : null,
      areaColor: ref.card.areaColor || null,
    };
    const prevAreaLabel = areaLabel(prevSnapshot, board);
    const prevLat = Number.isFinite(Number(ref.card.latitude)) ? Number(ref.card.latitude) : null;
    const prevLng = Number.isFinite(Number(ref.card.longitude)) ? Number(ref.card.longitude) : null;

    let changed = false;
    const notes = [];

    const formatCoords = (lat, lng) =>
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        : "—";

    if (Object.prototype.hasOwnProperty.call(updates, "title")) {
      const nextTitle = String(updates.title || "").trim();
      if (nextTitle !== ref.card.content) {
        notes.push(`Titel: ${ref.card.content || ""}→${nextTitle}`);
        ref.card.content = nextTitle;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "ort")) {
      const nextOrt = String(updates.ort || "").trim();
      if (nextOrt !== (ref.card.ort || "")) {
        notes.push(`Ort: ${ref.card.ort || ""}→${nextOrt}`);
        ref.card.ort = nextOrt;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "typ")) {
      const nextTyp = String(updates.typ || "").trim();
      if (nextTyp !== (ref.card.typ || "")) {
        notes.push(`Typ: ${ref.card.typ || ""}→${nextTyp}`);
        ref.card.typ = nextTyp;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "description")) {
      const nextDescription = String(updates.description || "").trim();
      if (nextDescription !== (ref.card.description || "")) {
        notes.push("Notiz geändert");
        ref.card.description = nextDescription;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "location")) {
      const nextLocation = String(updates.location || "").trim();
      if (nextLocation !== (ref.card.location || "")) {
        notes.push(`Adresse: ${(ref.card.location || "—")}→${nextLocation || "—"}`);
        ref.card.location = nextLocation;
        changed = true;
      }
    }

    const hasLatUpdate =
      Object.prototype.hasOwnProperty.call(updates, "latitude") ||
      Object.prototype.hasOwnProperty.call(updates, "lat");
    const hasLngUpdate =
      Object.prototype.hasOwnProperty.call(updates, "longitude") ||
      Object.prototype.hasOwnProperty.call(updates, "lng");

    let coordsChanged = false;
    if (hasLatUpdate) {
      const raw = Number(updates.latitude ?? updates.lat);
      const nextLat = Number.isFinite(raw) ? raw : null;
      if (nextLat !== (Number.isFinite(ref.card.latitude) ? Number(ref.card.latitude) : null)) {
        ref.card.latitude = nextLat;
        coordsChanged = true;
        changed = true;
      }
    }
    if (hasLngUpdate) {
      const raw = Number(updates.longitude ?? updates.lng);
      const nextLng = Number.isFinite(raw) ? raw : null;
      if (nextLng !== (Number.isFinite(ref.card.longitude) ? Number(ref.card.longitude) : null)) {
        ref.card.longitude = nextLng;
        coordsChanged = true;
        changed = true;
      }
    }

    if (coordsChanged) {
      notes.push(`Koordinaten: ${formatCoords(prevLat, prevLng)}→${formatCoords(ref.card.latitude, ref.card.longitude)}`);
    }

    const areaCards = listAreaCards(board).filter((c) => c.id !== ref.card.id);
    const areaIdSet = new Set(areaCards.map((c) => String(c.id)));
    const areaColorMap = new Map(areaCards.map((c) => [String(c.id), c.areaColor || null]));

    let areaChanged = false;
    let becameArea = null;
    if (Object.prototype.hasOwnProperty.call(updates, "isArea")) {
      const nextIsArea = !!updates.isArea;
      if (nextIsArea !== ref.card.isArea) {
        ref.card.isArea = nextIsArea;
        changed = true;
        areaChanged = true;
        becameArea = nextIsArea;
        if (nextIsArea) {
          ref.card.areaCardId = null;
        }
      }
    }

    if (!ref.card.isArea && Object.prototype.hasOwnProperty.call(updates, "areaCardId")) {
      const raw = updates.areaCardId;
      let nextArea = null;
      if (raw) {
        const idStr = String(raw);
        if (!areaIdSet.has(idStr)) {
          return { badRequest: true, error: "Bereich ungültig" };
        }
        nextArea = idStr;
      }
      if (nextArea !== (ref.card.areaCardId ? String(ref.card.areaCardId) : null)) {
        ref.card.areaCardId = nextArea;
        changed = true;
        areaChanged = true;
      }
      const desiredColor = nextArea ? (areaColorMap.get(nextArea) || null) : null;
      if (desiredColor !== (ref.card.areaColor || null)) {
        ref.card.areaColor = desiredColor;
        changed = true;
      }
    }

    if (ref.card.isArea) {
      ref.card.areaCardId = null;
    }

    let areaColorChanged = false;
    if (ref.card.isArea) {
      const hasColorUpdate = Object.prototype.hasOwnProperty.call(updates, "areaColor");
      const proposed = hasColorUpdate ? updates.areaColor : (ref.card.areaColor || DEFAULT_AREA_COLOR);
      const nextColor = normalizeAreaColor(proposed || DEFAULT_AREA_COLOR, DEFAULT_AREA_COLOR);
      if (nextColor !== ref.card.areaColor) {
        notes.push(`Farbe: ${(prevSnapshot.areaColor || "—")}→${nextColor}`);
        ref.card.areaColor = nextColor;
        changed = true;
        areaColorChanged = true;
      }
    } else {
      const currentArea = ref.card.areaCardId ? String(ref.card.areaCardId) : null;
      const nextColor = currentArea ? (areaColorMap.get(currentArea) || null) : null;
      if (nextColor !== (ref.card.areaColor || null)) {
        ref.card.areaColor = nextColor;
        changed = true;
        areaColorChanged = true;
      }
    }

    if (becameArea === true) {
      const ensured = ensureAreaHumanIdValue(ref.card.humanId, () => nextHumanNumber(board));
      if (ensured !== ref.card.humanId) {
        ref.card.humanId = ensured;
        changed = true;
      }
    } else if (becameArea === false && !ref.card.externalId) {
      const ensured = ensureManualHumanIdValue(ref.card.humanId, () => nextHumanNumber(board));
      if (ensured !== ref.card.humanId) {
        ref.card.humanId = ensured;
        changed = true;
      }
    }

    const cleared = [];
    if (prevSnapshot.isArea && !ref.card.isArea) {
      if (ref.card.areaColor) {
        ref.card.areaColor = null;
        changed = true;
      }
      for (const colKey of Object.keys(board.columns || {})) {
        for (const c of board.columns[colKey]?.items || []) {
          if (c.id === ref.card.id) continue;
          if (c.areaCardId && String(c.areaCardId) === String(ref.card.id)) {
            c.areaCardId = null;
            if (c.areaColor) {
              c.areaColor = null;
            }
            cleared.push(c);
          }
        }
      }
      if (cleared.length) changed = true;
    }

    if (ref.card.isArea && (areaColorChanged || areaChanged)) {
      for (const colKey of Object.keys(board.columns || {})) {
        for (const c of board.columns[colKey]?.items || []) {
          if (!c || c.id === ref.card.id) continue;
          if (c.areaCardId && String(c.areaCardId) === String(ref.card.id)) {
            if (c.areaColor !== ref.card.areaColor) {
              c.areaColor = ref.card.areaColor;
              changed = true;
            }
          }
        }
      }
    }

    const nextAreaLabel = areaLabel(ref.card, board);
    if (areaChanged && prevAreaLabel !== nextAreaLabel) {
      notes.push(`Abschnitt: ${prevAreaLabel || "—"}→${nextAreaLabel || "—"}`);
    }

    if (!changed) {
      return { unchanged: true, card: ref.card, board };
    }

    await saveBoard(board);
    return { board, card: ref.card, notes, becameArea, cleared, areaChanged };
  });
  if (result.notFound) return res.status(404).json({ error: "card not found" });
  if (result.badRequest) return res.status(400).json({ error: result.error });
  if (result.unchanged) return res.json({ ok: true, card: result.card, board: result.board });
  const { board, card: updatedCard, notes, becameArea, cleared, areaChanged } = result;

  let actionLabel = "Einsatz aktualisiert";
  if (!updatedCard.isArea && areaChanged && updatedCard.areaCardId) {
    actionLabel = "Zu Abschnitt zugeordnet";
  }

  await appendCsvRow(
    LOG_FILE,
    EINSATZ_HEADERS,
    buildEinsatzLog({
      action: actionLabel,
      card: updatedCard,
      note: notes.join("; ") || "",
      board,
    }),
    req,
    { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
  );

  if (becameArea === true) {
    await appendCsvRow(
      LOG_FILE,
      EINSATZ_HEADERS,
      buildEinsatzLog({
        action: "Bereich aktiviert",
        card: updatedCard,
        note: "Als Bereich markiert",
        board,
      }),
      req,
      { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
    );
  } else if (becameArea === false) {
    await appendCsvRow(
      LOG_FILE,
      EINSATZ_HEADERS,
      buildEinsatzLog({
        action: "Bereich deaktiviert",
        card: updatedCard,
        note: "Bereich-Markierung entfernt",
        board,
      }),
      req,
      { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
    );
  }

  if (cleared.length) {
    for (const c of cleared) {
      await appendCsvRow(
        LOG_FILE,
        EINSATZ_HEADERS,
        buildEinsatzLog({
          action: "Bereich entfernt",
          card: c,
          note: `Bereich ${updatedCard.humanId || updatedCard.content || updatedCard.id} nicht mehr verfügbar`,
          board,
        }),
        req,
        { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
      );
    }
  }

  markActivity("card:update");
  res.json({ ok: true, card: updatedCard, board });
});


async function archiveAndResetLog() {
  try {
    await ensureDir(ARCHIVE_DIR);
    await ensureLogFile();
    const ARCH_NAME = path.join(ARCHIVE_DIR, `log_${tsFile()}.csv`);
    try { await fs.rename(LOG_FILE, ARCH_NAME); } catch {}
  } finally {
    await fs.writeFile(
      LOG_FILE,
       "\uFEFFZeitpunkt;Benutzer;EinsatzID;Einsatz;Aktion;Von;Nach;Einheit;Bemerkung\n",
      "utf8"
    );
  }
}

app.post("/api/reset", async (_req,res)=>{
  await fileMutex.withLock("board", async () => {
    const board=await ensureBoard();
    await ensureDir(ARCHIVE_DIR);
    await writeFileAtomic(path.join(ARCHIVE_DIR,`board_${tsFile()}.json`), JSON.stringify(board,null,2), "utf8");

    const fresh={ columns:{
      "neu":{name:"Neu",items:[]},
      "in-bearbeitung":{name:"In Bearbeitung",items:[]},
      "erledigt":{name:"Erledigt",items:[]}
    }};
    await saveBoard(fresh);
  });
  await archiveAndResetLog();
  res.json({ ok:true });
});

// ===================================================================
// =                           NEARBY                                =
// ===================================================================
app.get("/api/nearby", async (req, res) => {
  const cardId   = String(req.query.cardId || "");
  const radiusKm = resolveRadiusKm(
    req.query.radiusKm || process.env.NEARBY_RADIUS_KM || NEAR_DEFAULT
  );

  const board = await ensureBoard();
  const ref   = findCardRef(board, cardId);
  if (!ref) return res.status(404).json({ ok:false, error:"card not found" });

  const lat = Number(ref.card.latitude ?? ref.card.lat);
  const lng = Number(ref.card.longitude ?? ref.card.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ ok:false, error:"card has no coordinates" });
  }
  const center = { lat, lng };

  // Map: vehicleId -> aktuell zugeordnete Card
  const assignedById = new Map();
  for (const k of ["neu","in-bearbeitung","erledigt"]) {
    for (const c of (board.columns[k].items || [])) {
      for (const vid of (c.assignedVehicles || [])) assignedById.set(String(vid), c);
    }
  }

  const vehicles = await getAllVehiclesMerged();

  // Gruppen-Positionen
  const groupsRaw = await readJson(GROUPS_FILE, {});
  const groupPos = new Map(
    Object.entries(groupsRaw || {})
      .map(([name, g]) => [name, { lat: Number(g?.lat), lng: Number(g?.lon ?? g?.lng) }])
      .filter(([_, p]) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  );

  // Fallback: erste bekannte Koordinate je Gruppe
  const groupFirst = new Map();
  for (const v of vehicles) {
    const g = v?.ort || "";
    if (!g) continue;
    const vlat = Number(v.latitude ?? v.lat);
    const vlng = Number(v.longitude ?? v.lng);
    if (Number.isFinite(vlat) && Number.isFinite(vlng) && !groupFirst.has(g)) {
      groupFirst.set(g, { lat: vlat, lng: vlng });
    }
  }

  const hits = [];
  for (const v of vehicles) {
    if (!v) continue;

    const aCard = assignedById.get(String(v.id));
    let vlat = Number(v.latitude ?? v.lat);
    let vlng = Number(v.longitude ?? v.lng);

    if ((!Number.isFinite(vlat) || !Number.isFinite(vlng)) && aCard) {
      const alat = Number(aCard.latitude ?? aCard.lat);
      const alng = Number(aCard.longitude ?? aCard.lng);
      if (Number.isFinite(alat) && Number.isFinite(alng)) {
        vlat = alat; vlng = alng;
      }
    }
    if ((!Number.isFinite(vlat) || !Number.isFinite(vlng)) && !aCard) {
      const gp = groupPos.get(v?.ort || "");
      if (gp) { vlat = gp.lat; vlng = gp.lng; }
    }
    if (!Number.isFinite(vlat) || !Number.isFinite(vlng)) {
      const gpos = groupFirst.get(v?.ort || "");
      if (gpos) { vlat = gpos.lat; vlng = gpos.lng; }
    }
    if (!Number.isFinite(vlat) || !Number.isFinite(vlng)) continue;

    const d = haversineKm(center, { lat: vlat, lng: vlng });
    if (d <= radiusKm) {
      hits.push({
        unitId: v.id,
        distanceKm: Math.round(d * 10) / 10,
        group: v.ort || "",
        assigned: !!aCard,
        assignedCardId: aCard?.id || null,
      });
    }
  }

  hits.sort((a, b) => (a.distanceKm ?? 9e9) - (b.distanceKm ?? 9e9));

  if (ref.card.alerted) {
    const alertedNorm = String(ref.card.alerted).trim().toLowerCase();
    for (const v of vehicles) {
      if (!v) continue;
      const labelNorm = String(v.label || "").toLowerCase();
      const ortNorm   = String(v.ort   || "").toLowerCase();
      const already = hits.some(h => h.unitId === v.id);
      if (!already && !assignedById.has(String(v.id)) &&
          (labelNorm.includes(alertedNorm) || ortNorm.includes(alertedNorm))) {
        hits.push({
          unitId: v.id,
          distanceKm: null,
          group: v.ort || "",
          assigned: false,
          assignedCardId: null,
          fallback: "alerted"
        });
      }
    }
  }

  const groupsArr = Object.entries(groupsRaw || {})
    .map(([name, g]) => ({ name, lat: Number(g?.lat), lng: Number(g?.lon ?? g?.lng) }))
    .filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lng));

  let nearestGroup = null;
  if (groupsArr.length) {
    let best = null;
    for (const g of groupsArr) {
      const d = haversineKm({ lat: center.lat, lng: center.lng }, { lat: g.lat, lng: g.lng });
      if (!best || d < best.d) best = { name: g.name, distanceKm: Math.round(d * 10) / 10 };
    }
    nearestGroup = best;
  }

  res.json({ ok:true, center, radiusKm, nearestGroup, units: hits });
});

// Speichert manuell gesetzte Fahrzeug-Koordinaten in data/vehicles-overrides.json
app.patch("/api/vehicles/:id/position", async (req,res)=>{
  const { id } = req.params;
  const { lat, lng, incidentId=null, source="manual" } = req.body||{};
  if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) {
    return res.status(400).json({ ok:false, error:"lat/lng erforderlich" });
  }
  const ov = await readOverrides();
  ov[id] = { lat:+lat, lng:+lng, source, ...(incidentId?{incidentId}:{}), ts:Date.now() };
  await writeOverrides(ov);
  markActivity("vehicle:move");
  res.json({ ok:true });
});

app.delete("/api/vehicles/:id/position", async (req,res)=>{
  const { id } = req.params;
  const ov = await readOverrides();
  if (ov[id]) { delete ov[id]; await writeOverrides(ov); }
  res.json({ ok:true });
});

// ===================================================================
// =                       JSON-IMPORT (AUTO)                        =
// ===================================================================
async function readAutoCfg(){
  const cfg=await readJson(AUTO_CFG_FILE,AUTO_DEFAULT);
  cfg.filename   = AUTO_DEFAULT_FILENAME;
  cfg.intervalSec= Number.isFinite(+cfg.intervalSec)&&+cfg.intervalSec>0 ? +cfg.intervalSec : AUTO_DEFAULT.intervalSec;
  cfg.enabled    = !!cfg.enabled;
  cfg.demoMode   = !!cfg.demoMode;
  cfg.statusPollIntervalMs   = UI_STATUS_POLL_INTERVAL_MS;
  cfg.activityPollIntervalMs = UI_ACTIVITY_POLL_INTERVAL_MS;
  return cfg;
}
async function writeAutoCfg(next){
  const { statusPollIntervalMs, activityPollIntervalMs, ...keep } = await readAutoCfg();
  const merged={ ...keep, ...next };
  const sanitized={
    ...merged,
    filename: AUTO_DEFAULT_FILENAME,
    enabled: !!merged.enabled,
    intervalSec: Number.isFinite(+merged.intervalSec)&&+merged.intervalSec>0 ? +merged.intervalSec : keep.intervalSec,
    demoMode: !!merged.demoMode,
  };
  await writeJson(AUTO_CFG_FILE,sanitized);
  return {
    ...sanitized,
    statusPollIntervalMs: UI_STATUS_POLL_INTERVAL_MS,
    activityPollIntervalMs: UI_ACTIVITY_POLL_INTERVAL_MS,
  };
}

// ===================================================================
// =                 KI-Analyse (Situationsanalyse)                   =
// ===================================================================
const AI_ANALYSIS_DEFAULT = {
  enabled: true,
  intervalMinutes: AI_ANALYSIS_DEFAULT_INTERVAL_MINUTES,
  useRagContext: false, // RAG-Informationen in KI-Analyse einbeziehen
};

// Intervall 0 = nur manuelle Auslösung (kein automatischer Loop)
function sanitizeAiAnalysisInterval(value, fallback = AI_ANALYSIS_DEFAULT.intervalMinutes) {
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : AI_ANALYSIS_DEFAULT.intervalMinutes;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Math.floor(fallbackValue));
  }
  // 0 ist erlaubt (nur manuelle Auslösung), sonst Minimum 1 Minute
  if (parsed > 0 && parsed < AI_ANALYSIS_MIN_INTERVAL_MINUTES) {
    return AI_ANALYSIS_MIN_INTERVAL_MINUTES;
  }
  return Math.floor(parsed);
}

async function readAiAnalysisCfg() {
  const cfg = await readJson(AI_ANALYSIS_CFG_FILE, AI_ANALYSIS_DEFAULT);
  return {
    enabled: !!cfg?.enabled,
    intervalMinutes: sanitizeAiAnalysisInterval(cfg?.intervalMinutes, AI_ANALYSIS_DEFAULT.intervalMinutes),
    useRagContext: !!cfg?.useRagContext, // RAG-Informationen in KI-Analyse einbeziehen
  };
}

async function writeAiAnalysisCfg(next) {
  const current = await readAiAnalysisCfg();
  const merged = { ...current, ...next };
  const sanitized = {
    enabled: !!merged.enabled,
    intervalMinutes: sanitizeAiAnalysisInterval(merged.intervalMinutes, current.intervalMinutes),
    useRagContext: !!merged.useRagContext, // RAG-Informationen in KI-Analyse einbeziehen
  };
  await writeJson(AI_ANALYSIS_CFG_FILE, sanitized);
  return sanitized;
}

// ===================================================================
// =                   AUTO-DRUCK (PROTOKOLL)                        =
// ===================================================================
function parseAutoPrintEnabled(value){
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "string"){
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (["1","true","yes","ja","on","an"].includes(normalized)) return true;
    if (["0","false","no","nein","off","aus"].includes(normalized)) return false;
    return Boolean(normalized);
  }
  if (typeof value === "number"){
    if (!Number.isFinite(value)) return false;
    return value !== 0;
  }
  if (typeof value === "bigint"){
    return value !== 0n;
  }
  return Boolean(value);
}

const AUTO_PRINT_SCOPE_DEFAULT = AUTO_PRINT_DEFAULT.entryScope;
const AUTO_PRINT_SCOPE_ALIASES = new Map([
  ["interval", "interval"],
  ["intervall", "interval"],
  ["window", "interval"],
  ["range", "interval"],
  ["zeitraum", "interval"],
  ["all", "all"],
  ["alle", "all"],
  ["alles", "all"],
  ["gesamt", "all"],
  ["voll", "all"],
]);

function parseAutoPrintScope(value, fallback = AUTO_PRINT_SCOPE_DEFAULT){
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string"){
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (AUTO_PRINT_SCOPE_ALIASES.has(normalized)) {
      return AUTO_PRINT_SCOPE_ALIASES.get(normalized);
    }
  }
  if (typeof value === "boolean"){
    return value ? "all" : fallback;
  }
  return fallback;
}

async function readAutoPrintCfg(){
  const raw = await readJson(AUTO_PRINT_CFG_FILE, AUTO_PRINT_DEFAULT);
  const minutesRaw = Number(raw?.intervalMinutes);
  const intervalMinutes = Number.isFinite(minutesRaw) && minutesRaw >= AUTO_PRINT_MIN_INTERVAL_MINUTES
    ? Math.floor(minutesRaw)
    : AUTO_PRINT_DEFAULT.intervalMinutes;
  const lastRunAt = parseAutoPrintTimestamp(raw?.lastRunAt);
  const entryScope = parseAutoPrintScope(raw?.entryScope ?? raw?.scope ?? raw?.mode);
  return {
    enabled: parseAutoPrintEnabled(raw?.enabled),
    intervalMinutes,
    lastRunAt: lastRunAt ?? null,
    entryScope,
    scope: entryScope,
  };
}

async function writeAutoPrintCfg(next = {}){
  const current = await readAutoPrintCfg();
  const merged = { ...current, ...next };
  const minutesRaw = Number(merged.intervalMinutes);
  const intervalMinutes = Number.isFinite(minutesRaw) && minutesRaw >= AUTO_PRINT_MIN_INTERVAL_MINUTES
    ? Math.floor(minutesRaw)
    : current.intervalMinutes;
  const sanitized = {
    enabled: parseAutoPrintEnabled(merged.enabled),
    intervalMinutes: Math.max(AUTO_PRINT_MIN_INTERVAL_MINUTES, intervalMinutes),
    lastRunAt: (() => {
      const ts = parseAutoPrintTimestamp(merged.lastRunAt);
      return ts ?? null;
    })(),
    entryScope: parseAutoPrintScope(merged.entryScope ?? merged.scope ?? merged.mode ?? current.entryScope),
  };
  sanitized.scope = sanitized.entryScope;
  await writeJson(AUTO_PRINT_CFG_FILE, sanitized);
  return sanitized;
}

function clearAutoPrintTimer(){
  if (autoPrintTimer){
    clearInterval(autoPrintTimer);
    autoPrintTimer = null;
  }
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAutoPrintDate(ts){
  if (!Number.isFinite(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("de-AT", { hour12: false });
  } catch {
    return new Date(ts).toISOString();
  }
}

function formatAutoPrintRange(since, until, { scope } = {}){
  const fromLabel = Number.isFinite(since) ? formatAutoPrintDate(since) : "unbekannt";
  const toLabel = Number.isFinite(until) ? formatAutoPrintDate(until) : "unbekannt";
  if (scope === "all"){
    if (Number.isFinite(since) && Number.isFinite(until)){
      return `Alle Meldungen (${fromLabel} – ${toLabel})`;
    }
    return "Alle Meldungen";
  }
  return `${fromLabel} – ${toLabel}`;
}

function normalizeProtocolDirection(item){
  const u = item?.uebermittlungsart || {};
  const directions = [];
  if (u.ein) directions.push("Eingang");
  if (u.aus) directions.push("Ausgang");
  const alt = typeof item?.richtung === "string" ? item.richtung : "";
  if (!directions.length && alt) directions.push(String(alt));
  return directions.filter(Boolean).join(" / ");
}

function normalizeProtocolChannel(item){
  const u = item?.uebermittlungsart || {};
  const values = [u.kanal ?? u.kanalNr ?? u.art ?? item?.kanal];
  const first = values.find((v) => typeof v === "string" && v.trim());
  return first ? String(first).trim() : "";
}

function normalizeNrLabel(item){
  const nr = item?.nr ?? "";
  const zuRaw = item?.zu;
  const zu = typeof zuRaw === "string" ? zuRaw.trim() : (zuRaw ?? "");
  const nrLabel = nr === null || nr === undefined ? "" : String(nr);
  if (zu) return `${nrLabel}/${zu}`;
  return nrLabel || "—";
}

function formatAutoPrintInformation(value){
  if (value == null) return "";
  const safe = String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "    ");
  return escapeHtml(safe);
}

function buildAutoPrintTableHtml(entries, { since, until, scope }){
  const header = formatAutoPrintRange(since, until, { scope });
  const generatedLabel = formatAutoPrintDate(until);
  const rowsHtml = entries.map((item) => {
    const createdAt = getProtocolCreatedAt(item);
    const info = formatAutoPrintInformation(item?.information ?? item?.beschreibung ?? "");
    const kanal = escapeHtml(normalizeProtocolChannel(item));
    const richtung = escapeHtml(normalizeProtocolDirection(item));
    const anvon = escapeHtml(String(item?.anvon ?? ""));
    const datum = escapeHtml(String(item?.datum ?? ""));
    const zeit = escapeHtml(String(item?.zeit ?? ""));
    const infoTyp = escapeHtml(String(item?.infoTyp ?? "—"));
    const nrLabel = escapeHtml(normalizeNrLabel(item));
    const createdLabel = formatAutoPrintDate(createdAt);
    return `<tr>
      <td class="cell nowrap">${nrLabel}</td>
      <td class="cell nowrap">${datum}</td>
      <td class="cell nowrap">${zeit}</td>
      <td class="cell nowrap">${kanal}</td>
      <td class="cell nowrap">${richtung}</td>
      <td class="cell nowrap">${anvon}</td>
      <td class="cell info">${info || ""}</td>
      <td class="cell nowrap">${infoTyp}</td>
      <td class="cell nowrap">${escapeHtml(createdLabel)}</td>
    </tr>`;
  }).join("\n");
  const emptyRow = `<tr><td class="cell" colspan="9">Keine Einträge im ausgewählten Zeitraum.</td></tr>`;
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <title>Protokolle – Auto-Druck</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 16px; color: #0f172a; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #e2e8f0; text-align: left; padding: 6px 8px; border-bottom: 1px solid #cbd5f5; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .cell { border-bottom: 1px solid #e2e8f0; }
    .nowrap { white-space: nowrap; }
    .info { white-space: pre-wrap; word-break: break-word; }
    tbody tr:nth-child(even) { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>Protokolle – Auto-Druck</h1>
  <div class="meta">Zeitraum: ${escapeHtml(header)}<br/>Generiert: ${escapeHtml(generatedLabel)}</div>
  <table>
    <thead>
      <tr>
        <th>Nr.</th>
        <th>Datum</th>
        <th>Zeit</th>
        <th>Kanal</th>
        <th>Richtung</th>
        <th>An/Von</th>
        <th>Information</th>
        <th>Meldungstyp</th>
        <th>Erstellt</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || emptyRow}
    </tbody>
  </table>
</body>
</html>`;
}

async function renderAutoPrintPdf(entries, { since, until, scope }){
  await ensureDir(AUTO_PRINT_OUTPUT_DIR);
  const html = buildAutoPrintTableHtml(entries, { since, until, scope });
  const timestamp = tsFile();
  const fileName = `auto-protokolle-${timestamp}.pdf`;
  const filePath = path.join(AUTO_PRINT_OUTPUT_DIR, fileName);
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--font-render-hinting=none"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1754, height: 1240, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: ["domcontentloaded"] });
    try { await page.waitForNetworkIdle({ idleTime: 300, timeout: 2000 }); } catch {}
    await page.pdf({
      path: filePath,
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
  } finally {
    await browser.close();
  }
  return { fileName, filePath };
}

async function sendAutoPrintToPrinter(fileName){
  const url = `http://127.0.0.1:${PORT}/api/print/server`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-auto-print": "1",
    },
    body: JSON.stringify({ file: fileName, scope: "protokoll" }),
  });
  if (!res.ok){
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Serverdruck fehlgeschlagen (${res.status})`);
    err.status = res.status;
    throw err;
  }
  try {
    return await res.json();
  } catch {
    return { ok: true };
  }
}

async function runAutoPrintCycle(){
  if (autoPrintRunning) return;
  autoPrintRunning = true;
  try {
    const cfg = await readAutoPrintCfg();
    if (!cfg.enabled) return;
    const intervalMinutes = Math.max(cfg.intervalMinutes, AUTO_PRINT_MIN_INTERVAL_MINUTES);
    const intervalMs = intervalMinutes * 60_000;
    const now = Date.now();
    let since = Number.isFinite(cfg.lastRunAt) ? cfg.lastRunAt : now - intervalMs;
    if (!Number.isFinite(since) || since > now) since = now - intervalMs;
    const scope = cfg.entryScope === "all" ? "all" : "interval";
    const all = await readJson(PROTOCOL_JSON_FILE, []);
    const list = Array.isArray(all) ? all.slice() : [];
    const withMeta = list.map((item) => ({ item, createdAt: getProtocolCreatedAt(item) }));
    const filtered = scope === "all"
      ? withMeta
      : withMeta.filter(({ createdAt }) => Number.isFinite(createdAt) && createdAt > since && createdAt <= now);
    const sorted = filtered.slice().sort((a, b) => {
      const aTs = Number.isFinite(a.createdAt) ? a.createdAt : null;
      const bTs = Number.isFinite(b.createdAt) ? b.createdAt : null;
      if (aTs !== null && bTs !== null && aTs !== bTs) return aTs - bTs;
      if (aTs !== null && bTs === null) return -1;
      if (aTs === null && bTs !== null) return 1;
      const nrA = Number(a.item?.nr);
      const nrB = Number(b.item?.nr);
      if (Number.isFinite(nrA) && Number.isFinite(nrB) && nrA !== nrB) return nrA - nrB;
      return 0;
    });
    const relevant = sorted.map(({ item }) => item);
    const finiteDates = sorted
      .map(({ createdAt }) => (Number.isFinite(createdAt) ? createdAt : null))
      .filter((ts) => ts !== null);
    const rangeSince = scope === "all"
      ? (finiteDates.length ? Math.min(...finiteDates) : null)
      : since;
    if (!relevant.length){
      await writeAutoPrintCfg({ lastRunAt: now });
      return;
    }
    const { fileName } = await renderAutoPrintPdf(relevant, { since: rangeSince, until: now, scope });
    try {
      await sendAutoPrintToPrinter(fileName);
    } catch (err) {
      await appendError("auto-print/print", err, { file: fileName });
      throw err;
    }
    await writeAutoPrintCfg({ lastRunAt: now });
  } finally {
    autoPrintRunning = false;
  }
}

async function startAutoPrintTimer({ immediate = false } = {}){
  clearAutoPrintTimer();
  try {
    const cfg = await readAutoPrintCfg();
    if (!cfg.enabled) return;
    const intervalMinutes = Math.max(cfg.intervalMinutes, AUTO_PRINT_MIN_INTERVAL_MINUTES);
    const intervalMs = intervalMinutes * 60_000;
    const runner = async () => {
      try {
        await runAutoPrintCycle();
      } catch (err) {
        await appendError("auto-print/run", err);
      }
    };
    autoPrintTimer = setInterval(runner, intervalMs);
    autoPrintTimer.unref?.();
    if (immediate) await runner();
  } catch (err) {
    await appendError("auto-print/start", err);
  }
}

function normalizeGroupNameForAlert(value) {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/[\u2022\u2023\u25E6\u2043\u2219•◆●■◦▪◉]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function collectAlertedTokens(value) {
  const tokens = [];
  const push = (input) => {
    const normalized = normalizeGroupNameForAlert(input);
    if (normalized) tokens.push(normalized);
  };

  if (value === null || value === undefined) return tokens;
  if (Array.isArray(value)) {
    for (const entry of value) push(entry);
    return tokens;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) push(key);
    return tokens;
  }
  if (typeof value === "string") {
    if (!value.trim()) return tokens;
    const replaced = value
      .replace(/[\u2022\u2023\u25E6\u2043\u2219•◆●■◦▪◉]/g, ",")
      .replace(/\s+\/\s+/g, ",")
      .replace(/\s+\|\s+/g, ",")
      .replace(/\s+·\s+/g, ",");
    for (const part of replaced.split(/[,;\n\r]+/)) push(part);
    return tokens;
  }

  push(String(value));
  return tokens;
}

function mergeAlertedValues(existingValue, incomingValue) {
  const seen = new Set();
  const merged = [];
  const append = (value) => {
    for (const token of collectAlertedTokens(value)) {
      if (seen.has(token)) continue;
      seen.add(token);
      merged.push(token);
    }
  };

  append(existingValue);
  append(incomingValue);

  return merged.join(", ");
}

function extractAlertedGroupsFromItem(item) {
  const groups = new Set();
  if (!item || typeof item !== "object") return groups;

  const push = (value) => {
    const name = normalizeGroupNameForAlert(value);
    if (name) groups.add(name);
  };

  const alertedGroupsArray = Array.isArray(item?.alertedGroups)
    ? item.alertedGroups
    : Array.isArray(item?.groups)
      ? item.groups
      : null;
  if (alertedGroupsArray) {
    for (const value of alertedGroupsArray) push(value);
  }

  const alertedRaw = item?.alerted;
  if (Array.isArray(alertedRaw)) {
    for (const value of alertedRaw) push(value);
  } else if (alertedRaw && typeof alertedRaw === "object") {
    for (const key of Object.keys(alertedRaw)) push(key);
  } else if (typeof alertedRaw === "string") {
    const replaced = alertedRaw
      .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, ",")
      .replace(/\s+\/\s+/g, ",")
      .replace(/\s+\|\s+/g, ",")
      .replace(/\s+·\s+/g, ",");
    for (const part of replaced.split(/[,;\n\r]+/)) {
      push(part);
    }
  }

  return groups;
}

async function updateGroupAlertedStatuses(alertedGroups) {
  try {
    await fileMutex.withLock("group-alerted", async () => {
      const prev = await readGroupAlerted().catch(() => ({}));
      const groupLocations = await readJson(GROUPS_FILE, {});
      const normalizedAlerted = new Set(
        Array.from(alertedGroups || [])
          .map(normalizeGroupNameForAlert)
          .filter(Boolean)
      );
      const combined = new Set([
        ...Object.keys(prev || {}).map(normalizeGroupNameForAlert),
        ...Object.keys(groupLocations || {}).map(normalizeGroupNameForAlert),
        ...normalizedAlerted,
      ]);

      const next = {};
      for (const name of combined) {
        const normalized = normalizeGroupNameForAlert(name);
        if (!normalized) continue;

        const hadPrev = Object.prototype.hasOwnProperty.call(prev || {}, normalized);
        const prevValue = prev?.[normalized];

        if (normalizedAlerted.has(normalized)) {
          next[normalized] = prevValue === true || !hadPrev;
        } else {
          next[normalized] = false;
        }
      }

      await writeGroupAlerted(next);
    });
  } catch (error) {
    await appendError("group-alerted/update", error);
  }
}

async function markGroupAlertedResolved(groupName) {
  const normalized = normalizeGroupNameForAlert(groupName);
  if (!normalized) return;

  try {
    await fileMutex.withLock("group-alerted", async () => {
      const prev = await readGroupAlerted().catch(() => ({}));
      if (Object.prototype.hasOwnProperty.call(prev || {}, normalized) && prev[normalized] === false) {
        return;
      }
      const next = { ...prev, [normalized]: false };
      await writeGroupAlerted(next);
    });
  } catch (error) {
    await appendError("group-alerted/resolve", error, { group: normalized });
  }
}

function mapIncomingItemToCardFields(item){
  const type       = String(item?.type??"").replace(/\n/g," ").trim();
  const content    = stripTypePrefix(type);
  const ort        = String(item?.additionalAddressInfo??"").trim();
  const alerted    = String(item?.alerted??"").trim();
  const latitude   = Number.isFinite(+item?.latitude)?+item.latitude:null;
  const longitude  = Number.isFinite(+item?.longitude)?+item.longitude:null;

  const externalIdRaw = (item?.externalId ?? item?.id ?? "").toString();
  const externalId    = externalIdRaw.trim();
  const location   = item?.location ?? "";
  const timestamp  = parseAT(item?.timestamp);
  const description= item?.description ?? "";
  const updated    = normalizeUpdatedField(item?.updated);
  return { content, ort, alerted, latitude, longitude, externalId, typ:type, location, timestamp, description, updated };
}

function applyIncomingFieldsToCard(target, incoming) {
  if (!target || !incoming) return false;

  let changed = false;

  const assignIfChanged = (key, value) => {
    if (value === undefined) return;
    if (target[key] !== value) {
      target[key] = value;
      changed = true;
    }
  };

  const incomingUpdated = incoming.updated ?? null;
  const targetUpdated = target.updated ?? null;
  const hasIncomingUpdated = incomingUpdated !== null;
  const shouldOverwriteCoreFields =
    hasIncomingUpdated && incomingUpdated !== targetUpdated;

  if (shouldOverwriteCoreFields) {
    assignIfChanged("content", incoming.content);
    assignIfChanged("ort", incoming.ort);
    assignIfChanged("typ", incoming.typ);
    assignIfChanged("alerted", incoming.alerted);
    assignIfChanged("latitude", incoming.latitude);
    assignIfChanged("longitude", incoming.longitude);
    if (typeof incoming.description === "string") assignIfChanged("description", incoming.description);
  }

  if (typeof incoming.location === "string" && incoming.location) assignIfChanged("location", incoming.location);
  if (incoming.timestamp) assignIfChanged("timestamp", incoming.timestamp);
  if (incomingUpdated !== undefined) assignIfChanged("updated", incomingUpdated);

  return changed;
}

function parseAT(ts) {
  if (!ts) return null;
  const m = String(ts).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [_, dd, mm, yyyy, HH, MM, SS="00"] = m;
  const iso = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeUpdatedField(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsedAt = parseAT(trimmed);
    if (parsedAt) return parsedAt;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? trimmed : d.toISOString();
  }
  return null;
}

async function importFromFileOnce(filename=AUTO_DEFAULT_FILENAME){
  const full=path.join(DATA_DIR,filename);
  let arr;
  try{
    const txt=await fs.readFile(full,"utf8");
    arr=JSON.parse(txt);
    if(!Array.isArray(arr)) throw new Error("JSON ist kein Array");
  }catch(e){
    await appendError(`importFromFileOnce(${filename})`, e);
    return { ok:false, error:`Kann ${filename} nicht lesen: ${e.message}` };
  }

  return await fileMutex.withLock("board", async () => {
    const board=await ensureBoard();
    let created=0, updated=0, skipped=0;
    const alertedGroups = new Set();
    let lastCreatedCard = null;

    try{
      for(const item of arr){
        const m=mapIncomingItemToCardFields(item);
        const incomingAlertedGroups = Array.from(extractAlertedGroupsFromItem(item));
        if (!m.externalId) {
          for (const groupName of incomingAlertedGroups) {
            alertedGroups.add(groupName);
          }
          skipped++;
          continue;
        }
        const existing=findCardByExternalId(board,m.externalId);
        const existingRef = existing ? findCardRef(board, existing.id) : null;
        const existingIsDone = existingRef?.col === "erledigt";
        if (!existingIsDone) {
          for (const groupName of incomingAlertedGroups) {
            alertedGroups.add(groupName);
          }
        }
        if(existing){
          const existingChanged = applyIncomingFieldsToCard(existing, m);
          if (existingChanged) {
            updated++;
            await appendAutoImportCsvLog({
              action: "Einsatz aktualisiert (Auto-Import)",
              card: existing,
              columnKey: existingRef?.col,
              board,
            });
          }
        }else{
          const duplicateByCoords = findCardByCoordinates(board, m.latitude, m.longitude, ["neu", "in-bearbeitung"]);
          if (duplicateByCoords) {
            const duplicateRef = findCardRef(board, duplicateByCoords.id);
            const duplicateChanged = applyIncomingFieldsToCard(duplicateByCoords, m);
            if (duplicateChanged) {
              updated++;
              await appendAutoImportCsvLog({
                action: "Einsatz aktualisiert (Auto-Import)",
                card: duplicateByCoords,
                columnKey: duplicateRef?.col,
                board,
              });
            }
            continue;
          }
          const now=new Date().toISOString();
          const importHumanId = `E-${nextHumanNumber(board)}`;
          const card={ id:uid(), content:m.content||"(ohne Titel)", createdAt:now, statusSince:now,
            assignedVehicles:[], everVehicles:[], everPersonnel:0,
            ort:m.ort, typ:m.typ, externalId:m.externalId, alerted:m.alerted,
            humanId: importHumanId,
            latitude:m.latitude, longitude:m.longitude,
            location: m.location || "",
            timestamp: m.timestamp || null,
            updated: m.updated ?? null,
            description: m.description || ""
          };
          board.columns["neu"].items.unshift(card);
          await saveBoard(board);
          await handleWeatherIncidentAndSvgForNewCard(card, { source: "fetcher" });
          created++;
          lastCreatedCard = card;
          await appendAutoImportCsvLog({
            action: "Einsatz erstellt (Auto-Import)",
            card,
            columnKey: "neu",
            board,
          });
        }
      }

      await updateGroupAlertedStatuses(alertedGroups);
      await saveBoard(board);
      importLastLoadedAt = Date.now();
      importLastFile     = filename;
      return { ok:true, created, updated, skipped, file:filename };
    }catch(e){
      await appendError("importFromFileOnce/loop", e);
      throw e;
    }
  });
}

let autoTimer=null;
function clearAutoTimer(){ if(autoTimer){ clearInterval(autoTimer); autoTimer=null; } }
async function startAutoTimer(){
  clearAutoTimer();
  const cfg=await readAutoCfg();
  if(!cfg.enabled) return;
  autoNextAt = Date.now() + resolveAutoIntervalMs(cfg.intervalSec);
  autoTimer=setInterval(async ()=>{
    try{
      const r=await importFromFileOnce(cfg.filename);
      autoNextAt = Date.now() + resolveAutoIntervalMs(cfg.intervalSec);
      if(!r.ok){
        console.warn("[auto-import] Fehler:", r.error);
        await appendError("auto-import", new Error(r.error));
      }
    }catch(e){
      console.warn("[auto-import] Exception:", e?.message||e);
      await appendError("auto-import/exception", e);
    }
  }, resolveAutoIntervalMs(cfg.intervalSec));
}

app.get("/api/import/auto-config",  async (_req,res)=>{ res.json(await readAutoCfg()); });
app.post("/api/import/auto-config", async (req,res)=>{
  try{
    const body = req.body||{};
    const update = {};
    if (body.enabled !== undefined) update.enabled = !!body.enabled;
    if (body.intervalSec !== undefined) {
      const num = Number(body.intervalSec);
      if (Number.isFinite(num) && num > 0) update.intervalSec = num;
    }
    if (body.demoMode !== undefined) update.demoMode = !!body.demoMode;

    const next=await writeAutoCfg(update);
    if(next.enabled){
      await startAutoTimer();
      if(next.demoMode){
        try{ if (ffStatus().running) await ffStop(); }catch{}
      }else{
        try{
          const pollMs = resolveAutoIntervalMs(next.intervalSec);
          if (ffStatus().running) await ffStop();

          const it = await User_getGlobalFetcher(); // <— GLOBAL
          if (it?.creds?.username && it?.creds?.password) {
            await ffStart({ username: it.creds.username, password: it.creds.password, pollIntervalMs: pollMs });
            markActivity("auto-config:enable-or-restart");
            importLastLoadedAt = null; importLastFile = AUTO_DEFAULT_FILENAME; autoNextAt = null;
          } else {
            console.warn("[auto-config] keine globalen Fetcher-Creds gesetzt");
          }
        }catch(e){ await appendError("auto-config/restart-fetcher", e); }
      }
    }else{
      clearAutoTimer(); autoNextAt=null;
      try{ await ffStop(); }catch{}
    }
    res.json(next);
  }catch(err){
    res.status(400).json({ ok:false, error:err?.message||"Speichern fehlgeschlagen" });
  }
});

app.get("/api/situation/analysis-config", User_requireAuth, async (_req, res) => {
  const cfg = await readAiAnalysisCfg();
  res.json(cfg);
});

app.post("/api/situation/analysis-config", User_requireAuth, async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  try {
    const body = req.body || {};
    const update = {};
    if (body.enabled !== undefined) update.enabled = !!body.enabled;
    if (body.intervalMinutes !== undefined) {
      const minutes = Number(body.intervalMinutes);
      // 0 = nur manuelle Auslösung, sonst min. 1 Minute
      if (!Number.isFinite(minutes) || minutes < 0) {
        return res.status(400).json({
          ok: false,
          error: `Intervall muss 0 (nur manuell) oder mindestens ${AI_ANALYSIS_MIN_INTERVAL_MINUTES} Minute betragen.`,
        });
      }
      if (minutes > 0 && minutes < AI_ANALYSIS_MIN_INTERVAL_MINUTES) {
        return res.status(400).json({
          ok: false,
          error: `Intervall muss 0 (nur manuell) oder mindestens ${AI_ANALYSIS_MIN_INTERVAL_MINUTES} Minute betragen.`,
        });
      }
      update.intervalMinutes = Math.floor(minutes);
    }
    if (body.useRagContext !== undefined) {
      update.useRagContext = !!body.useRagContext;
    }
    const next = await writeAiAnalysisCfg(update);
    try {
      await syncAiAnalysisLoop();
    } catch (err) {
      console.warn("[ai-analysis] Sync fehlgeschlagen:", err?.message || err);
    }
    res.json(next);
  } catch (err) {
    res.status(400).json({ ok:false, error: err?.message || "Speichern fehlgeschlagen" });
  }
});

app.get("/api/protocol/auto-print-config", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const cfg = await readAutoPrintCfg();
  res.json(cfg);
});

app.post("/api/protocol/auto-print-config", async (req, res) => {
  if (!User_hasRole(req?.user, "Admin")) {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  try {
    const body = req.body || {};
    const update = {};
    if (body.enabled !== undefined) update.enabled = parseAutoPrintEnabled(body.enabled);
    if (body.intervalMinutes !== undefined) {
      const minutes = Number(body.intervalMinutes);
      if (!Number.isFinite(minutes) || minutes < AUTO_PRINT_MIN_INTERVAL_MINUTES) {
        return res.status(400).json({
          ok: false,
          error: `Intervall muss mindestens ${AUTO_PRINT_MIN_INTERVAL_MINUTES} Minute betragen.`,
        });
      }
      update.intervalMinutes = Math.floor(minutes);
    }
    if (body.entryScope !== undefined) {
      update.entryScope = parseAutoPrintScope(body.entryScope);
    }
    const before = await readAutoPrintCfg();
    if (update.enabled === true && !before.enabled) {
      update.lastRunAt = Date.now();
    } else if (update.enabled === false) {
      update.lastRunAt = null;
    }
    const next = await writeAutoPrintCfg(update);
    await startAutoPrintTimer();
    res.json(next);
  } catch (err) {
    await appendError("auto-print/config", err);
    res.status(400).json({ ok:false, error: err?.message || "Speichern fehlgeschlagen" });
  }
});

async function triggerOnce(_req,res){
  try{
    const cfg = await readAutoCfg();
    const status = ffStatus();
    const fetcherBusy = status.running || status.starting || status.stopping;
    const shouldTriggerFetcherBeforeImport = !cfg.demoMode && !fetcherBusy;

    if (shouldTriggerFetcherBeforeImport) {
      const creds = await User_getGlobalFetcher();
      if (!creds?.creds?.username || !creds?.creds?.password) {
        return res.status(400).json({ ok:false, error:"Keine globalen Fetcher-Zugangsdaten hinterlegt" });
      }

      try {
        const pollMs = resolveAutoIntervalMs(cfg.intervalSec);
        await ffRunOnce({
          username: creds.creds.username,
          password: creds.creds.password,
          pollIntervalMs: pollMs,
        });
        markActivity("fetcher:run-once");
      } catch (err) {
        await appendError("triggerOnce/fetcher-once", err);
        return res.status(500).json({ ok:false, error: err.message || "Fetcher konnte nicht gestartet werden" });
      }
    }

    const r = await importFromFileOnce(cfg.filename);
    if(!r.ok) return res.status(400).json(r);
    markActivity("import:manual");
    res.json(r);
  }catch(e){
    await appendError("triggerOnce", e);
    res.status(400).json({ ok:false, error:e.message||"Fehler beim Import" });
  }
}
app.post("/api/import/trigger", triggerOnce);
app.get ("/api/import/trigger",  triggerOnce);

// Zusammengefasster Status für UI
app.get("/api/ff/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  const s = ffStatus();
  const user = req.user ? { id:req.user.id, username:req.user.username, role:req.user.role, roles:req.user.roles || [] } : null;
  res.json({ loggedIn: !!req.user, user, ...s });
});

// Kompatible Ersatz-Route: pro-User Fetcher-Creds (statt alter Datei)
app.get("/api/ff/creds", async (_req,res)=>{
  const has = await User_hasGlobalFetcher().catch(()=>false);
  res.json({ has, scope:"global" });
});
app.post("/api/ff/creds", async (req,res)=>{
  try{
    const { username, password } = req.body||{};
    if(!username||!password) return res.status(400).json({ ok:false, error:"username/password erforderlich" });
    const u = await User_update(req.user.id, { fetcherCreds:{ username, password } });
    res.json({ ok:true, user:{ id:u.id, username:u.username, role:u.role } });
  }catch(e){
    await appendError("ff/creds/save", e);
    res.status(400).json({ ok:false, error:e.message||"Speichern fehlgeschlagen" });
  }
});

// Fetcher-Status (Details)
app.get("/api/ff/status/details", (_req,res)=>{ res.json(ffStatus()); });

// Fetcher starten – nutzt die in req.user hinterlegten Zugangsdaten
app.post("/api/ff/start", async (_req,res)=>{
  try{
    const cfg = await readAutoCfg();
    if (!cfg.enabled) return res.status(403).json({ ok:false, error:"Auto-Import ist deaktiviert" });
    if (cfg.demoMode) {
      return res.status(403).json({ ok:false, error:"Demomodus aktiv – Fetcher darf nicht gestartet werden" });
    }

    const it = await User_getGlobalFetcher();
    if (!it?.creds?.username || !it?.creds?.password) {
      return res.status(400).json({ ok:false, error:"Keine globalen Fetcher-Zugangsdaten hinterlegt" });
    }

    const st = await ffStart({
      username: it.creds.username,
      password: it.creds.password,
      pollIntervalMs: resolveAutoIntervalMs(cfg.intervalSec)
    });
    markActivity("ff/start");
    importLastLoadedAt = null;
    importLastFile     = AUTO_DEFAULT_FILENAME;
    autoNextAt         = null;
    res.json({ ok:true, status:st });
  } catch (e) {
    await appendError("ff/start", e);
    res.status(500).json({ ok:false, error:String(e?.message || "Fehler beim Starten") });
  }
});

// Fetcher stoppen
app.post("/api/ff/stop", (_req,res)=>{
  try{ const r=ffStop(); res.json({ ok:true, ...r }); }
  catch(e){ appendError("ff/stop", e); throw e; }
});

// ===================================================================
// =                                PDF                               =
// ===================================================================
app.get("/api/export/pdf", async (_req,res)=>{
  const board=await ensureBoard();
  const vmap=vehiclesByIdMap(await getAllVehicles());

  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`inline; filename="einsatz_${tsFile()}.pdf"`);

  const doc=new PDFDocument({ autoFirstPage:false, margin:36 }); doc.pipe(res);
  const titles={ "neu":"Neu", "in-bearbeitung":"In Bearbeitung", "erledigt":"Erledigt" };
  const cardUnitCount=(c,k)=> k==="erledigt" ? (c.everVehicles||[]).length : (c.assignedVehicles||[]).length;
  const cardPersonCount=(c,k)=> k==="erledigt" ? (Number.isFinite(c.everPersonnel)?c.everPersonnel:0)
      : (Number.isFinite(c?.manualPersonnel)?c.manualPersonnel:(c.assignedVehicles||[]).reduce((s,id)=>s+(vmap.get(id)?.mannschaft??0),0));
  const ascii=s=>String(s||"").normalize("NFKD").replace(/[^\x20-\x7E]/g,"");

  function writeCard(c,k,w){
    doc.font("Helvetica-Bold").fontSize(10).text(ascii(c.content||"(ohne Titel)"),{width:w});
    doc.font("Helvetica").fontSize(9);
    const parts=[`Fzg: ${cardUnitCount(c,k)}`,`Pers.: ${cardPersonCount(c,k)}`];
    if(c.ort) parts.push(`Ort: ${ascii(c.ort)}`); if(c.typ) parts.push(`Typ: ${ascii(c.typ)}`);
    parts.push(`Erst.: ${fmt24(c.createdAt)}  |  Seit: ${fmt24(c.statusSince)}`);
    doc.text(parts.join("  |  "),{width:w});
    const ids = k==="erledigt" ? (c.everVehicles||[]) : (c.assignedVehicles||[]);
    if(ids.length){
      const labelStore = c.everVehicleLabels || {};
      const entries = ids.map(id => formatVehicleDisplayById(id, vmap, labelStore));
      doc.moveDown(0.1);
      doc.text(`Einheiten: ${entries.join(", ")}`,{width:w});
    }
    doc.moveDown(0.35);
  }
  function addPage(key){
    const items=board.columns[key]?.items||[];
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text(`Einsatzstellen – ${titles[key]}`);
    doc.fontSize(9).fillColor("#555").text(`Stand: ${tsHuman()}`); doc.moveDown(0.3);
    doc.fillColor("#000").font("Helvetica").fontSize(10).text(`⬛ ${items.length}`); doc.moveDown(0.4);
    if(items.length===0){ doc.fontSize(10).fillColor("#444").text("— keine Einträge —"); doc.fillColor("#000"); return; }

    const mL=doc.page.margins.left, mR=doc.page.margins.right;
    const W=doc.page.width-mL-mR, gutter=16, colW=Math.floor((W-gutter)/2);
    let col=0, yTop=doc.y;
    const nextCol=()=>{ col=(col+1)%2; if(col===0){ doc.addPage(); yTop=doc.y; } doc.x=mL+(col===0?0:colW+gutter); doc.y=yTop; };
    doc.x=mL; doc.y=yTop;

    for(const c of items){
      const y0=doc.y;
      writeCard(c,key,colW);
      if(doc.y>doc.page.height-doc.page.margins.bottom-24){ doc.y=y0; nextCol(); writeCard(c,key,colW); }
    }
  }
  for(const k of ["neu","in-bearbeitung","erledigt"]) addPage(k);
  doc.end();
});

// ===================================================================
// =                       LAGEKARTE PROXY (SSO)                      =
// ===================================================================
const LAGEKARTE_BASE_URL = "https://www.lagekarte.info";
const LK_BASE = "https://www.lagekarte.info/de";
const LAGEKARTE_API_LOGIN = "/de/php/api.php/user/login";

// In-memory token cache
let _lagekarteTokenCache = {
  token: null,
  uid: null,
  userId: null,
  expiresAt: 0
};

// Token TTL: 30 minutes (conservative, refresh before expiry)
const LAGEKARTE_TOKEN_TTL_MS = 30 * 60 * 1000;

async function lagekarteLogin(rid = null) {
  const requestId = rid || generateRequestId();
  const startTime = Date.now();

  // Load credentials
  let creds = null;
  let masterLocked = false;
  try {
    creds = await User_getGlobalLagekarte();
  } catch (err) {
    if (err?.message === "MASTER_LOCKED") {
      masterLocked = true;
      await logLagekarteWarn("Master locked, cannot decrypt credentials", {
        rid: requestId,
        phase: "creds_load",
        masterLocked: true,
        credsPresent: false,
      });
      return { error: "MASTER_LOCKED" };
    }
    // Other error during credential load
    await logLagekarteError("Credential load error", {
      rid: requestId,
      phase: "creds_load",
      error: err?.message || "unknown",
    });
    creds = null;
  }

  const credsPresent = !!(creds?.creds?.username && creds?.creds?.password);

  // Log credential load phase (Option A masking)
  await logLagekarteInfo("Credentials loaded", {
    rid: requestId,
    phase: "creds_load",
    credsPresent,
    masterLocked: false,
    username_masked: credsPresent ? maskA(creds.creds.username) : "",
    password_masked: credsPresent ? maskA(creds.creds.password) : "",
  });

  if (!credsPresent) {
    return { error: "CREDENTIALS_MISSING" };
  }

  // Perform login request
  const loginUrl = `${LAGEKARTE_BASE_URL}${LAGEKARTE_API_LOGIN}`;

  await logLagekarteInfo("Login request starting", {
    rid: requestId,
    phase: "login_request",
    remoteUrl: loginUrl,
  });

  try {
    // Build form-urlencoded body with correct parameter names (user, pw)
    const formBody = new URLSearchParams();
    formBody.set("user", creds.creds.username);
    formBody.set("pw", creds.creds.password);

    const res = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://www.lagekarte.info",
        "Referer": "https://www.lagekarte.info/de/"
      },
      body: formBody.toString()
    });

    if (!res.ok) {
      // Try to get response body for diagnostics
      let responseSnippet = "";
      try {
        const text = await res.text();
        responseSnippet = sanitizeSnippet(text);
      } catch { /* ignore */ }

      await logLagekarteError("Login failed (HTTP error)", {
        rid: requestId,
        phase: "login_failed",
        httpStatus: res.status,
        elapsedMs: Date.now() - startTime,
        responseSnippet,
      });
      return { error: "LOGIN_FAILED", status: res.status };
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      await logLagekarteError("Login response parse failed", {
        rid: requestId,
        phase: "login_parse_failed",
        elapsedMs: Date.now() - startTime,
        error: parseErr?.message || "JSON parse error",
      });
      return { error: "LOGIN_PARSE_FAILED" };
    }

    // Lagekarte API response format:
    // Success: { error: "false", user: { token: "...", id: ..., ... } }
    // Failure: { error: "true", error_msg: "..." }

    // Handle error even on HTTP 200
    if (data?.error === "true" || data?.error === true) {
      const errorMsg = data?.error_msg || "unknown error";
      await logLagekarteError("Login failed: API returned error", {
        rid: requestId,
        phase: "login_failed",
        httpStatus: res.status,
        elapsedMs: Date.now() - startTime,
        error_msg: sanitizeSnippet(errorMsg),
      });
      return { error: "LOGIN_API_ERROR", message: errorMsg };
    }

    // Verify success response and extract token from user object
    const token = data?.user?.token;
    if (data?.error !== "false" || !token) {
      await logLagekarteError("Login failed: unexpected response format", {
        rid: requestId,
        phase: "login_failed",
        httpStatus: res.status,
        elapsedMs: Date.now() - startTime,
        responseSnippet: sanitizeSnippet(JSON.stringify(data)),
      });
      return { error: "LOGIN_NO_TOKEN" };
    }

    _lagekarteTokenCache = {
      token: token,
      uid: data.user?.uid || null,
      userId: data.user?.id || null,
      expiresAt: Date.now() + LAGEKARTE_TOKEN_TTL_MS
    };

    await logLagekarteInfo("Login successful", {
      rid: requestId,
      phase: "login_ok",
      elapsedMs: Date.now() - startTime,
    });

    return { ok: true, token: token, uid: data.user?.uid, userId: data.user?.id };
  } catch (err) {
    await logLagekarteError("Login error (network/fetch)", {
      rid: requestId,
      phase: "login_failed",
      elapsedMs: Date.now() - startTime,
      error: err?.message || "unknown",
    });
    return { error: "LOGIN_ERROR", message: err.message };
  }
}

async function getLagekarteToken(rid = null) {
  const requestId = rid || generateRequestId();

  // Check if token is still valid (with 1 minute buffer)
  const tokenValid = _lagekarteTokenCache.token && _lagekarteTokenCache.expiresAt > Date.now() + 60000;

  await logLagekarteInfo("Token cache check", {
    rid: requestId,
    phase: "token_cache",
    tokenCacheHit: tokenValid,
  });

  if (tokenValid) {
    return _lagekarteTokenCache;
  }

  // Need to refresh token
  const result = await lagekarteLogin(requestId);
  if (result.error) {
    return null;
  }
  return _lagekarteTokenCache;
}

function sendLagekarteError(res, message, status = 503) {
  res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(`
    <!DOCTYPE html>
    <html lang="de">
    <head><meta charset="UTF-8"><title>Lagekarte - Fehler</title>
    <style>body{font-family:sans-serif;padding:2rem;max-width:600px;margin:auto;}h1{color:#c00;}</style>
    </head>
    <body>
      <h1>Lagekarte nicht verfügbar</h1>
      <p>${message}</p>
      <p><a href="/">Zurück zur Übersicht</a></p>
    </body>
    </html>
  `);
}

// Proxy handler for /lagekarte/*
app.use("/lagekarte", User_requireAuth, async (req, res) => {
  const rid = generateRequestId();
  const startTime = Date.now();
  const requestPath = req.path || "/";

  // Log request start
  await logLagekarteInfo("Request started", {
    rid,
    phase: "start",
    path: requestPath,
    method: req.method,
  });

  // Get or refresh token (logging happens inside getLagekarteToken/lagekarteLogin)
  const tokenData = await getLagekarteToken(rid);
  if (!tokenData) {
    // Determine the specific error reason
    let errorReason = "login_failed";
    let credsPresent = false;

    try {
      const creds = await User_getGlobalLagekarte();
      credsPresent = !!(creds?.creds?.username && creds?.creds?.password);
    } catch (err) {
      if (err?.message === "MASTER_LOCKED") {
        await logLagekarteError("Request failed - master locked", {
          rid,
          phase: "master_locked",
          masterLocked: true,
          elapsedMs: Date.now() - startTime,
        });
        return sendLagekarteError(res, "Lagekarte nicht verfügbar: Master-Passwort nicht entsperrt.", 503);
      }
    }

    if (!credsPresent) {
      await logLagekarteError("Request failed - credentials missing", {
        rid,
        phase: "creds_missing",
        credsPresent: false,
        elapsedMs: Date.now() - startTime,
      });
      return sendLagekarteError(res, "Lagekarte Zugangsdaten fehlen. Bitte im Admin Panel unter 'Lagekarte-Zugangsdaten' konfigurieren.", 400);
    }

    // Login failed for other reason (already logged in lagekarteLogin)
    await logLagekarteError("Request failed - login unsuccessful", {
      rid,
      phase: "login_failed",
      credsPresent: true,
      elapsedMs: Date.now() - startTime,
    });
    return sendLagekarteError(res, "Lagekarte Login fehlgeschlagen. Bitte Zugangsdaten im Admin Panel prüfen.");
  }

  // Build target URL - use /de/ base for German interface
  let targetPath = requestPath;
  if (targetPath === "/" || targetPath === "") {
    targetPath = "/de/";
  }

  // Intercept login request - return cached token instead
  // Response format matches Lagekarte API: { error: "false", user: { token, id, uid } }
  if (targetPath === "/de/php/api.php/user/login" && req.method === "POST") {
    await logLagekarteInfo("Intercepted login - returning cached token", {
      rid,
      phase: "login_intercept",
      elapsedMs: Date.now() - startTime,
    });
    return res.json({
      error: "false",
      user: {
        token: tokenData.token,
        id: tokenData.userId,
        uid: tokenData.uid
      }
    });
  }

  const targetUrl = new URL(targetPath, LAGEKARTE_BASE_URL);
  // Forward query string
  if (req.originalUrl.includes("?")) {
    const queryPart = req.originalUrl.split("?")[1];
    targetUrl.search = queryPart;
  }
  // Add token to API requests
  if (targetPath.includes("/php/api.php/") || targetPath.includes("/daten/")) {
    targetUrl.searchParams.set("token", tokenData.token);
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0 EINFO-Lagekarte-Proxy/1.0",
        "Accept": req.headers.accept || "*/*",
        "Accept-Language": req.headers["accept-language"] || "de-DE,de;q=0.9,en;q=0.8",
      },
      redirect: "follow"
    };

    // Forward body for POST/PUT/PATCH
    if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
      const contentType = req.headers["content-type"] || "application/json";
      fetchOptions.headers["Content-Type"] = contentType;
      if (contentType.includes("application/json")) {
        fetchOptions.body = JSON.stringify(req.body);
      } else if (typeof req.body === "string") {
        fetchOptions.body = req.body;
      } else {
        fetchOptions.body = JSON.stringify(req.body);
      }
    }

    const upstream = await fetch(targetUrl.href, fetchOptions);

    // Forward status and relevant headers
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    // Handle HTML - rewrite absolute URLs to go through proxy
    if (contentType?.includes("text/html")) {
      let html = await upstream.text();
      // Rewrite absolute URLs to lagekarte.info to go through our proxy
      html = html.replace(/https?:\/\/www\.lagekarte\.info/g, "/lagekarte");
      html = html.replace(/href="\//g, 'href="/lagekarte/');
      html = html.replace(/src="\//g, 'src="/lagekarte/');
      html = html.replace(/action="\//g, 'action="/lagekarte/');
      // Fix double rewrites
      html = html.replace(/\/lagekarte\/lagekarte\//g, "/lagekarte/");
      return res.send(html);
    }

    // Handle CSS - rewrite url() references
    if (contentType?.includes("text/css")) {
      let css = await upstream.text();
      css = css.replace(/url\(\s*['"]?\//g, 'url("/lagekarte/');
      return res.send(css);
    }

    // Handle JS - rewrite fetch/ajax URLs
    if (contentType?.includes("javascript")) {
      let js = await upstream.text();
      // Rewrite API base URLs - use /de/ for German interface
      js = js.replace(/['"]https?:\/\/www\.lagekarte\.info/g, '"/lagekarte');
      js = js.replace(/['"]\/de\/php\/api\.php/g, '"/lagekarte/de/php/api.php');
      js = js.replace(/['"]\/daten\//g, '"/lagekarte/daten/');
      return res.send(js);
    }

    // Stream binary/other content
    if (upstream.body) {
      const reader = upstream.body.getReader();
      const stream = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await stream();
    } else {
      res.end();
    }
  } catch (err) {
    await logLagekarteError("Proxy error", {
      rid,
      phase: "proxy_failed",
      remoteUrl: sanitizeUrl(targetUrl.href),
      error: err?.message || "unknown",
      elapsedMs: Date.now() - startTime,
    });
    return sendLagekarteError(res, `Verbindung zu Lagekarte fehlgeschlagen: ${err.message}`);
  }
});

async function lagekarteRootProxy(req, res) {
  const rid = generateRequestId();
  const upstreamUrl = `${LK_BASE}${req.originalUrl}`;
  const incomingHeaders = req.headers ?? {};
  const proxyHeaders = {};

  for (const [headerName, headerValue] of Object.entries(incomingHeaders)) {
    if (headerValue == null) continue;
    const lower = headerName.toLowerCase();
    if ([
      "host",
      "connection",
      "content-length",
      "transfer-encoding",
      "proxy-authorization",
      "proxy-authenticate",
      "upgrade",
      "te",
      "trailer",
      "keep-alive",
    ].includes(lower)) {
      continue;
    }
    proxyHeaders[headerName] = headerValue;
  }

  const fetchOptions = {
    method: req.method,
    headers: proxyHeaders,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(req.method)) {
    if (req.body && Object.keys(req.body).length > 0) {
      const contentType = req.headers["content-type"] || "application/json";
      fetchOptions.headers["content-type"] = contentType;
      fetchOptions.body = contentType.includes("application/json")
        ? JSON.stringify(req.body)
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body);
    } else {
      fetchOptions.body = req;
      fetchOptions.duplex = "half";
    }
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, fetchOptions);

    if (!upstreamRes.ok) {
      await logLagekarteWarn("Lagekarte root proxy upstream non-2xx", {
        rid,
        phase: "proxy_failed",
        path: req.originalUrl,
        upstreamUrl,
        httpStatus: upstreamRes.status,
      });
    }

    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (["transfer-encoding", "connection", "keep-alive"].includes(lower)) return;
      res.setHeader(key, value);
    });

    if (upstreamRes.body) {
      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    return res.end();
  } catch (err) {
    await logLagekarteError("Lagekarte root proxy failed", {
      rid,
      phase: "proxy_failed",
      path: req.originalUrl,
      upstreamUrl,
      httpStatus: 502,
      error: err?.message || "unknown",
    });
    return res.status(502).send("Bad Gateway");
  }
}

app.use("/src", lagekarteRootProxy);
app.use("/js", lagekarteRootProxy);
app.use("/css", lagekarteRootProxy);
app.use("/img", lagekarteRootProxy);
app.use("/fonts", lagekarteRootProxy);

// ===================================================================
// =                             STATICS                              =
// ===================================================================
app.get("/Hilfe.pdf", async (_req,res)=>{
  const a=path.join(DATA_DIR,"Hilfe.pdf"); try{ await fs.access(a); return res.sendFile(a); }catch{}
  const b=path.join(DIST_DIR,"Hilfe.pdf"); try{ await fs.access(b); return res.sendFile(b); }catch{}
  res.status(404).send("Hilfe.pdf nicht gefunden");
});
app.get("/status", (_req,res)=>res.sendFile(path.join(DIST_DIR,"index.html")));

// ---- Static + SPA-Fallback -------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.use(express.static(DIST_DIR));

app.get("*", (req, res, next) => {
  const isApi = req.path.startsWith("/api/");
  const looksLikeFile = /\.[a-zA-Z0-9]{2,8}$/.test(req.path);
  if (!isApi && !looksLikeFile) {
    return res.sendFile(path.join(DIST_DIR, "index.html"));
  }
  next();
});

// ===================================================================
// =                      ZENTRALE FEHLER-MIDDLEWARE                  =
// ===================================================================
app.use(async (err, req, res, _next) => {
  try{ await appendError(`${req.method} ${req.url}`, err, { code: err?.code || "" }); }catch{}
  res.status(500).json({ ok:false, error:String(err?.message || err || "Unbekannter Fehler") });
});

// ===================================================================
// =                             STARTUP                              =
// ===================================================================
process.on("uncaughtException", async (err)=>{ await appendError("uncaughtException", err); console.error(err); });
process.on("unhandledRejection", async (reason)=>{
  const err = reason instanceof Error ? reason : new Error(String(reason));
  await appendError("unhandledRejection", err);
  console.error(reason);
});

app.listen(PORT, async ()=>{
  console.log(`[kanban] Server auf http://localhost:${PORT}`);
  // Beim Start IMMER Auto-Import deaktivieren (Sicherheits-Default)
  await writeAutoCfg({ enabled:false });
  clearAutoTimer(); autoNextAt = null;
  try { await ffStop(); } catch {}
  markActivity("startup:autoimport-disabled");
  console.log("[auto-import] beim Start automatisch deaktiviert");
  await startAutoPrintTimer();
  await startMailScheduleTimer({ immediate: true });
  await startApiScheduleTimer({ immediate: true });
});

// Routen aus Aufgaben-Board
app.use("/api/aufgaben", User_requireAuth, aufgabenRoutes);

 // Admin-Maintenance: DATA_DIR an Routes durchreichen (synchron zu server.js)
 process.env.DATA_DIR = DATA_DIR;
import createAdminMaintenanceRoutes from "./routes/userAdminMaintenanceRoutes.js";
app.use("/api/user/admin", createAdminMaintenanceRoutes({ baseDir: DATA_DIR }));

// Admin-Filtering: Hybrid-Filtersystem (Regeln + Context-Fingerprint + Lernen)
import adminFilteringRouter from "./routes/admin_filtering.js";
app.use("/api/admin/filtering-rules", User_requireAuth, adminFilteringRouter);

// UI-Theme-Konfiguration (Farben, Watermark)
import uiThemeRouter from "./routes/ui_theme.js";
app.use("/api/ui-theme", User_requireAuth, uiThemeRouter);
