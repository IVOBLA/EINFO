import { Router } from "express";
import { getMailInboxConfig, readAndEvaluateInbox } from "../utils/mailEvaluator.mjs";

function parseLimit(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  const rounded = Math.max(1, Math.min(500, Math.floor(num)));
  return rounded;
}

export default function createMailInboxRouter() {
  const router = Router();

  router.get("/status", async (_req, res) => {
    const cfg = getMailInboxConfig();
    try {
      await readAndEvaluateInbox({ mailDir: cfg.inboxDir, limit: 1 });
      res.status(200).json({ ok: true, configured: true, inboxDir: cfg.inboxDir });
    } catch (err) {
      res.status(500).json({ ok: false, configured: false, inboxDir: cfg.inboxDir, error: err?.message || String(err) });
    }
  });

  router.get("/", async (req, res) => {
    const limit = parseLimit(req.query.limit);

    try {
      const result = await readAndEvaluateInbox({ limit });
      res.json({ ok: true, limit, ...result });
    } catch (err) {
      console.error("[mail-inbox] Auswertung fehlgeschlagen", err);
      res.status(500).json({ ok: false, error: "mail_inbox_failed", detail: err?.message || String(err) });
    }
  });

  return router;
}
