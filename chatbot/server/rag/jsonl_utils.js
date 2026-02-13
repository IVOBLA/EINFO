// chatbot/server/rag/jsonl_utils.js
// Hilfsfunktionen für JSONL-Records (Normalisierung, Fallback-Content, IDs)

import crypto from "crypto";

// ============================================================
// DocType-Normalisierung (Bug-Fix: Plural -> Singular)
// ============================================================
const DOC_TYPE_ALIASES = {
  addresses: "address",
  buildings: "building",
  pois: "poi",
  document_snippets: "document_snippet"
};

export function normalizeDocType(dt) {
  if (!dt || typeof dt !== "string") return "document_snippet";
  const lower = dt.trim().toLowerCase();
  return DOC_TYPE_ALIASES[lower] || lower;
}

// ============================================================
// Flat-Field-Promotion (JSONL mit flat lat/lon/street -> nested)
// ============================================================
export function promoteFlatFields(record) {
  if (!record || typeof record !== "object") return record;

  // Promote flat geo fields -> record.geo
  if (record.lat !== undefined && record.lon !== undefined && !record.geo) {
    const lat = parseFloat(record.lat);
    const lon = parseFloat(record.lon);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      record.geo = { lat, lon };
    }
  }

  // Promote flat address fields -> record.address
  if (!record.address || typeof record.address === "string") {
    const fullAddress = typeof record.address === "string" ? record.address : null;
    const hasAnyField = record.street || record.housenumber || record.postcode || record.place || fullAddress;
    if (hasAnyField) {
      record.address = {
        full: fullAddress || undefined,
        street: record.street || undefined,
        housenumber: record.housenumber || undefined,
        postcode: record.postcode || undefined,
        city: record.place || undefined,
        municipality: record.place || undefined
      };
    }
  }

  // Promote flat ids fields -> record.ids
  if ((record.osm_type || record.osm_id !== undefined) && !record.ids) {
    record.ids = {
      osm_type: record.osm_type,
      osm_id: record.osm_id
    };
  }

  return record;
}

// ============================================================
// OSM Category-Normalisierung
// ============================================================
const TAG_PRIORITY = ["amenity", "shop", "craft", "tourism", "leisure", "office", "healthcare", "emergency"];

export function deriveOsmNormFields(record) {
  if (!record || typeof record !== "object") return record;

  // Wenn category schon "key:value" Format hat -> direkt nutzen
  if (record.category && typeof record.category === "string" && record.category.includes(":")) {
    const [tagKey, ...rest] = record.category.split(":");
    const tagValue = rest.join(":");
    record.category_norm = record.category.toLowerCase();
    record.primary_tag_key = tagKey.toLowerCase();
    record.primary_tag_value = tagValue.toLowerCase();
    record.poi_class = tagValue.toLowerCase();
    return record;
  }

  // Aus tags ableiten
  if (record.tags && typeof record.tags === "object") {
    for (const tagKey of TAG_PRIORITY) {
      const tagValue = record.tags[tagKey];
      if (tagValue && typeof tagValue === "string" && tagValue !== "yes") {
        record.category_norm = `${tagKey}:${tagValue}`.toLowerCase();
        record.primary_tag_key = tagKey.toLowerCase();
        record.primary_tag_value = tagValue.toLowerCase();
        record.poi_class = tagValue.toLowerCase();
        return record;
      }
    }
  }

  // Fallback: category as-is
  if (record.category) {
    record.category_norm = String(record.category).toLowerCase();
  }

  return record;
}

// ============================================================
// Bestehende Funktionen
// ============================================================

export function normalizeStreet(street) {
  if (!street || typeof street !== "string") return street;
  return street.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildDocId(record, rawLine = "") {
  if (record?.doc_id && typeof record.doc_id === "string") {
    return record.doc_id;
  }

  const source = record?.source || "unknown";
  const ids = record?.ids || {};
  if (ids.osm_type && ids.osm_id !== undefined && ids.osm_id !== null) {
    return `${source}:${ids.osm_type}:${ids.osm_id}`;
  }

  if (ids.external_id) {
    return `${source}:external:${ids.external_id}`;
  }

  const hashInput = rawLine || JSON.stringify(record || {});
  const hash = crypto.createHash("sha1").update(hashInput).digest("hex");
  return `${source}:hash:${hash}`;
}

function buildAddressLine(address = {}) {
  if (address.full) {
    return address.full;
  }
  const parts = [];
  const street = address.street;
  const house = address.housenumber;
  if (street) {
    parts.push(house ? `${street} ${house}` : street);
  }
  const cityParts = [];
  if (address.postcode) cityParts.push(address.postcode);
  if (address.city) cityParts.push(address.city);
  if (cityParts.length) parts.push(cityParts.join(" "));
  if (address.municipality) parts.push(address.municipality);
  return parts.filter(Boolean).join(", ");
}

export function buildFallbackContent(record = {}) {
  const lines = [];

  if (record.title) lines.push(record.title);
  if (record.name && record.name !== record.title) lines.push(`Name: ${record.name}`);
  if (record.category) lines.push(`Kategorie: ${record.category}`);

  if (record.address) {
    const addressLine = buildAddressLine(record.address);
    if (addressLine) lines.push(`Adresse: ${addressLine}`);
  }

  if (record.geo?.lat !== undefined && record.geo?.lon !== undefined) {
    lines.push(`Koordinaten: ${record.geo.lat}, ${record.geo.lon}`);
  }

  if (!lines.length) {
    const keyValues = [];
    for (const [key, value] of Object.entries(record)) {
      if (["content", "schema_version"].includes(key)) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        keyValues.push(`${key}: ${value}`);
      }
    }
    if (record.tags && typeof record.tags === "object") {
      const tagEntries = Object.entries(record.tags).slice(0, 8);
      if (tagEntries.length) {
        keyValues.push(`Tags: ${tagEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
    }
    if (keyValues.length) {
      lines.push(keyValues.join("\n"));
    }
  }

  return lines.join("\n").trim();
}

export function normalizeJsonlRecord(rawRecord, rawLine = "") {
  if (!rawRecord || typeof rawRecord !== "object") return null;

  const record = { ...rawRecord };

  // Flat-Fields zu nested promoten (lat/lon -> geo, street -> address, etc.)
  promoteFlatFields(record);

  // DocType normalisieren (addresses -> address)
  record.doc_type = normalizeDocType(record.doc_type || "document_snippet");
  record.source = record.source || "UNKNOWN";
  record.doc_id = buildDocId(record, rawLine);

  if (record.address?.street && !record.address.street_norm) {
    record.address.street_norm = normalizeStreet(record.address.street);
  }

  // OSM-Normalisierungsfelder ableiten (category_norm, poi_class, etc.)
  deriveOsmNormFields(record);

  if (!record.content || typeof record.content !== "string" || !record.content.trim()) {
    record.content = buildFallbackContent(record);
  } else {
    record.content = record.content.trim();
  }

  return record;
}

export function buildChunkMetadata(record) {
  if (!record) return {};

  const address = record.address
    ? {
        street: record.address.street,
        street_norm: record.address.street_norm,
        housenumber: record.address.housenumber,
        postcode: record.address.postcode,
        city: record.address.city,
        municipality: record.address.municipality,
        full: record.address.full
      }
    : undefined;

  const geo = record.geo
    ? {
        lat: record.geo.lat,
        lon: record.geo.lon,
        bbox: record.geo.bbox
      }
    : undefined;

  const ids = record.ids
    ? {
        osm_type: record.ids.osm_type,
        osm_id: record.ids.osm_id,
        external_id: record.ids.external_id
      }
    : undefined;

  return {
    doc_id: record.doc_id,
    doc_type: record.doc_type,
    source: record.source,
    region: record.region,
    category: record.category,
    category_norm: record.category_norm,
    primary_tag_key: record.primary_tag_key,
    primary_tag_value: record.primary_tag_value,
    poi_class: record.poi_class,
    title: record.title,
    name: record.name,
    address,
    geo,
    ids
  };
}
