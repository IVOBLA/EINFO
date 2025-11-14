import "./loadEnv.mjs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ROOT = path.resolve(__dirname, "..");

function resolveDataPath(rawValue) {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  if (trimmed.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
      return path.resolve(home, trimmed.slice(2));
    }
  }

  return path.resolve(SERVER_ROOT, trimmed);
}

const DEFAULT_DATA_ROOT = (() => {
  const dataDir = resolveDataPath(process.env.DATA_DIR);
  if (dataDir) {
    return dataDir;
  }

  const legacyDir = resolveDataPath(process.env.KANBAN_DATA_DIR);
  if (legacyDir) {
    return legacyDir;
  }

  return path.resolve(SERVER_ROOT, "data");
})();

function resolveConfiguredDir(envName, fallbackRelative) {
  const raw = resolveDataPath(process.env[envName]);
  if (raw) {
    return raw;
  }
  if (!fallbackRelative) {
    return DEFAULT_DATA_ROOT;
  }
  return path.resolve(DEFAULT_DATA_ROOT, fallbackRelative);
}

function resolveServerPrintDir() {
  const explicit = process.env.KANBAN_PRINT_OUTPUT_DIR;
  if (typeof explicit === "string" && explicit.trim()) {
    return path.resolve(explicit);
  }
  const printBase = process.env.PRINT_BASE_DIR;
  if (typeof printBase === "string" && printBase.trim()) {
    return path.resolve(printBase);
  }
  return path.resolve(DEFAULT_DATA_ROOT, "print-output");
}

export const DATA_ROOT = DEFAULT_DATA_ROOT;
export const MELDUNG_PDF_DIR = resolveConfiguredDir("KANBAN_MELDUNG_PRINT_DIR", "prints/meldung");
export const SERVER_PRINT_PDF_DIR = resolveServerPrintDir();
export const PROTOKOLL_PDF_DIR = resolveConfiguredDir("KANBAN_PROTOKOLL_PRINT_DIR", "prints/protokoll");
export const EINSATZ_PDF_DIR = resolveConfiguredDir("KANBAN_EINSATZ_PRINT_DIR", "prints/einsatz");

export const ALL_PROTOCOL_PDF_DIRS = Array.from(
  new Set([MELDUNG_PDF_DIR, SERVER_PRINT_PDF_DIR, PROTOKOLL_PDF_DIR].filter(Boolean)),
);

export async function ensurePdfDirectories(...dirs) {
  const targets = dirs.flat().filter(Boolean);
  await Promise.all(targets.map((dir) => fs.mkdir(dir, { recursive: true })));
}

