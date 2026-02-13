/**
 * PostGIS Client Service
 * Creates pg Pool/Client connections with SSL, timeout, and maxRows support.
 */
import pg from "pg";

const { Pool } = pg;

let currentPool = null;
let currentConfigHash = "";

function configHash(cfg) {
  return JSON.stringify({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    schema: cfg.schema,
    sslMode: cfg.sslMode,
    statementTimeoutMs: cfg.statementTimeoutMs,
  });
}

function buildSslConfig(sslMode) {
  if (sslMode === "require") {
    return { rejectUnauthorized: false };
  }
  if (sslMode === "verify-full") {
    return { rejectUnauthorized: true };
  }
  return false;
}

function getPool(config) {
  const hash = configHash(config);
  if (currentPool && currentConfigHash === hash) {
    return currentPool;
  }
  // Tear down old pool
  if (currentPool) {
    currentPool.end().catch(() => {});
  }
  const ssl = buildSslConfig(config.sslMode);
  currentPool = new Pool({
    host: config.host || "127.0.0.1",
    port: Number(config.port) || 5432,
    database: config.database || undefined,
    user: config.user || undefined,
    password: config.password || undefined,
    ssl,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: Number(config.statementTimeoutMs) || 5000,
  });
  currentConfigHash = hash;
  return currentPool;
}

/**
 * Test the connection by running SELECT 1 and optionally SHOW server_version.
 */
export async function testConnection(config) {
  const pool = getPool(config);
  const start = Date.now();
  const client = await pool.connect();
  try {
    const r1 = await client.query("SELECT 1 AS ok");
    let serverVersion = null;
    try {
      const r2 = await client.query("SHOW server_version");
      serverVersion = r2.rows?.[0]?.server_version || null;
    } catch {
      // SHOW may fail on some setups, ignore
    }
    const durationMs = Date.now() - start;
    return {
      success: true,
      ok: r1.rows?.[0]?.ok === 1,
      durationMs,
      serverVersion,
    };
  } finally {
    client.release();
  }
}

/**
 * Execute a SELECT query with maxRows enforcement.
 */
export async function executeQuery(config, sql) {
  // Security: only allow SELECT statements
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  if (!upper.startsWith("SELECT") && !upper.startsWith("SHOW") && !upper.startsWith("EXPLAIN")) {
    throw new Error("Nur SELECT / SHOW / EXPLAIN Anweisungen sind erlaubt.");
  }

  // Block multi-statement (semicolon outside of string literals - simple heuristic)
  if (containsMultiStatement(trimmed)) {
    throw new Error("Mehrfach-Statements (;) sind nicht erlaubt.");
  }

  const maxRows = Number(config.maxRows) || 200;
  const pool = getPool(config);
  const start = Date.now();
  const client = await pool.connect();
  try {
    // Set statement timeout for this query
    await client.query(`SET statement_timeout = ${Number(config.statementTimeoutMs) || 5000}`);
    // Set search_path
    if (config.schema && config.schema !== "public") {
      await client.query(`SET search_path TO ${pg.Client.prototype.escapeIdentifier ? escapeIdent(config.schema) : '"' + config.schema.replace(/"/g, '""') + '"'}, public`);
    }

    // Enforce maxRows: wrap in subquery with LIMIT if no LIMIT present
    let finalSql = trimmed;
    if (upper.startsWith("SELECT") && !upper.includes("LIMIT")) {
      finalSql = `SELECT * FROM (${trimmed.replace(/;$/, "")}) AS _limited LIMIT ${maxRows}`;
    }

    const result = await client.query(finalSql);
    const durationMs = Date.now() - start;
    // Enforce row count guard
    const rows = result.rows ? result.rows.slice(0, maxRows) : [];
    return {
      success: true,
      columns: result.fields ? result.fields.map((f) => f.name) : [],
      rows,
      rowCount: rows.length,
      durationMs,
    };
  } finally {
    client.release();
  }
}

function escapeIdent(id) {
  return '"' + id.replace(/"/g, '""') + '"';
}

/**
 * Simple heuristic: detect multiple statements by finding ; outside of single-quoted strings.
 */
function containsMultiStatement(sql) {
  let inString = false;
  let semicolonCount = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // Handle escaped quotes ''
      if (inString && i + 1 < sql.length && sql[i + 1] === "'") {
        i++; // skip next
        continue;
      }
      inString = !inString;
    } else if (ch === ";" && !inString) {
      semicolonCount++;
      if (semicolonCount > 0) {
        // Check if there's meaningful content after the semicolon
        const rest = sql.slice(i + 1).trim();
        if (rest.length > 0) return true;
      }
    }
  }
  return false;
}

export function destroyPool() {
  if (currentPool) {
    currentPool.end().catch(() => {});
    currentPool = null;
    currentConfigHash = "";
  }
}
