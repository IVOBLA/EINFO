import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { User_authMiddleware } from "../User_auth.mjs";
import { isMailConfigured, sendMail } from "../utils/mailClient.mjs";
import { EINSATZ_PDF_DIR, ensurePdfDirectories } from "../utils/pdfPaths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INCIDENT_PDF_DIR = EINSATZ_PDF_DIR;
await ensurePdfDirectories(INCIDENT_PDF_DIR);

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
    const pdfBuffer = await page.pdf({
      path: outPath || undefined,
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    });
    return pdfBuffer;
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

router.post(
  "/:incidentId/mail",
  express.json({ limit: BODY_LIMIT }),
  async (req, res) => {
    if (!isMailConfigured()) {
      return res.status(503).json({ ok: false, error: "mail_not_configured" });
    }

    try {
      const incidentIdParam = sanitizeIncidentId(req.params.incidentId || req.body?.incidentId);
      if (!incidentIdParam) {
        return res.status(400).json({ ok: false, error: "incident_id_missing" });
      }

      const html = typeof req.body?.html === "string" ? req.body.html : "";
      if (!html.trim()) {
        return res.status(400).json({ ok: false, error: "print_html_missing" });
      }

      const toRaw = req.body?.to;
      const ccRaw = req.body?.cc;
      const bccRaw = req.body?.bcc;
      const recipients = [];
      if (Array.isArray(toRaw)) recipients.push(...toRaw);
      else if (toRaw) recipients.push(toRaw);
      const cc = Array.isArray(ccRaw) ? ccRaw : ccRaw ? [ccRaw] : [];
      const bcc = Array.isArray(bccRaw) ? bccRaw : bccRaw ? [bccRaw] : [];
      if (!recipients.length && !cc.length && !bcc.length) {
        return res.status(400).json({ ok: false, error: "mail_missing_recipient" });
      }

      const pdfBuffer = await renderIncidentPdf(html, null);
      const filename = `${incidentIdParam}.pdf`;

      const subjectRaw = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
      const textBodyRaw = typeof req.body?.textBody === "string" ? req.body.textBody : "";
      const htmlBodyRaw = typeof req.body?.htmlBody === "string" ? req.body.htmlBody : "";
      const subject = subjectRaw || `Einsatzkarte ${incidentIdParam}`;
      const textBody = textBodyRaw.trim()
        ? textBodyRaw
        : `Im Anhang finden Sie die Einsatzkarte ${incidentIdParam}.`;
      const htmlBody = htmlBodyRaw.trim()
        ? htmlBodyRaw
        : `<p>Im Anhang finden Sie die Einsatzkarte <strong>${incidentIdParam}</strong>.</p>`;

      const mailResult = await sendMail({
        to: recipients,
        cc,
        bcc,
        subject,
        text: textBody,
        html: htmlBody,
        attachments: [
          {
            filename,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      res.json({ ok: true, messageId: mailResult.messageId, accepted: mailResult.accepted, rejected: mailResult.rejected });
    } catch (err) {
      console.error("[incident-print] mail send failed", err);
      res.status(500).json({ ok: false, error: "mail_send_failed", detail: err?.message || String(err) });
    }
  },
);

export function attachIncidentPrintRoutes(app, base = "/api/incidents") {
  app.use(base, router);
}

export default attachIncidentPrintRoutes;
