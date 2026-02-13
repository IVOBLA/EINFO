// chatbot/server/geo/geo_context_formatter.js
// Formatiert PostGIS-Ergebnisse als kompakten Kontextblock für das LLM

/**
 * Formatiert Distanz in menschenlesbare Form.
 */
function formatDistance(meters) {
  if (meters == null) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Formatiert POI-Ergebnisse als Kontextblock.
 * @param {Array} rows - Ergebnisse aus postgis_geo.nearestPoi/listPoi
 * @param {object} meta - { type: string, categoryNorm: string, scope: string }
 * @returns {string}
 */
export function formatPoiContext(rows, meta = {}) {
  const { type = "geo_poi", categoryNorm = "", scope = "" } = meta;

  if (!rows || rows.length === 0) {
    const label = categoryNorm || type;
    return (
      `### GEOGRAFISCHE ERGEBNISSE (PostGIS) — 0 gefunden ###\n` +
      `Typ: ${label}\n` +
      `Scope: ${scope || "unbekannt"}\n` +
      `0 Ergebnisse. Dies ist ein gültiges deterministisches Ergebnis aus der OSM-Datenbank.\n`
    );
  }

  const limited = rows.slice(0, 10);
  let ctx = `### GEOGRAFISCHE ERGEBNISSE (PostGIS) — ${rows.length} gefunden ###\n`;
  if (scope) ctx += `Scope: ${scope}\n`;
  ctx += `\n`;

  for (const row of limited) {
    const name = row.name ? `**${row.name}**` : "(ohne Name)";
    const cat = row.category_norm || row.provider_type_norm || "";
    const addr = row.address_full || "";
    const muni = row.municipality || "";
    const dist = row.distance_m != null ? formatDistance(row.distance_m) : "";
    const coords = `${row.lat?.toFixed(5)}, ${row.lon?.toFixed(5)}`;

    ctx += `- ${name}`;
    if (cat) ctx += ` [${cat}]`;
    if (dist) ctx += ` (${dist})`;
    ctx += `\n`;
    if (addr) ctx += `  Adresse: ${addr}\n`;
    if (muni) ctx += `  Gemeinde: ${muni}\n`;
    ctx += `  Koordinaten: ${coords}\n`;

    // Kontaktdaten aus tags_json
    if (row.tags_json) {
      const tags = typeof row.tags_json === "string" ? JSON.parse(row.tags_json) : row.tags_json;
      if (tags.phone) ctx += `  Telefon: ${tags.phone}\n`;
      if (tags.website) ctx += `  Website: ${tags.website}\n`;
    }
    // Provider-spezifische Kontaktdaten
    if (row.phone) ctx += `  Telefon: ${row.phone}\n`;
    if (row.website) ctx += `  Website: ${row.website}\n`;
  }

  if (rows.length > 10) {
    ctx += `\n... und ${rows.length - 10} weitere Ergebnisse.\n`;
  }

  return ctx;
}

/**
 * Formatiert Provider-Ergebnisse als Kontextblock.
 */
export function formatProviderContext(rows, meta = {}) {
  const { searchTerm = "", scope = "" } = meta;

  if (!rows || rows.length === 0) {
    return (
      `### PROVIDER / RESSOURCEN (PostGIS) — 0 gefunden ###\n` +
      `Suchbegriff: ${searchTerm}\n` +
      `Scope: ${scope || "unbekannt"}\n` +
      `Keine passenden Provider/Ressourcen gefunden.\n`
    );
  }

  const limited = rows.slice(0, 10);
  let ctx = `### PROVIDER / RESSOURCEN (PostGIS) — ${rows.length} gefunden ###\n`;
  if (searchTerm) ctx += `Suchbegriff: ${searchTerm}\n`;
  if (scope) ctx += `Scope: ${scope}\n`;
  ctx += `\n`;

  for (const row of limited) {
    const name = row.name ? `**${row.name}**` : "(ohne Name)";
    const ptype = row.provider_type_norm || "unknown";
    const addr = row.address_full || "";
    const muni = row.municipality || "";
    const dist = row.distance_m != null ? formatDistance(row.distance_m) : "";
    const coords = `${row.lat?.toFixed(5)}, ${row.lon?.toFixed(5)}`;

    ctx += `- ${name} [${ptype}]`;
    if (dist) ctx += ` (${dist})`;
    ctx += `\n`;
    if (addr) ctx += `  Adresse: ${addr}\n`;
    if (muni) ctx += `  Gemeinde: ${muni}\n`;
    ctx += `  Koordinaten: ${coords}\n`;
    if (row.phone) ctx += `  Telefon: ${row.phone}\n`;
    if (row.website) ctx += `  Website: ${row.website}\n`;
  }

  if (rows.length > 10) {
    ctx += `\n... und ${rows.length - 10} weitere Ergebnisse.\n`;
  }

  return ctx;
}

/**
 * Formatiert Gebäudezählung als Kontextblock.
 * @param {object} result - { count, scope }
 * @returns {string}
 */
export function formatBuildingCountContext(result) {
  const { count = 0, scope = "unbekannt" } = result;

  return (
    `### GEBÄUDEZÄHLUNG (PostGIS) ###\n` +
    `Anzahl: ${count}\n` +
    `Scope: ${scope}\n` +
    `Es gibt exakt ${count} Gebäude im angegebenen Bereich.\n` +
    `Dies ist ein gültiges deterministisches Ergebnis aus der OSM-Datenbank.\n`
  );
}

/**
 * Formatiert einen generischen Geo-Fehler (z.B. DB nicht verfügbar).
 */
export function formatGeoError(message) {
  return (
    `### GEO-DATENBANK ###\n` +
    `Status: Nicht verfügbar\n` +
    `${message}\n` +
    `Geo-basierte Abfragen können aktuell nicht beantwortet werden.\n`
  );
}
