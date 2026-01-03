// chatbot/server/simulation_helpers.js
// ============================================================
// Hilfsfunktionen für die EINFO Simulation
// 
// Enthält:
// - LtStb-Bestätigung von Protokolleinträgen
// - Statuswechsel für Aufgaben simulierter Stabsstellen
// - S2-Regel: Mindestens ein Einsatz "In Bearbeitung"
// - Fahrzeugzuweisung nach Entfernung
// - Aufgaben-Ableitung wenn LtStb simuliert wird
// ============================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExterneStelle,
  isMeldestelle,
  isStabsstelle,
  normalizeRole
} from "./field_mapper.js";
import { readAufgBoardFile, writeAufgBoardFile } from "./aufgaben_board_io.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Datenverzeichnis
const DATA_DIR = process.env.EINFO_DATA_DIR || path.resolve(__dirname, "data");

// Einfacher Logger
const log = (level, msg, data) => {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${timestamp}] [${level}] [sim_helpers] ${msg}${dataStr}`);
};

// ============================================================
// 0. Hilfsfunktion: Rolle aus anvon-Feld extrahieren
// ============================================================

/**
 * Extrahiert Rolle aus "Von: EL" oder "An: S2" Format
 * @param {string} anvon - z.B. "Von: EL" oder "EL"
 * @returns {string|null}
 */
function extractRoleFromAnvon(anvon) {
  if (!anvon || typeof anvon !== 'string') return null;
  const trimmed = anvon.trim();
  // "Von: EL" oder "An: S2" → "EL" bzw "S2"
  const match = trimmed.match(/^(?:Von|An):\s*(.+)$/i);
  return match ? match[1].trim() : trimmed;
}

// ============================================================
// Feuerwehr-Standorte im Bezirk Feldkirchen
// ============================================================

const FEUERWEHR_STANDORTE = {
  "FF Feldkirchen": { lat: 46.7233, lon: 14.0954 },
  "FF Poitschach": { lat: 46.6720, lon: 13.9973 },
  "FF Gnesau": { lat: 46.7650, lon: 13.9420 },
  "FF Sirnitz": { lat: 46.8249, lon: 14.0538 },
  "FF Tschwarzen": { lat: 46.6890, lon: 14.0120 },
  "FF St.Ulrich": { lat: 46.7180, lon: 14.1050 },
  "FF Albeck": { lat: 46.8200, lon: 14.0600 },
  "FF Himmelberg": { lat: 46.7550, lon: 14.0200 },
  "FF Steuerberg": { lat: 46.7800, lon: 14.1200 },
  "FF Waiern": { lat: 46.7100, lon: 14.0800 },
  "FF Ossiach": { lat: 46.6750, lon: 14.0950 },
  "FF Glanegg": { lat: 46.7400, lon: 14.0700 },
  "FF Radweg": { lat: 46.7000, lon: 14.0500 },
  "FF Sittich": { lat: 46.7300, lon: 14.0300 }
};

// ============================================================
// 1. LtStb-Bestätigung (Anforderung 9)
// ============================================================

/**
 * Bestätigt alle unbestätigten Protokolleinträge wenn LtStb simuliert wird.
 * 
 * Laut Anforderung: "Jede Meldung muss von der Rolle LtStb (wenn sie 
 * simuliert wird) bestätigt werden. (otherRecipientConfirmation)"
 * 
 * @param {string[]} activeRoles - Aktiv besetzte Rollen
 * @param {string} protokollPath - Pfad zur protocol.json
 * @returns {Promise<{ confirmedCount: number }>}
 */
export async function confirmProtocolsByLtStb(activeRoles, protokollPath) {
  const normalizedActive = Array.isArray(activeRoles)
    ? activeRoles.map(r => normalizeRole(r))
    : [];

  const ltStbActive = normalizedActive.includes("LTSTB") ||
                      normalizedActive.includes("LTSTBSTV");

  if (ltStbActive) {
    log("debug", "LtStb-Bestätigung übersprungen: LtStb ist besetzt");
    return { confirmedCount: 0 };
  }

  // Protokoll laden
  let protokoll = [];
  try {
    const content = await fs.readFile(protokollPath, "utf8");
    protokoll = JSON.parse(content);
    if (!Array.isArray(protokoll)) protokoll = [];
  } catch (err) {
    log("debug", "Protokoll für LtStb-Bestätigung nicht lesbar", { error: err.message });
    return { confirmedCount: 0 };
  }

  // Unbestätigte Einträge finden und bestätigen
  let confirmedCount = 0;
  const now = Date.now();
  const confirmRole = "LtStb";

  for (const entry of protokoll) {
    const confirmation = entry.otherRecipientConfirmation;

    // Nur unbestätigte Einträge bearbeiten
    if (!confirmation?.confirmed) {
      // Bestätigung setzen
      entry.otherRecipientConfirmation = {
        confirmed: true,
        by: "Simulation",
        byRole: confirmRole,
        at: now
      };

      // History-Eintrag hinzufügen für Audit-Trail
      if (!Array.isArray(entry.history)) {
        entry.history = [];
      }
      entry.history.push({
        action: "confirmed",
        at: new Date(now).toISOString(),
        by: `simulation-${confirmRole}`,
        details: "Automatische Bestätigung durch simulierten LtStb"
      });

      confirmedCount++;
    }
  }

  // Speichern wenn Änderungen vorhanden
  if (confirmedCount > 0) {
    await fs.writeFile(protokollPath, JSON.stringify(protokoll, null, 2), "utf8");
    log("info", `LtStb-Bestätigung: ${confirmedCount} Protokolleinträge automatisch bestätigt`);
  }

  return { confirmedCount };
}

// ============================================================
// 2. Aufgaben-Statuswechsel für simulierte Stabsstellen (Anforderung 11)
// ============================================================

/**
 * Statuswechsel-Logik für Aufgaben.
 * Status-Reihenfolge: new → in_progress → done
 */
const TASK_STATUS_ORDER = ["new", "in_progress", "done"];

/**
 * Führt Statuswechsel für Aufgaben simulierter Stabsstellen durch.
 * 
 * Laut Anforderung: "Wird eine Stabsstelle simuliert, so sind auch die 
 * entsprechenden Statuswechsel in den Aufgaben nacheinander durchzuführen"
 * 
 * @param {string[]} activeRoles - Aktiv besetzte Rollen
 * @param {string} dataDir - Pfad zum Datenverzeichnis
 * @returns {Promise<{ updatedTasks: number, roleUpdates: Object }>}
 */
export async function updateTaskStatusForSimulatedRoles(activeRoles, dataDir) {
  const normalizedActive = Array.isArray(activeRoles)
    ? activeRoles.map(r => normalizeRole(r))
    : [];
  let roleIds = [];
  try {
    const files = await fs.readdir(dataDir);
    roleIds = files
      .filter((name) => name.startsWith("Aufg_board_") && name.endsWith(".json"))
      .map((name) => name.replace(/^Aufg_board_/, "").replace(/\.json$/, ""));
  } catch (err) {
    log("debug", "Aufgabenboards konnten nicht gelesen werden", { error: err.message });
    return { updatedTasks: 0, roleUpdates: {} };
  }
  let totalUpdated = 0;
  const roleUpdates = {};

  for (const role of roleIds) {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole || normalizedActive.includes(normalizedRole)) continue;
    // Meldestelle überspringen
    if (isMeldestelle(normalizedRole)) continue;

    // Aufgabenboard für diese Rolle laden
    const boardPath = path.join(dataDir, `Aufg_board_${normalizedRole}.json`);

    let board;
    try {
      board = await readAufgBoardFile(boardPath, {
        roleId: normalizedRole,
        logError: (message, data) => log("error", message, data),
        writeBack: true,
        backupOnChange: true
      });
    } catch {
      continue;
    }

    const items = Array.isArray(board.items) ? board.items : [];
    let updated = 0;

    // Einen Task pro Durchlauf um einen Status weiterschalten
    // (nicht alle auf einmal, damit die Simulation realistischer wirkt)
    for (const item of items) {
      const currentStatus = item.status || "new";
      const currentIndex = TASK_STATUS_ORDER.indexOf(currentStatus);

      // Wenn noch nicht "done", einen Status weiterschalten
      if (currentIndex >= 0 && currentIndex < TASK_STATUS_ORDER.length - 1) {
        const newStatus = TASK_STATUS_ORDER[currentIndex + 1];

        // Nur mit 30% Wahrscheinlichkeit pro Durchlauf weiterschalten
        // um eine natürlichere Progression zu simulieren
        if (Math.random() < 0.3) {
          item.status = newStatus;
          item.statusUpdatedAt = new Date().toISOString();
          item.statusUpdatedBy = `simulation-${normalizedRole}`;

          // History hinzufügen
          if (!Array.isArray(item.history)) {
            item.history = [];
          }
          item.history.push({
            action: "status_change",
            from: currentStatus,
            to: newStatus,
            at: new Date().toISOString(),
            by: `simulation-${normalizedRole}`
          });

          updated++;

          // Maximal 2 Tasks pro Rolle pro Durchlauf
          if (updated >= 2) break;
        }
      }
    }

    // Speichern wenn Änderungen
    if (updated > 0) {
      await writeAufgBoardFile(boardPath, board);
      roleUpdates[normalizedRole] = updated;
      totalUpdated += updated;
    }
  }

  if (totalUpdated > 0) {
    log("info", `Aufgaben-Statuswechsel: ${totalUpdated} Aufgaben aktualisiert`, roleUpdates);
  }

  return { updatedTasks: totalUpdated, roleUpdates };
}

// ============================================================
// 3. S2-Regel: Mindestens ein Einsatz "In Bearbeitung" (Anforderung 13)
// ============================================================

/**
 * Stellt sicher, dass mindestens ein Einsatz "In Bearbeitung" ist,
 * wenn S2 simuliert wird.
 * 
 * Laut Anforderung: "Ist der S2 in den MissingRoles so hat der jeweilige 
 * Statuswechsel durch das LLM zu erfolgen, wobei bis zum Schluss zumindest 
 * eine Einsatzstelle 'In Bearbeitung' bleiben muss."
 * 
 * @param {string[]} activeRoles - Aktiv besetzte Rollen
 * @param {string} boardPath - Pfad zur board.json
 * @returns {Promise<{ enforced: boolean, movedIncidentId: string|null }>}
 */
export async function ensureOneIncidentInProgress(activeRoles, boardPath) {
  const normalizedActive = Array.isArray(activeRoles)
    ? activeRoles.map(r => normalizeRole(r))
    : [];

  // Nur wenn S2 nicht aktiv besetzt ist
  if (normalizedActive.includes("S2")) {
    return { enforced: false, movedIncidentId: null };
  }

  // Board laden
  let board;
  try {
    const content = await fs.readFile(boardPath, "utf8");
    board = JSON.parse(content);
  } catch (err) {
    log("error", "Board für S2-Regel nicht lesbar", { error: err.message });
    return { enforced: false, movedIncidentId: null };
  }

  const columns = board.columns || {};

  // Prüfen ob mindestens ein Einsatz "In Bearbeitung" ist
  const inProgressItems = columns["in-bearbeitung"]?.items || [];

  if (inProgressItems.length > 0) {
    // Alles OK - mindestens ein Einsatz ist bereits in Bearbeitung
    return { enforced: false, movedIncidentId: null };
  }

  // Keiner "In Bearbeitung" - einen aus "Neu" holen
  const neuItems = columns["neu"]?.items || [];

  if (neuItems.length > 0) {
    // Ersten Einsatz von "Neu" nach "In Bearbeitung" verschieben
    const itemToMove = neuItems.shift();
    itemToMove.statusSince = new Date().toISOString();

    if (!columns["in-bearbeitung"]) {
      columns["in-bearbeitung"] = { name: "In Bearbeitung", items: [] };
    }
    columns["in-bearbeitung"].items.push(itemToMove);

    // Speichern
    await fs.writeFile(boardPath, JSON.stringify(board, null, 2), "utf8");

    log("info", `S2-Regel: Einsatz ${itemToMove.humanId || itemToMove.id} nach "In Bearbeitung" verschoben`);

    return { enforced: true, movedIncidentId: itemToMove.id };
  }

  // Keine neuen Einsätze vorhanden - nichts zu tun
  return { enforced: false, movedIncidentId: null };
}

// ============================================================
// 4. Fahrzeugzuweisung nach Entfernung (Anforderung 14)
// ============================================================

/**
 * Berechnet die Entfernung zwischen zwei Koordinaten (Haversine-Formel).
 * 
 * @param {number} lat1 - Breitengrad Punkt 1
 * @param {number} lon1 - Längengrad Punkt 1
 * @param {number} lat2 - Breitengrad Punkt 2
 * @param {number} lon2 - Längengrad Punkt 2
 * @returns {number} - Entfernung in Kilometern
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Erdradius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Weist Fahrzeuge basierend auf Entfernung zum Einsatzort zu.
 * 
 * Laut Anforderung: "Die Zuordnung der Einheiten hat nach der Entfernung 
 * zum Einsatzort zu erfolgen. Mindestens eine Einheit (Fahrzeug) muss 
 * zugeordnet werden."
 * 
 * @param {Object} incident - Der Einsatz mit latitude/longitude
 * @param {string} vehiclesPath - Pfad zur vehicles.json
 * @param {string} overridesPath - Pfad zur vehicles-overrides.json
 * @param {number} minVehicles - Mindestanzahl Fahrzeuge (default: 1)
 * @returns {Promise<string[]>} Array von Fahrzeug-IDs
 */
export async function assignVehiclesByDistance(incident, vehiclesPath, overridesPath, minVehicles = 1) {
  // Koordinaten prüfen
  if (!incident?.latitude || !incident?.longitude) {
    log("debug", "Keine Koordinaten für Fahrzeugzuweisung", {
      incidentId: incident?.id
    });
    return [];
  }

  // Fahrzeuge laden
  let vehicles = [];
  try {
    const content = await fs.readFile(vehiclesPath, "utf8");
    const data = JSON.parse(content);
    vehicles = Array.isArray(data) ? data : (data.vehicles || []);
  } catch (err) {
    log("error", "Fahrzeuge konnten nicht geladen werden", { error: err.message });
    return [];
  }

  // Overrides laden (für aktuelle Standorte falls Fahrzeuge verlegt wurden)
  let overrides = {};
  try {
    const content = await fs.readFile(overridesPath, "utf8");
    overrides = JSON.parse(content) || {};
  } catch {
    // Keine Overrides vorhanden - ist OK
  }

  // Fahrzeuge mit Entfernung zum Einsatzort berechnen
  const vehiclesWithDistance = vehicles.map(v => {
    // Aktuellen Standort ermitteln (Override > Stamm-Feuerwehr)
    const override = overrides[v.id];
    const ffName = override?.currentLocation || v.ort || v.feuerwehr;
    const standort = FEUERWEHR_STANDORTE[ffName];

    if (!standort) {
      // Unbekannter Standort → unendliche Entfernung
      return { ...v, distance: Infinity, ffName };
    }

    // Entfernung berechnen
    const distance = haversineDistance(
      incident.latitude,
      incident.longitude,
      standort.lat,
      standort.lon
    );

    return { ...v, distance, ffName };
  });

  // Nach Entfernung sortieren (nächste zuerst)
  vehiclesWithDistance.sort((a, b) => a.distance - b.distance);

  // Mindestens minVehicles zuweisen
  const assigned = vehiclesWithDistance
    .slice(0, Math.max(minVehicles, 1))
    .filter(v => v.distance < Infinity)
    .map(v => v.id);

  log("debug", "Fahrzeuge nach Entfernung zugewiesen", {
    incidentId: incident.id,
    incidentOrt: incident.ort,
    assigned,
    details: vehiclesWithDistance.slice(0, 5).map(v => ({
      id: v.id,
      standort: v.ffName,
      entfernung: v.distance === Infinity ? "unbekannt" : v.distance.toFixed(2) + " km"
    }))
  });

  return assigned;
}

// ============================================================
// 5. Aufgaben-Ableitung wenn LtStb simuliert wird (Anforderung 10)
// ============================================================

/**
 * Erstellt Aufgaben für Stabsstellen basierend auf neuen Protokolleinträgen,
 * wenn LtStb simuliert wird.
 * 
 * Laut Anforderung: "Ist der LtStb nicht aktiv besetzt, so kann bzw soll 
 * das LLM beim Erstellen der Meldungstexte daraus auch Aufgaben für die 
 * Stabsstellen ableiten"
 * 
 * @param {Array} newProtocolEntries - Neue Protokolleinträge
 * @param {string[]} activeRoles - Aktiv besetzte Rollen
 * @param {string} dataDir - Pfad zum Datenverzeichnis
 * @returns {Promise<{ createdTasks: number }>}
 */
export async function deriveTasksFromProtocol(newProtocolEntries, activeRoles, dataDir) {
  const normalizedActive = Array.isArray(activeRoles)
    ? activeRoles.map(r => normalizeRole(r))
    : [];

  const ltStbActive = normalizedActive.includes("LTSTB") ||
                      normalizedActive.includes("LTSTBSTV");

  if (ltStbActive) {
    return { createdTasks: 0 };
  }

  let createdTasks = 0;

  for (const entry of newProtocolEntries) {
    // Nur Aufträge verarbeiten
    if (entry.infoTyp?.toLowerCase() !== "auftrag") continue;

    // Empfänger extrahieren
    const recipients = Array.isArray(entry.ergehtAn) ? entry.ergehtAn : [];

    for (const recipient of recipients) {
      const normalizedRecipient = normalizeRole(recipient);

      // Nur für Stabsstellen Aufgaben erstellen
      if (!isStabsstelle(normalizedRecipient)) continue;

      // Nur wenn diese Stabsstelle nicht aktiv besetzt ist
      if (normalizedActive.includes(normalizedRecipient)) continue;

      // Aufgabe erstellen
      const task = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: `Auftrag: ${(entry.information || "").slice(0, 50)}...`,
        desc: entry.information || "",
        responsible: normalizedRecipient,
        status: "new",
        priority: "normal",
        relatedProtocolNr: entry.nr,
        createdAt: new Date().toISOString(),
        createdBy: "simulation-ltstb",
        history: [
          {
            action: "created",
            at: new Date().toISOString(),
            by: "simulation-ltstb",
            details: `Abgeleitet aus Protokolleintrag ${entry.nr}`
          }
        ]
      };

      // Aufgabenboard für diese Rolle laden/erstellen
      const boardPath = path.join(dataDir, `Aufg_board_${normalizedRecipient}.json`);

      const board = await readAufgBoardFile(boardPath, {
        roleId: normalizedRecipient,
        logError: (message, data) => log("error", message, data),
        writeBack: true,
        backupOnChange: true
      });

      // Aufgabe hinzufügen
      board.items.push(task);
      await writeAufgBoardFile(boardPath, board);

      createdTasks++;
      log("info", `Aufgabe für ${normalizedRecipient} aus Protokoll abgeleitet`, {
        taskId: task.id,
        protocolNr: entry.nr
      });
    }
  }

  return { createdTasks };
}

// ============================================================
// 6. Operations-Validierung
// ============================================================



/**
 * Prüft ob eine Operation vom LLM erlaubt ist.
 * 
 * Regeln:
 * 1. Extrahiert die Absender-Rolle aus vorhandenen Feldern
 * 2. Rolle darf nicht in activeRoles sein (wird simuliert)
 * 3. Meldestelle darf NIE simuliert werden
 * 
 * Feld-Priorität: ab > av > r > assignedBy > createdBy
 * 
 * @param {Object} op - Die Operation vom LLM
 * @param {string[]} activeRoles - Aktiv besetzte Rollen
 * @returns {boolean} - true wenn Operation erlaubt
 */

export function isAllowedOperation(op, activeRoles, options = {}) {
  if (!op) return false;
  const { allowedRoles = [], allowExternal = false, operationType = null } = options;

  const normalizedActive = Array.isArray(activeRoles)
    ? activeRoles.map((role) => normalizeRole(role))
    : [];

  // ============================================================
  // board.create: Keine Absenderrolle erforderlich
  // ============================================================
  if (operationType === "board.create") {
    log("debug", "board.create erkannt - keine Absenderrolle erforderlich");
    return true;
  }

  // ============================================================
  // board.update: Nur S2 darf durchführen (wenn S2 nicht angemeldet)
  // ============================================================
  if (operationType === "board.update") {
    // Wenn S2 angemeldet ist, darf das LLM kein board.update machen
    if (normalizedActive.includes("S2")) {
      log("debug", "board.update abgelehnt: S2 ist angemeldet", { activeRoles });
      return false;
    }
    log("debug", "board.update erlaubt: S2 ist nicht angemeldet");
    return true;
  }

  // ============================================================
  // protokoll.create mit richtung:"ein": Keine Stabsrolle erforderlich
  // ============================================================
  if (operationType === "protokoll.create") {
    const richtung = op.richtung || op.direction;
    if (richtung === "ein" || richtung === "in") {
      log("debug", "protokoll.create mit richtung:ein - keine Stabsrolle erforderlich");
      return true;
    }
  }

  // ============================================================
  // aufgaben.update: Wird im Worker geprüft ob Aufgabe existiert
  // Hier nur die Basis-Validierung (keine zusätzliche Rollenprüfung nötig)
  // ============================================================
  if (operationType === "aufgaben.update") {
    // Die Existenzprüfung erfolgt im Worker nach dieser Funktion
    // Update-Operationen benötigen keine spezielle Absenderrolle
    log("debug", "aufgaben.update erkannt - Existenzprüfung erfolgt im Worker");
    return true;
  }

  // ============================================================
  // Legacy: Update-Operationen (Statuswechsel) brauchen keine Absenderrolle
  // Erkennung: hat "changes" und eine ID (id, incidentId, taskId)
  // ============================================================
  const isUpdateOperation = op.changes && (op.id || op.incidentId || op.taskId);
  if (isUpdateOperation) {
    log("debug", "Update-Operation erkannt - keine Absenderrolle erforderlich", {
      id: op.id || op.incidentId || op.taskId,
      changes: Object.keys(op.changes || {})
    });
    return true; // Updates sind immer erlaubt (stammen vom Bot)
  }

  // ============================================================
  // Standard-Prüfung für alle anderen Operationen
  // ============================================================

  // Rolle aus verschiedenen möglichen Feldern extrahieren
  // Priorität basierend auf Zielstruktur der JSON-Dateien
  const extractedRole =
    op.ab ||                          // Aufgaben: assignedBy (kurz)
    extractRoleFromAnvon(op.anvon) ||    // Protokoll: "Von: EL" → "EL"
    op.r ||                           // Aufgaben: responsible (kurz)
    op.assignedBy ||                  // Aufgaben: assignedBy (lang)
    op.responsible ||                 // Aufgaben: responsible (lang)
    op.createdBy ||                   // Allgemein
    op.originRole ||                  // Legacy (falls noch vorhanden)
    op.fromRole;                      // Legacy (falls noch vorhanden)

  // Wenn keine Rolle gefunden werden kann
  if (!extractedRole) {
    log("debug", "Operation abgelehnt: Keine Absender-Rolle gefunden", {
      op,
      checkedFields: ["ab", "av", "r", "assignedBy", "responsible", "createdBy"]
    });
    return false;
  }

  // Meldestelle darf NICHT simuliert werden
  if (isMeldestelle(extractedRole)) {
    log("debug", "Operation abgelehnt: Rolle ist Meldestelle", { extractedRole });
    return false;
  }

  // Rolle darf nicht in activeRoles sein
  const normalizedExtracted = normalizeRole(extractedRole);
  const normalizedAllowed = Array.isArray(allowedRoles)
    ? allowedRoles.map((role) => normalizeRole(role)).filter(Boolean)
    : [];
  const allowedRoleSet = new Set(normalizedAllowed);
  const isAllowedStaffRole = allowedRoleSet.size
    ? allowedRoleSet.has(normalizedExtracted)
    : isStabsstelle(normalizedExtracted);
  const isExternalRole = isExterneStelle(normalizedExtracted);

  if (!isAllowedStaffRole && !(allowExternal && isExternalRole)) {
    log("debug", "Operation abgelehnt: Rolle nicht im Stab", {
      extractedRole,
      normalized: normalizedExtracted,
      allowedRoles: normalizedAllowed,
      allowExternal
    });
    return false;
  }

  if (normalizedActive.includes(normalizedExtracted)) {
    log("debug", "Operation abgelehnt: Rolle in activeRoles", {
      extractedRole,
      normalized: normalizedExtracted,
      activeRoles
    });
    return false;
  }

  return true;
}


/**
 * Erklärt warum eine Operation abgelehnt wurde.
 * Wird für Logging und Debugging verwendet.
 * 
 * @param {Object} op - Die abgelehnte Operation
 * @param {string[]} activeRoles - Aktiv besetzte Rollen
 * @returns {string} - Erklärung der Ablehnung
 */

export function explainOperationRejection(op, activeRoles, options = {}) {
  const { allowedRoles = [], allowExternal = false, operationType = null } = options;
  if (!op) {
    return "Operation ist leer/undefined.";
  }

  const normalizedActive = Array.isArray(activeRoles)
    ? activeRoles.map((role) => normalizeRole(role))
    : [];

  // board.create sollte nie abgelehnt werden
  if (operationType === "board.create") {
    return "board.create - sollte nicht abgelehnt werden (keine Absenderrolle erforderlich).";
  }

  // board.update: Nur S2 darf (wenn nicht angemeldet)
  if (operationType === "board.update") {
    if (normalizedActive.includes("S2")) {
      return "board.update abgelehnt: S2 ist angemeldet und führt Updates selbst durch.";
    }
    return "board.update - sollte nicht abgelehnt werden (S2 nicht angemeldet).";
  }

  // protokoll.create mit richtung:ein sollte nicht abgelehnt werden
  if (operationType === "protokoll.create") {
    const richtung = op.richtung || op.direction;
    if (richtung === "ein" || richtung === "in") {
      return "protokoll.create mit richtung:ein - sollte nicht abgelehnt werden.";
    }
  }

  // aufgaben.update: Prüfung ob Aufgabe existiert erfolgt im Worker
  if (operationType === "aufgaben.update") {
    return "aufgaben.update - Existenzprüfung erfolgt im Worker.";
  }

  // Update-Operationen sollten nie abgelehnt werden
  const isUpdateOperation = op.changes && (op.id || op.incidentId || op.taskId);
  if (isUpdateOperation) {
    return "Update-Operation - sollte nicht abgelehnt werden (keine Absenderrolle erforderlich).";
  }

  // Rolle extrahieren (gleiche Logik wie isAllowedOperation)
  const extractedRole =
    op.ab ||
    extractRoleFromAnvon(op.anvon) ||
    op.r ||
    op.assignedBy ||
    op.responsible ||
    op.createdBy ||
    op.originRole ||
    op.fromRole;

  if (!extractedRole) {
    return `Keine Absender-Rolle gefunden. Geprüfte Felder: ab, av, r, assignedBy, responsible, createdBy. Operation: ${JSON.stringify(op).slice(0, 200)}`;
  }

  if (isMeldestelle(extractedRole)) {
    return `Rolle "${extractedRole}" ist Meldestelle - wird nicht simuliert.`;
  }

  if (normalizedActive.includes(normalizeRole(extractedRole))) {
    return `Rolle "${extractedRole}" ist in activeRoles [${activeRoles.join(", ")}] und darf nicht simuliert werden.`;
  }

  const normalizedAllowed = Array.isArray(allowedRoles)
    ? allowedRoles.map((role) => normalizeRole(role)).filter(Boolean)
    : [];
  const allowedRoleSet = new Set(normalizedAllowed);
  const normalizedExtracted = normalizeRole(extractedRole);
  const isAllowedStaffRole = allowedRoleSet.size
    ? allowedRoleSet.has(normalizedExtracted)
    : isStabsstelle(normalizedExtracted);
  const isExternalRole = isExterneStelle(normalizedExtracted);
  if (!isAllowedStaffRole && !(allowExternal && isExternalRole)) {
    return `Rolle "${extractedRole}" ist keine Stabsrolle${allowExternal ? " oder externe Rolle" : ""}.`;
  }

  return "Unbekannter Grund.";
}
// ============================================================
// Export
// ============================================================

export {
  FEUERWEHR_STANDORTE,
  haversineDistance
};
