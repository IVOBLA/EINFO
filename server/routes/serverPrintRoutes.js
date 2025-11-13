// server/routes/serverPrintRoutes.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import printer from "pdf-to-printer";
const { print: winPrint } = printer;

/**
 * Erzeugt einen Router, der PDFs direkt am Server auf den Standarddrucker schickt.
 *
 * Erwartet POST /api/print/server mit Body:
 *   { "file": "mein_protokoll.pdf" }
 *
 * Die Datei wird relativ zu PRINT_BASE_DIR gesucht:
 *   - process.env.PRINT_BASE_DIR ODER
 *   - <baseDir>/print-output (baseDir kommt aus server.js = DATA_DIR)
 */
export default function createServerPrintRoutes({ baseDir, printSubDir = "print-output" } = {}) {
  const router = Router();

  // Basisverzeichnis, in dem die druckbaren PDFs liegen
  const ROOT_BASE_DIR = baseDir ? path.resolve(baseDir) : process.cwd();
  const DEFAULT_PRINT_DIR = path.resolve(
    process.env.PRINT_BASE_DIR || path.join(ROOT_BASE_DIR, printSubDir),
  );
  const MELDUNG_PRINT_DIR = path.resolve(
    process.env.KANBAN_MELDUNG_PRINT_DIR || path.join(ROOT_BASE_DIR, "prints", "meldung"),
  );
  const PROTOKOLL_PRINT_DIR = path.resolve(
    process.env.KANBAN_PROTOKOLL_PRINT_DIR || path.join(ROOT_BASE_DIR, "prints", "protokoll"),
  );

  const SCOPE_DIRS = new Map([
    ["default", DEFAULT_PRINT_DIR],
    ["legacy", DEFAULT_PRINT_DIR],
    ["meldung", MELDUNG_PRINT_DIR],
    ["server", MELDUNG_PRINT_DIR],
    ["protocol", PROTOKOLL_PRINT_DIR],
    ["protokoll", PROTOKOLL_PRINT_DIR],
    ["auto", PROTOKOLL_PRINT_DIR],
  ]);

  function resolveScope(rawScope) {
    if (typeof rawScope === "string") {
      const key = rawScope.trim().toLowerCase();
      if (SCOPE_DIRS.has(key)) {
        return { key, dir: SCOPE_DIRS.get(key) };
      }
    }
    return { key: "default", dir: SCOPE_DIRS.get("default") };
  }

  /**
   * Sicherheits-Helper: liegt "child" innerhalb von "parent"?
   */
  function isPathInside(parent, child) {
    const rel = path.relative(parent, child);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  /**
   * POST /api/print/server
   * Body: { "file": "protokoll_4711.pdf" }
   */
  router.post("/", async (req, res, next) => {
    try {
      const { file } = req.body || {};

      if (!file || typeof file !== "string") {
        return res
          .status(400)
          .json({ ok: false, error: "Parameter 'file' fehlt oder ist ungültig" });
      }

      // Nur PDFs zulassen
      if (!file.toLowerCase().endsWith(".pdf")) {
        return res
          .status(400)
          .json({ ok: false, error: "Nur PDF-Dateien können gedruckt werden" });
      }

      const { key: scopeKey, dir: scopeDir } = resolveScope(req.body?.scope);

      // Absoluten Pfad bauen und auf scopeDir einschränken
      const absPath = path.resolve(scopeDir, file);

      if (!isPathInside(scopeDir, absPath)) {
        return res
          .status(400)
          .json({ ok: false, error: "Pfad ist nicht erlaubt", baseDir: scopeDir, scope: scopeKey });
      }

      if (!fs.existsSync(absPath)) {
        return res
          .status(404)
          .json({ ok: false, error: "Datei nicht gefunden", path: absPath, scope: scopeKey });
      }

      const platform = os.platform();

      // ---------------- Windows (win32) ----------------
      if (platform === "win32") {
        // pdf-to-printer → Standarddrucker, wenn kein "printer"-Name angegeben
        await winPrint(absPath, {});
        return res.json({
          ok: true,
          message: "Druck an Standarddrucker unter Windows gesendet",
          file,
          scope: scopeKey,
        });
      }

      // ---------------- Linux / macOS ----------------
      // lp nutzt den Standarddrucker, wenn kein -d angegeben ist
      await new Promise((resolve, reject) => {
        execFile("lp", [absPath], (err, stdout, stderr) => {
          if (err) {
            const error = new Error("lp-Aufruf fehlgeschlagen");
            error.stdout = stdout?.toString();
            error.stderr = stderr?.toString();
            return reject(error);
          }
          resolve(stdout?.toString());
        });
      });

      return res.json({
        ok: true,
        message: "Druck an Standarddrucker (lp) gesendet",
        file,
        scope: scopeKey,
      });
    } catch (err) {
      return next(err); // zentrale Fehler-Middleware in server.js kümmert sich ums Logging
    }
  });

  // Kleine Info-Route zum Debuggen
  router.get("/info", (_req, res) => {
    res.json({
      ok: true,
      scopes: Object.fromEntries(SCOPE_DIRS.entries()),
      platform: os.platform(),
    });
  });

  return router;
}
