// server/utils/generateFeldkirchenSvg.mjs
// Erzeugt eine SVG-Karte für den Bezirk Feldkirchen mit Punkten aus board.json.
// Filter über Optionen:
//   - show: "weather" | "all"
//   - hours: wie viele Stunden zurück ab jetzt.

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

// Größe deines Screenshots
const MAP_WIDTH = 798;
const MAP_HEIGHT = 665;

// Bounding Box aus deinem Screenshot
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function loadCategories() {
  try {
    const list = await readJson(CATEGORY_FILE, []);
    return (Array.isArray(list) ? list : [])
      .map((v) => String(v).trim())
      .filter(Boolean)
      .map((label) => ({
        label,
        needle: label.toLowerCase(),
      }));
  } catch {
    return [];
  }
}

function getEntryCategory(entry, categories) {
  if (!categories?.length) return null;
  const hay = [
    entry.typ,
    entry.description,
    entry.content,
    entry.title,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .join(" ");

  for (const cat of categories) {
    if (hay.includes(cat.needle)) return cat.label;
  }
  return null;
}

function buildCategoryColorMap(categories) {
  const palette = [
    "#2563eb",
    "#ea580c",
    "#10b981",
    "#facc15",
    "#8b5cf6",
    "#ec4899",
    "#0ea5e9",
    "#f87171",
    "#14b8a6",
    "#f97316",
  ];
  const map = new Map();
  categories.forEach((cat, index) => {
    map.set(cat.label, palette[index % palette.length]);
  });
  return map;
}

function createLegend(items) {
  if (!items?.length) return "";
  const padding = 12;
  const swatchSize = 12;
  const lineHeight = 20;
  const width = 220;
  const height = padding * 2 + items.length * lineHeight;
  const x = MAP_WIDTH - width - 16;
  const y = 16;

  const rows = items
    .map((item, idx) => {
      const rowY = y + padding + idx * lineHeight;
      return `
    <rect x="${x + padding}" y="${rowY}" width="${swatchSize}" height="${swatchSize}" rx="2" fill="${item.color}" />
    <text x="${x + padding + swatchSize + 8}" y="${rowY}" font-size="12" fill="#111827" dominant-baseline="hanging">${escapeXml(
        item.name
      )}</text>`;
    })
    .join("\n");

  return `
  <g id="legend">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff" fill-opacity="0.9" stroke="#d1d5db" />
    ${rows}
  </g>`;
}

function extractTime(entry) {
  const fields = ["timestamp", "createdAt", "time", "dateTime"];
  for (const k of fields) {
    const v = entry[k];
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

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

function project(lon, lat) {
  const x =
    ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon || 1)) * MAP_WIDTH;
  const y =
    ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat || 1)) * MAP_HEIGHT;
  return [x, y];
}

async function readBoardItems() {
  const board = await readJson(BOARD_FILE, null);
  if (!board || typeof board !== "object") return [];

  if (Array.isArray(board.items)) return board.items;

  const cols = board.columns || {};
  const all = [];
  for (const key of Object.keys(cols)) {
    const col = cols[key];
    if (Array.isArray(col?.items)) all.push(...col.items);
  }
  return all;
}

// -----------------------------------------------------------------------------
// Hauptfunktion
// -----------------------------------------------------------------------------

const DEFAULT_POINT_COLOR = "#e11d48";

export async function generateFeldkirchenSvg(options = {}) {
  const {
    show = "weather", // "weather" | "all"
    hours = 24,
  } = options;

  const now = Date.now();
  const effectiveHours =
    Number.isFinite(+hours) && +hours > 0 ? +hours : 24;
  const cutoff = now - effectiveHours * 60 * 60 * 1000;

  const categories = await loadCategories();
  const categoryColorMap = buildCategoryColorMap(categories);
  const items = await readBoardItems();

  const points = [];

  for (const entry of items) {
    const t = extractTime(entry);
    if (!t || t < cutoff) continue;

    const coords = extractCoords(entry);
    if (!coords) continue;

    const categoryName = getEntryCategory(entry, categories);
    if (show === "weather" && !categoryName) continue;

    points.push({
      ...coords,
      id: entry.id,
      label: entry.typ || entry.title || entry.content || "Einsatz",
      category: categoryName,
      color: categoryColorMap.get(categoryName) || DEFAULT_POINT_COLOR,
    });
  }

  console.log(
    `[svg] ${points.length} Punkte → show=${show}, hours=${effectiveHours}`
  );

  // Hintergrund-Bitmap laden
  let baseHref = null;
  try {
    const buf = await fsp.readFile(BASE_MAP_FILE);
    baseHref = `data:image/png;base64,${buf.toString("base64")}`;
  } catch (err) {
    console.warn(
      "[svg] Hintergrundkarte konnte nicht gelesen werden:",
      err?.message || err
    );
  }

  const circles = points
    .map((p) => {
      const [x, y] = project(p.lon, p.lat);
      const title = `${p.id || ""} ${p.label}`.trim();
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(
        1
      )}" r="6" fill="${p.color}" stroke="#111827" stroke-width="1.5">
  <title>${title}</title>
</circle>`;
    })
    .join("\n  ");

  const usedCategories = Array.from(
    new Set(points.map((p) => p.category).filter(Boolean))
  );
  const legend = createLegend(
    usedCategories.map((name) => ({
      name,
      color: categoryColorMap.get(name) || DEFAULT_POINT_COLOR,
    }))
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${
    baseHref
      ? `<image href="${baseHref}" x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" />`
      : `<rect x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#f3f4f6" />`
  }
  <g id="einsatzpunkte">
  ${circles}
  </g>
  ${legend}
</svg>`;

  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(OUT_FILE, svg, "utf8");
  console.log("[svg] Karte geschrieben:", OUT_FILE);
}

// CLI: node utils/generateFeldkirchenSvg.mjs
if (import.meta.url === `file://${__filename}`) {
  generateFeldkirchenSvg().catch((err) => {
    console.error("[svg] Fehler beim Erzeugen der Karte:", err);
  });
}
