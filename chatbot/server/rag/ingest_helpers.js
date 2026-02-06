// chatbot/server/rag/ingest_helpers.js
// Hilfsfunktionen für JSONL-Ingest (Dedupe, Report, Street-Stats, Entity-Index)

import { normalizeStreet } from "./jsonl_utils.js";

const STREET_STATS_SOURCE = "EINFO";
const STREET_STATS_DOC_TYPE = "street_stats";
const ENTITY_INDEX_LIMIT = 20;

function normalizeForDedupe(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "");
}

function buildDedupeKey(record, { preferDocId = true } = {}) {
  if (preferDocId && record.doc_id) return record.doc_id;
  const name = normalizeForDedupe(record.title || record.name || "");
  const address = normalizeForDedupe(record.address?.full || "");
  const lat = record.geo?.lat;
  const lon = record.geo?.lon;
  const geo =
    lat !== undefined && lon !== undefined
      ? `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`
      : "";
  return `${record.source}|${record.doc_type}|${name}|${address}|${geo}`;
}

function createIngestReport() {
  return {
    run_at: new Date().toISOString(),
    files: {},
    totals: { files: 0, lines: 0, ok: 0, skipped: 0, deduped: 0, warnings: 0 },
    top_warning_types: {}
  };
}

function ensureFileReport(report, fileName) {
  if (!report.files[fileName]) {
    report.files[fileName] = {
      lines: 0,
      ok: 0,
      skipped: 0,
      deduped: 0,
      warnings: 0,
      top_warning_types: {}
    };
    report.totals.files += 1;
  }
  return report.files[fileName];
}

function warningTypeFromMessage(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("geo.")) return "BAD_GEO";
  if (lower.includes("content gekürzt")) return "CONTENT_TRUNCATED";
  return "OTHER_WARNING";
}

function recordWarning(report, fileReport, warning) {
  const type = warningTypeFromMessage(warning);
  fileReport.warnings += 1;
  report.totals.warnings += 1;
  fileReport.top_warning_types[type] = (fileReport.top_warning_types[type] || 0) + 1;
  report.top_warning_types[type] = (report.top_warning_types[type] || 0) + 1;
}

function updateEntityIndex(record, entityIndex) {
  const key = normalizeForDedupe(record.title || record.name || "");
  if (!key) return;
  const existing = entityIndex.get(key) || [];
  if (existing.includes(record.doc_id)) return;
  if (existing.length >= ENTITY_INDEX_LIMIT) return;
  existing.push(record.doc_id);
  entityIndex.set(key, existing);
}

function getStreetAggregationKey(streetNorm, city) {
  const cityNorm = normalizeForDedupe(city || "");
  return `${streetNorm}|${cityNorm}`;
}

function updateStreetAggregation(record, streetStats) {
  const streetNorm = record.address?.street_norm || normalizeStreet(record.address?.street);
  if (!streetNorm) return;
  const city = record.address?.city || record.address?.municipality || "";
  const key = getStreetAggregationKey(streetNorm, city);

  if (!streetStats.has(key)) {
    streetStats.set(key, {
      street: record.address?.street || streetNorm,
      street_norm: streetNorm,
      city,
      region: record.region || "Kärnten",
      addresses: 0,
      buildings: 0,
      pois: 0,
      examples: []
    });
  }

  const agg = streetStats.get(key);
  if (record.region && agg.region === "Kärnten") {
    agg.region = record.region;
  }

  const hasHouseNumber = Boolean(record.address?.housenumber);
  if (record.doc_type === "address" || hasHouseNumber) agg.addresses += 1;
  if (record.doc_type === "building" || record.tags?.building) agg.buildings += 1;
  if (record.doc_type === "poi") agg.pois += 1;

  if (record.address?.full && agg.examples.length < 5) {
    agg.examples.push(record.address.full);
  }
}

function buildStreetStatsRecords(streetStats) {
  const records = [];
  for (const agg of streetStats.values()) {
    const cityNorm = normalizeForDedupe(agg.city || "");
    const docId = `einfo:street_stats:${agg.street_norm}:${cityNorm}`;
    const title = `${agg.street} (Statistik)`;
    const content = [
      `Straße: ${agg.street}`,
      agg.city ? `Ort: ${agg.city}` : null,
      `Gebäude: ${agg.buildings}`,
      `Adressen: ${agg.addresses}`,
      `POIs: ${agg.pois}`,
      agg.examples.length ? `Beispiele: ${agg.examples.join("; ")}` : null
    ]
      .filter(Boolean)
      .join("\n");

    records.push({
      schema_version: "einfo-jsonl-1.0",
      doc_id: docId,
      doc_type: STREET_STATS_DOC_TYPE,
      source: STREET_STATS_SOURCE,
      region: agg.region || "Kärnten",
      title,
      address: {
        street: agg.street,
        street_norm: agg.street_norm,
        city: agg.city || undefined
      },
      stats: {
        addresses: agg.addresses,
        buildings: agg.buildings,
        pois: agg.pois,
        examples: agg.examples
      },
      content
    });
  }
  return records;
}

export {
  buildDedupeKey,
  buildStreetStatsRecords,
  createIngestReport,
  ensureFileReport,
  normalizeForDedupe,
  recordWarning,
  updateEntityIndex,
  updateStreetAggregation,
  warningTypeFromMessage
};
