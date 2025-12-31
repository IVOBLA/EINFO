// chatbot/server/einfo_io.js

import fsPromises from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError } from "./logger.js";
import { normalizeRole } from "./field_mapper.js";
import { readAufgBoardFile } from "./aufgaben_board_io.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDirAbs = path.resolve(__dirname, CONFIG.dataDir);

// Dateinamen an vorhandene Struktur angepasst:
const FILES = {
  roles: "roles.json",
  board: "board.json",
  protokoll: "protocol.json"
};

function validatePayload(value, validateFn, contextLabel) {
  if (typeof validateFn !== "function") return { ok: true };
  try {
    const result = validateFn(value);
    if (result === true) return { ok: true };
    if (result && typeof result === "object" && result.ok !== false) return { ok: true };
    const message = typeof result?.error === "string" ? result.error : "Ungültiges JSON-Format";
    return { ok: false, error: message, context: contextLabel };
  } catch (err) {
    return { ok: false, error: String(err || "Ungültiges JSON-Format"), context: contextLabel };
  }
}

const validateRolesPayload = (value) => {
  if (!value || typeof value !== "object") return { ok: false, error: "Rollen-Payload fehlt" };
  if (!value.roles || typeof value.roles !== "object") return { ok: false, error: '"roles"-Schlüssel fehlt' };
  const { active, missing } = value.roles;
  if (!Array.isArray(active) || !Array.isArray(missing)) {
    return { ok: false, error: "Rollen benötigen die Felder active und missing als Arrays" };
  }
  return { ok: true };
};

const validateBoardPayload = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Board-Payload muss ein Objekt sein" };
  if (!value.columns || typeof value.columns !== "object" || Array.isArray(value.columns)) {
    return { ok: false, error: "Pflichtfeld 'columns' fehlt oder ist ungültig" };
  }
  return { ok: true };
};

const validateArrayPayload = (label) => (value) => {
  if (!Array.isArray(value)) return { ok: false, error: `${label} muss ein Array sein` };
  return { ok: true };
};

async function safeReadJson(filePath, defaultValue, { validate, contextLabel } = {}) {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    const validation = validatePayload(parsed, validate, contextLabel || path.basename(filePath));
    if (!validation.ok) {
      logError(`Ungültige JSON-Struktur in ${filePath}`, { error: validation.error, context: validation.context });
      return defaultValue;
    }

    return parsed;
  } catch (err) {
    if (err.code !== "ENOENT") {
      logError(`Fehler beim Lesen von ${filePath}`, { error: String(err) });
    }
    return defaultValue;
  }
}

/**
 * Board flatten:
 * board.json hat die Form:
 * {
 *   "columns": {
 *     "neu": { name: "Neu", items: [...] },
 *     "in-bearbeitung": { ... },
 *     "erledigt": { ... }
 *   }
 * }
 */
function flattenBoard(boardRaw) {
  if (!boardRaw || typeof boardRaw !== "object") return [];

  const cols = boardRaw.columns || {};
  const result = [];

  for (const [colKey, col] of Object.entries(cols)) {
    const items = Array.isArray(col.items) ? col.items : [];
    for (const it of items) {
      result.push({
        // card + Spalteninfo
        id: it.id,
        column: colKey,
        columnName: col.name || colKey,
        content: it.content || "",
        ort: it.ort || "",
        typ: it.typ || "",
        alerted: it.alerted || "",
        timestamp: it.timestamp || it.createdAt || null,
        statusSince: it.statusSince || null,
        externalId: it.externalId || null,
        humanId: it.humanId || null,
        // Rohobjekt für evtl. spätere Erweiterungen
        raw: it
      });
    }
  }

  return result;
}

function normalizeRoleList(values = []) {
  const seen = new Set();
  const roles = [];
  for (const value of values) {
    const normalized = normalizeRole(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    roles.push(normalized);
  }
  return roles;
}

/**
 * Protokoll:
 * protocol.json ist ein Array von Protokolleinträgen.
 */
function normalizeProtokoll(raw) {
  if (!Array.isArray(raw)) return [];
  return raw;
}

export async function readEinfoInputs() {
  const rolesPath = path.join(dataDirAbs, FILES.roles);
  const boardPath = path.join(dataDirAbs, FILES.board);
  const protokollPath = path.join(dataDirAbs, FILES.protokoll);

  const [rolesRaw, boardRaw, protokollRaw] = await Promise.all([
    safeReadJson(rolesPath, { roles: { active: [], missing: [] } }, { validate: validateRolesPayload, contextLabel: "roles" }),
    safeReadJson(boardPath, { columns: {} }, { validate: validateBoardPayload, contextLabel: "board" }),
    safeReadJson(protokollPath, [], { validate: validateArrayPayload("protocol.json") })
  ]);

  const active = rolesRaw?.roles?.active || [];
  const missing = rolesRaw?.roles?.missing || [];
  const roleIds = normalizeRoleList([...active, ...missing]);

  const aufgabenBoards = await Promise.all(
    roleIds.map((roleId) =>
      readAufgBoardFile(path.join(dataDirAbs, `Aufg_board_${roleId}.json`), {
        roleId,
        logError
      })
    )
  );

  const board = flattenBoard(boardRaw);
  const aufgaben = aufgabenBoards.flatMap((boardData) =>
    Array.isArray(boardData?.items) ? boardData.items : []
  );
  const protokoll = normalizeProtokoll(protokollRaw);

  logDebug("EINFO-Inputs gelesen", {
    activeRolesCount: active.length,
    missingRolesCount: missing.length,
    boardCount: board.length,
    aufgabenCount: aufgaben.length,
    protokollCount: protokoll.length
  });

  return {
    roles: { active, missing },
    board,
    aufgaben,
    protokoll
  };
}
