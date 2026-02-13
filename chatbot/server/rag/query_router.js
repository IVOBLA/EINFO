// chatbot/server/rag/query_router.js
// Query-Router mit Intent Detection
// Leitet Anfragen an die passenden RAG-Systeme

import { getKnowledgeContextVector } from "./rag_vector.js";
import { getCurrentSession } from "./session_rag.js";
import { searchInRadius, geocodeAddress, findNearestLocations, findMunicipalityInQuery, getMunicipalityIndex, getGeoIndex, haversineDistance, formatDistance } from "./geo_search.js";
import { searchMemory } from "../memory_manager.js";
import { logDebug } from "../logger.js";
import { CONFIG } from "../config.js";

/**
 * Intent-Typen
 */
export const IntentTypes = {
  SEMANTIC: "semantic",              // Allgemeine semantische Suche
  GEO_RADIUS: "geo_radius",          // Radius-Suche um Punkt
  GEO_NEAREST: "geo_nearest",        // Nächste Locations
  GEO_NEAREST_POI: "geo_nearest_poi", // Nächste POI nach Kategorie (deterministisch)
  GEO_COUNT: "geo_count",            // Zähle Geo-Objekte (deterministisch)
  GEO_LIST: "geo_list",              // Liste Geo-Objekte (deterministisch)
  GEO_ADDRESS: "geo_address",        // Adresse suchen/geocoden
  RESOURCE: "resource",              // Ressourcen-Suche
  RELATIONAL: "relational",          // Beziehungs-Abfrage
  SESSION: "session",                // Aktuelle Session-Daten
  HYBRID: "hybrid"                   // Kombinierte Suche
};

const DEFAULT_GEO_CONFIG = {
  bboxFilterEnabled: true,
  bboxFilterMode: "both",
  bboxFilterDocTypes: ["address", "poi", "building"],
  geoScope: "BBOX"
};

const GEO_FILTER_MODES = new Set(["request_only", "auto_municipality", "both"]);
const GEO_FILTER_DOC_TYPES = new Set(["address", "poi", "building"]);
const GEO_SCOPES = new Set(["BBOX", "GLOBAL"]);

// ============================================================
// CATEGORY_KEYWORDS: Deutsch -> category_norm Mapping
// ============================================================
const CATEGORY_KEYWORDS = {
  krankenhaus: "amenity:hospital", spital: "amenity:hospital", klinik: "amenity:hospital",
  restaurant: "amenity:restaurant", gasthof: "amenity:restaurant", gasthaus: "amenity:restaurant",
  apotheke: "amenity:pharmacy", pharmacy: "amenity:pharmacy",
  polizei: "amenity:police", polizeistation: "amenity:police",
  feuerwehr: "amenity:fire_station", feuerwache: "amenity:fire_station",
  schule: "amenity:school", volksschule: "amenity:school",
  kindergarten: "amenity:kindergarten", kita: "amenity:kindergarten",
  kirche: "amenity:place_of_worship",
  tankstelle: "amenity:fuel",
  bank: "amenity:bank",
  post: "amenity:post_office", postamt: "amenity:post_office",
  hotel: "tourism:hotel", pension: "tourism:guest_house", unterkunft: "tourism:hotel",
  supermarkt: "shop:supermarket", lebensmittel: "shop:supermarket",
  "bäckerei": "shop:bakery", baeckerei: "shop:bakery", "bäcker": "shop:bakery",
  metzger: "shop:butcher", metzgerei: "shop:butcher", fleischer: "shop:butcher",
  arzt: "amenity:doctors", "hausarzt": "amenity:doctors", "ärztin": "amenity:doctors",
  zahnarzt: "amenity:dentist",
  "café": "amenity:cafe", cafe: "amenity:cafe", kaffeehaus: "amenity:cafe",
  parkplatz: "amenity:parking",
  spielplatz: "leisure:playground",
  sportplatz: "leisure:pitch",
  friedhof: "amenity:grave_yard",
  rathaus: "amenity:townhall", gemeindeamt: "amenity:townhall"
};

function extractCategoryFromQuery(query) {
  const lower = query.toLowerCase();
  for (const [keyword, categoryNorm] of Object.entries(CATEGORY_KEYWORDS)) {
    if (lower.includes(keyword)) {
      return { keyword, categoryNorm };
    }
  }
  return null;
}

function normalizeGeoConfig(geo) {
  const bboxFilterEnabled = typeof geo?.bboxFilterEnabled === "boolean"
    ? geo.bboxFilterEnabled
    : DEFAULT_GEO_CONFIG.bboxFilterEnabled;
  const bboxFilterMode = GEO_FILTER_MODES.has(geo?.bboxFilterMode)
    ? geo.bboxFilterMode
    : DEFAULT_GEO_CONFIG.bboxFilterMode;
  const docTypes = Array.isArray(geo?.bboxFilterDocTypes)
    ? geo.bboxFilterDocTypes.filter((type) => GEO_FILTER_DOC_TYPES.has(type))
    : [];
  const geoScope = GEO_SCOPES.has(geo?.geoScope)
    ? geo.geoScope
    : DEFAULT_GEO_CONFIG.geoScope;
  return {
    bboxFilterEnabled,
    bboxFilterMode,
    bboxFilterDocTypes: docTypes.length ? docTypes : [...DEFAULT_GEO_CONFIG.bboxFilterDocTypes],
    geoScope
  };
}

function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const parsed = bbox.map((value) => Number(value));
  if (parsed.some((value) => Number.isNaN(value))) return null;
  return parsed;
}

async function resolveMunicipalityBbox(municipality) {
  if (!municipality) return null;
  const index = await getMunicipalityIndex();
  const lower = municipality.toLowerCase();
  const entry = index.find((item) => item.municipality?.toLowerCase() === lower);
  return normalizeBbox(entry?.bbox);
}

/**
 * Prüft ob eine Anfrage Geo-Kontext hat
 */
export function hasGeoContext(query) {
  if (!query || typeof query !== "string") return false;
  const lower = query.toLowerCase();

  // Prüfe CATEGORY_KEYWORDS
  if (extractCategoryFromQuery(query)) return true;

  // Geo-Indikator-Keywords
  const geoIndicators = [
    /adresse/i, /straße/i, /strasse/i, /plz/i, /postleitzahl/i,
    /ort/i, /gemeinde/i, /stadt/i,
    /nächste/i, /naechste/i, /nähe/i,
    /wieviele/i, /wie viele/i, /anzahl/i,
    /wo ist/i, /wo sind/i, /wo befindet/i, /wo liegt/i,
    /gibt es .* in/i, /gibt es ein/i,
    /im umkreis/i, /im radius/i, /entfernung/i,
    /koordinaten/i, /standort/i,
    /gebäude/i, /gebaeude/i, /adressen/i
  ];

  return geoIndicators.some(pattern => pattern.test(lower));
}

function bboxCenter(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  return {
    lat: (bbox[1] + bbox[3]) / 2,
    lon: (bbox[0] + bbox[2]) / 2
  };
}

async function resolveBboxCandidate(query, context, taskGeo) {
  if (!taskGeo?.bboxFilterEnabled) return null;
  // geoScope=GLOBAL -> kein BBox-Filter
  if (taskGeo?.geoScope === "GLOBAL") return null;

  let bboxCandidate = null;
  const mode = taskGeo.bboxFilterMode;

  if ((mode === "request_only" || mode === "both") && context?.bbox) {
    bboxCandidate = normalizeBbox(context.bbox);
  }

  if (!bboxCandidate && (mode === "auto_municipality" || mode === "both")) {
    if (context?.municipality) {
      bboxCandidate = await resolveMunicipalityBbox(context.municipality);
    }
    if (!bboxCandidate) {
      const municipalityMatch = await findMunicipalityInQuery(query);
      bboxCandidate = normalizeBbox(municipalityMatch?.bbox);
    }
  }

  return bboxCandidate;
}

/**
 * Erkennt den Intent einer Anfrage
 * @param {string} query - Die Suchanfrage
 * @returns {object} - { type, params, confidence }
 */
export function detectIntent(query) {
  const lowerQuery = query.toLowerCase().trim();

  // ============================================================
  // Geo-Intent: Radius-Suche
  // ============================================================
  const radiusPatterns = [
    /im umkreis von (\d+(?:\.\d+)?)\s*(km|m|meter|kilometer)/i,
    /im radius von (\d+(?:\.\d+)?)\s*(km|m|meter|kilometer)/i,
    /(\d+(?:\.\d+)?)\s*(km|m|meter|kilometer)\s*(?:um|von|entfernt)/i
  ];

  for (const pattern of radiusPatterns) {
    const match = query.match(pattern);
    if (match) {
      let radius = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      if (unit === "m" || unit === "meter") {
        radius = radius / 1000; // Konvertiere zu km
      }
      return {
        type: IntentTypes.GEO_RADIUS,
        params: { radius },
        confidence: 0.9,
        pattern: pattern.source
      };
    }
  }

  // ============================================================
  // Geo-Intent: Deterministisch - GEO_COUNT
  // ============================================================
  if (/(wieviele|wie\s*viele|anzahl)/i.test(query)) {
    const catMatch = extractCategoryFromQuery(query);
    const docTypeFilter = /gebäude|gebaeude|building/i.test(query) ? "building"
      : /adresse[n]?/i.test(query) ? "address"
      : catMatch ? "poi" : null;
    return {
      type: IntentTypes.GEO_COUNT,
      params: {
        categoryNorm: catMatch?.categoryNorm || null,
        docTypeFilter: docTypeFilter || "poi",
        query: lowerQuery
      },
      confidence: 0.9,
      pattern: "geo_count"
    };
  }

  // ============================================================
  // Geo-Intent: Deterministisch - GEO_LIST
  // ============================================================
  if (/(alle|liste|sämtliche|saemtliche)/i.test(query)) {
    const catMatch = extractCategoryFromQuery(query);
    if (catMatch) {
      return {
        type: IntentTypes.GEO_LIST,
        params: { categoryNorm: catMatch.categoryNorm, query: lowerQuery },
        confidence: 0.88,
        pattern: "geo_list_alle"
      };
    }
  }

  // ============================================================
  // Geo-Intent: Nächste Location (mit Kategorie -> GEO_NEAREST_POI)
  // ============================================================
  const nearestPatterns = [
    /nächste[rns]?\s+(.+)/i,
    /wo ist (?:der |die |das )?nächste[rns]?\s+(.+)/i,
    /in der nähe von\s+(.+)/i,
    /nahe(?:gelegene?)?\s+(.+)/i
  ];

  for (const pattern of nearestPatterns) {
    const match = query.match(pattern);
    if (match) {
      const catMatch = extractCategoryFromQuery(query);
      if (catMatch) {
        return {
          type: IntentTypes.GEO_NEAREST_POI,
          params: { searchFor: match[1].trim(), categoryNorm: catMatch.categoryNorm },
          confidence: 0.92,
          pattern: "geo_nearest_poi"
        };
      }
      return {
        type: IntentTypes.GEO_NEAREST,
        params: { searchFor: match[1].trim() },
        confidence: 0.85,
        pattern: pattern.source
      };
    }
  }

  // ============================================================
  // Geo-Intent: Koordinaten im Query
  // ============================================================
  const coordPattern = /(\d{1,2}\.\d+)\s*[,;]\s*(\d{1,2}\.\d+)/;
  const coordMatch = query.match(coordPattern);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    // Prüfe ob plausible Koordinaten (Österreich-Bereich)
    if (lat >= 46 && lat <= 49 && lon >= 9 && lon <= 18) {
      return {
        type: IntentTypes.GEO_RADIUS,
        params: { lat, lon, radius: 1 }, // Default 1km
        confidence: 0.95,
        pattern: "coordinates"
      };
    }
  }

  // ============================================================
  // Geo-Intent: Adresssuche
  // ============================================================
  const addressPatterns = [
    /wo (?:ist|liegt|befindet sich)\s+(.+)/i,
    /adresse (?:von|für)\s+(.+)/i,
    /koordinaten (?:von|für)\s+(.+)/i,
    /finde[n]?\s+(.+straße|.+weg|.+gasse|.+platz)/i
  ];

  for (const pattern of addressPatterns) {
    const match = query.match(pattern);
    if (match) {
      return {
        type: IntentTypes.GEO_ADDRESS,
        params: { address: match[1].trim() },
        confidence: 0.8,
        pattern: pattern.source
      };
    }
  }

  // ============================================================
  // Ressourcen-Intent
  // ============================================================
  const resourcePatterns = [
    /wer hat (?:einen? |ein )?(.+)/i,
    /(?:bagger|lkw|kran|radlader|transporter|fahrzeug)/i,
    /(?:baufirma|erdbau|tiefbau|abbruch)/i,
    /ressource[n]?\s+(?:für|zum|zur)/i,
    /verfügbar[e]?\s+(.+)/i,
    /einsatzbereit[e]?\s+(.+)/i
  ];

  for (const pattern of resourcePatterns) {
    if (pattern.test(query)) {
      return {
        type: IntentTypes.RESOURCE,
        params: { query: lowerQuery },
        confidence: 0.75,
        pattern: pattern.source
      };
    }
  }

  // ============================================================
  // Beziehungs-Intent (Relational)
  // ============================================================
  const relationalPatterns = [
    /welche .+ sind .+ zugewiesen/i,
    /wer arbeitet an/i,
    /status von (?:einsatz|incident)/i,
    /einsatz #?(\d+)/i,
    /incident #?(\d+)/i,
    /aufgaben (?:von|für)\s+(.+)/i
  ];

  for (const pattern of relationalPatterns) {
    const match = query.match(pattern);
    if (match) {
      return {
        type: IntentTypes.RELATIONAL,
        params: { query: lowerQuery, match: match[1] },
        confidence: 0.8,
        pattern: pattern.source
      };
    }
  }

  // ============================================================
  // Session-Intent (aktuelle Einsatzdaten)
  // ============================================================
  const sessionPatterns = [
    /aktuelle[rns]?\s+(lage|situation|status)/i,
    /was (?:ist|war) (?:gerade|zuletzt)/i,
    /letzte[rns]?\s+(meldung|nachricht|update)/i,
    /offene[rns]?\s+(aufgaben|einsätze|incidents)/i
  ];

  for (const pattern of sessionPatterns) {
    if (pattern.test(query)) {
      return {
        type: IntentTypes.SESSION,
        params: { query: lowerQuery },
        confidence: 0.7,
        pattern: pattern.source
      };
    }
  }

  // ============================================================
  // Geo-Intent: "Gibt es in ... ein Restaurant" -> GEO_LIST
  // ============================================================
  if (/gibt es/i.test(query)) {
    const catMatch = extractCategoryFromQuery(query);
    if (catMatch) {
      return {
        type: IntentTypes.GEO_LIST,
        params: { categoryNorm: catMatch.categoryNorm, query: lowerQuery },
        confidence: 0.82,
        pattern: "geo_list_gibt_es"
      };
    }
  }

  // ============================================================
  // Default: Semantische Suche
  // ============================================================
  return {
    type: IntentTypes.SEMANTIC,
    params: { query: lowerQuery },
    confidence: 0.5,
    pattern: "default"
  };
}

/**
 * Routet eine Anfrage basierend auf dem erkannten Intent
 * @param {string} query - Die Suchanfrage
 * @param {object} context - Zusätzlicher Kontext
 * @returns {object} - { intent, results, context }
 */
export async function routeQuery(query, context = {}) {
  const intent = detectIntent(query);
  const taskKey = context?.taskType || "chat";
  const taskGeo = normalizeGeoConfig(CONFIG.llm.tasks?.[taskKey]?.geo);
  const bboxCandidate = await resolveBboxCandidate(query, context, taskGeo);
  const bboxFilter = taskGeo.bboxFilterEnabled && bboxCandidate
    ? {
      bbox: bboxCandidate,
      applyBbox: true,
      docTypes: taskGeo.bboxFilterDocTypes
    }
    : { applyBbox: false };

  if (taskGeo.bboxFilterEnabled && !bboxCandidate &&
      (taskGeo.bboxFilterMode === "auto_municipality" || taskGeo.bboxFilterMode === "both")) {
    logDebug("QueryRouter: BBOX filter enabled but no bbox resolved; falling back to unbounded retrieval", {
      bboxFilterMode: taskGeo.bboxFilterMode,
      query: query.slice(0, 80)
    });
  }

  logDebug("QueryRouter: Intent erkannt", {
    query: query.slice(0, 50),
    type: intent.type,
    confidence: intent.confidence,
    geoScope: taskGeo.geoScope,
    bboxActive: bboxFilter.applyBbox
  });

  const results = {
    intent,
    data: {},
    context: "",
    bboxFilter
  };

  try {
    switch (intent.type) {
      case IntentTypes.GEO_RADIUS:
        results.data = await handleGeoRadius(query, intent.params, context, bboxFilter);
        results.context = formatGeoContext(results.data);
        break;

      case IntentTypes.GEO_NEAREST:
        results.data = await handleGeoNearest(query, intent.params, context, bboxFilter);
        results.context = formatGeoContext(results.data);
        break;

      case IntentTypes.GEO_NEAREST_POI:
        results.data = await handleGeoNearestPoi(query, intent.params, context, bboxFilter);
        // count=0 ist ein gültiges deterministisches Ergebnis – kein Fallback auf semantische Suche
        results.context = formatGeoContext(results.data);
        break;

      case IntentTypes.GEO_COUNT:
        results.data = await handleGeoCount(query, intent.params, context, bboxFilter);
        results.context = formatGeoCountContext(results.data);
        break;

      case IntentTypes.GEO_LIST:
        results.data = await handleGeoList(query, intent.params, context, bboxFilter);
        // count=0 ist ein gültiges deterministisches Ergebnis – kein Fallback auf semantische Suche
        results.context = formatGeoContext(results.data);
        break;

      case IntentTypes.GEO_ADDRESS:
        results.data = await handleGeoAddress(intent.params.address, bboxFilter);
        results.context = formatGeoContext(results.data);
        break;

      case IntentTypes.RESOURCE:
        results.data = await handleResourceQuery(query, intent.params);
        results.context = formatResourceContext(results.data);
        break;

      case IntentTypes.RELATIONAL:
        results.data = await handleRelationalQuery(query, intent.params);
        results.context = formatRelationalContext(results.data);
        break;

      case IntentTypes.SESSION:
        results.data = await handleSessionQuery(query, intent.params);
        results.context = formatSessionContext(results.data);
        break;

      case IntentTypes.SEMANTIC:
      default:
        results.data = await handleSemanticQuery(query, context, bboxFilter);
        results.context = results.data.knowledge || "";
        break;
    }
  } catch (error) {
    logDebug("QueryRouter: Fehler", { error: String(error) });
    // Fallback auf semantische Suche
    results.data = await handleSemanticQuery(query, context, bboxFilter);
    results.context = results.data.knowledge || "";
  }

  return results;
}

// ============================================================
// Handler für verschiedene Intent-Typen
// ============================================================

async function handleGeoRadius(query, params, context, bboxFilter) {
  let { lat, lon, radius } = params;

  // Wenn keine Koordinaten angegeben, versuche aus Query zu extrahieren
  if (!lat || !lon) {
    // Versuche Adresse aus Query zu extrahieren
    const addressMatch = query.match(/(?:um|bei|von)\s+([^,]+(?:,\s*\d{4,5})?)/i);
    if (addressMatch) {
      const geocoded = await geocodeAddress(addressMatch[1], { applyBbox: false });
      if (geocoded.length > 0) {
        lat = geocoded[0].lat;
        lon = geocoded[0].lon;
      }
    }
  }

  // Fallback auf Feldkirchen Zentrum
  if (!lat || !lon) {
    lat = 46.7239;
    lon = 14.0947;
  }

  const locations = await searchInRadius(lat, lon, radius || 5, {
    limit: 20,
    ...bboxFilter
  });

  return {
    type: "geo_radius",
    center: { lat, lon },
    radius,
    locations,
    count: locations.length
  };
}

async function handleGeoNearest(query, params, context, bboxFilter) {
  const { searchFor } = params;

  // Versuche Typ zu erkennen
  let type = null;
  if (/hotel|unterkunft|pension/i.test(searchFor)) type = "hotel";
  if (/feuerwehr/i.test(searchFor)) type = "fire_station";
  if (/krankenhaus|spital/i.test(searchFor)) type = "hospital";
  if (/polizei/i.test(searchFor)) type = "police";
  if (/schule/i.test(searchFor)) type = "school";
  if (/kirche/i.test(searchFor)) type = "church";

  // Zentrum: Feldkirchen oder aus Context
  const lat = context.lat || 46.7239;
  const lon = context.lon || 14.0947;

  const locations = await findNearestLocations(lat, lon, 10, {
    type,
    namedOnly: true,
    ...bboxFilter
  });

  return {
    type: "geo_nearest",
    searchFor,
    filterType: type,
    locations,
    count: locations.length
  };
}

async function handleGeoAddress(address, bboxFilter) {
  const locations = await geocodeAddress(address, bboxFilter);

  return {
    type: "geo_address",
    query: address,
    locations,
    count: locations.length
  };
}

async function handleGeoNearestPoi(query, params, context, bboxFilter) {
  const { categoryNorm } = params;
  const geoIndex = await getGeoIndex();
  const candidates = await geoIndex.findByCategoryNorm(categoryNorm, {
    bbox: bboxFilter?.applyBbox ? bboxFilter.bbox : null
  });

  // Zentrum: BBox-Mitte oder Context oder Feldkirchen-Default
  const center = (bboxFilter?.applyBbox && bboxFilter.bbox)
    ? bboxCenter(bboxFilter.bbox)
    : { lat: context?.lat || 46.7239, lon: context?.lon || 14.0947 };

  // Haversine-Distanz berechnen und sortieren
  const withDistance = candidates.map(loc => {
    const dist = haversineDistance(center.lat, center.lon, loc.lat, loc.lon);
    return { ...loc, distance: dist, distanceFormatted: formatDistance(dist) };
  }).sort((a, b) => a.distance - b.distance);

  const top = withDistance.slice(0, 10);

  logDebug("GEO_NEAREST_POI", {
    categoryNorm,
    candidatesBefore: candidates.length,
    returned: top.length,
    bboxActive: bboxFilter?.applyBbox || false
  });

  return {
    type: "geo_nearest_poi",
    categoryNorm,
    locations: top,
    count: top.length
  };
}

async function handleGeoCount(query, params, context, bboxFilter) {
  const { categoryNorm, docTypeFilter } = params;
  const geoIndex = await getGeoIndex();

  let candidates;
  if (categoryNorm) {
    candidates = await geoIndex.findByCategoryNorm(categoryNorm, {
      bbox: bboxFilter?.applyBbox ? bboxFilter.bbox : null
    });
  } else {
    // Filter nach docType
    candidates = geoIndex.locations.filter(loc => {
      if (docTypeFilter && loc.doc_type !== docTypeFilter) return false;
      if (bboxFilter?.applyBbox && bboxFilter.bbox) {
        const [minLon, minLat, maxLon, maxLat] = bboxFilter.bbox;
        if (loc.lat < minLat || loc.lat > maxLat || loc.lon < minLon || loc.lon > maxLon) return false;
      }
      return true;
    });
  }

  logDebug("GEO_COUNT", {
    categoryNorm, docTypeFilter,
    count: candidates.length,
    bboxActive: bboxFilter?.applyBbox || false
  });

  return {
    type: "geo_count",
    categoryNorm,
    docTypeFilter,
    count: candidates.length,
    bboxActive: bboxFilter?.applyBbox || false,
    locations: candidates.slice(0, 5) // Beispiele
  };
}

async function handleGeoList(query, params, context, bboxFilter) {
  const { categoryNorm } = params;
  const geoIndex = await getGeoIndex();
  const candidates = await geoIndex.findByCategoryNorm(categoryNorm, {
    bbox: bboxFilter?.applyBbox ? bboxFilter.bbox : null
  });

  // Sortiert nach Distanz zum Zentrum
  const center = (bboxFilter?.applyBbox && bboxFilter.bbox)
    ? bboxCenter(bboxFilter.bbox)
    : { lat: context?.lat || 46.7239, lon: context?.lon || 14.0947 };

  const withDistance = candidates.map(loc => {
    const dist = haversineDistance(center.lat, center.lon, loc.lat, loc.lon);
    return { ...loc, distance: dist, distanceFormatted: formatDistance(dist) };
  }).sort((a, b) => a.distance - b.distance);

  const limited = withDistance.slice(0, 50);

  logDebug("GEO_LIST", {
    categoryNorm,
    total: candidates.length,
    returned: limited.length,
    bboxActive: bboxFilter?.applyBbox || false
  });

  return {
    type: "geo_list",
    categoryNorm,
    locations: limited,
    count: limited.length,
    totalAvailable: candidates.length
  };
}

async function handleResourceQuery(query, params) {
  // Ressourcen-Suche - aktuell über semantische Suche
  // Später: Dedicated Resource-DB

  const knowledge = await getKnowledgeContextVector(query);

  return {
    type: "resource",
    query: params.query,
    knowledge,
    note: "Ressourcen-Datenbank noch nicht implementiert"
  };
}

async function handleRelationalQuery(query, params) {
  // Session-Daten durchsuchen
  const session = getCurrentSession();
  const sessionResults = await session.search(query, { topK: 5 });

  // Memory durchsuchen
  const memoryResults = await searchMemory({
    query,
    topK: 5,
    maxAgeMinutes: CONFIG.memoryRag.maxAgeMinutes
  });

  return {
    type: "relational",
    sessionResults,
    memoryResults,
    totalResults: sessionResults.length + memoryResults.length
  };
}

async function handleSessionQuery(query, params) {
  const session = getCurrentSession();
  const results = await session.search(query, { topK: 10, minScore: 0.2 });
  const stats = session.getStats();

  return {
    type: "session",
    results,
    stats,
    count: results.length
  };
}

async function handleSemanticQuery(query, context, bboxFilter) {
  // Build structured filters from bboxFilter (geo-fence for semantic path)
  const filters = {};
  if (bboxFilter?.applyBbox && bboxFilter?.bbox) {
    filters.bbox = bboxFilter.bbox;
    filters.bboxDocTypes = bboxFilter.docTypes;
  }

  logDebug("handleSemanticQuery: BBOX-Status", {
    bboxActive: Boolean(filters.bbox),
    bbox: filters.bbox || null,
    docTypes: filters.bboxDocTypes || null
  });

  // Standard RAG-Suche (mit BBOX-Filter wenn aktiv)
  const knowledge = await getKnowledgeContextVector(query, { filters });

  // Zusätzlich Session-RAG
  const session = getCurrentSession();
  const sessionContext = await session.getContextForQuery(query, {
    maxChars: 1000,
    topK: 3
  });

  // Memory-RAG
  const memoryHits = await searchMemory({
    query,
    topK: 3,
    maxAgeMinutes: CONFIG.memoryRag.maxAgeMinutes
  });
  const memoryContext = memoryHits.map(h => h.text).join("\n");

  return {
    type: "semantic",
    knowledge,
    sessionContext,
    memoryContext
  };
}

// ============================================================
// Formatierung für LLM-Context
// ============================================================

function formatGeoContext(data) {
  if (!data.locations || data.locations.length === 0) {
    // Deterministisches Ergebnis: 0 gefunden ist valide Information
    const label = data.categoryNorm || data.type || "Objekte";
    return `### GEOGRAFISCHE ERGEBNISSE (0 gefunden) ###\n\n0 Ergebnisse für "${label}" im aktuellen Bereich. Dies ist ein gültiges deterministisches Ergebnis.\n`;
  }

  let context = `### GEOGRAFISCHE ERGEBNISSE (${data.count} gefunden) ###\n\n`;

  for (const loc of data.locations.slice(0, 10)) {
    const name = loc.name ? `**${loc.name}**: ` : "";
    const distance = loc.distanceFormatted ? ` (${loc.distanceFormatted})` : "";
    const type = loc.type ? ` [${loc.type}]` : "";

    context += `- ${name}${loc.address}${distance}${type}\n`;
    context += `  Koordinaten: ${loc.lat}, ${loc.lon}\n`;
  }

  return context;
}

function formatGeoCountContext(data) {
  const label = data.categoryNorm || data.docTypeFilter || "Objekte";
  const scope = data.bboxActive ? "BBOX" : "GLOBAL";

  logDebug("GEO_COUNT result (deterministic)", { count: data.count, scope, label });

  let context = `### GEO_COUNT ###\ncount: ${data.count}\nscope: ${scope}\nnote: ${data.count} ist ein gültiges deterministisches Ergebnis\n`;
  context += `\nEs gibt exakt ${data.count} Ergebnisse für "${label}"`;
  if (data.count > 0) {
    context += `.\n\nBeispiele:\n`;
    for (const loc of (data.locations || []).slice(0, 5)) {
      const name = loc.name ? `**${loc.name}**` : loc.address || "unbekannt";
      context += `- ${name} (${loc.lat}, ${loc.lon})\n`;
    }
  } else {
    context += ` im aktuellen Bereich. 0 ist ein gültiges Ergebnis – es wurden keine passenden Objekte gefunden.\n`;
  }
  return context;
}

function formatResourceContext(data) {
  if (data.note) {
    return `### RESSOURCEN ###\n${data.note}\n\n${data.knowledge || ""}`;
  }
  return data.knowledge || "";
}

function formatRelationalContext(data) {
  let context = "### AKTUELLE EINSATZDATEN ###\n\n";

  if (data.sessionResults && data.sessionResults.length > 0) {
    context += "**Session-Daten:**\n";
    for (const r of data.sessionResults) {
      context += `- [${r.meta?.type || "info"}] ${r.text}\n`;
    }
    context += "\n";
  }

  if (data.memoryResults && data.memoryResults.length > 0) {
    context += "**Aus Memory:**\n";
    for (const r of data.memoryResults) {
      context += `- ${r.text}\n`;
    }
  }

  return context;
}

function formatSessionContext(data) {
  let context = `### AKTUELLE SESSION (${data.stats?.totalItems || 0} Items) ###\n\n`;

  if (data.results && data.results.length > 0) {
    for (const r of data.results) {
      context += `- [${r.meta?.type || "info"}] ${r.text}\n`;
    }
  } else {
    context += "Keine relevanten Session-Daten gefunden.\n";
  }

  return context;
}

/**
 * Kombiniert alle Kontexte für LLM
 */
export async function getEnhancedContext(query, options = {}) {
  const { maxChars = 4000, rag } = options;
  // Prefer caller-supplied maxChars (from taskConfig.rag.totalMaxChars), fallback to 4000
  const effectiveMaxChars = rag?.totalMaxChars ?? maxChars;

  const routed = await routeQuery(query, { ...options });

  let context = "";

  // Spezifischer Context vom Router
  if (routed.context) {
    context += routed.context + "\n\n";
  }

  // Bei semantischer Suche: Zusätzliche Kontexte
  if (routed.intent.type === IntentTypes.SEMANTIC && routed.data) {
    if (routed.data.sessionContext) {
      context += routed.data.sessionContext + "\n\n";
    }
    if (routed.data.memoryContext) {
      context += "### AUS EINSATZ-MEMORY ###\n" + routed.data.memoryContext + "\n\n";
    }
  }

  // Kürzen falls zu lang
  if (context.length > effectiveMaxChars) {
    context = context.slice(0, effectiveMaxChars) + "\n... (gekürzt)";
  }

  return {
    context,
    intent: routed.intent,
    bboxFilter: routed.bboxFilter,
    stats: {
      contextLength: context.length,
      intentType: routed.intent.type,
      confidence: routed.intent.confidence
    }
  };
}

export default routeQuery;
