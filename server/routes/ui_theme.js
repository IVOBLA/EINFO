// server/routes/ui_theme.js
//
// API-Endpunkte fuer UI-Theme-Konfiguration (Farben, Watermark)

import express from "express";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { User_requireAdmin } from "../User_auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const THEME_FILE = path.resolve(__dirname, "../data/conf/ui_theme.json");

const DEFAULT_THEME = {
  version: "1.0.0",
  colors: {
    col_new: "#dc2626",
    col_progress: "#d97706",
    col_done: "#059669",
    col_accent: "#1e40af",
    col_surface: "rgba(255,255,255,.92)",
    col_surface_hover: "rgba(255,255,255,.98)",
  },
  watermark: {
    image: "/Logo.png",
    opacity: 0.18,
    sizeVw: 90,
    maxPx: 900,
    posX: 50,
    posY: 50,
    grayscale: true,
  },
};

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fsPromises.mkdir(dir, { recursive: true });
  } catch {
    // Verzeichnis existiert bereits
  }
}

async function loadThemeOrDefault() {
  try {
    const raw = await fsPromises.readFile(THEME_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // Merge mit Defaults fuer fehlende Felder
    return {
      version: parsed.version || DEFAULT_THEME.version,
      colors: { ...DEFAULT_THEME.colors, ...(parsed.colors || {}) },
      watermark: { ...DEFAULT_THEME.watermark, ...(parsed.watermark || {}) },
    };
  } catch {
    // Datei fehlt oder ungueltig -> Defaults schreiben
    await ensureDir(THEME_FILE);
    await fsPromises.writeFile(THEME_FILE, JSON.stringify(DEFAULT_THEME, null, 2), "utf8");
    return { ...DEFAULT_THEME };
  }
}

function clamp(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function sanitizeTheme(body) {
  const theme = { version: DEFAULT_THEME.version, colors: {}, watermark: {} };

  // Farben: Strings akzeptieren, null/undefined -> Default
  const colors = body?.colors || {};
  for (const key of Object.keys(DEFAULT_THEME.colors)) {
    const val = colors[key];
    theme.colors[key] = typeof val === "string" && val.trim() ? val.trim() : DEFAULT_THEME.colors[key];
  }

  // Watermark
  const wm = body?.watermark || {};
  theme.watermark = {
    image: typeof wm.image === "string" && wm.image.trim() ? wm.image.trim() : DEFAULT_THEME.watermark.image,
    opacity: clamp(wm.opacity, 0, 1),
    sizeVw: clamp(wm.sizeVw, 10, 200),
    maxPx: clamp(wm.maxPx, 100, 2000),
    posX: clamp(wm.posX, 0, 100),
    posY: clamp(wm.posY, 0, 100),
    grayscale: typeof wm.grayscale === "boolean" ? wm.grayscale : DEFAULT_THEME.watermark.grayscale,
  };

  return theme;
}

// GET /api/ui-theme – fuer alle eingeloggten User
router.get("/", async (_req, res) => {
  try {
    const theme = await loadThemeOrDefault();
    res.json(theme);
  } catch (err) {
    console.error("Fehler beim Laden des UI-Themes:", err);
    res.status(500).json({ error: "Interner Fehler" });
  }
});

// PUT /api/ui-theme – nur Admin
router.put("/", User_requireAdmin, async (req, res) => {
  try {
    const theme = sanitizeTheme(req.body);
    await ensureDir(THEME_FILE);
    await fsPromises.writeFile(THEME_FILE, JSON.stringify(theme, null, 2), "utf8");
    res.json(theme);
  } catch (err) {
    console.error("Fehler beim Speichern des UI-Themes:", err);
    res.status(500).json({ error: "Interner Fehler" });
  }
});

export default router;
