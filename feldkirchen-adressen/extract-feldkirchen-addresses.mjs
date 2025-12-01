import fs from 'fs';
import osmium from 'node-osmium';
import * as turf from '@turf/turf';
import { createObjectCsvWriter } from 'csv-writer';

// === KONFIGURATION ===
const PBF_FILE = 'D:/osm/austria-latest.osm.pbf';           // Pfad anpassen!
const BOUNDARY_FILE = './bezirk_feldkirchen.geojson';       // Pfad anpassen!
const OUTPUT_CSV = './adressen_bezirk_feldkirchen.csv';

// === 1. Bezirks-Grenze laden (GeoJSON) ===
const boundaryGeojson = JSON.parse(fs.readFileSync(BOUNDARY_FILE, 'utf8'));

// Falls das GeoJSON mehrere Features enthält, das erste nehmen:
let boundaryFeature;
if (boundaryGeojson.type === 'FeatureCollection') {
  boundaryFeature = boundaryGeojson.features[0];
} else if (boundaryGeojson.type === 'Feature') {
  boundaryFeature = boundaryGeojson;
} else {
  throw new Error('Unerwartetes GeoJSON-Format für Boundary.');
}

const boundaryPolygon = turf.feature(boundaryFeature.geometry);

// === 2. CSV-Writer vorbereiten ===
const csvWriter = createObjectCsvWriter({
  path: OUTPUT_CSV,
  header: [
    { id: 'osm_id', title: 'OSM_ID' },
    { id: 'osm_type', title: 'OSM_TYPE' },
    { id: 'street', title: 'STRASSE' },
    { id: 'housenumber', title: 'HAUSNUMMER' },
    { id: 'postcode', title: 'PLZ' },
    { id: 'city', title: 'ORT' },
    { id: 'lat', title: 'LAT' },
    { id: 'lon', title: 'LON' }
  ]
});

// Zwischenspeicher für CSV-Einträge (wird regelmäßig geleert)
const buffer = [];
const BUFFER_LIMIT = 5000;

// === 3. Hilfsfunktion: Punkt aus Node/Way berechnen ===
function getPointFromOSMObject(obj) {
  if (obj.type === 'node') {
    const lon = obj.lon;
    const lat = obj.lat;
    if (typeof lon === 'number' && typeof lat === 'number') {
      return turf.point([lon, lat]);
    }
  }

  // Für Ways / Beziehungen -> Schwerpunkt
  if (obj.type === 'way') {
    // Liste der Knoten-Koordinaten holen
    const coords = obj.node_coords()
      .map(nc => [nc.lon, nc.lat])
      .filter(c => typeof c[0] === 'number' && typeof c[1] === 'number');

    if (coords.length > 0) {
      // Geometrie als Polygon oder LineString approximieren; hier: MultiPoint -> Mittelpunkt
      const multipoint = turf.multiPoint(coords);
      const centroid = turf.centroid(multipoint);
      return centroid;
    }
  }

  // Für einfache Zwecke ignorieren wir Relations oder behandeln sie später
  return null;
}

// === 4. Adress-Tags auslesen ===
function extractAddressTags(tags) {
  const street = tags['addr:street'] || '';
  const housenumber = tags['addr:housenumber'] || '';
  const postcode = tags['addr:postcode'] || '';
  const city = tags['addr:city'] || tags['addr:place'] || '';

  // Nur relevante Adressen behalten (mind. Hausnummer)
  if (!housenumber) {
    return null;
  }

  return { street, housenumber, postcode, city };
}

// === 5. PBF einlesen und filtern ===

console.log(`[${new Date().toISOString()}] Starte Verarbeitung von ${PBF_FILE} ...`);

const reader = new osmium.Reader(PBF_FILE);
const handler = new osmium.Handler();

// NODEs mit addr:housenumber
handler.on('node', node => {
  const addr = extractAddressTags(node.tags());
  if (!addr) return;

  const pt = getPointFromOSMObject(node);
  if (!pt) return;

  if (turf.booleanPointInPolygon(pt, boundaryPolygon)) {
    buffer.push({
      osm_id: node.id,
      osm_type: 'node',
      street: addr.street,
      housenumber: addr.housenumber,
      postcode: addr.postcode,
      city: addr.city,
      lat: pt.geometry.coordinates[1],
      lon: pt.geometry.coordinates[0]
    });

    if (buffer.length >= BUFFER_LIMIT) {
      reader.pause();
      csvWriter.writeRecords(buffer.splice(0, buffer.length))
        .then(() => {
          console.log(`[${new Date().toISOString()}] ${BUFFER_LIMIT} Einträge in CSV geschrieben (Nodes).`);
          reader.resume();
        })
        .catch(err => {
          console.error('Fehler beim Schreiben der CSV (Nodes):', err);
          process.exit(1);
        });
    }
  }
});

// WAYs mit addr:housenumber (z. B. Gebäude)
handler.on('way', way => {
  const addr = extractAddressTags(way.tags());
  if (!addr) return;

  const pt = getPointFromOSMObject(way);
  if (!pt) return;

  if (turf.booleanPointInPolygon(pt, boundaryPolygon)) {
    buffer.push({
      osm_id: way.id,
      osm_type: 'way',
      street: addr.street,
      housenumber: addr.housenumber,
      postcode: addr.postcode,
      city: addr.city,
      lat: pt.geometry.coordinates[1],
      lon: pt.geometry.coordinates[0]
    });

    if (buffer.length >= BUFFER_LIMIT) {
      reader.pause();
      csvWriter.writeRecords(buffer.splice(0, buffer.length))
        .then(() => {
          console.log(`[${new Date().toISOString()}] ${BUFFER_LIMIT} Einträge in CSV geschrieben (Ways).`);
          reader.resume();
        })
        .catch(err => {
          console.error('Fehler beim Schreiben der CSV (Ways):', err);
          process.exit(1);
        });
    }
  }
});

// === 6. Verarbeitung starten ===
osmium.apply(reader, handler);

// === 7. Ende: restlichen Buffer schreiben ===
reader.on('end', () => {
  console.log(`[${new Date().toISOString()}] PBF-Datei vollständig gelesen, schreibe Rest-Buffer ...`);

  if (buffer.length > 0) {
    csvWriter.writeRecords(buffer)
      .then(() => {
        console.log(`[${new Date().toISOString()}] Fertig. Adressen gespeichert in: ${OUTPUT_CSV}`);
      })
      .catch(err => {
        console.error('Fehler beim Schreiben der letzten CSV-Einträge:', err);
      });
  } else {
    console.log('Keine Adressen im Buffer, nichts mehr zu schreiben.');
  }
});
