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
    lines[0] = header;
    await fsp.writeFile(file, lines.join("\n"), "utf8");
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
    await fsp.writeFile(file, header + "\n", "utf8");
  }
}
