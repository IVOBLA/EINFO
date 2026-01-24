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
    this.paused = false;
    this.stepInProgress = false;
    this.justStarted = false;
    this.activeScenario = null;
    this.triggerManager = null;
    this.elapsedMinutes = 0;
    this.startTime = null;
    this.stepCount = 0;
    this.activeRoles = [];  // Aktiv besetzte Rollen
    this.missingRoles = []; // Zu simulierende Rollen
  }

  /**
   * Startet die Simulation mit optionalem Szenario
   * @param {Object|null} scenario - Szenario-Konfiguration
   */
  start(scenario = null, options = {}) {
    const { resetState = true } = options;
    this.running = true;
    this.paused = false;
    this.stepInProgress = false;
    this.justStarted = resetState;
    this.activeScenario = scenario;
    if (resetState) {
      this.elapsedMinutes = 0;
      this.startTime = Date.now();
      this.stepCount = 0;
      this.lastSnapshot = null;
      this.lastCompressedBoard = "[]";
    } else if (!this.startTime) {
      this.startTime = Date.now();
    }

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
    this.paused = true;
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
    this.paused = false;
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
    this.triggerManager = null;
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
   * Aktualisiert die aktiven und fehlenden Rollen
   * @param {Object} roles - { active: string[], missing: string[] }
   */
  updateRoles(roles) {
    if (roles && Array.isArray(roles.active)) {
      this.activeRoles = [...roles.active];
    }
    if (roles && Array.isArray(roles.missing)) {
      this.missingRoles = [...roles.missing];
    }
  }

  /**
   * Serialisiert den State zu JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      running: this.running,
      paused: this.paused,
      stepInProgress: this.stepInProgress,
      justStarted: this.justStarted,
      activeScenario: this.activeScenario,
      elapsedMinutes: this.elapsedMinutes,
      startTime: this.startTime,
      stepCount: this.stepCount,
      lastCompressedBoard: this.lastCompressedBoard,
      activeRoles: this.activeRoles,
      missingRoles: this.missingRoles,
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
      paused: data.paused || false,
      stepInProgress: false, // Nie stepInProgress beim Restore
      justStarted: data.justStarted || false,
      activeScenario: data.activeScenario || null,
      elapsedMinutes: data.elapsedMinutes || 0,
      startTime: data.startTime || null,
      stepCount: data.stepCount || 0,
      lastCompressedBoard: data.lastCompressedBoard || "[]",
      activeRoles: data.activeRoles || [],
      missingRoles: data.missingRoles || [],
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
      paused: this.paused,
      stepInProgress: this.stepInProgress,
      justStarted: this.justStarted,
      elapsedMinutes: this.elapsedMinutes,
      stepCount: this.stepCount,
      scenarioActive: !!this.activeScenario,
      scenarioId: this.activeScenario?.id || null,
      scenarioTitle: this.activeScenario?.title || null,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      activeRoles: this.activeRoles,
      missingRoles: this.missingRoles
    };
  }
}

// Singleton-Instanz für globale Verwendung
export const simulationState = new SimulationState();
