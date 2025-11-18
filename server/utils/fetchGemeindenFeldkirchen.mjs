// server/utils/fetchGemeindenFeldkirchen.mjs
// Erzeugt einmalig ein GeoJSON mit den Gemeindegrenzen des Bezirks Feldkirchen (Kärnten)
// und speichert es unter server/data/conf/gemeinden_feldkirchen.geojson

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import osmtogeojson from "osmtogeojson"; // npm install osmtogeojson

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Basis-Verzeichnisse
const DATA_DIR = path.resolve(__dirname, "../data");
const OUT_DIR = path.join(DATA_DIR, "conf");
const OUT_FILE = path.join(OUT_DIR, "gemeinden_feldkirchen.geojson");

// Overpass API-Endpunkt
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Overpass-Query:
// 1) Bezirk Feldkirchen in Kärnten als admin_level=7-Relation finden
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

// --- Helper --------------------------------------------------------

function log(...args) {
  console.log("[gemeinden-feldkirchen]", ...args);
}

function toGeoJSON(overpassJson) {
  // Vollständiges GeoJSON aus Overpass
  const full = osmtogeojson(overpassJson);

  if (!full || !Array.isArray(full.features)) {
    throw new Error("osmtogeojson hat kein gültiges FeatureCollection zurückgegeben");
  }

  // Wir filtern vorsichtshalber auf admin_level=8, boundary=administrative
  const filtered = {
    type: "FeatureCollection",
    features: full.features.filter((f) => {
      const p = f.properties || {};
      return (
        p.boundary === "administrative" &&
        (p.admin_level === "8" || p["admin_level"] === 8)
      );
    }),
  };

  if (!filtered.features.length) {
    log("WARNUNG: Keine Features mit admin_level=8 gefunden, benutze ungefiltertes GeoJSON.");
    return full;
  }

  return filtered;
}

// --- Hauptfunktion -------------------------------------------------

async function main() {
  log("Starte Download der Gemeindegrenzen Bezirk Feldkirchen …");

  // Request-Body für Overpass (klassisch URL-encoded)
  const body = "data=" + encodeURIComponent(OVERPASS_QUERY);

  // Node 18+ hat global fetch, sonst müsstest du node-fetch installieren.
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "bfkdo-feldkirchen/1.0 (Overpass-Anfrage)",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Overpass-Fehler: ${res.status} ${res.statusText}`);
  }

  const overpassJson = await res.json();
  log("Overpass-Daten empfangen.");

  const geojson = toGeoJSON(overpassJson);
  log(`GeoJSON mit ${geojson.features?.length ?? 0} Features erzeugt.`);

  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(OUT_FILE, JSON.stringify(geojson, null, 2), "utf8");

  log("Datei geschrieben nach:", OUT_FILE);
}

// Script direkt ausführen: node server/utils/fetchGemeindenFeldkirchen.mjs
if (import.meta.url === `file://${__filename}`) {
  main().catch((err) => {
    console.error("[gemeinden-feldkirchen] FEHLER:", err?.message || err);
    process.exitCode = 1;
  });
}
