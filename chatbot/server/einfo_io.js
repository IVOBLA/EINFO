// chatbot/server/einfo_io.js

import fsPromises from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDirAbs = path.resolve(__dirname, CONFIG.dataDir);

// Dateinamen an vorhandene Struktur angepasst:
const FILES = {
  roles: "roles.json",
  board: "board.json",
  aufgabenS2: "Aufg_board_S2.json",
  protokoll: "protocol.json"
};

async function safeReadJson(filePath, defaultValue) {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(raw);
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

/**
 * Aufgabenboard S2:
 * Aufg_board_S2.json ist ein Array von Tasks.
 */
function normalizeAufgabenS2(raw) {
  if (!Array.isArray(raw)) return [];
  return raw;
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
  const aufgabenS2Path = path.join(dataDirAbs, FILES.aufgabenS2);
  const protokollPath = path.join(dataDirAbs, FILES.protokoll);

  const [rolesRaw, boardRaw, aufgabenS2Raw, protokollRaw] = await Promise.all([
    safeReadJson(rolesPath, { roles: { active: [], missing: [] } }),
    safeReadJson(boardPath, { columns: {} }),
    safeReadJson(aufgabenS2Path, []),
    safeReadJson(protokollPath, [])
  ]);

  const active = rolesRaw?.roles?.active || [];
  const missing = rolesRaw?.roles?.missing || [];

  const board = flattenBoard(boardRaw);
  const aufgaben = normalizeAufgabenS2(aufgabenS2Raw);
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
