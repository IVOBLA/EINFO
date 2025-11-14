import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_ROOT = path.resolve(
  process.env.KANBAN_DATA_DIR || path.join(__dirname, "..", "data"),
);

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

export const DATA_ROOT = DEFAULT_DATA_ROOT;
export const MELDUNG_PDF_DIR = resolveConfiguredDir("KANBAN_MELDUNG_PRINT_DIR", "prints/meldung");
export const LEGACY_PDF_DIR = resolveConfiguredDir("KANBAN_PRINT_OUTPUT_DIR", "print-output");
export const PROTOKOLL_PDF_DIR = resolveConfiguredDir("KANBAN_PROTOKOLL_PRINT_DIR", "prints/protokoll");
export const EINSATZ_PDF_DIR = resolveConfiguredDir("KANBAN_EINSATZ_PRINT_DIR", "prints/einsatz");

export const ALL_PROTOCOL_PDF_DIRS = Array.from(
  new Set([MELDUNG_PDF_DIR, LEGACY_PDF_DIR, PROTOKOLL_PDF_DIR].filter(Boolean)),
);

export async function ensurePdfDirectories(...dirs) {
  const targets = dirs.flat().filter(Boolean);
  await Promise.all(targets.map((dir) => fs.mkdir(dir, { recursive: true })));
}

