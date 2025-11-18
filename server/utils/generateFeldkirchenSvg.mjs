// server/tools/generateFeldkirchenSvg.mjs
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
const OUT_FILE = path.join(OUT_DIR, "karte_feldkirchen.svg");

// --- Helpers -------------------------------------------------------

async function readJson(file, fallback = null) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[svg-map] JSON konnte nicht gelesen werden:", file, err?.message || err);
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
      console.error("[svg-map] Datei konnte nicht gelesen werden:", file, err?.message || err);
    }
    return [];
  }
}

// identisch zur Logik aus weatherWarning.mjs
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

// versucht verschiedene Feldnamen für Koordinaten
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

// liest weather-incidents.txt und liefert Set der Orte (links vom " – ")
async function readWeatherIncidentLocations() {
  const lines = await readLines(WEATHER_INCIDENT_FILE);
  const locs = new Set();
  for (const line of lines) {
    const [left] = line.split(" – ", 2);
    const loc = (left || "").trim();
    if (loc) locs.add(loc);
  }
  return locs;
}

// --- Hauptlogik ----------------------------------------------------

async function main() {
  console.log("[svg-map] Erzeuge SVG-Karte für Bezirk Feldkirchen …");

  const [incidentData, boundaries, weatherLocs] = await Promise.all([
    readJson(INCIDENT_FILE, []),
    readJson(BOUNDARY_FILE, { type: "FeatureCollection", features: [] }),
    readWeatherIncidentLocations(),
  ]);

  const incidents = Array.isArray(incidentData) ? incidentData : [];
  const features = Array.isArray(boundaries?.features) ? boundaries.features : [];

  // 1) Einsätze filtern: nur solche, deren Ort in weather-incidents.txt vorkommt
  const points = [];
  for (const incident of incidents) {
    const loc = extractLocation(incident);
    if (!loc || !weatherLocs.has(loc)) continue;

    const coords = getIncidentCoords(incident);
    if (!coords) continue;

    points.push({
      ...coords,
      location: loc,
      label: String(incident.content || incident.title || loc || "Einsatz").trim(),
    });
  }

  if (!features.length) {
    console.warn("[svg-map] WARNUNG: Keine Gemeinde-Features im GeoJSON gefunden.");
  }

  if (!points.length) {
    console.warn("[svg-map] HINWEIS: Keine Einsätze mit Koordinaten gefunden, die in weather-incidents.txt vorkommen.");
  }

  // 2) Bounding Box über Polygon-Grenzen + Punkte berechnen
  let minLat = +90,
    maxLat = -90,
    minLon = +180,
    maxLon = -180;

  function updateBoundsForCoord(lon, lat) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  // Grenzen aus GeoJSON
  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates || []) {
        for (const [lon, lat] of ring) updateBoundsForCoord(lon, lat);
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates || []) {
        for (const ring of poly) {
          for (const [lon, lat] of ring) updateBoundsForCoord(lon, lat);
        }
      }
    }
  }

  // Punkte
  for (const p of points) {
    updateBoundsForCoord(p.lon, p.lat);
  }

  // Fallback, falls irgendwas leer ist
  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(minLon) ||
    !Number.isFinite(maxLon) ||
    minLat === maxLat ||
    minLon === maxLon
  ) {
    console.warn("[svg-map] Ungültige Bounds – verwende Dummy-Ausdehnung (14.0/46.7–14.3/46.9).");
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

  // 3) SVG-Elemente für Gemeindegrenzen
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
          `<path d="${d}" fill="none" stroke="#666" stroke-width="1" vector-effect="non-scaling-stroke">${
            name ? `<title>${escapeXml(name)}</title>` : ""
          }</path>`,
        );
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates || []) {
        const d = polygonToPath(poly);
        if (d) {
          boundaryPaths.push(
            `<path d="${d}" fill="none" stroke="#666" stroke-width="1" vector-effect="non-scaling-stroke">${
              name ? `<title>${escapeXml(name)}</title>` : ""
            }</path>`,
          );
        }
      }
    }
  }

  // 4) SVG-Elemente für Punkte (Einsätze)
  const pointElements = [];
  const pointRadius = 4;

  for (const p of points) {
    const [x, y] = project(p.lon, p.lat);
    const title = `${p.location} – ${p.label}`;
    pointElements.push(
      `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${pointRadius}" fill="#e11d48" stroke="#111" stroke-width="1">
  <title>${escapeXml(title)}</title>
</circle>`,
    );
  }

  // 5) SVG zusammensetzen
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
>
  <metadata>
    Bezirk Feldkirchen – Gemeindegrenzen + Einsätze (nur, wenn in weather-incidents.txt enthalten).
    Koordinatenbezug: WGS84 (EPSG:4326), linear auf SVG-ViewBox abgebildet.
    Bounds: lon=[${minLon}, ${maxLon}], lat=[${minLat}, ${maxLat}].
  </metadata>

  <!-- Hintergrund -->
  <rect x="0" y="0" width="${width}" height="${height}" fill="#f9fafb" />

  <!-- Gemeindegrenzen -->
  <g id="gemeinden">
    ${boundaryPaths.join("\n    ")}
  </g>

  <!-- Einsätze (nur, wenn in weather-incidents.txt) -->
  <g id="einsatzpunkte">
    ${pointElements.join("\n    ")}
  </g>
</svg>
`;

  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(OUT_FILE, svgContent, "utf8");

  console.log("[svg-map] SVG-Karte geschrieben nach:", OUT_FILE);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((err) => {
  console.error("[svg-map] Fehler beim Erzeugen der SVG-Karte:", err?.message || err);
  process.exitCode = 1;
});
