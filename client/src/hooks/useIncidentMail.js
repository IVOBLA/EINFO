import { useCallback, useState } from "react";
import { prepareIncidentPrintDocument } from "../utils/incidentPrint";

const sanitizeIncidentId = (value) => {
  if (value == null) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const normalized = trimmed.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/-+/g, "-");
  return safe.replace(/^-+/, "").replace(/-+$/, "");
};

export function useIncidentMail() {
  const [mailBusy, setMailBusy] = useState(false);
  const [mailFeedback, setMailFeedback] = useState(null);

  const sendMail = useCallback(
    async (card) => {
      if (mailBusy) return false;
      if (!card) {
        setMailFeedback({ type: "error", message: "Kein Einsatz ausgewählt." });
        return false;
      }

      const recipientInput = window.prompt(
        "Bitte E-Mail-Adresse für den Versand eingeben:"
      );
      if (recipientInput == null) return false;
      const recipient = recipientInput.trim();
      if (!recipient) {
        setMailFeedback({ type: "error", message: "Keine E-Mail-Adresse angegeben." });
        return false;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(recipient)) {
        setMailFeedback({ type: "error", message: "E-Mail-Adresse ist ungültig." });
        return false;
      }

      setMailBusy(true);
      setMailFeedback(null);

      try {
        const title = card?.content || "";
        const type = card?.typ || card?.type || "";
        const locationLabel = card?.additionalAddressInfo || card?.ort || "";
        const notes = card?.description || "";
        const coordinates = {
          lat: card?.latitude ?? card?.lat ?? null,
          lng: card?.longitude ?? card?.lng ?? null,
        };
        const incidentIdForPrint = [card?.humanId, card?.content, card?.id]
          .map((v) => (v != null ? String(v).trim() : ""))
          .find((v) => v);

        const payload = await prepareIncidentPrintDocument({
          title,
          type,
          locationLabel,
          notes,
          coordinates,
          isArea: !!card?.isArea,
          areaColor: card?.areaColor,
          areaLabel: card?.areaLabel || card?.areaCardLabel,
        });

        const incidentIdClean = sanitizeIncidentId(incidentIdForPrint) || "einsatz";
        const subjectBase =
          payload.title || payload.type || incidentIdForPrint || incidentIdClean;
        const subject = subjectBase ? `Einsatzkarte ${subjectBase}` : "Einsatzkarte";

        const detailLines = [];
        if (payload.title) detailLines.push(`Einsatz: ${payload.title}`);
        if (payload.location) detailLines.push(`Ort: ${payload.location}`);
        detailLines.push(`Gesendet: ${payload.timestamp}`);
        const detailText = detailLines.join("\n");
        const textBody = `Im Anhang finden Sie die aktuelle Einsatzkarte.\n\n${detailText}`.trim();

        const htmlDetails = [
          payload.title ? `<li><strong>Einsatz:</strong> ${payload.title}</li>` : "",
          payload.location ? `<li><strong>Ort:</strong> ${payload.location}</li>` : "",
          `<li><strong>Gesendet:</strong> ${payload.timestamp}</li>`,
        ]
          .filter(Boolean)
          .join("");
        const htmlBody = `<p>Im Anhang finden Sie die aktuelle Einsatzkarte.</p><ul>${htmlDetails}</ul>`;

        const response = await fetch(
          `/api/incidents/${encodeURIComponent(incidentIdClean)}/mail`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              html: payload.html,
              to: recipient,
              subject,
              textBody,
              htmlBody,
            }),
          }
        );
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) {
          const detail =
            result?.detail || result?.error || response.statusText || "Versand fehlgeschlagen.";
          throw new Error(detail);
        }
        setMailFeedback({ type: "success", message: "E-Mail wurde versendet." });
        return true;
      } catch (err) {
        const msg = err?.message || "E-Mail-Versand fehlgeschlagen.";
        setMailFeedback({ type: "error", message: msg });
        return false;
      } finally {
        setMailBusy(false);
      }
    },
    [mailBusy]
  );

  const resetMailFeedback = useCallback(() => setMailFeedback(null), []);

  return { mailBusy, mailFeedback, sendMail, resetMailFeedback };
}
