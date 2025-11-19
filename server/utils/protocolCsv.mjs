import fs from "fs";

const CSV_BOM = "\uFEFF";

export const CSV_HEADER = [
  "ZEITPUNKT","AKTION","PROTOKOLL-NR","ZU","DRUCK","DATUM","ZEIT","BENUTZER","EING","AUSG","KANAL",
  "AN/VON","INFORMATION","RUECKMELDUNG1","TYP",
  "ERGEHT_AN","ERGAENZUNG",
  "M1","V1","X1","M2","V2","X2","M3","V3","X3","M4","V4","X4","M5","V5","X5","BESTÄTIGT_DURCH",
  "ID"
];

export function joinCsvRow(cols) {
  return cols.map((c) => {
    const raw = String(c ?? "");
    const s = raw.replace(/\r?\n/g, "\r\n");
    return (s.includes(";") || s.includes('"') || s.includes("\r\n"))
      ? `"${s.replaceAll('"', '""')}"`
      : s;
  }).join(";");
}

export function toCsvRow(item, meta = {}) {
  const {
    timestamp = Date.now(),
    action = "",
    createdBy: createdByMeta,
    actor,
    confirmedBy = ""      // ← NEU: Bestätiger (nur bei Bestätigungs-Änderung)
  } = meta;

  const u  = item?.uebermittlungsart || {};
  const ms = (item?.massnahmen || []).slice(0, 5);
  const M  = (i) => ms[i] || {};
  const ergehtAn = Array.isArray(item?.ergehtAn) ? item.ergehtAn.join(", ") : "";
 // Bei "create": Creator, sonst Actor (letzter Änderer)
 const createdBy = String(
   action === "create"
     ? (createdByMeta ?? item.createdBy ?? "")
     : (actor ?? createdByMeta ?? item.createdBy ?? "")
 );

  const cols = [
 new Intl.DateTimeFormat("de-AT", {
   year: "numeric", month: "2-digit", day: "2-digit",
   hour: "2-digit", minute: "2-digit", second: "2-digit",
   hour12: false
 }).format(new Date(timestamp || Date.now())),
    action,
    item.nr,
    item.zu ?? "",
    Number(item?.printCount) > 0 ? "x" : "",

    item.datum ?? "",
    item.zeit ?? "",
    createdBy,
    u.ein ? "x" : "",
    u.aus ? "x" : "",
    (u.kanalNr ?? u.kanal ?? u.art ?? ""),

    item.anvon ?? "",
    item.information ?? "",
    item.rueckmeldung1 ?? "",
    item.infoTyp ?? "",

    ergehtAn,
    item?.ergehtAnText ?? "",

    M(0).massnahme ?? "", M(0).verantwortlich ?? "", M(0).done ? "x" : "",
    M(1).massnahme ?? "", M(1).verantwortlich ?? "", M(1).done ? "x" : "",
    M(2).massnahme ?? "", M(2).verantwortlich ?? "", M(2).done ? "x" : "",
    M(3).massnahme ?? "", M(3).verantwortlich ?? "", M(3).done ? "x" : "",
    M(4).massnahme ?? "", M(4).verantwortlich ?? "", M(4).done ? "x" : "",
	confirmedBy || "",         // ← NEU: nur befüllt, wenn eine Bestätigung geändert wurde
    item.id || "",
  ];
  return joinCsvRow(cols);
}

function ensureCsvHeader(csvFile) {
  const header = CSV_HEADER.join(";");
  const headerLine = `${header}\r\n`;
  if (!fs.existsSync(csvFile)) {
    fs.writeFileSync(csvFile, CSV_BOM + headerLine, "utf8");
    return;
  }

  try {
    const content = fs.readFileSync(csvFile, "utf8");
    const [firstLine = "", ...rest] = content.split(/\r?\n/);
    const normalizedFirst = firstLine.replace(/^\uFEFF/, "").trim();
    const hasBom = firstLine.startsWith(CSV_BOM);
    if (normalizedFirst === header && hasBom) return;

    const remaining = rest.join("\n").replace(/^\uFEFF/, "").replace(/\r?\n/g, "\r\n");
    const rebuiltBody = [header, remaining].filter(Boolean).join("\r\n");
    const suffix = rebuiltBody.endsWith("\r\n") ? "" : "\r\n";
    fs.writeFileSync(csvFile, CSV_BOM + rebuiltBody + suffix, "utf8");
  } catch {
    fs.writeFileSync(csvFile, CSV_BOM + headerLine, "utf8");
  }
}

function entryToRecord(item, entry) {
  if (!item || !entry) return null;

 // Bestätigungsänderung + Zustand NACH der Änderung
  const isConfirmChange = Array.isArray(entry?.changes)
    && entry.changes.some(ch => String(ch?.path || "").startsWith("otherRecipientConfirmation"));


  const snapshot = (entry?.after && typeof entry.after === "object")
    ? entry.after
    : item;
	
  const isConfirmedAfter = !!snapshot?.otherRecipientConfirmation?.confirmed;	

  const snapshotItem = {
    ...item,
    ...snapshot,
    nr: item.nr,
    id: item.id,
  };

  const createdBy = snapshotItem.createdBy ?? item.createdBy ?? null;

  return {
    item: snapshotItem,
    meta: {
      timestamp: Number(entry?.ts) || Date.now(),
      action: entry?.action ?? "",
      actor: entry?.by ?? "",
      createdBy,
      confirmedBy: (isConfirmChange && isConfirmedAfter)
        ? (entry?.by || snapshotItem?.otherRecipientConfirmation?.by || "")
        : ""   // ← bei Entfernen der Bestätigung bleibt die Spalte leer
    },
  };
}

export function appendHistoryEntriesToCsv(item, entries, csvFile) {
  if (!csvFile || !item) return;
  const list = Array.isArray(entries) ? entries : [];
  const records = list
    .map((entry) => entryToRecord(item, entry))
    .filter(Boolean);

  if (!records.length) return;

  ensureCsvHeader(csvFile);
  const lines = records.map(({ item: rowItem, meta }) => toCsvRow(rowItem, meta));
  fs.appendFileSync(csvFile, lines.join("\r\n") + "\r\n", "utf8");
}

export function rewriteCsvFromJson(arr, csvFile) {
  const list = Array.isArray(arr) ? arr : [];
  const records = [];

  for (const item of list) {
    const historyEntries = Array.isArray(item.history) ? item.history : [];
    if (!historyEntries.length) {
      records.push({
        item,
        timestamp: Date.now(),
        action: "snapshot",
        actor: item.lastBy || "",
        createdBy: item.createdBy ?? ""
      });
      continue;
    }

    for (const entry of historyEntries) {
      const snapshot = (entry?.after && typeof entry.after === "object")
        ? entry.after
        : item;

      const creator = item.createdBy ?? snapshot?.createdBy ?? null;
      const snapshotItem = {
        ...item,
        ...snapshot,
        nr: item.nr,
        id: item.id,
        createdBy: creator
      };

      const confirmChange = Array.isArray(entry?.changes)
        && entry.changes.some(ch => String(ch?.path || "").startsWith("otherRecipientConfirmation"));
      records.push({
        item: snapshotItem,
        timestamp: entry?.ts ?? Date.now(),
        action: entry?.action ?? "",
        actor: entry?.by ?? "",
        createdBy: snapshotItem.createdBy ?? "",
        confirmedBy: (confirmChange && confirmedAfter)
          ? (entry?.by || snapshotItem?.otherRecipientConfirmation?.by || "")
          : ""   // ← bei „Bestätigung entfernt“ wird die Spalte geleert
      });
    }
  }

  records.sort((a, b) => {
    const ta = Number(a.timestamp) || 0;
    const tb = Number(b.timestamp) || 0;
    if (ta !== tb) return ta - tb;
    const na = Number(a?.item?.nr) || 0;
    const nb = Number(b?.item?.nr) || 0;
    return na - nb;
  });

  const lines = [
    CSV_HEADER.join(";"),
    ...records.map(({ item, ...meta }) => toCsvRow(item, meta))
  ];

  let content = CSV_BOM + lines.join("\r\n");
  if (!content.endsWith("\r\n")) content += "\r\n";
  fs.writeFileSync(csvFile, content, "utf8");
}

export function ensureCsvStructure(arr, csvFile) {
  try {
    const content = fs.readFileSync(csvFile, "utf8");
    const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
    const normalizedFirst = firstLine.replace(/^\uFEFF/, "").trim();
    const hasBom = firstLine.startsWith(CSV_BOM);
    if (normalizedFirst !== CSV_HEADER.join(";") || !hasBom) {
      rewriteCsvFromJson(arr, csvFile);
    }
  } catch {
    const headerLine = CSV_HEADER.join(";") + "\r\n";
    fs.writeFileSync(csvFile, CSV_BOM + headerLine, "utf8");
    if (Array.isArray(arr) && arr.length) rewriteCsvFromJson(arr, csvFile);
  }
}
