import fs from "fs";

export const CSV_HEADER = [
  "ZEITPUNKT","AKTION","NR","DRUCK","DATUM","ZEIT","ANGELEGT_VON","BENUTZER","EING","AUSG","KANAL",
  "AN/VON","INFORMATION","RUECKMELDUNG1","RUECKMELDUNG2","TYP",
  "ERGEHT_AN","ERGAENZUNG",
  "M1","V1","X1","M2","V2","X2","M3","V3","X3","M4","V4","X4","M5","V5","X5",
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
    actor = "",
    createdBy: createdByMeta
  } = meta;

  const u  = item?.uebermittlungsart || {};
  const ms = (item?.massnahmen || []).slice(0, 5);
  const M  = (i) => ms[i] || {};
  const ergehtAn = Array.isArray(item?.ergehtAn) ? item.ergehtAn.join(", ") : "";
  const createdBy = String(createdByMeta ?? item.createdBy ?? "");
  const benutzer = String(
    actor ||
    item.lastBy ||
    (Array.isArray(item.history) && item.history.length
      ? (item.history[item.history.length - 1].by || "")
      : "")
  );

  const cols = [
    new Date(timestamp || Date.now()).toISOString(),
    action,
    item.nr,
    Number(item?.printCount) > 0 ? "x" : "",

    item.datum ?? "",
    item.zeit ?? "",
    createdBy,
    benutzer,
    u.ein ? "x" : "",
    u.aus ? "x" : "",
    (u.kanalNr ?? u.kanal ?? u.art ?? ""),

    item.anvon ?? "",
    item.information ?? "",
    item.rueckmeldung1 ?? "",
    item.rueckmeldung2 ?? "",
    item.infoTyp ?? "",

    ergehtAn,
    item?.ergehtAnText ?? "",

    M(0).massnahme ?? "", M(0).verantwortlich ?? "", M(0).done ? "x" : "",
    M(1).massnahme ?? "", M(1).verantwortlich ?? "", M(1).done ? "x" : "",
    M(2).massnahme ?? "", M(2).verantwortlich ?? "", M(2).done ? "x" : "",
    M(3).massnahme ?? "", M(3).verantwortlich ?? "", M(3).done ? "x" : "",
    M(4).massnahme ?? "", M(4).verantwortlich ?? "", M(4).done ? "x" : "",

    item.id || "",
  ];
  return joinCsvRow(cols);
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

      records.push({
        item: snapshotItem,
        timestamp: entry?.ts ?? Date.now(),
        action: entry?.action ?? "",
        actor: entry?.by ?? "",
        createdBy: snapshotItem.createdBy ?? ""
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

  fs.writeFileSync(csvFile, lines.join("\r\n") + "\r\n", "utf8");
}

export function ensureCsvStructure(arr, csvFile) {
  try {
    const content = fs.readFileSync(csvFile, "utf8");
    const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
    if (firstLine.trim() !== CSV_HEADER.join(";")) {
      rewriteCsvFromJson(arr, csvFile);
    }
  } catch {
    const headerLine = CSV_HEADER.join(";") + "\r\n";
    fs.writeFileSync(csvFile, headerLine, "utf8");
    if (Array.isArray(arr) && arr.length) rewriteCsvFromJson(arr, csvFile);
  }
}
