// chatbot/server/rag/geo_scope.js
// Zentrale Geo-Scope-Logik: Entscheidet ob BBox-Filter angewendet werden soll
// und löst den Einsatz-Center-Point auf (Einsatzstellen > BBox > Fallback)

import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { logDebug } from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOARD_FILE = path.resolve(__dirname, "../../../server/data/board.json");

// ============================================================
// 1) detectExplicitScope — Erkennt ob die Frage lokal/global ist
// ============================================================

const LOCAL_PATTERNS = [
  /im einsatzbereich/i,
  /im einsatzgebiet/i,
  /innerhalb/i,
  /in der bbox/i,
  /nahe dem einsatz/i,
  /nächste[rns]?\b/i,
  /naechste[rns]?\b/i,
  /in der nähe/i,
  /in der naehe/i,
  /umgebung/i,
  /radius/i,
  /wie viele .* im bereich/i,
  /wieviele .* im bereich/i,
  /im bereich/i,
  /im umkreis/i,
];

const GLOBAL_PATTERNS = [
  /österreichweit/i,
  /oesterreichweit/i,
  /bundesweit/i,
  /in kärnten/i,
  /in kaernten/i,
  /allgemein\b/i,
  /außerhalb/i,
  /ausserhalb/i,
  /nicht nur einsatzbereich/i,
  /unabhängig vom einsatz/i,
  /unabhaengig vom einsatz/i,
  /überregional/i,
  /ueberregional/i,
];

/**
 * Erkennt ob die Frage explizit lokal oder global formuliert ist.
 * @param {string} question
 * @returns {{ mode: 'LOCAL'|'GLOBAL'|'AUTO', reason: string }}
 */
export function detectExplicitScope(question) {
  if (!question || typeof question !== "string") {
    return { mode: "AUTO", reason: "no_question" };
  }

  const lower = question.toLowerCase();

  for (const pattern of LOCAL_PATTERNS) {
    if (pattern.test(lower)) {
      return { mode: "LOCAL", reason: `local_keyword: ${pattern.source}` };
    }
  }

  for (const pattern of GLOBAL_PATTERNS) {
    if (pattern.test(lower)) {
      return { mode: "GLOBAL", reason: `global_keyword: ${pattern.source}` };
    }
  }

  return { mode: "AUTO", reason: "no_explicit_scope" };
}

// ============================================================
// 2) shouldApplyGeoFence — Zentrale Entscheidung ob BBox aktiv
// ============================================================

// Intent-Typen die immer geo-gefenced werden (sofern nicht GLOBAL)
const GEO_INTENTS = new Set([
  "geo_radius",
  "geo_nearest",
  "geo_nearest_poi",
  "geo_count",
  "geo_list",
  "geo_address",
  "geo_provider_search",
]);

/**
 * Entscheidet ob der BBox-Filter angewendet werden soll.
 * @param {object} params
 * @param {string} params.question - Die Benutzeranfrage
 * @param {string} params.intent - Der erkannte Intent-Typ (z.B. "geo_nearest_poi")
 * @param {boolean} params.hasGeoContext - Ob die Frage Geo-Kontext hat (aus hasGeoContext())
 * @param {{ mode: string }} params.explicitScope - Ergebnis von detectExplicitScope()
 * @returns {boolean}
 */
export function shouldApplyGeoFence({ question, intent, hasGeoContext, explicitScope }) {
  // GLOBAL übersteuert alles → kein BBox
  if (explicitScope?.mode === "GLOBAL") {
    return false;
  }

  // LOCAL explizit → BBox aktiv
  if (explicitScope?.mode === "LOCAL") {
    return true;
  }

  // Geo-Intent → BBox aktiv
  if (intent && GEO_INTENTS.has(intent)) {
    return true;
  }

  // hasGeoContext → BBox aktiv
  if (hasGeoContext) {
    return true;
  }

  // Default: kein BBox (z.B. semantische Suche ohne Geo-Bezug)
  return false;
}

// ============================================================
// 3) resolveCenterPoint — Einsatz-Zentrum ermitteln
// ============================================================

const FALLBACK_CENTER = { lat: 46.7239, lon: 14.0947 }; // Feldkirchen

/**
 * Liest Einsatzstellen-Koordinaten aus dem Einsatzboard (board.json).
 * @returns {Promise<Array<{lat: number, lon: number}>>}
 */
async function readEinsatzstellenCoordinates() {
  try {
    const raw = await fsPromises.readFile(BOARD_FILE, "utf8");
    const board = JSON.parse(raw);
    const points = [];

    // Board hat columns mit items
    if (board?.columns) {
      for (const column of Object.values(board.columns)) {
        if (!Array.isArray(column.items)) continue;
        for (const item of column.items) {
          const lat = Number(item.latitude);
          const lon = Number(item.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
            points.push({ lat, lon });
          }
        }
      }
    }

    return points;
  } catch {
    return [];
  }
}

/**
 * Berechnet den Centroid (Schwerpunkt) aus mehreren Koordinaten.
 * @param {Array<{lat: number, lon: number}>} points
 * @returns {{lat: number, lon: number}}
 */
function computeCentroid(points) {
  if (!points.length) return null;
  const sumLat = points.reduce((s, p) => s + p.lat, 0);
  const sumLon = points.reduce((s, p) => s + p.lon, 0);
  return {
    lat: sumLat / points.length,
    lon: sumLon / points.length,
  };
}

/**
 * Berechnet den Center einer BBox [minLon, minLat, maxLon, maxLat].
 * @param {number[]} bbox
 * @returns {{lat: number, lon: number}|null}
 */
function bboxCenter(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const nums = bbox.map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;
  return {
    lat: (nums[1] + nums[3]) / 2,
    lon: (nums[0] + nums[2]) / 2,
  };
}

/**
 * Löst den zentralen Referenzpunkt für Distanzberechnungen auf.
 *
 * Priorität:
 * 1. Einsatzstellen-Koordinaten aus Einsatzboard (Centroid)
 * 2. BBox-Center (wenn BBox vorhanden)
 * 3. Fallback (Feldkirchen)
 *
 * @param {object} params
 * @param {object} [params.scenarioConfig] - Szenario-Konfiguration (inkl. bbox)
 * @param {object} [params.einsatzboardData] - Einsatzboard JSON (optional, wird sonst gelesen)
 * @param {number[]} [params.requestBbox] - BBox aus dem Request
 * @returns {Promise<{lat: number, lon: number, source: 'EINSATZSTELLEN'|'BBOX'|'FALLBACK'}>}
 */
export async function resolveCenterPoint({ scenarioConfig, einsatzboardData, requestBbox } = {}) {
  // 1. Einsatzstellen-Koordinaten
  const einsatzstellen = einsatzboardData?.points || await readEinsatzstellenCoordinates();
  if (einsatzstellen.length > 0) {
    const centroid = computeCentroid(einsatzstellen);
    if (centroid) {
      logDebug("resolveCenterPoint: Einsatzstellen-Centroid", {
        pointCount: einsatzstellen.length,
        lat: centroid.lat.toFixed(6),
        lon: centroid.lon.toFixed(6),
      });
      return { ...centroid, source: "EINSATZSTELLEN" };
    }
  }

  // 2. BBox-Center
  const bbox = requestBbox || scenarioConfig?.bbox;
  const center = bboxCenter(bbox);
  if (center) {
    logDebug("resolveCenterPoint: BBox-Center", {
      bbox,
      lat: center.lat.toFixed(6),
      lon: center.lon.toFixed(6),
    });
    return { ...center, source: "BBOX" };
  }

  // 3. Fallback
  logDebug("resolveCenterPoint: Fallback (Feldkirchen)");
  return { ...FALLBACK_CENTER, source: "FALLBACK" };
}
