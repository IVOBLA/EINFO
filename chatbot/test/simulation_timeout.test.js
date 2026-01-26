// test/simulation_timeout.test.js
// Tests für die Simulation-Timeout-Logik

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SimulationState } from '../server/simulation_state.js';
import {
  isSimulationTimeExceeded,
  getScenarioDurationMinutes
} from '../server/scenario_controls.js';

describe('Simulation Timeout Tests', () => {
  let simulationState;

  beforeEach(() => {
    simulationState = new SimulationState();
  });

  afterEach(() => {
    simulationState.reset();
  });

  describe('getScenarioDurationMinutes', () => {
    it('sollte null zurückgeben wenn kein Szenario vorhanden', () => {
      expect(getScenarioDurationMinutes(null)).toBeNull();
      expect(getScenarioDurationMinutes(undefined)).toBeNull();
    });

    it('sollte null zurückgeben wenn duration_minutes nicht gesetzt', () => {
      expect(getScenarioDurationMinutes({})).toBeNull();
      expect(getScenarioDurationMinutes({ id: 'test' })).toBeNull();
    });

    it('sollte null zurückgeben bei ungültiger duration_minutes', () => {
      expect(getScenarioDurationMinutes({ duration_minutes: 0 })).toBeNull();
      expect(getScenarioDurationMinutes({ duration_minutes: -10 })).toBeNull();
      expect(getScenarioDurationMinutes({ duration_minutes: 'abc' })).toBeNull();
    });

    it('sollte duration_minutes zurückgeben wenn gültig', () => {
      expect(getScenarioDurationMinutes({ duration_minutes: 60 })).toBe(60);
      expect(getScenarioDurationMinutes({ duration_minutes: 120 })).toBe(120);
      expect(getScenarioDurationMinutes({ duration_minutes: '30' })).toBe(30);
    });
  });

  describe('isSimulationTimeExceeded', () => {
    it('sollte false zurückgeben wenn kein Szenario vorhanden', () => {
      expect(isSimulationTimeExceeded(null, 100)).toBe(false);
      expect(isSimulationTimeExceeded(undefined, 100)).toBe(false);
    });

    it('sollte false zurückgeben wenn keine duration_minutes gesetzt', () => {
      expect(isSimulationTimeExceeded({}, 100)).toBe(false);
      expect(isSimulationTimeExceeded({ id: 'test' }, 100)).toBe(false);
    });

    it('sollte false zurückgeben wenn Zeit noch nicht abgelaufen', () => {
      const scenario = { duration_minutes: 60 };
      expect(isSimulationTimeExceeded(scenario, 0)).toBe(false);
      expect(isSimulationTimeExceeded(scenario, 30)).toBe(false);
      expect(isSimulationTimeExceeded(scenario, 59)).toBe(false);
    });

    it('sollte true zurückgeben wenn Zeit abgelaufen', () => {
      const scenario = { duration_minutes: 60 };
      expect(isSimulationTimeExceeded(scenario, 60)).toBe(true);
      expect(isSimulationTimeExceeded(scenario, 61)).toBe(true);
      expect(isSimulationTimeExceeded(scenario, 100)).toBe(true);
    });

    it('sollte bei exakter Grenze true zurückgeben', () => {
      const scenario = { duration_minutes: 30 };
      expect(isSimulationTimeExceeded(scenario, 29)).toBe(false);
      expect(isSimulationTimeExceeded(scenario, 30)).toBe(true);
    });
  });

  describe('SimulationState stop() Methode', () => {
    it('sollte stoppedReason korrekt setzen bei timeout', () => {
      simulationState.start({ id: 'test', duration_minutes: 10 });
      expect(simulationState.running).toBe(true);
      expect(simulationState.stoppedReason).toBeNull();

      simulationState.stop('timeout');

      expect(simulationState.running).toBe(false);
      expect(simulationState.paused).toBe(false);
      expect(simulationState.stoppedReason).toBe('timeout');
      expect(simulationState.stoppedAt).not.toBeNull();
    });

    it('sollte stoppedReason korrekt setzen bei manual', () => {
      simulationState.start({ id: 'test' });
      simulationState.stop('manual');

      expect(simulationState.stoppedReason).toBe('manual');
    });

    it('sollte default reason "manual" verwenden', () => {
      simulationState.start({ id: 'test' });
      simulationState.stop();

      expect(simulationState.stoppedReason).toBe('manual');
    });

    it('sollte stepInProgress zurücksetzen beim Stop', () => {
      simulationState.start({ id: 'test' });
      simulationState.stepInProgress = true;

      simulationState.stop('timeout');

      expect(simulationState.stepInProgress).toBe(false);
    });
  });

  describe('SimulationState getStatus()', () => {
    it('sollte stoppedReason im Status enthalten', () => {
      simulationState.start({ id: 'test', duration_minutes: 60 });
      simulationState.stop('timeout');

      const status = simulationState.getStatus();

      expect(status.running).toBe(false);
      expect(status.stoppedReason).toBe('timeout');
      expect(status.stoppedAt).not.toBeNull();
    });

    it('sollte timeRemaining korrekt berechnen', () => {
      simulationState.start({ id: 'test', duration_minutes: 60 });
      simulationState.elapsedMinutes = 45;

      const status = simulationState.getStatus();

      expect(status.durationMinutes).toBe(60);
      expect(status.timeRemaining).toBe(15);
    });

    it('sollte timeRemaining = 0 bei abgelaufener Zeit', () => {
      simulationState.start({ id: 'test', duration_minutes: 60 });
      simulationState.elapsedMinutes = 75;

      const status = simulationState.getStatus();

      expect(status.timeRemaining).toBe(0);
    });
  });

  describe('Timeout-Workflow Integration', () => {
    it('sollte Simulation korrekt durch Timeout beenden', () => {
      const scenario = { id: 'test', duration_minutes: 10 };
      simulationState.start(scenario);

      // Simuliere Zeitfortschritt
      simulationState.incrementTime(5);
      expect(simulationState.elapsedMinutes).toBe(5);
      expect(isSimulationTimeExceeded(scenario, simulationState.elapsedMinutes)).toBe(false);

      // Zeit überschreitet Limit
      simulationState.incrementTime(5);
      expect(simulationState.elapsedMinutes).toBe(10);
      expect(isSimulationTimeExceeded(scenario, simulationState.elapsedMinutes)).toBe(true);

      // Simuliere Timeout-Stop
      if (isSimulationTimeExceeded(scenario, simulationState.elapsedMinutes)) {
        simulationState.stop('timeout');
      }

      expect(simulationState.running).toBe(false);
      expect(simulationState.stoppedReason).toBe('timeout');
    });

    it('sollte reset() alle Timeout-Felder zurücksetzen', () => {
      simulationState.start({ id: 'test' });
      simulationState.stop('timeout');

      expect(simulationState.stoppedReason).toBe('timeout');

      simulationState.reset();

      expect(simulationState.stoppedReason).toBeNull();
      expect(simulationState.stoppedAt).toBeNull();
      expect(simulationState.running).toBe(false);
    });
  });

  describe('Worker-Stop Logik', () => {
    it('sollte Worker-Stop-Bedingungen erkennen', () => {
      // Simuliere den Status wie er vom Worker abgefragt wird
      simulationState.start({ id: 'test', duration_minutes: 10 });

      // Vor Timeout: Worker soll weiterlaufen
      let status = simulationState.getStatus();
      let shouldStop = !status.running && !status.paused && status.stoppedReason !== null;
      expect(shouldStop).toBe(false);

      // Nach Timeout
      simulationState.stop('timeout');
      status = simulationState.getStatus();
      shouldStop = !status.running && !status.paused && status.stoppedReason !== null;
      expect(shouldStop).toBe(true);
      expect(status.stoppedReason).toBe('timeout');
    });
  });

  describe('API Response Format', () => {
    it('sollte korrektes Format für Timeout-Response haben', () => {
      const scenario = { id: 'test', duration_minutes: 10 };
      simulationState.start(scenario);
      simulationState.elapsedMinutes = 10; // Zeit abgelaufen

      // Simuliere die sim_loop Logik
      if (isSimulationTimeExceeded(scenario, simulationState.elapsedMinutes)) {
        const durationMinutes = getScenarioDurationMinutes(scenario);
        simulationState.stop('timeout');

        const response = {
          ok: false,
          reason: 'timeout',
          message: `Simulationszeit abgelaufen (${durationMinutes} Minuten erreicht)`
        };

        expect(response.ok).toBe(false);
        expect(response.reason).toBe('timeout');
        expect(response.message).toContain('10 Minuten');
      }
    });
  });
});
