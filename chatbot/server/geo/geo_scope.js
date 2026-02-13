// chatbot/server/geo/geo_scope.js
// Erweiterte Geo-Scope-Logik für PostGIS-Integration
// Ergänzt die bestehende rag/geo_scope.js um PostGIS-spezifische Funktionen

import { logDebug } from "../logger.js";
import { findMunicipality } from "./postgis_geo.js";
import {
  detectExplicitScope as baseDetectExplicitScope,
  shouldApplyGeoFence as baseShouldApplyGeoFence,
  resolveCenterPoint as baseResolveCenterPoint,
} from "../rag/geo_scope.js";

// Re-export base functions for convenience
export { baseDetectExplicitScope as detectExplicitScope };
export { baseShouldApplyGeoFence as shouldApplyGeoFence };
export { baseResolveCenterPoint as resolveCenterPoint };

// ============================================================
// Municipality Scope Detection
// ============================================================

// Pattern: "in <Gemeindename>", "für <Gemeindename>", "Gemeinde <Name>"
const MUNICIPALITY_PATTERNS = [
  /(?:in|für|fuer|bei)\s+(?:der\s+)?(?:gemeinde\s+)?([A-ZÄÖÜ][a-zäöüß]+(?:\s+(?:an\s+der|im|am|ob)\s+[A-ZÄÖÜ][a-zäöüß]+)?)/,
  /(?:gemeinde|marktgemeinde|stadtgemeinde|stadt)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+(?:an\s+der|im|am|ob)\s+[A-ZÄÖÜ][a-zäöüß]+)?)/i,
];

/**
 * Erkennt ob die Frage einen Gemeinde-Scope hat.
 * @param {string} question
 * @returns {{ municipalityName: string|null, pattern: string|null }}
 */
export function detectMunicipalityScope(question) {
  if (!question || typeof question !== "string") {
    return { municipalityName: null, pattern: null };
  }

  for (const pattern of MUNICIPALITY_PATTERNS) {
    const match = question.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Ignoriere offensichtliche Fehl-Treffer (sehr kurze Wörter etc.)
      if (name.length < 3) continue;
      return { municipalityName: name, pattern: pattern.source };
    }
  }

  return { municipalityName: null, pattern: null };
}

/**
 * Löst den Gemeinde-Scope auf: Prüft ob die erkannte Gemeinde in PostGIS existiert.
 * @param {string} municipalityName
 * @returns {Promise<{name:string, bbox:number[], center:{lat:number,lon:number}}|null>}
 */
export async function resolveMunicipalityScope(municipalityName) {
  if (!municipalityName) return null;

  try {
    const result = await findMunicipality(municipalityName);
    if (result) {
      logDebug("GeoScope: Gemeinde aufgelöst", {
        input: municipalityName,
        resolved: result.name,
        bbox: result.bbox,
      });
    }
    return result;
  } catch (err) {
    logDebug("GeoScope: Gemeinde-Auflösung fehlgeschlagen", {
      name: municipalityName,
      error: String(err),
    });
    return null;
  }
}

// ============================================================
// Radius Extraction
// ============================================================

/**
 * Extrahiert einen expliziten Radius aus der Frage.
 * @param {string} question
 * @returns {{ radiusM: number|null, raw: string|null }}
 */
export function extractRadius(question) {
  if (!question) return { radiusM: null, raw: null };

  const patterns = [
    /im umkreis von (\d+(?:[.,]\d+)?)\s*(km|m|meter|kilometer)/i,
    /im radius von (\d+(?:[.,]\d+)?)\s*(km|m|meter|kilometer)/i,
    /(\d+(?:[.,]\d+)?)\s*(km|m|meter|kilometer)\s*(?:um|von|entfernt|radius)/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match) {
      let value = parseFloat(match[1].replace(",", "."));
      const unit = match[2].toLowerCase();
      if (unit === "km" || unit === "kilometer") {
        value = value * 1000; // -> Meter
      }
      return { radiusM: Math.round(value), raw: match[0] };
    }
  }

  return { radiusM: null, raw: null };
}

/**
 * Bestimmt den effektiven Scope für eine Geo-Abfrage.
 * Kombiniert expliziten Scope, Municipality-Erkennung und BBox.
 *
 * @param {object} params
 * @param {string} params.question
 * @param {string} params.intent
 * @param {boolean} params.hasGeoContext
 * @param {number[]} [params.bbox]
 * @param {object} [params.scenarioConfig]
 * @returns {Promise<object>}
 */
export async function resolveFullGeoScope({ question, intent, hasGeoContext, bbox, scenarioConfig }) {
  const explicitScope = baseDetectExplicitScope(question);
  const geoFenceActive = baseShouldApplyGeoFence({ question, intent, hasGeoContext, explicitScope });

  // Municipality scope
  const { municipalityName } = detectMunicipalityScope(question);
  let municipalityScope = null;
  if (municipalityName) {
    municipalityScope = await resolveMunicipalityScope(municipalityName);
  }

  // Radius
  const { radiusM } = extractRadius(question);

  // Center point
  const center = await baseResolveCenterPoint({ scenarioConfig, requestBbox: bbox });

  // Effektive BBox bestimmen
  let effectiveBbox = null;
  if (municipalityScope) {
    effectiveBbox = municipalityScope.bbox;
  } else if (geoFenceActive && bbox) {
    effectiveBbox = bbox;
  }

  return {
    explicitScope,
    geoFenceActive,
    municipalityScope,
    municipalityName: municipalityScope?.name || municipalityName || null,
    radiusM,
    center,
    effectiveBbox,
    useMunicipality: !!municipalityScope,
    useRadius: !!radiusM,
    useBbox: !!effectiveBbox && !municipalityScope,
  };
}
