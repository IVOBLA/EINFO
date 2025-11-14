import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");

const configuredLogDir = process.env.KANBAN_LOG_DIR?.trim();

function normalizeLogDir(dir) {
  if (!dir) return null;
  return path.isAbsolute(dir) ? dir : path.resolve(serverRoot, dir);
}

const candidates = [
  normalizeLogDir(configuredLogDir),
  path.join(serverRoot, "logs"),
  path.join(serverRoot, "data", "logs"),
].filter(Boolean);

export function getLogDirCandidates() {
  return [...candidates];
}

export const logDirCandidates = getLogDirCandidates();
