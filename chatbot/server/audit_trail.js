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
  if (category === "simulation" && action === "step_complete") {
    statistics.simSteps++;
  }
  if (category === "llm") {
    statistics.llmCalls++;
    if (data.durationMs) {
      statistics.totalLlmDurationMs += data.durationMs;
    }
  }
  if (category === "user") {
    statistics.userActions++;
  }
  if (data.protocolsCreated) {
    statistics.protocolsCreated += data.protocolsCreated;
  }
  if (data.tasksCreated) {
    statistics.tasksCreated += data.tasksCreated;
  }
  if (data.incidentsCreated) {
    statistics.incidentsCreated += data.incidentsCreated;
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
