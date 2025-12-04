// chatbot/server/sim_loop.js

import { CONFIG } from "./config.js";
import { readEinfoInputs } from "./einfo_io.js";
import { callLLMForOps } from "./llm_client.js";
import { logInfo, logError, logDebug } from "./logger.js";
import { buildSystemPrompt } from "./prompts.js";
import { getLLMHistoryState, getLLMHistorySummary } from "./state_store.js";
import { searchMemory } from "./memory_manager.js";

const timestamp = () => new Date().toISOString();

let conversationHistory = [];
let conversationId = null;

// Merkt sich den letzten Stand der eingelesenen EINFO-Daten, damit nur neue
// oder geänderte Einträge erneut an das LLM geschickt werden müssen.
let lastComparableSnapshot = null;

let running = false;
let autoTimer = null;
let stepInProgress = false;

function resetConversation() {
  conversationId = `sim-${Date.now()}`;
  conversationHistory = [
    { role: "system", content: buildSystemPrompt(), ts: timestamp() }
  ];
  logInfo("Neue Chat-Konversation gestartet", {
    conversationId,
    messageCount: conversationHistory.length
  });
}

function ensureConversation() {
  if (!conversationHistory.length) {
    resetConversation();
  }
}

function appendConversationMessage(role, content) {
  if (!content) return;
  conversationHistory.push({ role, content, ts: timestamp() });
}

function getConversationForLLM() {
  // Als „Erinnerung“ zählt nur, was im realen Zustand sichtbar ist.
  // Darum schicken wir dem LLM nur den System-Prompt als festen Kontext.
  // Alles andere (Board/Aufgaben/Protokoll) kommt im aktuellen userPrompt
  // und basiert auf dem vom Worker tatsächlich übernommenen Dateistand.

  if (conversationHistory.length > 0) {
    const systemEntry = conversationHistory.find((m) => m.role === "system");
    if (systemEntry) {
      return [{ role: "system", content: systemEntry.content }];
    }
  }

  // Fallback, falls aus irgendeinem Grund noch kein Systemeintrag existiert
  return [{ role: "system", content: buildSystemPrompt() }];
}


export function getConversationHistory() {
  return conversationHistory.slice();
}

function buildMemoryQueryFromState(state = {}) {
  const incidentCount = state.boardCount ?? 0;
  const taskCount = state.aufgabenCount ?? 0;
  const protocolCount = state.protokollCount ?? 0;

  return `Aktuelle Lage: ${incidentCount} Einsatzstellen, ${taskCount} offene Aufgaben, ${protocolCount} Protokolleinträge. Relevante frühere Entscheidungen zur Hochwasserlage und Stabsarbeit.`;
}

// Board kommt bereits als flache Liste aus einfo_io (flattenBoard)
function compressBoard(board) {
  if (!Array.isArray(board)) return "[]";
  const compact = board.slice(0, 50).map((i) => ({
    id: i.id,
    desc: i.content || "",
    status: i.column,
    location: i.ort || "",
    typ: i.typ || "",
    statusSince: i.statusSince || null,
    assignedVehicles: i.raw?.assignedVehicles || i.assignedVehicles || null,
    updatedAt: i.timestamp || i.raw?.updatedAt || null
  }));
  return JSON.stringify(compact);
}

// Aufg_board_S2.json: S2-Aufgaben
function compressAufgaben(aufgaben) {
  if (!Array.isArray(aufgaben)) return "[]";
  const compact = aufgaben.slice(0, 100).map((a) => ({
    id: a.id,
    desc: a.title || a.description || "",
    responsible: a.responsible || "",
    status: a.status || "",
    updatedAt: a.updatedAt || a.changedAt || a.dueAt || null,
    relatedIncidentId: a.relatedIncidentId || null,
    typ: a.type || a.category || null
  }));
  return JSON.stringify(compact);
}

// protocol.json: Protokolleinträge
function compressProtokoll(protokoll) {
  if (!Array.isArray(protokoll)) return "[]";
  const compact = protokoll.slice(0, 100).map((p) => ({
    id: p.id,
    information: (p.information || "").slice(0, 180),
    datum: p.datum,
    zeit: p.zeit,
    ergehtAn: p.ergehtAn || p.anvon || "",
    location: p.location || "",
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
  resetConversation();
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

  try {
    ensureConversation();
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

    const opsContext = {
      roles,
      compressedBoard: compressBoard(boardDelta),
      compressedAufgaben: compressAufgaben(aufgabenDelta),
      compressedProtokoll: compressProtokoll(protokollDelta),
      historySummary: getLLMHistorySummary(),
      historyState: getLLMHistoryState(),
      firstStep: isFirstStep
    };

    const memoryQuery = buildMemoryQueryFromState({
      boardCount: board.length,
      aufgabenCount: aufgaben.length,
      protokollCount: protokoll.length
    });

    const memoryHits = await searchMemory({ query: memoryQuery, topK: 5 });
    const memorySnippets = memoryHits.map((hit) => hit.text);

    const { parsed: llmResponse, rawText, userMessage } = await callLLMForOps({
      llmInput: opsContext,
      conversation: getConversationForLLM(),
      memorySnippets
    });

    const operations = (llmResponse || {}).operations || {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    const analysis = (llmResponse || {}).analysis || "";

    appendConversationMessage("user", userMessage);
    appendConversationMessage(
      "assistant",
      typeof rawText === "string" && rawText.trim()
        ? rawText
        : JSON.stringify(llmResponse || {}, null, 2)
    );

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

    return { ok: true, operations, analysis };
  } catch (err) {
    logError("Fehler im Simulationsschritt", { error: String(err), source });
    return { ok: false, error: String(err) };
  } finally {
    stepInProgress = false;
  }
}
