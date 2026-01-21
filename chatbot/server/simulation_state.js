// chatbot/server/simulation_state.js
// Verwaltung des Simulationszustands (ersetzt globale Variablen)

import { logDebug, logInfo } from "./logger.js";

/**
 * Verwaltet den Zustand einer Simulation.
 * Ersetzt globale Variablen und ermöglicht State-Serialisierung.
 */
export class SimulationState {
  constructor() {
    this.lastSnapshot = null;
    this.lastCompressedBoard = "[]";
    this.running = false;
    this.stepInProgress = false;
    this.justStarted = false;
    this.activeScenario = null;
    this.elapsedMinutes = 0;
    this.startTime = null;
    this.stepCount = 0;
  }

  /**
   * Startet die Simulation mit optionalem Szenario
   * @param {Object|null} scenario - Szenario-Konfiguration
   */
  start(scenario = null) {
    this.running = true;
    this.stepInProgress = false;
    this.justStarted = true;
    this.activeScenario = scenario;
    this.elapsedMinutes = 0;
    this.startTime = Date.now();
    this.stepCount = 0;
    this.lastSnapshot = null;
    this.lastCompressedBoard = "[]";

    logInfo("Simulation gestartet", {
      scenarioId: scenario?.id || "none",
      startTime: this.startTime
    });
  }

  /**
   * Pausiert die Simulation
   */
  pause() {
    this.running = false;
    logInfo("Simulation pausiert", {
      elapsedMinutes: this.elapsedMinutes,
      stepCount: this.stepCount
    });
  }

  /**
   * Stoppt die Simulation komplett
   */
  stop() {
    const wasRunning = this.running;
    this.running = false;
    this.stepInProgress = false;
    this.justStarted = false;

    if (wasRunning) {
      logInfo("Simulation gestoppt", {
        elapsedMinutes: this.elapsedMinutes,
        stepCount: this.stepCount,
        duration: this.startTime ? Date.now() - this.startTime : 0
      });
    }
  }

  /**
   * Setzt den State komplett zurück
   */
  reset() {
    this.stop();
    this.activeScenario = null;
    this.elapsedMinutes = 0;
    this.startTime = null;
    this.stepCount = 0;
    this.lastSnapshot = null;
    this.lastCompressedBoard = "[]";

    logDebug("Simulation State zurückgesetzt");
  }

  /**
   * Erhöht die Simulationszeit
   * @param {number} minutes - Anzahl Minuten
   */
  incrementTime(minutes) {
    this.elapsedMinutes += minutes;
    this.stepCount++;
    this.justStarted = false;

    logDebug("Simulationszeit erhöht", {
      elapsedMinutes: this.elapsedMinutes,
      stepCount: this.stepCount,
      addedMinutes: minutes
    });
  }

  /**
   * Aktualisiert den letzten Snapshot
   * @param {Object} snapshot - { board, aufgaben, protokoll }
   */
  updateSnapshot(snapshot) {
    this.lastSnapshot = snapshot;
  }

  /**
   * Aktualisiert den komprimierten Board-State
   * @param {string} compressedBoard - JSON-String
   */
  updateCompressedBoard(compressedBoard) {
    this.lastCompressedBoard = compressedBoard;
  }

  /**
   * Serialisiert den State zu JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      running: this.running,
      stepInProgress: this.stepInProgress,
      justStarted: this.justStarted,
      activeScenario: this.activeScenario,
      elapsedMinutes: this.elapsedMinutes,
      startTime: this.startTime,
      stepCount: this.stepCount,
      lastCompressedBoard: this.lastCompressedBoard,
      // lastSnapshot ist zu groß für Serialisierung
    };
  }

  /**
   * Erstellt SimulationState aus JSON
   * @param {Object} data - Serialisierte Daten
   * @returns {SimulationState}
   */
  static fromJSON(data) {
    const state = new SimulationState();
    Object.assign(state, {
      running: data.running || false,
      stepInProgress: false, // Nie stepInProgress beim Restore
      justStarted: data.justStarted || false,
      activeScenario: data.activeScenario || null,
      elapsedMinutes: data.elapsedMinutes || 0,
      startTime: data.startTime || null,
      stepCount: data.stepCount || 0,
      lastCompressedBoard: data.lastCompressedBoard || "[]",
      lastSnapshot: null // Muss neu geladen werden
    });
    return state;
  }

  /**
   * Gibt Status-Info zurück
   * @returns {Object}
   */
  getStatus() {
    return {
      running: this.running,
      stepInProgress: this.stepInProgress,
      justStarted: this.justStarted,
      elapsedMinutes: this.elapsedMinutes,
      stepCount: this.stepCount,
      scenarioActive: !!this.activeScenario,
      scenarioId: this.activeScenario?.id || null,
      scenarioTitle: this.activeScenario?.title || null,
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }
}

// Singleton-Instanz für globale Verwendung
export const simulationState = new SimulationState();
