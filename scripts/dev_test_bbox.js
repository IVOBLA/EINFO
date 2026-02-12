#!/usr/bin/env node
/**
 * dev_test_bbox.js – Testet den BBOX-Filter für die Vector-RAG-Pipeline.
 *
 * Prüft:
 *  1. filterChunkIndices mit bbox + bboxDocTypes
 *  2. Chunks innerhalb der BBox bleiben erhalten
 *  3. Chunks außerhalb der BBox werden gefiltert
 *  4. Non-Geo-Content (PDFs, Text) wird NICHT von bbox gefiltert
 *  5. bboxDocTypes steuert, welche doc_types bbox-gefiltert werden
 *
 * Ausführen:
 *   node scripts/dev_test_bbox.js
 */

// Dynamischer Import für ESM-Kompatibilität
async function run() {
  const { filterChunkIndices } = await import(
    "../chatbot/server/rag/rag_vector.js"
  );

  // ============================================================
  // Test-Chunks (simulierte Knowledge-Base Einträge)
  // ============================================================

  // Feldkirchen BBox: [minLon, minLat, maxLon, maxLat]
  const FELDKIRCHEN_BBOX = [14.05, 46.70, 14.15, 46.75];

  const testChunks = [
    // IN bbox – Adresse in Feldkirchen
    {
      text: "Rathaus Feldkirchen, Hauptplatz 1",
      fileName: "adressen_feldkirchen.jsonl",
      meta: {
        doc_type: "address",
        geo: { lat: 46.7239, lon: 14.0947 },
        address: { city: "Feldkirchen" }
      }
    },
    // IN bbox – POI in Feldkirchen
    {
      text: "Feuerwehr Feldkirchen, 9560 Feldkirchen",
      fileName: "pois_feldkirchen.jsonl",
      meta: {
        doc_type: "poi",
        category: "amenity:fire_station",
        geo: { lat: 46.724, lon: 14.095 },
        address: { city: "Feldkirchen" }
      }
    },
    // OUTSIDE bbox – Laas (weit außerhalb)
    {
      text: "Landeskrankenhaus Laas",
      fileName: "pois_laas.jsonl",
      meta: {
        doc_type: "poi",
        category: "amenity:hospital",
        geo: { lat: 46.6959, lon: 12.9887 },
        address: { city: "Laas" }
      }
    },
    // OUTSIDE bbox – Adresse außerhalb
    {
      text: "Villacher Straße 10, 9020 Klagenfurt",
      fileName: "adressen_klagenfurt.jsonl",
      meta: {
        doc_type: "address",
        geo: { lat: 46.6247, lon: 14.3050 },
        address: { city: "Klagenfurt" }
      }
    },
    // Non-geo content (PDF) – kein doc_type match → sollte NICHT gefiltert werden
    {
      text: "Stabsarbeit Kat-Einsatz Handbuch Seite 42",
      fileName: "handbuch_stab.pdf",
      meta: {
        doc_type: "document"
      }
    },
    // Non-geo content (Text) – kein doc_type match
    {
      text: "Einsatzprotokoll 2024-01-15",
      fileName: "protokoll.txt",
      meta: {}
    },
    // Building IN bbox
    {
      text: "Gemeindeamt Feldkirchen",
      fileName: "buildings.jsonl",
      meta: {
        doc_type: "building",
        geo: { lat: 46.723, lon: 14.096 }
      }
    },
    // Address with bbox geometry (statt point) – IN bbox
    {
      text: "Parkplatz Feldkirchen",
      fileName: "buildings.jsonl",
      meta: {
        doc_type: "building",
        geo: { bbox: [14.09, 46.72, 14.10, 46.73] }
      }
    },
    // Address with bbox geometry – OUTSIDE bbox
    {
      text: "Parkplatz Villach",
      fileName: "buildings.jsonl",
      meta: {
        doc_type: "building",
        geo: { bbox: [13.80, 46.60, 13.90, 46.65] }
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  FAIL: ${message}`);
      failed++;
      return;
    }
    console.log(`  OK: ${message}`);
    passed++;
  }

  // ============================================================
  // Test 1: BBOX + bboxDocTypes = ["address", "poi", "building"]
  // ============================================================
  console.log("\n--- Test 1: BBOX mit bboxDocTypes [address, poi, building] ---");
  {
    const indices = filterChunkIndices(testChunks, {
      bbox: FELDKIRCHEN_BBOX,
      bboxDocTypes: ["address", "poi", "building"]
    });

    const texts = indices.map(i => testChunks[i].text);

    // IN bbox: Rathaus, Feuerwehr, Gemeindeamt, Parkplatz Feldkirchen
    assert(texts.includes("Rathaus Feldkirchen, Hauptplatz 1"), "Rathaus Feldkirchen (in bbox) enthalten");
    assert(texts.includes("Feuerwehr Feldkirchen, 9560 Feldkirchen"), "Feuerwehr Feldkirchen (in bbox, poi) enthalten");
    assert(texts.includes("Gemeindeamt Feldkirchen"), "Gemeindeamt (in bbox, building) enthalten");
    assert(texts.includes("Parkplatz Feldkirchen"), "Parkplatz Feldkirchen (bbox-geometry, in bbox) enthalten");

    // OUTSIDE bbox: Laas, Klagenfurt, Parkplatz Villach
    assert(!texts.includes("Landeskrankenhaus Laas"), "LKH Laas (außerhalb bbox) NICHT enthalten");
    assert(!texts.includes("Villacher Straße 10, 9020 Klagenfurt"), "Klagenfurt Adresse (außerhalb bbox) NICHT enthalten");
    assert(!texts.includes("Parkplatz Villach"), "Parkplatz Villach (bbox-geometry, außerhalb) NICHT enthalten");

    // Non-geo content: MUSS enthalten bleiben
    assert(texts.includes("Stabsarbeit Kat-Einsatz Handbuch Seite 42"), "PDF-Content (doc_type=document) NICHT von bbox gefiltert");
    assert(texts.includes("Einsatzprotokoll 2024-01-15"), "Text-Content (kein doc_type) NICHT von bbox gefiltert");
  }

  // ============================================================
  // Test 2: BBOX ohne bboxDocTypes → filtert ALLE mit Geo-Daten
  // ============================================================
  console.log("\n--- Test 2: BBOX ohne bboxDocTypes (legacy) ---");
  {
    const indices = filterChunkIndices(testChunks, {
      bbox: FELDKIRCHEN_BBOX
      // kein bboxDocTypes → bboxApplyDocTypes = [] → filtert alle
    });

    const texts = indices.map(i => testChunks[i].text);

    assert(texts.includes("Rathaus Feldkirchen, Hauptplatz 1"), "Rathaus (in bbox) enthalten");
    assert(!texts.includes("Landeskrankenhaus Laas"), "LKH Laas (außerhalb) NICHT enthalten");
    // Non-geo: ohne bboxDocTypes wird alles ohne Geo ausgeschlossen
    assert(!texts.includes("Stabsarbeit Kat-Einsatz Handbuch Seite 42"), "PDF-Content wird ohne bboxDocTypes ausgeschlossen (kein geo)");
  }

  // ============================================================
  // Test 3: Kein BBOX → alle Chunks bleiben erhalten
  // ============================================================
  console.log("\n--- Test 3: Ohne BBOX (kein Filter) ---");
  {
    const indices = filterChunkIndices(testChunks, {});

    assert(indices.length === testChunks.length, `Alle ${testChunks.length} Chunks bleiben erhalten`);
  }

  // ============================================================
  // Test 4: BBOX + nur doc_type "address" → POIs nicht gefiltert
  // ============================================================
  console.log("\n--- Test 4: BBOX nur auf address anwenden ---");
  {
    const indices = filterChunkIndices(testChunks, {
      bbox: FELDKIRCHEN_BBOX,
      bboxDocTypes: ["address"]
    });

    const texts = indices.map(i => testChunks[i].text);

    assert(!texts.includes("Villacher Straße 10, 9020 Klagenfurt"), "Klagenfurt Adresse (address, außerhalb) NICHT enthalten");
    // POIs sollten NICHT gefiltert werden (da nicht in bboxDocTypes)
    assert(texts.includes("Landeskrankenhaus Laas"), "LKH Laas (poi, nicht in bboxDocTypes) wird NICHT gefiltert");
    assert(texts.includes("Feuerwehr Feldkirchen, 9560 Feldkirchen"), "Feuerwehr (poi) bleibt erhalten");
  }

  // ============================================================
  // Test 5: Kombination doc_type Filter + bbox
  // ============================================================
  console.log("\n--- Test 5: doc_type Filter + BBOX ---");
  {
    const indices = filterChunkIndices(testChunks, {
      doc_type: ["poi"],
      bbox: FELDKIRCHEN_BBOX,
      bboxDocTypes: ["poi"]
    });

    const texts = indices.map(i => testChunks[i].text);

    assert(texts.includes("Feuerwehr Feldkirchen, 9560 Feldkirchen"), "Feuerwehr (poi, in bbox) enthalten");
    assert(!texts.includes("Landeskrankenhaus Laas"), "LKH Laas (poi, außerhalb bbox) NICHT enthalten");
    assert(!texts.includes("Rathaus Feldkirchen, Hauptplatz 1"), "Rathaus (address, nicht poi) NICHT enthalten");
    assert(texts.length === 1, "Nur 1 Treffer (Feuerwehr Feldkirchen)");
  }

  // ============================================================
  // Zusammenfassung
  // ============================================================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);

  if (failed > 0) {
    console.error("\nBBOX-Filter Tests FEHLGESCHLAGEN!");
    process.exitCode = 1;
  } else {
    console.log("\nAlle BBOX-Filter Tests BESTANDEN.");
  }
}

run().catch((err) => {
  console.error("Test-Script Fehler:", err);
  process.exitCode = 1;
});
