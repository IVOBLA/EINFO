// server/routes/aufgabenRoutes.js
import express from "express";
import fsp from "fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const router = express.Router();

// ========== Pfade / Dateien ==========
const AUFG_PREFIX = "Aufg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data"); // => <repo>/server/data
const AUFG_LOG_FILE = path.join(DATA_DIR, `${AUFG_PREFIX}_log.csv`);

function boardPath(roleId) {
  const r = String(roleId || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!r) throw new Error("roleId missing");
  return path.join(DATA_DIR, `${AUFG_PREFIX}_board_${r}.json`);
}

// ========== Helpers ==========
const STATUSES = ["Neu", "In Bearbeitung", "Erledigt"];
const ts2 = () => new Date().toISOString().replace("T", " ").slice(0, 19);

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
  await fsp.rename(tmp, file);
}

function normalizeItem(x) {
  const responsible = x.responsible ?? x.verantwortlich ?? x.address ?? "";
  const desc = x.desc ?? x.notes ?? x.beschreibung ?? "";
  const st = String(x.status || "").toLowerCase();
  const status = STATUSES.includes(x.status)
    ? x.status
    : st.startsWith("in") ? "In Bearbeitung" : st.startsWith("erled") ? "Erledigt" : "Neu";

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
  };
}

// CSV Log
function csv(v){ if(v==null) return '""'; const s=String(v).replace(/[\r\n]+/g," ").replace(/"/g,'""'); return `"${s}"`; }
async function ensureLogHeader(){
  try{ await fsp.access(AUFG_LOG_FILE); }
  catch{ await fsp.writeFile(AUFG_LOG_FILE,"timestamp;role;action;id;title;type;responsible;fromStatus;toStatus;beforeId\n","utf8"); }
}
async function appendLog(rec){
  await ensureDir(); await ensureLogHeader();
  const line=[ts2(),rec.role||"",rec.action||"",rec.id||"",rec.title||"",rec.type||"",rec.responsible||"",rec.fromStatus||"",rec.toStatus||"",rec.beforeId||""].map(csv).join(";")+"\n";
  await fsp.appendFile(AUFG_LOG_FILE,line,"utf8");
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
// ========== API ==========
router.get("/", async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
  try { const board=await loadAufgBoard(role); res.json({items:(board.items||[]).map(normalizeItem)}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// EINZIGER Create-Endpoint (idempotent via clientId)
router.post("/", express.json(), async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
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
    await saveAufgBoard(role,board);
    await appendLog({role,action:"create",id:item.id,title:item.title,type:item.type,responsible:item.responsible,toStatus:item.status});
    res.json({ok:true,item});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Statuswechsel
router.post("/:id/status", express.json(), async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
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
    await appendLog({role,action:"status",id:next.id,title:next.title,type:next.type,responsible:next.responsible,fromStatus:prev.status,toStatus:status});
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// DnD Reorder (Status + Position)
router.post("/reorder", express.json(), async (req,res)=>{
  const role=targetRoleOrSend(req,res); if(!role) return;
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
    await appendLog({role,action:"reorder",id:moved.id,title:moved.title,type:moved.type,responsible:moved.responsible,fromStatus:prev.status,toStatus:toStatus,beforeId});
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Log
router.get("/log.csv", async (_req,res)=>{
  try{ await ensureLogHeader(); res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",`attachment; filename="${AUFG_PREFIX}_log.csv"`); res.end(await fsp.readFile(AUFG_LOG_FILE)); }
  catch(e){ res.status(500).json({error:e.message}); }
});
router.post("/log/reset", async (_req,res)=>{
  try{
    await ensureLogHeader();
    const arch=`${AUFG_PREFIX}_log_arch_${Date.now()}.csv`;
    try{ await fsp.rename(AUFG_LOG_FILE, path.join(DATA_DIR,arch)); }catch{}
    await ensureLogHeader();
    res.json({ok:true, archived:arch});
  }catch(e){ res.status(500).json({error:e.message}); }
});

export default router;
