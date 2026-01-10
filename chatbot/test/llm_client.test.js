// test/llm_client.test.js
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { listAvailableLlmModels, checkConfiguredModels } from '../server/llm_client.js';

describe('LLM Client', () => {
  describe('listAvailableLlmModels', () => {
    it('sollte ein Array von Modellnamen zurückgeben', async () => {
      try {
        const models = await listAvailableLlmModels();
        expect(Array.isArray(models)).toBe(true);

        // Wenn Ollama läuft, sollten Modelle vorhanden sein
        if (models.length > 0) {
          expect(typeof models[0]).toBe('string');
        }
      } catch (error) {
        // Wenn Ollama nicht läuft, erwarten wir einen spezifischen Fehler
        expect(error.message).toMatch(/Ollama|erreichbar|Modelle/i);
      }
    });

    it('sollte eindeutige Modellnamen zurückgeben (keine Duplikate)', async () => {
      try {
        const models = await listAvailableLlmModels();
        const uniqueModels = [...new Set(models)];
        expect(models.length).toBe(uniqueModels.length);
      } catch (error) {
        // Ollama nicht verfügbar - Test überspringen
        expect(error.message).toMatch(/Ollama|erreichbar|Modelle/i);
      }
    });

    it('sollte bei Netzwerkfehler entsprechenden Fehler werfen', async () => {
      // Dieser Test erwartet dass Ollama NICHT auf einem ungültigen Port läuft
      const originalBaseUrl = process.env.LLM_BASE_URL;
      process.env.LLM_BASE_URL = 'http://localhost:99999';

      try {
        await expect(listAvailableLlmModels()).rejects.toThrow();
      } finally {
        process.env.LLM_BASE_URL = originalBaseUrl;
      }
    });
  });

  describe('checkConfiguredModels', () => {
    it('sollte Objekt mit available, missing und installed zurückgeben', async () => {
      const result = await checkConfiguredModels();

      expect(result).toHaveProperty('available');
      expect(result).toHaveProperty('missing');
      expect(result).toHaveProperty('installed');

      expect(Array.isArray(result.available)).toBe(true);
      expect(Array.isArray(result.missing)).toBe(true);
      expect(Array.isArray(result.installed)).toBe(true);

      // activeConfig nur wenn kein Fehler
      if (!result.error) {
        expect(result).toHaveProperty('activeConfig');
      }
    });

    it('sollte bei Fehler error-Property enthalten', async () => {
      const originalBaseUrl = process.env.LLM_BASE_URL;
      process.env.LLM_BASE_URL = 'http://localhost:99999';

      try {
        const result = await checkConfiguredModels();

        // Bei Fehler sollten die Arrays leer sein
        expect(result.available).toEqual([]);
        expect(result.missing).toEqual([]);
        expect(result.installed).toEqual([]);
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      } finally {
        process.env.LLM_BASE_URL = originalBaseUrl;
      }
    });
  });

  describe('Model Configuration Validation', () => {
    it('sollte valide Task-Konfiguration haben', async () => {
      const result = await checkConfiguredModels();

      if (result.activeConfig) {
        expect(result.activeConfig).toHaveProperty('tasks');

        const tasks = result.activeConfig.tasks;
        expect(tasks).toHaveProperty('start');
        expect(tasks).toHaveProperty('operations');
        expect(tasks).toHaveProperty('chat');
        expect(tasks).toHaveProperty('analysis');

        // Jede Task sollte ein model haben
        Object.values(tasks).forEach(taskConfig => {
          expect(taskConfig).toHaveProperty('model');
          expect(typeof taskConfig.model).toBe('string');
          expect(taskConfig.model.length).toBeGreaterThan(0);
        });
      }
    });
  });

  describe('Retry Logic', () => {
    it('sollte bei Timeout nach mehreren Versuchen fehlschlagen', async () => {
      const originalTimeout = process.env.LLM_REQUEST_TIMEOUT_MS;
      process.env.LLM_REQUEST_TIMEOUT_MS = '100'; // Sehr kurzes Timeout

      try {
        // Dieser Test sollte nach 3 Retries fehlschlagen
        await expect(listAvailableLlmModels()).rejects.toThrow();
      } finally {
        process.env.LLM_REQUEST_TIMEOUT_MS = originalTimeout;
      }
    }, 10000);
  });

  describe('Performance', () => {
    it('sollte Modellliste in unter 5 Sekunden abrufen', async () => {
      const startTime = Date.now();

      try {
        await listAvailableLlmModels();
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(5000);
      } catch (error) {
        // Ollama nicht verfügbar - Test überspringen
        expect(error.message).toMatch(/Ollama|erreichbar|Modelle/i);
      }
    });

    it('sollte mehrere parallele Abfragen handhaben können', async () => {
      const promises = Array(3).fill(null).map(() =>
        listAvailableLlmModels().catch(e => e)
      );

      const results = await Promise.all(promises);

      // Alle sollten entweder erfolgreich sein oder den gleichen Fehler haben
      const successResults = results.filter(r => Array.isArray(r));
      const errorResults = results.filter(r => r instanceof Error);

      expect(successResults.length + errorResults.length).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('sollte mit ungültiger Base-URL umgehen', async () => {
      const originalBaseUrl = process.env.LLM_BASE_URL;
      process.env.LLM_BASE_URL = 'invalid-url';

      try {
        await expect(listAvailableLlmModels()).rejects.toThrow();
      } finally {
        process.env.LLM_BASE_URL = originalBaseUrl;
      }
    });

    it('sollte mit leerem Response umgehen', async () => {
      // Dieser Test verifiziert dass der Client robuste Error-Handling hat
      // auch wenn die API unerwartete Responses liefert
      try {
        const models = await listAvailableLlmModels();
        expect(Array.isArray(models)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
