// chatbot/server/config.js
// Zentrale Konfiguration für den EINFO-Chatbot mit Basis-Defaults und optionalen Profilen

const profileName = process.env.CHATBOT_PROFILE || "default";

/**
 * Basis-Defaults, die modellunabhängig sind
 */
const base = {
  dataDir: "../../server/data",

  // Verzeichnisse für Knowledge & Index
  knowledgeDir: "../../knowledge",
  knowledgeIndexDir: "../../knowledge_index",

  // HTTP/LLM Defaults
  llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",
  llmEmbedModel: process.env.LLM_EMBED_MODEL || "nomic-embed-text",
  llmRequestTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || "240000"),
  embeddingCacheSize: Number(process.env.EMBED_CACHE_SIZE || "100"),

  // Logging
  logDir: "../logs",
  enableDebugLogging: process.env.CHATBOT_DEBUG === "1",

  // Auto-Sim-Schritt (wird ggf. pro Profil überschrieben)
  autoStepMs: Number(process.env.CHATBOT_AUTO_STEP_MS || "120000"),

  // LLM Defaults
  defaultTemperature: Number(process.env.LLM_TEMP || "0.25"),
  defaultSeed: Number(process.env.LLM_SEED || "42"),

  // Vector-RAG Basis-Settings (werden pro Profil evtl. geschärft)
  rag: {
    dim: Number(process.env.RAG_DIM || "768"),
    indexMaxElements: Number(process.env.RAG_MAX_ELEM || "50000"),
    topK: Number(process.env.RAG_TOP_K || "8"),
    maxContextChars: Number(process.env.RAG_MAX_CTX || "2000"),
    scoreThreshold: Number(process.env.RAG_SCORE_THRESHOLD || "0.3")
  },

  // Memory-RAG Defaults
  memoryRag: {
    // Ab wie vielen Memory-Items Long-Scenario-Logik sinnvoll ist (nur als Richtwert)
    longScenarioMinItems: Number(process.env.MEM_RAG_LONG_MIN_ITEMS || "100"),

    // Maximales Alter (in Minuten), das noch voll gewichtet wird
    maxAgeMinutes: Number(process.env.MEM_RAG_MAX_AGE_MIN || "720"),

    // Halbwertszeit für Recency-Decay (in Minuten)
    recencyHalfLifeMinutes: Number(
      process.env.MEM_RAG_HALF_LIFE_MIN || "120"
    ),

    // Standard-topK für Long-Scenario-Suche
    longScenarioTopK: Number(process.env.MEM_RAG_LONG_TOP_K || "12")
  },

  // Globale JSON-Einstellungen
  jsonEnforce: true,
  jsonSanitizer: true
};

/**
 * Profil-spezifische Overrides (nur wenn Sonderbehandlung nötig ist)
 */
const profiles = {
  default: {
    llmChatModel: process.env.LLM_CHAT_MODEL || "mixtral_einfo"
  },
  mixtral_gpu: {
    llmChatModel: "mixtral_einfo",
    rag: {
      topK: Number(process.env.RAG_TOP_K || "10")
    }
  }
};

const profileConfig = profiles[profileName] || profiles.default;
const activeProfile = profiles[profileName] ? profileName : "default";

/**
 * CONFIG = base + profileConfig (rag/memoryRag wird tief gemerged)
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
  profile: activeProfile
};
