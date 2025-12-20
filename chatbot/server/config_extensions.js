// chatbot/server/config_extensions.js
// ============================================================
// Erweiterungen für die bestehende config.js
// Diese Datei sollte in die bestehende config.js importiert werden
// oder deren Inhalt dort eingefügt werden.
// ============================================================

/**
 * Diese Konfiguration muss in das base-Objekt der config.js eingefügt werden.
 * 
 * Einfügen VOR der Zeile "profiles: {"
 */
export const simulationConfig = {
  // ============================================================
  // Simulation Worker Konfiguration
  // ============================================================
  simulation: {
    // Intervall zwischen Worker-Durchläufen in Millisekunden
    // Default: 60 Sekunden, über Umgebungsvariable anpassbar
    workerIntervalMs: Number(process.env.SIM_WORKER_INTERVAL_MS || "60000"),

    // Maximale Wiederholungsversuche bei LLM-Fehlern
    maxRetries: Number(process.env.SIM_MAX_RETRIES || "3"),

    // Wartezeit zwischen Wiederholungen in Millisekunden
    retryDelayMs: Number(process.env.SIM_RETRY_DELAY_MS || "5000"),

    // URL zum EINFO Haupt-Server (für Online-Rollen-Abfrage)
    mainServerUrl: process.env.MAIN_SERVER_URL || "http://localhost:4040",

    // API-Endpoint für Online-Rollen
    onlineRolesEndpoint: "/api/user/online-roles"
  },

  // ============================================================
  // Feldnamen-Mapping: LLM (kurz) ↔ JSON (lang)
  // ============================================================
  // Token-Optimierung: Kurze Feldnamen sparen ~30% Tokens beim LLM
  fieldMapping: {
    // Einsatzboard (board.json)
    board: {
      llmToJson: {
        t: "content",
        s: "status",
        o: "ort",
        d: "description",
        lat: "latitude",
        lon: "longitude",
        typ: "typ",
        hid: "humanId"
      },
      jsonToLlm: {
        content: "t",
        status: "s",
        ort: "o",
        description: "d",
        latitude: "lat",
        longitude: "lon",
        typ: "typ",
        humanId: "hid"
      }
    },

    // Aufgabenboards (Aufg_board_*.json)
    aufgaben: {
      llmToJson: {
        t: "title",
        r: "responsible",
        s: "status",
        d: "desc",
        inc: "relatedIncidentId",
        due: "dueDate",
        prio: "priority"
      },
      jsonToLlm: {
        title: "t",
        responsible: "r",
        status: "s",
        desc: "d",
        relatedIncidentId: "inc",
        dueDate: "due",
        priority: "prio"
      }
    },

    // Protokoll (protocol.json)
    protokoll: {
      llmToJson: {
        i: "information",
        d: "datum",
        z: "zeit",
        av: "anvon",
        typ: "infoTyp",
        ea: "ergehtAn",
        ri: "richtung"
      },
      jsonToLlm: {
        information: "i",
        datum: "d",
        zeit: "z",
        anvon: "av",
        infoTyp: "typ",
        ergehtAn: "ea",
        richtung: "ri"
      }
    }
  },

  // ============================================================
  // Rollendefinitionen für die Simulation
  // ============================================================

  // Stabsstellen die simuliert werden können
  stabsstellen: [
    "LtStb",      // Leiter Stab
    "LtStbStv",   // Stellvertreter Leiter Stab
    "S1",         // Personal
    "S2",         // Lage
    "S3",         // Einsatz
    "S4",         // Versorgung
    "S5",         // Presse/Öffentlichkeitsarbeit
    "S6"          // Kommunikation/IT
  ],

  // Externe Stellen (für Simulation von ein-/ausgehenden Meldungen)
  externeStellen: [
    "LST",      // Landesstellte / Leitstelle
    "POL",      // Polizei
    "BM",       // Bürgermeister
    "WLV",      // Wildbach- und Lawinenverbauung
    "STM",      // Straßenmeisterei
    "EVN",      // Energieversorger
    "RK",       // Rotes Kreuz
    "BH",       // Bezirkshauptmannschaft
    "GEM",      // Gemeinde
    "ÖBB",      // Österreichische Bundesbahnen
    "ASFINAG",  // Autobahnen
    "KELAG",    // Kärntner Elektrizitäts-AG
    "LWZ"       // Landeswarnzentrale
  ],

  // Meldestelle-Bezeichnungen
  // WICHTIG: Die Meldestelle ist KEINE Stabsstelle und wird NIE simuliert!
  meldestelle: [
    "Meldestelle",
    "MS",
    "Meldestelle/S6"
  ],

  // ============================================================
  // Feuerwehr-Standorte im Bezirk Feldkirchen
  // Für Fahrzeugzuweisung nach Entfernung zum Einsatzort
  // ============================================================
  feuerwehrStandorte: {
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
  }
};

/**
 * Anleitung zum Einfügen in config.js:
 * 
 * 1. Öffne chatbot/server/config.js
 * 2. Finde das base-Objekt: const base = { ... }
 * 3. Füge den Inhalt von simulationConfig VOR "profiles:" ein
 * 
 * Oder importiere diese Datei und merge sie:
 * 
 * import { simulationConfig } from "./config_extensions.js";
 * 
 * const base = {
 *   ...existingConfig,
 *   ...simulationConfig,
 *   profiles: { ... }
 * };
 */
