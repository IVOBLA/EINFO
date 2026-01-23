import { createHash } from "crypto";
import { validateOperationsJson } from "../../json_sanitizer.js";
import { isAllowedOperation } from "../../simulation_helpers.js";
import { addProtocol, addTask, buildProtocolEntry, buildTask, pickRole } from "./ops_builder.js";

function filterOpsArray(list, activeRoles, options) {
  return list.filter((op) => isAllowedOperation(op, activeRoles, options));
}

export function filterOperationsByRoles(operations, activeRoles) {
  const filtered = structuredClone(operations);
  const ops = filtered.operations;

  ops.board.createIncidentSites = filterOpsArray(ops.board.createIncidentSites, activeRoles, {
    operationType: "board.create"
  });
  ops.board.updateIncidentSites = filterOpsArray(ops.board.updateIncidentSites, activeRoles, {
    operationType: "board.update"
  });
  ops.board.transitionIncidentSites = filterOpsArray(ops.board.transitionIncidentSites, activeRoles, {
    operationType: "board.transition"
  });

  ops.aufgaben.create = filterOpsArray(ops.aufgaben.create, activeRoles, {
    operationType: "aufgaben.create",
    allowExternal: true
  });
  ops.aufgaben.update = filterOpsArray(ops.aufgaben.update, activeRoles, {
    operationType: "aufgaben.update"
  });

  ops.protokoll.create = filterOpsArray(ops.protokoll.create, activeRoles, {
    operationType: "protokoll.create",
    allowExternal: true
  });

  return filtered;
}

function hashKey(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function priorityScore(value) {
  const priority = String(value || "").toLowerCase();
  if (priority === "high" || priority === "urgent") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}

function protocolScore(entry) {
  const infoTyp = String(entry?.infoTyp || entry?.typ || "").toLowerCase();
  if (infoTyp.includes("alarm")) return 3;
  if (infoTyp.includes("rueck") || infoTyp.includes("rück")) return 2;
  if (infoTyp.includes("lage") || infoTyp.includes("warn")) return 2;
  return 1;
}

function getTaskKey(task) {
  if (task?.eindeutiger_schluessel) return String(task.eindeutiger_schluessel);
  const source = `${task?.title || ""}|${task?.responsible || ""}|${task?.assignedBy || ""}`;
  return `generated-${hashKey(source)}`;
}

function getProtocolKey(entry) {
  const infoTyp = entry?.infoTyp || entry?.typ || "";
  const anvon = entry?.anvon || "";
  const richtung = entry?.richtung || entry?.uebermittlungsart?.richtung || "";
  const ergehtAn = Array.isArray(entry?.ergehtAn) ? entry.ergehtAn.join("|") : String(entry?.ergehtAn || "");
  const info = String(entry?.information || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return `proto-${hashKey(`${infoTyp}|${anvon}|${richtung}|${ergehtAn}|${info}`)}`;
}

export function dedupeOperations({ ops, state, dedupeWindow = 20 }) {
  const dedupeState = state.dedupe || {
    taskKeys: new Set(),
    protokollKeys: [],
    protokollWindow: dedupeWindow
  };
  dedupeState.protokollWindow = dedupeWindow;
  state.dedupe = dedupeState;

  const next = structuredClone(ops);
  const operations = next.operations;
  const seenIncidents = new Set(state.incidents || []);
  const seenTaskKeys = new Set(dedupeState.taskKeys || []);
  const seenProtokoll = Array.isArray(dedupeState.protokollKeys) ? [...dedupeState.protokollKeys] : [];

  operations.board.createIncidentSites = operations.board.createIncidentSites.filter((incident) => {
    const humanId = incident?.humanId;
    if (humanId && seenIncidents.has(humanId)) {
      return false;
    }
    if (humanId) {
      seenIncidents.add(humanId);

  operations.board.createIncidentSites = operations.board.createIncidentSites.filter((incident) => {
    const humanId = incident?.humanId;
    if (humanId && state.incidents?.has(humanId)) {
      return false;
    }
    if (humanId) {
      state.incidents.add(humanId);
    }
    return true;
  });

  operations.aufgaben.create = operations.aufgaben.create.filter((task) => {
    const key = getTaskKey(task);
    if (seenTaskKeys.has(key)) {
      return false;
    }
    seenTaskKeys.add(key);
    return true;
  });

  operations.protokoll.create = operations.protokoll.create.filter((entry) => {
    const key = getProtocolKey(entry);
    if (seenProtokoll.includes(key)) {
      return false;
    }
    seenProtokoll.push(key);
    while (seenProtokoll.length > dedupeWindow) {
      seenProtokoll.shift();
    }
    return true;
  });

  return next;
}

export function updateDedupeState({ ops, state, dedupeWindow = 20 }) {
  const dedupeState = state.dedupe || {
    taskKeys: new Set(),
    protokollKeys: [],
    protokollWindow: dedupeWindow
  };
  dedupeState.protokollWindow = dedupeWindow;
  state.dedupe = dedupeState;

  const incidents = ops.operations?.board?.createIncidentSites || [];
  for (const incident of incidents) {
    if (incident?.humanId) {
      state.incidents.add(incident.humanId);
    }
  }

  const tasks = ops.operations?.aufgaben?.create || [];
  for (const task of tasks) {
    dedupeState.taskKeys.add(getTaskKey(task));
  }

  const entries = ops.operations?.protokoll?.create || [];
  const window = Array.isArray(dedupeState.protokollKeys) ? dedupeState.protokollKeys : [];
  for (const entry of entries) {
    const key = getProtocolKey(entry);
    if (window.includes(key)) continue;
    if (dedupeState.taskKeys.has(key)) {
      return false;
    }
    dedupeState.taskKeys.add(key);
    return true;
  });

  const window = Array.isArray(dedupeState.protokollKeys) ? dedupeState.protokollKeys : [];
  operations.protokoll.create = operations.protokoll.create.filter((entry) => {
    const key = getProtocolKey(entry);
    if (window.includes(key)) {
      return false;
    }
    window.push(key);
    while (window.length > dedupeWindow) {
      window.shift();
    }
  }
  dedupeState.protokollKeys = window;
    return true;
  });
  dedupeState.protokollKeys = window;

  return next;
}

export function applyBudgets({ ops, budgets }) {
  const defaults = {
    protokollCreateMax: 3,
    tasksCreateMax: 2,
    incidentsCreateMax: 1,
    updatesMax: 2
  };
  const limit = { ...defaults, ...(budgets || {}) };
  const next = structuredClone(ops);
  const operations = next.operations;

  operations.aufgaben.create = [...operations.aufgaben.create]
    .sort((a, b) => priorityScore(b?.priority) - priorityScore(a?.priority))
    .slice(0, limit.tasksCreateMax);

  operations.protokoll.create = [...operations.protokoll.create]
    .sort((a, b) => protocolScore(b) - protocolScore(a))
    .slice(0, limit.protokollCreateMax);

  operations.board.createIncidentSites = operations.board.createIncidentSites.slice(0, limit.incidentsCreateMax);

  operations.board.updateIncidentSites = operations.board.updateIncidentSites.slice(0, limit.updatesMax);
  operations.board.transitionIncidentSites = operations.board.transitionIncidentSites.slice(0, limit.updatesMax);
  operations.aufgaben.update = operations.aufgaben.update.slice(0, limit.updatesMax);

  return next;
}

export function ensureMinimumOperations(operations, { activeRoles, state, config }) {
  const ops = operations.operations;
  const hasAny =
    ops.board.createIncidentSites.length > 0 ||
    ops.board.updateIncidentSites.length > 0 ||
    ops.board.transitionIncidentSites.length > 0 ||
    ops.aufgaben.create.length > 0 ||
    ops.aufgaben.update.length > 0 ||
    ops.protokoll.create.length > 0;
  const fallbackCooldown = config?.ops?.fallbackCooldownTicks ?? 3;
  const fallbackTaskCooldown = config?.ops?.fallbackTaskCooldownTicks ?? 10;

  if (!hasAny && state.tick - state.fallback.lastProtocolTick >= fallbackCooldown) {
    addProtocol(
      operations,
      buildProtocolEntry({
        information: "Fallback: Keine Lageänderung festgestellt.",
        infoTyp: "Info",
        anvon: pickRole(activeRoles, ["S2"], "POL"),
        ergehtAn: ["LTSTB"],
        richtung: "aus",
        activeRoles
      })
    );
    state.fallback.lastProtocolTick = state.tick;
  }

  if (
    ops.aufgaben.create.length === 0 &&
    (state.tick === 0 || state.tick - state.fallback.lastTaskTick >= fallbackTaskCooldown)
  ) {
    addTask(
      operations,
      buildTask({
        title: "Fallback-Lagecheck",
        desc: "Kurzlage prüfen und Rückmeldung geben.",
        priority: "low",
        responsible: pickRole(activeRoles, ["S2"], "POL"),
        assignedBy: pickRole(activeRoles, ["LTSTB"], "POL"),
        key: `fallback-lagecheck-${state.tick}`
      })
    );
    state.fallback.lastTaskTick = state.tick;
  }
}

export function validateOperations(operations) {
  const result = validateOperationsJson(operations);
  if (!result.valid) {
    throw new Error(`Ungültiges Operations-JSON: ${result.error}`);
  }
}
