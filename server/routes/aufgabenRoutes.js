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
const ROLES_FILE = path.join(DATA_DIR, "user", "User_roles.json");

const AUFG_HEADERS = [
  "timestamp", "role", "user", "action", "id", "title", "type", "responsible", "fromStatus", "toStatus", "beforeId"
];

// Helper-Funktionen für Log und Board speichern, siehe vorherige vollständige Implementierung

// --- normierte Aufgabe ---
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
    meta: (x.meta ?? {}),
  };
}

// ========== API-Endpunkte ==========
const STATUSES = ["Neu", "In Bearbeitung", "Erledigt"];

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

// --- Logheader sicherstellen ---
async function ensureAufgLogHeader(file) {
  try { await fsp.access(file); }
  catch {
    await ensureDir(); // <-- Ordner <repo>/server/data sicher anlegen
    await fsp.writeFile(file, AUFG_HEADERS.join(";") + "\n", "utf8");
  }
}

// --- Sicherstellen des Verzeichnisses ---
async function ensureDir() { await fsp.mkdir(DATA_DIR, { recursive: true }); }

// --- Board laden ---
async function loadAufgBoard(roleId) {
  await ensureDir();
  const file = boardPath(roleId);
  try {
    const buf = await fsp.readFile(file, "utf8");
    const json = JSON.parse(buf);
    return { items: Array.isArray(json?.items) ? json.items : [] };
  } catch {
    return { items: [] };
  }
}

// --- Board speichern ---
async function saveAufgBoard(roleId, board) {
  await ensureDir();
  const file = boardPath(roleId);
  const tmp = file + ".tmp-" + Date.now();
  await fsp.writeFile(tmp, JSON.stringify(board, null, 2), "utf8");
  try {
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.writeFile(file, await fsp.readFile(tmp, "utf8"), "utf8");
    try { await fsp.unlink(tmp); } catch {}
  }
}

// --- Rollen-Ermittlung (keine eigenen Routen pro Rolle) ---
const BAD = new Set(["", "NULL", "UNDEFINED", "NONE", "N/A"]);
const normRole = (s) => {
  const v = String(s ?? "").trim().toUpperCase();
  const clean = v.replace(/[^A-Z0-9_-]/g, "");
  return BAD.has(clean) ? "" : clean;
};

// --- Rollen aus den Headern oder aus der Anfrage ermitteln ---
function userRoleFromReq(req) {
  const u = req.user || {};
  const fromUser =
    (typeof u.role === "string" && normRole(u.role)) ||
    (u.role && typeof u.role.id === "string" && normRole(u.role.id)) || "";
  return fromUser || headerRole(req);   // <= Header-Fallback
}

function headerRole(req) {
  return (
    normRole(req.get("X-Role-Id")) ||
    normRole(req.get("X-User-Role")) ||
    normRole(req.get("X-Auth-Role"))
  );
}

// --- Rollen-basierte Zugriffsprüfung ---
function targetRoleOrSend(req, res) {
  const userRole = userRoleFromReq(req);
  const qRole = normRole(req.query.role ?? req.body?.role);
  const target = qRole || userRole;     // <= wenn Query „null/leer“, nimm userRole

  if (!userRole) return res.status(401).json({ error: "unauthorized (no role)" });
  if (!target) return res.status(400).json({ error: "role missing" });
  if (target !== userRole) return res.status(403).json({ error: "forbidden (role mismatch)" });

  return target;
}

// ========== Rechteprüfung (aufgabenboard: edit) ==========
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

// ========== API-Endpunkte ==========
router.get("/", async (req,res)=>{
  const role = targetRoleOrSend(req,res); if(!role) return;
  try { 
    const board = await loadAufgBoard(role); 
    res.json({ items: (board.items || []).map(normalizeItem) });
  } catch (e) { 
    res.status(500).json({ error: e.message });
  }
});

router.post("/", express.json(), async (req,res)=>{
  const role = targetRoleOrSend(req,res); if(!role) return;
  if (!(await requireAufgabenEdit(req,res))) return;
  try {
    const board = await loadAufgBoard(role);
    const clientId = String(req.body?.clientId || req.body?.idempotencyKey || "").trim().slice(0,80) || null;

    if (clientId) {
      const ex = (board.items || []).find(x => x?.clientId === clientId);
      if (ex) return res.json({ ok: true, item: ex, dedup: true });
    }

    const item = normalizeItem({ ...req.body, clientId });

    // Deduplikation
    const now = Date.now();
    const dup = (board.items || []).find(x =>
      (x.title || "") === (item.title || "") && 
      (x.desc || "") === (item.desc || "") && 
      (x.type || "") === (item.type || "") &&
      Math.abs((x.createdAt || 0) - (item.createdAt || now)) < 3000
    );
    if (dup) return res.json({ ok: true, item: dup, dedup: true });

    board.items = [item, ...(board.items || [])];
    await saveAufgBoard(role, board);

    const LOG_FILE = logPath(role);
    await ensureAufgLogHeader(LOG_FILE);
    await appendCsvRow(LOG_FILE, AUFG_HEADERS, buildAufgabenLog({ role, action: "create", item, toStatus: item.status }), req);
    res.json({ ok: true, item });
  } catch (e) { 
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/status", express.json(), async (req,res)=>{
  const role = targetRoleOrSend(req,res); if(!role) return;
  if (!(await requireAufgabenEdit(req,res))) return;
  const { id } = req.params;
  const raw = req.body?.status ?? req.body?.toStatus ?? req.body?.columnId ?? req.body?.to;
  if (!id || !raw) return res.status(400).json({ error: "id oder status fehlt" });
  try {
    const board = await loadAufgBoard(role);
    const idx = (board.items || []).findIndex(x => (x.id || x._id || x.key) === id);
    if (idx < 0) return res.status(404).json({ error: "nicht gefunden" });

    const prev = normalizeItem(board.items[idx]);
    const st = String(raw).toLowerCase();
    const status = STATUSES.includes(raw) ? raw : st.startsWith("in") ? "In Bearbeitung" : st.startsWith("erled") ? "Erledigt" : "Neu";
    const next = { ...prev, status, updatedAt: Date.now() };
    board.items[idx] = next;
    await saveAufgBoard(role, board);

    const LOG_FILE = logPath(role);
    await ensureAufgLogHeader(LOG_FILE);
    await appendCsvRow(LOG_FILE, AUFG_HEADERS, buildAufgabenLog({ role, action: "status", item: next, fromStatus: prev.status, toStatus: status }), req);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/reorder", express.json(), async (req,res)=>{
  const role = targetRoleOrSend(req,res); if(!role) return;
  if (!(await requireAufgabenEdit(req,res))) return;
  const id = req.body?.id ?? req.body?.itemId ?? req.body?.cardId;
  const raw = req.body?.toStatus ?? req.body?.status ?? req.body?.to ?? req.body?.columnId;
  const beforeId = req.body?.beforeId ?? req.body?.previousId ?? null;
  if (!id || !raw) return res.status(400).json({ error: "id oder toStatus fehlt" });
  const st = String(raw).toLowerCase();
  const toStatus = STATUSES.includes(raw) ? raw : st.startsWith("in") ? "In Bearbeitung" : st.startsWith("erled") ? "Erledigt" : "Neu";

  try {
    const board = await loadAufgBoard(role);
    const items = Array.isArray(board.items) ? board.items : [];
    const idx = items.findIndex(x => (x?.id ?? x?._id ?? x?.key) === id);
    if (idx < 0) return res.status(404).json({ error: "Item nicht gefunden" });

    const prev = normalizeItem(items[idx]);
    const without = items.filter(x => (x?.id ?? x?._id ?? x?.key) !== id);
    const moved = { ...prev, status: toStatus, updatedAt: Date.now() };

    const pick = s => without.filter(x => (x?.status ?? "Neu") === s);
    const tgt = pick(toStatus).slice();
    if (beforeId) {
      const pos = tgt.findIndex(x => (x?.id ?? x?._id ?? x?.key) === beforeId);
      if (pos >= 0) tgt.splice(pos, 0, moved); else tgt.push(moved);
    } else tgt.push(moved);

    const assemble = s => s === toStatus ? tgt : pick(s);
    board.items = [...assemble("Neu"), ...assemble("In Bearbeitung"), ...assemble("Erledigt"),
      ...without.filter(x => !STATUSES.includes(x?.status ?? "Neu"))];

    await saveAufgBoard(role, board);

    const LOG_FILE = logPath(role);
    await ensureAufgLogHeader(LOG_FILE);
    await appendCsvRow(LOG_FILE, AUFG_HEADERS, buildAufgabenLog({ role, action: "reorder", item: moved, fromStatus: prev.status, toStatus, beforeId }), req);

    res.json({ ok : true });
} catch (e) {
res.status(500).json({ error: e.message });
}
});

export default router;
