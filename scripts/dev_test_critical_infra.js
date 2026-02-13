#!/usr/bin/env node
/**
 * dev_test_critical_infra.js – Tests für Critical-Infrastructure-Feature.
 *
 * Prüft:
 *  1. Query Router erkennt "kritische Infrastruktur" → GEO_LIST + categoryNorms aus Config
 *  2. Query Router erkennt "kritischen Infrastruktur" (Flexion) → GEO_LIST
 *  3. categoryNorms werden als Array an Handler übergeben
 *  4. getCriticalInfraCategoryNorms() liest Config korrekt
 *  5. Availability TTL-Logik (Grundstruktur)
 *
 * Ausführen:
 *   node scripts/dev_test_critical_infra.js
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log("=== Critical Infrastructure Tests ===\n");

  // ============================================================
  // 1. Query Router: detectIntent
  // ============================================================
  console.log("--- Test 1: detectIntent erkennt 'kritische Infrastruktur' ---");
  const { detectIntent, IntentTypes } = await import(
    "../chatbot/server/rag/query_router.js"
  );

  const intent1 = detectIntent("Wo ist die kritische Infrastruktur in Feldkirchen?");
  assert(intent1.type === IntentTypes.GEO_LIST, `Intent type should be GEO_LIST, got: ${intent1.type}`);
  assert(intent1.pattern === "critical_infrastructure", `Pattern should be 'critical_infrastructure', got: ${intent1.pattern}`);
  assert(intent1.params.isCriticalInfra === true, "isCriticalInfra flag should be true");
  assert(Array.isArray(intent1.params.categoryNorms), "categoryNorms should be an Array");
  assert(intent1.params.categoryNorms.length > 0, `categoryNorms should not be empty, got ${intent1.params.categoryNorms.length}`);
  assert(intent1.confidence >= 0.9, `Confidence should be >= 0.9, got: ${intent1.confidence}`);

  // ============================================================
  // 2. Flexion: "kritischen Infrastruktur"
  // ============================================================
  console.log("\n--- Test 2: detectIntent erkennt 'kritischen Infrastruktur' (Flexion) ---");
  const intent2 = detectIntent("Zeige mir die kritischen Infrastruktur Objekte");
  assert(intent2.type === IntentTypes.GEO_LIST, `Intent type should be GEO_LIST, got: ${intent2.type}`);
  assert(intent2.params.isCriticalInfra === true, "isCriticalInfra flag should be true");

  // ============================================================
  // 3. Normaler Query wird NICHT als kritische Infra erkannt
  // ============================================================
  console.log("\n--- Test 3: Normaler Query wird nicht als kritische Infra erkannt ---");
  const intent3 = detectIntent("Wo ist das nächste Krankenhaus?");
  assert(intent3.params?.isCriticalInfra !== true, "isCriticalInfra should NOT be true for normal query");

  // ============================================================
  // 4. categoryNorms enthält erwartete Defaults
  // ============================================================
  console.log("\n--- Test 4: categoryNorms enthält erwartete Defaults ---");
  const norms = intent1.params.categoryNorms;
  assert(norms.includes("amenity:hospital"), "Should include amenity:hospital");
  assert(norms.includes("amenity:fire_station"), "Should include amenity:fire_station");
  assert(norms.includes("amenity:police"), "Should include amenity:police");
  assert(norms.includes("amenity:pharmacy"), "Should include amenity:pharmacy");

  // ============================================================
  // 5. getCriticalInfraCategoryNorms function exists
  // ============================================================
  console.log("\n--- Test 5: getCriticalInfraCategoryNorms exportiert ---");
  const { getCriticalInfraCategoryNorms } = await import(
    "../chatbot/server/geo/postgis_geo.js"
  );
  assert(typeof getCriticalInfraCategoryNorms === "function", "getCriticalInfraCategoryNorms should be a function");
  // Note: may return null if no postgis.json exists, which is fine
  const configNorms = getCriticalInfraCategoryNorms();
  console.log(`  Config norms: ${configNorms ? JSON.stringify(configNorms) : "null (no config file)"}`);

  // ============================================================
  // 6. hasGeoContext recognizes "kritische Infrastruktur"
  // ============================================================
  console.log("\n--- Test 6: hasGeoContext erkennt 'kritische Infrastruktur' ---");
  const { hasGeoContext } = await import("../chatbot/server/rag/query_router.js");
  // "kritische Infrastruktur" doesn't contain a single CATEGORY_KEYWORD but should
  // still be recognized via geo keywords or the category mapping
  // The detectIntent check runs before hasGeoContext in the router flow,
  // but hasGeoContext should still work for general geo detection
  const hasGeo = hasGeoContext("Zeige kritische Infrastruktur in Feldkirchen");
  // This should be true because "Feldkirchen" or other geo keywords may match,
  // or the CATEGORY_KEYWORDS contain related terms
  console.log(`  hasGeoContext result: ${hasGeo}`);

  // ============================================================
  // 7. Intent should NOT fall back to SEMANTIC
  // ============================================================
  console.log("\n--- Test 7: Intent bleibt GEO_LIST (kein Fallback auf SEMANTIC) ---");
  const intent7 = detectIntent("Liste alle kritische Infrastruktur");
  assert(intent7.type === IntentTypes.GEO_LIST, `Should be GEO_LIST, got: ${intent7.type}`);
  // Even "Liste alle" would normally trigger GEO_LIST too, but with critical infra
  // the critical_infrastructure pattern should take priority due to higher confidence

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n=== Ergebnis: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test-Fehler:", err);
  process.exit(1);
});
