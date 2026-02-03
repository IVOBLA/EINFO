// server/routes/protocol.js
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import express from "express";
import { randomUUID } from "crypto";
import { resolveUserName } from "../auditLog.mjs";
import {
  User_authMiddleware,
  User_isAnyRoleOnline,
  USER_ONLINE_ROLE_ACTIVE_LIMIT_MS,
  User_onSessionDestroyed,
} from "../User_auth.mjs";
import { User_initStore } from "../User_store.mjs";
import { ensureTaskForRole } from "../utils/tasksService.mjs";
import { CSV_HEADER, ensureCsvStructure, appendHistoryEntriesToCsv } from "../utils/protocolCsv.mjs";
import { DATA_ROOT } from "../utils/pdfPaths.mjs";
import { fileMutex } from "../utils/fileMutex.mjs";
import { runInitialSetup } from "../utils/initialsetup.mjs";

const isLage = v => /^(lage|lagemeldung)$/i.test(String(v || ""));
const infoText = x => String(x?.information ?? x?.INFORMATION ?? x?.beschreibung ?? x?.text ?? x?.ERGAENZUNG ?? "").trim();
const taskType = x => /^(auftrag|lage|lagemeldung)$/i.test(String(x?.infoTyp ?? x?.TYP ?? x?.type ?? ""));

// ---- S2 safety-net helpers for incoming Lage entries -------------------------
const _norm = (s) => String(s ?? "").trim();
const _isFreeRow = (r) => _norm(r?.massnahme) === "" && _norm(r?.verantwortlich) === "";
const _isIncomingLageEntry = (e) =>
  isLage(e?.infoTyp) && isEingang(e?.uebermittlungsart) && _norm(e?.anvon).toUpperCase() !== "S2";
function ensureS2InNextFreeRow(entry) {
  if (!_isIncomingLageEntry(entry)) return;
  const m = Array.isArray(entry.massnahmen) ? entry.massnahmen : (entry.massnahmen = []);
  if (m.some((r) => _norm(r?.verantwortlich).toUpperCase() === "S2")) return;
  const idx = m.findIndex(_isFreeRow);
  if (idx >= 0) { m[idx] = { ...m[idx], verantwortlich: "S2" }; }
  else { m.push({ massnahme: "", verantwortlich: "S2", done: false }); }
}

const trimRoleLabel = (value) => String(value ?? "").trim();
const canonicalRoleId = (value) => {
  const raw = trimRoleLabel(value);
  if (!raw) return "";
  const match = raw.match(/\b(S[1-6]|EL|LTSTB)\b/i);
  if (match) return match[1].toUpperCase();
  return raw.replace(/\s+/g, "").toUpperCase();
};

const normalizeRoleValue = (value) => (typeof value === "string" ? value.trim() : "");
const sanitizeZu = (value) => (typeof value === "string" ? value.trim() : "");
const splitLegacyProtocolNumber = (value) => {
  if (value == null) return null;
  const raw = typeof value === "number" ? String(value) : String(value || "").trim();
  if (!raw) return null;

  const match = raw.match(/^\s*(\d+)\s*(?:[-/]|ZU[:\s-]*)\s*(.+)$/i);
  if (!match) return null;

  const nrPart = Number(match[1]);
  let zuPart = sanitizeZu(match[2]);
  if (/^ZU\b/i.test(zuPart)) {
    zuPart = sanitizeZu(zuPart.replace(/^ZU[:\s-]*/i, ""));
  }

  const nrValue = Number.isFinite(nrPart) ? nrPart : match[1];
  return { nr: nrValue, zu: zuPart };
};
const resolveActorRole = (req) => {
  const direct = normalizeRoleValue(req?.user?.role);
  if (direct) return direct;
  const headers = req?.headers || {};
  const headerCandidates = [
    headers["x-role-id"],
    headers["x-user-role"],
    headers["x-auth-role"],
  ];
  for (const cand of headerCandidates) {
    const role = normalizeRoleValue(cand);
    if (role) return role;
  }
  const bodyRole = normalizeRoleValue(req?.body?.role ?? req?.body?.userRole);
  if (bodyRole) return bodyRole;
  return "";
};

const CONFIRM_ROLES = new Set(["LTSTB", "LTSTBSTV", "S3"]);
const PRIMARY_CONFIRM_ROLES = new Set(["LTSTB", "LTSTBSTV"]);
const BACKUP_CONFIRM_ROLE = "S3";
const defaultConfirmation = () => ({ confirmed: false, by: null, byRole: null, at: null });
const normalizeConfirmation = (value) => {
  if (!value || typeof value !== "object" || !value.confirmed) return defaultConfirmation();
  const by = typeof value.by === "string" && value.by.trim() ? value.by.trim() : null;
  const rawRole = typeof value.byRole === "string" && value.byRole.trim() ? value.byRole.trim() : null;
  const byRole = canonicalRoleId(rawRole) || rawRole || null;
  let at = null;
  if (Number.isFinite(value.at)) {
    at = Number(value.at);
  } else if (value.at) {
    const parsed = Date.parse(value.at);
    if (Number.isFinite(parsed)) at = parsed;
  }
  return { confirmed: true, by, byRole, at };
};
const collectActorRoles = (req) => {
  const roles = new Set();
  const add = (raw) => {
    const id = canonicalRoleId(raw);
    if (id) roles.add(id);
  };
  add(req?.user?.role);
  if (Array.isArray(req?.user?.roles)) {
    for (const r of req.user.roles) {
      if (!r) continue;
      if (typeof r === "string") add(r);
      else if (typeof r?.id === "string") add(r.id);
      else if (typeof r?.role === "string") add(r.role);
    }
  }
  add(resolveActorRole(req));
  return roles;
};
const sanitizeConfirmation = (input, { existing, identity, actorRoles }) => {
  const existingNorm = normalizeConfirmation(existing);
  const existingRole = existingNorm.confirmed ? canonicalRoleId(existingNorm.byRole) || existingNorm.byRole || null : null;
  const actorHasExistingRole = existingRole
    ? actorRoles.has(existingRole) ||
      (existingRole === BACKUP_CONFIRM_ROLE && [...actorRoles].some((roleId) => PRIMARY_CONFIRM_ROLES.has(roleId)))
    : false;
  const ltStbAvailable = User_isAnyRoleOnline(
    [...PRIMARY_CONFIRM_ROLES],
    { activeWithinMs: USER_ONLINE_ROLE_ACTIVE_LIMIT_MS },
  );
  const actorConfirmRoles = [...actorRoles]
    .filter((roleId) => CONFIRM_ROLES.has(roleId))
    .filter((roleId) => roleId !== BACKUP_CONFIRM_ROLE || !ltStbAvailable);
  const hasConfirmPermission = actorConfirmRoles.length > 0;

  if (!input || typeof input !== "object") {
    return existingNorm.confirmed ? existingNorm : defaultConfirmation();
  }

  const requestedConfirmed = !!input.confirmed;

  if (requestedConfirmed) {
    if (existingNorm.confirmed) return existingNorm;
    if (!hasConfirmPermission) {
      const err = new Error("CONFIRM_NOT_ALLOWED");
      err.status = 403;
      throw err;
    }
    const requestedRole = actorConfirmRoles[0];
    if (!requestedRole) {
      const err = new Error("CONFIRM_NOT_ALLOWED");
      err.status = 403;
      throw err;
    }
    const displayName = identity?.displayName || identity?.username || identity?.userId || null;
    return {
      confirmed: true,
      by: displayName,
      byRole: requestedRole,
      at: Date.now(),
    };
  }

  if (existingNorm.confirmed && !actorHasExistingRole) {
    const err = new Error("CONFIRM_LOCKED");
    err.status = 403;
    throw err;
  }

  return defaultConfirmation();
};

function collectMeasureRoles(item) {
  const roles = new Map();
  const baseAnVon = titleFromAnVon(item);
  const desc = infoText(item);
  for (const measure of item?.massnahmen || []) {
    const label = trimRoleLabel(measure?.verantwortlich);
    if (!label) continue;
    const key = canonicalRoleId(label);
    if (!key) continue;
    const title = `${baseAnVon} ${String(measure?.massnahme ?? "").trim()}`.trim() || baseAnVon;
    if (!roles.has(key)) roles.set(key, { label, title });
  }
  return { roles, baseAnVon, desc };
}
const rolesOf = x => {
  const set = new Set();
  // 1) explizit angegebene Rollen
  if (Array.isArray(x?.verantwortliche)) {
    x.verantwortliche.forEach((r) => set.add(String(r).trim()));
  }
  // 2) Maßnahmen-Verantwortliche
  (x?.massnahmen || []).forEach((m) => {
    if (m?.verantwortlich) set.add(String(m.verantwortlich).trim());
  });
  return [...set].filter(Boolean);
};

// ► Datenpfad aus zentraler Konfiguration (z.B. via DATA_DIR)
const DATA_DIR   = DATA_ROOT;   // => <repo>/server/data oder konfigurierter Pfad
const CSV_FILE   = path.join(DATA_DIR, "protocol.csv");
const JSON_FILE  = path.join(DATA_DIR, "protocol.json");
const ROLES_FILE = path.join(DATA_DIR, "user", "User_roles.json");
const PROTOCOL_APP_ID = "protokoll";
const AUFGABEN_APP_ID = "aufgabenboard";
const TASK_OVERRIDE_HEADER = "x-protocol-task-override";
const TRUE_HEADER_VALUES = new Set(["1", "true", "yes", "on"]);

User_initStore(DATA_DIR);

const router = express.Router();
const SECURE_COOKIES = process.env.KANBAN_COOKIE_SECURE === "1";
router.use(User_authMiddleware({ secureCookies: SECURE_COOKIES }));

async function loadRolesVAny() {
  try {
    const raw = JSON.parse(await fsp.readFile(ROLES_FILE, "utf8"));
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.roles) ? raw.roles : []);
    return arr
      .map((entry) => {
        if (!entry) return null;
        const idSource = entry.id ?? entry.label ?? "";
        const canonicalId = canonicalRoleId(idSource) || trimRoleLabel(idSource).toUpperCase();
        if (!canonicalId) return null;
        const apps = {};
        if (entry.apps && typeof entry.apps === "object") {
          for (const [key, value] of Object.entries(entry.apps)) {
            const app = String(key || "").trim().toLowerCase();
            if (!app) continue;
            const level = String(value || "").trim().toLowerCase();
            if (!level) continue;
            if (!apps[app] || level === "edit") {
              apps[app] = level;
            }
          }
        }
        if (Array.isArray(entry.capabilities)) {
          for (const capability of entry.capabilities) {
            const match = String(capability || "").trim().match(/^([a-z0-9_-]+)[:.]([a-z]+)$/i);
            if (!match) continue;
            const app = match[1].toLowerCase();
            const level = match[2].toLowerCase();
            if (!apps[app] || level === "edit") {
              apps[app] = level;
            }
          }
        }
        return { id: canonicalId, apps };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function userHasAppEditPermission(req, appId) {
  const actorRoles = collectActorRoles(req);
  if (!actorRoles.size) return false;
  const roles = await loadRolesVAny();
  const roleMap = new Map();
  for (const role of roles) {
    if (!role?.id) continue;
    if (!roleMap.has(role.id)) roleMap.set(role.id, role);
  }
  for (const roleId of actorRoles) {
    const role = roleMap.get(roleId);
    if (!role) continue;
    const level = role.apps?.[appId];
    if (typeof level !== "string") continue;
    if (level.toLowerCase() === "edit") return true;
  }
  return false;
}

async function userHasProtocolEditPermission(req) {
  if (await userHasAppEditPermission(req, PROTOCOL_APP_ID)) {
    return true;
  }

  // Fallback: Ist kein LtStb/LtStbStv online, darf S3 bearbeiten
  const actorRoles = collectActorRoles(req);
  if (!actorRoles.has("S3")) return false;

  const ltStbAvailable = User_isAnyRoleOnline(
    ["LTSTB", "LTSTBSTV"],
    { activeWithinMs: USER_ONLINE_ROLE_ACTIVE_LIMIT_MS }
  );

  return !ltStbAvailable;
}

async function userHasAufgabenboardEditPermission(req) {
  return userHasAppEditPermission(req, AUFGABEN_APP_ID);
}

function hasTaskOverrideRequest(req) {
  const headerValue = req?.get?.(TASK_OVERRIDE_HEADER) ?? req?.headers?.[TASK_OVERRIDE_HEADER];
  if (headerValue == null) return false;
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof value !== "string") return false;
  return TRUE_HEADER_VALUES.has(value.trim().toLowerCase());
}

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 Minuten
const activeLocks = new Map(); // nr -> { userId, username, displayName, lockedAt, expiresAt }

const releaseLocksForUser = (userId) => {
  const targetId = userId == null ? null : String(userId).trim();
  if (!targetId) return 0;
  let removed = 0;
  for (const [nr, info] of activeLocks.entries()) {
    const lockUserId = info?.userId == null ? null : String(info.userId).trim();
    if (lockUserId && lockUserId === targetId) {
      activeLocks.delete(nr);
      removed += 1;
    }
  }
  return removed;
};

User_onSessionDestroyed((session) => {
  if (!session) return;
  const userId = session?.userId ?? null;
  if (userId) releaseLocksForUser(userId);
});

const describeLock = (lock) => {
  if (!lock) return null;
  return {
    userId: lock.userId ?? null,
    username: lock.username ?? null,
    lockedBy: lock.displayName || lock.username || "Unbekannt",
    lockedAt: lock.lockedAt ?? null,
    expiresAt: lock.expiresAt ?? null,
  };
};

const cleanupExpiredLocks = () => {
  const now = Date.now();
  for (const [nr, info] of activeLocks.entries()) {
    if (!info || !info.expiresAt || info.expiresAt <= now) {
      activeLocks.delete(nr);
    }
  }
};

const resolveUserIdentity = (req) => {
  const user = req?.user || {};
  const userId =
    user?.id != null
      ? String(user.id)
      : user?.username
        ? String(user.username)
        : null;
  const username = user?.username ? String(user.username) : null;
  const displayName =
    resolveUserName(req) ||
    (typeof user?.displayName === "string" && user.displayName.trim()) ||
    username ||
    (userId != null ? `ID ${userId}` : "");
  return {
    userId,
    username,
    displayName: displayName || "Unbekannt",
  };
};

const titleFromAnVon = (o) =>
  String(
    o?.anvon ?? o?.an_von ?? o?.anVon ??
    o?.name_stelle ?? o?.nameStelle ?? o?.name ?? ""
  ).trim() || "An/Von";

const isEingang = v => {
  const x = (v?.ein ?? v)?.toString().trim().toLowerCase();
  return x === "true" || x === "1" || x === "x" || x === "eingang";
};

// ==== Files sicherstellen ====
let ensureFilesPromise = null;
function ensureFiles() {
  if (!ensureFilesPromise) {
    ensureFilesPromise = (async () => {
      try {
        await fsp.mkdir(DATA_DIR, { recursive: true });
        try {
          await fsp.access(JSON_FILE, fs.constants.F_OK);
        } catch {
          await fsp.writeFile(JSON_FILE, "[]", "utf8");
        }
        try {
          await fsp.access(CSV_FILE, fs.constants.F_OK);
        } catch {
          // CRLF-Zeilenende für maximale Excel-Kompatibilität
          await fsp.writeFile(CSV_FILE, CSV_HEADER.join(";") + "\r\n", "utf8");
        }
      } catch (err) {
        ensureFilesPromise = null;
        throw err;
      }
    })();
  }
  return ensureFilesPromise;
}

// Migration: id + printCount + history ergänzen
function migrateMeta(arr) {
  let changed = false;
  for (const it of arr) {
    if (!it.id) { it.id = randomUUID(); changed = true; }
    if (!Array.isArray(it.history)) { it.history = []; changed = true; }
    else {
      let historyChanged = false;
      for (const entry of it.history) {
        if (!entry || entry.action !== PRINT_HISTORY_ACTION) continue;
        const before = entry.printCount;
        normalizePrintHistoryEntry(entry);
        if (before !== entry.printCount) historyChanged = true;
      }
      if (historyChanged) changed = true;
    }
    const historyPrintSum = sumPrintHistory(it.history);
    if (typeof it.printCount !== "number" || it.printCount !== historyPrintSum) {
      it.printCount = historyPrintSum;
      changed = true;
    }
    if (typeof it.createdBy === "undefined") {
      const creatorFromHistory = it.history.find?.(h => h?.action === "create" && h?.by)?.by;
      it.createdBy = creatorFromHistory || it.lastBy || null;
      changed = true;
    }
    const normalizedConfirm = normalizeConfirmation(it.otherRecipientConfirmation);
    const currentConfirmJson = JSON.stringify(it.otherRecipientConfirmation ?? defaultConfirmation());
    const normalizedJson = JSON.stringify(normalizedConfirm);
    if (currentConfirmJson !== normalizedJson) {
      it.otherRecipientConfirmation = normalizedConfirm;
      changed = true;
    }
    let normalizedZu = sanitizeZu(it.zu);
    if (/^ZU\b/i.test(normalizedZu)) {
      const trimmedZu = sanitizeZu(normalizedZu.replace(/^ZU[:\s-]*/i, ""));
      if (trimmedZu !== normalizedZu) {
        normalizedZu = trimmedZu;
      }
    }
    if (it.zu !== normalizedZu) {
      it.zu = normalizedZu;
      changed = true;
    }

    const legacySplit = splitLegacyProtocolNumber(it.nr);
    if (legacySplit) {
      if (!it.zu && legacySplit.zu) {
        it.zu = sanitizeZu(legacySplit.zu);
        changed = true;
      }
      if (typeof legacySplit.nr !== "undefined") {
        const numericNr = Number(legacySplit.nr);
        if (Number.isFinite(numericNr) && it.nr !== numericNr) {
          it.nr = numericNr;
          changed = true;
        }
      }
    }

    if (typeof it.nr === "string") {
      const numericNr = Number(it.nr);
      if (Number.isFinite(numericNr)) {
        if (it.nr !== numericNr) changed = true;
        it.nr = numericNr;
      }
    }
  }
  return changed;
}

let cachedJson = null;
let lastMtime = 0;
let csvStructureEnsured = false;

async function persistJson(arr) {
  await fsp.writeFile(JSON_FILE, JSON.stringify(arr, null, 2), "utf8");
}

async function readAllJson() {
  await ensureFiles();
  const stat = await fsp.stat(JSON_FILE).catch(() => ({ mtimeMs: 0 }));
  if (!cachedJson || stat.mtimeMs > lastMtime) {
    let arr = [];
    try { arr = JSON.parse(await fsp.readFile(JSON_FILE, "utf8")); } catch { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    if (migrateMeta(arr)) await persistJson(arr);
    if (!csvStructureEnsured) { ensureCsvStructure(arr, CSV_FILE); csvStructureEnsured = true; }
    cachedJson = arr;
    lastMtime = stat.mtimeMs;
  }
  return cachedJson;
}

async function writeAllJson(arr) {
  cachedJson = arr;
  await persistJson(arr);
}
function nextNr(arr) {
  const max = arr.reduce((m, x) => Math.max(m, Number(x?.nr) || 0), 0);
  return max + 1;
}

// ----- History-Helfer --------------------------------------------------------
const HIST_IGNORE = new Set(["id", "nr", "printCount", "history"]);
const PRINT_HISTORY_ACTION = "print";
function flatten(obj, prefix = "", out = {}) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (HIST_IGNORE.has(k)) continue;
      flatten(v, key, out);
    }
  } else {
    out[prefix] = obj;
  }
  return out;
}
function computeDiff(before, after) {
  const a = flatten(before), b = flatten(after);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes = [];
  for (const k of keys) {
    const va = a[k], vb = b[k];
    const eq = JSON.stringify(va) === JSON.stringify(vb);
    if (!eq) changes.push({ path: k, before: va ?? null, after: vb ?? null });
  }
  return changes;
}
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

function normalizePrintHistoryEntry(entry) {
  if (!entry || entry.action !== PRINT_HISTORY_ACTION) return entry;
  const raw = entry.printCount ?? entry.pages ?? 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (entry.printCount !== numeric) entry.printCount = numeric;
  } else {
    entry.printCount = 0;
  }
  return entry;
}

function sumPrintHistory(history) {
  if (!Array.isArray(history)) return 0;
  return history.reduce((total, entry) => {
    if (!entry || entry.action !== PRINT_HISTORY_ACTION) return total;
    const value = Number(entry.printCount ?? entry.pages ?? 0);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

// ---------- API ----------

// CSV-Download (Route vor '/:nr')
router.get("/csv/file", async (_req, res) => {
  try {
    await ensureFiles();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="protocol.csv"');
    const buf = await fsp.readFile(CSV_FILE);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Liste
router.get("/", async (_req, res) => {
  try {
    const items = await readAllJson();
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/:nr(\\d+)/lock", async (req, res) => {
  try {
    const nr = Number(req.params.nr);
    if (!Number.isFinite(nr) || nr <= 0) {
      return res.status(400).json({ ok: false, error: "INVALID_NUMBER" });
    }

    const all = await readAllJson();
    const itemExists = all.some((x) => Number(x?.nr) === nr);
    if (!itemExists) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    cleanupExpiredLocks();
    const identity = resolveUserIdentity(req);
    if (!identity.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    if (!(await userHasProtocolEditPermission(req))) {
      return res.status(403).json({ ok: false, error: "EDIT_FORBIDDEN" });
    }

    const existing = activeLocks.get(nr);
    const now = Date.now();
    if (existing && existing.userId && existing.userId !== identity.userId) {
      return res.status(423).json({
        ok: false,
        error: "LOCKED",
        lockedBy: existing.displayName || existing.username || "Unbekannt",
        lock: describeLock(existing),
      });
    }

    const lock = {
      userId: identity.userId,
      username: identity.username,
      displayName: identity.displayName,
      lockedAt: existing?.lockedAt || now,
      expiresAt: now + LOCK_TTL_MS,
    };
    activeLocks.set(nr, lock);

    res.json({ ok: true, lock: describeLock(lock) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete("/:nr(\\d+)/lock", async (req, res) => {
  try {
    const nr = Number(req.params.nr);
    if (!Number.isFinite(nr) || nr <= 0) {
      return res.status(400).json({ ok: false, error: "INVALID_NUMBER" });
    }

    cleanupExpiredLocks();
    const existing = activeLocks.get(nr);
    if (!existing) {
      return res.json({ ok: true, released: false });
    }

    const identity = resolveUserIdentity(req);
    if (!identity.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    if (existing.userId && existing.userId !== identity.userId) {
      return res.status(423).json({
        ok: false,
        error: "LOCKED",
        lockedBy: existing.displayName || existing.username || "Unbekannt",
        lock: describeLock(existing),
      });
    }

    activeLocks.delete(nr);
    res.json({ ok: true, released: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Detail
router.get("/:nr(\\d+)", async (req, res) => {
  try {
    const nr  = Number(req.params.nr);
    const all = await readAllJson();
    const it  = all.find(x => Number(x.nr) === nr);
    if (!it) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, item: it });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Neu
router.post("/", express.json(), async (req, res) => {
  try {
    const identity = resolveUserIdentity(req);
    if (!identity.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const hasProtocolPermission = await userHasProtocolEditPermission(req);
    const allowTaskOverride = hasTaskOverrideRequest(req) && await userHasAufgabenboardEditPermission(req);
    if (!hasProtocolPermission && !allowTaskOverride) {
      return res.status(403).json({ ok: false, error: "EDIT_FORBIDDEN" });
    }
    const actorRoles = collectActorRoles(req);

    // Serialize read-modify-write on protocol.json
    const { nr, payload, latestEntry } = await fileMutex.withLock("protocol", async () => {
      const all = await readAllJson();
      const nr  = nextNr(all);
      const payload = {
        ...(req.body || {}),
        nr,
        id: randomUUID(),
        printCount: 0,
        history: []
      };
      payload.zu = sanitizeZu(payload.zu);
      if (allowTaskOverride) {
        const actorRole = resolveActorRole(req);
        const normalizedActorRole = canonicalRoleId(actorRole);
        const fallbackRole = (() => {
          const values = [...actorRoles];
          return values.length ? canonicalRoleId(values[0]) : null;
        })();
        payload.meta = {
          ...(payload.meta || {}),
          createdVia: "task-board",
          createdByRole: normalizedActorRole || fallbackRole || payload.meta?.createdByRole || null,
        };
      }
      try {
        payload.otherRecipientConfirmation = sanitizeConfirmation(req.body?.otherRecipientConfirmation, {
          existing: null,
          identity,
          actorRoles,
        });
      } catch (err) {
        const status = err?.status && Number.isFinite(err.status) ? Number(err.status) : 400;
        throw Object.assign(new Error(err?.message || "CONFIRM_ERROR"), { httpStatus: status });
      }
      const userBy = identity.displayName || req?.user?.displayName || req?.user?.username || resolveUserName(req) || "";
      payload.createdBy = userBy;
      payload.history.push({
        ts: Date.now(),
        action: "create",
        by: userBy,
        after: snapshotForHistory(payload)
      });
      payload.printCount = sumPrintHistory(payload.history);
      payload.lastBy = userBy;
      ensureS2InNextFreeRow(payload);
      all.push(payload);

      const latestEntry = payload.history?.[payload.history.length - 1];
      await writeAllJson(all);
      if (latestEntry) appendHistoryEntriesToCsv(payload, [latestEntry], CSV_FILE);
      return { nr, payload, latestEntry };
    });
// Ergänzung: Aufgaben je Verantwortlicher (nur Auftrag/Lage)
try {
  if (taskType(payload)) {
    const actor = payload.createdBy || resolveUserName(req);
    const actorRole = resolveActorRole(req);
    const { roles, desc } = collectMeasureRoles(payload);
    const type = payload?.infoTyp ?? "";

    for (const { label, title } of roles.values()) {
      await ensureTaskForRole({
        roleId: label,
        responsibleLabel: label,
        protoNr: payload.nr,
        actor,
        actorRole,
        item: {
          title,
          type,
          desc,
          meta: { source: "protokoll", protoNr: payload.nr }
        }
      });
    }

    if (
      isLage(payload?.infoTyp) &&
      isEingang(payload?.uebermittlungsart) &&
      String(payload?.anvon || "").trim().toUpperCase() !== "S2"
    ) {
      const titleAuto = `${titleFromAnVon(payload)} ${String(payload?.massnahmen?.[0]?.massnahme ?? "").trim()}`.trim();

      await ensureTaskForRole({
        roleId: "S2",
        responsibleLabel: "S2",
        protoNr: payload.nr,
        actor,
        actorRole,
        item: {
          title: titleAuto,
          type,
          desc: infoText(payload),
          meta: { source: "protokoll", protoNr: payload.nr }
        }
      });
    }
  }
} catch (err) {
  console.warn("[protocol→tasks POST]", err?.message || err);
}
        res.json({ ok: true, nr, id: payload.id, zu: payload.zu ?? "" });
  } catch (e) {
    const status = e?.httpStatus && Number.isFinite(e.httpStatus) ? e.httpStatus : 500;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// Update
router.put("/:nr(\\d+)", express.json(), async (req, res) => {
  try {
    const nr  = Number(req.params.nr);

    cleanupExpiredLocks();
    const identity = resolveUserIdentity(req);
    if (!identity.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const actorRoles = collectActorRoles(req);
    if (!(await userHasProtocolEditPermission(req))) {
      return res.status(403).json({ ok: false, error: "EDIT_FORBIDDEN" });
    }
    const existingLock = activeLocks.get(nr);
    if (existingLock && existingLock.userId && identity.userId && existingLock.userId !== identity.userId) {
      return res.status(423).json({
        ok: false,
        error: "LOCKED",
        lockedBy: existingLock.displayName || existingLock.username || "Unbekannt",
        lock: describeLock(existingLock),
      });
    }

    // Serialize read-modify-write on protocol.json
    const result = await fileMutex.withLock("protocol", async () => {
      const all = await readAllJson();
      const idx = all.findIndex(x => Number(x.nr) === nr);
      if (idx < 0) return { notFound: true };

      const existing = all[idx];

      const next = {
        ...existing,
        ...(req.body || {}),
        nr,
        id: existing.id,
        history: existing.history || []
      };
      next.zu = sanitizeZu(next.zu ?? existing.zu);

      try {
        next.otherRecipientConfirmation = sanitizeConfirmation(req.body?.otherRecipientConfirmation, {
          existing: existing.otherRecipientConfirmation,
          identity,
          actorRoles,
        });
      } catch (err) {
        const status = err?.status && Number.isFinite(err.status) ? Number(err.status) : 400;
        throw Object.assign(new Error(err?.message || "CONFIRM_ERROR"), { httpStatus: status });
      }

      const existingCreator =
        existing.createdBy ??
        existing.history?.find?.((h) => h?.action === "create" && h?.by)?.by ??
        existing.lastBy ??
        null;
      next.createdBy = existingCreator;

      const userBy  = identity.displayName || req?.user?.displayName || req?.user?.username || resolveUserName(req) || "";
      const changes = computeDiff(existing, next);
      if (changes.length) {
        const existingConfirm = normalizeConfirmation(existing.otherRecipientConfirmation);
        const existingRole = existingConfirm.confirmed ? canonicalRoleId(existingConfirm.byRole) || existingConfirm.byRole || null : null;
        if (existingConfirm.confirmed && existingRole && !actorRoles.has(existingRole)) {
          throw Object.assign(new Error("CONFIRM_LOCKED"), { httpStatus: 403 });
        }
      }
      if (!changes.length) {
        if (identity.userId) {
          const now = Date.now();
          const lock = {
            userId: identity.userId,
            username: identity.username,
            displayName: identity.displayName,
            lockedAt: existingLock?.lockedAt || now,
            expiresAt: now + LOCK_TTL_MS,
          };
          activeLocks.set(nr, lock);
        }
        return { unchanged: true, nr, id: existing.id };
      }
      let newHistoryEntry = null;
      if (changes.length) {
        newHistoryEntry = { ts: Date.now(), action: "update", by: userBy, changes, after: snapshotForHistory(next) };
        next.history = [
          ...next.history,
          newHistoryEntry
        ];
      }
      next.printCount = sumPrintHistory(next.history);
      next.lastBy = userBy;
      ensureS2InNextFreeRow(next);

      all[idx] = next;
      await writeAllJson(all);

      if (identity.userId) {
        const now = Date.now();
        const lock = {
          userId: identity.userId,
          username: identity.username,
          displayName: identity.displayName,
          lockedAt: existingLock?.lockedAt || now,
          expiresAt: now + LOCK_TTL_MS,
        };
        activeLocks.set(nr, lock);
      }
      if (newHistoryEntry) appendHistoryEntriesToCsv(next, [newHistoryEntry], CSV_FILE);
      return { next, userBy };
    });

    if (result.notFound) return res.status(404).json({ ok: false, error: "Not found" });
    if (result.unchanged) return res.json({ ok: true, nr, id: result.id, unchanged: true });
    const { next, userBy } = result;

    // Task sync outside lock
    try{
      if (taskType(next)) {
        const actor = next.createdBy || userBy;
        const actorRole = resolveActorRole(req);
        const { roles, desc } = collectMeasureRoles(next);
        const type = next?.infoTyp ?? next?.TYP ?? "";
        const seen = new Set();

        for (const [key, info] of roles.entries()) {
          seen.add(key);
          await ensureTaskForRole({
            roleId: info.label,
            responsibleLabel: info.label,
            protoNr: next.nr,
            actor,
            actorRole,
            item: {
              title: info.title,
              type,
              desc,
              meta: { source: "protokoll", protoNr: next.nr }
            }
          });
        }

        const fallbackTitle = `${titleFromAnVon(next)} ${String(next?.massnahmen?.[0]?.massnahme ?? "").trim()}`.trim();
        const text = infoText(next);
        for (const roleId of rolesOf(next)) {
          const label = trimRoleLabel(roleId);
          if (!label) continue;
          const key = canonicalRoleId(label);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          await ensureTaskForRole({
            roleId: label,
            responsibleLabel: label,
            protoNr: next.nr,
            actor,
            actorRole,
            item: {
              title: fallbackTitle,
              type,
              desc: text,
              meta: { source: "protokoll", protoNr: next.nr }
            }
          });
        }

        if (
          isLage(next?.infoTyp || next?.TYP) &&
          isEingang(next?.uebermittlungsart) &&
          String(next?.anvon || "").trim().toUpperCase() !== "S2"
        ) {
          const titleAutoU = `${titleFromAnVon(next)} ${String(next?.massnahmen?.[0]?.massnahme ?? "").trim()}`.trim();

          await ensureTaskForRole({
            roleId: "S2",
            responsibleLabel: "S2",
            protoNr: next.nr,
            actor,
            actorRole,
            item: {
              title: titleAutoU,
              type,
              desc: infoText(next),
              meta: { source: "protokoll", protoNr: next.nr }
            }
          });
        }
      }
    } catch (e) { console.warn("[protocol->tasks PUT]", e?.message || e); }
    res.json({ ok: true, nr, id: next.id, zu: next.zu ?? "" });
  } catch (e) {
    const status = e?.httpStatus && Number.isFinite(e.httpStatus) ? e.httpStatus : 500;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// ==== Stab hochfahren / Einsatz beenden ====================================

const SCENARIO_CONFIG_FILE = path.join(DATA_DIR, "scenario_config.json");

function stabRoleCheck(req) {
  const actorRoles = collectActorRoles(req);
  const isLtStb = actorRoles.has("LTSTB") || actorRoles.has("LTSTBSTV");
  if (isLtStb) return { ok: true, actorRoles };
  if (actorRoles.has("S3")) {
    const ltStbOnline = User_isAnyRoleOnline(
      ["LTSTB", "LTSTBSTV"],
      { activeWithinMs: USER_ONLINE_ROLE_ACTIVE_LIMIT_MS },
    );
    if (!ltStbOnline) return { ok: true, actorRoles };
  }
  return { ok: false, actorRoles };
}

function nowDatumZeit() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    datum: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    zeit: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function createSystemProtocolEntry({ information, identity, actorRole }) {
  const { datum, zeit } = nowDatumZeit();
  const userBy = identity.displayName || "SYSTEM";
  const id = randomUUID();
  const histEntry = {
    ts: Date.now(),
    action: "create",
    by: userBy,
    after: null, // filled below
  };
  const payload = {
    nr: 0, // set later
    id,
    datum,
    zeit,
    anvon: actorRole || "SYSTEM",
    information,
    infoTyp: "Information",
    uebermittlungsart: { aus: true, kanalNr: "SYS" },
    ergehtAn: [],
    zu: "",
    massnahmen: [],
    printCount: 0,
    createdBy: userBy,
    lastBy: userBy,
    history: [histEntry],
  };
  histEntry.after = snapshotForHistory(payload);
  return { payload, histEntry };
}

router.post("/stab/hochfahren", express.json(), async (req, res) => {
  try {
    const identity = resolveUserIdentity(req);
    if (!identity.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const { ok: allowed, actorRoles } = stabRoleCheck(req);
    if (!allowed) {
      return res.status(403).json({ ok: false, error: "Nur LtStB/LtStbStv oder S3 (wenn LtStB nicht online) erlaubt." });
    }

    const { einsatztitel = "", ausgangslage = "", wetter = "" } = req.body || {};

    // 1) Initialsetup
    await runInitialSetup({ dataDir: DATA_DIR });
    // Invalidate cached protocol JSON after initialsetup
    cachedJson = null;

    // 2) Update scenario_config.json
    const newScenarioId = `scenario_${Date.now()}`;
    let config = {};
    try {
      config = JSON.parse(await fsp.readFile(SCENARIO_CONFIG_FILE, "utf8"));
    } catch { /* ignore */ }
    config.wetter = wetter;
    config.artDesEreignisses = ausgangslage;
    config.ausgangslage = ausgangslage;
    config.einsatztitel = einsatztitel;
    config.scenarioId = newScenarioId;
    await fsp.writeFile(SCENARIO_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");

    // 3) Protocol entry
    const actorRole = resolveActorRole(req) || [...actorRoles][0] || "SYSTEM";
    const info = `Stab hochgefahren (Initialsetup). scenarioId=${newScenarioId}. Einsatztitel="${einsatztitel}"`;
    const { payload, histEntry } = createSystemProtocolEntry({ information: info, identity, actorRole });

    await fileMutex.withLock("protocol", async () => {
      const all = await readAllJson();
      payload.nr = nextNr(all);
      histEntry.after = snapshotForHistory(payload);
      all.push(payload);
      await writeAllJson(all);
      appendHistoryEntriesToCsv(payload, [histEntry], CSV_FILE);
    });

    res.json({ ok: true, scenarioId: newScenarioId, message: `Stab hochgefahren. scenarioId=${newScenarioId}` });
  } catch (err) {
    console.error("[protocol/stab/hochfahren]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/einsatz/beenden", express.json(), async (req, res) => {
  try {
    const identity = resolveUserIdentity(req);
    if (!identity.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const { ok: allowed, actorRoles } = stabRoleCheck(req);
    if (!allowed) {
      return res.status(403).json({ ok: false, error: "Nur LtStB/LtStbStv oder S3 (wenn LtStB nicht online) erlaubt." });
    }

    // Read current scenarioId for informational purposes
    let scenarioId = "";
    try {
      const cfg = JSON.parse(await fsp.readFile(SCENARIO_CONFIG_FILE, "utf8"));
      scenarioId = cfg.scenarioId || "";
    } catch { /* ignore */ }

    const actorRole = resolveActorRole(req) || [...actorRoles][0] || "SYSTEM";
    const info = `Einsatz beendet${scenarioId ? ` (scenarioId=${scenarioId})` : ""}`;
    const { payload, histEntry } = createSystemProtocolEntry({ information: info, identity, actorRole });

    await fileMutex.withLock("protocol", async () => {
      const all = await readAllJson();
      payload.nr = nextNr(all);
      histEntry.after = snapshotForHistory(payload);
      all.push(payload);
      await writeAllJson(all);
      appendHistoryEntriesToCsv(payload, [histEntry], CSV_FILE);
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[protocol/einsatz/beenden]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
export function invalidateProtocolCache() { cachedJson = null; /* lastMtime optional */ }