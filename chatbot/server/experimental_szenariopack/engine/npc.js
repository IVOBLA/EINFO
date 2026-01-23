import { buildProtocolEntry } from "./ops_builder.js";
import { getExperimentalConfig } from "../config/config_loader.js";

const config = getExperimentalConfig();
const triggerParsers = Array.isArray(config?.npc_triggers?.parsers)
  ? config.npc_triggers.parsers
  : [];

function buildRegex(value) {
  if (!value) return null;
  try {
    if (typeof value === "string") return new RegExp(value);
    if (typeof value === "object" && value.pattern) {
      return new RegExp(value.pattern, value.flags || "");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Fehlerhafte Regex-Konfiguration in npc_triggers:", message, value);
  }
  return null;
}

const compiledParsers = triggerParsers
  .map((parser) => ({
    ...parser,
    regex: buildRegex(parser.regex)
  }))
  .filter((parser) => parser.regex);

function compare(operator, current, threshold) {
  switch (operator) {
    case "gte":
      return current >= threshold;
    case "lte":
      return current <= threshold;
    case "gt":
      return current > threshold;
    case "lt":
      return current < threshold;
    case "eq":
      return current === threshold;
    default:
      return false;
  }
}

function evaluateTrigger(trigger, context) {
  if (!trigger) return false;
  const triggerText = String(trigger);
  for (const parser of compiledParsers) {
    const match = triggerText.match(parser.regex);
    if (!match) continue;
    const valueIndex = Number.isFinite(parser.value_index) ? parser.value_index : 1;
    const threshold = Number(match[valueIndex]);
    const current = Number(context?.[parser.field]);
    if (!Number.isFinite(threshold) || !Number.isFinite(current)) return false;
    return compare(parser.operator, current, threshold);
  }
  return false;
}

export function generateNpcEvents({ scenario, state, tick, pegel, activeRoles }) {
  const events = [];
  const agents = Array.isArray(scenario.npc_agenten) ? scenario.npc_agenten : [];

  for (const agent of agents) {
    const cadence = Number(agent.cadence_takte || 0);
    if (!cadence || tick % cadence !== 0) continue;
    const triggers = Array.isArray(agent.triggers) ? agent.triggers : [];
    const triggerOk =
      triggers.length === 0 || triggers.some((t) => evaluateTrigger(t, { pegel }));
    if (!triggerOk) continue;

    events.push(
      buildProtocolEntry({
        information: agent.nachricht,
        infoTyp: "Info",
        anvon: agent.rolle || "Bürger",
        ergehtAn: ["S2"],
        richtung: "ein",
        activeRoles
      })
    );
  }

  return events;
}
