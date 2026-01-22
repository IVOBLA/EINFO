import express from "express";
import path from "path";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import { fileURLToPath } from "url";
import archiver from "archiver";
import { pipeline } from "stream";
import { promisify } from "util";
import multer from "multer";
import {
  chatbotStatus,
  chatbotStatusWithHealth,
  chatbotServerStart,
  chatbotServerStop,
  workerStart,
  workerStop,
  startAll,
  stopAll,
  syncAiAnalysisLoop,
  runIngest,
  listKnowledgeFiles,
  saveKnowledgeFile,
  deleteKnowledgeFile,
  KNOWLEDGE_DIR,
} from "../chatbotRunner.js";
import { getLogDirCandidates } from "../utils/logDirectories.mjs";

const pipe = promisify(pipeline);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * Factory: createAdminMaintenanceRoutes({ baseDir })
 * baseDir MUSS vom Server �bergeben werden (z. B. <repo>/server/data).
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

  async function collectLogFiles(logDirs) {
    const result = [];
    const existing = [];
    for (const dir of logDirs) {
      if (!dir) continue;
      try {
        const st = await fs.stat(dir);
        if (st.isDirectory()) existing.push(dir);
      } catch {}
    }
    const nameCounts = new Map();
    for (const dir of existing) {
      const baseName = path.basename(dir);
      const count = (nameCounts.get(baseName) ?? 0) + 1;
      nameCounts.set(baseName, count);
      const uniqueName = count === 1 ? baseName : `${baseName}_${count}`;
      const walk = async (current, rel = "") => {
        const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          const abs = path.join(current, e.name);
          const relPath = path.join(rel, e.name);
          if (e.isDirectory()) {
            await walk(abs, relPath);
          } else if (e.isFile()) {
            result.push({ abs, rel: path.join(uniqueName, relPath) });
          }
        }
      };
      await walk(dir, "");
    }
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
        await fs.copyFile(f.abs, dest); // �berschreibt
      }

      res.json({
        ok: true,
        message: `Initialsetup abgeschlossen. ${deletedCount} CSV gel�scht, ${files.length} Dateien kopiert.`,
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

  // ---- Download all logs (ZIP stream) ------------------------------
  router.get("/logs/download", async (_req, res) => {
    try {
      const logDirs = getLogDirCandidates();
      const files = await collectLogFiles(logDirs);
      if (!files.length) {
        return res.status(404).json({ ok: false, error: "Keine Logfiles gefunden" });
      }

      const zipName = `logs_${ts()}.zip`;
      setZipHeaders(res, zipName);

      const zip = archiver("zip", { zlib: { level: 9 } });
      zip.on("warning", (w) => console.warn("archiver warning:", w?.message || w));
      zip.on("error", (err) => {
        console.error("Log-Archiv error:", err);
        if (!res.headersSent) res.status(500).end();
      });

      zip.pipe(res);
      for (const f of files) zip.file(f.abs, { name: f.rel });
      await zip.finalize();
    } catch (err) {
      console.error("Log-Archiv download error:", err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
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

  // ===========================================================================
  // CHATBOT & WORKER KONTROLLE
  // ===========================================================================

  // Status abrufen (mit Health-Check ob Port 3100 erreichbar ist)
  router.get("/chatbot/status", async (_req, res) => {
    try {
      const status = await chatbotStatusWithHealth();
      res.json({ ok: true, ...status });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Chatbot und Worker zusammen starten
  router.post("/chatbot/start", async (_req, res) => {
    try {
      const result = await startAll();
      res.json(result);
    } catch (err) {
      console.error("Chatbot start error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Chatbot und Worker zusammen stoppen
  router.post("/chatbot/stop", async (_req, res) => {
    try {
      const result = await stopAll();
      res.json(result);
    } catch (err) {
      console.error("Chatbot stop error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Nur Chatbot-Server starten
  router.post("/chatbot/server/start", async (_req, res) => {
    try {
      const result = await chatbotServerStart();
      await syncAiAnalysisLoop();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("Chatbot server start error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Nur Chatbot-Server stoppen
  router.post("/chatbot/server/stop", async (_req, res) => {
    try {
      const result = await chatbotServerStop();
      res.json(result);
    } catch (err) {
      console.error("Chatbot server stop error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Nur Worker starten
  router.post("/chatbot/worker/start", async (_req, res) => {
    try {
      const result = await workerStart();
      await syncAiAnalysisLoop();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("Worker start error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Nur Worker stoppen
  router.post("/chatbot/worker/stop", async (_req, res) => {
    try {
      const result = await workerStop();
      res.json(result);
    } catch (err) {
      console.error("Worker stop error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===========================================================================
  // KNOWLEDGE-VERWALTUNG
  // ===========================================================================

  // Multer-Konfiguration für File-Uploads
  const knowledgeStorage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await fs.mkdir(KNOWLEDGE_DIR, { recursive: true }).catch(() => {});
      cb(null, KNOWLEDGE_DIR);
    },
    filename: (_req, file, cb) => {
      // Originalnamen beibehalten, aber unsichere Zeichen ersetzen
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, safeName);
    },
  });

  const knowledgeUpload = multer({
    storage: knowledgeStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // Max 50MB
    fileFilter: (_req, file, cb) => {
      // Erlaubte Dateitypen
      const allowedTypes = [".txt", ".pdf", ".json", ".md", ".csv"];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedTypes.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Dateityp ${ext} nicht erlaubt. Erlaubt: ${allowedTypes.join(", ")}`));
      }
    },
  });

  // Knowledge-Dateien auflisten
  router.get("/knowledge/files", async (_req, res) => {
    try {
      const files = await listKnowledgeFiles();
      res.json({ ok: true, files, knowledgeDir: KNOWLEDGE_DIR });
    } catch (err) {
      console.error("Knowledge list error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Datei hochladen
  router.post("/knowledge/upload", knowledgeUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Keine Datei hochgeladen" });
      }
      res.json({
        ok: true,
        filename: req.file.filename,
        size: req.file.size,
        message: `Datei "${req.file.filename}" erfolgreich hochgeladen`,
      });
    } catch (err) {
      console.error("Knowledge upload error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Mehrere Dateien hochladen
  router.post("/knowledge/upload-multiple", knowledgeUpload.array("files", 20), async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ ok: false, error: "Keine Dateien hochgeladen" });
      }
      const uploaded = req.files.map((f) => ({
        filename: f.filename,
        size: f.size,
      }));
      res.json({
        ok: true,
        files: uploaded,
        count: uploaded.length,
        message: `${uploaded.length} Datei(en) erfolgreich hochgeladen`,
      });
    } catch (err) {
      console.error("Knowledge multi-upload error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Datei löschen
  router.delete("/knowledge/files/:filename", async (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename) {
        return res.status(400).json({ ok: false, error: "Dateiname fehlt" });
      }
      const result = await deleteKnowledgeFile(filename);
      res.json(result);
    } catch (err) {
      console.error("Knowledge delete error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===========================================================================
  // INGEST (Knowledge-Indexierung)
  // ===========================================================================

  // Ingest starten
  router.post("/knowledge/ingest", async (_req, res) => {
    try {
      const result = await runIngest();
      res.json(result);
    } catch (err) {
      console.error("Ingest error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
