// chatbot/server/audit_trail.js
// Strukturierter Audit-Trail für Übungs-Nachbesprechungen

import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { logDebug, logError } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIT_DIR = path.join(__dirname, "../logs/audit");

let currentExerciseId = null;
let events = [];
let exerciseMetadata = null;
let statistics = {
  simSteps: 0,
  llmCalls: 0,
  totalLlmDurationMs: 0,
  userActions: 0,
  protocolsCreated: 0,
  tasksCreated: 0,
  incidentsCreated: 0
};

// Callback für SSE-Broadcasts (wird von index.js gesetzt)
let onStatisticsChange = null;

/**
 * Registriert einen Callback für Statistik-Änderungen
 */
export function setStatisticsChangeCallback(callback) {
  onStatisticsChange = callback;
}

/**
 * Benachrichtigt über Statistik-Änderungen
 */
function notifyStatisticsChange() {
  if (onStatisticsChange && currentExerciseId) {
    onStatisticsChange(statistics);
  }
}

/**
 * Event-Kategorien:
 * - exercise: Start/Stop/Pause der Übung
 * - simulation: Simulationsschritte
 * - llm: LLM-Aufrufe und Antworten
 * - user: Benutzeraktionen
 * - injection: Automatische Ereignis-Einspielungen
 * - decision: Wichtige Entscheidungen
 */

/**
 * Startet einen neuen Audit-Trail
 */
export async function startAuditTrail(options = {}) {
  const { exerciseName, templateId, mode, participants = [] } = options;
  
  currentExerciseId = `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  events = [];
  statistics = {
    simSteps: 0,
    llmCalls: 0,
    totalLlmDurationMs: 0,
    userActions: 0,
    protocolsCreated: 0,
    tasksCreated: 0,
    incidentsCreated: 0
  };
  
  exerciseMetadata = {
    exerciseId: currentExerciseId,
    exerciseName: exerciseName || "Unbenannte Übung",
    templateId,
    mode,
    participants,
    startedAt: new Date().toISOString(),
    endedAt: null
  };
  
  // Audit-Verzeichnis erstellen
  try {
    await fsPromises.mkdir(AUDIT_DIR, { recursive: true });
  } catch {
    // Ignorieren wenn existiert
  }
  
  logEvent("exercise", "start", { mode, templateId });
  logDebug("Audit-Trail gestartet", { exerciseId: currentExerciseId });
  
  return currentExerciseId;
}

/**
 * Protokolliert ein Event
 */
export function logEvent(category, action, data = {}) {
  if (!currentExerciseId) {
    // Kein aktiver Trail - still ignorieren oder auto-starten
    return;
  }
  
  const event = {
    timestamp: new Date().toISOString(),
    category,
    action,
    data
  };
  
  events.push(event);
  
  // Statistiken aktualisieren
  let statsChanged = false;

  if (category === "simulation" && action === "step_complete") {
    statistics.simSteps++;
    statsChanged = true;
  }
  if (category === "llm") {
    statistics.llmCalls++;
    if (data.durationMs) {
      statistics.totalLlmDurationMs += data.durationMs;
    }
    statsChanged = true;
  }
  if (category === "user") {
    statistics.userActions++;
    statsChanged = true;
  }
  if (data.protocolsCreated) {
    statistics.protocolsCreated += data.protocolsCreated;
    statsChanged = true;
  }
  if (data.tasksCreated) {
    statistics.tasksCreated += data.tasksCreated;
    statsChanged = true;
  }
  if (data.incidentsCreated) {
    statistics.incidentsCreated += data.incidentsCreated;
    statsChanged = true;
  }

  // SSE-Broadcast bei Statistik-Änderungen
  if (statsChanged) {
    notifyStatisticsChange();
  }

  return event;
}

/**
 * Beendet und speichert den Audit-Trail
 */
export async function endAuditTrail() {
  if (!currentExerciseId) return null;
  
  exerciseMetadata.endedAt = new Date().toISOString();
  logEvent("exercise", "end", {});
  
  // Durchschnittliche LLM-Dauer berechnen
  const avgLlmDurationMs = statistics.llmCalls > 0 
    ? Math.round(statistics.totalLlmDurationMs / statistics.llmCalls)
    : 0;
  
  const auditData = {
    metadata: exerciseMetadata,
    statistics: {
      ...statistics,
      avgLlmDurationMs
    },
    events
  };
  
  // Speichern
  const filePath = path.join(AUDIT_DIR, `${currentExerciseId}.json`);
  try {
    await fsPromises.writeFile(
      filePath, 
      JSON.stringify(auditData, null, 2), 
      "utf8"
    );
    logDebug("Audit-Trail gespeichert", { filePath, eventCount: events.length });
  } catch (err) {
    logError("Audit-Trail speichern fehlgeschlagen", { error: String(err) });
  }
  
  const result = { ...auditData, filePath };
  
  // Reset
  currentExerciseId = null;
  events = [];
  exerciseMetadata = null;
  
  return result;
}

/**
 * Lädt einen gespeicherten Audit-Trail
 */
export async function loadAuditTrail(exerciseId) {
  const filePath = path.join(AUDIT_DIR, `${exerciseId}.json`);
  try {
    const content = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    logError("Audit-Trail laden fehlgeschlagen", { exerciseId, error: String(err) });
    return null;
  }
}

/**
 * Listet alle verfügbaren Audit-Trails
 */
export async function listAuditTrails() {
  try {
    await fsPromises.mkdir(AUDIT_DIR, { recursive: true });
    const files = await fsPromises.readdir(AUDIT_DIR);
    const trails = [];
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fsPromises.readFile(
          path.join(AUDIT_DIR, file), 
          "utf8"
        );
        const data = JSON.parse(content);
        trails.push({
          exerciseId: data.metadata?.exerciseId || file.replace(".json", ""),
          exerciseName: data.metadata?.exerciseName || "Unbekannt",
          startedAt: data.metadata?.startedAt,
          endedAt: data.metadata?.endedAt,
          eventCount: data.events?.length || 0
        });
      } catch {
        // Beschädigte Datei ignorieren
      }
    }
    
    return trails.sort((a, b) => 
      new Date(b.startedAt || 0) - new Date(a.startedAt || 0)
    );
  } catch {
    return [];
  }
}
// Am Ende von audit_trail.js hinzufügen (vor dem letzten Export):

let isPaused = false;

/**
 * Pausiert die aktuelle Übung
 */
export function pauseExercise() {
  if (!currentExerciseId) return false;
  isPaused = true;
  logEvent("exercise", "pause", { timestamp: Date.now() });
  return true;
}

/**
 * Setzt die pausierte Übung fort
 */
export function resumeExercise() {
  if (!currentExerciseId || !isPaused) return false;
  isPaused = false;
  logEvent("exercise", "resume", { timestamp: Date.now() });
  return true;
}

/**
 * Filtert Events der aktuellen Übung
 */
export function getFilteredEvents({ category, since, limit } = {}) {
  let filtered = [...events];
  
  if (category) {
    filtered = filtered.filter(e => e.category === category);
  }
  
  if (since) {
    const sinceDate = new Date(since);
    filtered = filtered.filter(e => new Date(e.timestamp) > sinceDate);
  }
  
  if (limit && limit > 0) {
    filtered = filtered.slice(-limit);
  }
  
  return filtered;
}

/**
 * Löscht einen gespeicherten Audit-Trail
 */
export async function deleteAuditTrail(exerciseId) {
  const filePath = path.join(AUDIT_DIR, `${exerciseId}.json`);
  
  try {
    await fsPromises.unlink(filePath);
    logDebug("Audit-Trail gelöscht", { exerciseId });
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    logError("Audit-Trail löschen fehlgeschlagen", { exerciseId, error: String(err) });
    return false;
  }
}


/**
 * Gibt aktuellen Status zurück
 */
export function getAuditStatus() {
  return {
    active: !!currentExerciseId,
    exerciseId: currentExerciseId,
    metadata: exerciseMetadata,
    statistics,
    eventCount: events.length
  };
}
