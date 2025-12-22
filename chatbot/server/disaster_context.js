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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pfad für Disaster History
const DISASTER_HISTORY_DIR = path.resolve(__dirname, "../../server/data/disaster_history");

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
 * Gibt den aktuellen Disaster Context zurück
 */
export function getCurrentDisasterContext() {
  return currentDisasterContext;
}

/**
 * Erstellt einen komprimierten Context-String für LLM-Prompts
 */
export function getDisasterContextSummary({ maxLength = 1500 } = {}) {
  if (!currentDisasterContext) {
    return "Kein aktiver Katastrophen-Context.";
  }

  const {
    type,
    description,
    startTime,
    currentPhase,
    activeIncidents,
    statistics,
    timeline,
    patterns
  } = currentDisasterContext;

  const duration = Math.floor((Date.now() - startTime) / 60000); // Minuten
  const recentTimeline = timeline.slice(-10); // Letzte 10 Events

  let summary = `### AKTUELLER KATASTROPHEN-CONTEXT ###\n\n`;
  summary += `Typ: ${type}\n`;
  summary += `Beschreibung: ${description}\n`;
  summary += `Phase: ${currentPhase}\n`;
  summary += `Dauer: ${duration} Minuten\n\n`;

  summary += `### STATISTIKEN ###\n`;
  summary += `Aktive Einsätze: ${statistics.activeIncidents}\n`;
  summary += `Gesamt (abgeschlossen): ${statistics.resolvedIncidents}\n`;
  summary += `LLM-Vorschläge akzeptiert: ${statistics.llmSuggestionsAccepted}\n`;
  summary += `LLM-Vorschläge abgelehnt: ${statistics.llmSuggestionsRejected}\n\n`;

  if (patterns.length > 0) {
    summary += `### ERKANNTE MUSTER ###\n`;
    for (const pattern of patterns.slice(0, 3)) {
      summary += `- ${pattern.description} (${pattern.frequency}x)\n`;
    }
    summary += `\n`;
  }

  summary += `### AKTIVE EINSÄTZE (Top 5) ###\n`;
  const topIncidents = activeIncidents
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, 5);

  for (const incident of topIncidents) {
    summary += `- [${incident.priority.toUpperCase()}] ${incident.type} @ ${incident.location}: ${incident.content.substring(0, 80)}...\n`;
  }
  summary += `\n`;

  summary += `### JÜNGSTE EREIGNISSE ###\n`;
  for (const event of recentTimeline) {
    const time = new Date(event.timestamp).toLocaleTimeString("de-DE");
    summary += `- [${time}] ${event.event}\n`;
  }

  // Kürze falls zu lang
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength) + "\n... (gekürzt)";
  }

  return summary;
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
