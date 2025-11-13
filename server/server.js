import "./utils/loadEnv.mjs";
import express from "express";
import compression from "compression";
import cors from "cors";
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
import { appendCsvRow } from "./auditLog.mjs";
import createServerPrintRoutes from "./routes/serverPrintRoutes.js";
import { getProtocolCreatedAt, parseAutoPrintTimestamp } from "./utils/autoPrintHelpers.js";

// 🔐 Neues User-Management
import { User_authMiddleware, User_createRouter, User_requireAuth } from "./User_auth.mjs";
import { User_update, User_getGlobalFetcher, User_hasGlobalFetcher } from "./User_store.mjs";

// Fetcher Runner
import { ffStart, ffStop, ffStatus, ffRunOnce } from "./ffRunner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 4040;
const SECURE_COOKIES = process.env.KANBAN_COOKIE_SECURE === "1";

const ROOT      = path.join(__dirname);
const DATA_DIR  = path.join(ROOT, "data");
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
const ERROR_LOG   = path.join(DATA_DIR, "Log.txt");
const GROUPS_FILE = path.join(DATA_DIR, "group_locations.json");
const GROUP_AVAILABILITY_FILE = path.join(DATA_DIR, "group-availability.json");
const GROUP_ALERTED_FILE = path.join(DATA_DIR, "conf", "group-alerted.json");
const PROTOCOL_JSON_FILE = path.join(DATA_DIR, "protocol.json");
const AUTO_PRINT_CFG_FILE = path.join(DATA_DIR, "conf", "auto-print.json");
const AUTO_PRINT_OUTPUT_DIR = path.resolve(
  process.env.KANBAN_PROTOKOLL_PRINT_DIR || path.join(DATA_DIR, "prints", "protokoll"),
);

const DEFAULT_BOARD_COLUMNS = {
  neu: "Neu",
  "in-bearbeitung": "In Bearbeitung",
  erledigt: "Erledigt",
};

const BOARD_CACHE_MAX_AGE_MS = (() => {
  const raw = Number(process.env.BOARD_CACHE_MAX_AGE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5_000;
})();

let boardCacheValue = null;
let boardCacheExpiresAt = 0;
let boardCachePromise = null;

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

const VEHICLE_CACHE_TTL_MS = 10_000;
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

// ==== Auto-Import ====
const AUTO_CFG_FILE         = path.join(DATA_DIR, "conf","auto-import.json");
const AUTO_DEFAULT_FILENAME = "list_filtered.json";
const AUTO_DEFAULT          = { enabled:false, intervalSec:30, filename:AUTO_DEFAULT_FILENAME, demoMode:false };
const AUTO_IMPORT_USER      = "EinsatzInfo";
const AUTO_PRINT_DEFAULT    = { enabled:false, intervalMinutes:10, lastRunAt:null, entryScope:"interval", scope:"interval" };
const AUTO_PRINT_MIN_INTERVAL_MINUTES = 1;

// Merker für Import-Status
let importLastLoadedAt = null;   // ms
let importLastFile     = null;   // string
let autoNextAt         = null;   // ms – nächster geplanter Auto-Import
let autoPrintTimer     = null;
let autoPrintRunning   = false;

// ----------------- Helpers -----------------
async function ensureDir(p){ await fs.mkdir(p,{ recursive:true }); }
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
setInterval(async () => {
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
}, 60_000);

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
  try{
    await ensureDir(path.dirname(ERROR_LOG));
    const ts = tsHuman();
    const msg = (err && err.stack) ? String(err.stack) : String(err?.message || err || "-");
    const extraStr = extra ? " " + JSON.stringify(extra) : "";
    const line = `[${ts}] [${where}] ${msg}${extraStr}\n`;
    await fs.appendFile(ERROR_LOG, line, "utf8");
  }catch(e){
    console.error("[LOG.txt] write failed:", e);
  }
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
app.use("/api/protocol", protocolRouter);

app.use("/api/user", userRolesRouter({ dataDir: DATA_DIR }));

app.use(User_authMiddleware({ secureCookies: SECURE_COOKIES }));
app.use("/api/user", User_createRouter({
  dataDir: DATA_DIR,
  secureCookies: SECURE_COOKIES
}));

const INTERNAL_AUTO_PRINT_HEADER = "x-internal-auto-print";

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
  if (!req.user) return res.status(401).json({ ok:false, error:"UNAUTHORIZED" });
  next();
});

app.use("/api/mail", createMailRouter());


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

app.post("/api/vehicles", async (req,res)=>{
  const { ort, label, mannschaft=0, cloneOf="" } = req.body||{};
  if(!ort||!label) return res.status(400).json({ error:"ort und label sind erforderlich" });

  const extra = await readExtraVehiclesRaw();
  const cloneTag = typeof cloneOf === "string" ? cloneOf.trim() : "";
  const isCloneRequest = !!cloneTag;
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
    if(exists) return res.status(409).json({ error:"Einheit existiert bereits" });
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

  const action = isCloneRequest ? "Einheit geteilt" : "Einheit angelegt";
  await appendCsvRow(
    LOG_FILE,
    EINSATZ_HEADERS,
    buildEinsatzLog({ action, note: `${label} (${ort})` }),
    req,
    { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
  );
  res.json({ ok:true, vehicle:v });
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
  const map = await readVehicleAvailability().catch(() => ({}));
  if (available) delete map[id];
  else if (untilIso) map[id] = { available: false, until: untilIso };
  else map[id] = false;
  await writeVehicleAvailability(map);
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
 
 if(!card.isArea && areaIdStr){
    const area = findCardById(board, areaIdStr);
    if(area?.isArea) card.areaCardId = String(area.id);
  }

if (card.isArea) {
    card.areaColor = normalizeAreaColor(requestedAreaColor || DEFAULT_AREA_COLOR, DEFAULT_AREA_COLOR);
  } else if (card.areaCardId) {
    const area = findCardById(board, card.areaCardId);
    card.areaColor = area?.areaColor || null;
  }
  const arr = board.columns[key].items;
  arr.splice(Math.max(0, Math.min(Number(toIndex) || 0, arr.length)), 0, card);
  await saveBoard(board);
await appendCsvRow(
    LOG_FILE, EINSATZ_HEADERS,
    buildEinsatzLog({ action:"Einsatz erstellt", card, from:board.columns[key].name, note:card.ort || "", board }),
    req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
  );
  markActivity("card:create");
  res.json({ ok: true, card, column: key });
});

app.post("/api/cards/:id/move", async (req,res)=>{
  const { id }=req.params;
  const { from, to, toIndex=0 }=req.body||{};

  const board=await ensureBoard();
  const src=board.columns[from]?.items||[];
  const idx=src.findIndex(c=>c.id===id);
  if(idx<0) return res.status(404).json({ error:"card not found" });

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

  const board=await ensureBoard();
  const ref=findCardRef(board,id);
  if(!ref) return res.status(404).json({ error:"card not found" });

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
  if (snapshotOrt) {
    await markGroupAlertedResolved(snapshotOrt);
  }
  markActivity("vehicle:assign");
  res.json({ ok:true, card:ref.card });

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
  const board=await ensureBoard();
  const ref=findCardRef(board,id);
  if(!ref) return res.status(404).json({ error:"card not found" });

  ref.card.assignedVehicles=(ref.card.assignedVehicles||[]).filter(v=>v!==vehicleId);
  await saveBoard(board);

  const vmap=vehiclesByIdMap(await getAllVehicles());
  const veh = vmap.get(vehicleId);
  const labelStore = ref.card.everVehicleLabels || {};
  const einheitsLabel = formatVehicleDisplay(veh, labelStore[String(vehicleId)], vehicleId);
  await appendCsvRow(
    LOG_FILE, EINSATZ_HEADERS,
    buildEinsatzLog({ action:"Einheit entfernt", card: ref.card, einheit: einheitsLabel, board }),
    req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
  );

  try {
    await removeClonesByIds(new Set([vehicleId]), board);
  } catch (e) {
    await appendError("vehicle:cleanup-unassign", e);
  }
  markActivity("vehicle:unassign");
  res.json({ ok:true, card:ref.card });

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
  const board=await ensureBoard(); const ref=findCardRef(board,id);
  if(!ref) return res.status(404).json({ error:"card not found" });

  const vmap = vehiclesByIdMap(await getAllVehicles());
  const prevAuto = (ref.card.assignedVehicles||[]).reduce((s,vid)=>s+(vmap.get(vid)?.mannschaft??0),0);
  const prev = Number.isFinite(ref.card?.manualPersonnel) ? ref.card.manualPersonnel : prevAuto;

  if(manualPersonnel===null||manualPersonnel===""||manualPersonnel===undefined){
    delete ref.card.manualPersonnel;
    await saveBoard(board);
   const autoNow = computedPersonnel(ref.card, vehiclesByIdMap(await getAllVehicles()));
  await appendCsvRow(
      LOG_FILE, EINSATZ_HEADERS,
      buildEinsatzLog({
        action: "Personenzahl geändert",
        card: ref.card,
        note: `${prev}→${autoNow}`,
        board,
      }),
      req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
    );
    return res.json({ ok:true, card:ref.card });
  }else{
    const n=Number(manualPersonnel);
    if(!Number.isFinite(n)||n<0) return res.status(400).json({ error:"manualPersonnel ungültig" });
    ref.card.manualPersonnel=n;
  }
  await saveBoard(board);
 await appendCsvRow(
    LOG_FILE, EINSATZ_HEADERS,
    buildEinsatzLog({
      action: "Personenzahl geändert",
      card: ref.card,
      note: `${prev}→${ref.card.manualPersonnel}`,
      board,
    }),
    req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
  );
  markActivity("personnel:update");
  res.json({ ok:true, card:ref.card });
});

app.patch("/api/cards/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const board = await ensureBoard();
  const ref = findCardRef(board, id);
  if (!ref) return res.status(404).json({ error: "card not found" });



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

  let changed = false;
  const notes = [];

  if (Object.prototype.hasOwnProperty.call(updates, "title")) {
    const nextTitle = String(updates.title || "").trim();
    if (!nextTitle) return res.status(400).json({ error: "Titel darf nicht leer sein" });
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
        return res.status(400).json({ error: "Bereich ungültig" });
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
    return res.json({ ok: true, card: ref.card, board });
  }

  await saveBoard(board);

  let actionLabel = "Einsatz aktualisiert";
  if (!ref.card.isArea && areaChanged && ref.card.areaCardId) {
    actionLabel = "Zu Abschnitt zugeordnet";
  }

  await appendCsvRow(
    LOG_FILE,
    EINSATZ_HEADERS,
    buildEinsatzLog({
      action: actionLabel,
      card: ref.card,
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
        card: ref.card,
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
        card: ref.card,
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
          note: `Bereich ${ref.card.humanId || ref.card.content || ref.card.id} nicht mehr verfügbar`,
          board,
        }),
        req,
        { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
      );
    }
  }

  markActivity("card:update");
  res.json({ ok: true, card: ref.card, board });
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
  const board=await ensureBoard();
  await ensureDir(ARCHIVE_DIR);
  await writeFileAtomic(path.join(ARCHIVE_DIR,`board_${tsFile()}.json`), JSON.stringify(board,null,2), "utf8");

  const fresh={ columns:{
    "neu":{name:"Neu",items:[]},
    "in-bearbeitung":{name:"In Bearbeitung",items:[]},
    "erledigt":{name:"Erledigt",items:[]}
  }};
  await saveBoard(fresh);
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
  return cfg;
}
async function writeAutoCfg(next){
  const keep=await readAutoCfg();
  const merged={ ...keep, ...next };
  const sanitized={
    ...merged,
    filename: AUTO_DEFAULT_FILENAME,
    enabled: !!merged.enabled,
    intervalSec: Number.isFinite(+merged.intervalSec)&&+merged.intervalSec>0 ? +merged.intervalSec : keep.intervalSec,
    demoMode: !!merged.demoMode,
  };
  await writeJson(AUTO_CFG_FILE,sanitized);
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
  } catch (error) {
    await appendError("group-alerted/update", error);
  }
}

async function markGroupAlertedResolved(groupName) {
  const normalized = normalizeGroupNameForAlert(groupName);
  if (!normalized) return;

  try {
    const prev = await readGroupAlerted().catch(() => ({}));
    if (Object.prototype.hasOwnProperty.call(prev || {}, normalized) && prev[normalized] === false) {
      return;
    }
    const next = { ...prev, [normalized]: false };
    await writeGroupAlerted(next);
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
  return { content, ort, alerted, latitude, longitude, externalId, typ:type, location, timestamp, description };
}

function applyIncomingFieldsToCard(target, incoming) {
  if (!target || !incoming) return;
  if (incoming.content) target.content = incoming.content;
  if (incoming.ort) target.ort = incoming.ort;
  if (incoming.typ) target.typ = incoming.typ;
  if (incoming.alerted) {
    const mergedAlerted = mergeAlertedValues(target.alerted, incoming.alerted);
    if (mergedAlerted) target.alerted = mergedAlerted;
  }
  if (incoming.latitude !== null) target.latitude = incoming.latitude;
  if (incoming.longitude !== null) target.longitude = incoming.longitude;
  if (typeof incoming.location === "string" && incoming.location) target.location = incoming.location;
  if (incoming.timestamp) target.timestamp = incoming.timestamp;
  if (typeof incoming.description === "string") target.description = incoming.description;
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

  const board=await ensureBoard();
  let created=0, updated=0, skipped=0;
  const alertedGroups = new Set();

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
        applyIncomingFieldsToCard(existing, m);
        updated++;
      }else{
        const duplicateByCoords = findCardByCoordinates(board, m.latitude, m.longitude, ["neu", "in-bearbeitung"]);
        if (duplicateByCoords) {
          applyIncomingFieldsToCard(duplicateByCoords, m);
          updated++;
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
          description: m.description || ""
        };
        board.columns["neu"].items.unshift(card);
        created++;
        const logUser = AUTO_IMPORT_USER;
        const logRow = buildEinsatzLog({
          action: "Einsatz erstellt (Auto-Import)",
          card,
          from: "Neu",
          note: card.ort || "",
          board,
          user: logUser
        });
        if (!logRow.Benutzer) logRow.Benutzer = logUser;
        await appendCsvRow(
          LOG_FILE,
          EINSATZ_HEADERS,
          logRow,
          null,
          { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
        );
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
}

let autoTimer=null;
function clearAutoTimer(){ if(autoTimer){ clearInterval(autoTimer); autoTimer=null; } }
async function startAutoTimer(){
  clearAutoTimer();
  const cfg=await readAutoCfg();
  if(!cfg.enabled) return;
  autoNextAt = Date.now() + (cfg.intervalSec||30)*1000;
  autoTimer=setInterval(async ()=>{
    try{
      const r=await importFromFileOnce(cfg.filename);
      autoNextAt = Date.now() + (cfg.intervalSec||30)*1000;
      if(!r.ok){
        console.warn("[auto-import] Fehler:", r.error);
        await appendError("auto-import", new Error(r.error));
      }
    }catch(e){
      console.warn("[auto-import] Exception:", e?.message||e);
      await appendError("auto-import/exception", e);
    }
  }, (cfg.intervalSec||30)*1000);
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
          const pollMs = (next.intervalSec||30)*1000;
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

app.get("/api/protocol/auto-print-config", async (req, res) => {
  const role = typeof req?.user?.role === "string" ? req.user.role.trim() : "";
  if (role !== "Admin") {
    return res.status(403).json({ ok:false, error:"FORBIDDEN" });
  }
  const cfg = await readAutoPrintCfg();
  res.json(cfg);
});

app.post("/api/protocol/auto-print-config", async (req, res) => {
  const role = typeof req?.user?.role === "string" ? req.user.role.trim() : "";
  if (role !== "Admin") {
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

    const shouldEnsureFetcherLogin =
      !cfg.demoMode && (
        // Auto-Import deaktiviert → Fetcher läuft nicht dauerhaft, also vor dem Import neu anmelden
        !cfg.enabled || (!status.running && !status.starting && !status.stopping)
      );

    if (shouldEnsureFetcherLogin) {
      const creds = await User_getGlobalFetcher();
      if (!creds?.creds?.username || !creds?.creds?.password) {
        return res.status(400).json({ ok:false, error:"Keine globalen Fetcher-Zugangsdaten hinterlegt" });
      }

      try {
        const pollMs = (cfg.intervalSec || 30) * 1000;
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
  const user = req.user ? { id:req.user.id, username:req.user.username, role:req.user.role } : null;
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

    const it = await User_getGlobalFetcher();
    if (!it?.creds?.username || !it?.creds?.password) {
      return res.status(400).json({ ok:false, error:"Keine globalen Fetcher-Zugangsdaten hinterlegt" });
    }

    const st = await ffStart({
      username: it.creds.username,
      password: it.creds.password,
      pollIntervalMs: (cfg.intervalSec||30)*1000
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
});

// Routen aus Aufgaben-Board
app.use("/api/aufgaben", User_requireAuth, aufgabenRoutes);

 // Admin-Maintenance: DATA_DIR an Routes durchreichen (synchron zu server.js)
 process.env.DATA_DIR = DATA_DIR;
import createAdminMaintenanceRoutes from "./routes/userAdminMaintenanceRoutes.js";
app.use("/api/user/admin", createAdminMaintenanceRoutes({ baseDir: DATA_DIR }));
