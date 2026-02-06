// chatbot/server/rag/_dev_test_phase2.js
// Mini-Dev-Test für Phase 2 Features (Dedupe, Report, Street-Stats)

import {
  buildDedupeKey,
  buildStreetStatsRecords,
  createIngestReport,
  ensureFileReport,
  recordWarning,
  updateStreetAggregation
} from "./ingest_helpers.js";
import { validateAndNormalizeJsonlRecord } from "./jsonl_schema_validator.js";

const sampleLines = [
  JSON.stringify({
    schema_version: "einfo-jsonl-1.0",
    doc_type: "address",
    source: "EINFO",
    region: "Kärnten",
    title: "Leitenweg 1",
    address: {
      street: "Leitenweg",
      housenumber: "1",
      city: "Feldkirchen",
      full: "Leitenweg 1, Feldkirchen"
    },
    geo: { lat: 46.72, lon: 14.09 }
  }),
  JSON.stringify({
    schema_version: "einfo-jsonl-1.0",
    doc_type: "address",
    source: "EINFO",
    region: "Kärnten",
    title: "Leitenweg 1",
    address: {
      street: "Leitenweg",
      housenumber: "1",
      city: "Feldkirchen",
      full: "Leitenweg 1, Feldkirchen"
    },
    geo: { lat: 46.72, lon: 14.09 }
  }),
  JSON.stringify({
    schema_version: "einfo-jsonl-1.0",
    doc_type: "building",
    source: "EINFO",
    region: "Kärnten",
    title: "Leitenweg 2",
    address: {
      street: "Leitenweg",
      housenumber: "2",
      city: "Feldkirchen",
      full: "Leitenweg 2, Feldkirchen"
    },
    tags: { building: "yes" },
    geo: { lat: 46.721, lon: 14.091 }
  }),
  JSON.stringify({
    schema_version: "einfo-jsonl-1.0",
    doc_type: "poi",
    source: "EINFO",
    region: "Kärnten",
    title: "Cafe Leitenweg",
    address: {
      street: "Leitenweg",
      housenumber: "3",
      city: "Feldkirchen",
      full: "Leitenweg 3, Feldkirchen"
    },
    geo: { lat: 46.722, lon: 14.092 }
  })
];

const report = createIngestReport();
const fileReport = ensureFileReport(report, "sample.jsonl");
const seenKeys = new Set();
const streetStats = new Map();

for (const [index, line] of sampleLines.entries()) {
  fileReport.lines += 1;
  report.totals.lines += 1;

  const parsed = JSON.parse(line);
  const result = validateAndNormalizeJsonlRecord(parsed, {
    filePath: "sample.jsonl",
    lineNo: index + 1
  });

  if (!result.ok) {
    fileReport.skipped += 1;
    report.totals.skipped += 1;
    continue;
  }

  if (result.warnings?.length) {
    for (const warning of result.warnings) {
      recordWarning(report, fileReport, warning);
    }
  }

  const dedupeKey = buildDedupeKey(result.record, { preferDocId: Boolean(parsed.doc_id) });
  if (seenKeys.has(dedupeKey)) {
    fileReport.deduped += 1;
    report.totals.deduped += 1;
    continue;
  }
  seenKeys.add(dedupeKey);

  fileReport.ok += 1;
  report.totals.ok += 1;
  updateStreetAggregation(result.record, streetStats);
}

const streetStatsRecords = buildStreetStatsRecords(streetStats);

console.log("Street-Stats:");
console.log(JSON.stringify(streetStatsRecords, null, 2));
console.log("Ingest-Report:");
console.log(JSON.stringify(report, null, 2));
