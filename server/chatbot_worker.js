// server/chatbot_worker.js

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import {
  addMemory,
  initMemoryStore,
  searchMemory
} from "../chatbot/server/memory_manager.js";

import { getGpuStatus } from "../chatbot/server/gpu_status.js";

import { syncRolesFile } from "../chatbot/server/roles_sync.js";
import {
  transformLlmOperationsToJson,
  isMeldestelle,
  isStabsstelle,
  normalizeRole
} from "../chatbot/server/field_mapper.js";
import { readAufgBoardFile, writeAufgBoardFile } from "../chatbot/server/aufgaben_board_io.js";
import {
  confirmProtocolsByLtStb,
  updateTaskStatusForSimulatedRoles,
  ensureOneIncidentInProgress,
  assignVehiclesByDistance,
  deriveTasksFromProtocol,
  isAllowedOperation,
  explainOperationRejection
} from "../chatbot/server/simulation_helpers.js";
import {
  getScenarioIntervalMs,
  normalizeScenarioSimulation
} from "../chatbot/server/scenario_controls.js";

const CHATBOT_STEP_URL = "http://127.0.0.1:3100/api/sim/step";
const CHATBOT_SCENARIO_URL = "http://127.0.0.1:3100/api/sim/scenario";
const CHATBOT_STATUS_URL = "http://127.0.0.1:3100/api/sim/status";
const CHATBOT_WAITING_URL = "http://127.0.0.1:3100/api/sim/waiting-for-roles";
const WORKER_INTERVAL_MS = 30000;
const WORKER_CONFIG_FILE = path.join(process.cwd(), "data", "conf", "worker_config.json");
let isRunning = false; // <--- NEU
let workerIntervalId = null; // Store interval ID for cleanup
let currentWorkerIntervalMs = WORKER_INTERVAL_MS;
let cachedScenario = null;
let configCheckIntervalId = null; // Für Config-Datei-Überwachung
let wasWaitingForRoles = false; // Tracking ob wir auf Rollen gewartet haben
// Pfad zu deinen echten Daten:
// Wir gehen davon aus, dass du den Worker IMMER aus dem server-Ordner startest:
//   cd C:\kanban41\server
//   node chatbot_worker.js
const dataDir = path.join(process.cwd(), "data");

// Dateinamen an deine Struktur angepasst
const FILES = {
  roles: "roles.json",
  board: "board.json",
  protokoll: "protocol.json"
};

// -------- NEU: Log-Verzeichnis und Worker-Logdatei --------
const LOG_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
const WORKER_LOG_FILE = path.join(LOG_DIR, "chatbot_worker.log");

// -------- NEU: zusätzliches Log für verworfene Operationen --------
const OPS_VERWORFEN_LOG_FILE = path.join(LOG_DIR, "ops_verworfen.log");

// -------- NEU: Action-History für erfolgreich durchgeführte LLM-Aktionen --------
const ACTION_HISTORY_FILE = path.join(dataDir, "llm_action_history.json");
const MAX_ACTION_HISTORY_ENTRIES = 500; // Maximal gespeicherte Einträge

const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 10;

function appendOpsVerworfenLog(entry) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry
  });
  fsPromises.appendFile(OPS_VERWORFEN_LOG_FILE, line + "\n").catch((err) => {
    console.error(
      "[chatbot-worker] Fehler beim Schreiben in ops_verworfen.log:",
      err
    );
  });
}

// -------- NEU: Action-History für erfolgreich durchgeführte LLM-Aktionen --------
async function appendActionHistory(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return;

  try {
    let history = await safeReadJson(ACTION_HISTORY_FILE, []);
    if (!Array.isArray(history)) history = [];

    // Neue Aktionen an den Anfang hinzufügen
    history = [...actions, ...history];

    // Auf maximale Einträge begrenzen
    if (history.length > MAX_ACTION_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_ACTION_HISTORY_ENTRIES);
    }

    await safeWriteJson(ACTION_HISTORY_FILE, history);
    log(`Action-History aktualisiert: ${actions.length} neue Einträge`);
  } catch (err) {
    console.error("[chatbot-worker] Fehler beim Schreiben der Action-History:", err);
  }
}

function buildActionHistoryEntry(type, category, data, relatedId = null) {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,      // "create" | "update"
    category,  // "protokoll" | "aufgabe" | "einsatz"
    data,      // Die vollständigen Daten der Aktion
    relatedId  // ID des erstellten/bearbeiteten Objekts
  };
}
// -----------------------------------------------------------



function appendWorkerLog(line) {
  fsPromises.appendFile(WORKER_LOG_FILE, line + "\n").catch((err) => {
    // Wenn das Dateiloggen kaputt ist, nicht den Worker abstürzen lassen:
    console.error("[chatbot-worker] Fehler beim Schreiben in Logdatei:", err);
  });
}

// Zentrale Log-Funktion mit Zeitstempel + File-Log
function log(...args) {
  const ts = new Date().toISOString();
  const textParts = args.map((a) =>
    typeof a === "string" ? a : JSON.stringify(a)
  );
  const line = `[${ts}] ${textParts.join(" ")}`;

  // Konsole wie bisher
  console.log("[chatbot-worker]", ...args);
  // In Datei schreiben
  appendWorkerLog(line);
}

async function fetchActiveScenario() {
  try {
    const res = await fetch(CHATBOT_SCENARIO_URL);
    if (!res.ok) {
      log("Szenario-Check fehlgeschlagen:", res.status);
      return null;
    }
    const data = await res.json();
    return data?.scenario || null;
  } catch (err) {
    log("Fehler beim Laden des aktiven Szenarios:", err?.message || err);
    return null;
  }
}

/**
 * Prüft ob die Simulation aktuell läuft
 * @returns {Promise<{running: boolean, paused: boolean, stoppedReason: string|null, justStarted: boolean, stepCount: number}>}
 */
async function fetchSimulationStatus() {
  try {
    const res = await fetch(CHATBOT_STATUS_URL);
    if (!res.ok) {
      log("Status-Check fehlgeschlagen:", res.status);
      return {
        running: false,
        paused: false,
        stoppedReason: null,
        justStarted: false,
        stepCount: 0
      };
    }
    const data = await res.json();
    return {
      running: data?.simulation?.running || false,
      paused: data?.simulation?.paused || false,
      stoppedReason: data?.simulation?.stoppedReason || null,
      justStarted: data?.simulation?.justStarted || false,
      stepCount: data?.simulation?.stepCount || 0
    };
  } catch (err) {
    log("Fehler beim Laden des Simulationsstatus:", err?.message || err);
    return {
      running: false,
      paused: false,
      stoppedReason: null,
      justStarted: false,
      stepCount: 0
    };
  }
}

/**
 * Lädt Worker-Konfiguration aus worker_config.json
 * Falls Datei nicht existiert, wird Default-Config verwendet
 */
async function loadWorkerConfig() {
  try {
    const raw = await fsPromises.readFile(WORKER_CONFIG_FILE, "utf8");
    const config = JSON.parse(raw);
    return {
      intervalMs: config.intervalMs || WORKER_INTERVAL_MS,
      enabled: config.enabled !== false
    };
  } catch (err) {
    // Datei existiert nicht oder ist ungültig - verwende Defaults
    return {
      intervalMs: WORKER_INTERVAL_MS,
      enabled: true
    };
  }
}

/**
 * Überwacht worker_config.json und passt Intervall an
 */
async function checkWorkerConfig() {
  const config = await loadWorkerConfig();

  if (!config.enabled) {
    // Worker sollte deaktiviert werden (wird nicht implementiert, da stopWorker() nötig)
    return;
  }

  if (config.intervalMs !== currentWorkerIntervalMs) {
    restartWorkerInterval(config.intervalMs);
  }
}

function restartWorkerInterval(intervalMs) {
  if (!intervalMs || intervalMs <= 0) return;
  if (intervalMs === currentWorkerIntervalMs) return;
  currentWorkerIntervalMs = intervalMs;
  if (workerIntervalId !== null) {
    clearInterval(workerIntervalId);
  }
  workerIntervalId = setInterval(runOnce, currentWorkerIntervalMs);
  log("Worker-Intervall angepasst:", currentWorkerIntervalMs, "ms");
}

function limitIncidentCreates(ops, scenarioSimulation, boardCount) {
  if (!scenarioSimulation) return ops;

  const createOps = ops?.board?.createIncidentSites || [];
  if (!createOps.length) return ops;

  const maxNewPerStep = scenarioSimulation.incidentLimits?.maxNewPerStep;
  const maxTotal = scenarioSimulation.incidentLimits?.maxTotal;

  let allowed = null;
  if (Number.isFinite(maxNewPerStep)) {
    allowed = maxNewPerStep;
  }

  if (Number.isFinite(maxTotal)) {
    const remaining = Math.max(0, maxTotal - boardCount);
    allowed = allowed === null ? remaining : Math.min(allowed, remaining);
  }

  if (allowed === null) return ops;

  const limited = createOps.slice(0, Math.max(0, allowed));
  if (limited.length !== createOps.length) {
    log("Einsatz-Limit aktiv:", {
      allowed,
      requested: createOps.length,
      boardCount
    });
  }

  return {
    ...ops,
    board: {
      ...ops.board,
      createIncidentSites: limited
    }
  };
}

// NEU: GPU-Status loggen
async function logGpuStatus() {
  try {
    const status = await getGpuStatus();
    if (status.available && status.gpus?.[0]) {
      const gpu = status.gpus[0];
      log(`GPU: ${gpu.name} | VRAM: ${gpu.memoryUsedMb}/${gpu.memoryTotalMb}MB | Temp: ${gpu.temperatureCelsius || "?"}°C`);
      if (status.warning) {
        log(`GPU-WARNUNG: ${status.warning}`);
      }
    }
  } catch (err) {
    // Ignorieren
  }
}
// -----------------------------------------------------------

// Debug
log("Worker dataDir:", dataDir);
log("Worker erwartet roles.json an:", path.join(dataDir, FILES.roles));

async function safeReadJson(filePath, def) {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return def;
  }
}
async function safeWriteJson(filePath, data) {
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function countBoardItems(boardRaw = {}) {
  const columns = boardRaw.columns || {};
  return Object.values(columns).reduce((sum, col) => {
    const items = Array.isArray(col.items) ? col.items.length : 0;
    return sum + items;
  }, 0);
}

async function readStateCounts() {
  const boardPath = path.join(dataDir, FILES.board);
  const protokollPath = path.join(dataDir, FILES.protokoll);

  const [boardRaw, protokollRaw] = await Promise.all([
    safeReadJson(boardPath, { columns: {} }),
    safeReadJson(protokollPath, [])
  ]);

  const roles = await loadRoles();
  const roleIds = [...roles.active, ...roles.missing]
    .map((role) => normalizeRole(role))
    .filter((role, index, arr) => role && arr.indexOf(role) === index);
  const boards = await Promise.all(
    roleIds.map((roleId) =>
      readAufgBoardFile(path.join(dataDir, `Aufg_board_${roleId}.json`), {
        roleId,
        logError: (message, data) => log(message, data),
        writeBack: true,
        backupOnChange: true
      })
    )
  );
  const aufgabenCount = boards.reduce((sum, board) => {
    const items = Array.isArray(board?.items) ? board.items.length : 0;
    return sum + items;
  }, 0);

  return {
    boardCount: countBoardItems(boardRaw),
    aufgabenCount,
    protokollCount: Array.isArray(protokollRaw) ? protokollRaw.length : 0
  };
}

function buildMemoryQueryFromState(state = {}) {
  const incidentCount = state.boardCount ?? 0;
  const taskCount = state.aufgabenCount ?? 0;
  const protocolCount = state.protokollCount ?? 0;

  return `Aktuelle Lage: ${incidentCount} Einsatzstellen, ${taskCount} offene Aufgaben, ${protocolCount} Protokolleinträge. Relevante frühere Entscheidungen zur Hochwasserlage und Stabsarbeit.`;
}

function buildMemorySummary({
  stateAfter = {},
  appliedBoardOps = {},
  appliedAufgabenOps = {},
  appliedProtokollOps = {}
}) {
  const incidentCount = stateAfter.boardCount ?? 0;
  const taskCount = stateAfter.aufgabenCount ?? 0;

  let text = `Simulationsschritt: ${incidentCount} Einsatzstellen aktiv, ${taskCount} offene Aufgaben.`;

  if (appliedBoardOps.createIncidentSites?.length) {
    const titles = appliedBoardOps.createIncidentSites
      .map((i) => i.title)
      .filter(Boolean);
    if (titles.length) {
      text += ` Neue Einsatzstellen: ${titles.join(", ")}.`;
    }
  }

  if (appliedAufgabenOps.create?.length) {
    const titles = appliedAufgabenOps.create
      .map((t) => t.title)
      .filter(Boolean);
    if (titles.length) {
      text += ` Neue Aufgaben: ${titles.join(", ")}.`;
    }
  }

  if (appliedProtokollOps.create?.length) {
    text += ` Neue Protokolleinträge: ${appliedProtokollOps.create.length}.`;
  }

  return text;
}

async function loadRoles() {
  const rolesPath = path.join(dataDir, FILES.roles);
  const rolesRaw = await safeReadJson(rolesPath, {
    roles: { active: [], missing: [] }
  });
  const active = rolesRaw?.roles?.active || [];
  const missing = rolesRaw?.roles?.missing || [];
  return { active, missing };
}

// isAllowedOperation und explainOperationRejection werden aus
// ../chatbot/server/simulation_helpers.js importiert (ohne "via"-Prüfung)

/**
 * Board-Operations auf Kanban-Struktur anwenden:
 * board.json:
 * {
 *   "columns": {
 *     "neu": { name, items: [...] },
 *     "in-bearbeitung": { ... },
 *     "erledigt": { ... }
 *   }
 * }
 */
function ensureBoardStructure(boardRaw) {
  if (!boardRaw || typeof boardRaw !== "object") boardRaw = {};
  if (!boardRaw.columns || typeof boardRaw.columns !== "object") {
    boardRaw.columns = {};
  }
  if (!boardRaw.columns["neu"]) {
    boardRaw.columns["neu"] = { name: "Neu", items: [] };
  }
  if (!boardRaw.columns["in-bearbeitung"]) {
    boardRaw.columns["in-bearbeitung"] = {
      name: "In Bearbeitung",
      items: []
    };
  }
  if (!boardRaw.columns["erledigt"]) {
    boardRaw.columns["erledigt"] = { name: "Erledigt", items: [] };
  }
  return boardRaw;
}

async function applyBoardOperations(boardOps, activeRoles, staffRoles) {
  const boardPath = path.join(dataDir, FILES.board);
  let boardRaw = await safeReadJson(boardPath, { columns: {} });
  boardRaw = ensureBoardStructure(boardRaw);

  const appliedCreate = [];
  const appliedUpdate = [];
  const staffRoleSet = new Set(
    Array.isArray(staffRoles)
      ? staffRoles.map((role) => normalizeRole(role)).filter(Boolean)
      : []
  );
  const allowedOptions = { allowedRoles: Array.from(staffRoleSet) };

  const createOps = boardOps?.createIncidentSites || [];
  const updateOps = boardOps?.updateIncidentSites || [];

  // CREATE → neue Karte in Spalte "neu"
  for (const op of createOps) {
    const createOptions = { ...allowedOptions, operationType: "board.create" };
    if (!isAllowedOperation(op, activeRoles, createOptions)) {
      const reason = explainOperationRejection(op, activeRoles, createOptions);
      log("Board-Create verworfen:", { op, reason, activeRoles });

      appendOpsVerworfenLog({
        kind: "board.create",
        op,
        reason,
        activeRoles
      });

      continue;
    }

    const id = `cb-incident-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const nowIso = new Date().toISOString();

    const newItem = {
      id,
      content: op.content || "Einsatzstelle (KI)",
      createdAt: nowIso,
      statusSince: nowIso,
      assignedVehicles: [],
      everVehicles: [],
      everPersonnel: 0,
      ort: op.ort || "",
      typ: op.description || "",
      externalId: null,
      alerted: "",
      latitude: null,
      longitude: null,
      location: "",
      timestamp: nowIso,
      description: op.description || "",
      everVehicleLabels: {},
      updated: nowIso,
      isArea: false,
      areaCardId: null,
      areaColor: null,
      humanId: null,
      createdBy: "LAWZ" // Default-Anleger für alle Einsätze
    };

    boardRaw.columns["neu"].items.push(newItem);
    appliedCreate.push(op);
    log("Board-Create angewandt:", id);
  }

  // UPDATE → passende Karte in allen Spalten suchen
  const allItems = [];
  for (const colKey of Object.keys(boardRaw.columns)) {
    const col = boardRaw.columns[colKey];
    if (!col || !Array.isArray(col.items)) continue;
    for (const it of col.items) {
      allItems.push({ colKey, col, it });
    }
  }

  for (const op of updateOps) {
    const updateOptions = { ...allowedOptions, operationType: "board.update" };
    if (!isAllowedOperation(op, activeRoles, updateOptions)) {
      const reason = explainOperationRejection(op, activeRoles, updateOptions);
      log("Board-Update verworfen:", { op, reason, activeRoles });

      appendOpsVerworfenLog({
        kind: "board.update",
        op,
        reason,
        activeRoles
      });

      continue;
    }

    const target = allItems.find((x) => x.it.id === op.incidentId);
    if (!target) {
      log("Board-Update: Incident nicht gefunden:", op.incidentId);
      continue;
    }

    const changes = op.changes || {};

    // Erlaubte Felder auf der Karte (Schema nicht zerstören)
    if ("content" in changes) {
      target.it.content = changes.content || target.it.content;
    }
    if ("description" in changes) {
      target.it.description = changes.description;
    }
    if ("ort" in changes) {
      target.it.ort = changes.ort;
    }

    // Status-Änderung → Spaltenwechsel?
    if ("status" in changes) {
      const status = changes.status;
      let targetColKey = null;
      if (status === "neu") targetColKey = "neu";
      else if (status === "in-bearbeitung") targetColKey = "in-bearbeitung";
      else if (status === "erledigt") targetColKey = "erledigt";

      if (targetColKey && targetColKey !== target.colKey) {
        // aus alter Spalte entfernen
        target.col.items = target.col.items.filter(
          (card) => card.id !== target.it.id
        );
        // in neue Spalte einfügen
        ensureBoardStructure(boardRaw);
        boardRaw.columns[targetColKey].items.push(target.it);
        target.it.statusSince = new Date().toISOString();
        log(
          "Board-Update: Incident verschoben",
          op.incidentId,
          "->",
          targetColKey
        );
      }
    }

    target.it.updated = new Date().toISOString();
    appliedUpdate.push(op);
    log("Board-Update angewandt:", op.incidentId);
  }

  await safeWriteJson(boardPath, boardRaw);

  return {
    appliedCount: appliedCreate.length + appliedUpdate.length,
    appliedOps: {
      createIncidentSites: appliedCreate,
      updateIncidentSites: appliedUpdate
    }
  };
}

function resolveTaskBoardRoleId(task) {
  return normalizeRole(
    task?.responsible ||
      task?.createdBy ||
      task?.assignedBy ||
      task?.originRole ||
      task?.fromRole
  );
}

async function loadAufgabenBoardsForRoles(roles) {
  const uniqueRoles = roles
    .map((role) => normalizeRole(role))
    .filter((role, index, arr) => role && arr.indexOf(role) === index);
  const entries = await Promise.all(
    uniqueRoles.map(async (roleId) => {
      const filePath = path.join(dataDir, `Aufg_board_${roleId}.json`);
      const board = await readAufgBoardFile(filePath, {
        roleId,
        logError: (message, data) => log(message, data),
        writeBack: true,
        backupOnChange: true
      });
      return { roleId, filePath, board };
    })
  );
  return new Map(entries.map((entry) => [entry.roleId, entry]));
}

async function applyAufgabenOperations(taskOps, activeRoles, staffRoles = []) {
  const createOps = taskOps?.create || [];
  const updateOps = taskOps?.update || [];
  const staffRoleSet = new Set(
    staffRoles.map((role) => normalizeRole(role)).filter(Boolean)
  );
  const isAllowedStaffRole = (role) => {
    if (staffRoleSet.size > 0) {
      return staffRoleSet.has(normalizeRole(role));
    }
    return isStabsstelle(role);
  };
  const allowedOptions = { allowedRoles: Array.from(staffRoleSet) };
  const roleCandidates = [
    ...staffRoles,
    ...createOps.map(resolveTaskBoardRoleId),
    ...updateOps.map((op) => resolveTaskBoardRoleId(op?.changes))
  ]
    .filter(Boolean)
    .filter((role) => isAllowedStaffRole(role));
  const boardsByRole = await loadAufgabenBoardsForRoles(roleCandidates);

  const appliedCreate = [];
  const appliedUpdate = [];

  // CREATE → neue Aufgabe im S2-Board
  for (const op of createOps) {
    const createOptions = { ...allowedOptions, operationType: "aufgaben.create" };
    if (!isAllowedOperation(op, activeRoles, createOptions)) {
      const reason = explainOperationRejection(op, activeRoles, createOptions);
      log("Aufgaben-Create verworfen:", { op, reason, activeRoles });

      appendOpsVerworfenLog({
        kind: "aufgaben.create",
        op,
        reason,
        activeRoles
      });

      continue;
    }
    const id = `cb-task-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const newTask = {
      id,
      clientId: null,
      title: op.title || "Aufgabe (KI)",
      type: op.type || "Auftrag",
      responsible: op.responsible || "",
      desc: op.desc || "",
      status: "Neu",
      dueAt: null,
      createdAt: now,
      updatedAt: now,
      kind: "task",
      meta: {
        source: "chatbot",
        protoNr: op.linkedProtocolId || null
      },
      originProtocolNr: op.linkedProtocolId || null,
      assignedBy: "LTSTB",  // Immer LTSTB - Aufgaben werden vom Leiter Technischer Stab vergeben
      createdBy: "LTSTB",   // Leiter Technischer Stab (Stabsrolle)
      relatedIncidentId: op.relatedIncidentId || null,
      incidentTitle: null,
      linkedProtocolNrs: op.linkedProtocolId ? [op.linkedProtocolId] : [],
      linkedProtocols: []
    };
    const targetRole = resolveTaskBoardRoleId(newTask);
    const boardEntry = boardsByRole.get(targetRole);
    if (!boardEntry) {
      log("Aufgabe-Create: Kein Board für Rolle gefunden:", targetRole || "UNBEKANNT");
      continue;
    }
    boardEntry.board.items.push(newTask);
    appliedCreate.push(op);
    log("Aufgabe-Create angewandt:", id);
  }

  // UPDATE → vorhandene Tasks aktualisieren
  for (const op of updateOps) {
    // Zuerst prüfen ob die Aufgabe existiert (Anforderung: aufgaben.update nur wenn Aufgabe existiert)
    let targetEntry = null;
    let idx = -1;
    for (const entry of boardsByRole.values()) {
      idx = entry.board.items.findIndex((t) => t.id === op.taskId);
      if (idx !== -1) {
        targetEntry = entry;
        break;
      }
    }
    if (!targetEntry || idx === -1) {
      log("Aufgabe-Update verworfen: Task existiert nicht:", op.taskId);
      appendOpsVerworfenLog({
        kind: "aufgaben.update",
        op,
        reason: `Aufgabe mit ID "${op.taskId}" existiert nicht`,
        activeRoles
      });
      continue;
    }

    const updateOptions = { ...allowedOptions, operationType: "aufgaben.update" };
    if (!isAllowedOperation(op, activeRoles, updateOptions)) {
      const reason = explainOperationRejection(op, activeRoles, updateOptions);
      log("Aufgaben-Update verworfen:", { op, reason, activeRoles });

      appendOpsVerworfenLog({
        kind: "aufgaben.update",
        op,
        reason,
        activeRoles
      });

      continue;
    }
    const changes = op.changes || {};

    // nur Felder anfassen, die im S2-Board existieren
    const t = targetEntry.board.items[idx];
    if ("title" in changes) t.title = changes.title;
    if ("desc" in changes) t.desc = changes.desc;
    if ("status" in changes) t.status = changes.status;
    if ("responsible" in changes) {
      t.responsible = changes.responsible;
    }
    if ("relatedIncidentId" in changes) {
      t.relatedIncidentId = changes.relatedIncidentId;
    }
    if ("linkedProtocolId" in changes) {
      t.originProtocolNr = changes.linkedProtocolId;
      t.meta = t.meta || {};
      t.meta.protoNr = changes.linkedProtocolId;
    }

    t.updatedAt = Date.now();
    appliedUpdate.push(op);
    log("Aufgabe-Update angewandt:", op.taskId);
  }

  await Promise.all(
    Array.from(boardsByRole.values()).map((entry) =>
      writeAufgBoardFile(entry.filePath, entry.board)
    )
  );

  return {
    appliedCount: appliedCreate.length + appliedUpdate.length,
    appliedOps: {
      create: appliedCreate,
      update: appliedUpdate
    }
  };
}

function resolveProtokollAnvon(op) {
  const candidates = [
    op?.anvon,
    op?.ab,
    op?.av,
    op?.von,
    op?.from,
    op?.sender,
    op?.r,
    op?.assignedBy,
    op?.responsible,
    op?.createdBy,
    op?.originRole,
    op?.fromRole
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  // Default bei Statuswechsel oder wenn keine Rolle gefunden
  return "LTSTB";
}

/**
 * Sanitisiert Operations-Objekte um häufige LLM-Fehler zu korrigieren
 * BUGFIX: LLM verwendet manchmal falsche Feldnamen (from/sender statt anvon)
 */
function sanitizeOperations(ops) {
  if (!ops || typeof ops !== "object") return ops;

  // Sanitiere Board-Update-Operations
  if (ops.board?.updateIncidentSites) {
    ops.board.updateIncidentSites = ops.board.updateIncidentSites.map((op) => {
      const sanitized = { ...op };

      // BUGFIX E: LLM verwendet manchmal "id" statt "incidentId"
      if (op.id && !op.incidentId) {
        sanitized.incidentId = op.id;
        delete sanitized.id;
        log("Board update: id → incidentId normalisiert");
      }

      return sanitized;
    });
  }

  // Sanitiere Aufgaben-Update-Operations
  if (ops.aufgaben?.update) {
    ops.aufgaben.update = ops.aufgaben.update.map((op) => {
      const sanitized = { ...op };

      // BUGFIX E: LLM verwendet manchmal "id" statt "taskId"
      if (op.id && !op.taskId) {
        sanitized.taskId = op.id;
        delete sanitized.id;
        log("Aufgaben update: id → taskId normalisiert");
      }

      return sanitized;
    });
  }

  // Sanitiere Protokoll-Operations
  if (ops.protokoll?.create) {
    ops.protokoll.create = ops.protokoll.create.map((op) => {
      const sanitized = { ...op };

      // BUGFIX D: LLM verwendet manchmal from/sender statt anvon
      if (!sanitized.anvon && (op.from || op.sender || op.von || op.av)) {
        sanitized.anvon = resolveProtokollAnvon(op);
        log("Protokoll anvon sanitized:", {
          original: { from: op.from, sender: op.sender, von: op.von, av: op.av },
          sanitized: sanitized.anvon
        });
      }

      // BUGFIX C: Stelle sicher dass anvon nie null ist
      if (!sanitized.anvon) {
        sanitized.anvon = "LTSTB";
        log("Protokoll anvon fehlte - gesetzt auf LTSTB");
      }

      // BUGFIX: Stelle sicher dass richtung gesetzt ist
      if (!sanitized.richtung) {
        sanitized.richtung = "ein";
      }

      return sanitized;
    });
  }

  // Sanitiere Aufgaben-Operations
  if (ops.aufgaben?.create) {
    ops.aufgaben.create = ops.aufgaben.create.map((op) => {
      const sanitized = { ...op };

      // assignedBy ist immer LTSTB - Aufgaben werden vom Leiter Technischer Stab vergeben
      sanitized.assignedBy = "LTSTB";

      // BUGFIX: Stelle sicher dass responsible gesetzt ist
      if (!sanitized.responsible) {
        sanitized.responsible = "LTSTB";
      }

      return sanitized;
    });
  }

  return ops;
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeRole(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;]/)
      .map((entry) => normalizeRole(entry))
      .filter(Boolean);
  }
  return [];
}

function hasZu(entry) {
  if (!entry) return false;
  if (typeof entry.zu === "string") return entry.zu.trim() !== "";
  return entry.zu !== null && entry.zu !== undefined && String(entry.zu).trim() !== "";
}

function isBotEntry(entry) {
  const createdBy = entry?.createdBy || entry?.history?.[0]?.by || "";
  const kanalNr = entry?.uebermittlungsart?.kanalNr || "";
  return (
    createdBy === "CHATBOT" ||
    createdBy === "LTSTB" ||
    createdBy === "simulation-worker" ||
    createdBy === "bot" ||
    kanalNr === "bot" ||
    kanalNr === "CHATBOT"
  );
}

function isQuestionEntry(entry) {
  const infoTyp = String(entry?.infoTyp || entry?.typ || "");
  const information = String(entry?.information || "");
  return /rueckfrage|rückfrage/i.test(infoTyp) || information.includes("?");
}

/**
 * Markiert eine Frage als beantwortet durch Setzen von rueckmeldung1="answered".
 *
 * Wird aufgerufen wenn das LLM eine Antwort (Rückmeldung) erstellt.
 * Die Original-Frage wird über bezugNr oder Sender/Empfänger-Matching gefunden.
 */
function markAnsweredQuestion(protokoll, responseEntry) {
  if (!responseEntry || !Array.isArray(protokoll)) return;

  // Nur bei Rückmeldungen (Antworten) markieren
  const infoTyp = String(responseEntry.infoTyp || responseEntry.typ || "");
  if (!/rueckmeldung|rückmeldung/i.test(infoTyp)) return;

  const responseSender = normalizeRole(responseEntry.anvon || "");
  const responseRecipients = normalizeRecipients(
    responseEntry.ergehtAn || responseEntry.ergehtAnText || []
  );
  if (!responseSender || responseRecipients.length === 0) return;

  // Fall 1: Direkte Referenz über bezugNr
  const refNr =
    responseEntry.bezugNr || responseEntry.referenzNr || responseEntry.antwortAuf;
  if (refNr) {
    const directMatch = protokoll.find((entry) => String(entry.nr) === String(refNr));
    if (directMatch && !directMatch.rueckmeldung1) {
      directMatch.rueckmeldung1 = "answered";
      log("Frage als beantwortet markiert (bezugNr):", { questionNr: directMatch.nr, answerNr: responseEntry.nr });
    }
    return;
  }

  // Fall 2: Matching über Sender/Empfänger
  const candidates = protokoll.filter((entry) => {
    // Bereits beantwortet? (rueckmeldung1 gesetzt)
    if (entry.rueckmeldung1) return false;
    // Vom Bot erstellt?
    if (isBotEntry(entry)) return false;
    // Ist es eine Frage?
    if (!isQuestionEntry(entry)) return false;

    const questionSender = normalizeRole(entry.anvon || "");
    const questionRecipients = normalizeRecipients(
      entry.ergehtAn || entry.ergehtAnText || []
    );
    if (!questionSender || questionRecipients.length === 0) return false;

    // Antwort-Sender war Empfänger der Frage UND
    // Antwort-Empfänger war Sender der Frage
    return (
      questionRecipients.includes(responseSender) &&
      responseRecipients.includes(questionSender)
    );
  });

  if (!candidates.length) return;

  // Neueste passende Frage finden
  const target = candidates.reduce((latest, entry) => {
    const latestNr = Number(latest.nr);
    const entryNr = Number(entry.nr);
    if (Number.isFinite(latestNr) && Number.isFinite(entryNr)) {
      return entryNr > latestNr ? entry : latest;
    }
    const latestTime = `${latest.datum || ""} ${latest.zeit || ""}`;
    const entryTime = `${entry.datum || ""} ${entry.zeit || ""}`;
    return entryTime > latestTime ? entry : latest;
  });

  // Frage als beantwortet markieren
  target.rueckmeldung1 = "answered";
  log("Frage als beantwortet markiert (matching):", { questionNr: target.nr, answerNr: responseEntry.nr });
}

async function applyProtokollOperations(protoOps, activeRoles, staffRoles) {
  const protPath = path.join(dataDir, FILES.protokoll);
  let prot = await safeReadJson(protPath, []);

  const appliedCreate = [];
  const staffRoleSet = new Set(
    Array.isArray(staffRoles)
      ? staffRoles.map((role) => normalizeRole(role)).filter(Boolean)
      : []
  );
  const allowedOptions = {
    allowedRoles: Array.from(staffRoleSet),
    allowExternal: true
  };

  const createOps = protoOps?.create || [];

  for (const op of createOps) {
    const createOptions = { ...allowedOptions, operationType: "protokoll.create" };
    if (!isAllowedOperation(op, activeRoles, createOptions)) {
      const reason = explainOperationRejection(op, activeRoles, createOptions);
      log("Protokoll-Create verworfen:", { op, reason, activeRoles });

      appendOpsVerworfenLog({
        kind: "protokoll.create",
        op,
        reason,
        activeRoles
      });

      continue;
    }

    const now = new Date();
    const id = `cb-prot-${now.getTime()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const datum = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const zeit = now.toISOString().slice(11, 16); // HH:MM

    const entry = {
      id,
      nr: (prot.length ? prot.length + 1 : 1),
      datum,
      zeit,
      infoTyp: op.infoTyp || "Info",
      anvon: resolveProtokollAnvon(op),
      uebermittlungsart: {
        kanalNr: "CHATBOT",
        kanal: "Chatbot",
        art: "intern",
        ein: true,
        aus: false
      },
      information: op.information || "",
      rueckmeldung1: "",
      ergehtAn: Array.isArray(op.ergehtAn) ? op.ergehtAn : (op.ergehtAn ? [op.ergehtAn] : []),
      ergehtAnText: Array.isArray(op.ergehtAn) ? op.ergehtAn.join(", ") : (op.ergehtAn || ""),
      lagebericht: "",
      massnahmen: [
        {
          massnahme: "",
          verantwortlich: Array.isArray(op.ergehtAn) ? (op.ergehtAn[0] || "") : (op.ergehtAn || ""),
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        }
      ],
      printCount: 0,
      history: [
        {
          ts: now.getTime(),
          action: "create",
          by: op.originRole || "LTSTB",
          after: {} // nicht nötig, kann leer bleiben oder minimal
        }
      ],
      lastBy: op.originRole || "LTSTB",
      createdBy: "LTSTB",  // Leiter Technischer Stab (Stabsrolle)
      zu: ""
    };

    markAnsweredQuestion(prot, entry);
    prot.push(entry);
    appliedCreate.push(op);
    log("Protokoll-Create angewandt:", id);
  }

  await safeWriteJson(protPath, prot);

  return {
    appliedCount: appliedCreate.length,
    appliedOps: { create: appliedCreate }
  };
}

async function runOnce() {
  if (isRunning) {
    log("Vorheriger Worker-Durchlauf läuft noch – überspringe.");
    return;
  }

  // Prüfe ob Simulation aktiv ist - Worker wird nur für Simulation gebraucht
  const simStatus = await fetchSimulationStatus();
  if (!simStatus.running && !simStatus.paused) {
    // Simulation wurde beendet (timeout oder manuell) - Worker beenden
    if (simStatus.stoppedReason) {
      log(`Simulation wurde beendet (${simStatus.stoppedReason}) – Worker wird gestoppt.`);
      stopWorker();
      process.exit(0);
    }
    // Keine aktive Simulation - nichts zu tun
    return;
  }

  if (simStatus.paused) {
    // Simulation ist pausiert - nichts zu tun, aber loggen
    log("Simulation pausiert – überspringe Schritt.");
    return;
  }

  // Zuerst roles.json synchronisieren
  const { active, missing } = await syncRolesFile();

  // Prüfe ob activeRoles leer sind - wenn ja, pausiere Zeit und überspringe Schritt
  const noActiveRoles = !active || active.length === 0;
  const allowInitialStepWithoutRoles = noActiveRoles && simStatus.justStarted;

  if (noActiveRoles && !allowInitialStepWithoutRoles) {
    // Nur einmal loggen wenn Status wechselt
    if (!wasWaitingForRoles) {
      log("Keine aktiven Rollen vorhanden – warte auf Rollen, Zeit wird pausiert.");
      wasWaitingForRoles = true;
    }

    // Dem Server mitteilen, dass wir auf Rollen warten (pausiert die Zeit)
    try {
      await fetch(CHATBOT_WAITING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waiting: true })
      });
    } catch (err) {
      log("Fehler beim Setzen von waitingForRoles:", err?.message || err);
    }

    // Schritt überspringen, aber Worker weiter laufen lassen um auf Rollen zu warten
    return;
  }

  if (allowInitialStepWithoutRoles) {
    log("Keine aktiven Rollen vorhanden – initialer Simulationsschritt wird trotzdem ausgeführt.");
  }

  // Rollen sind wieder aktiv - Zeit wieder aktivieren wenn wir gewartet haben
  if (wasWaitingForRoles) {
    log("Rollen wieder aktiv – Simulation wird fortgesetzt.");
    wasWaitingForRoles = false;

    try {
      await fetch(CHATBOT_WAITING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waiting: false })
      });
    } catch (err) {
      log("Fehler beim Zurücksetzen von waitingForRoles:", err?.message || err);
    }
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    await logGpuStatus();

    const scenario = await fetchActiveScenario();
    if (scenario?.id !== cachedScenario?.id) {
      log("Aktives Szenario geändert:", scenario?.id || "kein Szenario");
      cachedScenario = scenario;
    }

    const intervalMs = getScenarioIntervalMs(scenario, WORKER_INTERVAL_MS);
    if (intervalMs) {
      restartWorkerInterval(intervalMs);
    }

    log(`Starte Simulationsschritt | aktive Rollen: ${active.length}`);

    const stateCounts = await readStateCounts();
    const memoryQuery = buildMemoryQueryFromState(stateCounts);
    let memorySnippets = [];

    try {
      const memoryHits = await searchMemory({ query: memoryQuery, topK: 5 });
      memorySnippets = memoryHits.map((hit) => hit.text);
    } catch (err) {
      log("Fehler bei Memory-Suche:", err?.message || err);
    }

    let retries = 0;
    let success = false;

    while (retries < MAX_RETRIES && !success) {
      const res = await fetch(CHATBOT_STEP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "worker", memorySnippets })
      });

      if (!res.ok) {
        let bodyText = "";
        try { bodyText = await res.text(); } catch {}

        let errorJson = null;
        try { errorJson = JSON.parse(bodyText); } catch {}

        const reason = errorJson?.reason || errorJson?.error;

        if (res.status === 500 && reason === "step_in_progress") {
          retries++;
          log(`LLM läuft noch (${retries}/${MAX_RETRIES}) – warte ${RETRY_DELAY_MS}ms...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        // BUGFIX: Auch bei HTTP-Fehler auf Timeout prüfen und Worker beenden
        // Der Server gibt HTTP 500 mit reason="timeout" zurück wenn die Zeit abgelaufen ist
        if (reason === "timeout" || reason === "not_running") {
          log(`Simulation beendet (${reason}) – Worker wird beendet.`);
          stopWorker();
          process.exit(0);
        }

        log("HTTP-Fehler:", res.status, bodyText.slice(0, 200));
        break;  // Fehler: Verlasse Schleife korrekt
      }

      const data = await res.json();

      if (!data.ok) {
        if (data.reason === "step_in_progress") {
          retries++;
          log(`LLM läuft noch (${retries}/${MAX_RETRIES}) – warte...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        // Simulation beendet (timeout oder manuell) - Worker beenden
        if (data.reason === "timeout" || data.reason === "not_running") {
          log(`Simulation beendet (${data.reason}) – Worker wird beendet.`);
          stopWorker();
          process.exit(0);
        }

        log("Schritt nicht ok:", data.error || data.reason);
        break;  // Fehler: Verlasse Schleife korrekt
      }

      // Erfolgreich
      success = true;
      // Transform LLM short field names (t, d, o, r, i, ea) to JSON long names (title, desc, etc.)
      let ops = transformLlmOperationsToJson(data.operations || {});

      // BUGFIX: Sanitize operations to fix common LLM errors (anvon=null, wrong field names, etc.)
      ops = sanitizeOperations(ops);

      const scenarioSimulation = scenario?.simulation
        ? normalizeScenarioSimulation(scenario)
        : null;
      ops = limitIncidentCreates(ops, scenarioSimulation, stateCounts.boardCount);

      const counts = {
        boardCreate: (ops.board?.createIncidentSites || []).length,
        boardUpdate: (ops.board?.updateIncidentSites || []).length,
        taskCreate: (ops.aufgaben?.create || []).length,
        taskUpdate: (ops.aufgaben?.update || []).length,
        protoCreate: (ops.protokoll?.create || []).length
      };

      log("LLM-Operationen:", counts);

      const applyResults = {
        board: { appliedCount: 0, appliedOps: {} },
        aufgaben: { appliedCount: 0, appliedOps: {} },
        protokoll: { appliedCount: 0, appliedOps: {} }
      };

      try {
        const staffRoles = [...active, ...missing];
        applyResults.board = await applyBoardOperations(
          ops.board || {},
          active,
          staffRoles
        );
        applyResults.aufgaben = await applyAufgabenOperations(
          ops.aufgaben || {},
          active,
          staffRoles
        );
        applyResults.protokoll = await applyProtokollOperations(
          ops.protokoll || {},
          active,
          staffRoles
        );
      } catch (err) {
        log("Fehler beim Anwenden:", err?.message || err);
        return;
      }

      if (data.analysis) {
        log("Analysis:", data.analysis.slice(0, 150));
      }

      const totalApplied =
        applyResults.board.appliedCount +
        applyResults.aufgaben.appliedCount +
        applyResults.protokoll.appliedCount;

      if (totalApplied > 0) {
        const stateAfter = await readStateCounts();
        const memoryText = buildMemorySummary({
          stateAfter,
          appliedBoardOps: applyResults.board.appliedOps || {},
          appliedAufgabenOps: applyResults.aufgaben.appliedOps || {},
          appliedProtokollOps: applyResults.protokoll.appliedOps || {}
        });

        await addMemory({
          text: memoryText,
          meta: { type: "step_summary", ts: new Date().toISOString(), source: "worker" }
        });

        // -------- NEU: Action-History speichern --------
        const actionHistoryEntries = [];

        // Einsatz-Creates
        const boardCreates = applyResults.board.appliedOps?.createIncidentSites || [];
        for (const op of boardCreates) {
          actionHistoryEntries.push(buildActionHistoryEntry(
            "create",
            "einsatz",
            {
              content: op.content || "Einsatzstelle (KI)",
              ort: op.ort || "",
              description: op.description || ""
            },
            op.id || null
          ));
        }

        // Einsatz-Updates
        const boardUpdates = applyResults.board.appliedOps?.updateIncidentSites || [];
        for (const op of boardUpdates) {
          actionHistoryEntries.push(buildActionHistoryEntry(
            "update",
            "einsatz",
            {
              incidentId: op.incidentId,
              changes: op.changes || {}
            },
            op.incidentId
          ));
        }

        // Aufgaben-Creates
        const taskCreates = applyResults.aufgaben.appliedOps?.create || [];
        for (const op of taskCreates) {
          actionHistoryEntries.push(buildActionHistoryEntry(
            "create",
            "aufgabe",
            {
              title: op.title || "Aufgabe (KI)",
              type: op.type || "Auftrag",
              responsible: op.responsible || "",
              desc: op.desc || ""
            },
            op.id || null
          ));
        }

        // Aufgaben-Updates
        const taskUpdates = applyResults.aufgaben.appliedOps?.update || [];
        for (const op of taskUpdates) {
          actionHistoryEntries.push(buildActionHistoryEntry(
            "update",
            "aufgabe",
            {
              taskId: op.taskId,
              changes: op.changes || {}
            },
            op.taskId
          ));
        }

        // Protokoll-Creates
        const protoCreates = applyResults.protokoll.appliedOps?.create || [];
        for (const op of protoCreates) {
          actionHistoryEntries.push(buildActionHistoryEntry(
            "create",
            "protokoll",
            {
              information: op.information || "",
              infoTyp: op.infoTyp || "Info",
              anvon: op.anvon || "",
              ergehtAn: op.ergehtAn || []
            },
            op.id || null
          ));
        }

        await appendActionHistory(actionHistoryEntries);
        // -----------------------------------------------------------
      }

      const duration = Date.now() - startTime;
      log(`Schritt abgeschlossen in ${duration}ms | Angewandt: ${totalApplied}`);

      await logGpuStatus();
    }

    if (!success) {
      log(`Max. Retries (${MAX_RETRIES}) erreicht oder Fehler aufgetreten.`);
    }
    
  } catch (err) {
    log("Fehler:", err.message);
  } finally {
    isRunning = false;
  }
}

async function startWorker() {
  // Lade initiale Config
  const config = await loadWorkerConfig();
  currentWorkerIntervalMs = config.intervalMs;

  // Reset waiting status beim Start
  wasWaitingForRoles = false;

  log("Chatbot-Worker gestartet, Intervall:", currentWorkerIntervalMs, "ms");
  runOnce();
  workerIntervalId = setInterval(runOnce, currentWorkerIntervalMs);

  // Starte Config-Überwachung (alle 10 Sekunden)
  configCheckIntervalId = setInterval(checkWorkerConfig, 10000);
}

function stopWorker() {
  if (workerIntervalId !== null) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
  }
  if (configCheckIntervalId !== null) {
    clearInterval(configCheckIntervalId);
    configCheckIntervalId = null;
  }
  log("Chatbot-Worker gestoppt");
}

async function bootstrap() {
  try {
    await initMemoryStore();
  } catch (err) {
    log("Fehler beim Initialisieren des Memory-Stores:", err?.message || err);
    process.exitCode = 1;
    return;
  }

  await startWorker();
}

bootstrap();

// Graceful shutdown on SIGINT and SIGTERM
process.on("SIGINT", () => {
  log("SIGINT empfangen, fahre Worker herunter...");
  stopWorker();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("SIGTERM empfangen, fahre Worker herunter...");
  stopWorker();
  process.exit(0);
});


