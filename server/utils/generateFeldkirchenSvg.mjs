// server/utils/generateFeldkirchenSvg.mjs
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const INCIDENT_FILE = path.join(DATA_DIR, "list_filtered.json");
const WEATHER_INCIDENT_FILE = path.join(DATA_DIR, "weather-incidents.txt");
const BOUNDARY_FILE = path.join(DATA_DIR, "conf", "gemeinden_feldkirchen.geojson");
const OUT_DIR = path.join(DATA_DIR, "prints", "uebersicht");
const OUT_FILE = path.join(OUT_DIR, "feldkirchen.svg");

// === Helper zum Lesen/Parsen ======================================

async function readJson(file, fallback = null) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function readLines(file) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.error("[feldkirchen-svg] Konnte Datei nicht lesen:", file, err?.message || err);
    }
    return [];
  }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// === Incident-Helfer ===============================================

// Ort / Gemeinde-Feld aus Incident holen (ähnlich wie in weatherWarning)
function extractLocation(incident) {
  if (!incident || typeof incident !== "object") return "";
  const candidates = [
    incident.ort,
    incident.ortschaft,
    incident.einsatzort,
    incident.einsatzOrt,
    incident.location,
    incident.place,
    incident.city,
    incident.plzOrt,
  ];
  const found = candidates.find((v) => v != null && String(v).trim());
  return found ? String(found).trim() : "";
}

// Koordinaten holen – tolerant bei Feldnamen
function getIncidentCoords(incident) {
  if (!incident || typeof incident !== "object") return null;

  const cand = [
    { lat: incident.lat, lng: incident.lng },
    { lat: incident.lat, lng: incident.lon },
    { lat: incident.latitude, lng: incident.longitude },
    { lat: incident.LATITUDE, lng: incident.LONGITUDE },
  ];

  for (const c of cand) {
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lon: lng };
  }

  return null;
}

// Zeitstempel für "letzte 24 Stunden" ermitteln
function getIncidentTimestamp(incident) {
  if (!incident || typeof incident !== "object") return null;

  const candidates = [
    incident.timestamp,
    incident.time,
    incident.dateTime,
    incident.datetime,
    incident.createdAt,
    incident.einsatzbeginn,
    incident.einsatzBeginn,
    incident.einsatzzeit,
    incident.einsatzZeit,
  ];

  for (const raw of candidates) {
    if (!raw) continue;

    // Unix ms oder s?
    if (typeof raw === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      // Wenn es nach 2000 ist, nehmen wir ms oder s heuristisch
      if (n > 1e12) return n; // ms
      if (n > 1e9) return n * 1000; // s
    }

    const s = String(raw).trim();
    if (!s) continue;

    const d = new Date(s);
    const t = d.getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }

  return null;
}

async function readWeatherIncidentLocations() {
  // Erwartetes Format in weather-incidents.txt: "Ort – Kategorie …"
  const lines = await readLines(WEATHER_INCIDENT_FILE);
  const locs = new Set();
  for (const line of lines) {
    const [left] = line.split(" – ", 2);
    const loc = (left || "").trim();
    if (loc) locs.add(loc);
  }
  return locs;
}

// === Hauptfunktion: SVG erzeugen ===================================

export async function generateFeldkirchenSvg({
  dataDir = DATA_DIR,
  incidentFile = INCIDENT_FILE,
  weatherIncidentFile = WEATHER_INCIDENT_FILE,
  boundaryFile = BOUNDARY_FILE,
  outFile = OUT_FILE,
} = {}) {
  console.log("[feldkirchen-svg] Erzeuge SVG-Übersicht …");

  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000; // letzte 24 Stunden

  const [incidentData, boundaries, weatherLocs] = await Promise.all([
    readJson(incidentFile, []),
    readJson(boundaryFile, { type: "FeatureCollection", features: [] }),
    readWeatherIncidentLocations(),
  ]);

  const incidents = Array.isArray(incidentData) ? incidentData : [];
  const features = Array.isArray(boundaries?.features) ? boundaries.features : [];

  // 1) Einsätze filtern:
  //    - Ort muss in weather-incidents.txt vorkommen
  //    - Zeitstempel innerhalb der letzten 24 Stunden
  //    - Koordinaten vorhanden
  const points = [];
  for (const incident of incidents) {
    const loc = extractLocation(incident);
    if (!loc || !weatherLocs.has(loc)) continue;

    const ts = getIncidentTimestamp(incident);
    if (ts == null || ts < cutoff) continue;

    const coords = getIncidentCoords(incident);
    if (!coords) continue;

    points.push({
      ...coords,
      location: loc,
      label: String(incident.content || incident.title || loc || "Einsatz").trim(),
      timestamp: ts,
    });
  }

  if (!features.length) {
    console.warn("[feldkirchen-svg] WARNUNG: Keine Gemeinde-Features im GeoJSON gefunden.");
  }

  if (!points.length) {
    console.warn("[feldkirchen-svg] HINWEIS: Keine passenden Einsätze (letzte 24h + weather-incidents.txt).");
  }

  // 2) Bounding Box über Gemeindegrenzen + Punkte
  let minLat = +90,
    maxLat = -90,
    minLon = +180,
    maxLon = -180;

  function updateBounds(lon, lat) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates || []) {
        for (const [lon, lat] of ring) updateBounds(lon, lat);
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates || []) {
        for (const ring of poly) {
          for (const [lon, lat] of ring) updateBounds(lon, lat);
        }
      }
    }
  }

  for (const p of points) {
    updateBounds(p.lon, p.lat);
  }

  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(minLon) ||
    !Number.isFinite(maxLon) ||
    minLat === maxLat ||
    minLon === maxLon
  ) {
    console.warn("[feldkirchen-svg] Ungültige Bounds – verwende Dummy-Ausdehnung.");
    minLat = 46.7;
    maxLat = 46.9;
    minLon = 14.0;
    maxLon = 14.3;
  }

  const width = 1200;
  const height = 800;

  function project(lon, lat) {
    const x = ((lon - minLon) / (maxLon - minLon)) * width;
    const y = ((maxLat - lat) / (maxLat - minLat)) * height; // y nach unten
    return [x, y];
  }

  function polygonToPath(coords) {
    if (!Array.isArray(coords) || !coords.length) return "";
    const [outer, ...holes] = coords;
    const parts = [];

    function ringToD(ring) {
      if (!Array.isArray(ring) || !ring.length) return "";
      let d = "";
      ring.forEach(([lon, lat], idx) => {
        const [x, y] = project(lon, lat);
        d += `${idx === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
      });
      d += "Z";
      return d;
    }

    const outerD = ringToD(outer);
    if (outerD) parts.push(outerD);
    for (const hole of holes) {
      const holeD = ringToD(hole);
      if (holeD) parts.push(holeD);
    }

    return parts.join(" ");
  }

  const boundaryPaths = [];
  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;

    const name = String(
      f.properties?.name ||
        f.properties?.NAME ||
        f.properties?.GEMEINDE ||
        f.properties?.Gemeinde ||
        "",
    ).trim();

    if (geom.type === "Polygon") {
      const d = polygonToPath(geom.coordinates);
      if (d) {
        boundaryPaths.push(
          `<path d="${d}" fill="none" stroke="#4b5563" stroke-width="1" vector-effect="non-scaling-stroke">${
            name ? `<title>${escapeXml(name)}</title>` : ""
          }</path>`,
        );
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates || []) {
        const d = polygonToPath(poly);
        if (d) {
          boundaryPaths.push(
            `<path d="${d}" fill="none" stroke="#4b5563" stroke-width="1" vector-effect="non-scaling-stroke">${
              name ? `<title>${escapeXml(name)}</title>` : ""
            }</path>`,
          );
        }
      }
    }
  }

  const pointRadius = 4;
  const pointElements = points.map((p) => {
    const [x, y] = project(p.lon, p.lat);
    const title = `${p.location} – ${p.label}`;
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${pointRadius}" fill="#ef4444" stroke="#111827" stroke-width="1">
  <title>${escapeXml(title)}</title>
</circle>`;
  });

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
>
  <metadata>
    Bezirk Feldkirchen – Gemeindegrenzen + Einsätze (nur, wenn in weather-incidents.txt UND letzte 24h).
    Koordinatenbezug: WGS84 (EPSG:4326), linear auf die SVG-ViewBox abgebildet.
    Bounds: lon=[${minLon}, ${maxLon}], lat=[${minLat}, ${maxLat}].
  </metadata>

  <rect x="0" y="0" width="${width}" height="${height}" fill="#f9fafb" />

  <g id="gemeinden">
    ${boundaryPaths.join("\n    ")}
  </g>

  <g id="einsatzpunkte">
    ${pointElements.join("\n    ")}
  </g>
</svg>
`;

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, svgContent, "utf8");

  console.log("[feldkirchen-svg] SVG geschrieben nach:", outFile);
}

// CLI-Nutzung: node server/utils/generateFeldkirchenSvg.mjs
if (import.meta.url === `file://${__filename}`) {
  generateFeldkirchenSvg().catch((err) => {
    console.error("[feldkirchen-svg] Fehler:", err?.message || err);
    process.exitCode = 1;
  });
}
