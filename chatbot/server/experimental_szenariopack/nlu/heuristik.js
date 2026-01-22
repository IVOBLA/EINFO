import { buildDefaultResult } from "./nlu_schema.js";

const YES_WORDS = ["ja", "jawohl", "yes", "ok"];
const NO_WORDS = ["nein", "no", "negativ"];

function extractNumber(text) {
  const match = text.match(/(\d+[\.,]?\d*)/);
  if (!match) return null;
  return Number(match[1].replace(",", "."));
}

function extractMinutes(text) {
  const match = text.match(/(\d+)\s*(minuten|min|m)/i);
  if (!match) return null;
  return Number(match[1]);
}

export function parseHeuristik(text) {
  const lower = String(text || "").toLowerCase().trim();
  if (!lower) return buildDefaultResult();

  if (lower.includes("wetter") || lower.includes("regen") || lower.includes("vorhersage")) {
    return {
      absicht: "WETTER_ABFRAGE",
      vertrauen: 0.9,
      felder: {},
      rueckfrage: null
    };
  }

  if (/(bagger|pumpe|pumpen|aggregat|sandsack)/i.test(lower)) {
    const ressourceMatch = lower.match(/(bagger|pumpe|pumpen|aggregat|sandsack)/i);
    const ressource = ressourceMatch ? ressourceMatch[1] : "Ressourcen";
    return {
      absicht: "RESSOURCE_ABFRAGE",
      vertrauen: 0.85,
      felder: { ressource },
      rueckfrage: null
    };
  }

  if (/(verpflegung|verpflegen|essen|trinken|logistik)/i.test(lower)) {
    return {
      absicht: "LOGISTIK_ANFRAGE",
      vertrauen: 0.85,
      felder: {},
      rueckfrage: null
    };
  }

  if (/wenn\s+pegel\s*>=?\s*\d+/i.test(lower)) {
    const pegelMatch = lower.match(/pegel\s*>=?\s*(\d+)/i);
    const pegel = pegelMatch ? Number(pegelMatch[1]) : null;
    const aktionMatch = lower.match(/dann\s+(.+)/i);
    const aktion = aktionMatch ? aktionMatch[1].trim() : null;
    return {
      absicht: "PLAN_WENN_DANN",
      vertrauen: 0.8,
      felder: { pegel, aktion },
      rueckfrage: null
    };
  }

  const minutes = extractMinutes(lower);
  if (minutes) {
    const aktionMatch = lower.match(/(?:in\s+\d+\s*min(?:uten)?\s+)(.+)/i);
    const aktion = aktionMatch ? aktionMatch[1].trim() : null;
    return {
      absicht: "PLAN_ZEIT",
      vertrauen: 0.75,
      felder: { minuten: minutes, aktion },
      rueckfrage: null
    };
  }

  if (YES_WORDS.includes(lower) || NO_WORDS.includes(lower)) {
    return {
      absicht: "ANTWORT",
      vertrauen: 0.7,
      felder: { antwort: lower },
      rueckfrage: null
    };
  }

  const number = extractNumber(lower);
  if (number !== null && Number.isFinite(number)) {
    return {
      absicht: "ANTWORT",
      vertrauen: 0.6,
      felder: { antwort: number },
      rueckfrage: null
    };
  }

  if (/(befehl|anweisen|beauftragen|ordne|ordnung)/i.test(lower)) {
    return {
      absicht: "BEFEHL",
      vertrauen: 0.6,
      felder: { aktion: text },
      rueckfrage: null
    };
  }

  return buildDefaultResult();
}
