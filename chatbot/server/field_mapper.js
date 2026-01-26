// chatbot/server/field_mapper.js
// ============================================================
// Feldnamen-Behandlung für LLM-Operations
// Das LLM verwendet jetzt die vollen Feldnamen (wie in den JSON-Dateien)
// Dieses Modul fügt Standardwerte hinzu und normalisiert die Daten
// ============================================================

// ============================================================
// Fallback-Mapping für kurze Feldnamen (Rückwärtskompatibilität)
// Falls das LLM trotzdem kurze Feldnamen verwendet, werden diese konvertiert
// ============================================================

const FIELD_MAPPING = {
  // Einsatzboard (board.json)
  board: {
    // Kurze Feldnamen → Volle Feldnamen (Fallback)
    shortToFull: {
      t: "content",
      s: "status",
      o: "ort",
      d: "description",
      lat: "latitude",
      lon: "longitude",
      hid: "humanId",
      al: "alerted",
      av: "assignedVehicles"
    }
  },

  // Aufgabenboards (Aufg_board_*.json)
  aufgaben: {
    shortToFull: {
      t: "title",
      r: "responsible",
      s: "status",
      d: "desc",
      inc: "relatedIncidentId",
      due: "dueDate",
      prio: "priority",
      ab: "assignedBy"
    }
  },

  // Protokoll (protocol.json)
  protokoll: {
    shortToFull: {
      i: "information",
      d: "datum",
      z: "zeit",
      av: "anvon",
      von: "anvon",  // "von" als Alias
      typ: "infoTyp",
      ea: "ergehtAn",
      ri: "richtung"
    }
  }
};

// ============================================================
// Rollendefinitionen
// ============================================================

// Stabsstellen die simuliert werden können
const STABSSTELLEN = new Set([
  "LTSTB", "LTSTBSTV", "S1", "S2", "S3", "S4", "S5", "S6"
]);

// Rollen-Aliasse: Verschiedene Bezeichnungen → Standard-ID
// Das LLM verwendet manchmal volle Namen, diese werden auf die Standard-IDs gemappt
const ROLE_ALIASES = {
  "EINSATZLEITER": "LTSTB",
  "EINSATZLEITERIN": "LTSTB",
  "LEITER TECHNISCHER STAB": "LTSTB",
  "LEITERIN TECHNISCHER STAB": "LTSTB",
  "LT STB": "LTSTB",
  "STELLVERTRETER LTSTB": "LTSTBSTV",
  "STELLVERTRETERIN LTSTB": "LTSTBSTV",
  "SACHGEBIET 1": "S1",
  "SACHGEBIET 2": "S2",
  "SACHGEBIET 3": "S3",
  "SACHGEBIET 4": "S4",
  "SACHGEBIET 5": "S5",
  "SACHGEBIET 6": "S6",
  "FEUERWEHR": "S3",
  "POLIZEI": "POL",
  "ROTES KREUZ": "RK",
  "BEZIRKSHAUPTMANNSCHAFT": "BH",
  "GEMEINDE": "GEM",
  "LEITSTELLE": "LST"
};

// Externe Stellen (für Simulation von ein-/ausgehenden Meldungen)
const EXTERNE_STELLEN = new Set([
  "LST", "POL", "BM", "WLV", "STM", "EVN", "RK", "BH", 
  "GEM", "ÖBB", "ASFINAG", "KELAG", "LWZ"
]);

// Meldestelle-Bezeichnungen - wird NIE simuliert!
const MELDESTELLE = new Set([
  "MELDESTELLE", "MS", "MELDESTELLE/S6"
]);

// ============================================================
// Basis-Transformationen
// ============================================================

/**
 * Normalisiert Feldnamen in einem Objekt.
 * Konvertiert kurze Feldnamen zu vollen Feldnamen (Fallback für Rückwärtskompatibilität).
 *
 * Das LLM verwendet jetzt primär die vollen Feldnamen.
 * Diese Funktion dient nur als Fallback, falls das LLM doch kurze Feldnamen verwendet.
 *
 * Beispiel:
 *   normalizeFieldNames({ t: "Brand", ort: "Feldkirchen" }, "board")
 *   → { content: "Brand", ort: "Feldkirchen" }
 *
 * @param {Object} obj - Das zu normalisierende Objekt
 * @param {string} type - Der Objekttyp: "board", "aufgaben", oder "protokoll"
 * @returns {Object} - Das normalisierte Objekt mit vollen Feldnamen
 */
export function normalizeFieldNames(obj, type) {
  if (!obj || typeof obj !== "object") return obj;

  const map = FIELD_MAPPING[type]?.shortToFull || {};
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    // Wenn der kurze Feldname bekannt ist, konvertiere ihn
    const newKey = map[key] || key;
    result[newKey] = value;
  }

  return result;
}

// Alias für Rückwärtskompatibilität
export const llmToJson = normalizeFieldNames;

// ============================================================
// Protokoll-Standardwerte
// ============================================================

/**
 * Fügt Pflicht-Standardwerte zu einem Protokolleintrag hinzu.
 * Diese Werte kommen NICHT vom LLM sondern werden vom Worker gesetzt.
 * 
 * Pflichtfelder laut Anforderung:
 * - datum: Aktuelles Datum (ISO)
 * - zeit: Aktuelle Uhrzeit (HH:MM)
 * - anvon: Absender/Empfänger
 * - infoTyp: Auftrag/Info/Lagemeldung
 * - information: Meldungsinhalt
 * - printCount: IMMER 0 (wird vom Worker gesetzt, nicht LLM)
 * - uebermittlungsart: { kanalNr: "bot", ein: true/false, aus: true/false }
 * 
 * @param {Object} entry - Der Protokolleintrag vom LLM
 * @returns {Object} - Der Eintrag mit allen Pflichtfeldern
 */
function addProtocolDefaults(entry) {
  const now = new Date();

  // Richtung bestimmen (ein oder aus)
  const richtung = entry.richtung || entry.ri || "ein";
  const isEin = /ein/i.test(richtung);

  // Standardwerte zusammenführen
  return {
    // ID generieren wenn nicht vorhanden
    id: entry.id || `prot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

    // Vom LLM kommende Felder (mit Fallbacks)
    ...entry,

    // PFLICHTFELDER mit Standardwerten
    datum: entry.datum || now.toISOString().split("T")[0],
    zeit: entry.zeit || now.toTimeString().slice(0, 5),
    anvon: entry.anvon || "LTSTB",  // Default: Leiter Technischer Stab (gültige Stabsrolle)
    infoTyp: entry.infoTyp || "Info",
    information: entry.information || "",

    // printCount ist IMMER 0 - wird vom Worker gesetzt, NICHT vom LLM
    printCount: 0,

    // Übermittlungsart mit Bot-Kanal
    uebermittlungsart: {
      kanalNr: "bot",
      ein: isEin,
      aus: !isEin
    },

    // Bestätigung initial unbestätigt
    // Wird später vom LtStb (simuliert oder echt) bestätigt
    otherRecipientConfirmation: {
      confirmed: false,
      by: null,
      byRole: null,
      at: null
    },

    // Weitere Pflichtfelder mit leeren Defaults
    ergehtAn: entry.ergehtAn || [],
    rueckmeldung1: entry.rueckmeldung1 || "",
    lagebericht: entry.lagebericht || "",

    // Maßnahmen-Array (5 leere Slots)
    massnahmen: entry.massnahmen || [
      { massnahme: "", verantwortlich: "" },
      { massnahme: "", verantwortlich: "" },
      { massnahme: "", verantwortlich: "" },
      { massnahme: "", verantwortlich: "" },
      { massnahme: "", verantwortlich: "" }
    ],

    // History für Audit-Trail
    history: [
      {
        action: "created",
        at: now.toISOString(),
        by: "simulation-worker",
        details: "Automatisch durch Simulation erstellt"
      }
    ]
  };
}

// ============================================================
// Komplette Operations-Transformation
// ============================================================

/**
 * Normalisiert das Operations-Format vom LLM.
 * Das LLM liefert manchmal ein Array-Format statt der erwarteten verschachtelten Struktur:
 *
 * Falsches Format (Array):
 *   { operations: [
 *     { type: "protokoll.create", ... },
 *     { type: "board.createIncidentSite", ... }
 *   ]}
 *
 * Korrektes Format (verschachtelt):
 *   { operations: {
 *     board: { createIncidentSites: [...] },
 *     aufgaben: { create: [...] },
 *     protokoll: { create: [...] }
 *   }}
 *
 * Diese Funktion konvertiert das Array-Format ins verschachtelte Format.
 *
 * @param {Object|Array} operations - Die Operations vom LLM
 * @returns {Object} - Die Operations im verschachtelten Format
 */
export function normalizeOperationsFormat(operations) {
  if (!operations) return operations;

  // Wenn operations ein Array ist, konvertiere es
  if (Array.isArray(operations)) {
    const normalized = {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    for (const op of operations) {
      const type = op.type || "";

      // Board operations
      if (type === "board.createIncidentSite" || type === "board.createIncidentSites") {
        const { type, ...rest } = op;
        normalized.board.createIncidentSites.push(rest);
      } else if (type === "board.updateIncidentSite" || type === "board.updateIncidentSites") {
        const { type, ...rest } = op;
        normalized.board.updateIncidentSites.push(rest);
      }
      // Aufgaben operations
      else if (type === "aufgaben.create") {
        const { type, ...rest } = op;
        normalized.aufgaben.create.push(rest);
      } else if (type === "aufgaben.update") {
        const { type, ...rest } = op;
        normalized.aufgaben.update.push(rest);
      }
      // Protokoll operations
      else if (type === "protokoll.create") {
        const { type, ...rest } = op;
        normalized.protokoll.create.push(rest);
      }
    }

    return normalized;
  }

  // Wenn operations bereits ein Objekt ist, gebe es zurück
  return operations;
}

/**
 * Transformiert alle Operations vom LLM-Format ins JSON-Format.
 *
 * Diese Funktion:
 * 1. Normalisiert das Format (Array → verschachtelt)
 * 2. Wandelt kurze Feldnamen in lange um (auf allen Ebenen)
 * 3. ENTFERNT das Feld "via" überall
 * 4. Fügt Standardwerte zu Protokolleinträgen hinzu
 * 5. Konvertiert verschachtelte "changes"-Objekte in Update-Operations
 *
 * WICHTIG: Update-Operations haben eine verschachtelte "changes"-Struktur:
 *   { id: "...", changes: { t: "...", d: "..." } }
 * Diese "changes" müssen ebenfalls konvertiert werden, sonst werden Updates
 * ignoriert, da chatbot_worker.js nach langen Feldnamen sucht!
 *
 * @param {Object} operations - Die Operations vom LLM
 * @returns {Object} - Die transformierten Operations für die JSON-Dateien
 */
export function transformLlmOperationsToJson(operations) {
  if (!operations) return operations;

  // Schritt 1: Format normalisieren (Array → verschachtelt)
  operations = normalizeOperationsFormat(operations);

  const result = { ...operations };

  // ---- Board-Operations ----
  if (result.board?.createIncidentSites) {
    result.board.createIncidentSites = result.board.createIncidentSites.map(item => {
      const converted = llmToJson(item, "board");
      // "via" ENTFERNEN - wird nicht mehr verwendet
      delete converted.via;
      return converted;
    });
  }

  if (result.board?.updateIncidentSites) {
    result.board.updateIncidentSites = result.board.updateIncidentSites.map(item => {
      const converted = llmToJson(item, "board");
      delete converted.via;
      // WICHTIG: Auch das verschachtelte changes-Objekt konvertieren!
      if (converted.changes) {
        converted.changes = llmToJson(converted.changes, "board");
      }
      return converted;
    });
  }

  if (result.board?.transitionIncidentSites) {
    result.board.transitionIncidentSites = result.board.transitionIncidentSites.map(item => {
      const converted = llmToJson(item, "board");
      delete converted.via;
      return converted;
    });
  }

  // ---- Aufgaben-Operations ----
  if (result.aufgaben?.create) {
    result.aufgaben.create = result.aufgaben.create.map(item => {
      const converted = llmToJson(item, "aufgaben");
      delete converted.via;
      return converted;
    });
  }

  if (result.aufgaben?.update) {
    result.aufgaben.update = result.aufgaben.update.map(item => {
      const converted = llmToJson(item, "aufgaben");
      delete converted.via;
      // WICHTIG: Auch das verschachtelte changes-Objekt konvertieren!
      if (converted.changes) {
        converted.changes = llmToJson(converted.changes, "aufgaben");
      }
      return converted;
    });
  }

  // ---- Protokoll-Operations ----
  // Hier werden zusätzlich die Standardwerte hinzugefügt
  if (result.protokoll?.create) {
    result.protokoll.create = result.protokoll.create.map(item => {
      const converted = llmToJson(item, "protokoll");
      delete converted.via;
      // Standardwerte hinzufügen (printCount, uebermittlungsart, etc.)
      return addProtocolDefaults(converted);
    });
  }

  return result;
}

// ============================================================
// Rollen-Prüfungen
// ============================================================

/**
 * Prüft ob eine Rolle eine Stabsstelle ist.
 * Stabsstellen können simuliert werden.
 * 
 * @param {string} role - Die zu prüfende Rolle
 * @returns {boolean} - true wenn Stabsstelle
 */
export function isStabsstelle(role) {
  if (!role) return false;
  const normalized = String(role).trim().toUpperCase();
  return STABSSTELLEN.has(normalized);
}

/**
 * Prüft ob eine Rolle eine externe Stelle ist.
 * Externe Stellen sind z.B. Polizei, Gemeinde, Energieversorger.
 * 
 * @param {string} role - Die zu prüfende Rolle
 * @returns {boolean} - true wenn externe Stelle
 */
export function isExterneStelle(role) {
  if (!role) return false;
  const normalized = String(role).trim().toUpperCase();
  return EXTERNE_STELLEN.has(normalized);
}

/**
 * Prüft ob eine Rolle die Meldestelle ist.
 * Die Meldestelle wird NIE simuliert!
 * 
 * @param {string} role - Die zu prüfende Rolle
 * @returns {boolean} - true wenn Meldestelle
 */
export function isMeldestelle(role) {
  if (!role) return false;
  const normalized = String(role).trim().toUpperCase();
  return MELDESTELLE.has(normalized);
}

/**
 * Gibt alle definierten Stabsstellen zurück.
 * @returns {string[]} - Array der Stabsstellen-IDs
 */
export function getAllStabsstellen() {
  return [...STABSSTELLEN];
}

/**
 * Gibt alle definierten externen Stellen zurück.
 * @returns {string[]} - Array der externen Stellen-IDs
 */
export function getAllExterneStellen() {
  return [...EXTERNE_STELLEN];
}

/**
 * Normalisiert eine Rolle zu Großbuchstaben und wendet Aliasse an.
 * Das LLM verwendet manchmal volle Namen wie "Einsatzleiter" statt "LTSTB",
 * diese werden auf die Standard-IDs gemappt.
 *
 * @param {string} role - Die zu normalisierende Rolle
 * @returns {string} - Die normalisierte Rolle (Standard-ID)
 */
export function normalizeRole(role) {
  if (!role) return "";
  const normalized = String(role).trim().toUpperCase();
  // Alias-Mapping anwenden falls vorhanden
  return ROLE_ALIASES[normalized] || normalized;
}

/**
 * Normalisiert ein Array von Rollen (entfernt Duplikate und leere Einträge)
 * @param {string[]} roles - Array von Rollen
 * @returns {string[]} - Normalisiertes Array
 */
export function normalizeRoleArray(roles) {
  if (!Array.isArray(roles)) return [];

  const normalized = roles
    .map(role => normalizeRole(role))
    .filter(role => role && role.length > 0);

  // Duplikate entfernen
  return [...new Set(normalized)];
}

// ============================================================
// Export für Tests
// ============================================================

export const __test__ = {
  FIELD_MAPPING,
  STABSSTELLEN,
  EXTERNE_STELLEN,
  MELDESTELLE,
  ROLE_ALIASES,
  addProtocolDefaults,
  normalizeFieldNames,
  normalizeOperationsFormat
};
