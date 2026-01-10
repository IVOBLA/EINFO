// test/json_sanitizer.test.js
import { describe, it, expect } from 'vitest';
import { extractJsonObject, validateOperationsJson } from '../server/json_sanitizer.js';

describe('JSON Sanitizer', () => {
  describe('extractJsonObject', () => {
    it('sollte valides JSON extrahieren', () => {
      const text = '{"test": "value"}';
      const result = extractJsonObject(text);
      expect(result).toEqual({ test: 'value' });
    });

    it('sollte JSON aus Text mit Markdown-Blöcken extrahieren', () => {
      const text = '```json\n{"test": "value"}\n```';
      const result = extractJsonObject(text);
      expect(result).toEqual({ test: 'value' });
    });

    it('sollte JSON mit Llama-Tokens extrahieren', () => {
      const text = '<|begin_of_text|>{"test": "value"}<|end_of_text|>';
      const result = extractJsonObject(text);
      expect(result).toEqual({ test: 'value' });
    });

    it('sollte trailing commas entfernen', () => {
      const text = '{"test": "value",}';
      const result = extractJsonObject(text);
      expect(result).toEqual({ test: 'value' });
    });

    it('sollte doppelte Kommas entfernen', () => {
      const text = '{"test": "value",, "test2": "value2"}';
      const result = extractJsonObject(text);
      expect(result).toHaveProperty('test');
      expect(result).toHaveProperty('test2');
    });

    it('sollte NaN durch null ersetzen', () => {
      const text = '{"test": NaN}';
      const result = extractJsonObject(text);
      expect(result).toEqual({ test: null });
    });

    it('sollte Infinity durch null ersetzen', () => {
      const text = '{"test": Infinity, "test2": -Infinity}';
      const result = extractJsonObject(text);
      expect(result).toEqual({ test: null, test2: null });
    });

    it('sollte null zurückgeben bei ungültigem JSON', () => {
      const text = 'This is not JSON at all';
      const result = extractJsonObject(text);
      expect(result).toBeNull();
    });

    it('sollte leeren String handhaben', () => {
      const result = extractJsonObject('');
      expect(result).toBeNull();
    });

    it('sollte verschachtelte Objekte extrahieren', () => {
      const text = '{"operations": {"board": {"createIncidentSites": []}}}';
      const result = extractJsonObject(text);
      expect(result).toHaveProperty('operations');
      expect(result.operations).toHaveProperty('board');
      expect(result.operations.board).toHaveProperty('createIncidentSites');
      expect(Array.isArray(result.operations.board.createIncidentSites)).toBe(true);
    });

    it('sollte Arrays korrekt extrahieren', () => {
      const text = '[{"id": 1}, {"id": 2}]';
      const result = extractJsonObject(text);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('sollte Unicode-Zeichen handhaben', () => {
      const text = '{"text": "Überschwemmung äußerste Maßnahme"}';
      const result = extractJsonObject(text);
      expect(result).toEqual({ text: 'Überschwemmung äußerste Maßnahme' });
    });
  });

  describe('validateOperationsJson', () => {
    it('sollte valides Operations-JSON akzeptieren', () => {
      const validJson = {
        operations: {
          board: {
            createIncidentSites: [],
            updateIncidentSites: []
          },
          aufgaben: {
            create: [],
            update: []
          },
          protokoll: {
            create: []
          }
        },
        analysis: 'Test analysis'
      };

      const result = validateOperationsJson(validJson);
      expect(result.valid).toBe(true);
    });

    it('sollte fehlendes operations-Objekt erkennen', () => {
      const invalidJson = {
        analysis: 'Test'
      };

      const result = validateOperationsJson(invalidJson);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/operations/i);
    });

    it('sollte ungültiges createIncidentSites erkennen', () => {
      const invalidJson = {
        operations: {
          board: {
            createIncidentSites: 'not an array'
          }
        }
      };

      const result = validateOperationsJson(invalidJson);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/createIncidentSites/i);
    });

    it('sollte ungültiges aufgaben.create erkennen', () => {
      const invalidJson = {
        operations: {
          aufgaben: {
            create: 'not an array'
          }
        }
      };

      const result = validateOperationsJson(invalidJson);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/aufgaben\.create/i);
    });

    it('sollte null zurückweisen', () => {
      const result = validateOperationsJson(null);
      expect(result.valid).toBe(false);
    });

    it('sollte nicht-Objekt zurückweisen', () => {
      const result = validateOperationsJson('string');
      expect(result.valid).toBe(false);
    });

    it('sollte leere operations akzeptieren', () => {
      const validJson = {
        operations: {}
      };

      const result = validateOperationsJson(validJson);
      expect(result.valid).toBe(true);
    });

    it('sollte optionale Felder zulassen', () => {
      const validJson = {
        operations: {
          board: {
            createIncidentSites: [
              {
                id: 'test-1',
                content: 'Test incident'
              }
            ]
          }
        }
      };

      const result = validateOperationsJson(validJson);
      expect(result.valid).toBe(true);
    });
  });

  describe('Complex JSON Scenarios', () => {
    it('sollte komplexes Operations-JSON mit allen Feldern extrahieren', () => {
      const text = `{
        "operations": {
          "board": {
            "createIncidentSites": [
              {
                "id": "incident-1",
                "content": "Hochwasser in der Innenstadt",
                "ort": "Hauptstraße 10"
              }
            ],
            "updateIncidentSites": []
          },
          "aufgaben": {
            "create": [
              {
                "title": "Evakuierung vorbereiten",
                "responsible": "S3"
              }
            ],
            "update": []
          },
          "protokoll": {
            "create": [
              {
                "information": "Lage erkundet",
                "anvon": "S2"
              }
            ]
          }
        },
        "analysis": "Situation erfordert sofortiges Handeln"
      }`;

      const result = extractJsonObject(text);
      expect(result).not.toBeNull();

      const validation = validateOperationsJson(result);
      expect(validation.valid).toBe(true);

      expect(result.operations.board.createIncidentSites).toHaveLength(1);
      expect(result.operations.aufgaben.create).toHaveLength(1);
      expect(result.operations.protokoll.create).toHaveLength(1);
    });

    it('sollte JSON mit vielen Llama-Artefakten bereinigen', () => {
      const text = `<|begin_of_text|>[INST]<<SYS>>System<</SYS>>[/INST]
      \`\`\`json
      {
        "operations": {
          "board": {"createIncidentSites": []},
        }
      }
      \`\`\`<|eot_id|>`;

      const result = extractJsonObject(text);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('operations');
    });
  });
});
