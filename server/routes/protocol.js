// server/routes/protocol.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { randomUUID } from "crypto";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ► Datenpfad: standardmäßig ../data (also server/data), nicht routes/data
const SERVER_DIR = path.resolve(__dirname, "..");
const DATA_DIR   = process.env.KANBAN_DATA_DIR || path.join(SERVER_DIR, "data");
const CSV_FILE   = path.join(DATA_DIR, "protocol.csv");
const JSON_FILE  = path.join(DATA_DIR, "protocol.json");

// ==== CSV: Spalten ====
// ID ist letzte Spalte; umbenennungen: Eingang/Ausgang/Kanal/AN/VON/TYP
const CSV_HEADER = [
  "NR", "GEDRUCKT",
  "DATUM", "ZEIT",
  "Eingang", "Ausgang", "Kanal",
  "AN/VON", "INFORMATION", "RUECKMELDUNG_1", "RUECKMELDUNG_2", "TYP",
  "ERGEHT_AN", "ERGEHT_AN_FREI",
  "M1_Text", "M1_Verantwortlich", "M1_Done",
  "M2_Text", "M2_Verantwortlich", "M2_Done",
  "M3_Text", "M3_Verantwortlich", "M3_Done",
  "M4_Text", "M4_Verantwortlich", "M4_Done",
  "M5_Text", "M5_Verantwortlich", "M5_Done",
  "ID", // ← letzte Spalte
];

// ==== Files sicherstellen ====
function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(JSON_FILE)) fs.writeFileSync(JSON_FILE, "[]", "utf8");
  if (!fs.existsSync(CSV_FILE)) {
    // CRLF-Zeilenende für maximale Excel-Kompatibilität
    fs.writeFileSync(CSV_FILE, CSV_HEADER.join(";") + "\r\n", "utf8");
  }
}

// Migration: id + printCount + history ergänzen
function migrateMeta(arr) {
  let changed = false;
  for (const it of arr) {
    if (!it.id) { it.id = randomUUID(); changed = true; }
    if (typeof it.printCount !== "number") { it.printCount = 0; changed = true; }
    if (!Array.isArray(it.history)) { it.history = []; changed = true; }
  }
  return changed;
}

function readAllJson() {
  ensureFiles();
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(JSON_FILE, "utf8")); }
  catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  if (migrateMeta(arr)) fs.writeFileSync(JSON_FILE, JSON.stringify(arr, null, 2), "utf8");
  return arr;
}
function writeAllJson(arr) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(arr, null, 2), "utf8");
}
function nextNr(arr) {
  const max = arr.reduce((m, x) => Math.max(m, Number(x?.nr) || 0), 0);
  return max + 1;
}

// CSV: robustes Quoting + CRLF normalisieren (auch innerhalb von Feldern)
function joinCsvRow(cols) {
  return cols.map((c) => {
    const raw = String(c ?? "");
    // Excel erwartet CRLF (\r\n) sowohl als Record-Separator als auch innerhalb gequoteter Felder
    const s = raw.replace(/\r?\n/g, "\r\n");
    return (s.includes(";") || s.includes('"') || s.includes("\r\n"))
      ? `"${s.replaceAll('"', '""')}"`
      : s;
  }).join(";");
}

function toCsvRow(item) {
  const u  = item?.uebermittlungsart || {};
  const ms = (item?.massnahmen || []).slice(0, 5);
  const M  = (i) => ms[i] || {};
  const ergehtAn = Array.isArray(item?.ergehtAn) ? item.ergehtAn.join(", ") : "";

  const cols = [
    item.nr,
    Number(item?.printCount) > 0 ? "x" : "",

    item.datum ?? "",
    item.zeit ?? "",
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

    item.id || "", // ID als letzte Spalte
  ];
  return joinCsvRow(cols);
}

function rewriteCsvFromJson(arr) {
  const lines = [
    CSV_HEADER.join(";"),
    ...arr.sort((a, b) => (a.nr || 0) - (b.nr || 0)).map(toCsvRow),
  ];
  // CRLF zwischen Records
  fs.writeFileSync(CSV_FILE, lines.join("\r\n") + "\r\n", "utf8");
}

// ----- History-Helfer --------------------------------------------------------
const HIST_IGNORE = new Set(["id", "nr", "printCount", "history"]);
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

// ---------- API ----------

// CSV-Download (Route vor '/:nr')
router.get("/csv/file", (_req, res) => {
  try {
    ensureFiles();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="protocol.csv"');
    res.sendFile(CSV_FILE);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Liste
router.get("/", (_req, res) => {
  try {
    res.json({ ok: true, items: readAllJson() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Detail
router.get("/:nr", (req, res) => {
  try {
    const nr  = Number(req.params.nr);
    const all = readAllJson();
    const it  = all.find(x => Number(x.nr) === nr);
    if (!it) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, item: it });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Neu
router.post("/", express.json(), (req, res) => {
  try {
    const all = readAllJson();
    const nr  = nextNr(all);
    const payload = {
      ...(req.body || {}),
      nr,
      id: randomUUID(),
      printCount: 0,
      history: []
    };
    payload.history.push({
      ts: Date.now(),
      action: "create",
      by: req.ip || "",
      after: snapshotForHistory(payload)
    });
    all.push(payload);
    writeAllJson(all);
    rewriteCsvFromJson(all);
    res.json({ ok: true, nr, id: payload.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Update
router.put("/:nr", express.json(), (req, res) => {
  try {
    const nr  = Number(req.params.nr);
    const all = readAllJson();
    const idx = all.findIndex(x => Number(x.nr) === nr);
    if (idx < 0) return res.status(404).json({ ok: false, error: "Not found" });

    const existing = all[idx];

    const next = {
      ...existing,
      ...(req.body || {}),
      nr,
      id: existing.id,
      history: existing.history || []
    };

    // 🔁 Reset: jedes Update setzt das Druck-Flag zurück
    next.printCount = 0;

    const changes = computeDiff(existing, next);
    if (changes.length) {
      next.history = [
        ...next.history,
        { ts: Date.now(), action: "update", by: req.ip || "", changes, after: snapshotForHistory(next) }
      ];
    }

    all[idx] = next;
    writeAllJson(all);
    rewriteCsvFromJson(all);
    res.json({ ok: true, nr, id: next.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
