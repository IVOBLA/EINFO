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

  // Verzeichnisse für Knowledge & Index (relativ zu chatbot/server/)
  knowledgeDir: "../../knowledge",
  knowledgeIndexDir: "../../knowledge_index",

  // HTTP/LLM Basis
  llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",
  
  // Legacy-Modell-Config (für Abwärtskompatibilität)
  llmChatModel: process.env.LLM_CHAT_MODEL || "llama3.1:8b",
  llmEmbedModel: process.env.LLM_EMBED_MODEL || "mxbai-embed-large",

  // ============================================================
  // Multi-Modell Konfiguration
  // ============================================================
  llm: {
    // Verfügbare Modelle mit ihren Eigenschaften
    models: {
      fast: {
        name: process.env.LLM_MODEL_FAST || "llama3.1:8b",
        timeout: Number(process.env.LLM_TIMEOUT_FAST || "30000"),
        description: "Schnell, für einfache Tasks",
        numGpu: 20,           // Alle Layer auf GPU
        numCtx: 4096,
        temperature: 0.05
      },
      balanced: {
        name: process.env.LLM_MODEL_BALANCED || "einfo-balanced",
        timeout: Number(process.env.LLM_TIMEOUT_BALANCED || "220000"),
        description: "Ausgewogen, gute JSON-Qualität",
        numGpu: 20,
        numCtx: 4096,
        temperature: 0.1
      }
    },

    // Welches Modell für welchen Task-Typ
    // Werte: "fast" | "balanced"
    taskModels: {
      start: process.env.LLM_TASK_START || "balanced",      // Erstes Szenario
      operations: process.env.LLM_TASK_OPS || "balanced",   // Laufende Simulation
      chat: process.env.LLM_TASK_CHAT || "balanced",        // QA-Chat
      default: process.env.LLM_TASK_DEFAULT || "balanced"
    },

    // Globales Override (überschreibt taskModels wenn nicht "auto")
    // Werte: "auto" | "fast" | "balanced"
    activeModel: sanitizeActiveModel(process.env.LLM_MODEL)
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
    topK: Number(process.env.RAG_TOP_K || "5"),
    maxContextChars: Number(process.env.RAG_MAX_CTX || "2500"),
    scoreThreshold: Number(process.env.RAG_SCORE_THRESHOLD || "0.35")
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
// Runtime-Modell-Management (zur Laufzeit änderbar)
// ============================================================

/**
 * Ändert das aktive Modell zur Laufzeit
 * @param {string} modelKey - "fast" | "balanced" | "auto"
 */
export function setActiveModel(modelKey) {
  if (modelKey !== "auto" && !CONFIG.llm.models[modelKey]) {
    throw new Error(`Unbekanntes Modell: ${modelKey}. Erlaubt: fast, balanced, auto`);
  }
  CONFIG.llm.activeModel = modelKey;
  console.log(`[CONFIG] Aktives Modell gewechselt zu: ${modelKey}`);
}

/**
 * Gibt die aktuelle Modell-Konfiguration zurück
 * @returns {Object}
 */
export function getActiveModelConfig() {
  const activeKey = CONFIG.llm.activeModel;
  if (activeKey === "auto") {
    return { key: "auto", mode: "task-based", taskModels: CONFIG.llm.taskModels };
  }
  return {
    key: activeKey,
    mode: "fixed",
    ...CONFIG.llm.models[activeKey]
  };
}

/**
 * Gibt das Modell für einen bestimmten Task-Typ zurück
 * @param {string} taskType - "start" | "operations" | "chat"
 * @returns {Object} - { key, name, timeout, numGpu, ... }
 */
export function getModelForTask(taskType) {
  const llmConfig = CONFIG.llm;
  
  // Wenn globales Override aktiv (nicht "auto")
  if (llmConfig.activeModel && llmConfig.activeModel !== "auto") {
    const model = llmConfig.models[llmConfig.activeModel];
    if (model) {
      return { key: llmConfig.activeModel, ...model };
    }
  }
  
  // Task-basierte Auswahl
  const modelKey = llmConfig.taskModels[taskType] || llmConfig.taskModels.default;
  const model = llmConfig.models[modelKey];
  
  if (!model) {
    console.warn(`[CONFIG] Modell "${modelKey}" nicht gefunden, verwende balanced`);
    return { key: "balanced", ...llmConfig.models.balanced };
  }
  
  return { key: modelKey, ...model };
}

/**
 * Setzt die Task-Modell-Zuordnung zur Laufzeit
 * @param {string} taskType - "start" | "operations" | "chat" | "default"
 * @param {string} modelKey - "fast" | "balanced"
 */
export function setTaskModel(taskType, modelKey) {
  if (!CONFIG.llm.models[modelKey]) {
    throw new Error(`Unbekanntes Modell: ${modelKey}`);
  }
  if (!CONFIG.llm.taskModels.hasOwnProperty(taskType)) {
    throw new Error(`Unbekannter Task-Typ: ${taskType}`);
  }
  CONFIG.llm.taskModels[taskType] = modelKey;
  console.log(`[CONFIG] Task "${taskType}" verwendet jetzt Modell: ${modelKey}`);
}

/**
 * Gibt alle konfigurierten Modelle zurück
 * @returns {Object}
 */
export function getAllModels() {
  return { ...CONFIG.llm.models };
}
