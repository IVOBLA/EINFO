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
    anvon: entry.anvon || "",
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
    rueckmeldung2: entry.rueckmeldung2 || "",
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
 * Transformiert alle Operations vom LLM-Format ins JSON-Format.
 *
 * Diese Funktion:
 * 1. Wandelt kurze Feldnamen in lange um (auf allen Ebenen)
 * 2. ENTFERNT das Feld "via" überall
 * 3. Fügt Standardwerte zu Protokolleinträgen hinzu
 * 4. Konvertiert verschachtelte "changes"-Objekte in Update-Operations
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
 * Normalisiert eine Rolle zu Großbuchstaben ohne Leerzeichen
 * @param {string} role - Die zu normalisierende Rolle
 * @returns {string} - Die normalisierte Rolle
 */
export function normalizeRole(role) {
  if (!role) return "";
  return String(role).trim().toUpperCase();
}

// ============================================================
// Export für Tests
// ============================================================

export const __test__ = {
  FIELD_MAPPING,
  STABSSTELLEN,
  EXTERNE_STELLEN,
  MELDESTELLE,
  addProtocolDefaults,
  normalizeFieldNames
};
