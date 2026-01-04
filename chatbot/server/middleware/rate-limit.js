// chatbot/server/middleware/rate-limit.js
// Rate Limiting Middleware zum Schutz vor Missbrauch

import { logDebug, logError } from "../logger.js";

const rateLimitStore = new Map();
const CLEANUP_INTERVAL_MS = 60000; // Cleanup alle 60 Sekunden

/**
 * Erstellt eine Rate-Limiting-Middleware
 * @param {Object} options - Konfiguration
 * @param {number} options.maxRequests - Maximale Anzahl Requests pro Zeitfenster (default: 30)
 * @param {number} options.windowMs - Zeitfenster in Millisekunden (default: 60000 = 1 Minute)
 * @param {string} options.message - Custom Error-Message
 * @returns {Function} Express Middleware
 */
export function rateLimit(options = {}) {
  const {
    maxRequests = 30,
    windowMs = 60000,
    message = "Too many requests from this IP, please try again later."
  } = options;

  return (req, res, next) => {
    // IP-Adresse ermitteln (berücksichtigt Proxies)
    const ip =
      req.ip ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.connection.remoteAddress ||
      'unknown';

    const now = Date.now();
    const key = `${ip}:${req.path}`;

    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
        firstRequest: now
      });

      logDebug("Rate Limit - Neuer Client", {
        ip,
        path: req.path,
        limit: `${maxRequests}/${windowMs}ms`
      });

      return next();
    }

    const record = rateLimitStore.get(key);

    // Zeitfenster abgelaufen → zurücksetzen
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
      record.firstRequest = now;
      return next();
    }

    // Limit erreicht
    if (record.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);

      logError("Rate Limit überschritten", {
        ip,
        path: req.path,
        count: record.count,
        limit: maxRequests,
        retryAfter: retryAfterSeconds
      });

      // Rate-Limit-Headers setzen (RFC 6585)
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);

      return res.status(429).json({
        ok: false,
        error: 'rate_limit_exceeded',
        message,
        retryAfter: retryAfterSeconds,
        limit: {
          maxRequests,
          windowMs,
          currentCount: record.count
        }
      });
    }

    // Request zählen
    record.count++;

    // Headers mit verbleibenden Requests
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - record.count);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    next();
  };
}

/**
 * Cleanup-Funktion: Entfernt abgelaufene Einträge aus dem Store
 */
function cleanupExpiredRecords() {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime + 60000) { // 1 Minute Grace Period
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logDebug("Rate Limit Store bereinigt", {
      cleaned,
      remaining: rateLimitStore.size
    });
  }
}

// Cleanup-Interval starten
setInterval(cleanupExpiredRecords, CLEANUP_INTERVAL_MS);

/**
 * Vordefinierte Rate-Limit-Profile
 */
export const RateLimitProfiles = {
  // Streng für Test-Endpoints
  STRICT: { maxRequests: 10, windowMs: 60000 },

  // Standard für API-Endpoints
  STANDARD: { maxRequests: 30, windowMs: 60000 },

  // Großzügig für Chat
  GENEROUS: { maxRequests: 60, windowMs: 60000 },

  // Sehr streng für Admin-Funktionen
  ADMIN: { maxRequests: 5, windowMs: 60000 }
};

/**
 * Gibt aktuelle Rate-Limit-Statistiken zurück
 * @returns {Object} Statistiken
 */
export function getRateLimitStats() {
  const stats = {
    totalClients: rateLimitStore.size,
    clients: []
  };

  for (const [key, record] of rateLimitStore.entries()) {
    stats.clients.push({
      key,
      count: record.count,
      resetIn: Math.max(0, Math.ceil((record.resetTime - Date.now()) / 1000))
    });
  }

  return stats;
}

/**
 * Setzt Rate-Limit für bestimmten Client zurück (z.B. nach Login)
 * @param {string} ip - IP-Adresse
 * @param {string} path - Pfad (optional)
 */
export function resetRateLimit(ip, path = null) {
  if (path) {
    const key = `${ip}:${path}`;
    rateLimitStore.delete(key);
    logDebug("Rate Limit zurückgesetzt", { ip, path });
  } else {
    let count = 0;
    for (const key of rateLimitStore.keys()) {
      if (key.startsWith(`${ip}:`)) {
        rateLimitStore.delete(key);
        count++;
      }
    }
    logDebug("Rate Limit zurückgesetzt (alle Pfade)", { ip, count });
  }
}
