// chatbot/server/config.js
// Zentrale Konfiguration für EINFO-Chatbot mit Profilen:
// - mixtral_gpu (Default)
// - phi3_cpu (kleines CPU-Modell, kein GPU-Zwang)

const profile = process.env.CHATBOT_PROFILE || "mixtral_gpu";

/**
 * Basis-Defaults, die für alle Profile gelten
 */
const base = {
  dataDir: "../../server/data",

  // Verzeichnisse für Knowledge & Index
  knowledgeDir: "../../knowledge",
  knowledgeIndexDir: "../../knowledge_index",

  // HTTP/LLM Defaults
  llmRequestTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || "30000"),
  embeddingCacheSize: Number(process.env.EMBED_CACHE_SIZE || "100"),


  // Logging
  logDir: "../logs",
  enableDebugLogging: process.env.CHATBOT_DEBUG === "1",

  // Auto-Sim-Schritt (wird ggf. pro Profil überschrieben)
  autoStepMs: Number(process.env.CHATBOT_AUTO_STEP_MS || "30000"),

  // Vector-RAG Basis-Settings (werden pro Profil evtl. geschärft)
  rag: {
    dim: Number(process.env.RAG_DIM || "768"),
    indexMaxElements: Number(process.env.RAG_MAX_ELEM || "50000"),
    topK: Number(process.env.RAG_TOP_K || "8"),
    maxContextChars: Number(process.env.RAG_MAX_CTX || "2000")
  }
};

/**
 * Profil-spezifische Overrides
 */
let profileConfig = {};

if (profile === "phi3_cpu") {
  // Leichtes CPU-Profil:
  // - kleineres Chat-Modell
  // - konservativere Kontexte
  // - etwas seltenerer Auto-Step
  profileConfig = {
    llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",

    // Name aus deinen Logs: "phi3_cpu"
    llmChatModel: process.env.LLM_CHAT_MODEL || "phi3_cpu",

    // Embedding bleibt gleich (CPU-tauglich)
    llmEmbedModel: process.env.LLM_EMBED_MODEL || "nomic-embed-text",

    defaultTemperature: Number(process.env.LLM_TEMP || "0.2"),
    defaultSeed: Number(process.env.LLM_SEED || "123"),

    autoStepMs: Number(process.env.CHATBOT_AUTO_STEP_MS || "60000"),

    rag: {
      dim: Number(process.env.RAG_DIM || "768"),
      indexMaxElements: Number(process.env.RAG_MAX_ELEM || "30000"),
      topK: Number(process.env.RAG_TOP_K || "6"),
      maxContextChars: Number(process.env.RAG_MAX_CTX || "1400")
    }
  };
} else {
  // Default: Mixtral auf GPU (Q4) – kräftiger, aber schwerer
  profileConfig = {
    llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",

    // z.B. ollama: mixtral:8x7b-instruct-q4_0
    llmChatModel:
      process.env.LLM_CHAT_MODEL || "mixtral-8x7b-instruct-q4",

    llmEmbedModel: process.env.LLM_EMBED_MODEL || "nomic-embed-text",

    defaultTemperature: Number(process.env.LLM_TEMP || "0.25"),
    defaultSeed: Number(process.env.LLM_SEED || "42"),

    autoStepMs: Number(process.env.CHATBOT_AUTO_STEP_MS || "30000"),

    rag: {
      dim: Number(process.env.RAG_DIM || "768"),
      indexMaxElements: Number(process.env.RAG_MAX_ELEM || "50000"),
      topK: Number(process.env.RAG_TOP_K || "8"),
      maxContextChars: Number(process.env.RAG_MAX_CTX || "2000")
    }
  };
}

/**
 * CONFIG = base + profileConfig (rag wird tief gemerged)
 */
function mergeConfig(baseCfg, profileCfg) {
  const merged = { ...baseCfg, ...profileCfg };
  merged.rag = { ...baseCfg.rag, ...(profileCfg.rag || {}) };
  merged.profile = profile;
  return merged;
}

export const CONFIG = mergeConfig(base, profileConfig);
