// server/utils/fetchGemeindenFeldkirchen.mjs
// Erzeugt einmalig ein GeoJSON mit den Gemeindegrenzen des Bezirks Feldkirchen (Kärnten)
// und speichert es unter server/data/conf/gemeinden_feldkirchen.geojson

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import osmtogeojsonModule from "osmtogeojson"; // npm install osmtogeojson

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CJS/ESM-Interop absichern
const osmtogeojson =
  typeof osmtogeojsonModule === "function"
    ? osmtogeojsonModule
    : osmtogeojsonModule.default || osmtogeojsonModule;

// Basis-Verzeichnisse
const DATA_DIR = path.resolve(__dirname, "../data");
const OUT_DIR = path.join(DATA_DIR, "conf");
const OUT_FILE = path.join(OUT_DIR, "gemeinden_feldkirchen.geojson");

// Overpass API-Endpunkt
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Overpass-Query:
// 1) Bezirk Feldkirchen in Kärnten (admin_level=7) finden
// 2) Alle Gemeinden (admin_level=8) innerhalb dieses Bezirks holen
const OVERPASS_QUERY = `
[out:json][timeout:120];

// Bezirk Feldkirchen in Kärnten (Verwaltungsbezirk)
rel
  ["admin_level"="7"]
  ["boundary"="administrative"]
  ["name"="Feldkirchen in Kärnten"];

// Alle Gemeinden (admin_level=8) innerhalb dieses Bezirks
rel
  (r)
  ["admin_level"="8"]
  ["boundary"="administrative"];

out body;
>;
out skel qt;
`.trim();

function log(...args) {
  console.log("[gemeinden-feldkirchen]", ...args);
}

function toGeoJSON(overpassJson) {
  const full = osmtogeojson(overpassJson);

  if (!full || !Array.isArray(full.features)) {
    throw new Error("osmtogeojson hat kein gültiges FeatureCollection erzeugt");
  }

  // Filter auf admin_level=8, boundary=administrative
  const filtered = {
    type: "FeatureCollection",
    features: full.features.filter((f) => {
      const p = f.properties || {};
      const admin = p.admin_level ?? p["admin_level"];
      return p.boundary === "administrative" && String(admin) === "8";
    }),
  };

  if (!filtered.features.length) {
    log("WARNUNG: Keine Features mit admin_level=8 gefunden – benutze ungefiltertes GeoJSON.");
    return full;
  }

  return filtered;
}

async function main() {
  try {
    if (typeof fetch !== "function") {
      throw new Error("global fetch ist nicht verfügbar – Node 18+ wird benötigt.");
    }

    log("Starte Download der Gemeindegrenzen Bezirk Feldkirchen …");
    log("Ziel-Datei:", OUT_FILE);

    const body = "data=" + encodeURIComponent(OVERPASS_QUERY);

    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "bfkdo-feldkirchen/1.0 (Overpass-Anfrage)",
      },
      body,
    });

    log("HTTP-Status:", res.status, res.statusText);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Overpass-Fehler: ${res.status} ${res.statusText} – ${text.slice(0, 200)}`
      );
    }

    const overpassJson = await res.json();
    log("Overpass-Daten empfangen.");

    const geojson = toGeoJSON(overpassJson);
    log(`GeoJSON mit ${geojson.features?.length ?? 0} Features erzeugt.`);

    await fsp.mkdir(OUT_DIR, { recursive: true });
    await fsp.writeFile(OUT_FILE, JSON.stringify(geojson, null, 2), "utf8");

    log("Datei geschrieben nach:", OUT_FILE);
    log("FERTIG.");
  } catch (err) {
    console.error("[gemeinden-feldkirchen] FEHLER:", err?.message || err);
    process.exitCode = 1;
  }
}

// WICHTIG: Einfach immer laufen lassen, wenn das Script direkt gestartet wird
main();
