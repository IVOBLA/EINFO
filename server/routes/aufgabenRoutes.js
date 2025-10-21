// server/routes/aufgabenRoutes.js
import express from "express";
import fsp from "fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendCsvRow } from "../auditLog.mjs";

const router = express.Router();

// ========== Pfade / Dateien ==========
const AUFG_PREFIX = "Aufg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");   // => <repo>/server/data
const ROLES_FILE    = path.join(DATA_DIR, "user","User_roles.json");


const AUFG_HEADERS = [
  "timestamp","role","user","action","id","title","type","responsible",
  "fromStatus","toStatus","beforeId",
  "originProtocolNr","originType","relatedIncidentId","protoNr"
 ];

async function ensureAufgLogHeader(file) { 
  try { await fsp.access(file); }
  catch {
    await ensureDir(); // <-- Ordner <repo>/server/data sicher anlegen
    await fsp.writeFile(file, AUFG_HEADERS.join(";") + "\n", "utf8");
  }
}

function logPath(roleId) {
   const r = String(roleId || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
   if (!r) throw new Error("roleId missing");
   return path.join(DATA_DIR, `${AUFG_PREFIX}_log_${r}.csv`);
 }

function boardPath(roleId) {
  const r = String(roleId || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!r) throw new Error("roleId missing");
  return path.join(DATA_DIR, `${AUFG_PREFIX}_board_${r}.json`);
}



// ========== Helpers ==========
const STATUSES = ["Neu", "In Bearbeitung", "Erledigt"];


function buildAufgabenLog({ role, action, item = {}, fromStatus = "", toStatus = "", beforeId = "" }) {
  return {
    role,
    action,
    id: item.id || "",
    title: item.title || "",
    type: item.type || "",
    responsible: item.responsible || "",
    fromStatus, toStatus, beforeId,
	    originProtocolNr: item.originProtocolNr || item.protoNr || item.meta?.protoNr || "",
    originType:       item.originType       || item.meta?.source || "",
    relatedIncidentId: item.relatedIncidentId || item.meta?.relatedIncidentId || "",
    protoNr:          item.protoNr || item.originProtocolNr || item.meta?.protoNr || ""
  };
}


async function ensureDir() { await fsp.mkdir(DATA_DIR, { recursive: true }); }

async function loadAufgBoard(roleId) {
  await ensureDir();
  const file = boardPath(roleId);
  try {
    const buf = await fsp.readFile(file, "utf8");
    const json = JSON.parse(buf);
    return { items: Array.isArray(json?.items) ? json.items : (Array.isArray(json) ? json : []) };
  } catch {
    return { items: [] };
  }
}
async function saveAufgBoard(roleId, board) {
  await ensureDir();
  const file = boardPath(roleId);
  const tmp = file + ".tmp-" + Date.now();
  await fsp.writeFile(tmp, JSON.stringify(board, null, 2), "utf8");
  try {
    await fsp.rename(tmp, file);
 } catch (e) {
    // Windows/AV-Scanner lockt Zieldatei → Fallback: direkt schreiben
    await fsp.writeFile(file, await fsp.readFile(tmp, "utf8"), "utf8");
    try { await fsp.unlink(tmp); } catch {}
  }
 }


function normalizeItem(x) {
  const responsible = x.responsible ?? x.verantwortlich ?? x.address ?? "";
  const desc = x.desc ?? x.notes ?? x.beschreibung ?? "";
  const st = String(x.status || "").toLowerCase();
  const status = STATUSES.includes(x.status)
    ? x.status
    : st.startsWith("in") ? "In Bearbeitung" : st.startsWith("erled") ? "Erledigt" : "Neu";
  // Herkunft / Bezug einsammeln
  const originProtocolNr  = x.originProtocolNr ?? x.originNr ?? x.protoNr ?? x.meta?.protoNr ?? null;
  const originType        = x.originType ?? x.meta?.source ?? null;
  const relatedIncidentId = x.relatedIncidentId ?? x.meta?.relatedIncidentId ?? null;
  const metaIn = x.meta ?? {};
  const meta = { ...metaIn };
  if (originProtocolNr && !meta.protoNr)        meta.protoNr = originProtocolNr;
  if (originType && !meta.source)               meta.source = originType;
  if (relatedIncidentId && !meta.relatedIncidentId) meta.relatedIncidentId = relatedIncidentId;	

  return {
    id: x.id ?? x._id ?? x.key ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientId: x.clientId ?? x.idempotencyKey ?? null, // Idempotenz gegen Doppel-POST
    title: x.title ?? x.name ?? x.typ ?? "Aufgabe",
    type: x.type ?? x.category ?? x.typ ?? "",
    responsible,
    desc,
    status,
    createdAt: x.createdAt ?? x.ts ?? x.timestamp ?? Date.now(),
    updatedAt: x.updatedAt ?? Date.now(),
    kind: "task",

    // Herkunft / Bezug top-level + kompatible protoNr
    originProtocolNr: originProtocolNr ?? null,
    originType: originType ?? null,
    relatedIncidentId: relatedIncidentId ?? null,
    protoNr: originProtocolNr ?? x.protoNr ?? null,
    meta
  };
}


// Rollen-Ermittlung (keine eigenen Routen pro Rolle)
const BAD = new Set(["", "NULL", "UNDEFINED", "NONE", "N/A"]);
const normRole = (s) => {
  const v = String(s ?? "").trim().toUpperCase();
  const clean = v.replace(/[^A-Z0-9_-]/g, "");
  return BAD.has(clean) ? "" : clean;
};

function targetRoleOrSend(req, res) {
  const userRole = userRoleFromReq(req);
  const qRole = normRole(req.query.role ?? req.body?.role);
  const target = qRole || userRole;     // <= wenn Query „null/leer“, nimm userRole

  if (!userRole) return res.status(401).json({ error: "unauthorized (no role)" });
  if (!target)   return res.status(400).json({ error: "role missing" });
  if (target !== userRole) return res.status(403).json({ error: "forbidden (role mismatch)" });

  return target;
}
function headerRole(req) {
  return (
    normRole(req.get("X-Role-Id")) ||
    normRole(req.get("X-User-Role")) ||
    normRole(req.get("X-Auth-Role"))
  );
}

function userRoleFromReq(req) {
  const u = req.user || {};
  const fromUser =
    (typeof u.role === "string" && normRole(u.role)) ||
    (u.role && typeof u.role.id === "string" && normRole(u.role.id)) || "";
  return fromUser || headerRole(req);   // <= Header-Fallback
}


// ---------- Rechteprüfung (aufgabenboard: edit) ----------
async function loadRolesVAny() {
  try {
    const raw = JSON.parse(await fsp.readFile(ROLES_FILE, "utf8"));
    return Array.isArray(raw) ? raw : (Array.isArray(raw?.roles) ? raw.roles : []);
  } catch { return []; }
}
function capsToApps(caps = []) {
  const out = {};
  for (const c of caps) {
    const m = String(c).trim().match(/^([a-z0-9_-]+)[:.]([a-z]+)$/i);
    if (!m) continue;
    const app = m[1].toLowerCase();
    const lvl = m[2].toLowerCase();
    out[app] = (out[app] === "edit" || lvl === "edit") ? "edit" : lvl; // edit dominiert
  }
  return out;
}
function toRoleObj(r) {
  if (!r) return null;
  const id = (r.id || r.label || "").toString().toUpperCase();
  const apps = r.apps ? r.apps : capsToApps(r.capabilities || []);
  return { id, apps };
}
async function requireAufgabenEdit(req, res) {
  const roleId = userRoleFromReq(req)?.toUpperCase();
  if (!roleId) { res.status(401).json({ error: "unauthorized (no role)" }); return false; }
  try {
    const roles = (await loadRolesVAny()).map(toRoleObj).filter(Boolean);
    const r = roles.find(x => x.id === roleId);
    const lvl = (r?.apps?.aufgabenboard || r?.apps?.["aufgabenboard"]) || "none";
    if (String(lvl).toLowerCase() !== "edit") {
      res.status(403).json({ error: "forbidden (no edit permission for aufgabenboard)" });
      return false;
    }
    return true;
  } catch (e) {
    res.status(500).json({ error: "roles_read_failed", detail: String(e?.message || e) });
    return false;
  }
}

// ========== API ==========
router.get("/", async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
  try { const board=await loadAufgBoard(role); res.json({items:(board.items||[]).map(normalizeItem)}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// EINZIGER Create-Endpoint (idempotent via clientId)
router.post("/", express.json(), async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
  if (!(await requireAufgabenEdit(req,res))) return;
  try{
    const board=await loadAufgBoard(role);
    const clientId=String(req.body?.clientId || req.body?.idempotencyKey || "").trim().slice(0,80)||null;

    if(clientId){
      const ex=(board.items||[]).find(x=>x?.clientId===clientId);
      if(ex) return res.json({ok:true,item:ex,dedup:true});
    }

    const item=normalizeItem({...req.body, clientId});

    // weiche Duplikatsbremse: gleicher Titel/Desc/Type in <3s
    const now=Date.now();
    const dup=(board.items||[]).find(x=>
      (x.title||"")===(item.title||"") && (x.desc||"")===(item.desc||"") && (x.type||"")===(item.type||"") &&
      Math.abs((x.createdAt||0)-(item.createdAt||now))<3000
    );
    if(dup) return res.json({ok:true,item:dup,dedup:true});

    board.items=[item, ...(board.items||[])];
	await saveAufgBoard(role, board);
 const LOG_FILE = logPath(role);
 await ensureAufgLogHeader(LOG_FILE);
 await appendCsvRow(
   LOG_FILE,
   AUFG_HEADERS,
   buildAufgabenLog({ role, action:"create", item, toStatus: item.status }),
   req
 );
    res.json({ok:true,item});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Statuswechsel
router.post("/:id/status", express.json(), async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
  if (!(await requireAufgabenEdit(req,res))) return;
  const {id}=req.params;
  const raw=req.body?.status ?? req.body?.toStatus ?? req.body?.columnId ?? req.body?.to;
  if(!id || !raw) return res.status(400).json({error:"id oder status fehlt"});
  try{
    const board=await loadAufgBoard(role);
    const idx=(board.items||[]).findIndex(x=>(x.id||x._id||x.key)===id);
    if(idx<0) return res.status(404).json({error:"nicht gefunden"});
    const prev=normalizeItem(board.items[idx]);
    const st=String(raw).toLowerCase();
    const status=STATUSES.includes(raw) ? raw : st.startsWith("in")?"In Bearbeitung":st.startsWith("erled")?"Erledigt":"Neu";
    const next={...prev,status,updatedAt:Date.now()};
    board.items[idx]=next;
    await saveAufgBoard(role,board);
const LOG_FILE = logPath(role);
await ensureAufgLogHeader(LOG_FILE);
await appendCsvRow(
  LOG_FILE,
  AUFG_HEADERS,
  buildAufgabenLog({ role, action: "status", item: next, fromStatus: prev.status, toStatus: status }),
  req
);
    
    // Rückkanal ins Protokoll: robust (auch wenn meta fehlt)
    try {
      if (status === "Erledigt") {
        const protoNr =
          next?.meta?.protoNr ??
          prev?.meta?.protoNr ??  // Fallback: bisherige Karte hatte evtl. meta
          next?.protoNr ??        // historischer Alt-Fall
          prev?.protoNr ?? null;
        if (protoNr) {
          const { markResponsibleDone } = await import("./protocolMarkDone.mjs");
          await markResponsibleDone(protoNr, next.responsible);
        }
      }
    } catch {}

	res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// DnD Reorder (Status + Position)
router.post("/reorder", express.json(), async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
  if (!(await requireAufgabenEdit(req,res))) return;
  const id=req.body?.id ?? req.body?.itemId ?? req.body?.cardId;
  const raw=req.body?.toStatus ?? req.body?.status ?? req.body?.to ?? req.body?.columnId;
  const beforeId=req.body?.beforeId ?? req.body?.previousId ?? null;
  if(!id || !raw) return res.status(400).json({error:"id oder toStatus fehlt"});
  const st=String(raw).toLowerCase();
  const toStatus=STATUSES.includes(raw) ? raw : st.startsWith("in")?"In Bearbeitung":st.startsWith("erled")?"Erledigt":"Neu";

  try{
    const board=await loadAufgBoard(role);
    const items=Array.isArray(board.items)?board.items:[];
    const idx=items.findIndex(x=>(x?.id ?? x?._id ?? x?.key)===id);
    if(idx<0) return res.status(404).json({error:"Item nicht gefunden"});

    const prev=normalizeItem(items[idx]);
    const without=items.filter(x=>(x?.id ?? x?._id ?? x?.key)!==id);
    const moved={...prev,status:toStatus,updatedAt:Date.now()};

    const pick = s => without.filter(x => (x?.status ?? "Neu") === s);
    const tgt  = pick(toStatus).slice();
    if(beforeId){
      const pos=tgt.findIndex(x=>(x?.id ?? x?._id ?? x?.key)===beforeId);
      if(pos>=0) tgt.splice(pos,0,moved); else tgt.push(moved);
    } else tgt.push(moved);

    const assemble = s => s===toStatus ? tgt : pick(s);
    board.items=[...assemble("Neu"), ...assemble("In Bearbeitung"), ...assemble("Erledigt"),
      ...without.filter(x=>!STATUSES.includes(x?.status ?? "Neu"))];

    await saveAufgBoard(role,board);
 const LOG_FILE = logPath(role);
 await ensureAufgLogHeader(LOG_FILE);
 await appendCsvRow(
   LOG_FILE,
   AUFG_HEADERS,
   buildAufgabenLog({ role, action: "reorder", item: moved, fromStatus: prev.status, toStatus, beforeId }),
   req
 );
    // Rückkanal ins Protokoll auch bei DnD in "Erledigt"
    try {
      if (toStatus === "Erledigt") {
        const protoNr =
         moved?.meta?.protoNr ??
          prev?.meta?.protoNr ??
          moved?.protoNr ?? prev?.protoNr ?? null;
        if (protoNr) {
          const { markResponsibleDone } = await import("./protocolMarkDone.mjs");
          await markResponsibleDone(protoNr, moved.responsible);
        }
      }
    } catch {}
  

  res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Log
 router.get("/log.csv", async (req,res)=>{
   const role = targetRoleOrSend(req,res); if(!role) return;
   const LOG_FILE = logPath(role);
   try {
     await ensureAufgLogHeader(LOG_FILE);
     res.setHeader("Content-Type","text/csv; charset=utf-8");
     res.setHeader("Content-Disposition", `attachment; filename="${AUFG_PREFIX}_log_${role}.csv"`);
     const buf = await fsp.readFile(LOG_FILE);
     res.end(buf);
   } catch(e){ res.status(500).json({error:e.message}); }
 });
 router.post("/log/reset", async (req,res)=>{
   const role = targetRoleOrSend(req,res); if(!role) return;
   const LOG_FILE = logPath(role);
   try {
     await ensureAufgLogHeader(LOG_FILE);
     const arch = `${AUFG_PREFIX}_log_${role}_arch_${Date.now()}.csv`;
     try { await fsp.rename(LOG_FILE, path.join(DATA_DIR, arch)); } catch {}
     await ensureAufgLogHeader(LOG_FILE);
     res.json({ ok:true, archived:arch });
   } catch(e){ res.status(500).json({ error:e.message }); }
 });


// Felder-Edit (Titel/Typ/Verantwortlich/Notiz) mit Log "update"
router.post("/:id/edit", express.json(), async (req,res)=>{
  const role = targetRoleOrSend(req,res); if(!role) return;
  if (!(await requireAufgabenEdit(req,res))) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "id fehlt" });
  try {
    const board = await loadAufgBoard(role);
    const items = Array.isArray(board.items) ? board.items : [];
    const idx = items.findIndex(x => (x?.id ?? x?._id ?? x?.key) === id);
    if (idx < 0) return res.status(404).json({ error: "nicht gefunden" });

    const prev = normalizeItem(items[idx]);
    const patch = req.body || {};
    const next = {
      ...prev,
      title:       patch.title       ?? prev.title,
      type:        patch.type        ?? prev.type,
      responsible: patch.responsible ?? prev.responsible,
      desc:        patch.desc        ?? prev.desc,
	  relatedIncidentId: patch.relatedIncidentId ?? prev.relatedIncidentId,
      updatedAt:   Date.now(),
    };
	    // Meta synchron halten (Bezug)
    next.meta = { ...(prev.meta || {}) };
    if (next.relatedIncidentId) next.meta.relatedIncidentId = next.relatedIncidentId;
    else if (next.meta?.relatedIncidentId) delete next.meta.relatedIncidentId;
    items[idx] = next;
    board.items = items;
    await saveAufgBoard(role, board);
const LOG_FILE = logPath(role);
await ensureAufgLogHeader(LOG_FILE);
await appendCsvRow(
  LOG_FILE,
  AUFG_HEADERS,
  buildAufgabenLog({ role, action: "update", item: next, fromStatus: prev.status, toStatus: next.status }),
  req
);
    res.json({ ok:true, item: next });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
