// server/utils/tasksService.mjs
import fsp from "fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultDueOffsetMinutes } from "./defaultDueOffset.mjs";



const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.resolve(__dirname, "..", "data"); // => <repo>/server/data
const AUFG_PREFIX = "Aufg";
const DEFAULT_DUE_OFFSET_MINUTES = getDefaultDueOffsetMinutes();

function normalizeBoardId(roleId){
  const raw = String(roleId ?? "").trim().toUpperCase();
  const norm = raw.replace(/[^A-Z0-9_-]/g, "");
  if (!norm) throw new Error("roleId missing");
  return norm;
}

function canonicalRoleKey(value){
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/\b(S[1-6]|EL|LTSTB)\b/i);
  if (match) return match[1].toUpperCase();
  return raw.replace(/\s+/g, "").toUpperCase();
}

function boardPath(roleId){
  return path.join(DATA_DIR, `${AUFG_PREFIX}_board_${normalizeBoardId(roleId)}.json`);
}
function logPath(roleId){
  return path.join(DATA_DIR, `${AUFG_PREFIX}_log_${normalizeBoardId(roleId)}.csv`);
}
async function ensureDir(){ await fsp.mkdir(DATA_DIR,{recursive:true}); }
function csv(v){ if(v==null) return '""'; const s=String(v).replace(/[\r\n]+/g," ").replace(/"/g,'""'); return `"${s}"`; }
async function ensureLogHeader(file){
  try{ await fsp.access(file); }
  catch{ await fsp.writeFile(file, "timestamp;actor;action;id;title;type;responsible;fromStatus;toStatus;beforeId;meta\n","utf8"); }
}
async function appendLog(roleId, rec){
  await ensureDir();
  const file = logPath(roleId);
  await ensureLogHeader(file);
  const now = new Date().toISOString().replace("T"," ").slice(0,19);
  const line = [
    now, rec.actor||"", rec.action||"", rec.id||"", rec.title||"", rec.type||"",
    rec.responsible||"", rec.fromStatus||"", rec.toStatus||"", rec.beforeId||"", JSON.stringify(rec.meta||{})
  ].map(csv).join(";")+"\n";
  await fsp.appendFile(file, line, "utf8");
}
export async function loadBoard(roleId){
  await ensureDir();
  try{ return JSON.parse(await fsp.readFile(boardPath(roleId),"utf8")); }catch{ return {items:[]}; }
}
export async function saveBoard(roleId, board){
  await ensureDir();
  const file = boardPath(roleId);
  const tmp  = `${file}.tmp-${Date.now()}`;
  const json = JSON.stringify(board,null,2);
  await fsp.writeFile(tmp,json,"utf8");
  try{ await fsp.rename(tmp,file); }catch{ await fsp.writeFile(file,json,"utf8"); try{ await fsp.unlink(tmp);}catch{} }
}

function normalizeDueAt(v){
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function ensureTaskForRole({roleId, protoNr, item, actor, responsibleLabel}){
  const responsible = String(responsibleLabel ?? roleId ?? "").trim();
  if (!responsible) return null;
  const boardId = normalizeBoardId(roleId ?? responsible);
  const roleKey = canonicalRoleKey(responsible);

  // idempotent: existiert bereits Karte mit derselben Protokoll-Nr + Rolle?
  const board = await loadBoard(boardId);
  const exists = (board.items || []).some((it) => {
    const sameProto = String(it?.meta?.protoNr || "") === String(protoNr || "");
    const sameRole = canonicalRoleKey(it?.responsible) === roleKey;
    return sameProto && sameRole;
  });
  if (exists) return null;

  const defaultDueAt = new Date(Date.now() + DEFAULT_DUE_OFFSET_MINUTES * 60 * 1000);
  const dueAt = normalizeDueAt(item?.dueAt) ?? defaultDueAt.toISOString();

  const creator = typeof actor === "string" ? actor.trim() : actor ? String(actor).trim() : "";

  const card = {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    title: item.title || "Aufgabe",
    type: item.type || "",
    responsible,
    desc: item.desc || "",
    status: "Neu",
    kind: "task",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueAt,
    originProtocolNr: protoNr ?? null,
    meta: { ...(item.meta||{}), protoNr },
    createdBy: creator || null
  };
  board.items = [card, ...(board.items||[])];
  await saveBoard(boardId, board);
  await appendLog(boardId, { actor: creator || actor || "", action:"create", id:card.id, title:card.title, type:card.type, responsible:card.responsible, toStatus:card.status, meta:card.meta });
  return card;
}
