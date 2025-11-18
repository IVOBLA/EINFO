// server/utils/generateFeldkirchenSvg.mjs
// Zeichnet Einsätze aus board.json als Punkte auf eine statische
// Bezirkskarte Feldkirchen (PNG, Google-Maps-Screenshot) und speichert ein SVG:
//
//   - Hintergrund: server/data/conf/feldkirchen_base.png  (798x665 px)
//   - Punkte: Einsätze aus board.json
//       * nur, wenn ID in weather-incidents.txt vorkommt (#<id>)
//       * nur letzte 24h
//
// Ergebnis: server/data/prints/uebersicht/feldkirchen.svg

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

const BOARD_FILE = path.join(DATA_DIR, "board.json");
const WEATHER_INCIDENT_FILE = path.join(DATA_DIR, "weather-incidents.txt");
const BASE_MAP_FILE = path.join(DATA_DIR, "conf", "feldkirchen_base.png");

const OUT_DIR = path.join(DATA_DIR, "prints", "uebersicht");
const OUT_FILE = path.join(OUT_DIR, "feldkirchen.svg");

// Größe des verwendeten Screenshots (dein Google-Maps-Bild)
const MAP_WIDTH = 798;
const MAP_HEIGHT = 665;

// Exakte Bounding Box des Screenshots (von dir vorgegeben)
const DISTRICT_BOUNDS = {
  minLat: 46.635993,
  maxLat: 46.943458,
  minLon: 13.751214,
  maxLon: 14.299844,
};

// -----------------------------------------------------
// Helper
// -----------------------------------------------------

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
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Board-Items aus board.json holen (Spaltenstruktur berücksichtigen)
async function readBoardItems(boardFile) {
  const parsed = await readJson(boardFile, null);
  if (!parsed || typeof parsed !== "object") return [];

  if (Array.isArray(parsed.items)) return parsed.items;

  const cols = parsed.columns || {};
  const all = [];
  for (const colKey of Object.keys(cols)) {
    const col = cols[colKey];
    if (Array.isArray(col?.items)) all.push(...col.items);
  }
  return all;
}

// IDs aus weather-incidents.txt extrahieren (Format: ... #<id> – ...)
async function readWeatherBoardIds(file) {
  const lines = await readLines(file);
  const ids = new Set();

  for (const line of lines) {
    const m = line.match(/#([a-zA-Z0-9_-]+)/);
    if (m && m[1]) ids.add(m[1]);
  }

  return ids;
}

function extractTimestamp(entry) {
  const fields = [
    "timestamp",
    "time",
    "dateTime",
    "datetime",
    "createdAt",
    "einsatzbeginn",
    "einsatzBeginn",
    "einsatzzeit",
    "einsatzZeit",
  ];

  for (const f of fields) {
    const v = entry[f];
    if (!v) continue;

    if (typeof v === "number") {
      if (v > 1e12) return v; // ms
      if (v > 1e9) return v * 1000; // sek → ms
    }

    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }

  return null;
}

function extractCoords(entry) {
  const candidates = [
    { lat: entry.lat, lon: entry.lng },
    { lat: entry.lat, lon: entry.lon },
    { lat: entry.latitude, lon: entry.longitude },
    { lat: entry.LATITUDE, lon: entry.LONGITUDE },
  ];

  for (const c of candidates) {
    const lat = Number(c.lat);
    const lon = Number(c.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }
  return null;
}

function extractLabel(entry) {
  return (
    (entry.content && String(entry.content).trim()) ||
    (entry.typ && String(entry.typ).trim()) ||
    (entry.title && String(entry.title).trim()) ||
    "Einsatz"
  );
}

// -----------------------------------------------------
// Hauptfunktion
// -----------------------------------------------------

export async function generateFeldkirchenSvg() {
  console.log("[svg] Erzeuge Feldkirchen-SVG mit statischer Google-Maps-Karte …");

  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000; // 24h

  // 1) IDs aus weather-incidents.txt
  const weatherIds = await readWeatherBoardIds(WEATHER_INCIDENT_FILE);
  if (!weatherIds.size) {
    console.warn("[svg] Keine Board-IDs in weather-incidents.txt – es werden keine Punkte gezeichnet.");
  }

  // 2) Board-Einträge
  const boardItems = await readBoardItems(BOARD_FILE);

  const points = [];
  for (const entry of boardItems) {
    if (!entry?.id || !weatherIds.has(entry.id)) continue;

    const ts = extractTimestamp(entry);
    if (ts == null || ts < cutoff) continue;

    const coords = extractCoords(entry);
    if (!coords) continue;

    points.push({
      ...coords,
      id: entry.id,
      label: extractLabel(entry),
    });
  }

  console.log(`[svg] ${points.length} Einsätze für Darstellung ausgewählt.`);

  // 3) Hintergrundbild als data:URL laden
  let baseImageHref = null;
  try {
    const buf = await fsp.readFile(BASE_MAP_FILE);
    const b64 = buf.toString("base64");
    baseImageHref = `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error("[svg] Hintergrundkarte konnte nicht gelesen werden:", err?.message || err);
  }

  // 4) Projektion lat/lon -> Bildkoordinaten anhand DISTRICT_BOUNDS
  const { minLat, maxLat, minLon, maxLon } = DISTRICT_BOUNDS;

  function project(lon, lat) {
    const x = ((lon - minLon) / (maxLon - minLon || 1)) * MAP_WIDTH;
    const y = ((maxLat - lat) / (maxLat - minLat || 1)) * MAP_HEIGHT;
    return [x, y];
  }

  // 5) Punkte-SVG
  const pointSvg = points
    .map((p) => {
      const [x, y] = project(p.lon, p.lat);
      const title = `${p.id}: ${p.label}`;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#e11d48" stroke="#111827" stroke-width="1.5">
  <title>${title}</title>
</circle>`;
    })
    .join("\n    ");

  // 6) Gesamt-SVG mit Hintergrundbild
  const svgParts = [];

  svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  svgParts.push(
    `<svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`
  );

  if (baseImageHref) {
    svgParts.push(
      `  <image x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" href="${baseImageHref}" />`
    );
  } else {
    svgParts.push(
      `  <rect x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#f9fafb" />`
    );
  }

  svgParts.push(`  <g id="einsatzpunkte">`);
  if (pointSvg) {
    svgParts.push("    " + pointSvg);
  }
  svgParts.push(`  </g>`);
  svgParts.push(`</svg>`);

  const svg = svgParts.join("\n");

  // 7) Schreiben
  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(OUT_FILE, svg, "utf8");

  console.log("[svg] Karte geschrieben:", OUT_FILE);
}

// CLI-Aufruf
if (import.meta.url === `file://${__filename}`) {
  generateFeldkirchenSvg().catch((err) => {
    console.error("[svg] Fehler:", err);
  });
}
