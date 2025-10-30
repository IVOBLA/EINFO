import fsp from "fs/promises";
import path from "node:path";

export const AUFG_HEADERS = [
  "Zeitpunkt",
  "Rolle",
  "Benutzer",
  "Aktion",
  "Titel",
  "Typ",
  "Verantwortlich",
  "Von Status",
  "Nach Status",
  "Einsatz",
  "Notiz",
  "ID",
];

const ACTION_LABELS = new Map([
  ["create", "Angelegt"],
  ["edit", "Bearbeitet"],
  ["status", "Status geändert"],
  ["reorder", "Position geändert"],
  ["incident-assigned", "Einsatz zugeordnet"],
  ["incident-removed", "Einsatz entfernt"],
  ["incident-changed", "Einsatz geändert"],
]);

function clean(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function cleanNote(value) {
  if (value == null) return "";
  return String(value)
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIncidentId(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeIncidentTitle(value) {
  if (value == null) return "";
  return String(value).trim();
}

const LEGACY_HEADER_HINTS = new Set([
  "timestamp",
  "actor",
  "action",
  "title",
  "type",
  "responsible",
  "fromstatus",
  "tostatus",
  "beforeid",
  "meta",
  "note",
  "desc",
  "description",
  "role",
]);

const STATUS_TRANSLATIONS = new Map([
  ["new", "Neu"],
  ["neu", "Neu"],
  ["todo", "Neu"],
  ["open", "Neu"],
  ["in progress", "In Bearbeitung"],
  ["in_progress", "In Bearbeitung"],
  ["in bearbeitung", "In Bearbeitung"],
  ["doing", "In Bearbeitung"],
  ["bearbeitung", "In Bearbeitung"],
  ["done", "Erledigt"],
  ["completed", "Erledigt"],
  ["erledigt", "Erledigt"],
  ["fertig", "Erledigt"],
  ["finished", "Erledigt"],
]);

function parseCsvLine(line, delim = ";") {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsvRows(lines, delim = ";") {
  const rows = [];
  let buffer = "";
  let quoted = false;

  const pushRow = () => {
    if (!buffer || !buffer.trim()) {
      buffer = "";
      return;
    }
    rows.push(parseCsvLine(buffer, delim));
    buffer = "";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw == null ? "" : String(raw);
    if (!buffer && !line.trim()) continue;

    buffer = buffer ? `${buffer}\n${line}` : line;

    let localQuoted = quoted;
    for (let j = 0; j < line.length; j += 1) {
      if (line[j] === '"') {
        if (localQuoted) {
          if (line[j + 1] === '"') {
            j += 1;
          } else {
            localQuoted = false;
          }
        } else {
          localQuoted = true;
        }
      }
    }
    quoted = localQuoted;

    if (!quoted) pushRow();
  }

  if (buffer) pushRow();

  return rows;
}

function joinCsvRow(values) {
  return values
    .map((value) => {
      const raw = String(value ?? "");
      const normalized = raw.replace(/\r?\n/g, "\n");
      return normalized.includes(";") || normalized.includes('"') || /\n/.test(normalized)
        ? `"${normalized.replaceAll('"', '""')}"`
        : normalized;
    })
    .join(";");
}

function looksLikeLegacyHeader(headerLine) {
  const delim = headerLine.includes(";") ? ";" : ",";
  const parts = parseCsvLine(headerLine.replace(/^\uFEFF/, ""), delim);
  if (!parts.length) return false;
  return parts.some((p) => LEGACY_HEADER_HINTS.has(String(p || "").trim().toLowerCase()));
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function formatLegacyTimestamp(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{2}\.\d{2}\.\d{4}\s{2}\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  const num = Number(raw);
  const date = Number.isFinite(num) && num > 0 ? new Date(num) : new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}  ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }
  return raw;
}

function parseLooseMeta(str) {
  if (typeof str !== "string") return null;
  let trimmed = str.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    trimmed = trimmed.slice(1, -1);
  }
  const result = {};
  let depth = 0;
  let current = "";
  const entries = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      if (current.trim()) entries.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) entries.push(current.trim());

  for (const entry of entries) {
    let idx = entry.indexOf(":");
    if (idx < 0) idx = entry.indexOf("=");
    if (idx < 0) continue;
    const key = entry.slice(0, idx).trim().replace(/^"+|"+$/g, "").toLowerCase();
    if (!key) continue;
    let valueRaw = entry.slice(idx + 1).trim();
    if (!valueRaw) continue;
    if (valueRaw.startsWith("{") && valueRaw.endsWith("}")) {
      const nested = parseLooseMeta(valueRaw);
      if (nested) result[key] = nested;
      continue;
    }
    result[key] = valueRaw.replace(/^"+|"+$/g, "");
  }

  return Object.keys(result).length ? result : null;
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  let str = String(value).trim();
  if (!str) return null;
  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.slice(1, -1);
  }
  const attempts = [str, str.replace(/""/g, '"')];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return parseLooseMeta(str);
}

function toLookup(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (obj.__lookup instanceof Map) return obj;
  const lower = new Map();
  for (const [key, val] of Object.entries(obj)) {
    lower.set(key.toLowerCase(), val);
  }
  try {
    Object.defineProperty(obj, "__lookup", { value: lower, enumerable: false });
  } catch {
    obj.__lookup = lower;
  }
  return obj;
}

function gatherSources(...roots) {
  const sources = [];
  const queue = [...roots];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    const wrapped = toLookup(node);
    sources.push(wrapped);
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return sources;
}

function readValue(source, key) {
  if (!source || !key) return undefined;
  const normKey = String(key).trim();
  if (!normKey) return undefined;
  const direct = source[normKey];
  if (direct != null) return direct;
  if (source.__lookup?.has(normKey.toLowerCase())) {
    return source.__lookup.get(normKey.toLowerCase());
  }
  if (normKey.includes(".")) {
    const parts = normKey.split(".");
    let cur = source;
    for (const part of parts) {
      if (!cur) return undefined;
      cur = readValue(cur, part);
    }
    return cur;
  }
  for (const [prop, val] of Object.entries(source)) {
    if (prop.toLowerCase() === normKey.toLowerCase()) return val;
  }
  return undefined;
}

function getFirstValue(sources, keys = []) {
  for (const key of keys) {
    for (const source of sources) {
      const val = readValue(source, key);
      if (val != null && val !== "") return val;
    }
  }
  return "";
}

function translateStatus(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  return STATUS_TRANSLATIONS.get(lower) || raw;
}

function convertLegacyRecord(headers, values) {
  const record = {};
  headers.forEach((h, idx) => {
    record[h] = values[idx] ?? "";
  });
  const lookup = new Map(headers.map((h, idx) => [String(h).toLowerCase(), values[idx] ?? ""]));
  try {
    Object.defineProperty(record, "__lookup", { value: lookup, enumerable: false });
  } catch {
    record.__lookup = lookup;
  }

  const meta =
    parseMaybeJson(readValue(record, "meta")) ||
    parseMaybeJson(readValue(record, "Meta")) ||
    {};

  const sources = gatherSources(record, meta);

  const timestampRaw = getFirstValue(sources, ["Zeitpunkt", "timestamp", "time", "ts", "createdAt"]);
  const role = getFirstValue(sources, ["Rolle", "role", "board", "boardId", "roleId", "targetRole", "responsibleRole"]);
  const user = getFirstValue(sources, ["Benutzer", "actor", "user", "username", "userName", "createdBy", "by"]);
  const action = getFirstValue(sources, ["Aktion", "action", "event"]);
  const actionLabel = getFirstValue(sources, ["actionLabel", "aktion"]);
  const title = getFirstValue(sources, ["Titel", "title", "name"]);
  const type = getFirstValue(sources, ["Typ", "type", "category"]);
  const responsible = getFirstValue(sources, ["Verantwortlich", "responsible", "owner", "address", "adresse"]);
  const fromStatusRaw = getFirstValue(sources, ["Von Status", "fromStatus", "from", "previousStatus"]);
  const toStatusRaw = getFirstValue(sources, ["Nach Status", "toStatus", "status", "state", "nextStatus"]);
  const fromStatus = translateStatus(fromStatusRaw);
  const toStatus = translateStatus(toStatusRaw);
  let noteRaw = getFirstValue(sources, ["Notiz", "note", "notes", "desc", "beschreibung", "description", "details"]);
  if (!noteRaw) {
    const metaString = readValue(record, "meta");
    if (typeof metaString === "string" && metaString.trim()) noteRaw = metaString;
  }
  const id = getFirstValue(sources, ["ID", "id", "cardId", "itemId", "taskId", "_id", "key"]);

  const incidentId = getFirstValue(sources, [
    "relatedIncidentId",
    "incidentId",
    "incidentID",
    "incident.id",
    "incident.referenceId",
    "einsatzId",
  ]);
  const incidentTitle = getFirstValue(sources, [
    "incidentTitle",
    "incident.title",
    "incident.name",
    "incident.label",
    "einsatz",
  ]);

  const payload = buildAufgabenLog({
    role,
    user,
    action,
    actionLabel,
    item: {
      title,
      type,
      responsible,
      status: toStatus,
      desc: noteRaw,
      id,
      relatedIncidentId: incidentId,
      incidentTitle,
    },
    fromStatus,
    toStatus,
    relatedIncidentId: incidentId,
    relatedIncidentTitle: incidentTitle,
    note: noteRaw,
  });

  payload.Zeitpunkt = formatLegacyTimestamp(timestampRaw);
  if (!payload.Rolle) payload.Rolle = clean(role || responsible || "");
  if (!payload.Benutzer) payload.Benutzer = clean(user || "");
  if (!payload.Einsatz && (incidentId || incidentTitle)) {
    payload.Einsatz = formatIncidentValue(incidentId, incidentTitle);
  }
  if (!payload.Notiz && noteRaw) payload.Notiz = cleanNote(noteRaw);
  if (!payload.ID) payload.ID = clean(id || "");
  return payload;
}

function translateAction(action, fallback = "") {
  if (!action) return clean(fallback);
  const key = String(action).toLowerCase();
  if (ACTION_LABELS.has(key)) return ACTION_LABELS.get(key) || "";
  return clean(fallback || action);
}

function formatIncidentValue(idRaw, titleRaw) {
  const id = normalizeIncidentId(idRaw);
  const title = normalizeIncidentTitle(titleRaw);
  if (title && id) return `${title} (#${id})`;
  if (title) return title;
  if (id) return `#${id}`;
  return "";
}

export function buildAufgabenLog({
  role = "",
  user = "",
  action = "",
  actionLabel,
  item = {},
  fromStatus = "",
  toStatus = "",
  relatedIncidentId,
  relatedIncidentTitle,
  note,
} = {}) {
  const normalized = item || {};
  const statusFrom = clean(fromStatus || normalized.fromStatus || "");
  const statusTo = clean(toStatus || normalized.status || "");
  const incidentId =
    relatedIncidentId !== undefined
      ? relatedIncidentId
      : normalized.relatedIncidentId ?? normalized.meta?.relatedIncidentId ?? "";
  const incidentTitle =
    relatedIncidentTitle !== undefined
      ? relatedIncidentTitle
      : normalized.incidentTitle ?? normalized.meta?.incidentTitle ?? "";

  const payload = {
    Rolle: clean(role || normalized.role || ""),
    Aktion: clean(actionLabel) || translateAction(action),
    Titel: clean(normalized.title ?? normalized.name ?? normalized.typ ?? "Aufgabe"),
    Typ: clean(normalized.type ?? normalized.category ?? normalized.typ ?? ""),
    Verantwortlich: clean(
      normalized.responsible ??
        normalized.verantwortlich ??
        normalized.owner ??
        normalized.address ??
        ""
    ),
    "Von Status": statusFrom,
    "Nach Status": statusTo,
    Einsatz: formatIncidentValue(incidentId, incidentTitle),
    Notiz: cleanNote(note !== undefined ? note : normalized.desc ?? normalized.notes ?? normalized.beschreibung ?? ""),
    ID: clean(normalized.id ?? normalized._id ?? normalized.key ?? ""),
  };

  if (!payload.Titel) payload.Titel = "Aufgabe";
  if (user) payload.Benutzer = clean(user);

  return payload;
}

export function detectIncidentChange(prev = {}, next = {}) {
  const prevId = normalizeIncidentId(prev?.relatedIncidentId ?? prev?.meta?.relatedIncidentId ?? "");
  const nextId = normalizeIncidentId(next?.relatedIncidentId ?? next?.meta?.relatedIncidentId ?? "");
  const prevTitle = normalizeIncidentTitle(prev?.incidentTitle ?? prev?.meta?.incidentTitle ?? "");
  const nextTitle = normalizeIncidentTitle(next?.incidentTitle ?? next?.meta?.incidentTitle ?? "");

  const hasPrev = !!(prevId || prevTitle);
  const hasNext = !!(nextId || nextTitle);

  if (!hasPrev && !hasNext) return null;
  if (prevId === nextId && prevTitle === nextTitle) return null;

  if (!hasPrev && hasNext) {
    return { type: "incident-assigned", id: nextId, title: nextTitle };
  }

  if (hasPrev && !hasNext) {
    return { type: "incident-removed", id: prevId, title: prevTitle };
  }

  return {
    type: "incident-changed",
    id: nextId || prevId,
    title: nextTitle || prevTitle,
  };
}

export async function ensureAufgabenLogFile(file) {
  const header = AUFG_HEADERS.join(";");
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    const txt = await fsp.readFile(file, "utf8");
    const lines = txt.split(/\r?\n/);
    if (!lines.length) {
      await fsp.writeFile(file, header + "\n", "utf8");
      return;
    }
    const first = (lines[0] || "").replace(/^\uFEFF/, "");
    if (first === header) return;
    if (looksLikeLegacyHeader(first)) {
      const delim = first.includes(";") ? ";" : ",";
      const headers = parseCsvLine(first, delim);
      const migrated = [header];
      const records = parseCsvRows(lines.slice(1), delim);
      for (const values of records) {
        const payload = convertLegacyRecord(headers, values);
        migrated.push(joinCsvRow(AUFG_HEADERS.map((h) => payload[h])));
      }
      await fsp.writeFile(file, migrated.join("\n") + "\n", "utf8");
      return;
    }
    lines[0] = header;
    await fsp.writeFile(file, lines.join("\n"), "utf8");
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
    await fsp.writeFile(file, header + "\n", "utf8");
  }
}
