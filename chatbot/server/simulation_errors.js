// chatbot/server/simulation_errors.js
// Error Handling für Simulation

import { logError, logInfo, logDebug } from "./logger.js";

/**
 * Basis-Fehlerklasse für Simulation
 */
export class SimulationError extends Error {
  constructor(message, { severity = 'error', recoverable = false, context = {} } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.severity = severity; // 'critical' | 'error' | 'warning'
    this.recoverable = recoverable;
    this.context = context;
    this.timestamp = Date.now();
  }
}

/**
 * Fehler bei LLM-Aufruf
 */
export class LLMCallError extends SimulationError {
  constructor(message, context = {}) {
    super(message, { severity: 'critical', recoverable: false, context });
  }
}

/**
 * Fehler bei Datei-Operationen
 */
export class FileOperationError extends SimulationError {
  constructor(message, context = {}) {
    super(message, { severity: 'error', recoverable: true, context });
  }
}

/**
 * Fehler bei Disaster Context Update
 */
export class DisasterContextError extends SimulationError {
  constructor(message, context = {}) {
    super(message, { severity: 'warning', recoverable: true, context });
  }
}

/**
 * Fehler bei RAG-Indizierung
 */
export class RAGIndexingError extends SimulationError {
  constructor(message, context = {}) {
    super(message, { severity: 'warning', recoverable: true, context });
  }
}

/**
 * Validierungsfehler
 */
export class ValidationError extends SimulationError {
  constructor(message, context = {}) {
    super(message, { severity: 'error', recoverable: false, context });
  }
}

/**
 * Datei nicht gefunden
 */
export class FileNotFoundError extends SimulationError {
  constructor(message, context = {}) {
    super(message, { severity: 'error', recoverable: false, context });
  }
}

/**
 * Error Handler Registry
 */
const errorHandlers = {
  DisasterContextError: {
    handler: (err, context) => {
      logInfo("Disaster Context konnte nicht aktualisiert werden", {
        error: err.message,
        context: err.context
      });
      return { continueSimulation: true, useStaleData: true };
    }
  },

  LLMCallError: {
    handler: (err, context) => {
      logError("LLM-Aufruf fehlgeschlagen - Simulation abgebrochen", {
        error: err.message,
        context: err.context
      });
      return { continueSimulation: false, reason: 'llm_unavailable' };
    }
  },

  RAGIndexingError: {
    handler: (err, context) => {
      logInfo("RAG-Indizierung fehlgeschlagen - Daten nicht durchsuchbar", {
        error: err.message,
        context: err.context
      });
      return { continueSimulation: true, reducedFunctionality: ['search'] };
    }
  },

  FileOperationError: {
    handler: (err, context) => {
      logError("Datei-Operation fehlgeschlagen", {
        error: err.message,
        context: err.context
      });
      return { continueSimulation: false, reason: 'file_operation_failed' };
    }
  },

  ValidationError: {
    handler: (err, context) => {
      logError("Validierung fehlgeschlagen", {
        error: err.message,
        context: err.context,
        errors: err.context.errors
      });
      return { continueSimulation: false, reason: 'validation_failed' };
    }
  },

  FileNotFoundError: {
    handler: (err, context) => {
      logError("Datei nicht gefunden", {
        error: err.message,
        context: err.context
      });
      return { continueSimulation: false, reason: 'file_not_found' };
    }
  },

  UnknownError: {
    handler: (err, context) => {
      logError("Unbekannter Fehler", {
        error: err.message || String(err),
        stack: err.stack,
        context
      });
      return { continueSimulation: false, reason: 'unknown_error' };
    }
  }
};

/**
 * Zentraler Error Handler für Simulation
 * @param {Error} error - Der Fehler
 * @param {Object} context - Zusätzlicher Kontext
 * @returns {Object} - Decision object
 */
export function handleSimulationError(error, context = {}) {
  const errorType = error.name || 'UnknownError';
  const handler = errorHandlers[errorType] || errorHandlers.UnknownError;

  const decision = handler.handler(error, context);

  logDebug("Simulation Error behandelt", {
    errorType,
    severity: error.severity || 'unknown',
    recoverable: error.recoverable || false,
    decision
  });

  return decision;
}

/**
 * Wrapper für sichere Ausführung mit Error Handling
 * @param {Function} fn - Auszuführende Funktion
 * @param {Object} options - Optionen
 * @returns {Promise<Object>} - { ok, result?, error? }
 */
export async function safeExecute(fn, options = {}) {
  const {
    onError = null,
    context = {},
    defaultValue = null
  } = options;

  try {
    const result = await fn();
    return { ok: true, result };
  } catch (error) {
    const decision = handleSimulationError(error, context);

    if (onError) {
      onError(error, decision);
    }

    return {
      ok: false,
      error: error.message,
      decision,
      defaultValue
    };
  }
}
