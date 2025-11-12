import { Router } from "express";
import { getMailConfig, isMailConfigured, sendMail } from "../utils/mailClient.mjs";

export default function createMailRouter() {
  const router = Router();

  router.get("/status", (_req, res) => {
    const cfg = getMailConfig();
    const configured = isMailConfigured();
    res.status(configured ? 200 : 503).json({
      ok: configured,
      configured,
      from: configured ? cfg.from : null,
      secure: cfg.secure,
      starttls: cfg.starttls,
    });
  });

  router.post("/send", async (req, res) => {
    if (!isMailConfigured()) {
      res.status(503).json({ ok: false, error: "mail_not_configured" });
      return;
    }

    const { to, cc, bcc, subject, text, html, from, replyTo, headers } = req.body || {};

    if (!subject || typeof subject !== "string") {
      res.status(400).json({ ok: false, error: "mail_missing_subject" });
      return;
    }
    if (!text && !html) {
      res.status(400).json({ ok: false, error: "mail_missing_content" });
      return;
    }
    if (!to && !cc && !bcc) {
      res.status(400).json({ ok: false, error: "mail_missing_recipient" });
      return;
    }

    try {
      const result = await sendMail({ to, cc, bcc, subject, text, html, from, replyTo, headers });
      res.status(200).json({ ok: true, messageId: result.messageId, accepted: result.accepted, rejected: result.rejected, response: result.response });
    } catch (err) {
      console.error("[mail] send failed", err);
      res.status(500).json({ ok: false, error: "mail_send_failed", detail: err?.message || String(err) });
    }
  });

  return router;
}
