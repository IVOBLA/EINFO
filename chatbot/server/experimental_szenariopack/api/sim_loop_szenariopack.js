import { readEinfoInputs } from "../../einfo_io.js";
import { logInfo } from "../../logger.js";
import {
  identifyMessagesNeedingResponse,
  identifyOpenQuestions,
  buildMemoryQueryFromState,
  compressBoard,
  compressAufgaben,
  compressProtokoll,
  toComparableProtokoll,
  buildDelta
} from "../../sim_loop.js";
import { loadScenarioFromFile, assertScenarioStructure } from "../engine/loader.js";
import { createInitialState, resetStateForScenario } from "../engine/state.js";
import { getPegelAtTick } from "../engine/timeline.js";
import { applyTickRules, applyUserEvent } from "../engine/rules.js";
import { createEmptyOperations } from "../engine/ops_builder.js";
import { ensureMinimumOperations, filterOperationsByRoles, validateOperations } from "../engine/validators.js";
import { parseHeuristik } from "../nlu/heuristik.js";
import { parseWithLlm } from "../nlu/llm_nlu.js";
import { normalizeNluResult } from "../nlu/nlu_schema.js";

const DEFAULT_SCENARIO_PATH = "szenariopakete/szenario_hochwasser_6h_de.json";

let activeScenario = null;
const state = createInitialState({ startzustand: {}, ressourcen: {}, fragen_init: [] });

export function isSimulationRunning() {
  return state.running;
}

export async function startSimulation(scenario = null) {
  const scenarioData = scenario ? assertScenarioStructure(scenario) : await loadScenarioFromFile(DEFAULT_SCENARIO_PATH);
  activeScenario = scenarioData;
  resetStateForScenario(state, scenarioData);
  state.running = true;
  logInfo("Experimental ScenarioPack gestartet", {
    scenarioId: scenarioData?.metadaten?.id,
    title: scenarioData?.metadaten?.titel
  });
}

export function pauseSimulation() {
  state.running = false;
}

export function getActiveScenario() {
  return activeScenario;
}

export async function stepSimulation(options = {}) {
  if (!state.running) {
    return { ok: false, reason: "not_running" };
  }

  const einfoData = await readEinfoInputs();
  const activeRoles = einfoData.roles?.active || [];
  const tick = state.tick;
  const pegel = getPegelAtTick(activeScenario, tick);

  const operations = applyTickRules({
    scenario: activeScenario,
    state,
    tick,
    pegel,
    activeRoles
  });

  ensureMinimumOperations(operations, activeRoles);
  const filtered = filterOperationsByRoles(operations, activeRoles);
  validateOperations(filtered);
  const responseOperations = filtered.operations;

  state.history.push({ tick, pegel });
  state.tick += 1;

  if (state.tick >= activeScenario.zeit.takte) {
    state.running = false;
  }

  return { ok: true, operations: responseOperations };
}

export async function handleUserFreitext({ role, text }) {
  const einfoData = await readEinfoInputs();
  const activeRoles = einfoData.roles?.active || [];
  if (!activeScenario || !state.running) {
    const operations = createEmptyOperations();
    return {
      replyText: "Simulation noch nicht gestartet. Bitte zuerst /api/sim/start aufrufen.",
      operationsDelta: filterOperationsByRoles(operations, activeRoles).operations
    };
  }
  const heuristik = parseHeuristik(text);
  let nluResult = normalizeNluResult(heuristik);

  if (nluResult.absicht === "UNKLAR" || nluResult.vertrauen < 0.55) {
    nluResult = await parseWithLlm(text);
  }

  const { replyText, operations } = applyUserEvent({
    scenario: activeScenario,
    state,
    nluResult,
    activeRoles,
    currentTick: state.tick,
    role
  });

  ensureMinimumOperations(operations, activeRoles);
  const filtered = filterOperationsByRoles(operations, activeRoles);
  validateOperations(filtered);
  const responseOperations = filtered.operations;

  return {
    replyText,
    operationsDelta: responseOperations
  };
}

export {
  identifyMessagesNeedingResponse,
  identifyOpenQuestions,
  buildMemoryQueryFromState,
  compressBoard,
  compressAufgaben,
  compressProtokoll,
  toComparableProtokoll,
  buildDelta
};
