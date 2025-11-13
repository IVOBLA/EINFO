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
  const PRINT_BASE_DIR =
    process.env.PRINT_BASE_DIR ||
    (baseDir ? path.join(baseDir, printSubDir) : process.cwd());

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

      // Absoluten Pfad bauen und auf PRINT_BASE_DIR einschränken
      const absPath = path.resolve(PRINT_BASE_DIR, file);

      if (!isPathInside(PRINT_BASE_DIR, absPath)) {
        return res
          .status(400)
          .json({ ok: false, error: "Pfad ist nicht erlaubt", baseDir: PRINT_BASE_DIR });
      }

      if (!fs.existsSync(absPath)) {
        return res
          .status(404)
          .json({ ok: false, error: "Datei nicht gefunden", path: absPath });
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
      });
    } catch (err) {
      return next(err); // zentrale Fehler-Middleware in server.js kümmert sich ums Logging
    }
  });

  // Kleine Info-Route zum Debuggen
  router.get("/info", (_req, res) => {
    res.json({
      ok: true,
      baseDir: PRINT_BASE_DIR,
      platform: os.platform(),
    });
  });

  return router;
}
