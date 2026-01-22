import { buildProtocolEntry } from "./ops_builder.js";

function evaluateTrigger(trigger, pegel) {
  if (!trigger) return false;
  const match = String(trigger).match(/pegel\s*>=\s*(\d+)/i);
  if (!match) return false;
  const threshold = Number(match[1]);
  return Number.isFinite(threshold) && pegel >= threshold;
}

export function generateNpcEvents({ scenario, state, tick, pegel, activeRoles }) {
  const events = [];
  const agents = Array.isArray(scenario.npc_agenten) ? scenario.npc_agenten : [];

  for (const agent of agents) {
    const cadence = Number(agent.cadence_takte || 0);
    if (!cadence || tick % cadence !== 0) continue;
    const triggers = Array.isArray(agent.triggers) ? agent.triggers : [];
    const triggerOk = triggers.length === 0 || triggers.some((t) => evaluateTrigger(t, pegel));
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
