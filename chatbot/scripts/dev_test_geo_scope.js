#!/usr/bin/env node
// chatbot/scripts/dev_test_geo_scope.js
// Dev-Test: Geo-Scope Filtering, Ingest-Normalisierung, Intent-Erkennung
// Ausfuehrung: cd chatbot && node scripts/dev_test_geo_scope.js

import {
  normalizeDocType,
  promoteFlatFields,
  deriveOsmNormFields,
  normalizeJsonlRecord,
  buildChunkMetadata
} from "../server/rag/jsonl_utils.js";

import { validateAndNormalizeJsonlRecord } from "../server/rag/jsonl_schema_validator.js";
import { applyBboxFilterToLocations } from "../server/rag/geo_search.js";
import { detectIntent, hasGeoContext, IntentTypes } from "../server/rag/query_router.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
    return;
  }
  console.log(`  PASS: ${message}`);
  passed++;
}

function group(name) {
  console.log(`\n=== ${name} ===`);
}

// ============================================================
// 1. normalizeDocType
// ============================================================
group("1. normalizeDocType (Bug B: Plural -> Singular)");

assert(normalizeDocType("addresses") === "address", "addresses -> address");
assert(normalizeDocType("buildings") === "building", "buildings -> building");
assert(normalizeDocType("pois") === "poi", "pois -> poi");
assert(normalizeDocType("poi") === "poi", "poi bleibt poi");
assert(normalizeDocType("address") === "address", "address bleibt address");
assert(normalizeDocType("") === "document_snippet", "leer -> document_snippet");
assert(normalizeDocType(null) === "document_snippet", "null -> document_snippet");
assert(normalizeDocType("municipality_index") === "municipality_index", "municipality_index unverändert");

// ============================================================
// 2. promoteFlatFields
// ============================================================
group("2. promoteFlatFields (Bug G: Flat -> Nested)");

const flat1 = { lat: 46.72, lon: 14.09, street: "Hauptstr.", housenumber: "1", postcode: "9560", place: "Feldkirchen" };
promoteFlatFields(flat1);
assert(flat1.geo?.lat === 46.72, "geo.lat erstellt");
assert(flat1.geo?.lon === 14.09, "geo.lon erstellt");
assert(flat1.address?.street === "Hauptstr.", "address.street erstellt");
assert(flat1.address?.postcode === "9560", "address.postcode erstellt");
assert(flat1.address?.city === "Feldkirchen", "address.city = place");
assert(flat1.address?.municipality === "Feldkirchen", "address.municipality = place");

// Bereits nested -> nicht ueberschreiben
const nested1 = { lat: 99, lon: 99, geo: { lat: 46.5, lon: 13.8 } };
promoteFlatFields(nested1);
assert(nested1.geo.lat === 46.5, "nested geo nicht ueberschrieben");

// ids promotion
const flat2 = { osm_type: "node", osm_id: 12345 };
promoteFlatFields(flat2);
assert(flat2.ids?.osm_type === "node", "ids.osm_type erstellt");
assert(flat2.ids?.osm_id === 12345, "ids.osm_id erstellt");

// address als String -> full
const flat3 = { address: "Hauptstr. 1, 9560 Feldkirchen" };
promoteFlatFields(flat3);
assert(flat3.address?.full === "Hauptstr. 1, 9560 Feldkirchen", "address string -> address.full");

// ============================================================
// 3. deriveOsmNormFields
// ============================================================
group("3. deriveOsmNormFields (Bug C: Category-Normalisierung)");

const poi1 = { category: "amenity:hospital", tags: { amenity: "hospital" } };
deriveOsmNormFields(poi1);
assert(poi1.category_norm === "amenity:hospital", "category_norm aus category");
assert(poi1.poi_class === "hospital", "poi_class = hospital");
assert(poi1.primary_tag_key === "amenity", "primary_tag_key = amenity");

const poi2 = { tags: { shop: "bakery", amenity: "cafe" } };
deriveOsmNormFields(poi2);
assert(poi2.category_norm === "amenity:cafe", "amenity hat Prioritaet vor shop");

const poi3 = { tags: { craft: "plumber" } };
deriveOsmNormFields(poi3);
assert(poi3.category_norm === "craft:plumber", "craft aus tags");

const poi4 = { tags: { tourism: "hotel" } };
deriveOsmNormFields(poi4);
assert(poi4.category_norm === "tourism:hotel", "tourism aus tags");

const poi5 = { category: "generic_building" };
deriveOsmNormFields(poi5);
assert(poi5.category_norm === "generic_building", "fallback: category as-is");

const poi6 = {};
deriveOsmNormFields(poi6);
assert(poi6.category_norm === undefined, "kein category -> undefined");

// ============================================================
// 4. Full Pipeline: normalizeJsonlRecord
// ============================================================
group("4. normalizeJsonlRecord (Full Pipeline)");

const raw1 = {
  doc_type: "addresses",
  source: "OSM",
  lat: 46.72,
  lon: 14.09,
  street: "Teststr.",
  housenumber: "5",
  place: "Waiern",
  category: "amenity:restaurant",
  tags: { amenity: "restaurant" },
  content: "Test Restaurant"
};
const norm1 = normalizeJsonlRecord(raw1, "");
assert(norm1 !== null, "Record nicht null");
assert(norm1.doc_type === "address", "doc_type: addresses -> address");
assert(norm1.geo?.lat === 46.72, "flat lat promoted");
assert(norm1.geo?.lon === 14.09, "flat lon promoted");
assert(norm1.address?.street === "Teststr.", "flat street promoted");
assert(norm1.category_norm === "amenity:restaurant", "category_norm gesetzt");
assert(norm1.poi_class === "restaurant", "poi_class gesetzt");

// ============================================================
// 5. validateAndNormalizeJsonlRecord
// ============================================================
group("5. validateAndNormalizeJsonlRecord (Backward Compat)");

const result1 = validateAndNormalizeJsonlRecord({
  doc_type: "addresses",
  source: "OSM",
  content: "Test addr",
  lat: 46.72,
  lon: 14.09,
  category: "shop:supermarket"
});
assert(result1.ok === true, "validator: Record akzeptiert");
assert(result1.record.doc_type === "address", "validator: doc_type normalisiert");
assert(result1.record.geo?.lat === 46.72, "validator: flat lat promoted");
assert(result1.record.category_norm === "shop:supermarket", "validator: category_norm");

// ============================================================
// 6. buildChunkMetadata
// ============================================================
group("6. buildChunkMetadata (Neue Felder)");

const metaRecord = {
  doc_id: "test-1",
  doc_type: "poi",
  source: "OSM",
  category: "amenity:hospital",
  category_norm: "amenity:hospital",
  primary_tag_key: "amenity",
  primary_tag_value: "hospital",
  poi_class: "hospital",
  title: "LKH Feldkirchen",
  name: "LKH",
  geo: { lat: 46.72, lon: 14.09 }
};
const meta = buildChunkMetadata(metaRecord);
assert(meta.category_norm === "amenity:hospital", "category_norm in Metadata");
assert(meta.poi_class === "hospital", "poi_class in Metadata");
assert(meta.primary_tag_key === "amenity", "primary_tag_key in Metadata");
assert(meta.geo?.lat === 46.72, "geo in Metadata");

// ============================================================
// 7. detectIntent
// ============================================================
group("7. detectIntent (Neue IntentTypes)");

const i1 = detectIntent("Das nächste Krankenhaus");
assert(i1.type === IntentTypes.GEO_NEAREST_POI, "naechste Krankenhaus -> GEO_NEAREST_POI");
assert(i1.params.categoryNorm === "amenity:hospital", "categoryNorm = amenity:hospital");

const i2 = detectIntent("Wieviele Gebäude sind im Einsatzbereich");
assert(i2.type === IntentTypes.GEO_COUNT, "wieviele Gebaeude -> GEO_COUNT");
assert(i2.params.docTypeFilter === "building", "docTypeFilter = building");

const i3 = detectIntent("Alle Restaurants in der Umgebung");
assert(i3.type === IntentTypes.GEO_LIST, "alle Restaurants -> GEO_LIST");
assert(i3.params.categoryNorm === "amenity:restaurant", "categoryNorm = amenity:restaurant");

const i4 = detectIntent("Wie ist das Wetter heute");
assert(i4.type === IntentTypes.SEMANTIC, "Wetter -> SEMANTIC");

const i5 = detectIntent("Gibt es in Feldkirchen ein Restaurant");
assert(i5.type === IntentTypes.GEO_LIST, "gibt es in ... Restaurant -> GEO_LIST");
assert(i5.params.categoryNorm === "amenity:restaurant", "categoryNorm korrekt");

const i6 = detectIntent("Nächste Polizei");
assert(i6.type === IntentTypes.GEO_NEAREST_POI, "naechste Polizei -> GEO_NEAREST_POI");
assert(i6.params.categoryNorm === "amenity:police", "categoryNorm = amenity:police");

const i7 = detectIntent("Wie viele Adressen gibt es");
assert(i7.type === IntentTypes.GEO_COUNT, "wie viele Adressen -> GEO_COUNT");

// ============================================================
// 8. hasGeoContext
// ============================================================
group("8. hasGeoContext");

assert(hasGeoContext("Wo ist das nächste Krankenhaus") === true, "Krankenhaus = geo");
assert(hasGeoContext("Wie ist das Wetter heute") === false, "Wetter = kein geo");
assert(hasGeoContext("Adresse der Feuerwehr") === true, "Adresse = geo");
assert(hasGeoContext("Gibt es in Feldkirchen ein Hotel") === true, "gibt es in ... = geo");
assert(hasGeoContext("Wieviele Gebäude gibt es") === true, "wieviele Gebaeude = geo");
assert(hasGeoContext("Erzähle mir einen Witz") === false, "Witz = kein geo");
assert(hasGeoContext("Wo befindet sich die Polizei") === true, "wo befindet = geo");
assert(hasGeoContext("Nächste Apotheke") === true, "naechste = geo");

// ============================================================
// 9. BBOX-Filtering
// ============================================================
group("9. BBOX-Filtering (applyBboxFilterToLocations)");

const locs = [
  { id: "in-1", doc_type: "address", lat: 12, lon: 12 },
  { id: "in-2", doc_type: "poi", category_norm: "amenity:hospital", lat: 15, lon: 15 },
  { id: "out-1", doc_type: "address", lat: 5, lon: 5 },
  { id: "no-filter", doc_type: "document_snippet", lat: 50, lon: 50 }
];

// BBox [10, 10, 20, 20] = minLon=10, minLat=10, maxLon=20, maxLat=20
const filtered = applyBboxFilterToLocations(locs, {
  bbox: [10, 10, 20, 20],
  applyBbox: true,
  docTypes: ["address", "poi"]
});

assert(filtered.length === 3, "3 Locations nach Filter (2 in-bbox + 1 kein doc_type match)");
assert(filtered.find(l => l.id === "in-1") !== undefined, "in-1 (in bbox) behalten");
assert(filtered.find(l => l.id === "in-2") !== undefined, "in-2 (in bbox) behalten");
assert(filtered.find(l => l.id === "out-1") === undefined, "out-1 (out of bbox) entfernt");
assert(filtered.find(l => l.id === "no-filter") !== undefined, "no-filter (doc_type nicht in Filter) behalten");

// Ohne applyBbox -> alles durchlassen
const unfiltered = applyBboxFilterToLocations(locs, { applyBbox: false });
assert(unfiltered.length === 4, "ohne applyBbox: alle 4 behalten");

// ============================================================
// 10. Simulations-Test: BBox + GeoScope
// ============================================================
group("10. Simulations-Test: Query mit requestBbox + geoScope=BBOX");

// Simulierte BBox (Waiern-Bereich: ca. 46.70-46.75, 14.07-14.12)
const testBbox = [14.07, 46.70, 14.12, 46.75];
const testLocations = [
  { id: "waiern-hospital", doc_type: "poi", category_norm: "amenity:hospital", lat: 46.72, lon: 14.09, name: "KH Waiern" },
  { id: "klagenfurt-hospital", doc_type: "poi", category_norm: "amenity:hospital", lat: 46.62, lon: 14.31, name: "KH Klagenfurt" },
  { id: "waiern-addr", doc_type: "address", lat: 46.71, lon: 14.08, name: "Addr Waiern" },
  { id: "villach-hospital", doc_type: "poi", category_norm: "amenity:hospital", lat: 46.61, lon: 13.85, name: "KH Villach" }
];

const bboxFiltered = applyBboxFilterToLocations(testLocations, {
  bbox: testBbox,
  applyBbox: true,
  docTypes: ["address", "poi", "building"]
});

assert(bboxFiltered.length === 2, "BBox Waiern: 2 Treffer (1 Hospital + 1 Adresse)");
assert(bboxFiltered.find(l => l.id === "waiern-hospital") !== undefined, "Waiern Hospital in BBox");
assert(bboxFiltered.find(l => l.id === "waiern-addr") !== undefined, "Waiern Adresse in BBox");
assert(bboxFiltered.find(l => l.id === "klagenfurt-hospital") === undefined, "Klagenfurt Hospital NICHT in BBox");
assert(bboxFiltered.find(l => l.id === "villach-hospital") === undefined, "Villach Hospital NICHT in BBox");

// ============================================================
// Zusammenfassung
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`Ergebnis: ${passed} PASS, ${failed} FAIL`);
console.log(`${"=".repeat(50)}`);

if (failed > 0) {
  process.exitCode = 1;
}
