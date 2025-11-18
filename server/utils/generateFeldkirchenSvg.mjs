// server/utils/generateFeldkirchenSvg.mjs
// Erzeugt die SVG-Karte für Bezirk Feldkirchen
// Filterbar über Optionen: { show, hours }

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const BOARD_FILE = path.join(DATA_DIR, "board.json");
const CATEGORY_FILE = path.join(DATA_DIR, "conf", "weather-categories.json");
const BASE_MAP_FILE = path.join(DATA_DIR, "conf", "feldkirchen_base.png");

const OUT_DIR = path.join(DATA_DIR, "prints", "uebersicht");
const OUT_FILE = path.join(OUT_DIR, "feldkirchen.svg");

// Hintergrundbildgröße & Bounding Box
const MAP_WIDTH = 798;
const MAP_HEIGHT = 665;

const BOUNDS = {
  minLat: 46.635993,
  maxLat: 46.943458,
  minLon: 13.751214,
  maxLon: 14.299844,
};

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readLines(file) {
  try {
    return (await fsp.readFile(file, "utf8"))
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Wetterkategorien laden
async function loadCategories() {
  const list = await readJson(CATEGORY_FILE, []);
  return list.map(x => String(x).toLowerCase());
}

// Prüfen, ob Einsatz eine Wetterkategorie enthält
function entryHasWeatherCategory(entry, categories) {
  const hay = [
    entry.typ,
    entry.description,
    entry.content,
    entry.title,
  ]
    .filter(Boolean)
    .map(s => String(s).toLowerCase())
    .join(" ");

  return categories.some(cat => hay.includes(cat));
}

// Timestamp extrahieren
function extractTime(entry) {
  const f = ["timestamp", "createdAt", "time", "dateTime"];
  for (const k of f) {
    const v = entry[k];
    if (!v) continue;
    const d = new Date(v);
    if (!isNaN(d)) return d.getTime();
  }
  return null;
}

// Koordinaten extrahieren
function extractCoords(entry) {
  const pairs = [
    { lat: entry.lat, lon: entry.lng },
    { lat: entry.lat, lon: entry.lon },
    { lat: entry.latitude, lon: entry.longitude },
  ];
  for (const p of pairs) {
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}

// Projektion:
function project(lon, lat) {
  const x = ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * MAP_WIDTH;
  const y = ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * MAP_HEIGHT;
  return [x, y];
}

// -----------------------------------------------------------------------------

export async function generateFeldkirchenSvg(options = {}) {
  const {
    show = "weather",
    hours = 24,
  } = options;

  const categories = await loadCategories();
  const board = await readJson(BOARD_FILE, { items: [] });
  const items = Array.isArray(board.items)
    ? board.items
    : Object.values(board.columns || {}).flatMap(c => c.items || []);

  const now = Date.now();
  const cutoff = now - hours * 3600 * 1000;

  const points = [];

  for (const entry of items) {
    const t = extractTime(entry);
    if (!t || t < cutoff) continue;

    const coords = extractCoords(entry);
    if (!coords) continue;

    const isWeather = entryHasWeatherCategory(entry, categories);

    if (show === "weather" && !isWeather) continue;

    points.push({
      ...coords,
      label: entry.typ || entry.title || "",
      id: entry.id,
    });
  }

  console.log(`[svg] ${points.length} Punkte → mode=${show}, hours=${hours}`);

  // Hintergrundkartenbild base64 laden
  let base = null;
  try {
    const buf = await fsp.readFile(BASE_MAP_FILE);
    base = `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    console.warn("[svg] WARNUNG: Hintergrundkarte fehlt!");
  }

  // Punkte bauen
  const circles = points
    .map(p => {
      const [x, y] = project(p.lon, p.lat);
      return `<circle cx="${x}" cy="${y}" r="6" fill="#e11d48" stroke="#111" stroke-width="1.5"><title>${p.id} ${p.label}</title></circle>`;
    })
    .join("\n");

  const svg = `
<svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">

  ${base
    ? `<image href="${base}" x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" />`
    : `<rect x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#eee" />`
  }

  ${circles}
</svg>`;

  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(OUT_FILE, svg, "utf8");

  console.log("[svg] Karte erzeugt:", OUT_FILE);
}
