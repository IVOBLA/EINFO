// chatbot/server/rag/session_rag.js
// Session-basiertes RAG für Live-Einsatzdaten
// Hält Embeddings im Memory für schnelle Suche während eines Einsatzes

import { embedText } from "./embedding.js";
import { logDebug, logInfo, logError } from "../logger.js";

/**
 * Cosine-Similarity für Vektoren
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Session-RAG Klasse
 * Verwaltet Embeddings für einen laufenden Einsatz
 */
export class SessionRAG {
  constructor(scenarioId = null) {
    this.scenarioId = scenarioId || `session_${Date.now()}`;
    this.items = new Map();  // id → { text, embedding, meta, addedAt }
    this.createdAt = Date.now();

    logInfo("SessionRAG initialisiert", { scenarioId: this.scenarioId });
  }

  /**
   * Fügt ein Item zum Session-RAG hinzu
   * @param {string} id - Eindeutige ID
   * @param {string} text - Text für Embedding
   * @param {object} meta - Metadaten (type, role, etc.)
   */
  async add(id, text, meta = {}) {
    if (!text || !text.trim()) {
      logDebug("SessionRAG: Leerer Text ignoriert", { id });
      return null;
    }

    try {
      const embedding = await embedText(text);

      const item = {
        id,
        text: text.trim(),
        embedding,
        meta: {
          ...meta,
          scenarioId: this.scenarioId
        },
        addedAt: Date.now()
      };

      this.items.set(id, item);

      logDebug("SessionRAG: Item hinzugefügt", {
        id,
        type: meta.type,
        itemCount: this.items.size
      });

      return item;
    } catch (error) {
      logError("SessionRAG: Fehler beim Hinzufügen", {
        id,
        error: String(error)
      });
      return null;
    }
  }

  /**
   * Aktualisiert ein bestehendes Item
   */
  async update(id, text, meta = {}) {
    const existing = this.items.get(id);
    if (existing) {
      // Merge Metadaten
      const mergedMeta = { ...existing.meta, ...meta };
      return this.add(id, text, mergedMeta);
    }
    return this.add(id, text, meta);
  }

  /**
   * Entfernt ein Item
   */
  remove(id) {
    const deleted = this.items.delete(id);
    if (deleted) {
      logDebug("SessionRAG: Item entfernt", { id });
    }
    return deleted;
  }

  /**
   * Semantische Suche im Session-RAG
   * @param {string} query - Suchanfrage
   * @param {object} options - Optionen
   */
  async search(query, { topK = 5, minScore = 0.3, type = null, maxAgeMs = null } = {}) {
    if (!query || !query.trim() || this.items.size === 0) {
      return [];
    }

    try {
      const queryEmb = await embedText(query);
      const now = Date.now();
      const results = [];

      for (const [id, item] of this.items) {
        // Filter nach Typ
        if (type && item.meta?.type !== type) continue;

        // Filter nach Alter
        if (maxAgeMs && (now - item.addedAt) > maxAgeMs) continue;

        const score = cosineSimilarity(queryEmb, item.embedding);

        if (score >= minScore) {
          results.push({
            id,
            text: item.text,
            meta: item.meta,
            score,
            ageMs: now - item.addedAt
          });
        }
      }

      // Nach Score sortieren
      results.sort((a, b) => b.score - a.score);

      const topResults = results.slice(0, topK);

      logDebug("SessionRAG: Suche", {
        query: query.slice(0, 50),
        found: results.length,
        returned: topResults.length
      });

      return topResults;
    } catch (error) {
      logError("SessionRAG: Suchfehler", { error: String(error) });
      return [];
    }
  }

  /**
   * Gibt alle Items eines bestimmten Typs zurück
   */
  getByType(type) {
    const results = [];
    for (const [id, item] of this.items) {
      if (item.meta?.type === type) {
        results.push({ id, ...item });
      }
    }
    return results;
  }

  /**
   * Gibt Statistiken zurück
   */
  getStats() {
    const byType = {};
    for (const [, item] of this.items) {
      const type = item.meta?.type || "unknown";
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      scenarioId: this.scenarioId,
      totalItems: this.items.size,
      byType,
      createdAt: this.createdAt,
      ageMs: Date.now() - this.createdAt
    };
  }

  /**
   * Exportiert alle Items für Archivierung
   */
  export() {
    const exported = [];
    for (const [id, item] of this.items) {
      exported.push({
        id,
        text: item.text,
        meta: item.meta,
        addedAt: item.addedAt
        // Embedding nicht exportieren (zu groß)
      });
    }
    return {
      scenarioId: this.scenarioId,
      exportedAt: Date.now(),
      items: exported
    };
  }

  /**
   * Löscht alle Items
   */
  clear() {
    const count = this.items.size;
    this.items.clear();
    logInfo("SessionRAG: Gelöscht", {
      scenarioId: this.scenarioId,
      itemsCleared: count
    });
  }

  /**
   * Gibt Context-String für LLM zurück
   */
  async getContextForQuery(query, { maxChars = 2000, topK = 5 } = {}) {
    const results = await this.search(query, { topK, minScore: 0.25 });

    if (results.length === 0) return "";

    let context = "### AKTUELLE EINSATZDATEN ###\n\n";
    let charCount = context.length;

    for (const result of results) {
      const entry = `[${result.meta?.type || "info"}] ${result.text}\n`;

      if (charCount + entry.length > maxChars) break;

      context += entry;
      charCount += entry.length;
    }

    return context;
  }
}

// ============================================================
// Singleton-Instanz für aktuelle Session
// ============================================================

let currentSession = null;

/**
 * Gibt die aktuelle Session zurück oder erstellt eine neue
 */
export function getCurrentSession(scenarioId = null) {
  if (!currentSession || (scenarioId && currentSession.scenarioId !== scenarioId)) {
    currentSession = new SessionRAG(scenarioId);
  }
  return currentSession;
}

/**
 * Startet eine neue Session (löscht alte)
 */
export function startNewSession(scenarioId) {
  if (currentSession) {
    logInfo("SessionRAG: Alte Session beendet", currentSession.getStats());
  }
  currentSession = new SessionRAG(scenarioId);
  return currentSession;
}

/**
 * Beendet die aktuelle Session und gibt Export zurück
 */
export function endCurrentSession() {
  if (!currentSession) return null;

  const exported = currentSession.export();
  const stats = currentSession.getStats();

  logInfo("SessionRAG: Session beendet", stats);

  currentSession = null;
  return exported;
}

export default SessionRAG;
