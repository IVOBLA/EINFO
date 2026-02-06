// chatbot/server/rag/jsonl_schema_validator.js
// Schema-Validator & Normalizer für EINFO-JSONL

import crypto from "crypto";

const MAX_CONTENT_LENGTH = 5000;
const TAG_KEYS = [
  "amenity",
  "shop",
  "office",
  "healthcare",
  "emergency",
  "building",
  "operator",
  "brand",
  "phone",
  "website"
];

function normalizeStreet(street) {
  if (!street || typeof street !== "string") return street;
  return street.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildAddressLine(address = {}) {
  if (address.full) return address.full;

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

  return parts.filter(Boolean).join(", ");
}

function buildTagLine(tags) {
  if (!tags || typeof tags !== "object") return "";

  const entries = [];
  for (const key of TAG_KEYS) {
    if (tags[key] !== undefined && tags[key] !== null && String(tags[key]).trim() !== "") {
      entries.push(`${key}=${tags[key]}`);
    }
  }

  if (!entries.length) return "";
  return `Tags: ${entries.join(", ")}`;
}

function buildFallbackContent(record = {}) {
  const lines = [];

  if (record.title) lines.push(record.title);
  if (record.name && record.name !== record.title) lines.push(`Name: ${record.name}`);
  if (record.category) lines.push(`Kategorie: ${record.category}`);

  if (record.address) {
    const addressLine = buildAddressLine(record.address);
    if (addressLine) lines.push(`Adresse: ${addressLine}`);

    if (record.address.municipality) {
      const municipality = record.address.municipality;
      if (!addressLine.includes(municipality)) {
        lines.push(`Ort: ${municipality}`);
      }
    }
  }

  if (record.geo?.lat !== undefined && record.geo?.lon !== undefined) {
    lines.push(`Koordinaten: ${record.geo.lat}, ${record.geo.lon}`);
  }

  const tagLine = buildTagLine(record.tags);
  if (tagLine) lines.push(tagLine);

  return lines.join("\n").trim();
}

function ensureString(value) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function buildStableDocId(record, ctx, title) {
  if (record.doc_id && typeof record.doc_id === "string" && record.doc_id.trim()) {
    return record.doc_id.trim();
  }

  const ids = record.ids || {};
  if (ids.osm_type && ids.osm_id !== undefined && ids.osm_id !== null) {
    return `osm:${ids.osm_type}:${ids.osm_id}`;
  }

  const filePath = ctx?.filePath || "unknown-file";
  const lineNo = ctx?.lineNo ?? "unknown-line";
  const hashInput = `${filePath}:${lineNo}:${title}`;
  const hash = crypto.createHash("sha1").update(hashInput).digest("hex");
  return `hash:${hash}`;
}

function normalizeGeo(record, warnings) {
  if (!record.geo || typeof record.geo !== "object") return;

  const lat = parseFloat(record.geo.lat);
  const lon = parseFloat(record.geo.lon);

  if (Number.isNaN(lat)) {
    delete record.geo.lat;
    warnings.push("geo.lat ungültig, entfernt");
  } else if (record.geo.lat !== undefined) {
    record.geo.lat = lat;
  }

  if (Number.isNaN(lon)) {
    delete record.geo.lon;
    warnings.push("geo.lon ungültig, entfernt");
  } else if (record.geo.lon !== undefined) {
    record.geo.lon = lon;
  }

  if (record.geo.bbox !== undefined) {
    const bbox = record.geo.bbox;
    const validArray =
      Array.isArray(bbox) &&
      bbox.length === 4 &&
      bbox.every((value) => !Number.isNaN(parseFloat(value)));

    if (!validArray) {
      delete record.geo.bbox;
      warnings.push("geo.bbox ungültig, entfernt");
    } else {
      record.geo.bbox = bbox.map((value) => parseFloat(value));
    }
  }

  if (record.geo && Object.keys(record.geo).length === 0) {
    delete record.geo;
  }
}

function ensureContent(record, warnings) {
  if (!record.content || typeof record.content !== "string" || !record.content.trim()) {
    record.content = buildFallbackContent(record);
  } else {
    record.content = record.content.trim();
  }

  if (record.content.length > MAX_CONTENT_LENGTH) {
    record.content = record.content.slice(0, MAX_CONTENT_LENGTH);
    warnings.push("content gekürzt (max 5000 Zeichen)");
  }
}

export function validateAndNormalizeJsonlRecord(record, ctx = {}) {
  try {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { ok: false, error: "Record ist kein Objekt" };
    }

    const warnings = [];
    const normalized = { ...record };

    normalized.schema_version = "einfo-jsonl-1.0";
    normalized.source = ensureString(normalized.source) || "UNKNOWN";
    normalized.region = ensureString(normalized.region) || "UNKNOWN";
    normalized.doc_type = ensureString(normalized.doc_type) || "generic";

    const titleFallback =
      ensureString(normalized.name) ||
      ensureString(normalized.address?.full) ||
      "Untitled";
    normalized.title = ensureString(normalized.title) || titleFallback;

    normalized.doc_id = buildStableDocId(normalized, ctx, normalized.title);

    if (normalized.address?.street && !normalized.address.street_norm) {
      normalized.address.street_norm = normalizeStreet(normalized.address.street);
    }

    normalizeGeo(normalized, warnings);
    ensureContent(normalized, warnings);

    if (!normalized.content || !normalized.content.trim()) {
      return { ok: false, error: "Content ist leer" };
    }

    return {
      ok: true,
      record: normalized,
      warnings: warnings.length ? warnings : undefined
    };
  } catch (err) {
    return { ok: false, error: `Validator-Fehler: ${String(err)}` };
  }
}
