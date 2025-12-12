// chatbot/server/sim_loop.js

import { CONFIG } from "./config.js";
import { readEinfoInputs } from "./einfo_io.js";
import { callLLMForOps } from "./llm_client.js";
import { logInfo, logError } from "./logger.js";
import { searchMemory } from "./memory_manager.js";

// Merkt sich den letzten Stand der eingelesenen EINFO-Daten, damit nur neue
// oder geänderte Einträge erneut an das LLM geschickt werden müssen.
let lastComparableSnapshot = null;
let lastCompressedBoardJson = "[]";

let running = false;
let stepInProgress = false;

function buildMemoryQueryFromState(state = {}) {
  const incidentCount = state.boardCount ?? 0;
  const taskCount = state.aufgabenCount ?? 0;
  const protocolCount = state.protokollCount ?? 0;

  return `Aktuelle Lage: ${incidentCount} Einsatzstellen, ${taskCount} offene Aufgaben, ${protocolCount} Protokolleinträge. Relevante frühere Entscheidungen zur Hochwasserlage und Stabsarbeit.`;
}

// Board kommt bereits als flache Liste aus einfo_io (flattenBoard)
function compressBoard(board) {
  if (!Array.isArray(board)) return "[]";
  
  // Nur nicht-erledigte Items, limitiert
  const maxItems = CONFIG.prompt?.maxBoardItems || 25;
  
  const filtered = board
    .filter((i) => i.status !== "erledigt" && i.column !== "erledigt")
    .slice(0, maxItems);
  
  // Kompakte Schlüssel für weniger Tokens
  const compact = filtered.map((i) => ({
    id: i.id,
    t: (i.desc ?? i.content ?? "").slice(0, 80),  // title
    s: i.status ?? i.column ?? "",                 // status
    o: (i.location ?? i.ort ?? "").slice(0, 40),  // ort
    typ: i.typ || "",
    upd: i.timestamp || i.raw?.updatedAt || null
  }));
  
  return JSON.stringify(compact);
}
// Aufg_board_S2.json: S2-Aufgaben

function compressAufgaben(aufgaben) {
  if (!Array.isArray(aufgaben)) return "[]";
  
  const maxItems = CONFIG.prompt?.maxAufgabenItems || 50;
  
  // Nicht-erledigte zuerst, dann limitieren
  const sorted = [...aufgaben].sort((a, b) => {
    const aErledigt = a.status === "Erledigt" || a.status === "Storniert";
    const bErledigt = b.status === "Erledigt" || b.status === "Storniert";
    if (aErledigt && !bErledigt) return 1;
    if (!aErledigt && bErledigt) return -1;
    return 0;
  });
  
  const compact = sorted.slice(0, maxItems).map((a) => ({
    id: a.id,
    t: (a.title || a.description || "").slice(0, 60),  // title
    r: a.responsible || "",                             // responsible
    s: a.status || "",                                  // status
    inc: a.relatedIncidentId || null                    // incident
  }));
  
  return JSON.stringify(compact);
}

// protocol.json: Protokolleinträge

function compressProtokoll(protokoll) {
  if (!Array.isArray(protokoll)) return "[]";
  
  const maxItems = CONFIG.prompt?.maxProtokollItems || 30;
  
  // Neueste zuerst
  const sorted = [...protokoll].sort((a, b) => {
    const tA = a.zeit || "";
    const tB = b.zeit || "";
    return tB.localeCompare(tA);
  });
  
  const compact = sorted.slice(0, maxItems).map((p) => ({
    id: p.id,
    i: (p.information || "").slice(0, 100),  // information
    d: p.datum,                               // datum
    z: p.zeit,                                // zeit
    von: p.ergehtAn || p.anvon || "",        // von/an
    typ: p.infoTyp || p.typ || ""
  }));
  
  return JSON.stringify(compact);
}

function toComparableBoardEntry(entry = {}) {
  return {
    id: entry.id,
    desc: entry.content || "",
    status: entry.column || "",
    location: entry.ort || "",
    typ: entry.typ || "",
    statusSince: entry.statusSince || null,
    assignedVehicles: entry.raw?.assignedVehicles || entry.assignedVehicles || null,
    updatedAt: entry.timestamp || entry.raw?.updatedAt || null
  };
}

function toComparableAufgabe(task = {}) {
  return {
    id: task.id,
    desc: task.title || task.description || "",
    responsible: task.responsible || "",
    status: task.status || "",
    updatedAt: task.updatedAt || task.changedAt || task.dueAt || null,
    relatedIncidentId: task.relatedIncidentId || null,
    typ: task.type || task.category || null
  };
}

function toComparableProtokoll(entry = {}) {
  return {
    id: entry.id,
    information: entry.information || "",
    datum: entry.datum,
    zeit: entry.zeit,
    ergehtAn: entry.ergehtAn || entry.anvon || "",
    location: entry.location || "",
    typ: entry.infoTyp || entry.typ || ""
  };
}

function buildDelta(currentList, previousComparableList, mapper) {
  const comparableCurrent = currentList
    .map((item) => mapper(item))
    .filter((item) => item && item.id);

  const previousMap = new Map(
    (previousComparableList || []).map((item) => [item.id, JSON.stringify(item)])
  );

  const delta = comparableCurrent.filter((item) => {
    const serialized = JSON.stringify(item);
    const prevSerialized = previousMap.get(item.id);
    return !prevSerialized || prevSerialized !== serialized;
  });

  return { delta, snapshot: comparableCurrent };
}

export function isSimulationRunning() {
  return running;
}

export async function startSimulation() {
  running = true;
  logInfo(
    "EINFO-Chatbot Simulation gestartet (Schritte werden vom Worker ausgelöst)",
    null
  );

  // Auto-Loop ist bewusst deaktiviert.
  // Alle Simulationsschritte kommen über /api/sim/step vom chatbot_worker.
}


export function pauseSimulation() {
  running = false;
  logInfo("EINFO-Chatbot Simulation pausiert", null);
}


export async function stepSimulation(options = {}) {
  if (!running) return { ok: false, reason: "not_running" };
  if (stepInProgress && !options.forceConcurrent)
    return { ok: false, reason: "step_in_progress" };

  stepInProgress = true;
  const source = options.source || "manual";
  const providedMemorySnippets = Array.isArray(options.memorySnippets)
    ? options.memorySnippets.filter((snippet) =>
        typeof snippet === "string" && snippet.trim()
      )
    : [];

  try {
    const einfoData = await readEinfoInputs();
    const { roles, board, aufgaben, protokoll } = einfoData;

    const { delta: boardDelta, snapshot: boardSnapshot } = buildDelta(
      board,
      lastComparableSnapshot?.board,
      toComparableBoardEntry
    );
    const { delta: aufgabenDelta, snapshot: aufgabenSnapshot } = buildDelta(
      aufgaben,
      lastComparableSnapshot?.aufgaben,
      toComparableAufgabe
    );
    const { delta: protokollDelta, snapshot: protokollSnapshot } = buildDelta(
      protokoll,
      lastComparableSnapshot?.protokoll,
      toComparableProtokoll
    );
    // --- NEU: Erkennen, dass dies der erste Simulationsschritt ist ---
    const isFirstStep =
      (!lastComparableSnapshot ||
        lastComparableSnapshot.board?.length === 0) &&
      Array.isArray(board) &&
      board.length === 0 &&
      Array.isArray(aufgaben) &&
      aufgaben.length === 0 &&
      Array.isArray(protokoll) &&
      protokoll.length === 0;

    // Debug-Log
    if (isFirstStep) {
      logInfo("Erster Simulationsschritt: Szenario-Initialisierung aktiv", null);
    }

    const boardUnchanged =
      lastComparableSnapshot?.board?.length === boardSnapshot.length &&
      boardDelta.length === 0;

    const opsContext = {
      roles,
      compressedBoard: boardUnchanged
        ? lastCompressedBoardJson
        : compressBoard(boardSnapshot),
      compressedAufgaben: compressAufgaben(aufgaben),
      compressedProtokoll: compressProtokoll(protokoll),
      firstStep: isFirstStep
    };

    const estimatedDataTokens = Math.ceil(
      (opsContext.compressedBoard.length +
        opsContext.compressedAufgaben.length +
        opsContext.compressedProtokoll.length) / 4
    );
    
    if (estimatedDataTokens > 2000) {
      logDebug("Hohe Datenmenge für LLM", { estimatedDataTokens });
    }

    
    let memorySnippets = providedMemorySnippets;

    if (!memorySnippets.length) {
      const memoryQuery = buildMemoryQueryFromState({
        boardCount: board.length,
        aufgabenCount: aufgaben.length,
        protokollCount: protokoll.length
      });

      const now = new Date();
      const memoryHits = await searchMemory({
        query: memoryQuery,
        topK: CONFIG.memoryRag.longScenarioTopK,
        now,
        maxAgeMinutes: CONFIG.memoryRag.maxAgeMinutes,
        recencyHalfLifeMinutes: CONFIG.memoryRag.recencyHalfLifeMinutes,
        longScenarioMinItems: CONFIG.memoryRag.longScenarioMinItems
      });
      memorySnippets = memoryHits.map((hit) => hit.text);
    }

    const { parsed: llmResponse } = await callLLMForOps({
      llmInput: opsContext,
      memorySnippets
    });

    const operations = (llmResponse || {}).operations || {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    const analysis = (llmResponse || {}).analysis || "";

    logInfo("Simulationsschritt", {
      source,
      hasBoardOps:
        (operations.board?.createIncidentSites?.length || 0) +
          (operations.board?.updateIncidentSites?.length || 0) >
        0,
      hasAufgabenOps:
        (operations.aufgaben?.create?.length || 0) +
          (operations.aufgaben?.update?.length || 0) >
        0,
      hasProtokollOps: operations.protokoll?.create?.length > 0
    });

    lastComparableSnapshot = {
      board: boardSnapshot,
      aufgaben: aufgabenSnapshot,
      protokoll: protokollSnapshot
    };

    lastCompressedBoardJson = opsContext.compressedBoard;

    return { ok: true, operations, analysis };
  } catch (err) {
    logError("Fehler im Simulationsschritt", { error: String(err), source });
    return { ok: false, error: String(err) };
  } finally {
    stepInProgress = false;
  }
}

