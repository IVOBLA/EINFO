import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { User_authMiddleware } from "../User_auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_ROOT = path.resolve(
  process.env.KANBAN_DATA_DIR || path.join(__dirname, "..", "data"),
);
const INCIDENT_PDF_DIR = path.join(DATA_ROOT, "prints", "einsatz");
await fs.mkdir(INCIDENT_PDF_DIR, { recursive: true });

const SECURE_COOKIES = process.env.KANBAN_COOKIE_SECURE === "1";
const router = express.Router();
router.use(User_authMiddleware({ secureCookies: SECURE_COOKIES }));

const BODY_LIMIT = "4mb";

function sanitizeIncidentId(value) {
  if (value == null) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const normalized = trimmed.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/-+/g, "-");
  const cleaned = safe.replace(/^-+/, "").replace(/-+$/, "");
  return cleaned;
}

async function renderIncidentPdf(html, outPath) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--font-render-hinting=none"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  try {
    const page = await browser.newPage();
    // Größeren Viewport setzen – wichtig für korrekten Layout/Print
    await page.setViewport({ width: 1024, height: 1400, deviceScaleFactor: 2 });
    // Erst DOM aufbauen lassen …
    await page.setContent(html, { waitUntil: ["domcontentloaded"] });
    // … dann auf Netzwerk-Leerlauf warten (Bilder/Webfonts nachladen)
    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 });
    } catch (_) {
      // tolerieren, PDF wird dennoch erzeugt
    }
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    });
  } finally {
    await browser.close();
  }
}

router.post(
  "/:incidentId/print",
  express.json({ limit: BODY_LIMIT }),
  async (req, res) => {
    try {
      const html = typeof req.body?.html === "string" ? req.body.html : "";
      const incidentId = sanitizeIncidentId(req.params.incidentId);

      if (!incidentId) {
        return res.status(400).json({ ok: false, error: "Einsatz-ID fehlt oder ist ungültig." });
      }
      if (!html.trim()) {
        return res.status(400).json({ ok: false, error: "HTML-Inhalt fehlt." });
      }

      const fileName = `${incidentId}.pdf`;
      const outPath = path.join(INCIDENT_PDF_DIR, fileName);

      await renderIncidentPdf(html, outPath);

      res.json({ ok: true, file: fileName, filePath: outPath });
    } catch (err) {
      console.error("[incident-print] Fehler beim Speichern", err);
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  },
);

export function attachIncidentPrintRoutes(app, base = "/api/incidents") {
  app.use(base, router);
}

export default attachIncidentPrintRoutes;
