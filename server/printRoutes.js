// server/printRoutes.js  (ESM)
import express from "express";
import fs from "fs/promises";
import fss from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { appendHistoryEntriesToCsv } from "./utils/protocolCsv.mjs";
import { resolveUserName } from "./auditLog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Gemeinsamer Daten-Root (wie in protocol.js)
const DATA_ROOT = process.env.KANBAN_DATA_DIR || path.join(__dirname, "data");
// PDFs hierhin speichern:
const PDF_DIR   = path.join(DATA_ROOT, "prints");
await fs.mkdir(PDF_DIR, { recursive: true });

// Protokoll-Daten (JSON) für Autosave/History
const JSON_FILE = path.join(DATA_ROOT, "protocol.json");
const CSV_FILE  = path.join(DATA_ROOT, "protocol.csv");

// immer mindestens eine Zusatzkopie
const EXTRA_COPIES = 1;
const EXTRA_COPY_LABEL = "Archiv";

const router = express.Router();

const CONFIRM_ROLE_INFO = {
  LTSTB: { label: "LtStb", description: "Leiter Stab" },
  LTSTBSTV: { label: "LtStbStv", description: "Stellv. Leiter Stab" },
  S3: { label: "S3", description: null },
};
const DEFAULT_CONFIRM_TEXT = (() => {
  const info = CONFIRM_ROLE_INFO.LTSTB;
  if (!info) return "LtStb (Leiter Stab)";
  return info.description ? `${info.label} (${info.description})` : info.label;
})();

const PRINT_HISTORY_ACTION = "print";

function canonicalRoleId(raw) {
  return String(raw ?? "").trim().toUpperCase();
}

function confirmRoleDisplay(raw) {
  const role = canonicalRoleId(raw);
  const info = CONFIRM_ROLE_INFO[role];
  if (!info) return role || DEFAULT_CONFIRM_TEXT;
  return info.description ? `${info.label} (${info.description})` : info.label;
}

function formatConfirmTimestamp(value) {
  if (value === null || value === undefined) return "";
  if (Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.valueOf())) return d.toLocaleString("de-DE");
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const d = new Date(numeric);
    if (!Number.isNaN(d.valueOf())) return d.toLocaleString("de-DE");
  }
  const d = new Date(value);
  if (!Number.isNaN(d.valueOf())) return d.toLocaleString("de-DE");
  return "";
}

// ---------- Helpers ----------
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function yes(b) { return b ? "☑" : "☐"; }
const fmt = (s) => String(s ?? "");
const parseAnvon = (raw) => {
  const s = String(raw || "").trim();
  if (/^an\s*:/i.test(s)) return { dir: "an",  name: s.replace(/^an\s*:/i, "").trim() };
  if (/^von\s*:/i.test(s)) return { dir: "von", name: s.replace(/^von\s*:/i, "").trim() };
  return { dir: "", name: s };
};

async function readAll() {
  try { const t = await fs.readFile(JSON_FILE, "utf8"); const arr = JSON.parse(t); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
async function writeAll(arr) { await fs.writeFile(JSON_FILE, JSON.stringify(arr, null, 2), "utf8"); }

function stripHistoryForSnapshot(src) {
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

function normalizePrintCount(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sumPrintHistory(history) {
  if (!Array.isArray(history)) return 0;
  return history.reduce((total, entry) => {
    if (!entry || entry.action !== PRINT_HISTORY_ACTION) return total;
    const value = Number(entry.printCount ?? entry.pages ?? 0);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

// History/Autosave nach dem Druck
async function recordPrint(nr, recipients, pages, fileName, by, latestSnapshotFromClient) {
  const all = await readAll();
  const idx = all.findIndex(x => Number(x.nr) === Number(nr));
  let csvItem = null;
  let csvEntries = [];
  const printCount = normalizePrintCount(pages, Array.isArray(recipients) ? recipients.length : 0);

  if (idx < 0) {
    const base = latestSnapshotFromClient && typeof latestSnapshotFromClient === "object" ? { ...latestSnapshotFromClient } : {};
    const baseHistory = Array.isArray(base.history) ? [...base.history] : [];
    delete base.history;
    delete base.printCount;
    const entry = {
      ts: Date.now(),
      action: PRINT_HISTORY_ACTION,
      by,
      recipients,
      pages: printCount,
      printCount,
      fileName,
      after: null,
    };
    const history = [...baseHistory, entry];
    const it = {
      ...base,
      nr: Number(nr),
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
      history,
    };
    it.printCount = sumPrintHistory(it.history);
    entry.after = stripHistoryForSnapshot(it);
    csvItem = it;
    csvEntries = it.history.slice(-1);
    all.push(it);
  } else {
    const ex = all[idx];
    const latest = latestSnapshotFromClient && typeof latestSnapshotFromClient === "object" ? latestSnapshotFromClient : {};
    const baseHistory = Array.isArray(ex.history) ? [...ex.history] : [];
    const merged = { ...ex, ...latest, nr: ex.nr, id: ex.id };
    merged.history = baseHistory;
    const entry = {
      ts: Date.now(),
      action: PRINT_HISTORY_ACTION,
      by,
      recipients,
      pages: printCount,
      printCount,
      fileName,
      after: null,
    };
    merged.history = [...merged.history, entry];
    merged.printCount = sumPrintHistory(merged.history);
    entry.after = stripHistoryForSnapshot(merged);
    csvItem = merged;
    csvEntries = merged.history.slice(-1);
    all[idx] = merged;
  }
  await writeAll(all);
  if (csvItem && csvEntries.length) {
    appendHistoryEntriesToCsv(csvItem, csvEntries, CSV_FILE);
  }
}

// ---------- HTML/CSS ----------
function sheetHtml(item, recipient, nr) {
  const u = item?.uebermittlungsart || {};
  const { dir } = parseAnvon(item?.anvon || "");
  const mass = Array.isArray(item?.massnahmen) ? item.massnahmen : [];
  const ergehtSet = new Set(Array.isArray(item?.ergehtAn) ? item.ergehtAn : []);
  const EA = ["EL","LtStb","S1","S2","S3","S4","S5","S6"];
  const displayNr = !nr || nr === "blank" ? "" : nr;
  const confirm = item?.otherRecipientConfirmation && typeof item.otherRecipientConfirmation === "object"
    ? item.otherRecipientConfirmation
    : null;
  const confirmActive = !!confirm?.confirmed;
  let confirmText = "";
  if (confirmActive) {
    const roleId = canonicalRoleId(confirm?.byRole);
    const roleInfo = CONFIRM_ROLE_INFO[roleId];
    const roleText = roleInfo?.description || roleInfo?.label || confirmRoleDisplay(confirm?.byRole);
    const name = fmt(confirm?.by).trim();
    let line = name;
    if (roleText) {
      line = line ? `${line} (${roleText})` : roleText;
    }
    const time = formatConfirmTimestamp(confirm?.at);
    confirmText = line ? `Bestätigt durch: ${line}` : "Bestätigt";
    if (time) {
      confirmText = `${confirmText} – ${time}`;
    }
  } else {
    confirmText = `Bestätigt durch: ${DEFAULT_CONFIRM_TEXT}`;
  }
  const confirmHtml = confirmText
    ? `<div class="ea-confirm${confirmActive ? " ea-confirm--active" : ""}"><span class="ea-confirm-text">${esc(confirmText)}</span></div>`
    : "";
  const confirmSection = confirmHtml ? `<div class=\"cell\">${confirmHtml}</div>` : "";

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/>
<title>Protokoll ${nr}</title>
<style>
  @page { size: A4; margin: 6mm; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  .sheet { border: 2px solid #111; border-radius: 10px; padding: 10px; }
  .header { display:grid; grid-template-columns: 9fr 3fr; }
  .title { font-weight: 800; font-size: 22px; letter-spacing:.5px; padding:12px; }
  .nrbox { border-left: 2px solid #111; }
  .nrbox .lbl { font-size: 12px; color:#555; border-bottom:2px solid #111; padding:6px 10px; }
  .nrbox .val { font-size: 26px; text-align:center; padding:14px 10px; font-weight:800; min-height: 30px; }

  /* Grids */
  .row3 { display: grid; grid-template-columns: 6fr 4fr 3fr; column-gap: 8px; } /* 3-spaltig */
  .row  { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8px; }     /* 2-spaltig */

  .cell  { border-top: 2px solid #111; padding: 6px; }
  .label { font-size: 12px; color: #555; margin-bottom: 4px; }
  .input { border:1px solid #999; border-radius:6px; padding:6px 8px; min-height: 28px; }

  .mh160 { min-height: 240px; }
  .mh100 { min-height: 42px; }

  .tgrid { display:grid; grid-template-columns: 6fr 5fr 1fr; }
  .tgrid .cell { padding:4px 6px; font-size:12px; line-height:1.3; }
  .thead { background:#f1f5f9; font-weight:600; }
  .thead .cell { font-size:11px; text-transform:uppercase; letter-spacing:.4px; }
  .chk   { text-align:center; display:flex; align-items:center; justify-content:center; }
  .pb    { page-break-after: always; }

  .vstack { display:flex; flex-direction:column; gap:6px; }

  /* An/Von */
  .anvon-row { display:grid; grid-template-columns:auto 1fr; align-items:start; column-gap:10px; }
  .anvon-radios { display:flex; flex-direction:column; gap:6px; white-space:nowrap; line-height:20px; }

  .pre { white-space: pre-wrap; overflow-wrap: anywhere; }

  .ea-row   { display:grid; grid-template-columns: 1fr 300px; column-gap: 8px; align-items:center; }
  .ea-left  { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size: 11px; }
  .ea-left span { display:inline-flex; align-items:center; gap:4px; }
  .ea-right { display:flex; align-items:center; gap:6px; font-size:11px; }
  .ea-input { min-width: 200px; width:100%; }
  .ea-confirm { margin-top:8px; font-size:12px; color:#4b5563; font-weight:600; }
  .ea-confirm-text { display:block; }
  .ea-confirm--active { color:#dc2626; }
</style></head><body>
<div class="sheet">
  <div class="header">
    <div class="title">MELDUNG/INFORMATION</div>
    <div class="nrbox">
      <div class="lbl">PROTOKOLL-NR</div>
      <div class="val">${esc(displayNr || "")}</div>
    </div>
  </div>

  <!-- Obere Zeile: Datum | Uhrzeit | Typ -->
  <div class="row3 cell">
    <div>
      <div class="label">Datum</div>
      <div class="input">${esc(fmt(item?.datum))}</div>
    </div>
    <div>
      <div class="label">Uhrzeit</div>
      <div class="input">${esc(fmt(item?.zeit))}</div>
    </div>
    <div>
      <div class="label">Typ</div>
      <div class="vstack">
        <div>${yes((item?.infoTyp || "Information") === "Information")} Information</div>
        <div>${yes((item?.infoTyp || "Information") === "Auftrag")} Auftrag</div>
		<div>${yes((item?.infoTyp || "Information") === "Lagemeldung")} Lagemeldung</div>
      </div>
    </div>
  </div>

  <!-- Zweite Zeile: An/Von | Kanal | Richtung (Typ steht oben drüber) -->
  <div class="row3 cell">
    <div>
      <div class="label">An/Von</div>
      <div class="anvon-row">
        <div class="anvon-radios">
          <div>${yes(dir === "an")} An</div>
          <div>${yes(dir === "von")} Von</div>
        </div>
        <div class="input">
          ${esc(dir ? (item?.anvon || "").replace(/^(an|von)\s*:/i, "").trim() : item?.anvon || "")}
        </div>
      </div>
    </div>

    <div>
      <div class="label">Kanal</div>
      <div class="input">${esc(fmt(u?.kanalNr))}</div>
    </div>

    <div>
      <div class="label">Richtung</div>
      <div class="vstack">
        <div>${yes(!!u?.ein)} Eingang</div>
        <div>${yes(!!u?.aus)} Ausgang</div>
      </div>
    </div>
  </div>

  <div class="cell">
    <div class="label">Information/Auftrag</div>
    <div class="input mh160 pre">${esc(fmt(item?.information))}</div>
  </div>

  <!-- Rückmeldung wieder untereinander (volle Breite) -->
  <div class="cell">
    <div class="label">Rückmeldung 1</div>
    <div class="input mh100 pre">${esc(fmt(item?.rueckmeldung1))}</div>
  </div>

  <div class="cell">
    <div class="label">Rückmeldung 2</div>
    <div class="input mh100 pre">${esc(fmt(item?.rueckmeldung2))}</div>
  </div>

  <div class="cell">
    <div class="label">ergeht an:</div>
    <div class="ea-row">
      <div class="ea-left">
        ${EA.map(k => `<span>${yes(ergehtSet.has(k))} ${k}</span>`).join("")}
      </div>
      <div class="ea-right">
        <span style="color:#555">sonst. Empf.:</span>
        <span class="input ea-input">${esc(item?.ergehtAnText || recipient || "")}</span>
      </div>
    </div>
  </div>

  <div class="cell">
    <div class="tgrid thead">
      <div class="cell" style="border-top:none">Maßnahme</div>
      <div class="cell" style="border-top:none">Verantwortlich</div>
      <div class="cell chk" style="border-top:none">Erledigt</div>
    </div>
    ${Array.from({ length: 5 }).map((_, i) => {
      const m = mass[i] || {};
      return `<div class="tgrid">
        <div class="cell">${esc(fmt(m.massnahme))}</div>
        <div class="cell">${esc(fmt(m.verantwortlich))}</div>
        <div class="cell chk">${yes(!!m.done)}</div>
      </div>`;
    }).join("")}
  </div>
  ${confirmSection}
</div>
</body></html>`;
}

// ---------- Render ----------
async function renderBundlePdf(item, recipients, nr) {
  const list = [...recipients];
  const extraCopies = nr === "blank" ? 0 : EXTRA_COPIES;
  for (let i = 0; i < extraCopies; i++) list.push(EXTRA_COPY_LABEL);

  const pagesHtml = list.map(r => sheetHtml(item, r, nr)).join('<div class="pb"></div>');
  const outName = `protokoll_${nr ?? "neu"}_${Date.now()}.pdf`;
  const outPath = path.join(PDF_DIR, outName);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--font-render-hinting=none"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(pagesHtml, { waitUntil: "load" });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "6mm", right: "6mm", bottom: "6mm", left: "6mm" },
    });
  } finally {
    await browser.close();
  }
  return { fileName: outName, pageCount: list.length };
}

// ---------- Routes ----------
router.post("/:nr/print", express.json(), async (req, res) => {
  try {
    const nr = req.params.nr;
    const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    if (!recipients.length) return res.status(400).json({ ok:false, error:"Keine Empfänger" });

    const item = req.body?.data;
    if (!item || typeof item !== "object") {
      return res.status(400).json({ ok:false, error:"Datensatz fehlt (data)" });
    }

    const { fileName, pageCount } = await renderBundlePdf(item, recipients, nr);
    const actor = resolveUserName(req) || req.ip || "";
    await recordPrint(nr, recipients, pageCount, fileName, actor, item);

    res.json({
      ok: true,
      file: fileName,
      fileUrl: `/api/protocol/${nr}/print/file/${encodeURIComponent(fileName)}`,
      pages: pageCount
    });
  } catch (e) {
    console.error("[print] error:", e);
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

router.post("/blank/print", express.json(), async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const recipients = incoming.length ? incoming.map((r) => String(r ?? "")) : [""];
    const item = req.body?.data && typeof req.body.data === "object" ? req.body.data : {};
    const { fileName, pageCount } = await renderBundlePdf(item, recipients, "blank");
    res.json({
      ok: true,
      file: fileName,
      fileUrl: `/api/protocol/blank/print/file/${encodeURIComponent(fileName)}`,
      pages: pageCount,
    });
  } catch (e) {
    console.error("[print-blank] error:", e);
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

router.get("/:nr/print/file/:file", async (req, res) => {
  try {
    const f = path.join(PDF_DIR, req.params.file);
    if (!fss.existsSync(f)) return res.status(404).end();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(f)}"`);
    res.sendFile(f);
  } catch {
    res.status(500).end();
  }
});

router.get("/blank/print/file/:file", async (req, res) => {
  try {
    const f = path.join(PDF_DIR, req.params.file);
    if (!fss.existsSync(f)) return res.status(404).end();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(f)}"`);
    res.sendFile(f);
  } catch {
    res.status(500).end();
  }
});

// Einhängen
export function attachPrintRoutes(app, base = "/api/protocol") {
  app.use(base, router);
}
export default attachPrintRoutes;
