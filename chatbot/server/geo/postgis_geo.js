// chatbot/server/geo/postgis_geo.js
// PostGIS-Client für Live-Geo-Abfragen aus OSM-Daten
// Verwendet die Views aus feldkirchen-adressen/postgis_pipeline/06_create_views.sql

import pg from "pg";
import { logDebug, logError, logInfo } from "../logger.js";

const { Pool } = pg;

// ============================================================
// Connection Pool (Singleton)
// ============================================================

let pool = null;
let connectionChecked = false;
let connectionAvailable = false;

function getPool() {
  if (pool) return pool;

  const pgUrl = process.env.EINFO_PG_URL;

  if (pgUrl) {
    pool = new Pool({ connectionString: pgUrl, max: 5 });
  } else {
    const host = process.env.EINFO_DB_HOST || "localhost";
    const port = parseInt(process.env.EINFO_DB_PORT || "5432", 10);
    const database = process.env.EINFO_DB_NAME || "einfo_osm";
    const user = process.env.EINFO_DB_USER || "einfo";
    const password = process.env.EINFO_DB_PASS;

    if (!password) {
      logDebug("PostGIS: Kein EINFO_DB_PASS oder EINFO_PG_URL gesetzt — PostGIS deaktiviert");
      return null;
    }

    pool = new Pool({ host, port, database, user, password, max: 5 });
  }

  pool.on("error", (err) => {
    logError("PostGIS Pool-Fehler", { error: String(err) });
  });

  return pool;
}

/**
 * Prüft ob PostGIS verfügbar ist.
 * Ergebnis wird gecacht.
 */
export async function isPostgisAvailable() {
  if (connectionChecked) return connectionAvailable;

  const p = getPool();
  if (!p) {
    connectionChecked = true;
    connectionAvailable = false;
    return false;
  }

  try {
    const res = await p.query("SELECT 1 AS ok");
    connectionAvailable = res.rows[0]?.ok === 1;
    connectionChecked = true;
    if (connectionAvailable) {
      logInfo("PostGIS: Verbindung hergestellt");
    }
    return connectionAvailable;
  } catch (err) {
    logError("PostGIS: Verbindung fehlgeschlagen", { error: String(err) });
    connectionChecked = true;
    connectionAvailable = false;
    return false;
  }
}

/**
 * Setzt den Connection-Check zurück (z.B. nach Config-Änderung).
 */
export function resetConnectionCheck() {
  connectionChecked = false;
  connectionAvailable = false;
}

// ============================================================
// Helper
// ============================================================

function buildBboxCondition(paramIndex, prefix = "geom") {
  // ST_MakeEnvelope($i, $i+1, $i+2, $i+3, 4326)
  return `${prefix} && ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326)`;
}

function buildRadiusCondition(geoCol, ptParamIdx, radiusParamIdx) {
  // ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($lon, $lat), 4326)::geography, $radiusM)
  return `ST_DWithin(${geoCol}::geography, ST_SetSRID(ST_MakePoint($${ptParamIdx}, $${ptParamIdx + 1}), 4326)::geography, $${radiusParamIdx})`;
}

function buildDistanceExpr(geoCol, ptParamIdx) {
  return `ST_Distance(${geoCol}::geography, ST_SetSRID(ST_MakePoint($${ptParamIdx}, $${ptParamIdx + 1}), 4326)::geography)`;
}

// ============================================================
// Geo-Abfragen
// ============================================================

/**
 * Nächste POIs nach Kategorie, sortiert nach Distanz.
 *
 * @param {object} params
 * @param {string[]} params.categoryNorms - z.B. ["amenity:hospital"]
 * @param {{lat:number, lon:number}} params.center
 * @param {number[]} [params.bbox] - [minLon, minLat, maxLon, maxLat]
 * @param {number} [params.limit=10]
 * @returns {Promise<Array>}
 */
export async function nearestPoi({ categoryNorms, center, bbox, limit = 10 }) {
  const p = getPool();
  if (!p) return [];

  const params = [];
  const conditions = [];

  // Category filter
  if (categoryNorms && categoryNorms.length > 0) {
    params.push(categoryNorms);
    conditions.push(`category_norm = ANY($${params.length})`);
  }

  // Center for distance
  params.push(center.lon); // $N
  const lonIdx = params.length;
  params.push(center.lat); // $N+1
  const latIdx = params.length;

  // BBox filter
  if (bbox && bbox.length === 4) {
    const bboxStart = params.length + 1;
    params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    conditions.push(buildBboxCondition(bboxStart));
  }

  const distExpr = buildDistanceExpr("geom", lonIdx);
  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  params.push(limit);
  const limitIdx = params.length;

  const sql = `
    SELECT
      osm_id, osm_type, name, category_norm,
      street, housenumber, postcode, city, address_full,
      municipality, lat, lon, tags_json,
      ${distExpr} AS distance_m
    FROM einfo.poi_src
    ${whereClause}
    ORDER BY ${distExpr} ASC
    LIMIT $${limitIdx}
  `;

  try {
    const res = await p.query(sql, params);
    return res.rows.map(formatPoiRow);
  } catch (err) {
    logError("PostGIS nearestPoi Fehler", { error: String(err) });
    return [];
  }
}

/**
 * Liste POIs in bbox/radius/municipality.
 */
export async function listPoi({ categoryNorms, center, bbox, radiusM, municipalityName, limit = 50 }) {
  const p = getPool();
  if (!p) return [];

  const params = [];
  const conditions = [];

  if (categoryNorms && categoryNorms.length > 0) {
    params.push(categoryNorms);
    conditions.push(`category_norm = ANY($${params.length})`);
  }

  if (municipalityName) {
    params.push(municipalityName);
    conditions.push(`LOWER(municipality) = LOWER($${params.length})`);
  }

  // Distance center (optional, for sorting)
  let distExpr = "0";
  let lonIdx = null;
  if (center) {
    params.push(center.lon);
    lonIdx = params.length;
    params.push(center.lat);
    distExpr = buildDistanceExpr("geom", lonIdx);
  }

  if (bbox && bbox.length === 4) {
    const bboxStart = params.length + 1;
    params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    conditions.push(buildBboxCondition(bboxStart));
  }

  if (radiusM && center && lonIdx) {
    params.push(radiusM);
    conditions.push(buildRadiusCondition("geom", lonIdx, params.length));
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  params.push(limit);
  const limitIdx = params.length;

  const sql = `
    SELECT
      osm_id, osm_type, name, category_norm,
      street, housenumber, postcode, city, address_full,
      municipality, lat, lon, tags_json,
      ${distExpr} AS distance_m
    FROM einfo.poi_src
    ${whereClause}
    ORDER BY ${center ? distExpr + " ASC" : "name ASC"}
    LIMIT $${limitIdx}
  `;

  try {
    const res = await p.query(sql, params);
    return res.rows.map(formatPoiRow);
  } catch (err) {
    logError("PostGIS listPoi Fehler", { error: String(err) });
    return [];
  }
}

/**
 * Zählt Gebäude in bbox/radius/municipality.
 */
export async function countBuildings({ bbox, radiusM, center, municipalityName }) {
  const p = getPool();
  if (!p) return { count: 0, scope: "unknown", error: "PostGIS nicht verfügbar" };

  const params = [];
  const conditions = [];
  let scope = "global";

  if (municipalityName) {
    params.push(municipalityName);
    conditions.push(`LOWER(municipality) = LOWER($${params.length})`);
    scope = `municipality:${municipalityName}`;
  }

  if (bbox && bbox.length === 4) {
    const bboxStart = params.length + 1;
    params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    conditions.push(buildBboxCondition(bboxStart));
    scope = "bbox";
  }

  if (radiusM && center) {
    params.push(center.lon);
    const lonIdx = params.length;
    params.push(center.lat);
    params.push(radiusM);
    conditions.push(buildRadiusCondition("geom", lonIdx, params.length));
    scope = `radius:${radiusM}m`;
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const sql = `SELECT count(*) AS cnt FROM einfo.building_src ${whereClause}`;

  try {
    const res = await p.query(sql, params);
    const count = parseInt(res.rows[0]?.cnt || "0", 10);
    return { count, scope };
  } catch (err) {
    logError("PostGIS countBuildings Fehler", { error: String(err) });
    return { count: 0, scope, error: String(err) };
  }
}

/**
 * Sucht Provider/Ressourcen (Bagger, Busse, Baufirmen, etc.)
 */
export async function searchProviders({ queryText, providerTypes, center, bbox, radiusM, municipalityName, limit = 15 }) {
  const p = getPool();
  if (!p) return [];

  const params = [];
  const conditions = [];

  // Keyword-Match auf match_text
  if (queryText) {
    params.push(`%${queryText.toLowerCase()}%`);
    conditions.push(`match_text ILIKE $${params.length}`);
  }

  // Provider-Type filter
  if (providerTypes && providerTypes.length > 0) {
    params.push(providerTypes);
    conditions.push(`provider_type_norm = ANY($${params.length})`);
  }

  if (municipalityName) {
    params.push(municipalityName);
    conditions.push(`LOWER(municipality) = LOWER($${params.length})`);
  }

  // Distance center
  let distExpr = "0";
  let lonIdx = null;
  if (center) {
    params.push(center.lon);
    lonIdx = params.length;
    params.push(center.lat);
    distExpr = buildDistanceExpr("geom", lonIdx);
  }

  if (bbox && bbox.length === 4) {
    const bboxStart = params.length + 1;
    params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    conditions.push(buildBboxCondition(bboxStart));
  }

  if (radiusM && center && lonIdx) {
    params.push(radiusM);
    conditions.push(buildRadiusCondition("geom", lonIdx, params.length));
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  params.push(limit);
  const limitIdx = params.length;

  const sql = `
    SELECT
      osm_id, osm_type, name, provider_type_norm,
      street, housenumber, postcode, city, address_full,
      municipality, lat, lon, phone, website,
      ${distExpr} AS distance_m
    FROM einfo.provider_src
    ${whereClause}
    ORDER BY ${center ? distExpr + " ASC" : "name ASC"}
    LIMIT $${limitIdx}
  `;

  try {
    const res = await p.query(sql, params);
    return res.rows.map(formatProviderRow);
  } catch (err) {
    logError("PostGIS searchProviders Fehler", { error: String(err) });
    return [];
  }
}

/**
 * Liste Objekte in einer bestimmten Gemeinde.
 */
export async function listByMunicipality({ municipalityName, categoryNorms, limit = 50 }) {
  const p = getPool();
  if (!p) return [];

  const params = [];
  const conditions = [];

  params.push(municipalityName);
  conditions.push(`LOWER(municipality) = LOWER($${params.length})`);

  if (categoryNorms && categoryNorms.length > 0) {
    params.push(categoryNorms);
    conditions.push(`category_norm = ANY($${params.length})`);
  }

  const whereClause = "WHERE " + conditions.join(" AND ");

  params.push(limit);
  const limitIdx = params.length;

  const sql = `
    SELECT
      osm_id, osm_type, name, category_norm,
      street, housenumber, postcode, city, address_full,
      municipality, lat, lon, tags_json,
      0 AS distance_m
    FROM einfo.poi_src
    ${whereClause}
    ORDER BY name ASC
    LIMIT $${limitIdx}
  `;

  try {
    const res = await p.query(sql, params);
    return res.rows.map(formatPoiRow);
  } catch (err) {
    logError("PostGIS listByMunicipality Fehler", { error: String(err) });
    return [];
  }
}

/**
 * Gibt eine Liste aller Gemeindenamen zurück.
 */
export async function listMunicipalities() {
  const p = getPool();
  if (!p) return [];

  try {
    const res = await p.query("SELECT name FROM einfo.municipalities ORDER BY name");
    return res.rows.map(r => r.name);
  } catch (err) {
    logError("PostGIS listMunicipalities Fehler", { error: String(err) });
    return [];
  }
}

/**
 * Sucht Gemeinde nach Name (ILIKE) und gibt Polygon-BBox zurück.
 */
export async function findMunicipality(name) {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(`
      SELECT name,
        ST_XMin(geom) AS min_lon, ST_YMin(geom) AS min_lat,
        ST_XMax(geom) AS max_lon, ST_YMax(geom) AS max_lat,
        ST_Y(ST_Centroid(geom)) AS center_lat,
        ST_X(ST_Centroid(geom)) AS center_lon
      FROM einfo.municipalities
      WHERE LOWER(name) = LOWER($1)
      LIMIT 1
    `, [name]);

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      name: row.name,
      bbox: [parseFloat(row.min_lon), parseFloat(row.min_lat), parseFloat(row.max_lon), parseFloat(row.max_lat)],
      center: { lat: parseFloat(row.center_lat), lon: parseFloat(row.center_lon) },
    };
  } catch (err) {
    logError("PostGIS findMunicipality Fehler", { error: String(err) });
    return null;
  }
}

// ============================================================
// Row Formatters
// ============================================================

function formatPoiRow(row) {
  return {
    osm_id: row.osm_id,
    osm_type: row.osm_type,
    name: row.name || null,
    category_norm: row.category_norm || null,
    address_full: row.address_full || null,
    street: row.street || null,
    housenumber: row.housenumber || null,
    postcode: row.postcode || null,
    city: row.city || null,
    municipality: row.municipality || null,
    lat: parseFloat(row.lat),
    lon: parseFloat(row.lon),
    distance_m: row.distance_m != null ? Math.round(parseFloat(row.distance_m)) : null,
    tags_json: row.tags_json || {},
  };
}

function formatProviderRow(row) {
  return {
    osm_id: row.osm_id,
    osm_type: row.osm_type,
    name: row.name || null,
    provider_type_norm: row.provider_type_norm || "unknown",
    address_full: row.address_full || null,
    municipality: row.municipality || null,
    lat: parseFloat(row.lat),
    lon: parseFloat(row.lon),
    distance_m: row.distance_m != null ? Math.round(parseFloat(row.distance_m)) : null,
    phone: row.phone || null,
    website: row.website || null,
  };
}

/**
 * Fährt den Pool herunter (für graceful shutdown).
 */
export async function shutdownPool() {
  if (pool) {
    await pool.end();
    pool = null;
    connectionChecked = false;
    connectionAvailable = false;
    logInfo("PostGIS: Pool heruntergefahren");
  }
}
