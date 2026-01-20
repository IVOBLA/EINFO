// chatbot/server/disaster_context.js
//
// Disaster Context System: Sammelt und verarbeitet den gesamten Verlauf
// der aktuellen Katastrophe für kontextbewusstes LLM-Processing

import fsPromises from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError, logInfo } from "./logger.js";
import { getCurrentState } from "./state_store.js";
import { loadPromptTemplate, fillTemplate } from "./prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pfad für Disaster History
const DISASTER_HISTORY_DIR = path.resolve(__dirname, "../../server/data/disaster_history");

// Pfade für EINFO-Daten (für direkten Zugriff auf aktuelle Daten)
const EINFO_DATA_DIR = path.resolve(__dirname, "../../server/data");
const PROTOCOL_FILE = path.join(EINFO_DATA_DIR, "protocol.json");
const BOARD_FILE = path.join(EINFO_DATA_DIR, "board.json");
const AUFG_PREFIX = "Aufg";

// Stabsrollen für Aufgaben
const STAFF_ROLES = ["LTSTB", "S1", "S2", "S3", "S4", "S5", "S6"];

/**
 * Disaster Context Struktur:
 * {
 *   disasterId: "disaster_2025_001",
 *   type: "hochwasser" | "sturm" | "schnee" | "mure" | "unfall",
 *   startTime: timestamp,
 *   currentPhase: "initial" | "escalation" | "peak" | "resolution" | "completed",
 *
 *   timeline: [
 *     {
 *       timestamp: number,
 *       phase: string,
 *       event: string,
 *       significance: "low" | "medium" | "high" | "critical"
 *     }
 *   ],
 *
 *   activeIncidents: [
 *     {
 *       id: string,
 *       type: string,
 *       location: string,
 *       status: "neu" | "in-bearbeitung" | "erledigt",
 *       startTime: timestamp,
 *       priority: "low" | "medium" | "high" | "critical"
 *     }
 *   ],
 *
 *   keyDecisions: [
 *     {
 *       timestamp: number,
 *       decision: string,
 *       madeBy: string,
 *       outcome: string | null,
 *       llmSuggested: boolean
 *     }
 *   ],
 *
 *   resources: {
 *     deployed: {
 *       vehicles: number,
 *       personnel: number,
 *       equipment: {}
 *     },
 *     available: {
 *       vehicles: number,
 *       personnel: number
 *     }
 *   },
 *
 *   statistics: {
 *     totalIncidents: number,
 *     resolvedIncidents: number,
 *     activeIncidents: number,
 *     averageResolutionTime: number,
 *     llmSuggestionsAccepted: number,
 *     llmSuggestionsRejected: number
 *   },
 *
 *   patterns: [
 *     {
 *       type: string,
 *       description: string,
 *       frequency: number,
 *       lastOccurrence: timestamp
 *     }
 *   ]
 * }
 */

// In-Memory-Cache für aktuellen Disaster Context
let currentDisasterContext = null;

/**
 * Initialisiert einen neuen Disaster Context
 */
export async function initializeDisasterContext({ type, description, scenario }) {
  const disasterId = `disaster_${Date.now()}`;
  const now = Date.now();

  currentDisasterContext = {
    disasterId,
    type: type || "unspecified",
    description: description || "",
    scenario: scenario || null,
    startTime: now,
    lastUpdate: now,
    currentPhase: "initial",

    timeline: [
      {
        timestamp: now,
        phase: "initial",
        event: `Katastrophe ${type} gestartet: ${description}`,
        significance: "critical"
      }
    ],

    activeIncidents: [],
    keyDecisions: [],

    resources: {
      deployed: {
        vehicles: 0,
        personnel: 0,
        equipment: {}
      },
      available: {
        vehicles: 0,
        personnel: 0
      }
    },

    statistics: {
      totalIncidents: 0,
      resolvedIncidents: 0,
      activeIncidents: 0,
      averageResolutionTime: 0,
      llmSuggestionsAccepted: 0,
      llmSuggestionsRejected: 0,
      totalSimulationSteps: 0
    },

    patterns: []
  };

  // Speichere Initial-State
  await saveDisasterContext();

  logInfo("Disaster Context initialisiert", { disasterId, type });

  return currentDisasterContext;
}

/**
 * Aktualisiert den Disaster Context mit neuen Daten aus EINFO
 */
export async function updateDisasterContextFromEinfo({ board, protokoll, aufgaben, roles }) {
  if (!currentDisasterContext) {
    logError("Kein aktiver Disaster Context - initialisiere automatisch", null);
    await initializeDisasterContext({
      type: "unspecified",
      description: "Automatisch gestartet"
    });
  }

  const now = Date.now();
  currentDisasterContext.lastUpdate = now;

  // Update Active Incidents vom Board
  const newActiveIncidents = board.map(item => ({
    id: item.id,
    type: item.typ || "unspecified",
    location: item.ort || "Unbekannt",
    status: item.column || "neu",
    content: item.content || "",
    startTime: item.timestamp || now,
    priority: determinePriority(item),
    alerted: item.alerted || ""
  }));

  // Erkenne neue und gelöste Incidents
  const oldIncidentIds = new Set(currentDisasterContext.activeIncidents.map(i => i.id));
  const newIncidentIds = new Set(newActiveIncidents.map(i => i.id));

  // Neue Incidents → Timeline-Event
  for (const incident of newActiveIncidents) {
    if (!oldIncidentIds.has(incident.id)) {
      addToTimeline({
        event: `Neuer Einsatz: ${incident.type} - ${incident.location}`,
        significance: incident.priority === "critical" ? "critical" : "medium"
      });
      currentDisasterContext.statistics.totalIncidents++;
      currentDisasterContext.statistics.activeIncidents++;
    }
  }

  // Gelöste Incidents → Timeline-Event
  for (const oldIncident of currentDisasterContext.activeIncidents) {
    if (!newIncidentIds.has(oldIncident.id)) {
      addToTimeline({
        event: `Einsatz abgeschlossen: ${oldIncident.type} - ${oldIncident.location}`,
        significance: "medium"
      });
      currentDisasterContext.statistics.resolvedIncidents++;
      currentDisasterContext.statistics.activeIncidents--;
    }
  }

  currentDisasterContext.activeIncidents = newActiveIncidents;

  // Erkenne Phase-Änderungen
  detectPhaseChange();

  // Erkenne Patterns
  detectPatterns();

  // Speichere Update
  await saveDisasterContext();

  return currentDisasterContext;
}

/**
 * Fügt eine LLM-Suggestion zum Context hinzu
 */
export async function recordLLMSuggestion({ suggestion, accepted, madeBy }) {
  if (!currentDisasterContext) return;

  const decision = {
    timestamp: Date.now(),
    decision: suggestion,
    madeBy: madeBy || "LLM",
    outcome: accepted ? "accepted" : "rejected",
    llmSuggested: true
  };

  currentDisasterContext.keyDecisions.push(decision);

  if (accepted) {
    currentDisasterContext.statistics.llmSuggestionsAccepted++;
  } else {
    currentDisasterContext.statistics.llmSuggestionsRejected++;
  }

  await saveDisasterContext();
}

/**
 * Fügt ein Event zur Timeline hinzu
 */
function addToTimeline({ event, significance = "medium" }) {
  if (!currentDisasterContext) return;

  currentDisasterContext.timeline.push({
    timestamp: Date.now(),
    phase: currentDisasterContext.currentPhase,
    event,
    significance
  });

  // Limitiere Timeline-Größe (behalte letzte 200 Events)
  if (currentDisasterContext.timeline.length > 200) {
    currentDisasterContext.timeline = currentDisasterContext.timeline.slice(-200);
  }
}

/**
 * Erkennt Phase-Änderungen basierend auf Context
 */
function detectPhaseChange() {
  if (!currentDisasterContext) return;

  const { activeIncidents, statistics, currentPhase } = currentDisasterContext;
  const activeCount = activeIncidents.length;
  const criticalCount = activeIncidents.filter(i => i.priority === "critical").length;

  let newPhase = currentPhase;

  // Phase-Logik
  if (currentPhase === "initial" && activeCount > 0) {
    newPhase = "escalation";
  } else if (currentPhase === "escalation" && (activeCount > 10 || criticalCount > 3)) {
    newPhase = "peak";
  } else if (currentPhase === "peak" && activeCount < 5 && criticalCount === 0) {
    newPhase = "resolution";
  } else if (currentPhase === "resolution" && activeCount === 0) {
    newPhase = "completed";
  }

  if (newPhase !== currentPhase) {
    currentDisasterContext.currentPhase = newPhase;
    addToTimeline({
      event: `Phase-Wechsel: ${currentPhase} → ${newPhase}`,
      significance: "high"
    });
    logInfo("Disaster Phase geändert", { from: currentPhase, to: newPhase });
  }
}

/**
 * Erkennt wiederkehrende Patterns
 */
function detectPatterns() {
  if (!currentDisasterContext) return;

  const { timeline } = currentDisasterContext;

  // Pattern: Häufige Einsatztypen
  const typeCount = {};
  for (const incident of currentDisasterContext.activeIncidents) {
    typeCount[incident.type] = (typeCount[incident.type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(typeCount)) {
    if (count >= 3) {
      const existingPattern = currentDisasterContext.patterns.find(p => p.type === type);
      if (existingPattern) {
        existingPattern.frequency = count;
        existingPattern.lastOccurrence = Date.now();
      } else {
        currentDisasterContext.patterns.push({
          type,
          description: `Häufung von ${type}-Einsätzen`,
          frequency: count,
          lastOccurrence: Date.now()
        });
      }
    }
  }
}

/**
 * Bestimmt Priorität eines Incidents
 */
function determinePriority(item) {
  const content = (item.content || "").toLowerCase();

  // Kritisch: Menschenleben in Gefahr
  if (content.includes("verletzt") || content.includes("vermisst") ||
      content.includes("eingeschlossen") || content.includes("lebensgefahr")) {
    return "critical";
  }

  // Hoch: Großflächige Schäden
  if (content.includes("großbrand") || content.includes("evakuierung") ||
      content.includes("überflutung")) {
    return "high";
  }

  // Medium: Standard
  return "medium";
}

/**
 * Lädt aktuelle EINFO-Daten direkt aus den Dateien
 * (Protokolle, Aufgaben, Einsätze)
 *
 * Gibt zurück:
 * - board: Flaches Array aller Board-Items (für einfache Iteration)
 * - boardRaw: Originales Board-Objekt mit columns-Struktur (für Filterung/Fingerprint)
 * - protokoll: Array der Protokolleinträge
 * - protocol: Alias für protokoll (für englische Konsistenz)
 * - aufgaben: Array der Aufgaben
 */
export async function loadCurrentEinfoData() {
  const result = {
    protokoll: [],
    protocol: [], // Alias für englische Konsistenz
    aufgaben: [],
    board: [],
    boardRaw: null, // Originales Board-Objekt mit columns
    loadedAt: Date.now()
  };

  // 1. Protokolle laden
  try {
    const raw = await fsPromises.readFile(PROTOCOL_FILE, "utf8");
    const parsed = JSON.parse(raw);
    result.protokoll = Array.isArray(parsed) ? parsed : [];
    result.protocol = result.protokoll; // Alias
  } catch (err) {
    if (err?.code !== "ENOENT") {
      logError("Fehler beim Laden der Protokolle", { error: String(err) });
    }
  }

  // 2. Board/Einsätze laden
  try {
    const raw = await fsPromises.readFile(BOARD_FILE, "utf8");
    const parsed = JSON.parse(raw);

    // board.json kann entweder ein Array oder eine columns-Struktur sein
    if (Array.isArray(parsed)) {
      result.board = parsed;
      // Kein columns-Format vorhanden, boardRaw bleibt null
      result.boardRaw = null;
    } else if (parsed?.columns && typeof parsed.columns === "object") {
      // Speichere das originale Board-Objekt mit columns für Filterung/Fingerprint
      result.boardRaw = parsed;

      // Extrahiere Items aus allen Spalten und füge column-Info hinzu (flaches Array)
      const allItems = [];
      for (const [columnKey, columnData] of Object.entries(parsed.columns)) {
        const items = Array.isArray(columnData?.items) ? columnData.items : [];
        for (const item of items) {
          allItems.push({
            ...item,
            column: columnKey // z.B. "neu", "in-bearbeitung", "erledigt"
          });
        }
      }
      result.board = allItems;
    } else {
      result.board = [];
      result.boardRaw = null;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      logError("Fehler beim Laden des Boards", { error: String(err) });
    }
  }

  // 3. Aufgaben für alle Rollen laden
  for (const role of STAFF_ROLES) {
    try {
      const aufgFile = path.join(EINFO_DATA_DIR, `${AUFG_PREFIX}_board_${role}.json`);
      const raw = await fsPromises.readFile(aufgFile, "utf8");
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      // Rolle zu jeder Aufgabe hinzufügen
      for (const item of items) {
        result.aufgaben.push({ ...item, _role: role });
      }
    } catch (err) {
      // Datei existiert möglicherweise nicht - das ist OK
      if (err?.code !== "ENOENT") {
        logDebug("Fehler beim Laden der Aufgaben für Rolle", { role, error: String(err) });
      }
    }
  }

  logDebug("EINFO-Daten geladen", {
    protokollCount: result.protokoll.length,
    aufgabenCount: result.aufgaben.length,
    boardCount: result.board.length
  });

  return result;
}

/**
 * Gibt den aktuellen Disaster Context zurück
 */
export function getCurrentDisasterContext() {
  return currentDisasterContext;
}

/**
 * Erstellt einen komprimierten Context-String für LLM-Prompts
 * WICHTIG: Diese Funktion lädt immer die aktuellen EINFO-Daten
 * (Protokolle, offene Aufgaben, offene Einsätze) direkt aus den Dateien
 */
export async function getDisasterContextSummary({ maxLength = 1500 } = {}) {
  // Immer aktuelle EINFO-Daten laden
  const einfoData = await loadCurrentEinfoData();

  let summary = "";

  if (!currentDisasterContext) {
    summary = buildFallbackContextSummaryFromData(einfoData);
  } else {
    const {
      type,
      description,
      startTime,
      currentPhase,
      statistics,
      timeline,
      patterns
    } = currentDisasterContext;

    const duration = Math.floor((Date.now() - startTime) / 60000); // Minuten
    const recentTimeline = timeline.slice(-10); // Letzte 10 Events

    summary = `### AKTUELLER KATASTROPHEN-CONTEXT ###\n\n`;
    summary += `Typ: ${type}\n`;
    summary += `Beschreibung: ${description}\n`;
    summary += `Phase: ${currentPhase}\n`;
    summary += `Dauer: ${duration} Minuten\n\n`;

    summary += `### STATISTIKEN ###\n`;
    summary += `LLM-Vorschläge akzeptiert: ${statistics.llmSuggestionsAccepted}\n`;
    summary += `LLM-Vorschläge abgelehnt: ${statistics.llmSuggestionsRejected}\n\n`;

    if (patterns.length > 0) {
      summary += `### ERKANNTE MUSTER ###\n`;
      for (const pattern of patterns.slice(0, 3)) {
        summary += `- ${pattern.description} (${pattern.frequency}x)\n`;
      }
      summary += `\n`;
    }

    // Aktuelle Einsätze aus EINFO-Daten (nicht aus Disaster-Context)
    summary += buildCurrentIncidentsSummary(einfoData.board);

    // Aktuelle offene Aufgaben aus EINFO-Daten
    summary += buildCurrentTasksSummary(einfoData.aufgaben);

    // Aktuelle Protokolleinträge aus EINFO-Daten
    summary += buildCurrentProtocolSummary(einfoData.protokoll);

    summary += `### JÜNGSTE EREIGNISSE (Timeline) ###\n`;
    for (const event of recentTimeline) {
      const time = new Date(event.timestamp).toLocaleTimeString("de-DE");
      summary += `- [${time}] ${event.event}\n`;
    }
  }

  // Kürze falls zu lang
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength) + "\n... (gekürzt)";
  }

  return summary;
}

/**
 * Baut Zusammenfassung der aktuellen Einsätze (Board)
 */
function buildCurrentIncidentsSummary(board) {
  const activeIncidents = board.filter(item => {
    const status = String(item?.column || item?.status || "").toLowerCase();
    return status !== "erledigt" && status !== "done" && status !== "closed";
  });

  if (activeIncidents.length === 0) {
    return "### AKTIVE EINSÄTZE ###\nKeine aktiven Einsätze.\n\n";
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3, medium: 2 };
  const sorted = activeIncidents
    .map(item => ({
      id: item.id,
      type: item.typ || item.type || "Unbekannt",
      location: item.ort || item.location || "Unbekannt",
      content: item.content || item.desc || item.description || "",
      status: item.column || item.status || "Neu",
      priority: determinePriority(item),
      alerted: item.alerted || ""
    }))
    .sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99))
    .slice(0, 10);

  let summary = `### AKTIVE EINSÄTZE (${activeIncidents.length} gesamt) ###\n`;
  for (const incident of sorted) {
    const alertInfo = incident.alerted ? ` [Alarmiert: ${incident.alerted}]` : "";
    const contentPreview = incident.content ? `: ${incident.content.substring(0, 60)}...` : "";
    summary += `- [${incident.priority.toUpperCase()}] ${incident.type} @ ${incident.location}${contentPreview}${alertInfo}\n`;
  }
  summary += "\n";
  return summary;
}

/**
 * Baut Zusammenfassung der offenen Aufgaben
 */
function buildCurrentTasksSummary(aufgaben) {
  const openTasks = aufgaben.filter(task => {
    const status = String(task?.status || "").toLowerCase();
    return status !== "erledigt" && status !== "done" && status !== "closed" && status !== "abgeschlossen";
  });

  if (openTasks.length === 0) {
    return "### OFFENE AUFGABEN ###\nKeine offenen Aufgaben.\n\n";
  }

  // Gruppiere nach Rolle
  const byRole = {};
  for (const task of openTasks) {
    const role = task._role || task.responsible || "Unbekannt";
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(task);
  }

  let summary = `### OFFENE AUFGABEN (${openTasks.length} gesamt) ###\n`;

  for (const [role, tasks] of Object.entries(byRole)) {
    summary += `\n**${role}** (${tasks.length} Aufgaben):\n`;
    const topTasks = tasks.slice(0, 3);
    for (const task of topTasks) {
      const title = task.title || task.desc || task.description || "Unbenannte Aufgabe";
      const statusLabel = task.status ? ` [${task.status}]` : "";
      const dueInfo = task.dueAt ? ` (Frist: ${new Date(task.dueAt).toLocaleString("de-DE")})` : "";
      summary += `  - ${title.substring(0, 50)}${statusLabel}${dueInfo}\n`;
    }
    if (tasks.length > 3) {
      summary += `  - ... und ${tasks.length - 3} weitere\n`;
    }
  }
  summary += "\n";
  return summary;
}

/**
 * Baut Zusammenfassung der aktuellen Protokolleinträge
 */
function buildCurrentProtocolSummary(protokoll) {
  if (protokoll.length === 0) {
    return "### PROTOKOLL ###\nKeine Protokolleinträge.\n\n";
  }

  // Sortiere nach Datum/Zeit (neueste zuerst)
  const sorted = [...protokoll]
    .map(entry => ({
      ...entry,
      _timestamp: resolveProtocolTimestamp(entry)
    }))
    .sort((a, b) => (b._timestamp ?? 0) - (a._timestamp ?? 0));

  // Finde offene Fragen und unbeantwortete Nachrichten
  const openQuestions = sorted.filter(entry => {
    const info = String(entry.information || "").toLowerCase();
    const hasQuestion = info.includes("?");
    // Prüfe ob es eine Antwort gibt (gleiche Protokollnummer mit "ZU")
    return hasQuestion;
  });

  const recentEntries = sorted.slice(0, 10);

  let summary = `### PROTOKOLL (${protokoll.length} Einträge) ###\n`;

  // Offene Fragen zuerst
  if (openQuestions.length > 0) {
    summary += `\n**Offene Fragen/Anfragen (${openQuestions.length}):**\n`;
    for (const q of openQuestions.slice(0, 5)) {
      const timeLabel = buildProtocolTimeLabel(q);
      const sender = q.anvon || "Unbekannt";
      const info = (q.information || "").substring(0, 60);
      summary += `  - [${timeLabel}] ${sender}: ${info}...\n`;
    }
  }

  summary += `\n**Letzte Protokolleinträge:**\n`;
  for (const entry of recentEntries) {
    const timeLabel = buildProtocolTimeLabel(entry);
    const sender = entry.anvon || "";
    const recipient = Array.isArray(entry.ergehtAn) ? entry.ergehtAn.join(", ") : (entry.ergehtAn || "");
    const infoType = entry.infoTyp || "";
    const info = (entry.information || "").substring(0, 50);
    summary += `  - [${timeLabel}] ${sender}→${recipient} (${infoType}): ${info}...\n`;
  }
  summary += "\n";
  return summary;
}

/**
 * Baut Fallback-Zusammenfassung aus den geladenen EINFO-Daten
 */
function buildFallbackContextSummaryFromData(einfoData) {
  const { protokoll, aufgaben, board } = einfoData;

  if (board.length === 0 && aufgaben.length === 0 && protokoll.length === 0) {
    return "Kein aktiver Lage-Context. Keine Einsätze, Aufgaben oder Protokolleinträge vorhanden.";
  }

  let summary = `### AKTUELLER LAGEAUSZUG ###\n\n`;
  summary += `Stand: ${new Date().toLocaleString("de-DE")}\n\n`;

  // Aktuelle Einsätze
  summary += buildCurrentIncidentsSummary(board);

  // Offene Aufgaben
  summary += buildCurrentTasksSummary(aufgaben);

  // Protokoll
  summary += buildCurrentProtocolSummary(protokoll);

  return summary;
}

/**
 * Legacy-Fallback-Funktion (verwendet In-Memory-State)
 * @deprecated Verwende stattdessen buildFallbackContextSummaryFromData
 */
function buildFallbackContextSummary() {
  const state = getCurrentState();
  const incidents = Array.isArray(state?.incidents) ? state.incidents : [];
  const aufgaben = Array.isArray(state?.einfoSnapshot?.aufgaben)
    ? state.einfoSnapshot.aufgaben
    : [];
  const protokoll = Array.isArray(state?.einfoSnapshot?.protokoll)
    ? state.einfoSnapshot.protokoll
    : [];

  if (incidents.length === 0 && aufgaben.length === 0 && protokoll.length === 0) {
    return "Kein aktiver Katastrophen-Context.";
  }

  const normalized = incidents.map((incident) => ({
    id: incident.id || incident.incidentId || "unbekannt",
    type: incident.typ || incident.type || "unspecified",
    location: incident.location || incident.ort || "Unbekannt",
    status: incident.status || incident.column || "unbekannt",
    title:
      incident.title ||
      incident.description ||
      incident.content ||
      incident.desc ||
      "",
    priority: incident.priority || "unbekannt"
  }));

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const topIncidents = normalized
    .sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99))
    .slice(0, 5);

  let summary = `### AKTUELLER LAGEAUSZUG (ohne Disaster-Context) ###\n\n`;
  summary += "Hinweis: Kein aktiver Disaster Context, aber es liegen Einsätze, Aufgaben oder Protokolleinträge im Simulationszustand vor.\n\n";
  summary += `Einsatzmeldungen: ${normalized.length}\n`;
  summary += `Offene Aufgaben: ${countOpenTasks(aufgaben)}\n`;
  summary += `Protokolleinträge: ${protokoll.length}\n\n`;

  if (topIncidents.length > 0) {
    summary += "### AKTIVE EINSÄTZE (Top 5) ###\n";

    for (const incident of topIncidents) {
      const details = incident.title ? `: ${incident.title.substring(0, 80)}...` : "";
      summary += `- [${incident.priority.toUpperCase()}] ${incident.type} @ ${incident.location}${details}\n`;
    }
    summary += "\n";
  }

  const openTasks = buildOpenTasksSummary(aufgaben);
  if (openTasks.length > 0) {
    summary += "### OFFENE AUFGABEN (Top 5) ###\n";
    for (const task of openTasks) {
      const owner = task.responsible ? ` (${task.responsible})` : "";
      const prio = task.priority ? ` [${task.priority.toUpperCase()}]` : "";
      summary += `- ${task.title}${owner}${prio}\n`;
    }
    summary += "\n";
  }

  const recentProtocol = buildRecentProtocolSummary(protokoll);
  if (recentProtocol.length > 0) {
    summary += "### JÜNGSTE PROTOKOLLEINTRÄGE (Top 5) ###\n";
    for (const entry of recentProtocol) {
      const timeLabel = entry.timeLabel ? ` (${entry.timeLabel})` : "";
      const sender = entry.anvon ? ` ${entry.anvon}` : "";
      const info = entry.information ? `: ${entry.information.substring(0, 80)}...` : "";
      summary += `- ${sender}${timeLabel}${info}\n`;
    }
  }

  return summary;
}

function countOpenTasks(aufgaben) {
  return aufgaben.filter((task) => isTaskOpen(task)).length;
}

function isTaskOpen(task) {
  const status = String(task?.status || "").toLowerCase();
  const closedStatuses = ["done", "erledigt", "abgeschlossen", "closed", "resolved"];
  if (!status) return true;
  return !closedStatuses.includes(status);
}

function buildOpenTasksSummary(aufgaben) {
  const normalized = aufgaben
    .filter((task) => isTaskOpen(task))
    .map((task) => ({
      title: task.title || task.description || task.desc || "Unbenannte Aufgabe",
      responsible: task.responsible || task.assignedTo || "",
      priority: task.priority || task.prio || ""
    }));

  const priorityOrder = {
    critical: 0,
    hoch: 1,
    high: 1,
    mittel: 2,
    medium: 2,
    low: 3,
    niedrig: 3
  };
  return normalized
    .sort(
      (a, b) =>
        (priorityOrder[String(a.priority).toLowerCase()] ?? 99) -
        (priorityOrder[String(b.priority).toLowerCase()] ?? 99)
    )
    .slice(0, 5);
}

function buildRecentProtocolSummary(protokoll) {
  const normalized = protokoll.map((entry) => ({
    timestamp: resolveProtocolTimestamp(entry),
    information: entry.information || entry.info || "",
    anvon: entry.anvon || entry.von || "",
    timeLabel: buildProtocolTimeLabel(entry)
  }));

  return normalized
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 5);
}

function resolveProtocolTimestamp(entry) {
  if (typeof entry?.timestamp === "number") return entry.timestamp;
  const date = entry?.datum || entry?.date;
  const time = entry?.zeit || entry?.time;
  if (date && time) {
    const parsed = Date.parse(`${date} ${time}`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (date) {
    const parsed = Date.parse(date);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function buildProtocolTimeLabel(entry) {
  const date = entry?.datum || entry?.date;
  const time = entry?.zeit || entry?.time;
  if (date && time) return `${date} ${time}`;
  return time || date || "";
}

/**
 * Speichert den aktuellen Disaster Context
 */
async function saveDisasterContext() {
  if (!currentDisasterContext) return;

  try {
    // Erstelle Verzeichnis falls nicht vorhanden
    await fsPromises.mkdir(DISASTER_HISTORY_DIR, { recursive: true });

    const filePath = path.join(
      DISASTER_HISTORY_DIR,
      `${currentDisasterContext.disasterId}.json`
    );

    await fsPromises.writeFile(
      filePath,
      JSON.stringify(currentDisasterContext, null, 2),
      "utf8"
    );

    logDebug("Disaster Context gespeichert", {
      disasterId: currentDisasterContext.disasterId
    });
  } catch (err) {
    logError("Fehler beim Speichern des Disaster Context", { error: String(err) });
  }
}

/**
 * Lädt einen Disaster Context aus dem Archiv
 */
export async function loadDisasterContext(disasterId) {
  try {
    const filePath = path.join(DISASTER_HISTORY_DIR, `${disasterId}.json`);
    const raw = await fsPromises.readFile(filePath, "utf8");
    const context = JSON.parse(raw);

    currentDisasterContext = context;
    logInfo("Disaster Context geladen", { disasterId });

    return context;
  } catch (err) {
    logError("Fehler beim Laden des Disaster Context", {
      disasterId,
      error: String(err)
    });
    return null;
  }
}

/**
 * Listet alle gespeicherten Disaster Contexts
 */
export async function listDisasterContexts() {
  try {
    await fsPromises.mkdir(DISASTER_HISTORY_DIR, { recursive: true });
    const files = await fsPromises.readdir(DISASTER_HISTORY_DIR);

    const contexts = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(DISASTER_HISTORY_DIR, file);
        const raw = await fsPromises.readFile(filePath, "utf8");
        const context = JSON.parse(raw);

        contexts.push({
          disasterId: context.disasterId,
          type: context.type,
          description: context.description,
          startTime: context.startTime,
          currentPhase: context.currentPhase,
          statistics: context.statistics
        });
      }
    }

    return contexts.sort((a, b) => b.startTime - a.startTime);
  } catch (err) {
    logError("Fehler beim Auflisten der Disaster Contexts", { error: String(err) });
    return [];
  }
}

/**
 * Beendet den aktuellen Disaster Context
 */
export async function finalizeDisasterContext() {
  if (!currentDisasterContext) return null;

  currentDisasterContext.currentPhase = "completed";
  currentDisasterContext.endTime = Date.now();

  addToTimeline({
    event: "Katastrophe abgeschlossen",
    significance: "critical"
  });

  await saveDisasterContext();

  const finalContext = currentDisasterContext;
  currentDisasterContext = null;

  logInfo("Disaster Context abgeschlossen", {
    disasterId: finalContext.disasterId
  });

  return finalContext;
}

/**
 * Inkrementiert Simulationsschritt-Counter
 */
export function incrementSimulationStep() {
  if (currentDisasterContext) {
    currentDisasterContext.statistics.totalSimulationSteps++;
  }
}

// ============================================
// NEU: Regel-basierte Filterung + Context-Fingerprint
// ============================================

import { applyAllFilteringRules } from "./filtering_engine.js";
import { extractContextFingerprint } from "./context_fingerprint.js";
import { setLastAnalysisStatus } from "../../server/routes/admin_filtering.js";

// Cache für letzten Fingerprint
let lastContextFingerprint = null;

/**
 * Holt gefilterten Disaster Context mit Regeln und Fingerprint
 * NEUE VERSION mit Regel-basierter Filterung
 */
export async function getFilteredDisasterContextSummary({ maxLength = 2500 } = {}) {
  try {
    // Lade aktuelle EINFO-Daten
    const einfoData = await loadCurrentEinfoData();

    // Erstelle Datenobjekt für Filterung mit boardRaw (columns-Struktur)
    // Die Filterregeln und Fingerprint-Extraktion erwarten board.columns
    const dataForFiltering = {
      ...einfoData,
      board: einfoData.boardRaw || einfoData.board // Verwende boardRaw wenn vorhanden
    };

    // Wende Filterregeln an (mit Debug-Infos)
    const { filtered, rules, debug: filterDebug } = await applyAllFilteringRules(dataForFiltering, {});

    // Extrahiere Context-Fingerprint (verwendet dataForFiltering für korrekte board.columns Struktur)
    const fingerprint = extractContextFingerprint(filtered, dataForFiltering, lastContextFingerprint);

    // Speichere für nächsten Vergleich
    lastContextFingerprint = fingerprint;

    // Baue kompakten Summary
    let summary = buildFilteredSummary(filtered, fingerprint, rules);

    // Token-Zählung (grobe Schätzung: ~4 Zeichen pro Token)
    const tokensUsed = Math.ceil(summary.length / 4);
    const tokensLimit = rules.limits?.max_total_tokens || 2500;

    // NEU: Erstelle Metadaten über angewendete Regeln
    const appliedRules = {
      R1_ABSCHNITTE: {
        enabled: rules.rules.R1_ABSCHNITTE_PRIORITAET?.enabled || false,
        items_shown: filtered.abschnitte?.length || 0,
        max_items: rules.rules.R1_ABSCHNITTE_PRIORITAET?.output?.max_items || 0
      },
      R2_PROTOKOLL: {
        enabled: rules.rules.R2_PROTOKOLL_RELEVANZ?.enabled || false,
        items_shown: filtered.protocol?.length || 0,
        max_items: rules.rules.R2_PROTOKOLL_RELEVANZ?.output?.max_entries || 0
      },
      R3_TRENDS: {
        enabled: rules.rules.R3_TRENDS_ERKENNUNG?.enabled || false,
        direction: filtered.trends?.direction || "unknown",
        strength: filtered.trends?.strength || "unknown"
      },
      R4_RESSOURCEN: {
        enabled: rules.rules.R4_RESSOURCEN_STATUS?.enabled || false,
        shortage: filtered.resources?.resource_shortage || false,
        utilization: filtered.resources?.utilization || 0
      },
      R5_STABS_FOKUS: {
        enabled: rules.rules.R5_STABS_FOKUS?.enabled || false,
        individual_incidents_shown: filtered.incidents?.length || 0
      }
    };

    // Kürze falls nötig
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength) + "\n... (gekürzt)";
    }

    // NEU: Status an Admin-Panel kommunizieren (in Datei persistiert)
    await setLastAnalysisStatus({
      lastAnalysis: {
        timestamp: Date.now(),
        tokensUsed,
        tokensLimit,
        appliedRules,
        fingerprint
      }
    });

    return { summary, fingerprint, filtered, appliedRules, tokensUsed, tokensLimit, filterDebug };
  } catch (err) {
    logError("Fehler bei gefiltertem Context-Summary", {
      error: String(err)
    });

    // Fallback auf alte Methode
    const summary = await getDisasterContextSummary({ maxLength });
    return { summary, fingerprint: null, filtered: null, appliedRules: null, filterDebug: null };
  }
}

/**
 * Baut Summary aus gefilterten Daten
 */
function buildFilteredSummary(filtered, fingerprint, rules) {
  let summary = `### KATASTROPHEN-ÜBERSICHT ###\n\n`;
  summary += `Typ: ${fingerprint.disaster_type}\n`;
  summary += `Phase: ${fingerprint.phase}\n`;
  summary += `Dauer: ${Math.floor(fingerprint.hours_running * 60)} Minuten\n`;
  summary += `Trend: ${fingerprint.trend_direction} (${fingerprint.trend_strength})\n\n`;

  // Abschnitte (aus R1)
  if (filtered.abschnitte && filtered.abschnitte.length > 0) {
    summary += `### ABSCHNITTE (${fingerprint.total_sections} gesamt, ${fingerprint.critical_sections} kritisch) ###\n`;
    for (const abschnitt of filtered.abschnitte) {
      summary += `- [${abschnitt.priority.toUpperCase()}] ${abschnitt.name}`;
      summary += ` - ${abschnitt.total_incidents} Einsätze (${abschnitt.critical_incidents} kritisch)`;
      summary += `, ${abschnitt.total_personnel} Kräfte\n`;
    }
    summary += `\n`;
  }

  // Ressourcen (aus R4)
  if (filtered.resources) {
    const res = filtered.resources;
    summary += `### RESSOURCEN-STATUS ###\n`;
    summary += `Einheiten: ${res.available_units} verfügbar / ${res.total_units} gesamt (${res.utilization}% ausgelastet)\n`;
    if (res.resource_shortage) {
      summary += `⚠️ RESSOURCEN-ENGPASS (>80% Auslastung)\n`;
    }
    summary += `Personal: ${res.total_personnel} im Einsatz\n\n`;
  }

  // Protokoll (aus R2)
  if (filtered.protocol && filtered.protocol.length > 0) {
    summary += `### WICHTIGE PROTOKOLL-EINTRÄGE (${fingerprint.protocol_entries_total} gesamt) ###\n`;
    for (const entry of filtered.protocol.slice(0, 10)) {
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' }) : "";
      const content = String(entry.content || entry.text || "").substring(0, 100);
      summary += `- [${time}] ${content}\n`;
    }
    summary += `\n`;
  }

  // Trends (aus R3)
  if (filtered.trends && Object.keys(filtered.trends).length > 0) {
    summary += `### TRENDS & PROGNOSE ###\n`;
    summary += `Neue Einsätze (letzte Stunde): ${fingerprint.new_incidents_last_hour}\n`;
    summary += `Trend: ${fingerprint.trend_direction} (${fingerprint.trend_strength})\n`;
    summary += `Prognose nächste 2h: ${fingerprint.forecast_2h_incidents} neue Einsätze\n\n`;
  }

  // Geografische Verteilung
  if (fingerprint.geographic_pattern && fingerprint.geographic_pattern !== "unknown") {
    summary += `### GEOGRAFISCHE VERTEILUNG ###\n`;
    summary += `Muster: ${fingerprint.geographic_pattern}\n`;
    if (fingerprint.hotspot_locations && fingerprint.hotspot_locations.length > 0) {
      summary += `Hotspots: ${fingerprint.hotspot_locations.join(", ")}\n`;
    }
    summary += `\n`;
  }

  return summary;
}

/**
 * Gibt letzten Context-Fingerprint zurück
 */
export function getLastContextFingerprint() {
  return lastContextFingerprint;
}

// ============================================
// NEU: LLM-basierte Zusammenfassung
// ============================================

// Lade Templates für LLM-Summarization
let summarizationSystemTemplate = null;
let summarizationUserTemplate = null;

function loadSummarizationTemplates() {
  if (!summarizationSystemTemplate) {
    try {
      summarizationSystemTemplate = loadPromptTemplate("summarization_system.txt");
      summarizationUserTemplate = loadPromptTemplate("summarization_user.txt");
    } catch (err) {
      logError("Fehler beim Laden der Summarization-Templates", { error: String(err) });
      return false;
    }
  }
  return true;
}

/**
 * Erstellt eine LLM-basierte Zusammenfassung der aktuellen Lage
 * Alternative zur regelbasierten Filterung
 *
 * @param {Object} options - Optionen
 * @param {number} options.maxLength - Maximale Länge der Zusammenfassung
 * @returns {Object} - { summary, llmUsed, duration, model }
 */
export async function getLLMSummarizedContext({ maxLength = 2000 } = {}) {
  const startTime = Date.now();

  try {
    // Templates laden
    if (!loadSummarizationTemplates()) {
      throw new Error("Summarization-Templates konnten nicht geladen werden");
    }

    // Aktuelle EINFO-Daten laden
    const einfoData = await loadCurrentEinfoData();

    // Daten für Prompt aufbereiten
    const boardData = formatBoardForPrompt(einfoData.board);
    const protocolData = formatProtocolForPrompt(einfoData.protokoll);
    const tasksData = formatTasksForPrompt(einfoData.aufgaben);

    // Statistiken berechnen
    const activeIncidents = einfoData.board.filter(item => {
      const status = String(item?.column || "").toLowerCase();
      return status !== "erledigt";
    }).length;

    const criticalIncidents = einfoData.board.filter(item => {
      const content = String(item?.content || "").toLowerCase();
      return content.includes("verletzt") || content.includes("eingeschlossen") ||
             content.includes("evakuierung") || content.includes("kritisch");
    }).length;

    const totalPersonnel = einfoData.board.reduce((sum, item) => {
      return sum + (item.personnel || item.alerted?.split(",").length || 0);
    }, 0);

    const openTasks = einfoData.aufgaben.filter(task => {
      const status = String(task?.status || "").toLowerCase();
      return status !== "erledigt" && status !== "done";
    }).length;

    // Prompts erstellen
    const systemPrompt = summarizationSystemTemplate;
    const userPrompt = fillTemplate(summarizationUserTemplate, {
      boardData,
      protocolData,
      tasksData,
      activeIncidents: String(activeIncidents),
      criticalIncidents: String(criticalIncidents),
      totalPersonnel: String(totalPersonnel),
      protocolCount: String(einfoData.protokoll.length),
      openTasks: String(openTasks)
    });

    // LLM aufrufen (dynamischer Import um zirkuläre Abhängigkeit zu vermeiden)
    const { callLLMForChat } = await import("./llm_client.js");

    const llmResponse = await callLLMForChat(systemPrompt, userPrompt, {
      taskType: "summarization"
    });

    const duration = Date.now() - startTime;

    // Prüfe Antwort
    if (!llmResponse || typeof llmResponse !== "string" || !llmResponse.trim()) {
      throw new Error("LLM gab leere Antwort bei Summarization");
    }

    let summary = llmResponse.trim();

    // Kürze falls nötig
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength) + "\n... (gekürzt)";
    }

    logInfo("LLM-Summarization erfolgreich", {
      duration,
      summaryLength: summary.length,
      inputDataSize: {
        board: einfoData.board.length,
        protokoll: einfoData.protokoll.length,
        aufgaben: einfoData.aufgaben.length
      }
    });

    return {
      summary,
      llmUsed: true,
      duration,
      model: "summarization",
      fingerprint: null // LLM-Modus hat keinen Fingerprint
    };

  } catch (err) {
    const duration = Date.now() - startTime;
    logError("Fehler bei LLM-Summarization, Fallback auf Regelbasiert", {
      error: String(err),
      duration
    });

    // Fallback auf regelbasierte Filterung
    const { summary, fingerprint } = await getFilteredDisasterContextSummary({ maxLength });
    return {
      summary,
      llmUsed: false,
      duration,
      model: "rules-fallback",
      fingerprint,
      fallbackReason: String(err)
    };
  }
}

/**
 * Formatiert Board-Daten für den Prompt
 */
function formatBoardForPrompt(board) {
  if (!board || board.length === 0) {
    return "(Keine aktiven Einsätze)";
  }

  const lines = [];
  const sorted = [...board].sort((a, b) => {
    // Sortiere: neu > in-bearbeitung > erledigt
    const order = { "neu": 0, "in-bearbeitung": 1, "erledigt": 2 };
    return (order[a.column] ?? 1) - (order[b.column] ?? 1);
  });

  for (const item of sorted.slice(0, 20)) { // Max 20 Einträge
    const status = item.column || "unbekannt";
    const typ = item.typ || item.type || "Einsatz";
    const ort = item.ort || item.location || "Unbekannt";
    const content = (item.content || item.description || "").substring(0, 80);
    const alerted = item.alerted ? ` [Alarmiert: ${item.alerted}]` : "";

    lines.push(`- [${status.toUpperCase()}] ${typ} @ ${ort}: ${content}${alerted}`);
  }

  if (board.length > 20) {
    lines.push(`... und ${board.length - 20} weitere Einsätze`);
  }

  return lines.join("\n");
}

/**
 * Formatiert Protokoll-Daten für den Prompt
 */
function formatProtocolForPrompt(protokoll) {
  if (!protokoll || protokoll.length === 0) {
    return "(Keine Protokolleinträge)";
  }

  const lines = [];
  const sorted = [...protokoll].sort((a, b) => {
    const tsA = resolveProtocolTimestamp(a) || 0;
    const tsB = resolveProtocolTimestamp(b) || 0;
    return tsB - tsA; // Neueste zuerst
  });

  for (const entry of sorted.slice(0, 15)) { // Max 15 Einträge
    const time = entry.zeit || entry.time || "";
    const date = entry.datum || entry.date || "";
    const von = entry.anvon || entry.von || "Unbekannt";
    const an = Array.isArray(entry.ergehtAn) ? entry.ergehtAn.join(", ") : (entry.ergehtAn || "");
    const typ = entry.infoTyp || entry.type || "";
    const info = (entry.information || entry.info || "").substring(0, 100);

    lines.push(`- [${date} ${time}] ${von} → ${an} (${typ}): ${info}`);
  }

  if (protokoll.length > 15) {
    lines.push(`... und ${protokoll.length - 15} weitere Einträge`);
  }

  return lines.join("\n");
}

/**
 * Formatiert Aufgaben-Daten für den Prompt
 */
function formatTasksForPrompt(aufgaben) {
  if (!aufgaben || aufgaben.length === 0) {
    return "(Keine offenen Aufgaben)";
  }

  // Nur offene Aufgaben
  const openTasks = aufgaben.filter(task => {
    const status = String(task?.status || "").toLowerCase();
    return status !== "erledigt" && status !== "done" && status !== "abgeschlossen";
  });

  if (openTasks.length === 0) {
    return "(Keine offenen Aufgaben)";
  }

  const lines = [];

  // Gruppiere nach Rolle
  const byRole = {};
  for (const task of openTasks) {
    const role = task._role || task.responsible || "Unbekannt";
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(task);
  }

  for (const [role, tasks] of Object.entries(byRole)) {
    lines.push(`**${role}:**`);
    for (const task of tasks.slice(0, 5)) {
      const title = (task.title || task.desc || task.description || "Unbenannt").substring(0, 60);
      const status = task.status ? ` [${task.status}]` : "";
      lines.push(`  - ${title}${status}`);
    }
    if (tasks.length > 5) {
      lines.push(`  ... und ${tasks.length - 5} weitere`);
    }
  }

  return lines.join("\n");
}
