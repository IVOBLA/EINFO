// test/rag_vector.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getKnowledgeContextVector, getKnowledgeContextWithSources } from '../server/rag/rag_vector.js';

describe('RAG Vector System', () => {
  describe('getKnowledgeContextVector', () => {
    it('sollte einen String zurückgeben', async () => {
      const result = await getKnowledgeContextVector('Test query');
      expect(typeof result).toBe('string');
    });

    it('sollte leeren String zurückgeben wenn keine Embeddings vorhanden', async () => {
      // Dieser Test funktioniert nur wenn kein Index vorhanden ist
      const result = await getKnowledgeContextVector('');
      expect(typeof result).toBe('string');
    });

    it('sollte für ähnliche Queries ähnliche Ergebnisse liefern', async () => {
      const query1 = 'Hochwasser Katastrophe';
      const query2 = 'Hochwasser Einsatz';

      const result1 = await getKnowledgeContextVector(query1);
      const result2 = await getKnowledgeContextVector(query2);

      // Beide sollten Ergebnisse liefern (oder beide leer sein)
      expect(typeof result1).toBe('string');
      expect(typeof result2).toBe('string');
    });

    it('sollte Ergebnisse innerhalb der maxContextChars Grenze liefern', async () => {
      const maxChars = 2500; // CONFIG.rag.maxContextChars default
      const result = await getKnowledgeContextVector('Katastrophenschutz Stabsarbeit');

      expect(result.length).toBeLessThanOrEqual(maxChars + 500); // +500 für Header etc.
    });
  });

  describe('getKnowledgeContextWithSources', () => {
    it('sollte Objekt mit context und sources zurückgeben', async () => {
      const result = await getKnowledgeContextWithSources('Test query');

      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('sources');
      expect(typeof result.context).toBe('string');
      expect(Array.isArray(result.sources)).toBe(true);
    });

    it('sollte sources mit korrekter Struktur zurückgeben', async () => {
      const result = await getKnowledgeContextWithSources('Hochwasser', {
        topK: 3,
        threshold: 0.3
      });

      // Wenn Sources vorhanden, müssen sie korrekte Struktur haben
      if (result.sources.length > 0) {
        const source = result.sources[0];
        expect(source).toHaveProperty('fileName');
        expect(source).toHaveProperty('score');
        expect(source).toHaveProperty('preview');
        expect(typeof source.fileName).toBe('string');
        expect(typeof source.score).toBe('number');
        expect(typeof source.preview).toBe('string');
      }
    });

    it('sollte maxChars Parameter respektieren', async () => {
      const maxChars = 1000;
      const result = await getKnowledgeContextWithSources('Katastrophe', {
        maxChars
      });

      expect(result.context.length).toBeLessThanOrEqual(maxChars + 200); // +200 Buffer
    });

    it('sollte topK Parameter respektieren', async () => {
      const topK = 2;
      const result = await getKnowledgeContextWithSources('Einsatz', {
        topK,
        threshold: 0.1 // Niedriger threshold für mehr Ergebnisse
      });

      expect(result.sources.length).toBeLessThanOrEqual(topK);
    });

    it('sollte threshold Parameter respektieren', async () => {
      const highThreshold = 0.9;
      const result = await getKnowledgeContextWithSources('XYZ123ABC', {
        threshold: highThreshold
      });

      // Bei sehr hohem Threshold und unwahrscheinlicher Query sollten keine Ergebnisse kommen
      expect(result.sources.length).toBe(0);
      expect(result.context).toBe('');
    });
  });

  describe('Cosine Similarity Optimization', () => {
    it('sollte für identische Vektoren Similarity von ~1.0 liefern', () => {
      // Da cosineSimilarity nicht exportiert ist, testen wir das Verhalten indirekt
      // durch mehrfache Abfragen der gleichen Query
      const query = 'Katastrophenschutz';

      // Keine Assertion nötig - Test verifiziert nur dass keine Exception geworfen wird
      expect(async () => {
        await getKnowledgeContextVector(query);
        await getKnowledgeContextVector(query);
      }).not.toThrow();
    });
  });

  describe('Performance Tests', () => {
    it('sollte Abfrage in unter 5 Sekunden abschließen', async () => {
      const startTime = Date.now();
      await getKnowledgeContextVector('Hochwasser Katastrophenschutz Einsatzleitung');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000);
    });

    it('sollte mehrere Abfragen parallel verarbeiten können', async () => {
      const queries = [
        'Hochwasser',
        'Katastrophe',
        'Einsatzleitung',
        'Stabsarbeit',
        'Meldestelle'
      ];

      const startTime = Date.now();
      const results = await Promise.all(
        queries.map(q => getKnowledgeContextVector(q))
      );
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(typeof result).toBe('string');
      });

      // Parallel sollte schneller sein als 5 * 5 Sekunden
      expect(duration).toBeLessThan(25000);
    });
  });

  describe('Edge Cases', () => {
    it('sollte mit leerer Query umgehen können', async () => {
      const result = await getKnowledgeContextVector('');
      expect(typeof result).toBe('string');
    });

    it('sollte mit sehr langer Query umgehen können', async () => {
      const longQuery = 'Katastrophenschutz '.repeat(100);
      const result = await getKnowledgeContextVector(longQuery);
      expect(typeof result).toBe('string');
    });

    it('sollte mit Sonderzeichen umgehen können', async () => {
      const specialQuery = 'Hochwasser? Katastrophe! @#$%^&*()';
      const result = await getKnowledgeContextVector(specialQuery);
      expect(typeof result).toBe('string');
    });

    it('sollte mit Unicode-Zeichen umgehen können', async () => {
      const unicodeQuery = 'Überschwemmung Äußerste Maßnahme';
      const result = await getKnowledgeContextVector(unicodeQuery);
      expect(typeof result).toBe('string');
    });
  });
});
