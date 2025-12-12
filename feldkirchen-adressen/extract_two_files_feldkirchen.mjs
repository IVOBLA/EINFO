import fs from "fs";
import * as turf from "@turf/turf";
import { createObjectCsvWriter } from "csv-writer";
import { createOSMStream } from "osm-pbf-parser-node";

// ==== KONFIGURATION ====
const PBF_FILE = "./karnten-latest.osm.pbf";
const BOUNDARY_FILE = "./bezirk_feldkirchen_clean.geojson";

// Output 1: Privatadressen (nur addr + lat/lon, dedupliziert, keine Firmen/Einrichtungen)
const OUT_PRIVATE = "./privatadressen_feldkirchen.csv";

// Output 2: Gebäude mit Adresse (wie extract_pois_feldkirchen.mjs: building + addr + centroid + lat/lon)
const OUT_BUILDINGS = "./gebaeude_mit_adresse_feldkirchen.csv";

// ==== Boundary laden ====
const boundaryGeojson = JSON.parse(fs.readFileSync(BOUNDARY_FILE, "utf8"));
const boundaryFeature =
  boundaryGeojson.type === "FeatureCollection" ? boundaryGeojson.features[0] : boundaryGeojson;
const boundary = turf.feature(boundaryFeature.geometry);

function pointInBezirk(lon, lat) {
  return turf.booleanPointInPolygon(turf.point([lon, lat]), boundary);
}

// ==== CSV Writer ====
const privateWriter = createObjectCsvWriter({
  path: OUT_PRIVATE,
  header: [
    { id: "street", title: "STRASSE" },
    { id: "housenumber", title: "HAUSNUMMER" },
    { id: "postcode", title: "PLZ" },
    { id: "city", title: "ORT" },
    { id: "lat", title: "LAT" },
    { id: "lon", title: "LON" },
    { id: "source", title: "SOURCE" }, // node|way (nur Info)
    { id: "osm_id", title: "OSM_ID" },
  ],
});

const buildingsWriter = createObjectCsvWriter({
  path: OUT_BUILDINGS,
  header: [
    { id: "osm_id", title: "OSM_ID" },
    { id: "osm_type", title: "OSM_TYPE" }, // "way"
    { id: "name", title: "NAME" },
    { id: "building", title: "BUILDING" },
    { id: "street", title: "ADDR_STRASSE" },
    { id: "housenumber", title: "ADDR_HAUSNUMMER" },
    { id: "postcode", title: "ADDR_PLZ" },
    { id: "city", title: "ADDR_ORT" },
    { id: "lat", title: "LAT" },
    { id: "lon", title: "LON" },
  ],
});

// ==== Helpers ====
function extractAddress(tags) {
  if (!tags) return null;
  const housenumber = tags["addr:housenumber"] || "";
  if (!housenumber) return null;

  return {
    street: (tags["addr:street"] || "").trim(),
    housenumber: String(housenumber).trim(),
    postcode: (tags["addr:postcode"] || "").trim(),
    city: (tags["addr:city"] || tags["addr:place"] || "").trim(),
  };
}

function addrKey(a) {
  // Normalisierte Adresse als Dedupe-Key (Groß/Klein egal, Leerzeichen normalisieren)
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return [
    norm(a.street),
    norm(a.housenumber),
    norm(a.postcode),
    norm(a.city),
  ].join("|");
}

function isBuilding(tags) {
  return !!(tags && tags["building"]);
}

// Heuristik: “Firma/Einrichtung” (für Privatadressen ausschließen)
function looksLikePoi(tags) {
  if (!tags) return false;
  // wenn ein Adress-Node/Way gleichzeitig POI ist → nicht privat
  const keys = [
    "amenity",
    "shop",
    "office",
    "craft",
    "tourism",
    "leisure",
    "healthcare",
    "industrial",
    "public_transport",
    "railway",
  ];
  return keys.some((k) => tags[k] != null);
}

function centroidFromRefs(refs, nodeMap) {
  const coords = [];
  for (const id of refs || []) {
    const n = nodeMap.get(id);
    if (n) coords.push([n.lon, n.lat]);
  }
  if (coords.length < 2) return null;
  const c = turf.centroid(turf.multiPoint(coords)).geometry.coordinates;
  return { lon: c[0], lat: c[1] };
}

// ==== Main ====
async function run() {
  console.log(`[${new Date().toISOString()}] Start: 2 Dateien erzeugen (Privatadressen + Gebäude)…`);

  if (!fs.existsSync(PBF_FILE)) {
    console.error("PBF nicht gefunden:", PBF_FILE);
    process.exit(1);
  }

  const stream = createOSMStream(PBF_FILE, { withTags: true, withInfo: false });

  // Für Ways-Centroids: alle Node-Koordinaten speichern (sonst fehlen lat/lon bei Gebäuden)
  const nodeMap = new Map(); // nodeId -> {lat, lon}

  // Ergebnis-Sammlungen
  const buildings = [];
  const privateAddrs = [];

  // Dedupe-Sets
  const seenBuildingsAddr = new Set(); // addrKey, damit Privatadressen keine Gebäude-Adressen duplizieren
  const seenPrivateAddr = new Set();   // addrKey, damit Privatadressen keine Duplikate bekommen

  let nodesSeen = 0;
  let waysSeen = 0;

  for await (const e of stream) {
    if (e.type === "node") {
      // Node coords immer speichern
      if (typeof e.lat === "number" && typeof e.lon === "number") {
        nodeMap.set(e.id, { lat: e.lat, lon: e.lon });
      }

      // Privatadresse kann auch als reiner Adress-Node existieren (addr:* ohne building)
      const addr = extractAddress(e.tags);
      if (addr && typeof e.lat === "number" && typeof e.lon === "number") {
        if (pointInBezirk(e.lon, e.lat)) {
          // Nur privat, wenn nicht gleichzeitig POI/Firma/Einrichtung
          if (!looksLikePoi(e.tags)) {
            const k = addrKey(addr);
            // Privat nur, wenn nicht schon durch Gebäude belegt (kommt später auch noch, aber wir filtern final nach buildings)
            if (!seenPrivateAddr.has(k)) {
              privateAddrs.push({
                ...addr,
                lat: e.lat,
                lon: e.lon,
                source: "node",
                osm_id: e.id,
                _key: k,
              });
              seenPrivateAddr.add(k);
            }
          }
        }
      }

      nodesSeen++;
      if (nodesSeen % 500000 === 0) {
        console.log(`[${new Date().toISOString()}] Nodes: ${nodesSeen} (nodeMap: ${nodeMap.size}) …`);
      }
      continue;
    }

    if (e.type === "way") {
      waysSeen++;
      const tags = e.tags || {};
      const addr = extractAddress(tags);

      // A) Gebäude-Ausgabe (wie extract_pois_feldkirchen.mjs)
      if (addr && isBuilding(tags)) {
        const cent = centroidFromRefs(e.refs, nodeMap);
        if (cent && typeof cent.lat === "number" && typeof cent.lon === "number" && pointInBezirk(cent.lon, cent.lat)) {
          const k = addrKey(addr);
          // Dedupe Gebäude nach Adresse (keine Doppelten)
          if (!seenBuildingsAddr.has(k)) {
            seenBuildingsAddr.add(k);
            buildings.push({
              osm_id: e.id,
              osm_type: "way",
              name: tags["name"] || "",
              building: String(tags["building"]),
              ...addr,
              lat: cent.lat,
              lon: cent.lon,
            });
          }
        }
        continue;
      }

      // B) Privatadresse als Way ohne building (selten, aber möglich: addr:* auf Flächen, Grundstücke, etc.)
      if (addr && !isBuilding(tags)) {
        // Nur wenn wir Koordinaten ableiten können
        const cent = centroidFromRefs(e.refs, nodeMap);
        if (cent && typeof cent.lat === "number" && typeof cent.lon === "number" && pointInBezirk(cent.lon, cent.lat)) {
          // Nur privat, wenn nicht gleichzeitig POI/Firma/Einrichtung
          if (!looksLikePoi(tags)) {
            const k = addrKey(addr);
            if (!seenPrivateAddr.has(k)) {
              privateAddrs.push({
                ...addr,
                lat: cent.lat,
                lon: cent.lon,
                source: "way",
                osm_id: e.id,
                _key: k,
              });
              seenPrivateAddr.add(k);
            }
          }
        }
      }

      if (waysSeen % 200000 === 0) {
        console.log(
          `[${new Date().toISOString()}] Ways: ${waysSeen} | Gebäude: ${buildings.length} | Privat: ${privateAddrs.length}`
        );
      }
    }
  }

  // Finaler Privat-Filter: Alles entfernen, was eine Gebäude-Adresse dupliziert
  const privateFinal = privateAddrs.filter((p) => !seenBuildingsAddr.has(p._key));

  // Output schreiben
  await buildingsWriter.writeRecords(buildings);
  await privateWriter.writeRecords(
    privateFinal.map(({ _key, ...rest }) => rest)
  );

  console.log(`[${new Date().toISOString()}] Fertig.`);
  console.log(`  Gebäude (dedupliziert):        ${buildings.length} -> ${OUT_BUILDINGS}`);
  console.log(`  Privatadressen (dedupliziert): ${privateFinal.length} -> ${OUT_PRIVATE}`);
}

run().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
