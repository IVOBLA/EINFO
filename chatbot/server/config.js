// chatbot/server/config.js
// Zentrale Konfiguration für den EINFO-Chatbot mit Llama 3.1 8B auf RTX 4070

const profileName = process.env.CHATBOT_PROFILE || "default";

/**
 * Basis-Defaults
 */
const base = {
  dataDir: "../../server/data",

  // Verzeichnisse für Knowledge & Index
  knowledgeDir: "../../knowledge",
  knowledgeIndexDir: "../../knowledge_index",

  // HTTP/LLM Basis
  llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",
  
  // Modelle - GEÄNDERT für Llama 3.1
  llmChatModel: process.env.LLM_CHAT_MODEL || "llama3.1:8b",
  llmEmbedModel: process.env.LLM_EMBED_MODEL || "mxbai-embed-large",
  
  // Differenzierte Timeouts - NEU
  llmChatTimeoutMs: Number(process.env.LLM_CHAT_TIMEOUT_MS || "60000"),
  llmSimTimeoutMs: Number(process.env.LLM_SIM_TIMEOUT_MS || "300000"),
  llmEmbedTimeoutMs: Number(process.env.LLM_EMBED_TIMEOUT_MS || "30000"),
  llmRequestTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || "240000"), // Fallback
  
  // Llama-spezifische Parameter - NEU
  llmNumCtx: Number(process.env.LLM_NUM_CTX || "8192"),
  llmNumBatch: Number(process.env.LLM_NUM_BATCH || "512"),
  
  // Embedding Cache
  embeddingCacheSize: Number(process.env.EMBED_CACHE_SIZE || "200"),

  // Logging
  logDir: "../logs",
  enableDebugLogging: process.env.CHATBOT_DEBUG === "1",

  // Auto-Sim-Schritt
  autoStepMs: Number(process.env.CHATBOT_AUTO_STEP_MS || "120000"),

  // LLM Defaults
  defaultTemperature: Number(process.env.LLM_TEMP || "0.05"),
  defaultSeed: Number(process.env.LLM_SEED || "42"),

  // Vector-RAG Settings - OPTIMIERT für Llama
  rag: {
    dim: Number(process.env.RAG_DIM || "1024"), // mxbai-embed-large = 1024
    indexMaxElements: Number(process.env.RAG_MAX_ELEM || "50000"),
    topK: Number(process.env.RAG_TOP_K || "5"),
    maxContextChars: Number(process.env.RAG_MAX_CTX || "2500"),
    scoreThreshold: Number(process.env.RAG_SCORE_THRESHOLD || "0.35")
  },

  // Prompt-Limits - NEU
  prompt: {
    maxBoardItems: Number(process.env.PROMPT_MAX_BOARD || "25"),
    maxAufgabenItems: Number(process.env.PROMPT_MAX_AUFGABEN || "50"),
    maxProtokollItems: Number(process.env.PROMPT_MAX_PROTOKOLL || "30")
  },

  // Memory-RAG Defaults
  memoryRag: {
    longScenarioMinItems: Number(process.env.MEM_RAG_LONG_MIN_ITEMS || "100"),
    maxAgeMinutes: Number(process.env.MEM_RAG_MAX_AGE_MIN || "720"),
    recencyHalfLifeMinutes: Number(process.env.MEM_RAG_HALF_LIFE_MIN || "120"),
    longScenarioTopK: Number(process.env.MEM_RAG_LONG_TOP_K || "12")
  },

  // JSON-Einstellungen
  jsonEnforce: true,
  jsonSanitizer: true
};



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
 * Profil-spezifische Overrides
 */
const profiles = {
  default: {
    // Standard-Profil nutzt base-Werte
  },
  llama_8b_gpu: {
    llmChatModel: "llama3.1:8b",
    llmEmbedModel: "mxbai-embed-large",
    defaultTemperature: 0.25,
    rag: {
      topK: 5,
      maxContextChars: 2500,
      scoreThreshold: 0.35
    }
  },
  // Legacy-Profil für Mixtral (falls noch benötigt)
  mixtral_gpu: {
    llmChatModel: "mixtral_einfo",
    llmEmbedModel: "nomic-embed-text",
    rag: {
      dim: 768,
      topK: 8
    }
  }
};

const profileConfig = profiles[profileName] || profiles.default;
const activeProfile = profiles[profileName] ? profileName : "default";

/**
 * CONFIG = base + profileConfig (deep merge für rag/memoryRag/prompt)
 */
export const CONFIG = {
  ...base,
  ...profileConfig,
  rag: {
    ...base.rag,
    ...(profileConfig.rag || {})
  },
  memoryRag: {
    ...base.memoryRag,
    ...(profileConfig.memoryRag || {})
  },
  prompt: {
    ...base.prompt,
    ...(profileConfig.prompt || {})
  },
  profile: activeProfile
};
