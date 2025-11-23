import { CONFIG } from "./config.js";
import { readEinfoInputs, writeChatbotOutputs } from "./einfo_io.js";
import {
  initState,
  getCurrentStateSnapshot,
  applyLLMChangesToState
} from "./state_store.js";
import { callLLMWithRAG } from "./llm_client.js";
import { logInfo, logError } from "./logger.js";

let running = false;

export async function startSimulation(scenarioOverride) {
  const einfoData = await readEinfoInputs();
  let scenarioConfig = einfoData.scenarioConfig;

  if (!scenarioConfig) {
    scenarioConfig = {
      scenarioId: `scenario-${Date.now()}`,
      artDesEreignisses: "Unbekannt",
      geografischerBereich: "Unbekannt",
      zeit: "Tag",
      wetter: "Unbekannt",
      infrastruktur: {
        strom: "unbekannt",
        internet: "unbekannt",
        mobilfunk: "unbekannt"
      },
      initialEinsatzstellen: 0
    };
  }

  if (scenarioOverride && typeof scenarioOverride === "object") {
    scenarioConfig = { ...scenarioConfig, ...scenarioOverride };
  }

  initState(scenarioConfig);
  running = true;
  logInfo("Simulation gestartet", { scenarioId: scenarioConfig.scenarioId });
}

export function pauseSimulation() {
  running = false;
  logInfo("Simulation pausiert");
}

export async function stepSimulation(options = {}) {
  if (!running) {
    return { ok: false, reason: "not_running" };
  }

  try {
    const einfoData = await readEinfoInputs();
    const stateBefore = getCurrentStateSnapshot();

    // options.forceNewIncident könntest du später im Prompt berücksichtigen,
    // z.B. über zusätzliche Einträge im UserPrompt.

    const llmResponse = await callLLMWithRAG({ stateBefore, einfoData });

    const { newState, chatbotEvents, chatbotIncidents } =
      applyLLMChangesToState(
        stateBefore,
        llmResponse,
        CONFIG.minutesPerStep
      );

    await writeChatbotOutputs({ chatbotEvents, chatbotIncidents });

    return {
      ok: true,
      newState,
      chatbotEvents,
      chatbotIncidents
    };
  } catch (err) {
    logError("Fehler im Simulationsschritt", { error: String(err) });
    return { ok: false, error: String(err) };
  }
}
