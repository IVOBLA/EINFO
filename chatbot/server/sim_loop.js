// chatbot/server/sim_loop.js

import { CONFIG } from "./config.js";
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
  getScenarioMinutesPerStep
} from "./scenario_controls.js";
import {
  isStabsstelle,
  isMeldestelle,
  normalizeRole
} from "./field_mapper.js";

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
function identifyMessagesNeedingResponse(protokoll, protokollDelta, roles) {
  const { active } = roles;
  const activeSet = new Set(active.map(r => String(r).toUpperCase()));
  const needingResponse = [];

  // Prüfe nur neue/geänderte Einträge (Delta)
  for (const entry of protokollDelta) {
    // Nur ausgehende Meldungen prüfen
    const richtung = entry.richtung || entry.uebermittlungsart?.richtung || "";
    const isOutgoing = /aus/i.test(richtung) || 
                       entry.uebermittlungsart?.aus === true ||
                       entry.uebermittlungsart?.aus === "true";
    
    if (!isOutgoing) continue;

    // Prüfe ob diese Meldung bereits eine Antwort hat
    // (suche nach Protokolleinträgen die auf diese Meldung antworten)
    const hasResponse = protokoll.some(p => {
      if (p.id === entry.id) return false;
      const pRichtung = p.richtung || p.uebermittlungsart?.richtung || "";
      const isIncoming = /ein/i.test(pRichtung) || p.uebermittlungsart?.ein;
      if (!isIncoming) return false;
      
      // Prüfe ob es eine Rückmeldung auf diese Nr ist
      const refNr = p.bezugNr || p.referenzNr || p.antwortAuf;
      if (refNr && String(refNr) === String(entry.nr)) return true;
      
      // Oder ob der Absender der Antwort ein Empfänger der Original-Meldung war
      const pVon = String(p.anvon || "").toUpperCase();
      const originalEmpfaenger = Array.isArray(entry.ergehtAn) 
        ? entry.ergehtAn.map(e => String(e).toUpperCase())
        : [];
      if (originalEmpfaenger.includes(pVon)) {
        // Zeitlich nach der Original-Meldung?
        const origTime = entry.zeit || "";
        const respTime = p.zeit || "";
        if (respTime > origTime) return true;
      }
      
      return false;
    });

    if (hasResponse) continue;

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
function identifyOpenQuestions(protokoll, roles) {
  const { active } = roles;
  const activeSet = new Set(active.map(r => String(r).toUpperCase()));
  const openQuestions = [];

  // Sortiere Protokoll nach Zeit (älteste zuerst für korrekte Antwort-Erkennung)
  const sortedProtokoll = [...protokoll].sort((a, b) => {
    const timeA = `${a.datum || ""} ${a.zeit || ""}`;
    const timeB = `${b.datum || ""} ${b.zeit || ""}`;
    return timeA.localeCompare(timeB);
  });

  for (let i = 0; i < sortedProtokoll.length; i++) {
    const entry = sortedProtokoll[i];

    const zuValue = typeof entry.zu === "string" ? entry.zu.trim() : entry.zu;
    if (zuValue) continue;

    // Kriterium 1: NICHT vom CHATBOT erstellt
    const createdBy = entry.createdBy || entry.history?.[0]?.by || "";
    const kanalNr = entry.uebermittlungsart?.kanalNr || "";
    const isFromBot =
      createdBy === "CHATBOT" ||
      createdBy === "simulation-worker" ||
      createdBy === "bot" ||
      kanalNr === "bot";

    if (isFromBot) continue;

    // Kriterium 2: Ist dies eine Rückfrage?
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

    // Ist dies eine Rückfrage?
    const isQuestion = hasQuestionMark || targetsNonActiveInternal || targetsExternal;
    if (!isQuestion) continue;

    // Kriterium 3: Wurde die Frage bereits beantwortet?
    // Suche nach nachfolgenden Bot-Einträgen die auf diese Frage antworten
    const hasAnswer = sortedProtokoll.slice(i + 1).some(p => {
      // Muss vom Bot erstellt worden sein
      const pCreatedBy = p.createdBy || p.history?.[0]?.by || "";
      const pKanalNr = p.uebermittlungsart?.kanalNr || "";
      const pIsFromBot =
        pCreatedBy === "CHATBOT" ||
        pCreatedBy === "simulation-worker" ||
        pCreatedBy === "bot" ||
        pKanalNr === "bot";

      if (!pIsFromBot) return false;

      // Prüfe ob es eine Rückmeldung auf diese Nr ist
      const refNr = p.bezugNr || p.referenzNr || p.antwortAuf;
      if (refNr && String(refNr) === String(entry.nr)) return true;

      // Oder ob der Absender der Antwort ein Empfänger der Original-Frage war
      const pVon = String(p.anvon || "").toUpperCase();
      const originalEmpfaenger = ergehtAn.map(e => String(e).toUpperCase());
      if (originalEmpfaenger.includes(pVon)) {
        // Prüfe ob der Inhalt auf die Frage Bezug nimmt
        const pInfo = (p.information || "").toLowerCase();
        const keywords = information.toLowerCase().split(/\s+/).slice(0, 5);
        const hasRelevantContent = keywords.some(kw =>
          kw.length > 3 && pInfo.includes(kw)
        );
        if (hasRelevantContent) return true;

        // Oder zeitlich kurz danach (innerhalb von 30 Min)
        const entryTime = `${entry.datum || ""} ${entry.zeit || ""}`;
        const pTime = `${p.datum || ""} ${p.zeit || ""}`;
        if (pTime > entryTime) {
          // Einfache zeitliche Nähe als Indikator
          return true;
        }
      }

      return false;
    });

    if (hasAnswer) continue;

    // Diese Rückfrage ist noch offen
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

// Merkt sich den letzten Stand der eingelesenen EINFO-Daten, damit nur neue
// oder geänderte Einträge erneut an das LLM geschickt werden müssen.
let lastComparableSnapshot = null;
let lastCompressedBoardJson = "[]";

let running = false;
let stepInProgress = false;
// NEU: Zustand für "Simulation wurde gerade gestartet"
// Wird beim Start auf true gesetzt und nach dem ersten Schritt zurückgesetzt
let simulationJustStarted = false;
// NEU: Aktives Szenario für die Simulation
let activeScenario = null;
let simulationElapsedMinutes = 0;

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

function compressProtokoll(protokoll) {
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

export async function startSimulation(scenario = null) {
  running = true;
  // NEU: Setze Zustand für ersten Schritt nur bei frischem/leerem Zustand
  const snapshotCounts = {
    board: lastComparableSnapshot?.board?.length || 0,
    aufgaben: lastComparableSnapshot?.aufgaben?.length || 0,
    protokoll: lastComparableSnapshot?.protokoll?.length || 0
  };
  const hasSnapshotData =
    snapshotCounts.board > 0 ||
    snapshotCounts.aufgaben > 0 ||
    snapshotCounts.protokoll > 0;
  const hasCompressedBoard =
    typeof lastCompressedBoardJson === "string" && lastCompressedBoardJson !== "[]";
  simulationJustStarted = !(hasSnapshotData || hasCompressedBoard);
  // NEU: Szenario speichern für die Simulation
  activeScenario = scenario;
  simulationElapsedMinutes = 0;

  if (scenario) {
    logInfo("Simulation mit Szenario gestartet", {
      scenarioId: scenario.id,
      title: scenario.title,
      eventType: scenario.scenario_context?.event_type
    });
  } else {
    logInfo(
      "EINFO-Chatbot Simulation gestartet (Schritte werden vom Worker ausgelöst)",
      null
    );
  }

  // Auto-Loop ist bewusst deaktiviert.
  // Alle Simulationsschritte kommen über /api/sim/step vom chatbot_worker.
}

/**
 * Gibt das aktuell aktive Szenario zurück
 */
export function getActiveScenario() {
  return activeScenario;
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
    setEinfoSnapshot({ aufgaben, protokoll });

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
    // NEU: Nutze den expliziten Zustand simulationJustStarted statt Heuristik
    const isFirstStep = simulationJustStarted;

    // Zustand nach dem Auslesen zurücksetzen
    if (simulationJustStarted) {
      simulationJustStarted = false;
      logInfo("Erster Simulationsschritt: Start-Prompt wird verwendet", null);
    }

    const boardUnchanged =
      lastComparableSnapshot?.board?.length === boardSnapshot.length &&
      boardDelta.length === 0;

  const opsContext = {
    roles: {
      active: roles.active
    },
      compressedBoard: boardUnchanged
        ? lastCompressedBoardJson
        : compressBoard(boardSnapshot),
      compressedAufgaben: compressAufgaben(aufgaben),
      compressedProtokoll: compressProtokoll(protokoll),
      firstStep: isFirstStep,
      elapsedMinutes: simulationElapsedMinutes,  // NEU: Für phasenbasierte Requirements
      // NEU: Meldungen die Antwort brauchen
      messagesNeedingResponse: messagesNeedingResponse.length > 0
        ? messagesNeedingResponse
        : null,
      // NEU: Offene Rückfragen von echten Benutzern
      openQuestions: openQuestions.length > 0
        ? openQuestions
        : null,
      scenarioControl: buildScenarioControlSummary({
        scenario: activeScenario,
        elapsedMinutes: simulationElapsedMinutes
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

    const { parsed: llmResponse } = await callLLMForOps({
      llmInput: opsContext,
      memorySnippets,
      scenario: activeScenario  // NEU: Szenario an LLM übergeben
    });

    // NEU: LLM-Aufruf im Audit loggen
    const llmDuration = Date.now() - stepStartTime;
    logEvent("llm", "ops_call", {
      stepId,
      durationMs: llmDuration,
      hasResponse: !!llmResponse,
      model: CONFIG.llmChatModel
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

    // NEU: Simulationsschritt-Counter inkrementieren
    incrementSimulationStep();
    simulationElapsedMinutes += getScenarioMinutesPerStep(activeScenario, 5);

    return { ok: true, operations, analysis };
  } catch (err) {
    // NEU: Fehler im Audit loggen
    logEvent("error", "simulation_failed", {
      source,
      error: String(err)
    });
    
    logError("Fehler im Simulationsschritt", { error: String(err), source });
    return { ok: false, error: String(err) };
  } finally {
    stepInProgress = false;
  }
}


