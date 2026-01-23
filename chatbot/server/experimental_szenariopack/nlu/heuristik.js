import { buildDefaultResult } from "./nlu_schema.js";
import { getExperimentalConfig } from "../config/config_loader.js";

const config = getExperimentalConfig();
const heuristicConfig = config?.nlu?.heuristic || {};
const yesWords = new Set(heuristicConfig.yes_words || []);
const noWords = new Set(heuristicConfig.no_words || []);
const keywordGroups = heuristicConfig.keywords || {};
const resourceConfig = heuristicConfig.resource || {};
const regexConfig = heuristicConfig.regex || {};

function buildRegex(value) {
  if (!value) return null;
  try {
    if (typeof value === "string") return new RegExp(value);
    if (typeof value === "object" && value.pattern) {
      return new RegExp(value.pattern, value.flags || "");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Fehlerhafte Regex-Konfiguration in heuristik:", message, value);
  }
  return null;
}

const numberRegex = buildRegex(regexConfig.number);
const minutesRegex = buildRegex(regexConfig.minutes);
const pegelConditionRegex = buildRegex(regexConfig.pegel_condition);
const pegelExtractRegex = buildRegex(regexConfig.pegel_extract);
const actionAfterThenRegex = buildRegex(regexConfig.action_after_then);
const actionAfterMinutesRegex = buildRegex(regexConfig.action_after_minutes);
const resourceRegex = buildRegex(resourceConfig.regex);

function extractNumber(text) {
  if (!numberRegex) return null;
  const match = text.match(numberRegex);
  if (!match) return null;
  return Number(match[1].replace(",", "."));
}

function extractMinutes(text) {
  if (!minutesRegex) return null;
  const match = text.match(minutesRegex);
  if (!match) return null;
  return Number(match[1]);
}

function includesKeyword(lower, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  return keywords.some((keyword) => keyword && lower.includes(String(keyword)));
}

export function parseHeuristik(text) {
  const lower = String(text || "").toLowerCase().trim();
  if (!lower) return buildDefaultResult();

  if (includesKeyword(lower, keywordGroups.weather)) {
    return {
      absicht: "WETTER_ABFRAGE",
      vertrauen: 0.9,
      felder: {},
      rueckfrage: null
    };
  }

  if (resourceRegex && resourceRegex.test(lower)) {
    const ressourceMatch = lower.match(resourceRegex);
    const ressource = ressourceMatch ? ressourceMatch[1] : resourceConfig.default_label || "";
    return {
      absicht: "RESSOURCE_ABFRAGE",
      vertrauen: 0.85,
      felder: { ressource },
      rueckfrage: null
    };
  }

  if (includesKeyword(lower, keywordGroups.logistics)) {
    return {
      absicht: "LOGISTIK_ANFRAGE",
      vertrauen: 0.85,
      felder: {},
      rueckfrage: null
    };
  }

  if (pegelConditionRegex && pegelConditionRegex.test(lower)) {
    const pegelMatch = pegelExtractRegex ? lower.match(pegelExtractRegex) : null;
    const pegel = pegelMatch ? Number(pegelMatch[1]) : null;
    const aktionMatch = actionAfterThenRegex ? lower.match(actionAfterThenRegex) : null;
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
    const aktionMatch = actionAfterMinutesRegex ? lower.match(actionAfterMinutesRegex) : null;
    const aktion = aktionMatch ? aktionMatch[1].trim() : null;
    return {
      absicht: "PLAN_ZEIT",
      vertrauen: 0.75,
      felder: { minuten: minutes, aktion },
      rueckfrage: null
    };
  }

  if (yesWords.has(lower) || noWords.has(lower)) {
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

  if (includesKeyword(lower, keywordGroups.command)) {
    return {
      absicht: "BEFEHL",
      vertrauen: 0.6,
      felder: { aktion: text },
      rueckfrage: null
    };
  }

  return buildDefaultResult();
}
