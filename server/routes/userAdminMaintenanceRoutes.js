import express from "express";
import path from "path";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import { fileURLToPath } from "url";
import archiver from "archiver";
import { pipeline } from "stream";
import { promisify } from "util";
const pipe = promisify(pipeline);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * Factory: createAdminMaintenanceRoutes({ baseDir })
 * baseDir MUSS vom Server übergeben werden (z. B. <repo>/server/data).
 */
export default function createAdminMaintenanceRoutes({ baseDir }) {
  if (!baseDir) throw new Error("baseDir required for admin maintenance routes");

  const BASE_DIR    = path.resolve(baseDir);
  const INITIAL_DIR = path.join(BASE_DIR, "initial");
  const ARCHIVE_DIR = path.join(BASE_DIR, "archive");

  const router = express.Router();

  async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true }).catch(() => {}); }
  const isDataFile = (f) => /\.(csv|json)$/i.test(f);
  const toLowerSet = (arr) => new Set(arr.map(s => String(s).toLowerCase()));
  const SKIP_DIRS  = toLowerSet(["archive", "initial","user","conf"]); // beim Packen/Scannen auslassen

  function ts() {
    const d = new Date(); const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  async function collectDataFiles(root, skipDirs = SKIP_DIRS) {
    const result = [];
    async function walk(current, rel = "") {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const abs = path.join(current, e.name);
        const relPath = path.join(rel, e.name);
        if (e.isDirectory()) {
          if (skipDirs.has(e.name.toLowerCase())) continue;
          await walk(abs, relPath);
        } else if (e.isFile()) {
          if (isDataFile(e.name)) result.push({ abs, rel: relPath });
        }
      }
    }
    await walk(root, "");
    return result;
  }

  async function deleteCsvFiles(root, skipDirs = SKIP_DIRS) {
    let deleted = 0;
    async function walk(current) {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const abs = path.join(current, e.name);
        if (e.isDirectory()) {
          if (skipDirs.has(e.name.toLowerCase())) continue;
          await walk(abs);
        } else if (e.isFile()) {
          if (e.name.toLowerCase().endsWith(".csv")) {
            try { await fs.unlink(abs); deleted++; } catch {}
          }
        }
      }
    }
    await walk(root);
    return deleted;
  }

  function safeJoin(base, file) {
    const p = path.normalize(path.join(base, file));
    if (!path.resolve(p).startsWith(path.resolve(base))) throw new Error("unsafe path");
    return p;
  }

  function setZipHeaders(res, filename, size) {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (Number.isFinite(size)) res.setHeader("Content-Length", String(size));
    res.setHeader("Content-Encoding", "identity"); // kein gzip
    res.setHeader("Cache-Control", "no-store");
  }

  // ---- Initialsetup -------------------------------------------------
  router.post("/initialsetup", async (_req, res) => {
    try {
      await ensureDir(BASE_DIR);
      await ensureDir(INITIAL_DIR);

      const deletedCount = await deleteCsvFiles(BASE_DIR);

      // aus initial ALLE (csv+json) kopieren
      const files = await collectDataFiles(INITIAL_DIR, toLowerSet([]));
      for (const f of files) {
        const dest = path.join(BASE_DIR, f.rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(f.abs, dest); // überschreibt
      }

      res.json({
        ok: true,
        message: `Initialsetup abgeschlossen. ${deletedCount} CSV gelöscht, ${files.length} Dateien kopiert.`,
        baseDir: BASE_DIR.replaceAll("\\", "/"),
      });
    } catch (err) {
      console.error("Initialsetup error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---- Archive (create on disk) ------------------------------------
  router.post("/archive", async (_req, res) => {
    try {
      await ensureDir(BASE_DIR);
      await ensureDir(ARCHIVE_DIR);

      const zipName = `archive_${ts()}.zip`;
      const zipPath = path.join(ARCHIVE_DIR, zipName);

      const files = await collectDataFiles(BASE_DIR); // SKIP_DIRS aktiv

      const out = createWriteStream(zipPath);
      const zip = archiver("zip", { zlib: { level: 9 } });

      const done = new Promise((resolve, reject) => {
        out.on("close", resolve);
        out.on("error", reject);
        zip.on("warning", (w) => console.warn("archiver warning:", w?.message || w));
        zip.on("error", reject);
      });

      zip.pipe(out);
      for (const f of files) zip.file(f.abs, { name: f.rel });
      await zip.finalize();
      await done;

      const st = await fs.stat(zipPath);

      res.json({
        ok: true,
        file: zipName,
        path: zipPath.replaceAll("\\", "/"),
        size: st.size,
        count: files.length,
        message: `Archiv erstellt (${files.length} Dateien, ${st.size} Bytes): ${zipName}`,
        baseDir: BASE_DIR.replaceAll("\\", "/"),
      });
    } catch (err) {
      console.error("Archive error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---- Create & Download (save then stream) -------------------------
  router.get("/archive/create-download", async (_req, res) => {
    try {
      await ensureDir(BASE_DIR);
      await ensureDir(ARCHIVE_DIR);

      const zipName = `archive_${ts()}.zip`;
      const zipPath = path.join(ARCHIVE_DIR, zipName);

      const files = await collectDataFiles(BASE_DIR);

      const out = createWriteStream(zipPath);
      const zip = archiver("zip", { zlib: { level: 9 } });
      const done = new Promise((resolve, reject) => {
        out.on("close", resolve);
        out.on("error", reject);
        zip.on("warning", (w) => console.warn("archiver warning:", w?.message || w));
        zip.on("error", reject);
      });
      zip.pipe(out);
      for (const f of files) zip.file(f.abs, { name: f.rel });
      await zip.finalize();
      await done;

      const st = await fs.stat(zipPath);
      setZipHeaders(res, zipName, st.size);
      await pipe(createReadStream(zipPath), res);
    } catch (err) {
      console.error("Archive create-download error:", err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---- Download existing file --------------------------------------
  router.get("/archive/download/:file", async (req, res) => {
    try {
      const file = path.basename(String(req.params.file || ""));
      const abs  = safeJoin(ARCHIVE_DIR, file);
      const st   = await fs.stat(abs);
      setZipHeaders(res, file, st.size);
      await pipe(createReadStream(abs), res);
    } catch (err) {
      console.error("Archive download error:", err);
      if (!res.headersSent) res.status(404).json({ ok: false, error: "Datei nicht gefunden" });
    }
  });

  // ---- Testlist / Diagnose -----------------------------------------
  router.get("/archive/testlist", async (_req, res) => {
    try {
      const files = await collectDataFiles(BASE_DIR);
      const top = await fs.readdir(BASE_DIR).catch(() => []);
      res.json({
        ok: true,
        baseDir: BASE_DIR.replaceAll("\\", "/"),
        initialDir: INITIAL_DIR.replaceAll("\\", "/"),
        archiveDir: ARCHIVE_DIR.replaceAll("\\", "/"),
        count: files.length,
        sample: files.slice(0, 10).map(f => f.rel),
        topLevel: top,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
