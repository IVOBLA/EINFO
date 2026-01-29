import { readEinfoInputs } from "../../einfo_io.js";
import { logError, logInfo } from "../../logger.js";
import { searchMemory } from "../../memory_manager.js";
import { callLLMForOps } from "../../llm_client.js";
import {
  identifyOpenFollowUps,
  buildMemoryQueryFromState,
  compressBoard,
  compressAufgaben,
  compressProtokoll,
  selectProtokollDeltaForPrompt,
  toComparableProtokoll,
  buildDelta
} from "../../sim_loop.js";
import { getFilteredDisasterContextSummary } from "../../disaster_context.js";
import { getExperimentalConfig } from "../config/config_loader.js";
import { loadScenarioFromFile, assertScenarioStructure } from "../engine/loader.js";
import { createInitialState, resetStateForScenario } from "../engine/state.js";
import { getPegelAtTick } from "../engine/timeline.js";
import { applyTickRules, applyUserEvent } from "../engine/rules.js";
import { createEmptyOperations } from "../engine/ops_builder.js";
import {
  applyBudgets,
  dedupeOperations,
  ensureMinimumOperations,
  filterOperationsByRoles,
  updateDedupeState,
  validateOperations
} from "../engine/validators.js";
import { decayEffects, applyEffects } from "../engine/user_effects.js";
import { computeWorld } from "../engine/world_engine.js";
import { toComparableBoardEntry, toComparableAufgabe } from "./comparators.js";
import { parseHeuristik } from "../nlu/heuristik.js";
import { parseWithLlm } from "../nlu/llm_nlu.js";
import { normalizeNluResult } from "../nlu/nlu_schema.js";

const DEFAULT_SCENARIO_PATH = "szenariopakete/szenario_hochwasser_6h_de.json";

let activeScenario = null;
const state = createInitialState({ startzustand: {}, ressourcen: {}, fragen_init: [] });

function countOperations(operations) {
  const ops = operations.operations;
  return {
    incidents: ops.board.createIncidentSites.length,
    boardUpdates: ops.board.updateIncidentSites.length + ops.board.transitionIncidentSites.length,
    tasksCreate: ops.aufgaben.create.length,
    tasksUpdate: ops.aufgaben.update.length,
    protokollCreate: ops.protokoll.create.length
  };
}

function buildTaskDeltaSummary(deltaList, snapshotMap) {
  const summary = [];
  for (const item of deltaList.slice(0, 10)) {
    const task = snapshotMap.get(item.id);
    if (!task) continue;
    summary.push({
      id: task.id,
      title: task.title || task.description || "",
      status: task.status || "",
      responsible: task.responsible || "",
      key: task.eindeutiger_schluessel || null
    });
  }
  return summary;
}

function buildScenarioControl({
  worldNow,
  worldDelta,
  forecast,
  activeEffects,
  taskDeltaSummary,
  budgets
}) {
  const constraints = [
    "Erfinde keine Weltmesswerte. Verwende nur WORLD_NOW/DELTA.",
    "Neue Effekte nur, wenn TASK_DELTA_SUMMARY nicht leer ist.",
    "Ausgabeformat: JSON mit Feld operations. Optional user_effects[]."
  ];
  return [
    `WORLD_NOW: ${JSON.stringify(worldNow)}`,
    `WORLD_DELTA: ${JSON.stringify(worldDelta)}`,
    `WORLD_FORECAST: ${JSON.stringify(forecast)}`,
    `ACTIVE_EFFECTS: ${JSON.stringify(activeEffects)}`,
    `TASK_DELTA_SUMMARY: ${JSON.stringify(taskDeltaSummary)}`,
    `ACTION_BUDGET: ${JSON.stringify(budgets)}`,
    "CONSTRAINTS:",
    ...constraints.map((line) => `- ${line}`)
  ].join("\n");
}

function mergeOperations(a, b) {
  const result = createEmptyOperations();
  result.operations.board.createIncidentSites = [
    ...(a.operations?.board?.createIncidentSites || []),
    ...(b.operations?.board?.createIncidentSites || [])
  ];
  result.operations.board.updateIncidentSites = [
    ...(a.operations?.board?.updateIncidentSites || []),
    ...(b.operations?.board?.updateIncidentSites || [])
  ];
  result.operations.board.transitionIncidentSites = [
    ...(a.operations?.board?.transitionIncidentSites || []),
    ...(b.operations?.board?.transitionIncidentSites || [])
  ];
  result.operations.aufgaben.create = [
    ...(a.operations?.aufgaben?.create || []),
    ...(b.operations?.aufgaben?.create || [])
  ];
  result.operations.aufgaben.update = [
    ...(a.operations?.aufgaben?.update || []),
    ...(b.operations?.aufgaben?.update || [])
  ];
  result.operations.protokoll.create = [
    ...(a.operations?.protokoll?.create || []),
    ...(b.operations?.protokoll?.create || [])
  ];
  return result;
}

function normalizeOperationsFromList(list = []) {
  const container = createEmptyOperations();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const type = String(entry.type || "").toLowerCase();
    if (type === "board.create" || type === "board.createincidentsite") {
      container.operations.board.createIncidentSites.push({
        humanId: entry.humanId || null,
        content: entry.content || entry.title || "Einsatz",
        typ: entry.typ || "Einsatz",
        ort: entry.ort || entry.location || "",
        description: entry.description || entry.desc || ""
      });
    }
    if (type === "board.update" || type === "board.updateincidentsite") {
      container.operations.board.updateIncidentSites.push(entry);
    }
    if (type === "board.transition" || type === "board.transitionincidentsite") {
      container.operations.board.transitionIncidentSites.push(entry);
    }
    if (type === "aufgaben.create") {
      container.operations.aufgaben.create.push({
        title: entry.title || entry.description || "Aufgabe",
        desc: entry.desc || entry.description || "",
        priority: entry.priority || "medium",
        responsible: entry.responsible || null,
        assignedBy: entry.assignedBy || null,
        status: entry.status || "open"
      });
    }
    if (type === "aufgaben.update") {
      container.operations.aufgaben.update.push(entry);
    }
    if (type === "protokoll.create") {
      container.operations.protokoll.create.push({
        information: entry.information || "",
        infoTyp: entry.infoTyp || entry.typ || "Info",
        anvon: entry.anvon || entry.von || null,
        ergehtAn: entry.ergehtAn || [],
        richtung: entry.richtung || ""
      });
    }
  }
  return container;
}

function normalizeLlMOperations(llmResponse) {
  const operations = llmResponse?.operations;
  if (Array.isArray(operations)) {
    return normalizeOperationsFromList(operations);
  }
  if (operations && typeof operations === "object") {
    const normalized = createEmptyOperations();
    normalized.operations.board.createIncidentSites =
      operations.board?.createIncidentSites || operations.board?.create || [];
    normalized.operations.board.updateIncidentSites =
      operations.board?.updateIncidentSites || operations.board?.update || [];
    normalized.operations.board.transitionIncidentSites =
      operations.board?.transitionIncidentSites || operations.board?.transition || [];
    normalized.operations.aufgaben.create = operations.aufgaben?.create || [];
    normalized.operations.aufgaben.update = operations.aufgaben?.update || [];
    normalized.operations.protokoll.create = operations.protokoll?.create || [];
    return normalized;
  }
  return createEmptyOperations();
}

function pushAudit(stateRef, entry, maxEntries = 200) {
  stateRef.auditTrail.push(entry);
  if (stateRef.auditTrail.length > maxEntries) {
    stateRef.auditTrail.splice(0, stateRef.auditTrail.length - maxEntries);
  }
}


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

  const config = getExperimentalConfig();
  const budgets = config?.ops?.budgets || {};
  const dedupeWindow = config?.ops?.dedupeWindow ?? 20;

  const einfoData = await readEinfoInputs();
  const board = Array.isArray(einfoData.board) ? einfoData.board : [];
  const aufgaben = Array.isArray(einfoData.aufgaben) ? einfoData.aufgaben : [];
  const protokoll = Array.isArray(einfoData.protokoll) ? einfoData.protokoll : [];
  const roles = einfoData.roles || { active: [] };
  const activeRoles = roles.active || [];

  const prevSnapshot = state.lastSnapshot || { board: [], aufgaben: [], protokoll: [] };
  const boardDeltaResult = buildDelta(board, prevSnapshot.board, toComparableBoardEntry);
  const aufgabenDeltaResult = buildDelta(aufgaben, prevSnapshot.aufgaben, toComparableAufgabe);
  const protokollDeltaResult = buildDelta(protokoll, prevSnapshot.protokoll, toComparableProtokoll);

  const openQuestions = identifyOpenFollowUps(protokoll, roles);

  logInfo(`Offene Rueckfragen (${openQuestions.length})`, {
    count: openQuestions.length,
    preview: openQuestions.slice(0, 2).map((entry) => ({
      nr: entry.nr,
      info: (entry.information || "").slice(0, 80)
    }))
  });

  let r5Active = false;
  try {
    const { appliedRules } = await getFilteredDisasterContextSummary({ maxLength: 200 });
    r5Active = appliedRules?.R5_STABS_FOKUS?.active === true;
  } catch (error) {
    logInfo("Experimental ScenarioPack: R5-Status konnte nicht ermittelt werden", { error: String(error) });
  }

  const compressedBoard = r5Active ? null : compressBoard(board);
  const compressedAufgaben = compressAufgaben(aufgaben);
    const { entries: protokollForPrompt } = selectProtokollDeltaForPrompt({
      protokollRaw: protokoll,
      previousSnapshotComparable: prevSnapshot.protokoll,
      rolesOrConstants: roles,
      maxItems: config?.ops?.maxProtokollItems ?? undefined
    });
    const compressedProtokoll = compressProtokoll(protokollForPrompt);

  decayEffects({ state, currentTick: state.tick });

  const { now: worldNow, delta: worldDelta, forecast } = computeWorld({
    scenario: activeScenario,
    state,
    tick: state.tick,
    horizons: [30, 60]
  });

  const taskSnapshotMap = new Map(aufgaben.map((task) => [task.id, task]));
  const taskDeltaSummary = buildTaskDeltaSummary(aufgabenDeltaResult.delta, taskSnapshotMap);

  const llmInput = {
    roles: { active: activeRoles },
    compressedBoard,
    compressedAufgaben,
    compressedProtokoll,
    firstStep: state.tick === 0,
    elapsedMinutes: state.tick * (activeScenario?.zeit?.schritt_minuten || 5),
    openQuestions,
    scenarioControl: buildScenarioControl({
      worldNow,
      worldDelta,
      forecast,
      activeEffects: state.activeEffects,
      taskDeltaSummary,
      budgets
    })
  };

  let memorySnippets = [];
  try {
    const memoryQuery = buildMemoryQueryFromState({
      boardCount: board.length,
      aufgabenCount: aufgaben.length,
      protokollCount: protokoll.length
    });
    const memoryHits = await searchMemory({
      query: memoryQuery,
      topK: 2,
      now: new Date(),
      maxAgeMinutes: 720,
      recencyHalfLifeMinutes: 120,
      longScenarioMinItems: 0
    });
    memorySnippets = memoryHits.map((hit) => hit.text);
  } catch (error) {
    logInfo("Experimental ScenarioPack: Memory-Suche fehlgeschlagen", { error: String(error) });
  }

  let llmResponse = null;
  let llmModel = null;
  let llmAnalysis = null;

  if (!options.skipLlm) {
    try {
      const llmResult = await callLLMForOps({
        llmInput,
        memorySnippets,
        scenario: activeScenario
      });
      llmResponse = llmResult.parsed || null;
      llmModel = llmResult.model || null;
      llmAnalysis = llmResponse?.analysis ? String(llmResponse.analysis).slice(0, 200) : null;
    } catch (error) {
      logError("Experimental ScenarioPack: LLM-Aufruf fehlgeschlagen", { error: String(error) });
    }
  }

  const baselineOps = applyTickRules({
    scenario: activeScenario,
    state,
    tick: state.tick,
    pegel: getPegelAtTick(activeScenario, state.tick),
    activeRoles
  });

  let llmOpsContainer = normalizeLlMOperations(llmResponse);
  try {
    validateOperations(llmOpsContainer);
  } catch (error) {
    logError("Experimental ScenarioPack: LLM-Operations ungültig", { error: String(error) });
    llmOpsContainer = createEmptyOperations();
  }

  const mergedOperations = mergeOperations(baselineOps, llmOpsContainer);

  const effectsApplied =
    Array.isArray(llmResponse?.user_effects) && taskDeltaSummary.length > 0
      ? applyEffects({ state, effects: llmResponse.user_effects, currentTick: state.tick })
      : [];

  let guardOps = mergedOperations;
  const countsBefore = countOperations(guardOps);

  try {
    validateOperations(guardOps);
  } catch (error) {
    logError("Experimental ScenarioPack: Operations JSON ungültig", { error: String(error) });
    guardOps = baselineOps;
  }

  guardOps = filterOperationsByRoles(guardOps, activeRoles);
  guardOps = dedupeOperations({ ops: guardOps, state, dedupeWindow });
  guardOps = applyBudgets({ ops: guardOps, budgets });
  ensureMinimumOperations(guardOps, { activeRoles, state, config });
  updateDedupeState({ ops: guardOps, state, dedupeWindow });

  const countsAfter = countOperations(guardOps);

  pushAudit(state, {
    tick: state.tick,
    zeitstempel: worldNow.zeitstempel,
    worldNow: {
      pegel_cm: worldNow.pegel_cm,
      damm_status: worldNow.damm_status,
      strom_status: worldNow.strom_status
    },
    worldDelta,
    opsBefore: countsBefore,
    opsAfter: countsAfter,
    effectsApplied: effectsApplied.length,
    llmModel,
    llmAnalysis
  });

  state.lastSnapshot = {
    board: boardDeltaResult.snapshot,
    aufgaben: aufgabenDeltaResult.snapshot,
    protokoll: protokollDeltaResult.snapshot
  };
  state.lastCompressedBoard = compressedBoard;
  state.worldLast = worldNow;
  state.history.push({ tick: state.tick, pegel: worldNow.pegel_cm });
  state.tick += 1;

  if (state.tick >= activeScenario.zeit.takte) {
    state.running = false;
  }

  return { ok: true, operations: guardOps.operations };
}

export async function handleUserFreitext({ role, text }) {
  const config = getExperimentalConfig();
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

  state.pending_user_events.push({
    tick: state.tick,
    role,
    text
  });
  if (state.pending_user_events.length > 20) {
    state.pending_user_events.shift();
  }
  pushAudit(state, {
    tick: state.tick,
    userEvent: { role, text: String(text).slice(0, 120), absicht: nluResult.absicht }
  });

  let guarded = operations;
  try {
    validateOperations(guarded);
  } catch (error) {
    logError("Experimental ScenarioPack: User-Operations ungültig", { error: String(error) });
    guarded = createEmptyOperations();
  }

  const filtered = filterOperationsByRoles(guarded, activeRoles);
  const deduped = dedupeOperations({ ops: filtered, state, dedupeWindow: config?.ops?.dedupeWindow ?? 20 });
  const budgeted = applyBudgets({ ops: deduped, budgets: config?.ops?.budgets });
  ensureMinimumOperations(budgeted, { activeRoles, state, config });
  updateDedupeState({ ops: budgeted, state, dedupeWindow: config?.ops?.dedupeWindow ?? 20 });
  const responseOperations = budgeted.operations;

  return {
    replyText,
    operationsDelta: responseOperations
  };
}

export {
  identifyOpenFollowUps,
  buildMemoryQueryFromState,
  compressBoard,
  compressAufgaben,
  compressProtokoll,
  toComparableProtokoll,
  buildDelta
};
