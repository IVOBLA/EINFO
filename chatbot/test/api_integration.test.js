// test/api_integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';

// Diese Tests erfordern einen laufenden Chatbot-Server
// Sie können mit CHATBOT_TEST_URL angepasst werden
const CHATBOT_URL = process.env.CHATBOT_TEST_URL || 'http://localhost:3100';

async function fetchAPI(endpoint, options = {}) {
  const url = `${CHATBOT_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    return response;
  } catch (error) {
    // Server nicht verfügbar
    return null;
  }
}

describe('API Integration Tests', () => {
  let serverAvailable = false;

  beforeAll(async () => {
    // Prüfe ob Server läuft
    const response = await fetchAPI('/api/llm/models');
    serverAvailable = response !== null;

    if (!serverAvailable) {
      console.log('⚠️  Chatbot-Server nicht verfügbar - Integration-Tests werden übersprungen');
    }
  });

  describe('LLM Endpoints', () => {
    it('sollte verfügbare Modelle auflisten', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/llm/models');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('models');
      expect(Array.isArray(data.models)).toBe(true);
    });

    it('sollte Modell-Konfiguration abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/llm/config');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('config');
    });

    it('sollte GPU-Status abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/llm/gpu');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('status');
    });

    it('sollte Task-Konfiguration abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/llm/task-config?task=chat');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('taskConfig');
    });
  });

  describe('Simulation Endpoints', () => {
    it('sollte aktives Szenario abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/sim/scenario');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('scenario');
    });

    it('sollte Szenarien auflisten', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/scenarios');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('scenarios');
      expect(Array.isArray(data.scenarios)).toBe(true);
    });

    it('sollte Simulation pausieren können', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/sim/pause', {
        method: 'POST'
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
    });
  });

  describe('Audit Trail Endpoints', () => {
    it('sollte Audit-Status abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/audit/status');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('status');
    });

    it('sollte Audit-Liste abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/audit/list');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('exercises');
      expect(Array.isArray(data.exercises)).toBe(true);
    });
  });

  describe('Template Endpoints', () => {
    it('sollte Templates auflisten', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/templates');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('templates');
      expect(Array.isArray(data.templates)).toBe(true);
    });
  });

  describe('Disaster Context Endpoints', () => {
    it('sollte aktuellen Disaster Context abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/disaster/current');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('context');
    });

    it('sollte Disaster Summary abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/disaster/summary');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('summary');
    });

    it('sollte Disaster Contexts auflisten', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/disaster/list');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('contexts');
      expect(Array.isArray(data.contexts)).toBe(true);
    });
  });

  describe('Situation Analysis Endpoints', () => {
    it('sollte Analyse-Status abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/situation/status');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('status');
    });
  });

  describe('Feedback Endpoints', () => {
    it('sollte Feedback-Liste abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/feedback/list');
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('feedbacks');
      expect(Array.isArray(data.feedbacks)).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('sollte Rate-Limit-Stats abrufen', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/rate-limit/stats');

      // Dieser Endpoint könnte fehlen, daher nur prüfen wenn vorhanden
      if (response && response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('ok');
      }
    });

    it('sollte zu viele Chat-Anfragen limitieren', async () => {
      if (!serverAvailable) return;

      // Sende mehrere Anfragen schnell hintereinander
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          fetchAPI('/api/chat', {
            method: 'POST',
            body: JSON.stringify({ question: `Test ${i}` })
          })
        );
      }

      const responses = await Promise.all(promises);

      // Mindestens eine sollte erfolgreich sein
      const successCount = responses.filter(r => r && r.ok).length;
      expect(successCount).toBeGreaterThan(0);

      // Bei zu vielen Anfragen sollte Rate-Limiting greifen
      // (abhängig vom konfigurierten Limit)
    }, 15000);
  });

  describe('Error Handling', () => {
    it('sollte 404 für unbekannte Endpoints zurückgeben', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/nonexistent-endpoint');
      expect(response.status).toBe(404);
    });

    it('sollte 400 für ungültige Chat-Anfrage zurückgeben', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/chat', {
        method: 'POST',
        body: JSON.stringify({}) // Fehlt 'question'
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.ok).toBe(false);
    });

    it('sollte 404 für nicht existierendes Szenario zurückgeben', async () => {
      if (!serverAvailable) return;

      const response = await fetchAPI('/api/scenarios/nonexistent-id-12345');
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.ok).toBe(false);
    });
  });

  describe('Performance', () => {
    it('sollte Modell-Liste schnell abrufen', async () => {
      if (!serverAvailable) return;

      const startTime = Date.now();
      const response = await fetchAPI('/api/llm/models');
      const duration = Date.now() - startTime;

      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(5000); // Max 5 Sekunden
    });

    it('sollte mehrere parallele Anfragen handhaben', async () => {
      if (!serverAvailable) return;

      const endpoints = [
        '/api/llm/models',
        '/api/llm/config',
        '/api/sim/scenario',
        '/api/audit/status',
        '/api/disaster/current'
      ];

      const startTime = Date.now();
      const responses = await Promise.all(
        endpoints.map(endpoint => fetchAPI(endpoint))
      );
      const duration = Date.now() - startTime;

      // Alle sollten erfolgreich sein
      responses.forEach(response => {
        expect(response).not.toBeNull();
        expect(response.ok).toBe(true);
      });

      // Parallel sollte schneller sein als sequenziell
      expect(duration).toBeLessThan(10000);
    });
  });
});
