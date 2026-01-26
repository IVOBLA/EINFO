// chatbot/server/config.js
// Zentrale Konfiguration für den EINFO-Chatbot mit Multi-Modell Unterstützung

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const profileName = process.env.CHATBOT_PROFILE || "default";
const supportedModelKeys = new Set(["fast", "balanced"]);

// ============================================================
// Task-Config Persistenz (JSON-Datei als einzige Quelle)
// ============================================================
const TASK_CONFIG_PATH = path.join(__dirname, "data", "task-config.json");

/**
 * Standard-Task-Konfiguration (wird verwendet wenn task-config.json nicht existiert)
 */
const DEFAULT_TASK_CONFIG = {
  globalModelOverride: null,
  tasks: {
    start: {
      model: "einfo-balanced",
      temperature: 0.1,
      maxTokens: 4000,
      timeout: 220000,
      numGpu: 20,
      numCtx: 4096,
      topP: 0.92,
      topK: 50,
      repeatPenalty: 1.15
    },
    operations: {
      model: "einfo-balanced",
      temperature: 0.05,
      maxTokens: 4000,
      timeout: 300000,
      numGpu: 20,
      numCtx: 4096,
      topP: 0.92,
      topK: 50,
      repeatPenalty: 1.15
    },
    chat: {
      model: "llama3.1:8b",
      temperature: 0.4,
      maxTokens: 2048,
      timeout: 120000,
      numGpu: 20,
      numCtx: 4096,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.1
    },
    analysis: {
      model: "einfo-analysis",
      temperature: 0.2,
      maxTokens: 4000,
      timeout: 220000,
      numGpu: 20,
      numCtx: 8192,
      topP: 0.9,
      topK: 50,
      repeatPenalty: 1.1
    },
    "situation-question": {
      model: "einfo-analysis",
      temperature: 0.3,
      maxTokens: 1000,
      timeout: 60000,
      numGpu: 20,
      numCtx: 4096,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.1
    },
    summarization: {
      model: "llama3.1:8b",
      temperature: 0.3,
      maxTokens: 1500,
      timeout: 60000,
      numGpu: 20,
      numCtx: 4096,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.1
    },
    default: {
      model: "einfo-balanced",
      temperature: 0.1,
      maxTokens: 2048,
      timeout: 120000,
      numGpu: 20,
      numCtx: 4096,
      topP: 0.92,
      topK: 50,
      repeatPenalty: 1.15
    }
  }
};

/**
 * Lädt Task-Konfiguration aus JSON-Datei
 * @returns {Object} - Task-Konfiguration
 */
function loadTaskConfigFromFile() {
  try {
    if (fs.existsSync(TASK_CONFIG_PATH)) {
      const data = fs.readFileSync(TASK_CONFIG_PATH, "utf8");
      const parsed = JSON.parse(data);
      console.log("[CONFIG] Task-Konfiguration aus task-config.json geladen");
      return {
        globalModelOverride: parsed.globalModelOverride ?? null,
        tasks: { ...DEFAULT_TASK_CONFIG.tasks, ...parsed.tasks }
      };
    }
  } catch (err) {
    console.error("[CONFIG] Fehler beim Laden von task-config.json:", err.message);
  }
  console.log("[CONFIG] Verwende Standard-Task-Konfiguration");
  return { ...DEFAULT_TASK_CONFIG };
}

/**
 * Speichert Task-Konfiguration in JSON-Datei
 * @param {Object} taskConfig - Task-Konfiguration zum Speichern
 */
function saveTaskConfigToFile(taskConfig) {
  try {
    const dir = path.dirname(TASK_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TASK_CONFIG_PATH, JSON.stringify(taskConfig, null, 2), "utf8");
    console.log("[CONFIG] Task-Konfiguration in task-config.json gespeichert");
    return true;
  } catch (err) {
    console.error("[CONFIG] Fehler beim Speichern von task-config.json:", err.message);
    return false;
  }
}

// Lade Task-Config beim Start
const loadedTaskConfig = loadTaskConfigFromFile();

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
  // Task-basierte LLM-Konfiguration (aus task-config.json geladen)
  // ============================================================
  llm: loadedTaskConfig,
  
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
    mainServerUrl: process.env.MAIN_SERVER_URL || "http://localhost:4000",
    onlineRolesEndpoint: "/api/user/online-roles"
  }
  // HINWEIS: Feldnamen-Mapping, Rollen und Feuerwehr-Standorte sind in
  // field_mapper.js und simulation_helpers.js definiert (Single Source of Truth)
};

// ============================================================
// Simulation Behavior Defaults (ersetzt Magic Numbers)
// ============================================================
export const SIMULATION_DEFAULTS = {
  compression: {
    maxBoardItems: 25,
    maxAufgabenItems: 50,
    maxProtokollItems: 30,
    maxContentLength: 100
  },

  statusProgression: {
    // Wahrscheinlichkeit pro Schritt dass Task-Status fortschreitet
    probabilityPerStep: 0.3,
    // Max Anzahl Tasks die pro Rolle pro Schritt fortschreiten
    maxTasksPerRolePerStep: 2,
    // Mindestanzahl Schritte bevor Status wechselt
    minStepsBeforeChange: 1
  },

  s2Rules: {
    // Mindestanzahl Einsätze "In Bearbeitung" wenn S2 simuliert
    minIncidentsInProgress: 1
  },

  vehicleAssignment: {
    // Mindestanzahl Fahrzeuge pro Einsatz
    minVehiclesPerIncident: 1,
    // Max Entfernung in km für Fahrzeugzuweisung
    maxDistanceKm: 50
  },

  cache: {
    // Cache TTL für Disaster Context in Millisekunden
    disasterContextTTL: 30000,
    // Cache TTL für Learned Responses
    learnedResponsesTTL: 60000
  }
};

// ============================================================
// Schwierigkeitsgrad-Modifikatoren
// ============================================================
export const DIFFICULTY_MODIFIERS = {
  easy: {
    label: "Einfach",
    statusProgressionSpeed: 0.5,    // Tasks schreiten schneller fort
    entityMultiplier: 0.7,           // 30% weniger Entities
    llmTemperatureBoost: -0.1,       // Vorhersehbarer
    responseTimeMultiplier: 1.5      // Mehr Zeit für Antworten
  },

  medium: {
    label: "Mittel",
    statusProgressionSpeed: 0.3,
    entityMultiplier: 1.0,
    llmTemperatureBoost: 0,
    responseTimeMultiplier: 1.0
  },

  hard: {
    label: "Schwer",
    statusProgressionSpeed: 0.2,
    entityMultiplier: 1.3,
    llmTemperatureBoost: 0.1,
    responseTimeMultiplier: 0.8
  },

  extreme: {
    label: "Extrem",
    statusProgressionSpeed: 0.1,     // Tasks brauchen länger
    entityMultiplier: 1.8,           // 80% mehr Entities
    llmTemperatureBoost: 0.2,        // Unvorhersehbarer
    responseTimeMultiplier: 0.5      // Weniger Zeit
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
 * @param {boolean} persist - Ob in Datei gespeichert werden soll (default: true)
 */
export function setGlobalModelOverride(modelName, persist = true) {
  CONFIG.llm.globalModelOverride = modelName;
  console.log(`[CONFIG] Globales Modell-Override: ${modelName || "deaktiviert (task-spezifisch)"}`);

  if (persist) {
    saveTaskConfigToFile({
      globalModelOverride: CONFIG.llm.globalModelOverride,
      tasks: CONFIG.llm.tasks
    });
  }
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
 * @param {boolean} persist - Ob in Datei gespeichert werden soll (default: true)
 */
export function updateTaskConfig(taskType, updates, persist = true) {
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

  if (persist) {
    saveTaskConfigToFile({
      globalModelOverride: CONFIG.llm.globalModelOverride,
      tasks: CONFIG.llm.tasks
    });
  }
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
