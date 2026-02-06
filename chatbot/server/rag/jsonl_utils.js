// chatbot/server/rag/jsonl_utils.js
// Hilfsfunktionen für JSONL-Records (Normalisierung, Fallback-Content, IDs)

import crypto from "crypto";

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
  record.doc_type = record.doc_type || "document_snippet";
  record.source = record.source || "UNKNOWN";
  record.doc_id = buildDocId(record, rawLine);

  if (record.address?.street && !record.address.street_norm) {
    record.address.street_norm = normalizeStreet(record.address.street);
  }

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
    title: record.title,
    name: record.name,
    address,
    geo,
    ids
  };
}
