// chatbot/server/test_jsonl_ingest.js
// Tests für JSONL-Ingest, Geo-Index und Filter

import fs from "fs/promises";
import os from "os";
import path from "path";
import { chunkText } from "./rag/chunk.js";
import { normalizeJsonlRecord } from "./rag/jsonl_utils.js";
import { GeoIndex } from "./rag/geo_search.js";
import { filterChunkIndices } from "./rag/rag_vector.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const lines = [
    JSON.stringify({
      schema_version: "einfo-jsonl-1.0",
      doc_id: "osm:node:123",
      doc_type: "poi",
      source: "OSM",
      region: "Kärnten",
      title: "LKH Villach",
      content: "LKH Villach\nKategorie: amenity:hospital",
      geo: { lat: 46.61, lon: 13.85 }
    }),
    JSON.stringify({
      schema_version: "einfo-jsonl-1.0",
      doc_id: "osm:node:456",
      doc_type: "address",
      source: "OSM",
      region: "Kärnten",
      title: "Leitenweg 3, 9560 Feldkirchen",
      address: { street: "Leitenweg", housenumber: "3", postcode: "9560", city: "Feldkirchen" },
      geo: { lat: 46.72, lon: 14.1 }
    }),
    JSON.stringify({
      schema_version: "einfo-jsonl-1.0",
      doc_id: "osm:street_stats:leitenweg:feldkirchen",
      doc_type: "street_stats",
      source: "OSM",
      region: "Kärnten",
      title: "Leitenweg (Statistik)",
      stats: { buildings: 120, addresses: 95, pois: 4 },
      address: { street: "Leitenweg", city: "Feldkirchen" },
      content: "Straße: Leitenweg\nOrt: Feldkirchen\nGebäude: 120"
    }),
    JSON.stringify({
      schema_version: "einfo-jsonl-1.0",
      doc_id: "internal:poi:hydrant:FK-001",
      doc_type: "poi",
      source: "EINFO",
      region: "Kärnten",
      title: "Hydrant FK-001",
      category: "hydrant",
      address: { street: "Hauptstraße", housenumber: "1", city: "Feldkirchen" },
      geo: { lat: 46.71, lon: 14.09 }
    }),
    "{invalid json line"
  ];

  const records = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeJsonlRecord(parsed, line);
      if (normalized) {
        records.push(normalized);
      }
    } catch (error) {
      // Fehlerhafte Zeile bewusst überspringen
    }
  }

  assert(records.length === 4, "Erwartet 4 valide JSONL-Records");
  const fallbackRecord = records.find(r => r.doc_id === "internal:poi:hydrant:FK-001");
  assert(fallbackRecord?.content, "Fallback-Content wurde nicht erzeugt");

  let chunkCount = 0;
  for (const record of records) {
    const chunks =
      record.content.length > 1200
        ? chunkText(record.content, 1000, 200).slice(0, 3)
        : [record.content];
    chunkCount += chunks.length;
  }

  assert(chunkCount === 4, `Erwartet 4 Chunks, erhalten: ${chunkCount}`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "einfo-jsonl-"));
  const tmpFile = path.join(tmpDir, "test_locations.jsonl");
  await fs.writeFile(tmpFile, lines.slice(0, 2).join("\n"), "utf8");

  const geoIndex = new GeoIndex();
  await geoIndex.parseJsonlFile(tmpFile, "test_locations.jsonl");
  assert(geoIndex.locations.length >= 1, "GeoIndex hat keine Locations geladen");

  const chunkMeta = [
    { meta: { doc_type: "poi" } },
    { meta: { doc_type: "street_stats" } },
    { meta: { doc_type: "address" } }
  ];
  const filtered = filterChunkIndices(chunkMeta, { doc_type: "street_stats" });
  assert(filtered.length === 1, "Doc-Type-Filter liefert falsche Anzahl");

  console.log("✅ JSONL-Ingest Tests erfolgreich.");
}

run().catch((error) => {
  console.error("❌ JSONL-Ingest Tests fehlgeschlagen:", error.message);
  process.exit(1);
});
