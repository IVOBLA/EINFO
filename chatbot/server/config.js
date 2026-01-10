// chatbot/server/config.js
// Zentrale Konfiguration für den EINFO-Chatbot mit Multi-Modell Unterstützung

const profileName = process.env.CHATBOT_PROFILE || "default";
const supportedModelKeys = new Set(["fast", "balanced"]);

function sanitizeActiveModel(value) {
  if (!value) {
    return "balanced";
  }
  if (value === "auto") {
    return "auto";
  }
  if (value === "quality") {
    console.warn('[CONFIG] LLM_MODEL="quality" ist veraltet, verwende "balanced".');
    return "balanced";
  }
  if (!supportedModelKeys.has(value)) {
    console.warn(`[CONFIG] LLM_MODEL="${value}" ist unbekannt, verwende "balanced".`);
    return "balanced";
  }
  return value;
}

/**
 * Basis-Defaults
 */
const base = {
  dataDir: "../../server/data",

  // Verzeichnisse für Knowledge & Index (relativ zu chatbot/server/rag/)
  knowledgeDir: "../../knowledge",
  knowledgeIndexDir: "../../knowledge_index",

  // HTTP/LLM Basis
  llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",
  
  // Legacy-Modell-Config (für Abwärtskompatibilität)
  llmChatModel: process.env.LLM_CHAT_MODEL || "llama3.1:8b",
  llmEmbedModel: process.env.LLM_EMBED_MODEL || "mxbai-embed-large",

  // ============================================================
  // Task-basierte LLM-Konfiguration
  // ============================================================
  llm: {
    // Globales Override (wenn gesetzt, überschreibt alle task-spezifischen Modelle)
    // Werte: null = task-spezifisch | <modelname> = für alle Tasks verwenden
    globalModelOverride: process.env.LLM_GLOBAL_MODEL || null,

    // Task-spezifische Konfigurationen
    tasks: {
      start: {
        model: process.env.LLM_TASK_START_MODEL || "einfo-balanced",
        temperature: Number(process.env.LLM_TASK_START_TEMPERATURE || "0.1"),
        maxTokens: Number(process.env.LLM_TASK_START_MAX_TOKENS || "4000"),
        timeout: Number(process.env.LLM_TASK_START_TIMEOUT || "220000"),
        numGpu: Number(process.env.LLM_TASK_START_NUM_GPU || "20"),
        numCtx: Number(process.env.LLM_TASK_START_NUM_CTX || "4096"),
        topP: Number(process.env.LLM_TASK_START_TOP_P || "0.92"),
        topK: Number(process.env.LLM_TASK_START_TOP_K || "50"),
        repeatPenalty: Number(process.env.LLM_TASK_START_REPEAT_PENALTY || "1.15")
      },
      operations: {
        model: process.env.LLM_TASK_OPS_MODEL || "einfo-balanced",
        temperature: Number(process.env.LLM_TASK_OPS_TEMPERATURE || "0.05"),
        maxTokens: Number(process.env.LLM_TASK_OPS_MAX_TOKENS || "4000"),
        timeout: Number(process.env.LLM_TASK_OPS_TIMEOUT || "300000"),
        numGpu: Number(process.env.LLM_TASK_OPS_NUM_GPU || "20"),
        numCtx: Number(process.env.LLM_TASK_OPS_NUM_CTX || "4096"),
        topP: Number(process.env.LLM_TASK_OPS_TOP_P || "0.92"),
        topK: Number(process.env.LLM_TASK_OPS_TOP_K || "50"),
        repeatPenalty: Number(process.env.LLM_TASK_OPS_REPEAT_PENALTY || "1.15")
      },
      chat: {
        model: process.env.LLM_TASK_CHAT_MODEL || "llama3.1:8b",
        temperature: Number(process.env.LLM_TASK_CHAT_TEMPERATURE || "0.4"),
        maxTokens: Number(process.env.LLM_TASK_CHAT_MAX_TOKENS || "2048"),
        timeout: Number(process.env.LLM_TASK_CHAT_TIMEOUT || "120000"),
        numGpu: Number(process.env.LLM_TASK_CHAT_NUM_GPU || "20"),
        numCtx: Number(process.env.LLM_TASK_CHAT_NUM_CTX || "4096"),
        topP: Number(process.env.LLM_TASK_CHAT_TOP_P || "0.9"),
        topK: Number(process.env.LLM_TASK_CHAT_TOP_K || "40"),
        repeatPenalty: Number(process.env.LLM_TASK_CHAT_REPEAT_PENALTY || "1.1")
      },
      analysis: {
        model: process.env.LLM_TASK_ANALYSIS_MODEL || "einfo-balanced",
        temperature: Number(process.env.LLM_TASK_ANALYSIS_TEMPERATURE || "0.3"),
        maxTokens: Number(process.env.LLM_TASK_ANALYSIS_MAX_TOKENS || "4000"),
        timeout: Number(process.env.LLM_TASK_ANALYSIS_TIMEOUT || "220000"),
        numGpu: Number(process.env.LLM_TASK_ANALYSIS_NUM_GPU || "20"),
        numCtx: Number(process.env.LLM_TASK_ANALYSIS_NUM_CTX || "4096"),
        topP: Number(process.env.LLM_TASK_ANALYSIS_TOP_P || "0.92"),
        topK: Number(process.env.LLM_TASK_ANALYSIS_TOP_K || "50"),
        repeatPenalty: Number(process.env.LLM_TASK_ANALYSIS_REPEAT_PENALTY || "1.15")
      },
      default: {
        model: process.env.LLM_TASK_DEFAULT_MODEL || "einfo-balanced",
        temperature: Number(process.env.LLM_TASK_DEFAULT_TEMPERATURE || "0.1"),
        maxTokens: Number(process.env.LLM_TASK_DEFAULT_MAX_TOKENS || "2048"),
        timeout: Number(process.env.LLM_TASK_DEFAULT_TIMEOUT || "120000"),
        numGpu: Number(process.env.LLM_TASK_DEFAULT_NUM_GPU || "20"),
        numCtx: Number(process.env.LLM_TASK_DEFAULT_NUM_CTX || "4096"),
        topP: Number(process.env.LLM_TASK_DEFAULT_TOP_P || "0.92"),
        topK: Number(process.env.LLM_TASK_DEFAULT_TOP_K || "50"),
        repeatPenalty: Number(process.env.LLM_TASK_DEFAULT_REPEAT_PENALTY || "1.15")
      }
    }
  },
  
  // Differenzierte Timeouts (Fallbacks wenn Modell-Config keine hat)
  llmChatTimeoutMs: Number(process.env.LLM_CHAT_TIMEOUT_MS || "60000"),
  llmSimTimeoutMs: Number(process.env.LLM_SIM_TIMEOUT_MS || "300000"),
  llmEmbedTimeoutMs: Number(process.env.LLM_EMBED_TIMEOUT_MS || "30000"),
  llmRequestTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || "240000"),
  
  // Llama-spezifische Parameter
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

  // Vector-RAG Settings
  rag: {
    dim: Number(process.env.RAG_DIM || "1024"),
    indexMaxElements: Number(process.env.RAG_MAX_ELEM || "50000"),
    topK: Number(process.env.RAG_TOP_K || "10"),
    maxContextChars: Number(process.env.RAG_MAX_CTX || "4000"),
    scoreThreshold: Number(process.env.RAG_SCORE_THRESHOLD || "0.2")
  },

  // Prompt-Limits
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
    workerIntervalMs: Number(process.env.SIM_WORKER_INTERVAL_MS || "60000"),
    maxRetries: Number(process.env.SIM_MAX_RETRIES || "3"),
    retryDelayMs: Number(process.env.SIM_RETRY_DELAY_MS || "5000"),
    mainServerUrl: process.env.MAIN_SERVER_URL || "http://localhost:4040",
    onlineRolesEndpoint: "/api/user/online-roles"
  }
  // HINWEIS: Feldnamen-Mapping, Rollen und Feuerwehr-Standorte sind in
  // field_mapper.js und simulation_helpers.js definiert (Single Source of Truth)
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
  llm: base.llm,
  profile: activeProfile
};


// ============================================================
// Runtime-Task-Management (zur Laufzeit änderbar)
// ============================================================

/**
 * Setzt globales Modell-Override (überschreibt alle task-spezifischen Modelle)
 * @param {string|null} modelName - Modellname oder null für task-spezifisch
 */
export function setGlobalModelOverride(modelName) {
  CONFIG.llm.globalModelOverride = modelName;
  console.log(`[CONFIG] Globales Modell-Override: ${modelName || "deaktiviert (task-spezifisch)"}`);
}

/**
 * Gibt die Task-Konfiguration für einen bestimmten Task-Typ zurück
 * @param {string} taskType - "start" | "operations" | "chat" | "analysis" | "default"
 * @returns {Object} - { model, temperature, maxTokens, timeout, numGpu, ... }
 */
export function getTaskConfig(taskType) {
  const llmConfig = CONFIG.llm;

  // Task-Config holen (mit fallback auf default)
  const taskConfig = llmConfig.tasks[taskType] || llmConfig.tasks.default;

  if (!taskConfig) {
    console.warn(`[CONFIG] Task "${taskType}" nicht gefunden, verwende default`);
    return { ...llmConfig.tasks.default };
  }

  // Wenn globales Override gesetzt, nur Modellname überschreiben
  if (llmConfig.globalModelOverride) {
    return {
      ...taskConfig,
      model: llmConfig.globalModelOverride
    };
  }

  return { ...taskConfig };
}

// Legacy-Alias für Abwärtskompatibilität
export const getModelForTask = getTaskConfig;

/**
 * Aktualisiert Task-Konfiguration zur Laufzeit
 * @param {string} taskType - Task-Typ
 * @param {Object} updates - Zu aktualisierende Werte (model, temperature, etc.)
 */
export function updateTaskConfig(taskType, updates) {
  if (!CONFIG.llm.tasks[taskType]) {
    throw new Error(`Unbekannter Task-Typ: ${taskType}`);
  }

  // Nur erlaubte Felder aktualisieren
  const allowedFields = ["model", "temperature", "maxTokens", "timeout", "numGpu", "numCtx", "topP", "topK", "repeatPenalty"];
  const validUpdates = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      validUpdates[key] = value;
    }
  }

  CONFIG.llm.tasks[taskType] = {
    ...CONFIG.llm.tasks[taskType],
    ...validUpdates
  };

  console.log(`[CONFIG] Task "${taskType}" aktualisiert:`, validUpdates);
}

/**
 * Gibt alle Task-Konfigurationen zurück
 * @returns {Object}
 */
export function getAllTaskConfigs() {
  return {
    globalModelOverride: CONFIG.llm.globalModelOverride,
    tasks: { ...CONFIG.llm.tasks }
  };
}

// Legacy-Kompatibilität
export const setTaskModel = (taskType, modelKey) => updateTaskConfig(taskType, { model: modelKey });
export const getAllModels = () => ({ tasks: getAllTaskConfigs().tasks });
export const setActiveModel = setGlobalModelOverride;
export const getActiveModelConfig = getAllTaskConfigs;
