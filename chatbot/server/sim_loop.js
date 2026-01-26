// chatbot/server/sim_loop.js
// Refactored: SimulationState, ProtocolIndex, Error Handling, Metriken, Trigger-System

import { CONFIG, SIMULATION_DEFAULTS } from "./config.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { readEinfoInputs } from "./einfo_io.js";
import { callLLMForOps } from "./llm_client.js";
import { logInfo, logError, logDebug } from "./logger.js";
import { searchMemory } from "./memory_manager.js";
import { logEvent } from "./audit_trail.js";
import {
  indexIncident,
  indexTask,
  indexProtocolEntry
} from "./event_indexer.js";
import { setEinfoSnapshot } from "./state_store.js";
import {
  updateDisasterContextFromEinfo,
  incrementSimulationStep
} from "./disaster_context.js";
import { isAnalysisInProgress } from "./situation_analyzer.js";
import {
  buildScenarioControlSummary,
  getScenarioMinutesPerStep,
  getScenarioDurationMinutes,
  isSimulationTimeExceeded
} from "./scenario_controls.js";
import {
  isStabsstelle,
  isMeldestelle,
  normalizeRole
} from "./field_mapper.js";

// Neue Module (Verbesserungen)
import { simulationState } from "./simulation_state.js";
import { ProtocolIndex } from "./protocol_index.js";
import {
  handleSimulationError,
  safeExecute,
  DisasterContextError,
  RAGIndexingError
} from "./simulation_errors.js";
import { metrics, startTimer } from "./simulation_metrics.js";
import { TriggerManager } from "./scenario_triggers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIRS_TO_CLEAR = [
  path.resolve(__dirname, "../logs"),
  path.resolve(__dirname, "../../server/logs")
];

async function clearLogFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await clearLogFiles(abs);
      } else if (entry.isFile()) {
        await fs.unlink(abs).catch(() => {});
      }
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

async function clearSimulationLogs() {
  for (const dir of LOG_DIRS_TO_CLEAR) {
    await clearLogFiles(dir);
  }
}

// ============================================================
// Interne Rollen-Konstanten
// ============================================================
// Alle bekannten internen Rollen (Stabsstellen)
const INTERNAL_ROLES = new Set([
  "LTSTB", "LTSTBSTV", "S1", "S2", "S3", "S4", "S5", "S6",
  "MELDESTELLE", "MS", "MELDESTELLE/S6"
]);

// ============================================================
// Identifiziert ausgehende Protokolleinträge die Antworten benötigen
// ============================================================
/**
 * Findet alle ausgehenden Meldungen an Stellen, die nicht aktiv besetzt sind.
 * Das können interne Stabsrollen oder externe Stellen sein.
 * 
 * @param {Array} protokoll - Alle Protokolleinträge (nicht nur Delta!)
 * @param {Array} protokollDelta - Neue/geänderte Protokolleinträge
 * @param {Object} roles - { active: [...] }
 * @returns {Array} Meldungen die eine Antwort benötigen
 */
/**
 * REFACTORED: Verwendet jetzt ProtocolIndex für O(n) statt O(n²) Performance
 *
 * Identifiziert ausgehende Protokolleinträge die eine Antwort benötigen.
 *
 * WICHTIG: Prüft ALLE ausgehenden Protokolleinträge (nicht nur Delta),
 * damit auch ältere unbeantwortete Nachrichten erkannt werden.
 *
 * @param {Array} protokoll - Alle Protokolleinträge
 * @param {Array} protokollDelta - Neue/geänderte Einträge (wird nicht mehr verwendet)
 * @param {Object} roles - { active: [...] }
 * @returns {Array} Meldungen die Antwort benötigen
 */
export function identifyMessagesNeedingResponse(protokoll, protokollDelta, roles) {
  const { active } = roles;
  const activeSet = new Set(active.map(r => String(r).toUpperCase()));
  const needingResponse = [];

  // Limit um Performance-Probleme bei großen Protokollen zu vermeiden
  const MAX_RESPONSES_PER_STEP = 10;

  // PERFORMANCE: Erstelle Index für effiziente Suche (O(n) statt O(n²))
  const index = new ProtocolIndex(protokoll);

  // BUGFIX: Prüfe ALLE Protokolleinträge, nicht nur Delta
  // Damit werden auch ältere unbeantwortete ausgehende Nachrichten erkannt
  // Sortiere nach Zeit (neueste zuerst) um die relevantesten zuerst zu finden
  const sortedProtokoll = [...protokoll].sort((a, b) => {
    const timeA = `${a.datum || ""} ${a.zeit || ""}`;
    const timeB = `${b.datum || ""} ${b.zeit || ""}`;
    return timeB.localeCompare(timeA); // Neueste zuerst
  });

  for (const entry of sortedProtokoll) {
    // Limit erreicht - nicht mehr suchen
    if (needingResponse.length >= MAX_RESPONSES_PER_STEP) break;

    // BUGFIX: Ignoriere Bot-erstellte Nachrichten
    // Wir wollen keine Antworten auf Simulations-Nachrichten generieren
    const createdBy = entry.createdBy || entry.history?.[0]?.by || "";
    const kanalNr = entry.uebermittlungsart?.kanalNr || "";
    const isFromBot =
      createdBy === "CHATBOT" ||
      createdBy === "simulation-worker" ||
      createdBy === "bot" ||
      kanalNr === "bot";

    if (isFromBot) continue;

    // Nur ausgehende Meldungen prüfen
    const richtung = entry.richtung || entry.uebermittlungsart?.richtung || "";
    const isOutgoing = /aus/i.test(richtung) ||
                       entry.uebermittlungsart?.aus === true ||
                       entry.uebermittlungsart?.aus === "true";

    if (!isOutgoing) continue;

    // PERFORMANCE: Nutze Index für Antwort-Suche (O(1) statt O(n))
    const response = index.findResponseTo(entry);
    if (response) continue;

    // Sammle alle Empfänger
    const ergehtAn = Array.isArray(entry.ergehtAn)
      ? entry.ergehtAn
      : (entry.ergehtAn ? [entry.ergehtAn] : []);

    const ergehtAnText = entry.ergehtAnText || "";
    const allRecipients = [...ergehtAn];

    // Zusätzliche Empfänger aus Freitext
    if (ergehtAnText) {
      const textRecipients = ergehtAnText
        .split(/[,;]/)
        .map(r => r.trim())
        .filter(Boolean);
      allRecipients.push(...textRecipients);
    }

    // Filtere Duplikate
    const uniqueRecipients = [...new Set(allRecipients)];

    // Prüfe welche Empfänger NICHT aktiv besetzt sind
    const nonActiveRecipients = uniqueRecipients.filter(r => {
      const upper = String(r).toUpperCase();
      return !activeSet.has(upper);
    });

    if (nonActiveRecipients.length === 0) continue;

    // Unterscheide: Interne Stabsrollen vs. Externe Stellen
    const internalMissing = [];
    const externalRecipients = [];

    for (const r of nonActiveRecipients) {
      const upper = String(r).toUpperCase();
      // Ist es eine bekannte interne Rolle?
      if (INTERNAL_ROLES.has(upper)) {
        internalMissing.push(r);
      } else {
        // Externe Stelle (Leitstelle, Polizei, Bürgermeister, etc.)
        externalRecipients.push(r);
      }
    }

    needingResponse.push({
      id: entry.id,
      nr: entry.nr,
      datum: entry.datum || "",
      zeit: entry.zeit || "",
      infoTyp: entry.infoTyp || entry.typ || "",
      anvon: entry.anvon || "Stab",
      information: entry.information || "",
      allRecipients: nonActiveRecipients,
      internalMissing,
      externalRecipients,
      originalEntry: entry
    });
  }

  return needingResponse;
}

// ============================================================
// Identifiziert offene Rückfragen im Protokoll
// ============================================================
/**
 * Findet alle Protokolleinträge die NICHT vom CHATBOT erstellt wurden und
 * eine Rückfrage darstellen, die noch nicht beantwortet wurde.
 *
 * Kriterien für eine Rückfrage:
 * 1. NICHT vom CHATBOT erstellt (createdBy !== 'CHATBOT' UND kanalNr !== 'bot')
 * 2. Die Information enthält ein Fragezeichen ODER
 *    geht an eine interne Rolle die keine aktive Rolle ist ODER
 *    geht an eine externe Rolle
 * 3. Die Frage wurde noch nicht beantwortet (kein nachfolgender CHATBOT-Eintrag)
 *
 * @param {Array} protokoll - Alle Protokolleinträge
 * @param {Object} roles - { active: [...] }
 * @returns {Array} Offene Rückfragen die beantwortet werden müssen
 */
/**
 * Findet alle offenen Fragen im Protokoll die noch nicht beantwortet wurden.
 *
 * Eine Frage gilt als beantwortet wenn rueckmeldung2="answered" gesetzt ist.
 * Nur Fragen mit leerem rueckmeldung2 werden an das LLM weitergegeben.
 *
 * @param {Array} protokoll - Alle Protokolleinträge
 * @param {Object} roles - { active: [...] }
 * @returns {Array} Offene Fragen die beantwortet werden müssen
 */
export function identifyOpenQuestions(protokoll, roles) {
  const { active } = roles;
  const activeSet = new Set(active.map(r => String(r).toUpperCase()));
  const openQuestions = [];

  for (const entry of protokoll) {
    // Kriterium 1: rueckmeldung2 muss leer sein (nicht beantwortet)
    const rueckmeldung2 = (entry.rueckmeldung2 || "").trim();
    if (rueckmeldung2) continue;

    // Kriterium 2: NICHT vom CHATBOT erstellt
    const createdBy = entry.createdBy || entry.history?.[0]?.by || "";
    const kanalNr = entry.uebermittlungsart?.kanalNr || "";
    const isFromBot =
      createdBy === "CHATBOT" ||
      createdBy === "simulation-worker" ||
      createdBy === "bot" ||
      kanalNr === "bot" ||
      kanalNr === "CHATBOT";

    if (isFromBot) continue;

    // Kriterium 3: Ist dies eine Frage?
    const information = entry.information || "";
    const hasQuestionMark = information.includes("?");

    // Prüfe Empfänger: geht an interne nicht-aktive Rolle oder externe Rolle?
    const ergehtAn = Array.isArray(entry.ergehtAn)
      ? entry.ergehtAn
      : (entry.ergehtAn ? [entry.ergehtAn] : []);

    let targetsNonActiveInternal = false;
    let targetsExternal = false;

    for (const recipient of ergehtAn) {
      const upper = String(recipient).toUpperCase();
      if (INTERNAL_ROLES.has(upper)) {
        // Interne Rolle - prüfe ob aktiv
        if (!activeSet.has(upper)) {
          targetsNonActiveInternal = true;
        }
      } else {
        // Externe Rolle
        targetsExternal = true;
      }
    }

    // Ist dies eine Frage?
    const isQuestion = hasQuestionMark || targetsNonActiveInternal || targetsExternal;
    if (!isQuestion) continue;

    // Diese Frage ist noch offen (rueckmeldung2 ist leer)
    openQuestions.push({
      id: entry.id,
      nr: entry.nr,
      datum: entry.datum || "",
      zeit: entry.zeit || "",
      infoTyp: entry.infoTyp || entry.typ || "",
      anvon: entry.anvon || "",
      ergehtAn: ergehtAn,
      information: information,
      hasQuestionMark,
      targetsNonActiveInternal,
      targetsExternal,
      originalEntry: entry
    });
  }

  return openQuestions;
}

// Merkt sich den letzten Stand der eingelesenen EINFO-Daten...

// ============================================================
// State Management
// ============================================================
// REFACTORED: Globale Variablen wurden durch simulationState ersetzt
// (siehe simulation_state.js)
//
// Zugriff auf State-Variablen:
// - simulationState.lastSnapshot (früher: simulationState.lastSnapshot)
// - simulationState.lastCompressedBoard (früher: simulationState.lastCompressedBoard)
// - simulationState.simulationState.running (früher: simulationState.running)
// - simulationState.simulationState.stepInProgress (früher: simulationState.stepInProgress)
// - simulationState.justStarted (früher: simulationState.justStarted)
// - simulationState.simulationState.activeScenario (früher: simulationState.activeScenario)
// - simulationState.elapsedMinutes (früher: simulationState.elapsedMinutes)

export function buildMemoryQueryFromState(state = {}) {
  const incidentCount = state.boardCount ?? 0;
  const taskCount = state.aufgabenCount ?? 0;
  const protocolCount = state.protokollCount ?? 0;

  return `Aktuelle Lage: ${incidentCount} Einsatzstellen, ${taskCount} offene Aufgaben, ${protocolCount} Protokolleinträge. Relevante frühere Entscheidungen zur Hochwasserlage und Stabsarbeit.`;
}

// Board kommt bereits als flache Liste aus einfo_io (flattenBoard)
export function compressBoard(board) {
  if (!Array.isArray(board)) return "[]";

  // Nur nicht-erledigte Items, limitiert
  const maxItems = CONFIG.prompt?.maxBoardItems || 25;

  const filtered = board
    .filter((i) => i.status !== "erledigt" && i.column !== "erledigt")
    .slice(0, maxItems);

  // Volle Feldnamen für bessere Verständlichkeit
  const compact = filtered.map((i) => ({
    id: i.id,
    content: (i.desc ?? i.content ?? "").slice(0, 80),
    status: i.status ?? i.column ?? "",
    ort: (i.location ?? i.ort ?? "").slice(0, 40),
    typ: i.typ || "",
    updatedAt: i.timestamp || i.raw?.updatedAt || null
  }));

  return JSON.stringify(compact);
}
// Aufg_board_S2.json: S2-Aufgaben

export function compressAufgaben(aufgaben) {
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

  // Volle Feldnamen für bessere Verständlichkeit
  const compact = sorted.slice(0, maxItems).map((a) => ({
    id: a.id,
    title: (a.title || a.description || "").slice(0, 60),
    responsible: a.responsible || "",
    status: a.status || "",
    relatedIncidentId: a.relatedIncidentId || null
  }));

  return JSON.stringify(compact);
}

// protocol.json: Protokolleinträge

export function compressProtokoll(protokoll) {
  if (!Array.isArray(protokoll)) return "[]";

  const maxItems = CONFIG.prompt?.maxProtokollItems || 30;

  // Neueste zuerst
  const sorted = [...protokoll].sort((a, b) => {
    const tA = a.zeit || "";
    const tB = b.zeit || "";
    return tB.localeCompare(tA);
  });

  // Volle Feldnamen für bessere Verständlichkeit
  const compact = sorted.slice(0, maxItems).map((p) => ({
    id: p.id,
    information: (p.information || "").slice(0, 100),
    datum: p.datum,
    zeit: p.zeit,
    anvon: p.anvon || "",
    ergehtAn: p.ergehtAn || [],
    infoTyp: p.infoTyp || p.typ || ""
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

export function toComparableProtokoll(entry = {}) {
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

export function buildDelta(currentList, previousComparableList, mapper) {
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
  return simulationState.running;
}

/**
 * REFACTORED: Verwendet jetzt simulationState.start() Methode
 */
/**
 * Schreibt scenario_config.json basierend auf dem aktiven Szenario
 * Wird beim Simulation-Start aufgerufen um die Szenario-Konfiguration
 * im Admin Panel anzuzeigen.
 */
async function writeScenarioConfig(scenario) {
  if (!scenario || !scenario.scenario_context) return;

  const EINFO_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/data");
  const SCENARIO_CONFIG_FILE = path.join(EINFO_DATA_DIR, "scenario_config.json");

  const config = {
    scenarioId: scenario.id || null,
    artDesEreignisses: scenario.scenario_context.event_type || "Unbekannt",
    geografischerBereich: scenario.scenario_context.region || "Nicht definiert",
    zeit: new Date().toISOString(),
    wetter: scenario.scenario_context.weather || null,
    infrastruktur: scenario.scenario_context.special_conditions?.join(", ") || null
  };

  try {
    await fs.writeFile(
      SCENARIO_CONFIG_FILE,
      JSON.stringify(config, null, 2),
      "utf8"
    );
    logInfo("Szenario-Konfiguration geschrieben", {
      file: SCENARIO_CONFIG_FILE,
      scenarioId: config.scenarioId,
      eventType: config.artDesEreignisses,
      region: config.geografischerBereich
    });
  } catch (err) {
    logError("Fehler beim Schreiben der Szenario-Konfiguration", {
      error: String(err),
      file: SCENARIO_CONFIG_FILE
    });
  }
}

export async function startSimulation(scenario = null) {
  // Prüfe ob wir vorhandene Daten haben (um justStarted korrekt zu setzen)
  const snapshotCounts = {
    board: simulationState.lastSnapshot?.board?.length || 0,
    aufgaben: simulationState.lastSnapshot?.aufgaben?.length || 0,
    protokoll: simulationState.lastSnapshot?.protokoll?.length || 0
  };
  const hasSnapshotData =
    snapshotCounts.board > 0 ||
    snapshotCounts.aufgaben > 0 ||
    snapshotCounts.protokoll > 0;
  const hasCompressedBoard =
    typeof simulationState.lastCompressedBoard === "string" &&
    simulationState.lastCompressedBoard !== "[]";
  const existingScenario = simulationState.activeScenario;
  const nextScenario = scenario ?? existingScenario;
  const isSameScenario =
    existingScenario?.id &&
    nextScenario?.id &&
    existingScenario.id === nextScenario.id;

  // BUGFIX: Bei vorherigem Timeout oder Stop immer zurücksetzen
  // Die Simulation muss nach einem Timeout oder manuellem Stop neu gestartet werden können
  const wasStoppedByTimeout = simulationState.stoppedReason === "timeout";
  const wasStopped = simulationState.stoppedReason !== null && !simulationState.running && !simulationState.paused;

  const shouldResume = (hasSnapshotData || hasCompressedBoard) && (!scenario || isSameScenario) && !wasStoppedByTimeout && !wasStopped;
  const resetState = !shouldResume || (scenario && !isSameScenario) || wasStoppedByTimeout || wasStopped;

  if (resetState) {
    try {
      await clearSimulationLogs();
      logInfo("Logfiles vor Simulationsstart gelöscht", { logDirs: LOG_DIRS_TO_CLEAR });
    } catch (err) {
      logError("Fehler beim Löschen der Logfiles", { error: String(err) });
    }
  }

  // Verwende SimulationState Methode (setzt running, activeScenario, elapsedMinutes, etc.)
  simulationState.start(nextScenario, { resetState });

  // Wenn Daten vorhanden, ist es kein frischer Start
  if (!resetState) {
    simulationState.justStarted = false;
  }

  if (simulationState.activeScenario?.triggers) {
    if (!simulationState.triggerManager || resetState || !isSameScenario) {
      simulationState.triggerManager = new TriggerManager(simulationState.activeScenario);
    }
  } else {
    simulationState.triggerManager = null;
  }

  // Log bereits durch simulationState.start() erfolgt, aber mit zusätzlichen Details
  if (scenario) {
    logInfo("Simulation mit Szenario gestartet - Details", {
      scenarioId: scenario.id,
      title: scenario.title,
      eventType: scenario.scenario_context?.event_type,
      hasExistingData: !resetState
    });

    // Schreibe Szenario-Konfiguration für Admin Panel
    // Nur bei frischem Start (resetState=true) oder wenn ein neues Szenario geladen wird
    if (resetState || !isSameScenario) {
      await writeScenarioConfig(scenario);
    }
  }

  // Auto-Loop ist bewusst deaktiviert.
  // Alle Simulationsschritte kommen über /api/sim/step vom chatbot_worker.
}

/**
 * Gibt das aktuell aktive Szenario zurück
 */
export function getActiveScenario() {
  return simulationState.activeScenario;
}


/**
 * REFACTORED: Verwendet jetzt simulationState.pause() Methode
 */
export function pauseSimulation() {
  simulationState.pause();
}


/**
 * REFACTORED: Jetzt mit Metriken, Error Handling und Trigger-System
 */
export async function stepSimulation(options = {}) {
  // METRICS: Start Timer für Step-Dauer
  const stepTimer = startTimer();

  if (!simulationState.running && !simulationState.paused) {
    return { ok: false, reason: "not_running" };
  }
  if (simulationState.stepInProgress && !options.forceConcurrent)
    return { ok: false, reason: "step_in_progress" };

  // ============================================================
  // TIMEOUT-PRÜFUNG: Simulation beenden wenn Zeit abgelaufen
  // ============================================================
  if (isSimulationTimeExceeded(simulationState.activeScenario, simulationState.elapsedMinutes)) {
    const durationMinutes = getScenarioDurationMinutes(simulationState.activeScenario);
    logInfo("Simulation beendet - Zeit abgelaufen", {
      elapsedMinutes: simulationState.elapsedMinutes,
      durationMinutes,
      scenarioId: simulationState.activeScenario?.id
    });

    // Audit-Event loggen (vor stop() um scenarioId noch zu haben)
    logEvent("simulation", "timeout_stop", {
      elapsedMinutes: simulationState.elapsedMinutes,
      durationMinutes,
      scenarioId: simulationState.activeScenario?.id,
      stepCount: simulationState.stepCount
    });

    // Simulation stoppen mit Grund "timeout"
    simulationState.stop("timeout");

    return {
      ok: false,
      reason: "timeout",
      message: `Simulationszeit abgelaufen (${durationMinutes} Minuten erreicht)`
    };
  }

  simulationState.stepInProgress = true;
  const source = options.source || "manual";
  const providedMemorySnippets = Array.isArray(options.memorySnippets)
    ? options.memorySnippets.filter((snippet) =>
        typeof snippet === "string" && snippet.trim()
      )
    : [];

  try {
    const einfoData = await readEinfoInputs();
    const { roles, board, aufgaben, protokoll } = einfoData;
    setEinfoSnapshot({ aufgaben, protokoll });

    // Aktualisiere die Rollen im SimulationState
    simulationState.updateRoles(roles);

    const { delta: boardDelta, snapshot: boardSnapshot } = buildDelta(
      board,
      simulationState.lastSnapshot?.board,
      toComparableBoardEntry
    );
    const { delta: aufgabenDelta, snapshot: aufgabenSnapshot } = buildDelta(
      aufgaben,
      simulationState.lastSnapshot?.aufgaben,
      toComparableAufgabe
    );
const { delta: protokollDelta, snapshot: protokollSnapshot } = buildDelta(
      protokoll,
      simulationState.lastSnapshot?.protokoll,
      toComparableProtokoll
    );

    // ============================================================
    // NEU: Audit-Trail - Schritt-Start loggen
    // ============================================================
    const stepStartTime = Date.now();
    const stepId = `step_${stepStartTime}_${Math.random().toString(36).slice(2, 6)}`;
    
    logEvent("simulation", "step_start", {
      stepId,
      source,
      boardCount: board.length,
      aufgabenCount: aufgaben.length,
      protokollCount: protokoll.length
    });

    // ============================================================
    // NEU: Identifiziere Meldungen die eine Antwort benötigen
    // ============================================================
    const messagesNeedingResponse = identifyMessagesNeedingResponse(
      protokoll,      // Alle Protokolleinträge (für Antwort-Check)
      protokollDelta, // Nur neue/geänderte prüfen
      roles
    );
    
    if (messagesNeedingResponse.length > 0) {
      logInfo("Meldungen benötigen Antwort", {
        count: messagesNeedingResponse.length,
        messages: messagesNeedingResponse.map(m => ({
          nr: m.nr,
          von: m.anvon,
          an: m.allRecipients,
          extern: m.externalRecipients,
          info: (m.information || "").slice(0, 50)
        }))
      });

      // Audit-Event
      logEvent("simulation", "response_needed", {
        stepId,
        messageCount: messagesNeedingResponse.length,
        externalEntities: [...new Set(
          messagesNeedingResponse.flatMap(m => m.externalRecipients)
        )]
      });
    }

    // ============================================================
    // NEU: Identifiziere offene Rückfragen von echten Benutzern
    // ============================================================
    const openQuestions = identifyOpenQuestions(protokoll, roles);

    if (openQuestions.length > 0) {
      logInfo("Offene Rückfragen gefunden", {
        count: openQuestions.length,
        questions: openQuestions.map(q => ({
          nr: q.nr,
          von: q.anvon,
          an: q.ergehtAn,
          frage: (q.information || "").slice(0, 50),
          hatFragezeichen: q.hasQuestionMark
        }))
      });

      // Audit-Event
      logEvent("simulation", "open_questions_found", {
        stepId,
        questionCount: openQuestions.length,
        questioners: [...new Set(openQuestions.map(q => q.anvon))]
      });
    }

    // ============================================================
    // NEU: Disaster Context mit aktuellen EINFO-Daten aktualisieren
    // ============================================================
    try {
      await updateDisasterContextFromEinfo({
        board,
        protokoll,
        aufgaben,
        roles
      });
      logDebug("Disaster Context aktualisiert", {
        boardItems: board.length,
        protokollItems: protokoll.length,
        aufgabenItems: aufgaben.length
      });
    } catch (err) {
      logError("Fehler beim Aktualisieren des Disaster Context", {
        error: String(err)
      });
      // Fehler nicht weitergeben - Simulation soll weiterlaufen
    }

    // --- Erkennen, dass dies der erste Simulationsschritt ist ---
    // NEU: Nutze den expliziten Zustand simulationState.justStarted statt Heuristik
    const isFirstStep = simulationState.justStarted;

    // Zustand nach dem Auslesen zurücksetzen
    if (simulationState.justStarted) {
      simulationState.justStarted = false;
      logInfo("Erster Simulationsschritt: Start-Prompt wird verwendet", null);
    }

    const boardUnchanged =
      simulationState.lastSnapshot?.board?.length === boardSnapshot.length &&
      boardDelta.length === 0;

  const opsContext = {
    roles: {
      active: roles.active
    },
      compressedBoard: boardUnchanged
        ? simulationState.lastCompressedBoard
        : compressBoard(boardSnapshot),
      compressedAufgaben: compressAufgaben(aufgaben),
      compressedProtokoll: compressProtokoll(protokoll),
      firstStep: isFirstStep,
      elapsedMinutes: simulationState.elapsedMinutes,  // NEU: Für phasenbasierte Requirements
      // NEU: Meldungen die Antwort brauchen
      messagesNeedingResponse: messagesNeedingResponse.length > 0
        ? messagesNeedingResponse
        : null,
      // NEU: Offene Rückfragen von echten Benutzern
      openQuestions: openQuestions.length > 0
        ? openQuestions
        : null,
      scenarioControl: buildScenarioControlSummary({
        scenario: simulationState.activeScenario,
        elapsedMinutes: simulationState.elapsedMinutes
      })
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

    // NEU: Simulationsschritt überspringen wenn KI-Analyse läuft (LLM-Lock)
    // Verhindert gleichzeitige LLM-Aufrufe während der Situationsanalyse
    if (isAnalysisInProgress()) {
      logInfo("Simulationsschritt übersprungen - KI-Analyse läuft", { stepId, source });
      logEvent("simulation", "step_skipped_analysis", { stepId, source });
      return { ok: false, reason: "analysis_in_progress", skipped: true };
    }

    // ============================================================
    // TRIGGER-SYSTEM: Evaluiere Szenario-Trigger
    // ============================================================
    let triggerOperations = {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    if (simulationState.activeScenario?.triggers) {
      try {
        if (!simulationState.triggerManager) {
          simulationState.triggerManager = new TriggerManager(simulationState.activeScenario);
        }
        triggerOperations = await simulationState.triggerManager.evaluateTriggers({
          elapsedMinutes: simulationState.elapsedMinutes,
          boardState: { columns: {} }, // Board ist flat, würde Umstrukturierung brauchen
          protokollState: protokoll,
          aufgabenState: aufgaben
        });

        if (triggerOperations.board.createIncidentSites.length > 0 ||
            triggerOperations.protokoll.create.length > 0) {
          logInfo("Szenario-Trigger ausgeführt", {
            incidents: triggerOperations.board.createIncidentSites.length,
            protokoll: triggerOperations.protokoll.create.length,
            aufgaben: triggerOperations.aufgaben.create.length
          });
        }
      } catch (err) {
        logError("Fehler bei Trigger-Evaluierung", { error: String(err) });
      }
    }

    // ============================================================
    // LLM-CALL mit Metriken
    // ============================================================
    const llmTimer = startTimer();
    const { parsed: llmResponse, model: llmModel } = await callLLMForOps({
      llmInput: opsContext,
      memorySnippets,
      scenario: simulationState.activeScenario  // NEU: Szenario an LLM übergeben
    });
    const llmDuration = llmTimer.stop();

    // METRICS: Erfasse LLM-Call Dauer
    metrics.recordHistogram('simulation_llm_call_duration_ms',
      { model: llmModel, source },
      llmDuration
    );

    // NEU: LLM-Aufruf im Audit loggen
    logEvent("llm", "ops_call", {
      stepId,
      durationMs: llmDuration,
      hasResponse: !!llmResponse,
      model: llmModel
    });

    // ============================================================
    // LLM-RESPONSE NORMALISIERUNG
    // ============================================================
    // BUGFIX: LLM liefert manchmal operations als Array statt Objekt
    // Normalisiere die Response um robuste Verarbeitung zu gewährleisten
    let rawOperations = (llmResponse || {}).operations;

    // Fall 1: operations ist ein Array → leere Operations verwenden
    if (Array.isArray(rawOperations)) {
      logError("LLM lieferte operations als Array statt Objekt - verwende leere Operations", {
        rawOperations: JSON.stringify(rawOperations).slice(0, 200)
      });
      rawOperations = null;
    }

    // Fall 2: operations ist null/undefined → leere Operations
    const llmOperations = rawOperations || {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    // Stelle sicher dass alle Sub-Objekte existieren
    if (!llmOperations.board) {
      llmOperations.board = { createIncidentSites: [], updateIncidentSites: [] };
    }
    if (!llmOperations.board.createIncidentSites) {
      llmOperations.board.createIncidentSites = [];
    }
    if (!llmOperations.board.updateIncidentSites) {
      llmOperations.board.updateIncidentSites = [];
    }

    if (!llmOperations.aufgaben) {
      llmOperations.aufgaben = { create: [], update: [] };
    }
    if (!llmOperations.aufgaben.create) {
      llmOperations.aufgaben.create = [];
    }
    if (!llmOperations.aufgaben.update) {
      llmOperations.aufgaben.update = [];
    }

    if (!llmOperations.protokoll) {
      llmOperations.protokoll = { create: [] };
    }
    if (!llmOperations.protokoll.create) {
      llmOperations.protokoll.create = [];
    }

    logDebug("LLM-Operations normalisiert", {
      boardCreate: llmOperations.board?.createIncidentSites?.length || 0,
      boardUpdate: llmOperations.board?.updateIncidentSites?.length || 0,
      aufgabenCreate: llmOperations.aufgaben?.create?.length || 0,
      aufgabenUpdate: llmOperations.aufgaben?.update?.length || 0,
      protokollCreate: llmOperations.protokoll?.create?.length || 0
    });

    // ============================================================
    // OPERATIONS ZUSAMMENFÜHREN: Trigger + LLM
    // ============================================================
    const operations = {
      board: {
        createIncidentSites: [
          ...triggerOperations.board.createIncidentSites,
          ...(llmOperations.board?.createIncidentSites || [])
        ],
        updateIncidentSites: [
          ...triggerOperations.board.updateIncidentSites,
          ...(llmOperations.board?.updateIncidentSites || [])
        ]
      },
      aufgaben: {
        create: [
          ...triggerOperations.aufgaben.create,
          ...(llmOperations.aufgaben?.create || [])
        ],
        update: [
          ...triggerOperations.aufgaben.update,
          ...(llmOperations.aufgaben?.update || [])
        ]
      },
      protokoll: {
        create: [
          ...triggerOperations.protokoll.create,
          ...(llmOperations.protokoll?.create || [])
        ]
      }
    };

    const analysis = (llmResponse || {}).analysis || "";

    // METRICS: Operations zählen
    metrics.incrementCounter('simulation_operations_total',
      { type: 'board_create', source },
      operations.board.createIncidentSites.length
    );
    metrics.incrementCounter('simulation_operations_total',
      { type: 'board_update', source },
      operations.board.updateIncidentSites.length
    );
    metrics.incrementCounter('simulation_operations_total',
      { type: 'aufgaben_create', source },
      operations.aufgaben.create.length
    );
    metrics.incrementCounter('simulation_operations_total',
      { type: 'protokoll_create', source },
      operations.protokoll.create.length
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

    simulationState.lastSnapshot = {
      board: boardSnapshot,
      aufgaben: aufgabenSnapshot,
      protokoll: protokollSnapshot
    };

simulationState.lastCompressedBoard = opsContext.compressedBoard;

    // NEU: Audit-Event für Simulationsschritt-Ende
    const stepDuration = Date.now() - stepStartTime;
    logEvent("simulation", "step_complete", {
      stepId,
      durationMs: stepDuration,
      protocolsCreated: operations.protokoll?.create?.length || 0,
      tasksCreated: operations.aufgaben?.create?.length || 0,
      incidentsCreated: operations.board?.createIncidentSites?.length || 0,
      responsesGenerated: messagesNeedingResponse.length
    });

    // ============================================================
    // NEU: Automatische Indizierung in RAG-Systeme
    // ============================================================
    try {
      // Incidents indizieren
      for (const incident of operations.board?.createIncidentSites || []) {
        await indexIncident(incident, "created");
      }
      for (const incident of operations.board?.updateIncidentSites || []) {
        await indexIncident(incident, "updated");
      }

      // Aufgaben indizieren
      for (const task of operations.aufgaben?.create || []) {
        await indexTask(task, "created");
      }

      // Protokolleinträge indizieren
      for (const entry of operations.protokoll?.create || []) {
        await indexProtocolEntry(entry);
      }

      logDebug("RAG-Indizierung abgeschlossen", {
        incidents: (operations.board?.createIncidentSites?.length || 0) +
                   (operations.board?.updateIncidentSites?.length || 0),
        tasks: operations.aufgaben?.create?.length || 0,
        protocols: operations.protokoll?.create?.length || 0
      });
    } catch (indexError) {
      logError("Fehler bei RAG-Indizierung", { error: String(indexError) });
    }

    // ============================================================
    // SIMULATIONSZEIT INCREMENTIEREN (REFACTORED)
    // ============================================================
    incrementSimulationStep();
    const minutesToAdd = getScenarioMinutesPerStep(simulationState.activeScenario, 5);
    simulationState.incrementTime(minutesToAdd);

    // METRICS: Erfasse Step-Dauer und aktuelle Simulationszeit
    const totalStepDuration = stepTimer.stop();
    metrics.recordHistogram('simulation_step_duration_ms',
      { source },
      totalStepDuration
    );
    metrics.setGauge('simulation_elapsed_minutes',
      {},
      simulationState.elapsedMinutes
    );
    metrics.setGauge('simulation_step_count',
      {},
      simulationState.stepCount
    );

    logDebug("Simulationsschritt abgeschlossen", {
      durationMs: totalStepDuration,
      elapsedMinutes: simulationState.elapsedMinutes,
      stepCount: simulationState.stepCount
    });

    return { ok: true, operations, analysis };
  } catch (err) {
    // ERROR HANDLING (REFACTORED)
    const decision = handleSimulationError(err, { source, stepId });

    // NEU: Fehler im Audit loggen
    logEvent("error", "simulation_failed", {
      source,
      error: String(err),
      decision
    });

    logError("Fehler im Simulationsschritt", { error: String(err), source, decision });

    // METRICS: Fehler zählen
    metrics.incrementCounter('simulation_errors_total',
      { source, errorType: err.name || 'UnknownError' },
      1
    );

    return { ok: false, error: String(err), decision };
  } finally {
    simulationState.stepInProgress = false;
  }
}


