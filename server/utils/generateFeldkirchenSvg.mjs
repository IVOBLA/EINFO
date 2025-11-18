// server/utils/generateFeldkirchenSvg.mjs
// Erzeugt eine reine Punktkarte (SVG) für Einsätze der letzten 24h,
// die auch in weather-incidents.txt vorkommen.

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

const INCIDENT_FILE = path.join(DATA_DIR, "list_filtered.json");
const WEATHER_INCIDENT_FILE = path.join(DATA_DIR, "weather-incidents.txt");

const OUT_DIR = path.join(DATA_DIR, "prints", "uebersicht");
const OUT_FILE = path.join(OUT_DIR, "feldkirchen.svg");

// ===========================================================
// Helpers
// ===========================================================

async function readJson(file, fallback = []) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function readLines(file) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function extractLocation(incident) {
  const fields = [
    "ort", "ortschaft", "einsatzort", "einsatzOrt",
    "location", "place", "city", "plzOrt"
  ];
  for (const f of fields) {
    if (incident[f] && String(incident[f]).trim()) return String(incident[f]).trim();
  }
  return null;
}

function extractCoords(incident) {
  const candidates = [
    { lat: incident.lat, lon: incident.lng },
    { lat: incident.lat, lon: incident.lon },
    { lat: incident.latitude, lon: incident.longitude },
    { lat: incident.LATITUDE, lon: incident.LONGITUDE },
  ];
  for (const c of candidates) {
    if (Number.isFinite(+c.lat) && Number.isFinite(+c.lon)) {
      return { lat: +c.lat, lon: +c.lon };
    }
  }
  return null;
}

function extractTimestamp(incident) {
  const fields = [
    "timestamp", "time", "dateTime", "datetime",
    "createdAt", "einsatzbeginn", "einsatzBeginn",
    "einsatzzeit", "einsatzZeit"
  ];

  for (const f of fields) {
    const v = incident[f];
    if (!v) continue;

    // Zahl → Sekunden oder Millisekunden
    if (typeof v === "number") {
      if (v > 1e12) return v;      // ms
      if (v > 1e9) return v * 1000; // s → ms
    }

    // String → Datum
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  return null;
}

// ===========================================================
// Hauptlogik
// ===========================================================

export async function generateFeldkirchenSvg() {
  console.log("[svg] Erzeuge Punktkarte Feldkirchen …");

  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000; // 24h in ms

  // --- 1) Wetter-Standort-Liste laden
  const weatherLines = await readLines(WEATHER_INCIDENT_FILE);
  const weatherLocs = new Set(
    weatherLines.map((l) => l.split(" – ")[0].trim())
  );

  // --- 2) Einsätze laden
  const allIncidents = await readJson(INCIDENT_FILE, []);
  const points = [];

  for (const incident of allIncidents) {
    const loc = extractLocation(incident);
    if (!loc || !weatherLocs.has(loc)) continue;

    const ts = extractTimestamp(incident);
    if (ts == null || ts < cutoff) continue;

    const coords = extractCoords(incident);
    if (!coords) continue;

    points.push({
      ...coords,
      location: loc,
      label: incident.content || incident.title || loc
    });
  }

  // --- 3) Bounds nur aus Punkten bestimmen
  let minLat = +90, maxLat = -90, minLon = +180, maxLon = -180;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  // Fallback, falls keine Punkte vorhanden sind
  if (points.length === 0) {
    minLat = 46.6;
    maxLat = 47.0;
    minLon = 13.8;
    maxLon = 14.3;
  }

  // --- 4) Projektion
  const width = 1200;
  const height = 800;

  function project(lon, lat) {
    const x = ((lon - minLon) / (maxLon - minLon)) * width;
    const y = ((maxLat - lat) / (maxLat - minLat)) * height;
    return [x, y];
  }

  // --- 5) SVG erzeugen
  const pointSvg = points.map((p) => {
    const [x, y] = project(p.lon, p.lat);
    const t = `${p.location}: ${p.label}`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#e11d48" stroke="#111" stroke-width="1">
  <title>${t}</title>
</circle>`;
  }).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg">

  <rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc"/>

  <!-- Einsätze -->
  ${pointSvg}

</svg>`;

  // --- 6) Speichern
  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(OUT_FILE, svg, "utf8");

  console.log("[svg] Punktkarte geschrieben:", OUT_FILE);
}

// CLI-Aufruf
if (import.meta.url === `file://${__filename}`) {
  generateFeldkirchenSvg().catch((err) => {
    console.error("[svg] Fehler:", err);
  });
}
