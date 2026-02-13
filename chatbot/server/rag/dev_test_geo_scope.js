#!/usr/bin/env node
// chatbot/server/rag/dev_test_geo_scope.js
// Einfache Tests für geo_scope.js — Ausführung: node chatbot/server/rag/dev_test_geo_scope.js

import { detectExplicitScope, shouldApplyGeoFence, resolveCenterPoint } from "./geo_scope.js";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

// ============================================================
// 1) detectExplicitScope
// ============================================================
console.log("\n=== detectExplicitScope ===");

// LOCAL keywords
assert(detectExplicitScope("Wie viele Gebäude gibt es im Einsatzbereich?").mode === "LOCAL", "im Einsatzbereich → LOCAL");
assert(detectExplicitScope("nächste Polizeistation").mode === "LOCAL", "nächste → LOCAL");
assert(detectExplicitScope("Was ist in der Nähe?").mode === "LOCAL", "in der Nähe → LOCAL");
assert(detectExplicitScope("im Umkreis von 5km").mode === "LOCAL", "im Umkreis → LOCAL");
assert(detectExplicitScope("Welche Objekte sind im Bereich?").mode === "LOCAL", "im Bereich → LOCAL");
assert(detectExplicitScope("Umgebung prüfen").mode === "LOCAL", "Umgebung → LOCAL");

// GLOBAL keywords
assert(detectExplicitScope("Österreichweit: Wie viele Krankenhäuser gibt es?").mode === "GLOBAL", "Österreichweit → GLOBAL");
assert(detectExplicitScope("bundesweite Übersicht").mode === "GLOBAL", "bundesweit → GLOBAL");
assert(detectExplicitScope("allgemein gültige Regeln").mode === "GLOBAL", "allgemein → GLOBAL");
assert(detectExplicitScope("unabhängig vom Einsatz").mode === "GLOBAL", "unabhängig vom Einsatz → GLOBAL");
assert(detectExplicitScope("überregionale Ressourcen").mode === "GLOBAL", "überregional → GLOBAL");
assert(detectExplicitScope("Regeln in Kärnten").mode === "GLOBAL", "in Kärnten → GLOBAL");

// AUTO (kein expliziter Scope)
assert(detectExplicitScope("Was sagt das Katastrophenschutzgesetz?").mode === "AUTO", "Gesetz → AUTO");
assert(detectExplicitScope("Wie funktioniert ein Einsatzstab?").mode === "AUTO", "Allg. Frage → AUTO");
assert(detectExplicitScope("").mode === "AUTO", "Leerer String → AUTO");
assert(detectExplicitScope(null).mode === "AUTO", "null → AUTO");

// ============================================================
// 2) shouldApplyGeoFence
// ============================================================
console.log("\n=== shouldApplyGeoFence ===");

// GEO-Intents → true (wenn nicht GLOBAL)
assert(shouldApplyGeoFence({
  question: "test", intent: "geo_nearest_poi", hasGeoContext: false,
  explicitScope: { mode: "AUTO" }
}) === true, "GEO_NEAREST_POI intent → true");

assert(shouldApplyGeoFence({
  question: "test", intent: "geo_count", hasGeoContext: false,
  explicitScope: { mode: "AUTO" }
}) === true, "GEO_COUNT intent → true");

assert(shouldApplyGeoFence({
  question: "test", intent: "geo_list", hasGeoContext: false,
  explicitScope: { mode: "AUTO" }
}) === true, "GEO_LIST intent → true");

assert(shouldApplyGeoFence({
  question: "test", intent: "geo_provider_search", hasGeoContext: false,
  explicitScope: { mode: "AUTO" }
}) === true, "GEO_PROVIDER_SEARCH intent → true");

// GLOBAL override
assert(shouldApplyGeoFence({
  question: "test", intent: "geo_nearest_poi", hasGeoContext: true,
  explicitScope: { mode: "GLOBAL" }
}) === false, "GLOBAL override bei geo intent → false");

// LOCAL explicit
assert(shouldApplyGeoFence({
  question: "test", intent: "semantic", hasGeoContext: false,
  explicitScope: { mode: "LOCAL" }
}) === true, "LOCAL explicit bei semantic → true");

// hasGeoContext
assert(shouldApplyGeoFence({
  question: "test", intent: "semantic", hasGeoContext: true,
  explicitScope: { mode: "AUTO" }
}) === true, "hasGeoContext=true bei semantic → true");

// Kein Geo-Bezug
assert(shouldApplyGeoFence({
  question: "Was sagt das Gesetz?", intent: "semantic", hasGeoContext: false,
  explicitScope: { mode: "AUTO" }
}) === false, "Keine Geo-Indikatoren → false");

// ============================================================
// Akzeptanzkriterien aus der Spezifikation
// ============================================================
console.log("\n=== Akzeptanzkriterien ===");

// „Wie viele Gebäude gibt es im Einsatzbereich?" → BBox aktiv
const q1Scope = detectExplicitScope("Wie viele Gebäude gibt es im Einsatzbereich?");
assert(shouldApplyGeoFence({
  question: "Wie viele Gebäude gibt es im Einsatzbereich?",
  intent: "geo_count", hasGeoContext: true,
  explicitScope: q1Scope,
}) === true, "Gebäude im Einsatzbereich → BBox aktiv");

// „Wo ist die nächste Polizeistation?" → BBox aktiv
const q2Scope = detectExplicitScope("Wo ist die nächste Polizeistation?");
assert(shouldApplyGeoFence({
  question: "Wo ist die nächste Polizeistation?",
  intent: "geo_nearest_poi", hasGeoContext: true,
  explicitScope: q2Scope,
}) === true, "Nächste Polizeistation → BBox aktiv");

// „Was sagt das Katastrophenschutzgesetz?" → BBox aus
const q3Scope = detectExplicitScope("Was sagt das Katastrophenschutzgesetz?");
assert(shouldApplyGeoFence({
  question: "Was sagt das Katastrophenschutzgesetz?",
  intent: "semantic", hasGeoContext: false,
  explicitScope: q3Scope,
}) === false, "Katastrophenschutzgesetz → BBox aus");

// „Österreichweit: Wie viele Krankenhäuser gibt es?" → BBox aus (GLOBAL)
const q4Scope = detectExplicitScope("Österreichweit: Wie viele Krankenhäuser gibt es?");
assert(shouldApplyGeoFence({
  question: "Österreichweit: Wie viele Krankenhäuser gibt es?",
  intent: "geo_count", hasGeoContext: true,
  explicitScope: q4Scope,
}) === false, "Österreichweit Krankenhäuser → BBox aus (GLOBAL)");

// ============================================================
// 3) resolveCenterPoint
// ============================================================
console.log("\n=== resolveCenterPoint ===");

// Einsatzstellen-Centroid
const centerFromEinsatzstellen = await resolveCenterPoint({
  einsatzboardData: {
    points: [
      { lat: 46.72, lon: 14.09 },
      { lat: 46.73, lon: 14.10 },
    ]
  }
});
assert(centerFromEinsatzstellen.source === "EINSATZSTELLEN", "Einsatzstellen → source=EINSATZSTELLEN");
assert(Math.abs(centerFromEinsatzstellen.lat - 46.725) < 0.001, "Centroid lat korrekt");
assert(Math.abs(centerFromEinsatzstellen.lon - 14.095) < 0.001, "Centroid lon korrekt");

// BBox-Center
const centerFromBbox = await resolveCenterPoint({
  einsatzboardData: { points: [] },
  requestBbox: [14.0, 46.7, 14.2, 46.8],
});
assert(centerFromBbox.source === "BBOX", "BBox → source=BBOX");
assert(Math.abs(centerFromBbox.lat - 46.75) < 0.001, "BBox center lat korrekt");
assert(Math.abs(centerFromBbox.lon - 14.1) < 0.001, "BBox center lon korrekt");

// Fallback
const centerFallback = await resolveCenterPoint({
  einsatzboardData: { points: [] },
});
assert(centerFallback.source === "FALLBACK", "Kein Daten → source=FALLBACK");
assert(Math.abs(centerFallback.lat - 46.7239) < 0.001, "Fallback lat korrekt (Feldkirchen)");

// ============================================================
// Zusammenfassung
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("Alle Tests bestanden!");
}
