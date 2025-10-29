import "./utils/loadEnv.mjs";
import express from "express";
import compression from "compression";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import protocolRouter from "./routes/protocol.js";
import attachPrintRoutes from "./printRoutes.js";
import aufgabenRoutes from "./routes/aufgabenRoutes.js";
import userRolesRouter from "./routes/userRoles.js";
import { appendCsvRow } from "./auditLog.mjs";

// 🔐 Neues User-Management
import { User_authMiddleware, User_createRouter, User_requireAuth } from "./User_auth.mjs";
import { User_update, User_getGlobalFetcher, User_hasGlobalFetcher } from "./User_store.mjs";

// Fetcher Runner
import { ffStart, ffStop, ffStatus, ffRunOnce } from "./ffRunner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 4040;

const ROOT      = path.join(__dirname);
const DATA_DIR  = path.join(ROOT, "data");
const DIST_DIR  = path.join(ROOT, "dist");
const VEH_OVERRIDES = path.join(DATA_DIR, "vehicles-overrides.json");

const BOARD_FILE  = path.join(DATA_DIR, "board.json");
const VEH_BASE    = path.join(DATA_DIR, "conf","vehicles.json");
const VEH_EXTRA   = path.join(DATA_DIR, "vehicles-extra.json");
const GPS_FILE    = path.join(DATA_DIR, "vehicles_gps.json");
const TYPES_FILE  = path.join(DATA_DIR, "conf","types.json");
const LOG_FILE    = path.join(DATA_DIR, "Lage_log.csv");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const ERROR_LOG   = path.join(DATA_DIR, "Log.txt");
const GROUPS_FILE = path.join(DATA_DIR, "conf","group_locations.json");

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
const AUTO_DEFAULT          = { enabled:false, intervalSec:30, filename:AUTO_DEFAULT_FILENAME };

// Merker für Import-Status
let importLastLoadedAt = null;   // ms
let importLastFile     = null;   // string
let autoNextAt         = null;   // ms – nächster geplanter Auto-Import

// ----------------- Helpers -----------------
async function ensureDir(p){ await fs.mkdir(p,{ recursive:true }); }
attachPrintRoutes(app, "/api/protocol");

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

function buildEinsatzLog({ action, card = {}, from = "", to = "", einheit = "", note = "", board = null }) {
  return {
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
const AUTO_STOP_MIN = Number(process.env.FF_AUTO_STOP_MIN || 60); // Minuten (Default 60)
setInterval(async () => {
  try{
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
async function writeOverrides(next){ await writeJson(VEH_OVERRIDES, next); }

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

function detectCloneMeta(entry, labelIndex) {
  if (!entry) return { isClone: false, baseId: null };
  const cloneOfRaw = typeof entry.cloneOf === "string" ? entry.cloneOf.trim() : "";
  if (cloneOfRaw) return { isClone: true, baseId: cloneOfRaw };

  const label = String(entry.label || "");
  const match = label.match(CLONE_SUFFIX_RE);
  if (!match) return { isClone: false, baseId: null };
  const baseLabel = match[1].trim();
  if (!baseLabel) return { isClone: false, baseId: null };

  const candidates = labelIndex.get(normalizeLabel(baseLabel)) || [];
  const baseCandidate = candidates.find((veh) => veh.id !== entry.id);
  if (baseCandidate?.id) return { isClone: true, baseId: String(baseCandidate.id) };
  if (baseCandidate) return { isClone: true, baseId: baseLabel };

  const crew = Number(entry.mannschaft);
  if (Number.isFinite(crew) && crew === 0) return { isClone: true, baseId: baseLabel };
  return { isClone: false, baseId: null };
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
    const payload = { ...entry, isClone: true };
    if (cloneOf) payload.cloneOf = cloneOf;
    return payload;
  });
}

async function getVehiclesData() {
  const base = await readJson(VEH_BASE, []);
  const extraRaw = await readExtraVehiclesRaw();
  const labelIndex = buildVehicleLabelIndex(base, extraRaw);
  const extra = applyCloneMetadata(extraRaw, labelIndex);
  return { base, extra, extraRaw, labelIndex };
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
    const vid = String(entry?.id || "");
    if (!normalized.has(vid)) {
      next.push(entry);
      continue;
    }
    const meta = detectCloneMeta(entry, labelIndex);
    if (!meta.isClone) {
      next.push(entry);
      continue;
    }
    if (board && boardHasVehicle(board, vid)) {
      next.push(entry);
      continue;
    }
    changed = true;
  }
  if (changed) await writeJson(VEH_EXTRA, next);
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

app.use(User_authMiddleware());
app.use("/api/user", User_createRouter({
  dataDir: DATA_DIR,
  secureCookies: process.env.KANBAN_COOKIE_SECURE === "1"
}));

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
  if (!req.user) return res.status(401).json({ ok:false, error:"UNAUTHORIZED" });
  next();
});

// ===================================================================
// =                         BOARD & VEHICLES                        =
// ===================================================================
async function ensureBoard(){
  await ensureDir(DATA_DIR);
  const fallback={ columns:{
    "neu":{name:"Neu",items:[]},
    "in-bearbeitung":{name:"In Bearbeitung",items:[]},
    "erledigt":{name:"Erledigt",items:[]}
  }};
  const b = await readJson(BOARD_FILE, null);
  if(!b){ await writeJson(BOARD_FILE, fallback); return fallback; }

 let highestHumanId=0;
 const areaIds = new Set();
 const areaColorById = new Map();
  for(const k of Object.keys(b.columns||{})){
    for(const c of (b.columns[k].items||[])){
      const parsed=parseHumanIdNumber(c?.humanId);
      if(Number.isFinite(parsed)&&parsed>highestHumanId) highestHumanId=parsed;
    }
  }

  for(const k of Object.keys(b.columns||{})){
    for(const c of (b.columns[k].items||[])){
      c.createdAt        ||= new Date().toISOString();
      c.statusSince      ||= new Date().toISOString();
      c.assignedVehicles   ||= [];
      c.everVehicles       ||= [];
      if (!c.everVehicleLabels || typeof c.everVehicleLabels !== "object" || Array.isArray(c.everVehicleLabels)) {
        c.everVehicleLabels = {};
      }
      if(typeof c.everPersonnel!=="number") c.everPersonnel=0;
      if(!("externalId" in c)) c.externalId="";
      if(!("alerted"     in c)) c.alerted="";
      if(!("latitude"    in c)) c.latitude=null;
      if(!("longitude"   in c)) c.longitude=null;
      if(!("location"    in c)) c.location="";
      if(!("description" in c)) c.description="";
      if(!("timestamp"   in c)) c.timestamp=null;
	       if(!("isArea"      in c)) c.isArea=false;
      if(!("areaCardId"  in c)) c.areaCardId=null;
if(!("areaColor"   in c)) c.areaColor=null;
      if(c.isArea){
        c.areaCardId=null;
        c.areaColor = normalizeAreaColor(c.areaColor || DEFAULT_AREA_COLOR, DEFAULT_AREA_COLOR);
        if(c.id){
          const idStr = String(c.id);
          areaIds.add(idStr);
          areaColorById.set(idStr, c.areaColor);
        }
      }else if(!c.areaCardId){
        c.areaColor = null;
      }
      if(typeof c.humanId!=="string" || !c.humanId.trim()){
        const prefix = c.externalId
          ? HUMAN_ID_PREFIX_IMPORT
          : (c.isArea ? HUMAN_ID_PREFIX_AREA : HUMAN_ID_PREFIX_MANUAL);
        highestHumanId+=1;
        c.humanId=`${prefix}-${highestHumanId}`;
		} else if (c.isArea) {
        c.humanId = ensureAreaHumanIdValue(c.humanId, () => {
          highestHumanId += 1;
          return highestHumanId;
        });
      } else if (!c.externalId && /^B-/i.test(String(c.humanId))) {
        c.humanId = ensureManualHumanIdValue(c.humanId, () => {
          highestHumanId += 1;
          return highestHumanId;
        });
      }
    }
  }
  
  if(areaIds.size){
    for(const k of Object.keys(b.columns||{})){
      for(const c of (b.columns[k].items||[])){
        if(c.isArea) continue;
if(!c.areaCardId){ c.areaCardId=null; c.areaColor=null; continue; }
        const refId=String(c.areaCardId);
        if(!areaIds.has(refId)){ c.areaCardId=null; c.areaColor=null; }
        else c.areaColor = areaColorById.get(refId) || null;
      }
    }
  }else{
    for(const k of Object.keys(b.columns||{})){
      for(const c of (b.columns[k].items||[])){
        c.areaCardId=null;
		c.areaColor=null;
      }
    }
  }
  return b;
}
async function getAllVehicles(){
  const { base, extra } = await getVehiclesData();
  return [...base,...extra];
}
const vehiclesByIdMap = list => new Map(list.map(v=>[v.id,v]));
const computedPersonnel = (card,vmap)=>(card.assignedVehicles||[]).reduce((s,vid)=>s+(vmap.get(vid)?.mannschaft??0),0);
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

// --- API: Basics ---
app.get("/api/board",    async (_req,res)=>res.json(await ensureBoard()));
app.get("/api/vehicles", async (_req,res)=>res.json(await getAllVehiclesMerged()));

app.get("/api/gps", async (_req,res)=>{
  try{ const txt = await fs.readFile(GPS_FILE, "utf8"); res.type("json").send(txt); }
  catch{ res.json([]); }
});

app.get("/api/types", async (_req,res)=>{ try{ res.json(await readJson(TYPES_FILE,[])); }catch{ res.json([]); } });

app.post("/api/vehicles", async (req,res)=>{
  const { ort, label, mannschaft=0, cloneOf="" } = req.body||{};
  if(!ort||!label) return res.status(400).json({ error:"ort und label sind erforderlich" });

  const extra = await readExtraVehiclesRaw();
  const exists = extra.find(v => (v.ort||"")===ort && (v.label||"")===label);
  if(exists) return res.status(409).json({ error:"Einheit existiert bereits" });

  const id = `X${Math.random().toString(36).slice(2,8)}`;
  const cloneTag = typeof cloneOf === "string" ? cloneOf.trim() : "";
  const v  = { id, ort, label, mannschaft: Number(mannschaft)||0 };
  if (cloneTag) {
    v.cloneOf = cloneTag;
    v.isClone = true;
  }
  extra.push(v); await writeJson(VEH_EXTRA, extra);

  await appendCsvRow(
    LOG_FILE,
    EINSATZ_HEADERS,
    buildEinsatzLog({ action: "Einheit geteilt", note: `${label} (${ort})` }),
    req,
    { autoTimestampField: "Zeitpunkt", autoUserField: "Benutzer" }
  );
  res.json({ ok:true, vehicle:v });
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
    description: String(description || ""),
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
  await writeJson(BOARD_FILE, board);
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
      const label = veh?.label || veh?.id || vidStr;
      const ort = typeof veh?.ort === "string" ? veh.ort : null;
      snapshotLabels[vidStr] = { label, ort };
    }
    card.everVehicleLabels = snapshotLabels;
    card.everVehicles = dedupedEver;
    card.everPersonnel=Number.isFinite(card?.manualPersonnel)?card.manualPersonnel:computedPersonnel(card,vmap);
    // CSV: aktuell zugeordnete Einheiten als "entfernt" loggen
    for (const vid of removedIds) {
      const veh = vmap.get(vid);
      const einheitsLabel = veh?.label || veh?.id || String(vid);
      await appendCsvRow(
        LOG_FILE, EINSATZ_HEADERS,
        buildEinsatzLog({ action:"Einheit entfernt", card, einheit: einheitsLabel, board }),
        req, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
      );
    }
    card.assignedVehicles=[];
    clonesToRemove = new Set(removedIds);
  }
  dst.splice(Math.max(0,Math.min(Number(toIndex)||0,dst.length)),0,card);
  await writeJson(BOARD_FILE,board);

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
  const snapshotLabel = veh?.label || veh?.id || vehicleIdStr;
  const snapshotOrt = typeof veh?.ort === "string" ? veh.ort : null;
  labelStore[vehicleIdStr] = { label: snapshotLabel, ort: snapshotOrt };
  ref.card.everVehicleLabels = labelStore;

const einheitsLabel = veh?.label || veh?.id || String(vehicleId);
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
  await writeJson(BOARD_FILE,board);
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
  await writeJson(BOARD_FILE,board);

  const vmap=vehiclesByIdMap(await getAllVehicles());
  const veh = vmap.get(vehicleId);
  const einheitsLabel = veh?.label || veh?.id || String(vehicleId);
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
    await writeJson(BOARD_FILE,board);
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
  await writeJson(BOARD_FILE,board);
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

  await writeJson(BOARD_FILE, board);

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
  await writeJson(BOARD_FILE,fresh);
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
  return cfg;
}
async function writeAutoCfg(next){
  const keep=await readAutoCfg();
  const merged={ ...keep, ...next, filename:AUTO_DEFAULT_FILENAME };
  await writeJson(AUTO_CFG_FILE,merged);
  return merged;
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

  try{
    for(const item of arr){
      const m=mapIncomingItemToCardFields(item);
      if(!m.externalId){ skipped++; continue; }
      const existing=findCardByExternalId(board,m.externalId);
      if(existing){
        existing.content = m.content || existing.content;
        if(m.ort)        existing.ort = m.ort;
        if(m.typ)        existing.typ = m.typ;
        if(m.alerted)    existing.alerted = m.alerted;
        if(m.latitude!==null)  existing.latitude  = m.latitude;
        if(m.longitude!==null) existing.longitude = m.longitude;
        if(typeof m.location === "string" && m.location) existing.location = m.location;
        if(m.timestamp)  existing.timestamp = m.timestamp;
        if(typeof m.description === "string") existing.description = m.description;
        updated++;
      }else{
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
  await appendCsvRow(
          LOG_FILE, EINSATZ_HEADERS,
          buildEinsatzLog({ action:"Einsatz erstellt (Auto-Import)", card, from:"Neu", note:card.ort || "", board }),
          null, { autoTimestampField:"Zeitpunkt", autoUserField:"Benutzer" }
        );
      }
    }

    await writeJson(BOARD_FILE,board);
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
  const { enabled, intervalSec }=req.body||{};
  const next=await writeAutoCfg({ enabled:!!enabled, intervalSec:Number.isFinite(+intervalSec)&&+intervalSec>0 ? +intervalSec : undefined });
if(next.enabled){
  await startAutoTimer();
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
}else{
    clearAutoTimer(); autoNextAt=null;
    try{ await ffStop(); }catch{}
  }
  res.json(next);
});

async function triggerOnce(_req,res){
  try{
    const cfg = await readAutoCfg();
    const status = ffStatus();

    if (!status.running && !status.starting && !status.stopping) {
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
    if(ids.length){ doc.moveDown(0.1); doc.text(`Einheiten: ${ids.join(", ")}`,{width:w}); }
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
});

// Routen aus Aufgaben-Board
app.use("/api/aufgaben", User_requireAuth, aufgabenRoutes);

 // Admin-Maintenance: DATA_DIR an Routes durchreichen (synchron zu server.js)
 process.env.DATA_DIR = DATA_DIR;
import createAdminMaintenanceRoutes from "./routes/userAdminMaintenanceRoutes.js";
app.use("/api/user/admin", createAdminMaintenanceRoutes({ baseDir: DATA_DIR }));
