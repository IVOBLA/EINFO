// chatbot/server/sim_loop.js

import { CONFIG } from "./config.js";
import { readEinfoInputs } from "./einfo_io.js";
import { callLLMForOps } from "./llm_client.js";
import { logInfo, logError, logDebug } from "./logger.js";

let running = false;
let autoTimer = null;
let stepInProgress = false;

// Board kommt bereits als flache Liste aus einfo_io (flattenBoard)
function compressBoard(board) {
  if (!Array.isArray(board)) return "[]";
  const compact = board.slice(0, 50).map((i) => ({
    id: i.id,
    title: i.content || "",
    column: i.column,
    columnName: i.columnName,
    ort: i.ort || "",
    typ: i.typ || "",
    alerted: i.alerted || "",
    humanId: i.humanId || "",
    timestamp: i.timestamp || null,
    statusSince: i.statusSince || null
  }));
  return JSON.stringify(compact);
}

// Aufg_board_S2.json: S2-Aufgaben
function compressAufgaben(aufgaben) {
  if (!Array.isArray(aufgaben)) return "[]";
  const compact = aufgaben.slice(0, 100).map((a) => ({
    id: a.id,
    title: a.title || "",
    type: a.type || "",
    responsible: a.responsible || "",
    status: a.status || "",
    dueAt: a.dueAt || null,
    originProtocolNr: a.originProtocolNr ?? a.meta?.protoNr ?? null,
    relatedIncidentId: a.relatedIncidentId || null,
    incidentTitle: a.incidentTitle || null
  }));
  return JSON.stringify(compact);
}

// protocol.json: Protokolleinträge
function compressProtokoll(protokoll) {
  if (!Array.isArray(protokoll)) return "[]";
  const compact = protokoll.slice(0, 100).map((p) => ({
    id: p.id,
    nr: p.nr,
    datum: p.datum,
    zeit: p.zeit,
    infoTyp: p.infoTyp,
    anvon: p.anvon,
    kurzinfo: (p.information || "").slice(0, 120)
  }));
  return JSON.stringify(compact);
}

export function isSimulationRunning() {
  return running;
}

export async function startSimulation() {
  running = true;
  logInfo("EINFO-Chatbot Simulation gestartet", null);

  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }

  if (CONFIG.autoStepMs > 0) {
    autoTimer = setInterval(async () => {
      if (!running) return;
      if (stepInProgress) {
        logDebug("Auto-Step übersprungen (busy)", null);
        return;
      }
      const res = await stepSimulation({ source: "auto" });
      if (!res.ok) {
        logError("Fehler Auto-Simulationsschritt", {
          error: res.error || res.reason
        });
      }
    }, CONFIG.autoStepMs);
    logInfo("Auto-Loop aktiviert", { autoStepMs: CONFIG.autoStepMs });
  } else {
    logInfo("Auto-Loop deaktiviert (autoStepMs <= 0)", null);
  }
}

export function pauseSimulation() {
  running = false;
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  logInfo("EINFO-Chatbot Simulation pausiert", null);
}

export async function stepSimulation(options = {}) {
  if (!running) return { ok: false, reason: "not_running" };
  if (stepInProgress && !options.forceConcurrent)
    return { ok: false, reason: "step_in_progress" };

  stepInProgress = true;
  const source = options.source || "manual";

  try {
    const einfoData = await readEinfoInputs();
    const { roles, board, aufgaben, protokoll } = einfoData;

    const llmInput = {
      roles,
      compressedBoard: compressBoard(board),
      compressedAufgaben: compressAufgaben(aufgaben),
      compressedProtokoll: compressProtokoll(protokoll)
    };

    const llmResponse = await callLLMForOps({ llmInput });

    const operations = llmResponse.operations || {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    const analysis = llmResponse.analysis || "";

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

    return { ok: true, operations, analysis };
  } catch (err) {
    logError("Fehler im Simulationsschritt", { error: String(err), source });
    return { ok: false, error: String(err) };
  } finally {
    stepInProgress = false;
  }
}
