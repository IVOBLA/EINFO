/**
 * PostGIS Configuration Store
 * Persists PostGIS connection config to server/data/conf/postgis.json.
 * Passwords are stored server-side only and never returned to the frontend.
 */
import fs from "fs/promises";
import path from "path";

const DEFAULT_GEO_KEYWORDS = [
  "adresse", "straße", "strasse", "plz", "postleitzahl",
  "ort", "gemeinde", "stadt",
  "nächste", "naechste", "nähe",
  "wieviele", "wie viele", "anzahl",
  "wo ist", "wo sind", "wo befindet", "wo liegt",
  "gibt es", "im umkreis", "im radius", "entfernung",
  "koordinaten", "standort",
  "gebäude", "gebaeude", "adressen",
  "einsatzgebiet", "einsatzraum", "lage",
  "schwerpunkt", "hotspot",
];

const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 5432,
  database: "",
  user: "",
  password: "",
  schema: "public",
  sslMode: "disabled",
  statementTimeoutMs: 5000,
  maxRows: 200,
  logSql: false,
  logResponse: false,
  logErrors: true,
  persistLogs: true,
  maskSensitive: true,
  geoKeywords: DEFAULT_GEO_KEYWORDS,
};

let configFilePath = "";

export function initConfigStore(dataDir) {
  configFilePath = path.join(dataDir, "conf", "postgis.json");
}

async function ensureDir() {
  const dir = path.dirname(configFilePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function loadConfig() {
  try {
    const raw = await fs.readFile(configFilePath, "utf8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(partial) {
  await ensureDir();
  const existing = await loadConfig();
  // If password not provided in update, keep existing
  if (partial.password === undefined || partial.password === "") {
    partial.password = existing.password;
  }
  const merged = { ...existing, ...partial };
  // Validate types
  merged.port = Number(merged.port) || 5432;
  merged.statementTimeoutMs = Number(merged.statementTimeoutMs) || 5000;
  merged.maxRows = Number(merged.maxRows) || 200;
  merged.logSql = !!merged.logSql;
  merged.logResponse = !!merged.logResponse;
  merged.logErrors = !!merged.logErrors;
  merged.persistLogs = !!merged.persistLogs;
  merged.maskSensitive = !!merged.maskSensitive;
  if (!["disabled", "require", "verify-full"].includes(merged.sslMode)) {
    merged.sslMode = "disabled";
  }
  // geoKeywords: ensure it's a non-empty array of strings; fallback to defaults
  if (Array.isArray(merged.geoKeywords)) {
    merged.geoKeywords = merged.geoKeywords
      .map(k => (typeof k === "string" ? k.trim().toLowerCase() : ""))
      .filter(Boolean);
  }
  if (!Array.isArray(merged.geoKeywords) || merged.geoKeywords.length === 0) {
    merged.geoKeywords = [...DEFAULT_GEO_KEYWORDS];
  }
  await fs.writeFile(configFilePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

/** Return config safe for frontend (password replaced with passwordSet flag) */
export function sanitizeForFrontend(config) {
  const { password, ...rest } = config;
  return { ...rest, passwordSet: !!password };
}

export { DEFAULT_CONFIG, DEFAULT_GEO_KEYWORDS };
