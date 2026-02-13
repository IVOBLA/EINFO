/**
 * Admin PostGIS Routes
 * API endpoints for PostGIS configuration, testing, query execution, and log viewing.
 * All endpoints require Admin role.
 */
import express from "express";
import { User_requireAdmin } from "../User_auth.mjs";
import {
  initConfigStore,
  loadConfig,
  saveConfig,
  sanitizeForFrontend,
} from "../services/postgisConfigStore.js";
import {
  initLogger,
  createLogEntry,
  appendLog,
  getRecentLogs,
} from "../services/postgisLogger.js";
import {
  testConnection,
  executeQuery,
} from "../services/postgisClient.js";

export default function createAdminPostgisRoutes({ dataDir, serverRoot }) {
  initConfigStore(dataDir);
  initLogger(serverRoot);

  const router = express.Router();
  router.use(express.json({ limit: "256kb" }));

  // ------ GET /config ------
  router.get("/config", User_requireAdmin, async (_req, res) => {
    try {
      const config = await loadConfig();
      res.json({ ok: true, config: sanitizeForFrontend(config) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ------ POST /config ------
  router.post("/config", User_requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      // Whitelist allowed fields
      const allowed = [
        "host", "port", "database", "user", "password", "schema",
        "sslMode", "statementTimeoutMs", "maxRows",
        "logSql", "logResponse", "logErrors", "persistLogs", "maskSensitive",
      ];
      const update = {};
      for (const key of allowed) {
        if (body[key] !== undefined) update[key] = body[key];
      }
      const saved = await saveConfig(update);
      res.json({ ok: true, config: sanitizeForFrontend(saved) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ------ POST /test ------
  router.post("/test", User_requireAdmin, async (req, res) => {
    const config = await loadConfig();
    const username = req.user?.username || req.user?.displayName || "admin";
    try {
      const result = await testConnection(config);
      const entry = createLogEntry({
        action: "test",
        sql: "SELECT 1 AS ok",
        durationMs: result.durationMs,
        rowCount: 1,
        success: true,
        config,
        user: username,
      });
      await appendLog(entry, config);
      res.json({
        ok: true,
        status: "CONNECTED",
        durationMs: result.durationMs,
        serverVersion: result.serverVersion,
        testedAt: new Date().toISOString(),
      });
    } catch (err) {
      const entry = createLogEntry({
        action: "test",
        sql: "SELECT 1 AS ok",
        success: false,
        error: err,
        config,
        user: username,
      });
      await appendLog(entry, config);
      res.json({
        ok: false,
        status: "FAILED",
        error: err.message || String(err),
        testedAt: new Date().toISOString(),
      });
    }
  });

  // ------ POST /query ------
  router.post("/query", User_requireAdmin, async (req, res) => {
    const config = await loadConfig();
    const username = req.user?.username || req.user?.displayName || "admin";
    const sql = (req.body?.sql || "").trim();

    if (!sql) {
      return res.status(400).json({ ok: false, error: "SQL darf nicht leer sein." });
    }
    if (sql.length > 10000) {
      return res.status(400).json({ ok: false, error: "SQL zu lang (max 10.000 Zeichen)." });
    }

    try {
      const result = await executeQuery(config, sql);
      const entry = createLogEntry({
        action: "query",
        sql,
        durationMs: result.durationMs,
        rowCount: result.rowCount,
        success: true,
        rows: result.rows,
        config,
        user: username,
      });
      await appendLog(entry, config);
      res.json({
        ok: true,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const entry = createLogEntry({
        action: "query",
        sql,
        success: false,
        error: err,
        config,
        user: username,
      });
      await appendLog(entry, config);
      res.status(400).json({
        ok: false,
        error: err.message || String(err),
      });
    }
  });

  // ------ GET /logs ------
  router.get("/logs", User_requireAdmin, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 200;
      const logs = getRecentLogs(limit);
      res.json({ ok: true, logs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
