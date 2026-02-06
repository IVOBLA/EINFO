// chatbot/server/rag/_dev_test_jsonl_validator.js

import { validateAndNormalizeJsonlRecord } from "./jsonl_schema_validator.js";

const samples = [
  JSON.stringify({
    schema_version: "einfo-jsonl-1.0",
    doc_id: "poi-1",
    doc_type: "poi",
    source: "TEST",
    region: "AT",
    title: "Rathaus",
    content: "Rathaus Feldkirchen. Öffnungszeiten: 08:00-16:00.",
    address: {
      street: "Hauptstraße",
      housenumber: "1",
      postcode: "9560",
      city: "Feldkirchen"
    }
  }),
  JSON.stringify({
    doc_type: "poi",
    source: "OSM",
    region: "AT",
    name: "Feuerwehr Feldkirchen",
    category: "emergency",
    address: {
      full: "Bahnhofstraße 5, 9560 Feldkirchen"
    }
  }),
  JSON.stringify({
    schema_version: "einfo-jsonl-1.0",
    doc_type: "address",
    source: "IMPORT",
    region: "AT",
    title: "Bahnhofstraße 5",
    content: "Adresse Bahnhofstraße 5."
  }),
  JSON.stringify({
    doc_type: "poi",
    source: "OSM",
    region: "AT",
    title: "Test-Kiosk",
    geo: { lat: "abc", lon: "15.12" },
    content: "Kleiner Kiosk."
  }),
  "{ broken json"
];

samples.forEach((line, idx) => {
  const lineNo = idx + 1;
  try {
    const parsed = JSON.parse(line);
    const result = validateAndNormalizeJsonlRecord(parsed, {
      filePath: "_dev_test.jsonl",
      lineNo
    });

    if (!result.ok) {
      console.log(`SKIP ${lineNo}: ${result.error}`);
      return;
    }

    console.log(`OK ${lineNo}: doc_id=${result.record.doc_id}`);
    if (result.warnings?.length) {
      console.log(`WARN ${lineNo}: ${result.warnings.join(" | ")}`);
    }
    console.log(`CONTENT ${lineNo}:\n${result.record.content}\n---`);
  } catch (err) {
    console.log(`SKIP ${lineNo}: JSON parse error (${String(err)})`);
  }
});
