// chatbot/server/event_indexer.js
// Automatische Indizierung von Einsatzdaten in RAG-Systeme
// Verbindet State-Änderungen mit Memory-Manager und Session-RAG

import { addMemory } from "./memory_manager.js";
import { getCurrentSession } from "./rag/session_rag.js";
import { logDebug, logInfo, logError } from "./logger.js";

/**
 * Event-Typen die indiziert werden
 */
export const EventTypes = {
  // Incidents
  INCIDENT_CREATED: "incident:created",
  INCIDENT_UPDATED: "incident:updated",
  INCIDENT_CLOSED: "incident:closed",

  // Meldungen
  MESSAGE_RECEIVED: "message:received",
  MESSAGE_SENT: "message:sent",

  // Aufgaben
  TASK_CREATED: "task:created",
  TASK_COMPLETED: "task:completed",

  // Protokoll
  PROTOCOL_ENTRY: "protocol:entry",

  // Feedback
  FEEDBACK_POSITIVE: "feedback:positive",
  FEEDBACK_NEGATIVE: "feedback:negative",

  // Session
  SESSION_START: "session:start",
  SESSION_END: "session:end"
};

/**
 * EventIndexer Klasse
 * Zentrale Stelle für Event-basierte Indizierung
 */
class EventIndexer {
  constructor() {
    this.handlers = new Map();
    this.enabled = true;
    this.stats = {
      eventsProcessed: 0,
      memoryAdded: 0,
      sessionAdded: 0,
      errors: 0
    };

    // Standard-Handler registrieren
    this.registerDefaultHandlers();
  }

  /**
   * Registriert Standard-Event-Handler
   */
  registerDefaultHandlers() {
    // Incident erstellt
    this.on(EventTypes.INCIDENT_CREATED, async (data) => {
      const text = this.formatIncidentText(data, "erstellt");
      await this.indexToAll(`incident_${data.id}`, text, {
        type: "incident",
        action: "created",
        incidentId: data.id,
        priority: data.priority || "normal"
      });
    });

    // Incident aktualisiert
    this.on(EventTypes.INCIDENT_UPDATED, async (data) => {
      const text = this.formatIncidentText(data, "aktualisiert");
      await this.indexToSession(`incident_${data.id}`, text, {
        type: "incident",
        action: "updated",
        incidentId: data.id
      });
    });

    // Incident geschlossen
    this.on(EventTypes.INCIDENT_CLOSED, async (data) => {
      const text = this.formatIncidentText(data, "abgeschlossen");
      await this.indexToAll(`incident_${data.id}_closed`, text, {
        type: "incident",
        action: "closed",
        incidentId: data.id
      });
    });

    // Meldung empfangen
    this.on(EventTypes.MESSAGE_RECEIVED, async (data) => {
      const text = this.formatMessageText(data, "eingehend");
      await this.indexToAll(`msg_in_${Date.now()}`, text, {
        type: "message",
        direction: "incoming",
        from: data.from,
        to: data.to
      });
    });

    // Meldung gesendet
    this.on(EventTypes.MESSAGE_SENT, async (data) => {
      const text = this.formatMessageText(data, "ausgehend");
      await this.indexToSession(`msg_out_${Date.now()}`, text, {
        type: "message",
        direction: "outgoing",
        from: data.from,
        to: data.to
      });
    });

    // Aufgabe erstellt
    this.on(EventTypes.TASK_CREATED, async (data) => {
      const text = this.formatTaskText(data, "erstellt");
      await this.indexToSession(`task_${data.id}`, text, {
        type: "task",
        action: "created",
        taskId: data.id,
        assignedTo: data.assignedTo
      });
    });

    // Aufgabe abgeschlossen
    this.on(EventTypes.TASK_COMPLETED, async (data) => {
      const text = this.formatTaskText(data, "abgeschlossen");
      await this.indexToAll(`task_${data.id}_done`, text, {
        type: "task",
        action: "completed",
        taskId: data.id
      });
    });

    // Protokolleintrag
    this.on(EventTypes.PROTOCOL_ENTRY, async (data) => {
      const text = this.formatProtocolText(data);
      await this.indexToSession(`protocol_${data.nr || Date.now()}`, text, {
        type: "protocol",
        nr: data.nr,
        direction: data.richtung
      });
    });

    // Session Start
    this.on(EventTypes.SESSION_START, async (data) => {
      logInfo("EventIndexer: Neue Session gestartet", {
        scenarioId: data.scenarioId
      });
    });

    // Session Ende
    this.on(EventTypes.SESSION_END, async (data) => {
      logInfo("EventIndexer: Session beendet", {
        scenarioId: data.scenarioId,
        stats: this.stats
      });
    });
  }

  /**
   * Formatiert Incident-Text für Indizierung
   */
  formatIncidentText(incident, action) {
    const parts = [`Einsatz ${incident.id || "neu"} ${action}`];

    if (incident.title) parts.push(`- ${incident.title}`);
    if (incident.description) parts.push(`- ${incident.description}`);
    if (incident.location) parts.push(`@ ${incident.location}`);
    if (incident.status) parts.push(`[Status: ${incident.status}]`);
    if (incident.priority) parts.push(`[Priorität: ${incident.priority}]`);

    return parts.join(" ");
  }

  /**
   * Formatiert Meldungs-Text für Indizierung
   */
  formatMessageText(message, direction) {
    const timestamp = message.timestamp || new Date().toISOString();
    const from = message.from || message.anvon || "Unbekannt";
    const to = message.to || message.ergehtAn || "";
    const text = message.text || message.inhalt || "";

    return `[${timestamp}] ${direction} von ${from}${to ? ` an ${to}` : ""}: ${text}`;
  }

  /**
   * Formatiert Aufgaben-Text für Indizierung
   */
  formatTaskText(task, action) {
    const parts = [`Aufgabe ${action}`];

    if (task.title || task.beschreibung) {
      parts.push(`- ${task.title || task.beschreibung}`);
    }
    if (task.assignedTo || task.zustaendig) {
      parts.push(`[Zuständig: ${task.assignedTo || task.zustaendig}]`);
    }
    if (task.deadline || task.frist) {
      parts.push(`[Frist: ${task.deadline || task.frist}]`);
    }

    return parts.join(" ");
  }

  /**
   * Formatiert Protokoll-Text für Indizierung
   */
  formatProtocolText(entry) {
    const parts = [];

    if (entry.zeit) parts.push(`[${entry.zeit}]`);
    if (entry.nr) parts.push(`Nr.${entry.nr}`);
    if (entry.anvon) parts.push(`Von: ${entry.anvon}`);
    if (entry.ergehtAn) {
      const recipients = Array.isArray(entry.ergehtAn)
        ? entry.ergehtAn.join(", ")
        : entry.ergehtAn;
      parts.push(`An: ${recipients}`);
    }
    if (entry.inhalt) parts.push(entry.inhalt);
    if (entry.richtung) parts.push(`[${entry.richtung}]`);

    return parts.join(" ");
  }

  /**
   * Indiziert in alle RAG-Systeme (Memory + Session)
   */
  async indexToAll(id, text, meta = {}) {
    await Promise.all([
      this.indexToMemory(text, meta),
      this.indexToSession(id, text, meta)
    ]);
  }

  /**
   * Indiziert nur in Memory-Manager (langfristig)
   */
  async indexToMemory(text, meta = {}) {
    if (!this.enabled) return;

    try {
      await addMemory({
        text,
        meta: {
          ...meta,
          ts: new Date().toISOString()
        }
      });
      this.stats.memoryAdded++;
    } catch (error) {
      this.stats.errors++;
      logError("EventIndexer: Memory-Fehler", { error: String(error) });
    }
  }

  /**
   * Indiziert nur in Session-RAG (kurzfristig)
   */
  async indexToSession(id, text, meta = {}) {
    if (!this.enabled) return;

    try {
      const session = getCurrentSession();
      await session.add(id, text, meta);
      this.stats.sessionAdded++;
    } catch (error) {
      this.stats.errors++;
      logError("EventIndexer: Session-Fehler", { error: String(error) });
    }
  }

  /**
   * Registriert einen Event-Handler
   */
  on(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handler);
  }

  /**
   * Entfernt einen Event-Handler
   */
  off(eventType, handler) {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Löst ein Event aus
   */
  async emit(eventType, data) {
    if (!this.enabled) {
      logDebug("EventIndexer: Deaktiviert, Event ignoriert", { eventType });
      return;
    }

    const handlers = this.handlers.get(eventType) || [];

    logDebug("EventIndexer: Event", {
      type: eventType,
      handlers: handlers.length
    });

    for (const handler of handlers) {
      try {
        await handler(data);
        this.stats.eventsProcessed++;
      } catch (error) {
        this.stats.errors++;
        logError("EventIndexer: Handler-Fehler", {
          eventType,
          error: String(error)
        });
      }
    }
  }

  /**
   * Aktiviert/Deaktiviert die Indizierung
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    logInfo("EventIndexer: Status", { enabled });
  }

  /**
   * Gibt Statistiken zurück
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Setzt Statistiken zurück
   */
  resetStats() {
    this.stats = {
      eventsProcessed: 0,
      memoryAdded: 0,
      sessionAdded: 0,
      errors: 0
    };
  }
}

// ============================================================
// Singleton-Instanz
// ============================================================

export const eventIndexer = new EventIndexer();

// ============================================================
// Convenience-Funktionen für direkte Verwendung
// ============================================================

/**
 * Indiziert einen neuen Incident
 */
export async function indexIncident(incident, action = "created") {
  const eventType = action === "created"
    ? EventTypes.INCIDENT_CREATED
    : action === "closed"
      ? EventTypes.INCIDENT_CLOSED
      : EventTypes.INCIDENT_UPDATED;

  await eventIndexer.emit(eventType, incident);
}

/**
 * Indiziert eine neue Meldung
 */
export async function indexMessage(message, direction = "received") {
  const eventType = direction === "received"
    ? EventTypes.MESSAGE_RECEIVED
    : EventTypes.MESSAGE_SENT;

  await eventIndexer.emit(eventType, message);
}

/**
 * Indiziert eine neue Aufgabe
 */
export async function indexTask(task, action = "created") {
  const eventType = action === "created"
    ? EventTypes.TASK_CREATED
    : EventTypes.TASK_COMPLETED;

  await eventIndexer.emit(eventType, task);
}

/**
 * Indiziert einen Protokolleintrag
 */
export async function indexProtocolEntry(entry) {
  await eventIndexer.emit(EventTypes.PROTOCOL_ENTRY, entry);
}

/**
 * Startet eine neue Indizierungs-Session
 */
export async function startIndexingSession(scenarioId) {
  await eventIndexer.emit(EventTypes.SESSION_START, { scenarioId });
}

/**
 * Beendet die aktuelle Indizierungs-Session
 */
export async function endIndexingSession(scenarioId) {
  await eventIndexer.emit(EventTypes.SESSION_END, { scenarioId });
}

export default eventIndexer;
