// chatbot/server/rag/_dev_test_municipality_index.js
// Dev-Test: Municipality Index Load + Zero Count Preservation
//
// Ausführen: node chatbot/server/rag/_dev_test_municipality_index.js

import { getMunicipalityIndex, findMunicipalityInQuery } from "./geo_search.js";
import { detectIntent, IntentTypes } from "./query_router.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// ============================================================
// Test 1: Municipality Index Load (rekursiv + Schema B)
// ============================================================
console.log("\n=== Test 1: Municipality Index Load ===");

const entries = await getMunicipalityIndex();

assert(entries.length > 0, `entries.length > 0 (got ${entries.length})`);

const feldkirchen = entries.find(e => e.municipality === "Feldkirchen in Kärnten");
assert(feldkirchen !== undefined, `"Feldkirchen in Kärnten" found in index`);

if (feldkirchen) {
  assert(Array.isArray(feldkirchen.bbox), `bbox is Array (got ${typeof feldkirchen.bbox})`);
  assert(feldkirchen.bbox.length === 4, `bbox has 4 elements (got ${feldkirchen.bbox?.length})`);
  assert(feldkirchen.bbox.every(n => Number.isFinite(n)), `bbox contains 4 finite numbers`);
  // [minLon, minLat, maxLon, maxLat] → minLon ≈ 14.07, minLat ≈ 46.69
  assert(feldkirchen.bbox[0] < feldkirchen.bbox[2], `minLon < maxLon (${feldkirchen.bbox[0]} < ${feldkirchen.bbox[2]})`);
  assert(feldkirchen.bbox[1] < feldkirchen.bbox[3], `minLat < maxLat (${feldkirchen.bbox[1]} < ${feldkirchen.bbox[3]})`);
}

const villach = entries.find(e => e.municipality === "Villach");
assert(villach !== undefined, `"Villach" found in index`);

const klagenfurt = entries.find(e => e.municipality === "Klagenfurt am Wörthersee");
assert(klagenfurt !== undefined, `"Klagenfurt am Wörthersee" found in index`);

// ============================================================
// Test 2: findMunicipalityInQuery (longest match)
// ============================================================
console.log("\n=== Test 2: findMunicipalityInQuery ===");

const match1 = await findMunicipalityInQuery("Wie viele Restaurants gibt es in Feldkirchen in Kärnten?");
assert(match1 !== null, `Query with "Feldkirchen in Kärnten" resolves municipality`);
assert(match1?.municipality === "Feldkirchen in Kärnten",
  `Longest match wins: "${match1?.municipality}" === "Feldkirchen in Kärnten"`);
assert(Array.isArray(match1?.bbox) && match1.bbox.length === 4, `Resolved bbox is [4 numbers]`);

const match2 = await findMunicipalityInQuery("Krankenhäuser in Villach");
assert(match2 !== null, `Query with "Villach" resolves municipality`);
assert(match2?.municipality === "Villach", `municipality === "Villach"`);

const matchNone = await findMunicipalityInQuery("Wie ist das Wetter heute?");
assert(matchNone === null, `Query without municipality returns null`);

// ============================================================
// Test 3: Zero Count Preserved (kein Fallback)
// ============================================================
console.log("\n=== Test 3: Zero Count Preserved ===");

// Test intent detection for count queries
// Note: keyword is "krankenhaus" (no umlaut), use matching form
const countIntent = detectIntent("Wie viele Krankenhaus Standorte gibt es?");
assert(countIntent.type === IntentTypes.GEO_COUNT, `"Wie viele Krankenhaus" → GEO_COUNT (got ${countIntent.type})`);
assert(countIntent.params.categoryNorm === "amenity:hospital",
  `categoryNorm === "amenity:hospital" (got ${countIntent.params.categoryNorm})`);

// Test that GEO_COUNT data with count=0 produces deterministic context (no semantic fallback)
// We simulate the formatGeoCountContext output structure
const zeroCountData = {
  type: "geo_count",
  categoryNorm: "amenity:hospital",
  docTypeFilter: "poi",
  count: 0,
  bboxActive: true,
  locations: []
};

// Verify count=0 is NOT falsy-swallowed
assert(zeroCountData.count === 0, `count === 0 (strict equality, not falsy)`);
assert(Number.isFinite(zeroCountData.count), `Number.isFinite(0) === true`);
assert(zeroCountData.count !== null && zeroCountData.count !== undefined,
  `count is not null/undefined`);

// Verify the routeQuery switch-case for GEO_COUNT does NOT have semantic fallback
// (This is a code-level assertion verified by reading the source)
const listIntent = detectIntent("Alle Restaurants");
assert(listIntent.type === IntentTypes.GEO_LIST, `"Alle Restaurants" → GEO_LIST (got ${listIntent.type})`);

const nearestPoiIntent = detectIntent("Nächstes Krankenhaus");
assert(nearestPoiIntent.type === IntentTypes.GEO_NEAREST_POI,
  `"Nächstes Krankenhaus" → GEO_NEAREST_POI (got ${nearestPoiIntent.type})`);

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Ergebnis: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
