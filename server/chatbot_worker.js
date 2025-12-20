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

import { syncRolesFile } from "./roles_sync.js";
import { transformLlmOperationsToJson, isMeldestelle } from "./field_mapper.js";
import {
  confirmProtocolsByLtStb,
  updateTaskStatusForSimulatedRoles,
  ensureOneIncidentInProgress,
  assignVehiclesByDistance,
  deriveTasksFromProtocol,
  isAllowedOperation,
  explainOperationRejection
} from "./simulation_helpers.js";

const CHATBOT_STEP_URL = "http://127.0.0.1:3100/api/sim/step";
const WORKER_INTERVAL_MS = 30000;
let isRunning = false; // <--- NEU
let workerIntervalId = null; // Store interval ID for cleanup
// Pfad zu deinen echten Daten:
// Wir gehen davon aus, dass du den Worker IMMER aus dem server-Ordner startest:
//   cd C:\kanban41\server
//   node chatbot_worker.js
const dataDir = path.join(process.cwd(), "data");

// Dateinamen an deine Struktur angepasst
const FILES = {
  roles: "roles.json",
  board: "board.json",
  aufgabenS2: "Aufg_board_S2.json",
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
  const aufgabenPath = path.join(dataDir, FILES.aufgabenS2);
  const protokollPath = path.join(dataDir, FILES.protokoll);

  const [boardRaw, aufgabenRaw, protokollRaw] = await Promise.all([
    safeReadJson(boardPath, { columns: {} }),
    safeReadJson(aufgabenPath, []),
    safeReadJson(protokollPath, [])
  ]);

  return {
    boardCount: countBoardItems(boardRaw),
    aufgabenCount: Array.isArray(aufgabenRaw) ? aufgabenRaw.length : 0,
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

function isAllowedOperation(op, missingRoles) {
  if (!op) return false;
  const originRole = op.originRole;
  const via = op.via;
  const fromRole = op.fromRole || op.assignedBy;
  if (!originRole || !fromRole) return false;
  if (!missingRoles.includes(originRole)) return false;
  if (!missingRoles.includes(fromRole)) return false;
  if (via !== "Meldestelle" && via !== "Meldestelle/S6") return false;
  return true;
}

function explainOperationRejection(op, missingRoles) {
  const reasons = [];
  if (!op) {
    reasons.push("Operation ist leer/undefined.");
    return reasons.join(" ");
  }

  const originRole = op.originRole;
  const via = op.via;
  const fromRole = op.fromRole || op.assignedBy;

  if (!originRole) {
    reasons.push("originRole fehlt.");
  }
  if (!fromRole) {
    reasons.push("fromRole/assignedBy fehlt.");
  }
  if (originRole && !missingRoles.includes(originRole)) {
    reasons.push(
      `originRole "${originRole}" ist nicht in missingRoles (${JSON.stringify(
        missingRoles
      )}).`
    );
  }
  if (fromRole && !missingRoles.includes(fromRole)) {
    reasons.push(
      `fromRole/assignedBy "${fromRole}" ist nicht in missingRoles (${JSON.stringify(
        missingRoles
      )}).`
    );
  }
  if (via !== "Meldestelle" && via !== "Meldestelle/S6") {
    reasons.push(
      `via ist "${via}" – erlaubt ist nur "Meldestelle" oder "Meldestelle/S6".`
    );
  }

  if (!reasons.length) {
    reasons.push("Unbekannter Grund – isAllowedOperation() hat false geliefert.");
  }

  return reasons.join(" ");
}


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

async function applyBoardOperations(boardOps, missingRoles) {
  const boardPath = path.join(dataDir, FILES.board);
  let boardRaw = await safeReadJson(boardPath, { columns: {} });
  boardRaw = ensureBoardStructure(boardRaw);

  const appliedCreate = [];
  const appliedUpdate = [];

  const createOps = boardOps?.createIncidentSites || [];
  const updateOps = boardOps?.updateIncidentSites || [];

  // CREATE → neue Karte in Spalte "neu"
  for (const op of createOps) {
    if (!isAllowedOperation(op, missingRoles)) {
      const reason = explainOperationRejection(op, missingRoles);
      log("Board-Create verworfen:", { op, reason, missingRoles });

      appendOpsVerworfenLog({
        kind: "board.create",
        op,
        reason,
        missingRoles
      });

      continue;
    }
    const id = `cb-incident-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const nowIso = new Date().toISOString();

    const newItem = {
      id,
      content: op.title || "Einsatzstelle (KI)",
      createdAt: nowIso,
      statusSince: nowIso,
      assignedVehicles: [],
      everVehicles: [],
      everPersonnel: 0,
      ort: op.locationHint || "",
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
      humanId: null
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
    if (!isAllowedOperation(op, missingRoles)) {
      const reason = explainOperationRejection(op, missingRoles);
      log("Board-Update verworfen:", { op, reason, missingRoles });

      appendOpsVerworfenLog({
        kind: "board.update",
        op,
        reason,
        missingRoles
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
    if ("title" in changes || "content" in changes) {
      target.it.content = changes.title || changes.content || target.it.content;
    }
    if ("description" in changes) {
      target.it.description = changes.description;
    }
    if ("ort" in changes || "locationHint" in changes) {
      target.it.ort = changes.ort || changes.locationHint;
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

async function applyAufgabenOperations(taskOps, missingRoles) {
  const tasksPath = path.join(dataDir, FILES.aufgabenS2);
  let tasks = await safeReadJson(tasksPath, []);

  const appliedCreate = [];
  const appliedUpdate = [];

  const createOps = taskOps?.create || [];
  const updateOps = taskOps?.update || [];

  // CREATE → neue Aufgabe im S2-Board
  for (const op of createOps) {
    if (!isAllowedOperation(op, missingRoles)) {
      const reason = explainOperationRejection(op, missingRoles);
      log("Aufgaben-Create verworfen:", { op, reason, missingRoles });

      appendOpsVerworfenLog({
        kind: "aufgaben.create",
        op,
        reason,
        missingRoles
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
      responsible: op.forRole || "",
      desc: op.description || "",
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
      createdBy: "CHATBOT",
      relatedIncidentId: op.linkedIncidentId || null,
      incidentTitle: null,
      linkedProtocolNrs: op.linkedProtocolId ? [op.linkedProtocolId] : [],
      linkedProtocols: []
    };
    tasks.push(newTask);
    appliedCreate.push(op);
    log("Aufgabe-Create angewandt:", id);
  }

  // UPDATE → vorhandene Tasks aktualisieren
  for (const op of updateOps) {
    if (!isAllowedOperation(op, missingRoles)) {
      const reason = explainOperationRejection(op, missingRoles);
      log("Aufgaben-Update verworfen:", { op, reason, missingRoles });

      appendOpsVerworfenLog({
        kind: "aufgaben.update",
        op,
        reason,
        missingRoles
      });

      continue;
    }

    const idx = tasks.findIndex((t) => t.id === op.taskId);
    if (idx === -1) {
      log("Aufgabe-Update: Task nicht gefunden:", op.taskId);
      continue;
    }
    const changes = op.changes || {};

    // nur Felder anfassen, die im S2-Board existieren
    const t = tasks[idx];
    if ("title" in changes) t.title = changes.title;
    if ("description" in changes) t.desc = changes.description;
    if ("status" in changes) t.status = changes.status;
    if ("forRole" in changes || "responsible" in changes) {
      t.responsible = changes.forRole || changes.responsible;
    }
    if ("linkedIncidentId" in changes) {
      t.relatedIncidentId = changes.linkedIncidentId;
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

  await safeWriteJson(tasksPath, tasks);

  return {
    appliedCount: appliedCreate.length + appliedUpdate.length,
    appliedOps: {
      create: appliedCreate,
      update: appliedUpdate
    }
  };
}

async function applyProtokollOperations(protoOps, missingRoles) {
  const protPath = path.join(dataDir, FILES.protokoll);
  let prot = await safeReadJson(protPath, []);

  const appliedCreate = [];

  const createOps = protoOps?.create || [];

  for (const op of createOps) {
    if (!isAllowedOperation(op, missingRoles)) {
      const reason = explainOperationRejection(op, missingRoles);
      log("Protokoll-Create verworfen:", { op, reason, missingRoles });

      appendOpsVerworfenLog({
        kind: "protokoll.create",
        op,
        reason,
        missingRoles
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
      infoTyp: op.category || "Info",
      anvon: op.fromRole || "Chatbot",
      uebermittlungsart: {
        kanalNr: "CHATBOT",
        kanal: "Chatbot",
        art: "intern",
        ein: true,
        aus: false
      },
      information: op.content || "",
      rueckmeldung1: "",
      rueckmeldung2: "",
      ergehtAn: op.toRole ? [op.toRole] : [],
      ergehtAnText: op.toRole || "",
      lagebericht: "",
      massnahmen: [
        {
          massnahme: "",
          verantwortlich: op.toRole || "",
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
          by: op.originRole || "CHATBOT",
          after: {} // nicht nötig, kann leer bleiben oder minimal
        }
      ],
      lastBy: op.originRole || "CHATBOT",
      createdBy: "CHATBOT",
      zu: ""
    };

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

  isRunning = true;
  const startTime = Date.now();
  
  try {
    await logGpuStatus();
    
    const { missing } = await loadRoles();
    if (!missing.length) {
      log("Keine missingRoles – nichts zu tun.");
      return;
    }

    log(`Starte Simulationsschritt mit ${missing.length} fehlenden Rollen`);

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
    
    while (retries < MAX_RETRIES) {
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

        log("HTTP-Fehler:", res.status, bodyText.slice(0, 200));
        return;
      }

      const data = await res.json();

      if (!data.ok) {
        if (data.reason === "step_in_progress") {
          retries++;
          log(`LLM läuft noch (${retries}/${MAX_RETRIES}) – warte...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        log("Schritt nicht ok:", data.error || data.reason);
        return;
      }

      // Erfolgreich
      const ops = data.operations || {};
      
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
        applyResults.board = await applyBoardOperations(ops.board || {}, missing);
        applyResults.aufgaben = await applyAufgabenOperations(ops.aufgaben || {}, missing);
        applyResults.protokoll = await applyProtokollOperations(ops.protokoll || {}, missing);
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
      }

      const duration = Date.now() - startTime;
      log(`Schritt abgeschlossen in ${duration}ms | Angewandt: ${totalApplied}`);
      
      await logGpuStatus();
      return;
    }
    
    log(`Max. Retries (${MAX_RETRIES}) erreicht.`);
    
  } catch (err) {
    log("Fehler:", err.message);
  } finally {
    isRunning = false;
  }
}

function startWorker() {
  log("Chatbot-Worker gestartet, Intervall:", WORKER_INTERVAL_MS, "ms");
  runOnce();
  workerIntervalId = setInterval(runOnce, WORKER_INTERVAL_MS);
}

function stopWorker() {
  if (workerIntervalId !== null) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
    log("Chatbot-Worker gestoppt");
  }
}

async function bootstrap() {
  try {
    await initMemoryStore();
  } catch (err) {
    log("Fehler beim Initialisieren des Memory-Stores:", err?.message || err);
    process.exitCode = 1;
    return;
  }

  startWorker();
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

