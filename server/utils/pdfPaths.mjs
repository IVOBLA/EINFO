import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_ROOT = (() => {
  const dataDir = process.env.DATA_DIR;
  if (typeof dataDir === "string" && dataDir.trim()) {
    return path.resolve(dataDir);
  }

  const legacyDir = process.env.KANBAN_DATA_DIR;
  if (typeof legacyDir === "string" && legacyDir.trim()) {
    return path.resolve(legacyDir);
  }

  return path.resolve(__dirname, "..", "data");
})();

function resolveConfiguredDir(envName, fallbackRelative) {
  const raw = process.env[envName];
  if (typeof raw === "string" && raw.trim()) {
    return path.resolve(raw);
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

