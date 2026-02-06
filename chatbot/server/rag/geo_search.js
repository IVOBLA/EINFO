// chatbot/server/rag/geo_search.js
// Geografische Suche mit Koordinaten (Haversine-Distanz)
// Ermöglicht Radius- und Bounding-Box-Suchen

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { logDebug, logInfo, logError } from "../logger.js";
import { normalizeJsonlRecord } from "./jsonl_utils.js";
import { CONFIG } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWLEDGE_DIR = path.resolve(__dirname, CONFIG.knowledgeDir);
const KNOWLEDGE_INDEX_DIR = path.resolve(__dirname, CONFIG.knowledgeIndexDir);

let municipalityIndexCache = null;
let municipalityIndexLoaded = false;

/**
 * Haversine-Formel zur Berechnung der Distanz zwischen zwei Koordinaten
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Distanz in Kilometern
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Erdradius in km
  const toRad = (deg) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Konvertiert Distanz in menschenlesbare Form
 */
export function formatDistance(km) {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

/**
 * GeoIndex Klasse
 * Lädt und indexiert Koordinaten aus der Knowledge-Base
 */
export class GeoIndex {
  constructor() {
    this.locations = [];
    this.municipalityIndex = [];
    this.loaded = false;
    this.lastLoadTime = null;
  }

  /**
   * Lädt Koordinaten aus allen Adress-Markdown-Dateien
   */
  async load() {
    if (this.loaded) return;

    try {
      const files = await fsPromises.readdir(KNOWLEDGE_DIR);
      const addressFiles = files.filter(f => f.startsWith("adressen_") && f.endsWith(".md"));
      const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));

      logInfo("GeoIndex: Lade Adressdateien", { fileCount: addressFiles.length });

      for (const file of addressFiles) {
        await this.parseAddressFile(path.join(KNOWLEDGE_DIR, file), file);
      }

      if (jsonlFiles.length) {
        logInfo("GeoIndex: Lade JSONL-Dateien", { fileCount: jsonlFiles.length });
        for (const file of jsonlFiles) {
          await this.parseJsonlFile(path.join(KNOWLEDGE_DIR, file), file);
        }
      }

      this.loaded = true;
      this.lastLoadTime = Date.now();

      logInfo("GeoIndex: Geladen", {
        locationCount: this.locations.length,
        files: addressFiles.length + jsonlFiles.length
      });
    } catch (error) {
      logError("GeoIndex: Ladefehler", { error: String(error) });
    }
  }

  /**
   * Parst eine einzelne Adress-Datei
   */
  async parseAddressFile(filePath, fileName) {
    try {
      const content = await fsPromises.readFile(filePath, "utf8");
      const lines = content.split("\n");

      // Pattern für Adressen mit Koordinaten:
      // - **Name**: Straße Nr, PLZ Ort (lat, lon) [type]
      // - Straße Nr, PLZ Ort (lat, lon)
      const namedPattern = /^- \*\*([^*]+)\*\*: ([^(]+)\((\d+\.\d+),\s*(\d+\.\d+)\)\s*(?:\[([^\]]+)\])?/;
      const simplePattern = /^- ([^(]+)\((\d+\.\d+),\s*(\d+\.\d+)\)/;

      for (const line of lines) {
        let match = line.match(namedPattern);

        if (match) {
          this.locations.push({
            name: match[1].trim(),
            address: match[2].trim(),
            lat: parseFloat(match[3]),
            lon: parseFloat(match[4]),
            type: match[5] || null,
            source: fileName,
            isNamedLocation: true
          });
          continue;
        }

        match = line.match(simplePattern);
        if (match) {
          const addressParts = match[1].trim();
          this.locations.push({
            name: null,
            address: addressParts,
            lat: parseFloat(match[2]),
            lon: parseFloat(match[3]),
            type: null,
            source: fileName,
            isNamedLocation: false
          });
        }
      }
    } catch (error) {
      logError("GeoIndex: Datei-Parsefehler", {
        file: fileName,
        error: String(error)
      });
    }
  }

  async parseJsonlFile(filePath, fileName) {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;

    for await (const line of rl) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        logError("GeoIndex: JSONL-Zeile konnte nicht geparsed werden", {
          file: fileName,
          line: lineNumber,
          error: String(error)
        });
        continue;
      }

      const record = normalizeJsonlRecord(parsed, trimmed);
      if (!record) continue;

      if (record.doc_type === "municipality_index" && record.geo?.bbox) {
        const municipality = record.address?.municipality || record.title;
        if (municipality) {
          this.municipalityIndex.push({
            municipality,
            bbox: record.geo.bbox,
            source: fileName,
            docId: record.doc_id
          });
        }
      }

      if (record.geo?.lat === undefined || record.geo?.lon === undefined) {
        continue;
      }

      const addressLine = record.address?.full
        || [record.address?.street, record.address?.housenumber, record.address?.city]
          .filter(Boolean)
          .join(" ")
          .trim();

      this.locations.push({
        id: record.doc_id,
        name: record.title || record.name || null,
        address: addressLine || record.address?.municipality || record.region || null,
        lat: Number(record.geo.lat),
        lon: Number(record.geo.lon),
        type: record.category || record.doc_type || null,
        source: fileName,
        isNamedLocation: Boolean(record.title || record.name)
      });
    }
  }

  /**
   * Sucht Locations im Radius um einen Punkt
   * @param {number} lat - Zentrum Latitude
   * @param {number} lon - Zentrum Longitude
   * @param {number} radiusKm - Radius in Kilometern
   * @param {object} options - Filter-Optionen
   */
  async searchRadius(lat, lon, radiusKm, options = {}) {
    await this.ensureLoaded();

    const { type = null, namedOnly = false, limit = 50, municipality = null, bbox = null } = options;

    let candidates = this.locations;
    const prefiltered = this.applyMunicipalityOrBboxFilter(candidates, { municipality, bbox });
    if (prefiltered) {
      candidates = prefiltered;
    }

    const results = [];

    for (const loc of candidates) {
      // Filter
      if (namedOnly && !loc.isNamedLocation) continue;
      if (type && loc.type !== type) continue;

      const distance = haversineDistance(lat, lon, loc.lat, loc.lon);

      if (distance <= radiusKm) {
        results.push({
          ...loc,
          distance,
          distanceFormatted: formatDistance(distance)
        });
      }
    }

    // Nach Distanz sortieren
    results.sort((a, b) => a.distance - b.distance);

    logDebug("GeoIndex: Radius-Suche", {
      center: `${lat}, ${lon}`,
      radius: `${radiusKm} km`,
      found: results.length
    });

    return results.slice(0, limit);
  }

  /**
   * Sucht Locations in einer Bounding Box
   */
  async searchBoundingBox(minLat, maxLat, minLon, maxLon, options = {}) {
    await this.ensureLoaded();

    const { type = null, namedOnly = false, limit = 100, municipality = null } = options;
    const bboxFilter = this.applyMunicipalityOrBboxFilter(this.locations, { municipality });
    const candidates = bboxFilter || this.locations;

    const results = [];

    for (const loc of candidates) {
      if (namedOnly && !loc.isNamedLocation) continue;
      if (type && loc.type !== type) continue;

      if (loc.lat >= minLat && loc.lat <= maxLat &&
          loc.lon >= minLon && loc.lon <= maxLon) {
        results.push(loc);
      }
    }

    logDebug("GeoIndex: BoundingBox-Suche", {
      bounds: `${minLat},${minLon} - ${maxLat},${maxLon}`,
      found: results.length
    });

    return results.slice(0, limit);
  }

  /**
   * Findet die nächsten Locations zu einem Punkt
   */
  async findNearest(lat, lon, limit = 5, options = {}) {
    await this.ensureLoaded();

    const { type = null, namedOnly = false, municipality = null, bbox = null } = options;

    const results = [];

    let candidates = this.locations;
    const prefiltered = this.applyMunicipalityOrBboxFilter(candidates, { municipality, bbox });
    if (prefiltered) {
      candidates = prefiltered;
    }

    for (const loc of candidates) {
      if (namedOnly && !loc.isNamedLocation) continue;
      if (type && loc.type !== type) continue;

      const distance = haversineDistance(lat, lon, loc.lat, loc.lon);
      results.push({
        ...loc,
        distance,
        distanceFormatted: formatDistance(distance)
      });
    }

    results.sort((a, b) => a.distance - b.distance);

    return results.slice(0, limit);
  }

  /**
   * Sucht nach Adresse und gibt Koordinaten zurück
   */
  async geocode(searchText) {
    await this.ensureLoaded();

    const searchLower = searchText.toLowerCase();
    const results = [];

    for (const loc of this.locations) {
      const addressLower = loc.address?.toLowerCase() || "";
      const nameLower = loc.name?.toLowerCase() || "";

      let score = 0;

      // Exakter Match
      if (addressLower === searchLower || nameLower === searchLower) {
        score = 1.0;
      }
      // Enthält Suchtext
      else if (addressLower.includes(searchLower) || nameLower.includes(searchLower)) {
        score = 0.8;
      }
      // Wörter matchen
      else {
        const searchWords = searchLower.split(/\s+/);
        const matchedWords = searchWords.filter(
          word => addressLower.includes(word) || nameLower.includes(word)
        );
        if (matchedWords.length > 0) {
          score = 0.5 * (matchedWords.length / searchWords.length);
        }
      }

      if (score > 0) {
        results.push({ ...loc, score });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 10);
  }

  /**
   * Gibt alle Locations eines bestimmten Typs zurück
   */
  async getByType(type) {
    await this.ensureLoaded();
    return this.locations.filter(loc => loc.type === type);
  }

  /**
   * Gibt Statistiken zurück
   */
  async getStats() {
    await this.ensureLoaded();

    const byType = {};
    const bySource = {};
    let namedCount = 0;

    for (const loc of this.locations) {
      const type = loc.type || "none";
      byType[type] = (byType[type] || 0) + 1;

      bySource[loc.source] = (bySource[loc.source] || 0) + 1;

      if (loc.isNamedLocation) namedCount++;
    }

    return {
      totalLocations: this.locations.length,
      namedLocations: namedCount,
      unnamedLocations: this.locations.length - namedCount,
      byType,
      sourceFiles: Object.keys(bySource).length,
      municipalityIndexCount: this.municipalityIndex.length
    };
  }

  applyMunicipalityOrBboxFilter(locations, { municipality = null, bbox = null } = {}) {
    if (!municipality && !bbox) return null;

    let effectiveBbox = bbox;
    if (!effectiveBbox && municipality && this.municipalityIndex.length) {
      const lower = municipality.toLowerCase();
      const hit = this.municipalityIndex.find(entry => entry.municipality?.toLowerCase() === lower);
      if (hit?.bbox) {
        effectiveBbox = hit.bbox;
      }
    }

    if (!effectiveBbox || effectiveBbox.length !== 4) return null;
    const [minLon, minLat, maxLon, maxLat] = effectiveBbox.map(Number);
    return locations.filter(loc =>
      loc.lat >= minLat &&
      loc.lat <= maxLat &&
      loc.lon >= minLon &&
      loc.lon <= maxLon
    );
  }

  /**
   * Stellt sicher, dass der Index geladen ist
   */
  async ensureLoaded() {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * Lädt den Index neu
   */
  async reload() {
    this.locations = [];
    this.loaded = false;
    await this.load();
  }
}

// ============================================================
// Singleton-Instanz
// ============================================================

let geoIndexInstance = null;

/**
 * Gibt die globale GeoIndex-Instanz zurück
 */
export async function getGeoIndex() {
  if (!geoIndexInstance) {
    geoIndexInstance = new GeoIndex();
    await geoIndexInstance.load();
  }
  return geoIndexInstance;
}

async function loadMunicipalityIndexFromDir(dirPath, entries) {
  if (!fs.existsSync(dirPath)) return;
  const files = await fsPromises.readdir(dirPath);
  const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));
  for (const file of jsonlFiles) {
    const filePath = path.join(dirPath, file);
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;

    for await (const line of rl) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        logError("MunicipalityIndex: JSONL-Zeile konnte nicht geparsed werden", {
          file,
          line: lineNumber,
          error: String(error)
        });
        continue;
      }

      const record = normalizeJsonlRecord(parsed, trimmed);
      if (!record) continue;
      if (record.doc_type !== "municipality_index" || !record.geo?.bbox) continue;

      const municipality = record.address?.municipality || record.title;
      if (!municipality) continue;

      entries.push({
        municipality,
        bbox: record.geo.bbox,
        stats: record.stats || null,
        source: file,
        docId: record.doc_id
      });
    }
  }
}

export async function getMunicipalityIndex() {
  if (municipalityIndexLoaded) return municipalityIndexCache || [];
  const entries = [];
  try {
    await loadMunicipalityIndexFromDir(KNOWLEDGE_DIR, entries);
    await loadMunicipalityIndexFromDir(KNOWLEDGE_INDEX_DIR, entries);
  } catch (error) {
    logError("MunicipalityIndex: Ladefehler", { error: String(error) });
  }
  municipalityIndexCache = entries;
  municipalityIndexLoaded = true;
  return municipalityIndexCache;
}

export async function findMunicipalityInQuery(query) {
  const index = await getMunicipalityIndex();
  if (!index.length) return null;
  const lower = query.toLowerCase();
  let bestMatch = null;
  for (const entry of index) {
    const name = entry.municipality?.toLowerCase();
    if (!name) continue;
    if (lower.includes(name)) {
      if (!bestMatch || name.length > bestMatch.municipality.length) {
        bestMatch = entry;
      }
    }
  }
  return bestMatch;
}

/**
 * Shortcut für Radius-Suche
 */
export async function searchInRadius(lat, lon, radiusKm, options = {}) {
  const index = await getGeoIndex();
  return index.searchRadius(lat, lon, radiusKm, options);
}

/**
 * Shortcut für Geocoding
 */
export async function geocodeAddress(searchText) {
  const index = await getGeoIndex();
  return index.geocode(searchText);
}

/**
 * Shortcut für nächste Locations
 */
export async function findNearestLocations(lat, lon, limit = 5, options = {}) {
  const index = await getGeoIndex();
  return index.findNearest(lat, lon, limit, options);
}

export default GeoIndex;
