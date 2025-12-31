import fsPromises from "node:fs/promises";
import path from "node:path";

const DEFAULT_BOARD = { items: [] };

export function normalizeAufgBoard(raw) {
  if (Array.isArray(raw)) return { items: raw };
  if (!raw || typeof raw !== "object") return { items: [] };
  if (Array.isArray(raw.items)) return raw;
  return { items: [] };
}

export function validateAufgBoard(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Board muss Objekt sein" };
  }
  if (!Array.isArray(raw.items)) {
    return { ok: false, error: "items muss Array sein" };
  }
  return { ok: true };
}

function buildBoardErrorMessage(filePath, roleId, message) {
  const fileName = path.basename(filePath);
  const roleLabel = roleId || "UNBEKANNT";
  return `Aufgabenboard ${fileName} (${roleLabel}): ${message}`;
}

async function backupBoardFile(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak-${stamp}`;
  await fsPromises.copyFile(filePath, backupPath);
}

export async function readAufgBoardFile(
  filePath,
  { roleId, logError, writeBack = true, backupOnChange = true } = {}
) {
  let rawText;
  let parsed;
  let fileExists = true;

  try {
    rawText = await fsPromises.readFile(filePath, "utf8");
    parsed = JSON.parse(rawText);
  } catch (err) {
    if (err?.code === "ENOENT") {
      fileExists = false;
    } else {
      if (logError) {
        logError(buildBoardErrorMessage(filePath, roleId, "JSON nicht lesbar"), {
          error: String(err?.message || err)
        });
      }
    }
  }

  const normalized = normalizeAufgBoard(parsed);
  const validation = parsed === undefined ? { ok: false } : validateAufgBoard(parsed);

  if (parsed !== undefined && !validation.ok && logError) {
    logError(buildBoardErrorMessage(filePath, roleId, validation.error));
  }

  const shouldPersist = writeBack && (!fileExists || parsed === undefined || !validation.ok);
  if (shouldPersist) {
    if (backupOnChange && fileExists && rawText != null) {
      try {
        await backupBoardFile(filePath);
      } catch (err) {
        if (logError) {
          logError(buildBoardErrorMessage(filePath, roleId, "Backup fehlgeschlagen"), {
            error: String(err?.message || err)
          });
        }
      }
    }
    await fsPromises.writeFile(filePath, JSON.stringify(normalized, null, 2), "utf8");
  }

  return normalized;
}

export async function writeAufgBoardFile(filePath, board) {
  const normalized = normalizeAufgBoard(board || DEFAULT_BOARD);
  await fsPromises.writeFile(filePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}
