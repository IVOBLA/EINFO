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
import { syncRolesFile } from "./roles_sync.js";

// Neue Module (Verbesserungen)
import { simulationState } from "./simulation_state.js";
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
  path.resolve(__dirname, "../../server/log")
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
// Identifiziert offene Rückfragen im Protokoll (Single-Source-of-Truth)
// ============================================================
const BOT_INDICATORS = new Set([
  "chatbot",
  "bot",
  "simulation-worker",
  "sim-worker",
  "simulation",
  "sim"
]);

function normalizeIndicator(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function isBotEntry(entry = {}) {
  const indicators = [
    entry.createdBy,
    entry.source,
    entry.uebermittlungsart?.kanalNr,
    entry.anvon,
    entry.history?.[0]?.by
  ].map(normalizeIndicator);

  return indicators.some((value) => BOT_INDICATORS.has(value));
}

function isOutgoingEntry(entry = {}) {
  const richtung = entry.richtung || entry.uebermittlungsart?.richtung || "";
  return /aus/i.test(richtung) ||
    entry.uebermittlungsart?.aus === true ||
    entry.uebermittlungsart?.aus === "true";
}

function stripAnVonPrefix(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .replace(/^(an|von)\s*:\s*/i, "")
    .trim();
}

function parseRecipients(entry = {}) {
  const recipients = [];
  if (typeof entry.anvon === "string") {
    const cleaned = stripAnVonPrefix(entry.anvon);
    const fromAnvon = cleaned
      .split(/[,;]/)
      .map((r) => r.trim())
      .filter(Boolean);
    recipients.push(...fromAnvon);
  }

  if (Array.isArray(entry.ergehtAn)) {
    recipients.push(...entry.ergehtAn);
  } else if (entry.ergehtAn) {
    recipients.push(entry.ergehtAn);
  }

  if (typeof entry.ergehtAnText === "string") {
    const fromText = entry.ergehtAnText
      .split(/[,;]/)
      .map((r) => r.trim())
      .filter(Boolean);
    recipients.push(...fromText);
  }

  const seen = new Set();
  const uniqueRecipients = [];
  for (const recipient of recipients) {
    const cleaned = stripAnVonPrefix(recipient);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    uniqueRecipients.push(cleaned);
  }

  return uniqueRecipients;
}

function compareByDateTimeAsc(a, b) {
  const timeA = `${a.datum || ""} ${a.zeit || ""}`;
  const timeB = `${b.datum || ""} ${b.zeit || ""}`;
  return timeA.localeCompare(timeB);
}

/**
 * Findet alle offenen Rückfragen im Protokoll.
 *
 * Kriterien:
 * 1. NICHT vom Bot erstellt (createdBy/source/kanalNr/anvon Indikatoren)
 * 2. richtung = "aus" oder uebermittlungsart.aus === true
 * 3. information enthält "?"
 * 4. mind. ein Empfänger ist extern (nicht in INTERNAL_ROLES)
 * 5. rueckmeldung1 ist gesetzt und nicht "answered"
 *
 * @param {Array} protokoll - Alle Protokolleinträge
 * @param {Object} rolesOrConstants - optionales Objekt mit internalRoles
 * @returns {Array} Offene Rückfragen (0..n)
 */
export function identifyOpenFollowUps(protokoll, rolesOrConstants = {}) {
  const openFollowUps = [];
  const internalRoles =
    rolesOrConstants?.internalRoles ||
    rolesOrConstants?.INTERNAL_ROLES ||
    INTERNAL_ROLES;
  const internalRolesSet = new Set(
    Array.from(internalRoles).map((role) => String(role).toUpperCase())
  );

  for (const entry of protokoll || []) {
    if (isBotEntry(entry)) continue;
    if (!isOutgoingEntry(entry)) continue;

    const information =
      typeof entry.information === "string" ? entry.information.trim() : "";
    if (!information.includes("?")) continue;

    const recipients = parseRecipients(entry);
    const externalRecipients = recipients.filter((recipient) => {
      const upper = String(recipient).toUpperCase();
      return !internalRolesSet.has(upper);
    });
    if (externalRecipients.length === 0) continue;

    const rueckmeldung1 = entry.rueckmeldung1;
    if (rueckmeldung1 != null && String(rueckmeldung1).trim() !== "") continue;

    openFollowUps.push({
      id: entry.id,
      nr: entry.nr,
      datum: entry.datum || "",
      zeit: entry.zeit || "",
      infoTyp: entry.infoTyp || entry.typ || "",
      anvon: entry.anvon || "",
      ergehtAn: recipients,
      externalRecipients,
      information,
      originalEntry: entry
    });
  }

  return openFollowUps.sort(compareByDateTimeAsc);
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

  // Kompaktes Format: nur notwendige Felder, keine null-Werte
  const compact = filtered.map((i) => {
    const entry = {
      id: i.id,
      content: (i.desc ?? i.content ?? "").slice(0, 80),
      status: i.status ?? i.column ?? "",
      ort: (i.location ?? i.ort ?? "").slice(0, 40)
    };
    // Nur hinzufügen wenn vorhanden
    if (i.typ) entry.typ = i.typ;
    return entry;
  });

  return JSON.stringify(compact);
}
// Aufg_board_S2.json: S2-Aufgaben
// Nur relevante Felder für LLM-Kontext (read-only)

export function compressAufgaben(aufgaben, activeRoles = []) {
  if (!Array.isArray(aufgaben)) return "[]";

  const maxItems = CONFIG.prompt?.maxAufgabenItems || 30;
  const activeSet = new Set(activeRoles.map(r => String(r).toUpperCase()));

  // Nur Aufgaben der aktiven Rollen, nicht-erledigte zuerst
  const filtered = aufgaben
    .filter(a => {
      // Nur Aufgaben der aktiven Rollen
      const responsible = String(a.responsible || "").toUpperCase();
      return activeSet.has(responsible);
    })
    .filter(a => a.status !== "Erledigt" && a.status !== "Storniert")
    .slice(0, maxItems);

  // Kompaktes Format: nur desc, status + optionale Referenzen
  const compact = filtered.map((a) => {
    const entry = {
      desc: (a.desc || a.title || a.description || "").slice(0, 80),
      status: a.status || ""
    };
    // Nur hinzufügen wenn vorhanden (Referenzen)
    if (a.originProtocolNr) entry.protNr = a.originProtocolNr;
    if (a.relatedIncidentId) entry.incidentId = a.relatedIncidentId;
    return entry;
  });

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

  // Kompaktes Format: nur notwendige Felder, keine leeren Arrays
  const compact = sorted.slice(0, maxItems).map((p) => {
    const entry = {
      id: p.id,
      information: (p.information || "").slice(0, 100),
      datum: p.datum,
      zeit: p.zeit,
      anvon: p.anvon || "",
      infoTyp: p.infoTyp || p.typ || ""
    };
    // Nur hinzufügen wenn nicht leer
    if (p.ergehtAn && p.ergehtAn.length > 0) entry.ergehtAn = p.ergehtAn;
    return entry;
  });

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
  // PAUSE: Simulation pausiert wenn auf Rollen gewartet wird
  // Keine Schritte überspringen - stattdessen pausieren
  // ============================================================
  if (simulationState.waitingForRoles) {
    logInfo("Simulation pausiert - wartet auf aktive Rollen", {
      elapsedMinutes: simulationState.elapsedMinutes,
      stepCount: simulationState.stepCount
    });
    return { ok: false, reason: "waiting_for_roles", paused: true };
  }

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
    // ============================================================
    // ROLLEN-SYNCHRONISATION: Aktuelle Online-Rollen vom Server holen
    // Stellt sicher dass neu angemeldete Rollen vor dem Schritt erkannt werden
    // ============================================================
    await syncRolesFile();

    const einfoData = await readEinfoInputs();
    const { roles, board, aufgaben, protokoll } = einfoData;
    setEinfoSnapshot({ aufgaben, protokoll });

    // Aktualisiere die Rollen im SimulationState
    simulationState.updateRoles(roles);

    logDebug("Aktive Rollen für Simulationsschritt", {
      active: roles.active,
      missing: roles.missing
    });

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
    // NEU: Identifiziere offene Rückfragen (Single-Source-of-Truth)
    // ============================================================
    const openFollowUps = identifyOpenFollowUps(protokoll, roles);

    logInfo(`Offene Rueckfragen (${openFollowUps.length})`, {
      count: openFollowUps.length,
      preview: openFollowUps.slice(0, 2).map((entry) => ({
        nr: entry.nr,
        info: (entry.information || "").slice(0, 80)
      }))
    });

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
      compressedAufgaben: compressAufgaben(aufgaben, roles.active),
      compressedProtokoll: compressProtokoll(protokoll),
      firstStep: isFirstStep,
      elapsedMinutes: simulationState.elapsedMinutes,  // NEU: Für phasenbasierte Requirements
      // NEU: Offene Rückfragen (Single-Source-of-Truth)
      openQuestions: openFollowUps.length > 0
        ? openFollowUps
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
            protokoll: triggerOperations.protokoll.create.length
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
    const { parsed: llmResponse, model: llmModel, exchangeId } = await callLLMForOps({
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
      model: llmModel,
      exchangeId
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

    // Aufgaben werden NUR von Benutzern verwaltet - LLM-Aufgaben ignorieren
    delete llmOperations.aufgaben;

    if (!llmOperations.protokoll) {
      llmOperations.protokoll = { create: [] };
    }
    if (!llmOperations.protokoll.create) {
      llmOperations.protokoll.create = [];
    }

    logDebug("LLM-Operations normalisiert", {
      boardCreate: llmOperations.board?.createIncidentSites?.length || 0,
      boardUpdate: llmOperations.board?.updateIncidentSites?.length || 0,
      protokollCreate: llmOperations.protokoll?.create?.length || 0
    });

    // ============================================================
    // OPERATIONS ZUSAMMENFÜHREN: Trigger + LLM
    // HINWEIS: Aufgaben werden NUR von Benutzern verwaltet, nicht vom LLM
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
      aufgaben: { create: [], update: [] }, // Deaktiviert - nur Benutzer verwalten Aufgaben
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
      { type: 'protokoll_create', source },
      operations.protokoll.create.length
    );

    logInfo("Simulationsschritt", {
      source,
      hasBoardOps:
        (operations.board?.createIncidentSites?.length || 0) +
          (operations.board?.updateIncidentSites?.length || 0) >
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
      incidentsCreated: operations.board?.createIncidentSites?.length || 0,
      openFollowUps: openFollowUps.length
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

      // Protokolleinträge indizieren
      for (const entry of operations.protokoll?.create || []) {
        await indexProtocolEntry(entry);
      }

      logDebug("RAG-Indizierung abgeschlossen", {
        incidents: (operations.board?.createIncidentSites?.length || 0) +
                   (operations.board?.updateIncidentSites?.length || 0),
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


