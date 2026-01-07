// chatbot/server/rag/geo_search.js
// Geografische Suche mit Koordinaten (Haversine-Distanz)
// Ermöglicht Radius- und Bounding-Box-Suchen

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { logDebug, logInfo, logError } from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWLEDGE_DIR = path.resolve(__dirname, "../../knowledge");

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

      logInfo("GeoIndex: Lade Adressdateien", { fileCount: addressFiles.length });

      for (const file of addressFiles) {
        await this.parseAddressFile(path.join(KNOWLEDGE_DIR, file), file);
      }

      this.loaded = true;
      this.lastLoadTime = Date.now();

      logInfo("GeoIndex: Geladen", {
        locationCount: this.locations.length,
        files: addressFiles.length
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

  /**
   * Sucht Locations im Radius um einen Punkt
   * @param {number} lat - Zentrum Latitude
   * @param {number} lon - Zentrum Longitude
   * @param {number} radiusKm - Radius in Kilometern
   * @param {object} options - Filter-Optionen
   */
  async searchRadius(lat, lon, radiusKm, options = {}) {
    await this.ensureLoaded();

    const { type = null, namedOnly = false, limit = 50 } = options;

    const results = [];

    for (const loc of this.locations) {
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

    const { type = null, namedOnly = false, limit = 100 } = options;

    const results = [];

    for (const loc of this.locations) {
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

    const { type = null, namedOnly = false } = options;

    const results = [];

    for (const loc of this.locations) {
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
      sourceFiles: Object.keys(bySource).length
    };
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
