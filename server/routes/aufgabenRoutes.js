import express from "express";
import fsp from "fs/promises";
import path from "node:path";
import { appendCsvRow, resolveUserName } from "../auditLog.mjs";
import {
  User_isAnyRoleOnline,
  USER_ONLINE_ROLE_ACTIVE_LIMIT_MS,
} from "../User_auth.mjs";
import { markResponsibleDone } from "./protocolMarkDone.mjs";
import { getDefaultDueOffsetMinutes } from "../utils/defaultDueOffset.mjs";
import { DATA_ROOT } from "../utils/pdfPaths.mjs";
import {
  AUFG_HEADERS,
  buildAufgabenLog,
  detectIncidentChange,
  ensureAufgabenLogFile,
} from "../utils/aufgabenLog.mjs";

const router = express.Router();

const trimRoleLabel = (value) => String(value ?? "").trim();
const canonicalRoleId = (value) => {
  const raw = trimRoleLabel(value);
  if (!raw) return "";
  const match = raw.match(/\b(LTSTBSTV|LTSTB|EL|S[1-6])\b/i);
  if (match) return match[1].toUpperCase();
  const collapsed = raw.replace(/\s+/g, "").toUpperCase();
  if (/^S[1-6]$/.test(collapsed)) return collapsed;
  if (collapsed === "EL" || collapsed === "LTSTB" || collapsed === "LTSTBSTV") return collapsed;
  return "";
};

// ========== Pfade / Dateien ==========
const AUFG_PREFIX = "Aufg";
const DATA_DIR = DATA_ROOT;   // => <repo>/server/data oder konfigurierter Pfad
const ROLES_FILE = path.join(DATA_DIR, "user", "User_roles.json");
const PROTOCOL_FILE = path.join(DATA_DIR, "protocol.json");

// Helper-Funktionen für Log und Board speichern, siehe vorherige vollständige Implementierung

function normalizeDueAt(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeIncidentId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function normalizeProtocolId(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) {
    const normalized = String(Number(raw));
    return normalized === "0" ? "0" : normalized;
  }
  return raw;
}

function normalizeProtocolIdList(values, fallback = []) {
  const out = [];
  const seen = new Set();
  const source = Array.isArray(values) ? values : fallback;
  for (const value of source) {
    const id = normalizeProtocolId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeProtocolDetails(entries) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = normalizeProtocolId(entry?.nr ?? entry?.id ?? entry?.value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const detail = { nr: id };
    const assign = (key, aliases = []) => {
      const sources = [entry[key], ...aliases.map((alias) => entry[alias])];
      for (const source of sources) {
        if (source == null) continue;
        const text = String(source).trim();
        if (text) {
          detail[key] = text;
          return;
        }
      }
    };
    assign("title", ["label"]);
    assign("information", ["desc", "beschreibung", "content"]);
    assign("infoTyp");
    assign("datum");
    assign("zeit");
    assign("anvon");
    out.push(detail);
  }
  return out;
}

async function syncProtocolDoneIfNeeded(item, req) {
  if (!item || String(item?.status ?? "") !== "Erledigt") return;

  const protoNr =
    item.originProtocolNr ??
    item.meta?.protoNr ??
    item.meta?.protoNR ??
    item.meta?.proto_nr ??
    null;

  const responsible = item?.responsible;
  if (!protoNr || !responsible) return;

  try {
    const actorName = resolveUserName(req) || "Automatisch";
    await markResponsibleDone(protoNr, responsible, actorName);
  } catch (err) {
    console.warn("[aufgaben→protocol]", err?.message || err);
  }
}



// --- normierte Aufgabe ---
function normalizeItem(x) {
  const responsible = x.responsible ?? x.verantwortlich ?? x.address ?? "";
  const desc = x.desc ?? x.notes ?? x.beschreibung ?? "";
  const st = String(x.status || "").toLowerCase();
  const status = STATUSES.includes(x.status)
    ? x.status
    : st.startsWith("in") ? "In Bearbeitung" : st.startsWith("erled") ? "Erledigt" : "Neu";
  const dueAt = normalizeDueAt(x.dueAt ?? x.due_at ?? x.deadline ?? x.frist ?? null);
  const rawCreatedBy =
    x.createdBy ??
    x.created_by ??
    x.creator ??
    x.user ??
    x.actor ??
    null;
  const createdBy = typeof rawCreatedBy === "string" ? rawCreatedBy.trim() : "";
  const linkedProtocols = normalizeProtocolDetails(x.linkedProtocols ?? x.meta?.linkedProtocols ?? []);
  const linkedProtocolNrs = normalizeProtocolIdList(
    x.linkedProtocolNrs ?? x.meta?.linkedProtocolNrs ?? [],
    linkedProtocols.map((entry) => entry.nr)
  );

  return {
    id: x.id ?? x._id ?? x.key ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientId: x.clientId ?? x.idempotencyKey ?? null, // Idempotenz gegen Doppel-POST
    title: x.title ?? x.name ?? x.typ ?? "Aufgabe",
    type: x.type ?? x.category ?? x.typ ?? "",
    responsible,
    desc,
    status,
    dueAt,
    createdAt: x.createdAt ?? x.ts ?? x.timestamp ?? Date.now(),
    updatedAt: x.updatedAt ?? Date.now(),
    kind: "task",
    meta: (x.meta ?? {}),
    originProtocolNr: x.originProtocolNr ?? null,
    createdBy: createdBy || null,
    relatedIncidentId: normalizeIncidentId(x.relatedIncidentId ?? x.meta?.relatedIncidentId ?? null),
    incidentTitle: (() => {
      const v = x.incidentTitle ?? x.meta?.incidentTitle ?? null;
      if (v == null) return null;
      const s = String(v).trim();
      return s || null;
    })(),
    linkedProtocolNrs,
    linkedProtocols,
  };
}

// ========== API-Endpunkte ==========
router.get("/config", (req, res) => {
  const role = targetRoleOrSend(req, res); if (!role) return;
  res.json({ defaultDueOffsetMinutes: getDefaultDueOffsetMinutes() });
});

router.get("/protocols", async (req, res) => {
  const role = targetRoleOrSend(req, res); if (!role) return;
  try {
    await ensureDir();
    let raw;
    try {
      raw = await fsp.readFile(PROTOCOL_FILE, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") {
        res.json({ items: [] });
        return;
      }
      throw err;
    }
    let list = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      } catch {
        list = [];
      }
    }
    const roleCandidates = (() => {
      const candidates = new Set();
      const base = normRole(role);
      if (base) candidates.add(base);
      const canonical = canonicalRoleId(role);
      if (canonical) candidates.add(canonical);
      if (candidates.has("LTSTBSTV")) candidates.add("LTSTB");
      if (candidates.has("LTSTB")) candidates.add("LTSTBSTV");
      return candidates;
    })();
    if (!roleCandidates.size) { res.json({ items: [] }); return; }
    const seen = new Set();
    const items = [];
    for (const entry of list) {
      if (!entry) continue;
      const recipients = Array.isArray(entry?.ergehtAn) ? entry.ergehtAn : [];
      const matches = recipients.some((recipient) => {
        const normalized = normRole(recipient);
        if (normalized && roleCandidates.has(normalized)) return true;
        const canonical = canonicalRoleId(recipient);
        return canonical && roleCandidates.has(canonical);
      });
      if (!matches) continue;
      const detailSource = {
        nr: entry?.nr ?? entry?.NR ?? entry?.id ?? entry?.ID,
        title: entry?.title ?? entry?.betreff ?? null,
        information: entry?.information ?? entry?.beschreibung ?? entry?.text ?? null,
        infoTyp: entry?.infoTyp ?? entry?.TYP ?? entry?.type ?? null,
        datum: entry?.datum ?? entry?.DATUM ?? null,
        zeit: entry?.zeit ?? entry?.ZEIT ?? null,
        anvon: entry?.anvon ?? entry?.ANVON ?? entry?.anVon ?? null,
      };
      const detail = normalizeProtocolDetails([detailSource])[0];
      if (!detail?.nr || seen.has(detail.nr)) continue;
      seen.add(detail.nr);
      items.push({
        nr: detail.nr,
        title: detail.title ?? null,
        information: detail.information ?? null,
        infoTyp: detail.infoTyp ?? null,
        datum: detail.datum ?? null,
        zeit: detail.zeit ?? null,
        anvon: detail.anvon ?? null,
      });
    }
    items.sort((a, b) => {
      const aNum = Number(a.nr);
      const bNum = Number(b.nr);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
      return String(b.nr).localeCompare(String(a.nr), "de", { numeric: true });
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
  await ensureDir();
  await ensureAufgabenLogFile(file);
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
const BOARD_ADMIN_ROLES = new Set(["LTSTB", "LTSTBSTV"]);
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
  if (target !== userRole) {
    const ltStbOnline = User_isAnyRoleOnline(
      ["LTSTB", "LTSTBSTV"],
      { activeWithinMs: USER_ONLINE_ROLE_ACTIVE_LIMIT_MS },
    );
    const s3FallbackActive = userRole === "S3" && !ltStbOnline;
    const canOverride = (BOARD_ADMIN_ROLES.has(userRole) || s3FallbackActive) && req.method === "GET" && !!qRole;
    if (!canOverride) return res.status(403).json({ error: "forbidden (role mismatch)" });
  }

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
    const creator = resolveUserName(req);
    item.createdBy = creator || item.createdBy || null;

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

router.post("/:id/edit", express.json(), async (req, res) => {
  const role = targetRoleOrSend(req, res); if (!role) return;
  if (!(await requireAufgabenEdit(req, res))) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "id fehlt" });
  try {
    const board = await loadAufgBoard(role);
    const items = Array.isArray(board.items) ? board.items : [];
    const idx = items.findIndex((x) => (x?.id ?? x?._id ?? x?.key) === id);
    if (idx < 0) return res.status(404).json({ error: "nicht gefunden" });

    const prev = normalizeItem(items[idx]);
    const body = req.body || {};
    const hasLinkedUpdate =
      Object.prototype.hasOwnProperty.call(body, "linkedProtocolNrs") ||
      Object.prototype.hasOwnProperty.call(body, "linkedProtocols");
    let nextLinkedNrs = prev.linkedProtocolNrs;
    let nextLinkedDetails = prev.linkedProtocols;
    if (hasLinkedUpdate) {
      const incomingDetails = normalizeProtocolDetails(body.linkedProtocols ?? []);
      const incomingIds = normalizeProtocolIdList(
        body.linkedProtocolNrs ?? [],
        incomingDetails.map((entry) => entry.nr)
      );
      const detailMap = new Map(incomingDetails.map((entry) => [entry.nr, entry]));
      const prevMap = new Map((prev.linkedProtocols || []).map((entry) => [entry.nr, entry]));
      nextLinkedNrs = incomingIds;
      nextLinkedDetails = incomingIds.map((id) => detailMap.get(id) || prevMap.get(id) || { nr: id });
    }
    const next = {
      ...prev,
      title: typeof body.title === "string" ? body.title.trim() : prev.title,
      type: typeof body.type === "string" ? body.type.trim() : prev.type,
      responsible: typeof body.responsible === "string" ? body.responsible.trim() : prev.responsible,
      desc: typeof body.desc === "string" ? body.desc : prev.desc,
      dueAt: Object.prototype.hasOwnProperty.call(body, "dueAt") ? normalizeDueAt(body.dueAt) : prev.dueAt,
       relatedIncidentId: Object.prototype.hasOwnProperty.call(body, "relatedIncidentId")
        ? normalizeIncidentId(body.relatedIncidentId)
        : prev.relatedIncidentId,
      incidentTitle: Object.prototype.hasOwnProperty.call(body, "incidentTitle")
        ? (() => {
            const v = body.incidentTitle;
            if (v == null) return null;
            const s = String(v).trim();
            return s || null;
          })()
        : prev.incidentTitle,
      linkedProtocolNrs: nextLinkedNrs,
      linkedProtocols: nextLinkedDetails,
      updatedAt: Date.now(),
    };
    board.items[idx] = next;
    await saveAufgBoard(role, board);

    const LOG_FILE = logPath(role);
    await ensureAufgLogHeader(LOG_FILE);
    await appendCsvRow(LOG_FILE, AUFG_HEADERS, buildAufgabenLog({ role, action: "edit", item: next }), req);

    const incidentChange = detectIncidentChange(prev, next);
    if (incidentChange) {
      await appendCsvRow(
        LOG_FILE,
        AUFG_HEADERS,
        buildAufgabenLog({
          role,
          action: incidentChange.type,
          item: next,
          fromStatus: prev.status,
          toStatus: next.status,
          relatedIncidentId: incidentChange.id,
          relatedIncidentTitle: incidentChange.title,
        }),
        req
      );
    }

    res.json({ ok: true, item: next });
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

 await syncProtocolDoneIfNeeded(next, req);

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
    await appendCsvRow(
      LOG_FILE,
      AUFG_HEADERS,
      buildAufgabenLog({ role, action: "reorder", item: moved, fromStatus: prev.status, toStatus }),
      req
    );

 await syncProtocolDoneIfNeeded(moved, req);

    res.json({ ok : true });
} catch (e) {
res.status(500).json({ error: e.message });
}
});

export default router;
