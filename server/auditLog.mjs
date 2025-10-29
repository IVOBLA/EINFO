// server/utils/auditLog.mjs  (ESM)
import fs from "fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_INDEX_FILE = path.join(__dirname, "data", "user", "User_authIndex.json");

const userCache = {
  mtimeMs: 0,
  byId: new Map(),
  byUsername: new Map(),
  byDisplay: new Map(),
};

function refreshUserCache() {
  try {
    const stat = fsSync.statSync(USER_INDEX_FILE);
    if (stat.mtimeMs === userCache.mtimeMs) return;

    const raw = fsSync.readFileSync(USER_INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.users) ? parsed.users : [];

    userCache.byId.clear();
    userCache.byUsername.clear();
    userCache.byDisplay.clear();

    for (const entry of entries) {
      if (!entry) continue;
      const id = Number(entry.id);
      const username = typeof entry.username === "string" ? entry.username.trim() : "";
      const displayName = typeof entry.displayName === "string" && entry.displayName.trim()
        ? entry.displayName.trim()
        : username;

      if (!displayName) continue;
      if (Number.isFinite(id)) userCache.byId.set(id, displayName);
      if (username) userCache.byUsername.set(username.toLowerCase(), displayName);
      userCache.byDisplay.set(displayName.toLowerCase(), displayName);
    }

    userCache.mtimeMs = stat.mtimeMs;
  } catch {
    userCache.byId.clear();
    userCache.byUsername.clear();
    userCache.byDisplay.clear();
    userCache.mtimeMs = 0;
  }
}

function looksLikeIp(value) {
  return /^[0-9.]+$/.test(value) || value.includes(":");
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function fromUserCache(raw) {
  if (!raw) return "";
  refreshUserCache();

  const id = Number(raw);
  if (Number.isFinite(id) && userCache.byId.has(id)) {
    return userCache.byId.get(id) || "";
  }

  const lower = String(raw).toLowerCase();
  if (userCache.byUsername.has(lower)) return userCache.byUsername.get(lower) || "";
  if (userCache.byDisplay.has(lower)) return userCache.byDisplay.get(lower) || "";
  return "";
}

function coerceUserName(value) {
  if (value == null) return "";

  if (typeof value === "object") {
    return (
      coerceUserName(value.displayName) ||
      coerceUserName(value.label) ||
      coerceUserName(value.name) ||
      coerceUserName(value.username) ||
      coerceUserName(value.email) ||
      coerceUserName(value.id)
    );
  }

  let s = String(value).trim();
  if (!s) return "";

  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      const parsed = JSON.parse(s);
      const pick = coerceUserName(parsed);
      if (pick) return pick;
    } catch {}
  }

  const cacheHit = fromUserCache(s);
  if (cacheHit) return cacheHit;

  if (/^Basic\s+/i.test(s)) {
    try {
      const encoded = s.replace(/^Basic\s+/i, "");
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const [user] = decoded.split(":", 1);
      const fromAuth = coerceUserName(user);
      if (fromAuth) return fromAuth;
    } catch {}
  }

  if (looksLikeIp(s) || looksLikeUuid(s) || /^[0-9]+$/.test(s)) return "";

  return s;
}

export function resolveUserName(req) {
  const headers = req?.headers || {};
  const body = req?.body || {};

  const candidates = [
    req?.user,
    headers["x-user-display-name"],
    headers["x-user-name"],
    headers["x-remote-user"],
    headers["x-auth-user"],
    headers["x-user"],
    headers["x-user-id"],
    body?.createdBy,
    body?.created_by,
    body?.user,
    body?.userName,
    body?.username,
    body?.actor,
    headers.authorization,
  ];

  for (const cand of candidates) {
    const name = coerceUserName(cand);
    if (name) return name;
  }

  return "";
}

function normCell(v) {
  return String(v ?? "").replace(/\r?\n|\r/g, " ").trim();
}
function toCsvLine(headers, row, delim) {
  const esc = (s) => (s.includes(delim) || s.includes('"') ? `"${s.replaceAll('"','""')}"` : s);
  return headers.map(h => esc(normCell(row[h]))).join(delim) + "\n";
}

async function ensureCsv(file, headers, delim) {
  try {
    await fs.access(file);
    const txt = await fs.readFile(file, "utf8");
    const [first, ...rest] = txt.split(/\r?\n/);
    if (!first) {
      await fs.writeFile(file, headers.join(delim) + "\n", "utf8");
      if (rest.length) await fs.appendFile(file, rest.join("\n"), "utf8");
      return;
    }
    const hadBom = first.startsWith("\uFEFF");
    const headerLine = hadBom ? first.slice(1) : first;
    const have = headerLine.split(delim).map(s => s.trim());
    const want = [
      ...headers,
      ...have.filter(h => !headers.includes(h))
    ];
    const changed =
      want.length !== have.length ||
      want.some((value, index) => value !== have[index]);
    if (changed) {
      const outHeader = (hadBom ? "\uFEFF" : "") + want.join(delim);
      await fs.writeFile(file, [outHeader, ...rest].join("\n"), "utf8");
    }
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, headers.join(delim) + "\n", "utf8");
  }
}

/**
 * ZENTRAL: in JEDEM Board aufrufen.
 * - file: Pfad zur board-spezifischen CSV (bleibt getrennt)
 * - headers: board-spezifische Spalten (bleiben erhalten)
 * - payload: bereits "einmal" gebautes Objekt pro Board
 * - opts: { delim, autoTimestampField, autoUserField }
 */
export async function appendCsvRow(file, headers, payload, req, opts = {}) {
  const {
    delim = ";",
    autoTimestampField = (headers.includes("timestamp") ? "timestamp" :
                          headers.includes("Zeitpunkt") ? "Zeitpunkt" : null),
    autoUserField      = (headers.includes("user") ? "user" :
                          headers.includes("Benutzer") ? "Benutzer" : null),
  } = opts;

  await ensureCsv(file, headers, delim);

  const row = { ...payload };
  // Zeit automatisch
  if (autoTimestampField && !row[autoTimestampField]) {
    if (autoTimestampField === "Zeitpunkt") {
      const d = new Date(), p = n => String(n).padStart(2,"0");
      row.Zeitpunkt = `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    } else {
      row.timestamp = new Date().toISOString();
    }
  }
  // Benutzer automatisch
  if (autoUserField && !row[autoUserField]) {
    const u = resolveUserName(req);
    if (autoUserField === "Benutzer") row.Benutzer = u; else row.user = u;
  }

  await fs.appendFile(file, toCsvLine(headers, row, delim), "utf8");
}
