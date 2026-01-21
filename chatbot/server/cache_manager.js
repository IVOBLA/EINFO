// chatbot/server/cache_manager.js
// Cache-Manager für Simulation

import { logDebug } from "./logger.js";
import { SIMULATION_DEFAULTS } from "./config.js";

/**
 * Einfacher Cache-Manager mit TTL-Unterstützung
 */
export class CacheManager {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0
    };
  }

  /**
   * Speichert Wert im Cache
   * @param {string} key - Cache-Key
   * @param {*} value - Zu cachender Wert
   * @param {number} ttlMs - Time-to-live in Millisekunden
   */
  set(key, value, ttlMs = 60000) {
    this.cache.set(key, value);
    this.ttl.set(key, Date.now() + ttlMs);
    this.stats.sets++;

    logDebug("Cache Set", {
      key,
      ttlMs,
      expiresAt: new Date(Date.now() + ttlMs).toISOString()
    });
  }

  /**
   * Holt Wert aus Cache
   * @param {string} key - Cache-Key
   * @returns {*|null} - Gecachter Wert oder null
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.stats.misses++;
      return null;
    }

    const expiresAt = this.ttl.get(key);
    if (Date.now() > expiresAt) {
      // Expired
      this.cache.delete(key);
      this.ttl.delete(key);
      this.stats.misses++;

      logDebug("Cache Expired", { key });
      return null;
    }

    this.stats.hits++;
    logDebug("Cache Hit", { key });
    return this.cache.get(key);
  }

  /**
   * Invalidiert Cache-Einträge nach Pattern
   * @param {string|RegExp} pattern - Pattern zum Matchen
   */
  invalidate(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.ttl.delete(key);
        count++;
      }
    }

    this.stats.invalidations += count;

    logDebug("Cache Invalidated", {
      pattern: pattern.toString(),
      count
    });
  }

  /**
   * Löscht alle Cache-Einträge
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.ttl.clear();

    logDebug("Cache Cleared", { entries: size });
  }

  /**
   * Gibt Cache-Statistiken zurück
   * @returns {Object}
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: `${hitRate}%`,
      total
    };
  }

  /**
   * Entfernt abgelaufene Einträge
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [key, expiresAt] of this.ttl.entries()) {
      if (now > expiresAt) {
        this.cache.delete(key);
        this.ttl.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logDebug("Cache Cleanup", { removed });
    }

    return removed;
  }
}

// Singleton-Instanz
export const cache = new CacheManager();

// Periodisches Cleanup alle 5 Minuten
setInterval(() => {
  cache.cleanup();
}, 5 * 60 * 1000);

/**
 * Cached Wrapper für Disaster Context
 * @param {Function} fn - Funktion die Disaster Context lädt
 * @param {Object} options - Optionen
 * @returns {Promise<*>}
 */
export async function getCachedDisasterContext(fn, options = {}) {
  const cacheKey = `disaster-context:${JSON.stringify(options)}`;
  const ttl = SIMULATION_DEFAULTS.cache.disasterContextTTL;

  let context = cache.get(cacheKey);
  if (context) {
    return context;
  }

  context = await fn(options);
  cache.set(cacheKey, context, ttl);

  return context;
}

/**
 * Cached Wrapper für Learned Responses
 * @param {Function} fn - Funktion die Learned Responses lädt
 * @param {string} query - Query
 * @param {Object} options - Optionen
 * @returns {Promise<*>}
 */
export async function getCachedLearnedResponses(fn, query, options = {}) {
  const cacheKey = `learned-responses:${query}:${JSON.stringify(options)}`;
  const ttl = SIMULATION_DEFAULTS.cache.learnedResponsesTTL;

  let responses = cache.get(cacheKey);
  if (responses) {
    return responses;
  }

  responses = await fn(query, options);
  cache.set(cacheKey, responses, ttl);

  return responses;
}
