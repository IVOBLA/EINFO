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

const DEFAULT_GEO_CONFIG = {
  bboxFilterEnabled: true,
  bboxFilterMode: "both",
  bboxFilterDocTypes: ["address", "poi", "building"],
  geoScope: "BBOX"  // "BBOX" = nur Einsatzbereich, "GLOBAL" = gesamtes Wissen
};

const GEO_FILTER_MODES = new Set(["request_only", "auto_municipality", "both"]);
const GEO_FILTER_DOC_TYPES = new Set(["address", "poi", "building"]);
const GEO_SCOPES = new Set(["BBOX", "GLOBAL"]);

// ============================================================
// RAG-Config: Defaults, Merge, Normalize
// ============================================================

const DEFAULT_RAG_CONFIG = {
  enabled: true,
  knowledgeTopK: 8,
  knowledgeMaxChars: 6000,
  knowledgeScoreThreshold: 0.2,
  knowledgeUseMMR: true,
  sessionTopK: 6,
  sessionMaxChars: 3000,
  disasterSummaryMaxLength: 2000,
  totalMaxChars: 10000
};

const DEFAULT_RAG_BY_TASK = {
  "situation-question": {
    knowledgeTopK: 12,
    knowledgeMaxChars: 8000,
    sessionTopK: 8,
    sessionMaxChars: 4000,
    disasterSummaryMaxLength: 2500,
    totalMaxChars: 12000
  },
  "analysis": {
    knowledgeTopK: 10,
    knowledgeMaxChars: 7000,
    sessionTopK: 6,
    sessionMaxChars: 3000,
    totalMaxChars: 11000
  },
  "chat": {
    knowledgeTopK: 6,
    knowledgeMaxChars: 4500,
    sessionTopK: 4,
    sessionMaxChars: 2000,
    totalMaxChars: 7000
  },
  "simulation": {
    knowledgeTopK: 8,
    knowledgeMaxChars: 6000,
    sessionTopK: 6,
    sessionMaxChars: 3000,
    totalMaxChars: 10000
  }
};

const RAG_NUMBER_FIELDS = new Set([
  "knowledgeTopK", "knowledgeMaxChars", "knowledgeScoreThreshold",
  "sessionTopK", "sessionMaxChars", "disasterSummaryMaxLength", "totalMaxChars"
]);

/**
 * Clamp + sanitize a single RAG config value
 */
function clampRagValue(key, value) {
  if (key === "knowledgeScoreThreshold") {
    const v = Number(value);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_RAG_CONFIG[key];
  }
  if (key === "knowledgeTopK" || key === "sessionTopK") {
    const v = Math.round(Number(value));
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_RAG_CONFIG[key];
  }
  if (key === "knowledgeMaxChars" || key === "sessionMaxChars" ||
      key === "disasterSummaryMaxLength" || key === "totalMaxChars") {
    const v = Math.round(Number(value));
    return Number.isFinite(v) ? Math.max(0, Math.min(50000, v)) : DEFAULT_RAG_CONFIG[key];
  }
  return value;
}

/**
 * Normalize a raw RAG config: fill missing fields from defaults, clamp values
 */
function normalizeRagConfig(input) {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_RAG_CONFIG };
  }
  const result = {};
  for (const key of Object.keys(DEFAULT_RAG_CONFIG)) {
    if (key === "enabled") {
      result.enabled = typeof input.enabled === "boolean" ? input.enabled : DEFAULT_RAG_CONFIG.enabled;
    } else if (key === "knowledgeUseMMR") {
      result.knowledgeUseMMR = typeof input.knowledgeUseMMR === "boolean" ? input.knowledgeUseMMR : DEFAULT_RAG_CONFIG.knowledgeUseMMR;
    } else if (RAG_NUMBER_FIELDS.has(key)) {
      result[key] = (input[key] !== undefined && input[key] !== null)
        ? clampRagValue(key, input[key])
        : DEFAULT_RAG_CONFIG[key];
    } else {
      result[key] = input[key] ?? DEFAULT_RAG_CONFIG[key];
    }
  }
  return result;
}

/**
 * Merge base RAG config with override, then normalize
 */
function mergeTaskRagConfig(baseRag, overrideRag) {
  if (!overrideRag || typeof overrideRag !== "object") {
    return normalizeRagConfig(baseRag);
  }
  const merged = { ...normalizeRagConfig(baseRag) };
  for (const key of Object.keys(DEFAULT_RAG_CONFIG)) {
    if (overrideRag[key] !== undefined && overrideRag[key] !== null) {
      if (key === "enabled" || key === "knowledgeUseMMR") {
        if (typeof overrideRag[key] === "boolean") {
          merged[key] = overrideRag[key];
        }
      } else if (RAG_NUMBER_FIELDS.has(key)) {
        merged[key] = clampRagValue(key, overrideRag[key]);
      }
    }
  }
  return merged;
}

/**
 * Get the full default RAG config for a specific task type (base + task-specific defaults merged)
 */
function getDefaultRagForTask(taskType) {
  const taskDefaults = DEFAULT_RAG_BY_TASK[taskType];
  if (!taskDefaults) return { ...DEFAULT_RAG_CONFIG };
  return normalizeRagConfig({ ...DEFAULT_RAG_CONFIG, ...taskDefaults });
}

function normalizeGeoConfig(geo) {
  const bboxFilterEnabled = typeof geo?.bboxFilterEnabled === "boolean"
    ? geo.bboxFilterEnabled
    : DEFAULT_GEO_CONFIG.bboxFilterEnabled;
  const bboxFilterMode = GEO_FILTER_MODES.has(geo?.bboxFilterMode)
    ? geo.bboxFilterMode
    : DEFAULT_GEO_CONFIG.bboxFilterMode;
  const docTypes = Array.isArray(geo?.bboxFilterDocTypes)
    ? geo.bboxFilterDocTypes.filter((type) => GEO_FILTER_DOC_TYPES.has(type))
    : [];

  const geoScope = GEO_SCOPES.has(geo?.geoScope)
    ? geo.geoScope
    : DEFAULT_GEO_CONFIG.geoScope;

  return {
    bboxFilterEnabled,
    bboxFilterMode,
    bboxFilterDocTypes: docTypes.length ? docTypes : [...DEFAULT_GEO_CONFIG.bboxFilterDocTypes],
    geoScope
  };
}

function mergeTaskGeoConfig(baseGeo, overrideGeo) {
  if (!overrideGeo || typeof overrideGeo !== "object") {
    return normalizeGeoConfig(baseGeo);
  }
  const normalized = normalizeGeoConfig(baseGeo);
  const merged = {
    ...normalized
  };

  if (typeof overrideGeo.bboxFilterEnabled === "boolean") {
    merged.bboxFilterEnabled = overrideGeo.bboxFilterEnabled;
  }
  if (GEO_FILTER_MODES.has(overrideGeo.bboxFilterMode)) {
    merged.bboxFilterMode = overrideGeo.bboxFilterMode;
  }
  if (Array.isArray(overrideGeo.bboxFilterDocTypes)) {
    const filtered = overrideGeo.bboxFilterDocTypes.filter((type) => GEO_FILTER_DOC_TYPES.has(type));
    merged.bboxFilterDocTypes = filtered.length
      ? filtered
      : [...DEFAULT_GEO_CONFIG.bboxFilterDocTypes];
  }
  if (GEO_SCOPES.has(overrideGeo.geoScope)) {
    merged.geoScope = overrideGeo.geoScope;
  }

  return merged;
}

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
      repeatPenalty: 1.15,
      geo: { ...DEFAULT_GEO_CONFIG }
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
      repeatPenalty: 1.15,
      geo: { ...DEFAULT_GEO_CONFIG }
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
      repeatPenalty: 1.1,
      geo: { ...DEFAULT_GEO_CONFIG }
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
      repeatPenalty: 1.1,
      geo: { ...DEFAULT_GEO_CONFIG }
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
      repeatPenalty: 1.1,
      geo: { ...DEFAULT_GEO_CONFIG }
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
      repeatPenalty: 1.1,
      geo: { ...DEFAULT_GEO_CONFIG }
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
      repeatPenalty: 1.15,
      geo: { ...DEFAULT_GEO_CONFIG }
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
      const mergedTasks = {};
      const mergedEntries = { ...DEFAULT_TASK_CONFIG.tasks, ...(parsed.tasks || {}) };

      for (const [taskKey, taskValue] of Object.entries(mergedEntries)) {
        const baseTask = DEFAULT_TASK_CONFIG.tasks[taskKey] || DEFAULT_TASK_CONFIG.tasks.default;
        const baseRag = getDefaultRagForTask(taskKey);
        mergedTasks[taskKey] = {
          ...baseTask,
          ...taskValue,
          geo: mergeTaskGeoConfig(baseTask?.geo, taskValue?.geo),
          rag: mergeTaskRagConfig(baseRag, taskValue?.rag)
        };
      }
      return {
        globalModelOverride: parsed.globalModelOverride ?? null,
        tasks: mergedTasks
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
  const currentGeo = mergeTaskGeoConfig(DEFAULT_GEO_CONFIG, CONFIG.llm.tasks[taskType].geo);
  const nextGeo = updates?.geo ? mergeTaskGeoConfig(currentGeo, updates.geo) : currentGeo;

  // RAG-Config merge + normalize
  const currentRag = CONFIG.llm.tasks[taskType].rag || getDefaultRagForTask(taskType);
  const nextRag = updates?.rag ? mergeTaskRagConfig(currentRag, updates.rag) : currentRag;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      validUpdates[key] = value;
    }
  }

  CONFIG.llm.tasks[taskType] = {
    ...CONFIG.llm.tasks[taskType],
    ...validUpdates,
    geo: nextGeo,
    rag: nextRag
  };

  const logPayload = { ...validUpdates };
  if (updates?.geo) {
    logPayload.geo = nextGeo;
  }
  console.log(`[CONFIG] Task "${taskType}" aktualisiert:`, logPayload);

  if (persist) {
    saveTaskConfigToFile({
      globalModelOverride: CONFIG.llm.globalModelOverride,
      tasks: CONFIG.llm.tasks
    });
  }
}

/**
 * Gibt alle Task-Konfigurationen zurück (inkl. Defaults für UI-Reset)
 * @returns {Object}
 */
export function getAllTaskConfigs() {
  // Build defaults map for UI reset
  const defaultTasks = {};
  for (const taskKey of Object.keys(CONFIG.llm.tasks)) {
    defaultTasks[taskKey] = {
      rag: getDefaultRagForTask(taskKey)
    };
  }

  return {
    globalModelOverride: CONFIG.llm.globalModelOverride,
    tasks: { ...CONFIG.llm.tasks },
    defaults: { tasks: defaultTasks }
  };
}

// Geo-Config Utilities (benötigt von situation_analyzer u.a.)
export { normalizeGeoConfig, mergeTaskGeoConfig };

// RAG-Config Utilities
export { normalizeRagConfig, mergeTaskRagConfig, getDefaultRagForTask, DEFAULT_RAG_CONFIG, DEFAULT_RAG_BY_TASK };

// Legacy-Kompatibilität
export const setTaskModel = (taskType, modelKey) => updateTaskConfig(taskType, { model: modelKey });
export const getAllModels = () => ({ tasks: getAllTaskConfigs().tasks });
export const setActiveModel = setGlobalModelOverride;
export const getActiveModelConfig = getAllTaskConfigs;
