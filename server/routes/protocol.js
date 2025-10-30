// server/routes/protocol.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { randomUUID } from "crypto";
import { resolveUserName } from "../auditLog.mjs";
import { ensureTaskForRole } from "../utils/tasksService.mjs";
import { CSV_HEADER, ensureCsvStructure, rewriteCsvFromJson } from "../utils/protocolCsv.mjs";

const isLage = v => /^(lage|lagemeldung)$/i.test(String(v || ""));
const infoText = x => String(x?.information ?? x?.INFORMATION ?? x?.beschreibung ?? x?.text ?? x?.ERGAENZUNG ?? "").trim();
const taskType = x => /^(auftrag|lage|lagemeldung)$/i.test(String(x?.infoTyp ?? x?.TYP ?? x?.type ?? ""));

const trimRoleLabel = (value) => String(value ?? "").trim();
const canonicalRoleId = (value) => {
  const raw = trimRoleLabel(value);
  if (!raw) return "";
  const match = raw.match(/\b(S[1-6]|EL|LTSTB)\b/i);
  if (match) return match[1].toUpperCase();
  return raw.replace(/\s+/g, "").toUpperCase();
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
   if (Array.isArray(x?.verantwortliche)) x.verantwortliche.forEach(r => set.add(String(r).trim()));
   // 2) "ergehtAn" (Array oder String)
   if (Array.isArray(x?.ergehtAn)) x.ergehtAn.forEach(r => set.add(String(r).trim()));
   const bucket = String(x?.ergehtAn ?? x?.ERGEHT_AN ?? "").trim();
   if (bucket) bucket.split(/[,;|]/).map(s => s.trim()).filter(Boolean).forEach(r => set.add(r));
   // 3) Maßnahmen-Verantwortliche
   (x?.massnahmen || []).forEach(m => { if (m?.verantwortlich) set.add(String(m.verantwortlich).trim()); });
   return [...set].filter(Boolean);
 };

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ► Datenpfad: standardmäßig ../data (also server/data), nicht routes/data
const SERVER_DIR = path.resolve(__dirname, "..");
const DATA_DIR   = path.resolve(SERVER_DIR, "data");   // => <repo>/server/data
const CSV_FILE   = path.join(DATA_DIR, "protocol.csv");
const JSON_FILE  = path.join(DATA_DIR, "protocol.json");

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
    if (typeof it.createdBy === "undefined") {
      const creatorFromHistory = it.history.find?.(h => h?.action === "create" && h?.by)?.by;
      it.createdBy = creatorFromHistory || it.lastBy || null;
      changed = true;
    }
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
  ensureCsvStructure(arr, CSV_FILE);
  return arr;
}
function writeAllJson(arr) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(arr, null, 2), "utf8");
}
function nextNr(arr) {
  const max = arr.reduce((m, x) => Math.max(m, Number(x?.nr) || 0), 0);
  return max + 1;
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
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="protocol.csv"');
    const buf = fs.readFileSync(CSV_FILE);
    res.send(buf);
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
router.post("/", express.json(), async (req, res) => {
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
    const userBy = resolveUserName(req);
    payload.createdBy = userBy;
    payload.history.push({
      ts: Date.now(),
      action: "create",
      by: userBy,
      after: snapshotForHistory(payload)
    });
    payload.lastBy = userBy;        // <-- für CSV-BENUTZER
    all.push(payload);

    writeAllJson(all);
    rewriteCsvFromJson(all, CSV_FILE);
// Ergänzung: Aufgaben je Verantwortlicher (nur Auftrag/Lage)
try {
  if (taskType(payload)) {
    const actor = resolveUserName(req);
    const { roles, desc } = collectMeasureRoles(payload);
    const type = payload?.infoTyp ?? "";

    for (const { label, title } of roles.values()) {
      await ensureTaskForRole({
        roleId: label,
        responsibleLabel: label,
        protoNr: payload.nr,
        actor,
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
	res.json({ ok: true, nr, id: payload.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Update
router.put("/:nr", express.json(), async (req, res) => {
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

    const existingCreator =
      existing.createdBy ??
      existing.history?.find?.((h) => h?.action === "create" && h?.by)?.by ??
      existing.lastBy ??
      null;
    next.createdBy = existingCreator;

    // 🔁 Reset: jedes Update setzt das Druck-Flag zurück
    next.printCount = 0;

    const userBy  = resolveUserName(req);
    const changes = computeDiff(existing, next);
    if (changes.length) {
      next.history = [
        ...next.history,
        { ts: Date.now(), action: "update", by: userBy, changes, after: snapshotForHistory(next) }
      ];
    }
    next.lastBy = userBy;     // <-- für CSV-BENUTZER

    all[idx] = next;
    writeAllJson(all);
    rewriteCsvFromJson(all, CSV_FILE);
 // Ergänzung: neu hinzugekommene Verantwortliche ==> Aufgaben nachziehen
 try{
   if (taskType(next)) {
     const actor = userBy;
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
         item: {
           title: fallbackTitle,
           type,
           desc: text,
           meta: { source: "protokoll", protoNr: next.nr }
         }
       });
     }

     // Sonderregel bei Updates: Typ=Lage & Eingang & An/Von ≠ "S2"
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
    res.json({ ok: true, nr, id: next.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
