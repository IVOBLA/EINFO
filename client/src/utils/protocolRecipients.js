const INTERNAL_RECIPIENT_IDS = new Set([
  "EL",
  "LTSTB",
  "LTSTBSTV",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
]);

const TRUTHY_PATTERN = /^(1|true|ja|yes|on)$/i;

function canonicalRecipientId(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const match = raw.match(/\b(S[1-6]|EL|LTSTB|LTSTBSTV)\b/i);
  if (match) return match[1].toUpperCase();
  return raw.replace(/\s+/g, "").toUpperCase();
}

function truthyFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "number") return !Number.isNaN(value) && value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    return TRUTHY_PATTERN.test(trimmed);
  }
  return false;
}

export function isOutgoingProtocolEntry(item) {
  if (!item || typeof item !== "object") return false;
  const u = item.uebermittlungsart || {};
  if (truthyFlag(u.aus)) return true;
  const direction = typeof u.richtung === "string" ? u.richtung : item.richtung;
  if (typeof direction === "string" && /aus/i.test(direction)) return true;
  return false;
}

export function hasExternalRecipients(item) {
  if (!item || typeof item !== "object") return false;
  const recipients = Array.isArray(item.ergehtAn) ? item.ergehtAn : [];
  for (const raw of recipients) {
    const trimmed = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (!trimmed) continue;
    const id = canonicalRecipientId(trimmed);
    if (!INTERNAL_RECIPIENT_IDS.has(id)) {
      return true;
    }
  }
  const extra = typeof item.ergehtAnText === "string" ? item.ergehtAnText.trim() : "";
  if (extra) return true;
  return false;
}

export function requiresOtherRecipientConfirmation(item) {
  if (!isOutgoingProtocolEntry(item)) return false;
  return hasExternalRecipients(item);
}

