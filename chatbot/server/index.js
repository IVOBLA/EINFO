// chatbot/server/index.js

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import {
  startSimulation,
  pauseSimulation,
  stepSimulation,
  isSimulationRunning,
  getActiveScenario,
  buildDelta,
  compressBoard,
  compressAufgaben,
  compressProtokoll,
  identifyMessagesNeedingResponse,
  identifyOpenQuestions,
  buildMemoryQueryFromState,
  toComparableProtokoll
} from "./sim_loop.js";  
//} from "./experimental_szenariopack/api/sim_loop_adapter.js";
import { metrics } from "./simulation_metrics.js";
import { cache } from "./cache_manager.js";
import { simulationState } from "./simulation_state.js";
import { 
  callLLMForChat, 
  listAvailableLlmModels,
  checkConfiguredModels,
  getModelForTask
} from "./llm_client.js";
import {
  CONFIG,
  getTaskConfig,
  updateTaskConfig,
  setGlobalModelOverride,
  getAllTaskConfigs,
  // Legacy-Kompatibilität
  setActiveModel,
  getActiveModelConfig,
  setTaskModel,
  getAllModels
} from "./config.js";
import { logInfo, logError, logDebug } from "./logger.js";
import { initMemoryStore, searchMemory } from "./memory_manager.js";
import { loadPromptTemplate, fillTemplate, buildSystemPrompt, buildUserPrompt, buildStartPrompts, buildSystemPromptChat, buildUserPromptChat } from "./prompts.js";
import { getExcludeContextForPrompt } from "./suggestion_filter.js";
import { getGpuStatus } from "./gpu_status.js";
import { getSystemStatus, getCpuTimesSnapshot, collectSystemMetrics } from "./system_status.js";
import { getGeoIndex } from "./rag/geo_search.js";
import { getKnowledgeContextVector, getKnowledgeContextWithSources } from "./rag/rag_vector.js";
import { getCurrentSession } from "./rag/session_rag.js";
import { createJsonBodyParser } from "./middleware/jsonBodyParser.js";
import { readEinfoInputs } from "./einfo_io.js";

// ============================================================
// Imports für Audit-Trail und Templates
// ============================================================
import {
  startAuditTrail,
  endAuditTrail,
  getAuditStatus,
  listAuditTrails,
  loadAuditTrail,
  deleteAuditTrail,
  pauseExercise,
  resumeExercise,
  getFilteredEvents,
  logEvent,
  setStatisticsChangeCallback,
  setEventLoggedCallback
} from "./audit_trail.js";

import {
  loadAllTemplates,
  loadTemplate,
  saveTemplate,
  deleteTemplate,
  validateTemplate,
  createExerciseFromTemplate
} from "./template_manager.js";

import { rateLimit, RateLimitProfiles, getRateLimitStats } from "./middleware/rate-limit.js";
import { createSituationQuestionHandler } from "./routes/situationQuestion.js";
import { buildScenarioControlSummary } from "./scenario_controls.js";

// ============================================================
// Imports für Situationsanalyse
// ============================================================
import {
  initSituationAnalyzer,
  isAnalysisActive,
  getAnalysisStatus,
  analyzeForRole,
  getCachedAnalysisForRole,
  isAnalysisInProgress,
  getAnalysisTimerStatus,
  setOnAnalysisComplete,
  answerQuestion,
  saveSuggestionFeedback,
  saveQuestionFeedback,
  syncAnalysisLoop,
  getAnalysisConfig
} from "./situation_analyzer.js";

import fs from "fs/promises";

// ============================================================
// Szenarien-Verwaltung
// ============================================================
const SCENARIOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "scenarios");
const SERVER_DATA_DIR = "/home/bfkdo/kanban/server/data";

// ============================================================
// Worker-Steuerung (Worker läuft nur während aktiver Simulation)
// ============================================================
const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || "http://127.0.0.1:4040";

async function startWorker() {
  try {
    const res = await fetch(`${MAIN_SERVER_URL}/chatbot/worker/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logError("Worker-Start fehlgeschlagen", { status: res.status, body: text });
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    logInfo("Worker gestartet", data);
    return { ok: true, ...data };
  } catch (err) {
    logError("Worker-Start Fehler", { error: String(err) });
    return { ok: false, error: String(err) };
  }
}

async function stopWorker() {
  try {
    const res = await fetch(`${MAIN_SERVER_URL}/chatbot/worker/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logError("Worker-Stop fehlgeschlagen", { status: res.status, body: text });
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    logInfo("Worker gestoppt", data);
    return { ok: true, ...data };
  } catch (err) {
    logError("Worker-Stop Fehler", { error: String(err) });
    return { ok: false, error: String(err) };
  }
}

async function cleanupServerData() {
  const entries = await fs.readdir(SERVER_DATA_DIR, { withFileTypes: true });
  const deletions = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".log" && ext !== ".json") continue;
    const targetPath = path.join(SERVER_DATA_DIR, entry.name);
    deletions.push(fs.unlink(targetPath));
  }

  await Promise.all(deletions);
  logInfo("Server-Daten bereinigt", {
    directory: SERVER_DATA_DIR,
    removedFiles: deletions.length
  });
}

function logLlmRequest({ source, model, durationMs, hasResponse, error }) {
  logEvent("llm", "request", {
    source,
    model,
    durationMs,
    hasResponse,
    error
  });
}

async function listScenarios() {
  try {
    const files = await fs.readdir(SCENARIOS_DIR);
    const scenarios = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(path.join(SCENARIOS_DIR, file), "utf-8");
        const scenario = JSON.parse(content);
        scenarios.push({
          id: scenario.id || file.replace(".json", ""),
          title: scenario.title || "Unbenannt",
          description: scenario.description || "",
          difficulty: scenario.difficulty || "unknown",
          duration_minutes: scenario.duration_minutes || 60,
          mode: scenario.mode || "free",
          event_type: scenario.scenario_context?.event_type || "Unbekannt",
          file: file
        });
      } catch (err) {
        // Datei überspringen wenn nicht parsbar
      }
    }

    return scenarios;
  } catch (err) {
    return [];
  }
}

async function loadScenario(scenarioId) {
  try {
    const files = await fs.readdir(SCENARIOS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await fs.readFile(path.join(SCENARIOS_DIR, file), "utf-8");
      const scenario = JSON.parse(content);
      if (scenario.id === scenarioId || file === `${scenarioId}.json`) {
        return scenario;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

// ============================================================
// Imports für Disaster Context und LLM Feedback
// ============================================================
import {
  initializeDisasterContext,
  updateDisasterContextFromEinfo,
  getCurrentDisasterContext,
  getFilteredDisasterContextSummary,
  getLLMSummarizedContext,
  getSummarizationPromptData,
  loadDisasterContext,
  listDisasterContexts,
  finalizeDisasterContext,
  recordLLMSuggestion
} from "./disaster_context.js";

import {
  saveFeedback,
  findSimilarLearnedResponses,
  getLearnedResponsesContext,
  listFeedbacks,
  getFeedbackStatistics
} from "./llm_feedback.js";

// ============================================================
// Streaming-Antwort für Chat
// ============================================================
async function streamAnswer({ res, question }) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");

  const startTime = Date.now();
  const taskConfig = getModelForTask("chat");

  try {
    await callLLMForChat({
      question,
      stream: true,
      onToken: (token) => res.write(token)
    });
    logLlmRequest({
      source: "chat",
      model: taskConfig?.model,
      durationMs: Date.now() - startTime,
      hasResponse: true
    });
  } catch (err) {
    logLlmRequest({
      source: "chat",
      model: taskConfig?.model,
      durationMs: Date.now() - startTime,
      hasResponse: false,
      error: String(err)
    });
    logEvent("error", "llm_request_failed", {
      source: "chat",
      error: String(err)
    });
    throw err;
  }

  res.end();
}

// ============================================================
// Express-App Setup
// ============================================================
const app = express();
app.use(cors());
app.use(createJsonBodyParser());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientDir = path.resolve(__dirname, "../client");

// Beide Routen zeigen auf die gleiche zusammengeführte GUI
app.use("/gui", express.static(clientDir));
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

// Root-Route auf GUI umleiten
app.get("/", (req, res) => {
  res.redirect("/gui/");
});

// ============================================================
// API-Routen für Szenarien
// ============================================================

app.get("/api/scenarios", async (_req, res) => {
  try {
    const scenarios = await listScenarios();
    res.json({ ok: true, scenarios });
  } catch (err) {
    logError("Fehler beim Laden der Szenarien", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/api/scenarios/:scenarioId", async (req, res) => {
  try {
    const { scenarioId } = req.params;
    const scenario = await loadScenario(scenarioId);
    if (!scenario) {
      return res.status(404).json({ ok: false, error: "Szenario nicht gefunden" });
    }
    res.json({ ok: true, scenario });
  } catch (err) {
    logError("Fehler beim Laden des Szenarios", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// Bestehende Simulations-Routen
// ============================================================

app.post("/api/sim/start", async (req, res) => {
  try {
    const { scenarioId, resume } = req.body || {};
    let scenario = null;
    const resumeRequested = !scenarioId && (resume === true || simulationState.paused);

    // Szenario laden wenn angegeben
    if (scenarioId) {
      scenario = await loadScenario(scenarioId);
      if (!scenario) {
        return res.status(404).json({ ok: false, error: "Szenario nicht gefunden" });
      }
      logInfo("Szenario geladen", { scenarioId, title: scenario.title });
      broadcastSSE("scenario_loaded", {
        scenarioId,
        title: scenario.title,
        description: scenario.description
      });
    }

    if (!resumeRequested) {
      await cleanupServerData();
    } else {
      logInfo("Cleanup beim Simulationsstart übersprungen (Resume)", {
        paused: simulationState.paused
      });
    }

    const auditStatus = getAuditStatus();
    if (!auditStatus.active) {
      await startAuditTrail({
        exerciseName: scenario?.title || "Simulation",
        mode: scenario?.mode || "free"
      });
    }

    // NEU: Szenario wird jetzt an startSimulation übergeben und in sim_loop.js verwaltet
    await startSimulation(scenario);

    // Worker starten (läuft nur während aktiver Simulation)
    const workerResult = await startWorker();
    if (!workerResult.ok) {
      logError("Worker konnte nicht gestartet werden", { error: workerResult.error });
    }

    const activeScenario = getActiveScenario();
    res.json({ ok: true, scenario: activeScenario ? { id: activeScenario.id, title: activeScenario.title } : null });
  } catch (err) {
    logError("Fehler beim Starten der Simulation", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Aktives Szenario abrufen (jetzt aus sim_loop.js)
app.get("/api/sim/scenario", (_req, res) => {
  const activeScenario = getActiveScenario();
  res.json({ ok: true, scenario: activeScenario });
});

app.get("/api/sim/status", (_req, res) => {
  try {
    const activeScenario = getActiveScenario();
    const auditStatus = getAuditStatus();
    const events = getFilteredEvents({ limit: 200 });

    res.json({
      ok: true,
      simulation: simulationState.getStatus(),
      scenario: activeScenario
        ? {
            id: activeScenario.id,
            title: activeScenario.title,
            description: activeScenario.description || ""
          }
        : null,
      audit: auditStatus,
      events
    });
  } catch (err) {
    logError("Simulation-Status Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post("/api/sim/pause", async (req, res) => {
  pauseSimulation();

  // Worker stoppen (läuft nur während aktiver Simulation)
  const workerResult = await stopWorker();
  if (!workerResult.ok) {
    logError("Worker konnte nicht gestoppt werden", { error: workerResult.error });
  }

  res.json({ ok: true });
});

app.post("/api/sim/step", async (req, res) => {
  const options = req.body || {};
  try {
    const result = await stepSimulation(options);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    logError("Fehler beim Simulationsschritt-Endpunkt", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// Metriken-Endpunkte (NEU: Performance-Monitoring)
// ============================================================

app.get("/api/metrics", (_req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  try {
    const prometheus = metrics.exportPrometheus();
    res.send(prometheus);
  } catch (err) {
    logError("Fehler beim Metrics-Export", { error: String(err) });
    res.status(500).send('# Error exporting metrics\n');
  }
});

app.get("/api/metrics/stats", (_req, res) => {
  try {
    const stats = {
      simulation: {
        llmCalls: metrics.getStats('simulation_llm_call_duration_ms'),
        stepDuration: metrics.getStats('simulation_step_duration_ms'),
        state: simulationState.getStatus()
      },
      operations: {
        boardCreate: metrics.getCounterSum('simulation_operations_total', { type: "board_create" }),
        boardUpdate: metrics.getCounterSum('simulation_operations_total', { type: "board_update" }),
        aufgabenCreate: metrics.getCounterSum('simulation_operations_total', { type: "aufgaben_create" }),
        protokollCreate: metrics.getCounterSum('simulation_operations_total', { type: "protokoll_create" })
      },
      cache: cache.getStats(),
      errors: {
        total: Array.from(metrics.counters.entries())
          .filter(([key]) => key.startsWith('simulation_errors_total'))
          .reduce((sum, [, value]) => sum + value, 0)
      },
      metrics: metrics.toJSON()
    };
    res.json(stats);
  } catch (err) {
    logError("Fehler beim Stats-Export", { error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// Bestehende Chat-Route (nur wenn Simulation pausiert)
// ============================================================

app.post("/api/chat", rateLimit(RateLimitProfiles.GENEROUS), async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== "string") {
    return res.status(400).json({ ok: false, error: "missing_question" });
  }

  if (isSimulationRunning()) {
    return res
      .status(400)
      .json({ ok: false, error: "simulation_running" });
  }

  try {
    await streamAnswer({ res, question });
  } catch (err) {
    logError("Fehler im Chat-Endpoint", { error: String(err) });
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: String(err) });
    } else {
      res.end();
    }
  }
});

// ============================================================
// Bestehende LLM-Routen
// ============================================================

app.get("/api/llm/models", async (_req, res) => {
  try {
    const models = await listAvailableLlmModels();
    res.json({ ok: true, models });
  } catch (err) {
    logError("Fehler beim Laden der LLM-Modelle", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/api/llm/gpu", async (_req, res) => {
  try {
    const gpuStatus = await getGpuStatus();
    res.json({ ok: true, gpuStatus });
  } catch (err) {
    logError("Fehler beim Lesen des GPU-Status", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/api/llm/system", (_req, res) => {
  try {
    const systemStatus = getSystemStatus();
    res.json({ ok: true, systemStatus });
  } catch (err) {
    logError("Fehler beim Lesen des System-Status", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post("/api/llm/test", rateLimit(RateLimitProfiles.STRICT), async (req, res) => {
  const { question, model } = req.body || {};
  const gpuStatus = await getGpuStatus();

  if (!question || typeof question !== "string") {
    return res.status(400).json({ ok: false, error: "missing_question", gpuStatus });
  }

  if (!model || typeof model !== "string") {
    return res.status(400).json({ ok: false, error: "missing_model", gpuStatus });
  }

  const startTime = Date.now();

  try {
    const models = await listAvailableLlmModels();
    const modelNames = models.map(m => m.name);
    if (!modelNames.includes(model)) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_model", gpuStatus });
    }

    const answer = await callLLMForChat({ question, model });
    logLlmRequest({
      source: "test",
      model,
      durationMs: Date.now() - startTime,
      hasResponse: true
    });
    res.json({ ok: true, answer, gpuStatus });
  } catch (err) {
    logError("Fehler im LLM-Test-Endpunkt", { error: String(err) });
    logLlmRequest({
      source: "test",
      model,
      durationMs: Date.now() - startTime,
      hasResponse: false,
      error: String(err)
    });
    logEvent("error", "llm_request_failed", {
      source: "test",
      error: String(err)
    });
    res.status(500).json({ ok: false, error: String(err), gpuStatus });
  }
});

// ============================================================
// NEU: Multi-Modell Management API
// ============================================================

// Alle konfigurierten Modelle und deren Status
app.get("/api/llm/config", async (_req, res) => {
  try {
    const modelStatus = await checkConfiguredModels();
    const allTaskConfigs = getAllTaskConfigs();

    res.json({
      ok: true,
      globalModelOverride: allTaskConfigs.globalModelOverride,
      tasks: allTaskConfigs.tasks,
      installedModels: modelStatus.installed,
      available: modelStatus.available,
      missing: modelStatus.missing
    });
  } catch (err) {
    logError("Fehler beim Laden der Task-Konfiguration", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Globales Modell-Override setzen
app.post("/api/llm/global-model", (req, res) => {
  const { model } = req.body || {};

  try {
    setGlobalModelOverride(model || null);

    logInfo("Globales Modell-Override gesetzt", { model: model || "deaktiviert" });
    broadcastSSE("global_model_changed", { model });

    res.json({
      ok: true,
      message: model ? `Globales Modell: ${model}` : "Task-spezifische Modelle aktiv",
      globalModelOverride: model || null
    });
  } catch (err) {
    logError("Fehler beim Setzen des globalen Modells", { error: String(err), model });
    res.status(400).json({ ok: false, error: String(err) });
  }
});

// Task-Konfiguration aktualisieren (alle Parameter)
app.post("/api/llm/task-config", (req, res) => {
  const { taskType, updates } = req.body || {};

  if (!taskType || !updates) {
    return res.status(400).json({
      ok: false,
      error: "taskType und updates erforderlich"
    });
  }

  try {
    updateTaskConfig(taskType, updates);

    logInfo("Task-Config aktualisiert", { taskType, updates });
    broadcastSSE("task_config_changed", { taskType, updates });

    res.json({
      ok: true,
      message: `Task "${taskType}" aktualisiert`,
      taskConfig: getTaskConfig(taskType)
    });
  } catch (err) {
    logError("Fehler beim Aktualisieren der Task-Config", { error: String(err), taskType });
    res.status(400).json({ ok: false, error: String(err) });
  }
});

// Modell für bestimmten Task-Typ abfragen
app.get("/api/llm/model/:taskType", (req, res) => {
  const { taskType } = req.params;
  
  try {
    const model = getModelForTask(taskType);
    res.json({
      ok: true,
      taskType,
      model
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

// Schnelltest eines bestimmten Modell-Profils
app.post("/api/llm/test-model", rateLimit(RateLimitProfiles.STRICT), async (req, res) => {
  const { modelKey } = req.body || {};

  if (!modelKey || !CONFIG.llm.models[modelKey]) {
    return res.status(400).json({
      ok: false,
      error: `Ungültiger modelKey. Erlaubt: ${Object.keys(CONFIG.llm.models).join(", ")}`
    });
  }

  const modelConfig = CONFIG.llm.models[modelKey];
  const testPrompt = 'Antworte kurz auf Deutsch: Was ist 2+2? Gib nur die Zahl zurück.';

  const startTime = Date.now();

  try {
    // GPU-Status vorher
    const gpuBefore = await getGpuStatus();

    const answer = await callLLMForChat({
      question: testPrompt,
      model: modelConfig.name
    });

    const duration = Date.now() - startTime;

    // GPU-Status nachher
    const gpuAfter = await getGpuStatus();

    logLlmRequest({
      source: "test-model",
      model: modelConfig.name,
      durationMs: duration,
      hasResponse: true
    });

    logInfo("Modell-Test erfolgreich", { modelKey, duration });

    res.json({
      ok: true,
      modelKey,
      modelName: modelConfig.name,
      duration,
      timeout: modelConfig.timeout,
      response: typeof answer === "string" ? answer.slice(0, 500) : answer,
      gpu: {
        before: gpuBefore,
        after: gpuAfter
      }
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    logError("Modell-Test fehlgeschlagen", {
      modelKey,
      modelName: modelConfig.name,
      error: String(err),
      duration
    });
    logLlmRequest({
      source: "test-model",
      model: modelConfig.name,
      durationMs: duration,
      hasResponse: false,
      error: String(err)
    });
    logEvent("error", "llm_request_failed", {
      source: "test-model",
      error: String(err)
    });

    res.status(500).json({
      ok: false,
      error: String(err),
      modelKey,
      modelName: modelConfig.name,
      duration,
      timeout: modelConfig.timeout
    });
  }
});

// LLM-Test mit GPU-, CPU- und RAM-Metriken-Verlauf (2-Sekunden-Intervall)
app.post("/api/llm/test-with-metrics", rateLimit(RateLimitProfiles.STRICT), async (req, res) => {
  const { model, question } = req.body || {};

  // Enhanced error response with debug info for troubleshooting
  if (!question || typeof question !== "string") {
    return res.status(400).json({
      ok: false,
      error: "missing_question",
      debug: {
        bodyType: typeof req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        hasQuestion: "question" in (req.body || {}),
        questionType: typeof (req.body?.question)
      }
    });
  }

  if (!model || typeof model !== "string") {
    return res.status(400).json({ ok: false, error: "missing_model" });
  }

  // Validiere Modell
  try {
    const models = await listAvailableLlmModels();
    const modelNames = models.map(m => m.name);
    if (!modelNames.includes(model)) {
      return res.status(400).json({ ok: false, error: "invalid_model" });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "model_check_failed" });
  }

  const startTime = Date.now();
  const metrics = [];
  let metricsInterval = null;
  let llmFinished = false;
  let previousCpuSnapshot = getCpuTimesSnapshot();

  // Alle Metriken im 2-Sekunden-Intervall sammeln (GPU + CPU + RAM)
  const collectAllMetrics = async () => {
    if (llmFinished) return;
    try {
      const timestamp = Date.now() - startTime;

      // GPU-Metriken
      const gpuStatus = await getGpuStatus();
      let gpuData = {
        utilizationPercent: null,
        memoryUsedMb: null,
        memoryTotalMb: null,
        temperatureCelsius: null
      };
      if (gpuStatus.available && gpuStatus.gpus && gpuStatus.gpus[0]) {
        const gpu = gpuStatus.gpus[0];
        gpuData = {
          utilizationPercent: gpu.utilizationPercent,
          memoryUsedMb: gpu.memoryUsedMb,
          memoryTotalMb: gpu.memoryTotalMb,
          temperatureCelsius: gpu.temperatureCelsius
        };
      }

      // System-Metriken (CPU + RAM)
      const systemMetrics = collectSystemMetrics(timestamp, previousCpuSnapshot);
      previousCpuSnapshot = systemMetrics._cpuSnapshot;

      metrics.push({
        timestamp,
        // GPU-Daten
        utilizationPercent: gpuData.utilizationPercent,
        memoryUsedMb: gpuData.memoryUsedMb,
        memoryTotalMb: gpuData.memoryTotalMb,
        temperatureCelsius: gpuData.temperatureCelsius,
        // System-Daten (CPU + RAM)
        cpuUsagePercent: systemMetrics.cpuUsagePercent,
        ramUsedMb: systemMetrics.memoryUsedMb,
        ramTotalMb: systemMetrics.memoryTotalMb
      });
    } catch {
      // Ignoriere Fehler beim Metriken-Sammeln
    }
  };

  // Initiale Messung
  await collectAllMetrics();

  // Starte Intervall
  metricsInterval = setInterval(collectAllMetrics, 2000);

  try {
    const answer = await callLLMForChat({ question, model });
    llmFinished = true;
    clearInterval(metricsInterval);

    // Finale Messung nach Abschluss
    await collectAllMetrics();

    const duration = Date.now() - startTime;

    // Berechne Min/Max/Avg-Werte für alle Metriken
    const gpuUtilizationValues = metrics.map(m => m.utilizationPercent).filter(v => v !== null);
    const gpuMemoryValues = metrics.map(m => m.memoryUsedMb).filter(v => v !== null);
    const cpuUsageValues = metrics.map(m => m.cpuUsagePercent).filter(v => v !== null);
    const ramUsageValues = metrics.map(m => m.ramUsedMb).filter(v => v !== null);

    const stats = {
      duration,
      // GPU-Statistiken
      gpuUtilization: {
        min: gpuUtilizationValues.length > 0 ? Math.min(...gpuUtilizationValues) : null,
        max: gpuUtilizationValues.length > 0 ? Math.max(...gpuUtilizationValues) : null,
        avg: gpuUtilizationValues.length > 0
          ? Math.round(gpuUtilizationValues.reduce((a, b) => a + b, 0) / gpuUtilizationValues.length)
          : null
      },
      memoryUsedMb: {
        min: gpuMemoryValues.length > 0 ? Math.min(...gpuMemoryValues) : null,
        max: gpuMemoryValues.length > 0 ? Math.max(...gpuMemoryValues) : null,
        avg: gpuMemoryValues.length > 0
          ? Math.round(gpuMemoryValues.reduce((a, b) => a + b, 0) / gpuMemoryValues.length)
          : null
      },
      memoryTotalMb: metrics.length > 0 ? metrics[0].memoryTotalMb : null,
      // CPU-Statistiken
      cpuUsage: {
        min: cpuUsageValues.length > 0 ? Math.min(...cpuUsageValues) : null,
        max: cpuUsageValues.length > 0 ? Math.max(...cpuUsageValues) : null,
        avg: cpuUsageValues.length > 0
          ? Math.round(cpuUsageValues.reduce((a, b) => a + b, 0) / cpuUsageValues.length)
          : null
      },
      // RAM-Statistiken
      ramUsedMb: {
        min: ramUsageValues.length > 0 ? Math.min(...ramUsageValues) : null,
        max: ramUsageValues.length > 0 ? Math.max(...ramUsageValues) : null,
        avg: ramUsageValues.length > 0
          ? Math.round(ramUsageValues.reduce((a, b) => a + b, 0) / ramUsageValues.length)
          : null
      },
      ramTotalMb: metrics.length > 0 ? metrics[0].ramTotalMb : null
    };

    logInfo("LLM-Test mit Metriken erfolgreich", { model, duration, metricsCount: metrics.length });
    logLlmRequest({
      source: "test-with-metrics",
      model,
      durationMs: duration,
      hasResponse: true
    });

    res.json({
      ok: true,
      answer: typeof answer === "string" ? answer.slice(0, 2000) : answer,
      duration,
      model,
      metrics,
      stats
    });
  } catch (err) {
    llmFinished = true;
    clearInterval(metricsInterval);

    const duration = Date.now() - startTime;
    logError("LLM-Test mit Metriken fehlgeschlagen", { model, error: String(err), duration });
    logLlmRequest({
      source: "test-with-metrics",
      model,
      durationMs: duration,
      hasResponse: false,
      error: String(err)
    });
    logEvent("error", "llm_request_failed", {
      source: "test-with-metrics",
      error: String(err)
    });

    res.status(500).json({
      ok: false,
      error: String(err),
      duration,
      model,
      metrics
    });
  }
});

// LLM-Test mit Streaming (SSE) - Tokens werden live gesendet
// NEU: Unterstützt taskType für echte Prompt-Komposition und editedPrompts für manuelle Anpassungen
app.post("/api/llm/test-with-metrics-stream", rateLimit(RateLimitProfiles.STRICT), async (req, res) => {
  const { model, question, taskType = "chat", editedPrompts, previewOnly } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ ok: false, error: "missing_question" });
  }

  if (!model || typeof model !== "string") {
    return res.status(400).json({ ok: false, error: "missing_model" });
  }

  // Validiere Modell
  try {
    const models = await listAvailableLlmModels();
    const modelNames = models.map(m => m.name);
    if (!modelNames.includes(model)) {
      return res.status(400).json({ ok: false, error: "invalid_model" });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "model_check_failed" });
  }

  // SSE-Header setzen
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendSSE = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const startTime = Date.now();
  const metrics = [];
  let metricsInterval = null;
  let llmFinished = false;
  let previousCpuSnapshot = getCpuTimesSnapshot();
  let fullAnswer = "";

  // Task-Config für den gewählten Task-Typ holen
  const taskConfig = getModelForTask(taskType);

  // ============================================================
  // Prompts basierend auf Task-Typ zusammenstellen
  // ============================================================
  let systemPrompt = "";
  let userPrompt = "";

  try {
    if (editedPrompts && editedPrompts.systemPrompt !== undefined && editedPrompts.userPrompt !== undefined) {
      // Benutzer hat Prompts manuell bearbeitet - diese verwenden
      systemPrompt = editedPrompts.systemPrompt;
      userPrompt = editedPrompts.userPrompt;
      logDebug("Verwende bearbeitete Prompts für Test", { taskType, edited: true });
    } else if (taskType === "analysis") {
      // Analysis: Verwende echte Situationsanalyse-Prompts
      const situationAnalysisSystemTemplate = loadPromptTemplate("situation_analysis_system.txt");
      const situationAnalysisUserTemplate = loadPromptTemplate("situation_analysis_user.txt");

      // Rollen-Beschreibungen
      const ROLE_DESCRIPTIONS = {
        "LTSTB": "Leiter Technischer Einsatzleitung - Gesamtverantwortung und strategische Führung",
        "S1": "Stabsstelle 1 - Personal und Innerer Dienst",
        "S2": "Stabsstelle 2 - Lage und Dokumentation",
        "S3": "Stabsstelle 3 - Einsatz und Taktik",
        "S4": "Stabsstelle 4 - Versorgung und Logistik",
        "S5": "Stabsstelle 5 - Presse und Öffentlichkeitsarbeit",
        "S6": "Stabsstelle 6 - Kommunikation und IT"
      };
      const roles = Object.keys(ROLE_DESCRIPTIONS);
      const rolesDescription = roles.map(r => `- ${r}: ${ROLE_DESCRIPTIONS[r]}`).join("\n");

      // Prüfe ob LLM-Summarization aktiviert ist
      const analysisConfig = await getAnalysisConfig();
      const useLLMSummarization = analysisConfig.contextMode === "llm" ||
                                  analysisConfig.llmSummarization?.enabled === true;

      // Disaster Context holen - entsprechend der Konfiguration
      let disasterSummary;
      let contextMode;
      if (useLLMSummarization) {
        logDebug("Modelltest Analysis: Verwende LLM-Summarization für Kontext");
        const llmResult = await getLLMSummarizedContext({ maxLength: 2500 });
        disasterSummary = llmResult.summary;
        contextMode = llmResult.llmUsed ? "llm" : "rules-fallback";
      } else {
        logDebug("Modelltest Analysis: Verwende regelbasierte Filterung für Kontext");
        const { summary } = await getFilteredDisasterContextSummary({ maxLength: 2500 });
        disasterSummary = summary;
        contextMode = "rules";
      }
      logDebug("Modelltest Analysis: Context-Modus", { contextMode, useLLMSummarization });

      const excludeContext = await getExcludeContextForPrompt(roles);

      // RAG-Kontext laden wenn aktiviert (wie in situation_analyzer.js)
      let ragContext = "";
      if (analysisConfig.useRagContext) {
        try {
          logDebug("Lade RAG-Kontext für Modelltest Analysis");
          const ragQuery = `Einsatzlage: ${disasterSummary?.substring(0, 500) || ""}`;
          const ragResult = await getKnowledgeContextWithSources(ragQuery, {
            topK: 5,
            maxChars: 2000
          });
          if (ragResult && ragResult.context) {
            ragContext = `---
RELEVANTE INFORMATIONEN AUS DER WISSENSDATENBANK (SOPs, Richtlinien, Vorschriften):

${ragResult.context}`;
            logDebug("RAG-Kontext geladen für Modelltest", {
              contextLength: ragResult.context.length,
              sourcesCount: ragResult.sources?.length || 0
            });
          }
        } catch (ragErr) {
          logError("Fehler beim Laden des RAG-Kontexts für Modelltest", { error: String(ragErr) });
          // Fortfahren ohne RAG-Kontext
        }
      }

      systemPrompt = fillTemplate(situationAnalysisSystemTemplate, { rolesDescription });
      userPrompt = fillTemplate(situationAnalysisUserTemplate, {
        disasterSummary: disasterSummary || "(Keine aktuellen Lagedaten verfügbar - Testmodus)",
        excludeContext: excludeContext || "",
        ragContext: ragContext || "" // RAG Knowledge-Base Kontext (wenn aktiviert)
      });
    } else if (taskType === "summarization") {
      // Summarization: Verwende Kontext-Zusammenfassungs-Prompts
      const summarizationSystemTemplate = loadPromptTemplate("summarization_system.txt");
      const summarizationUserTemplate = loadPromptTemplate("summarization_user.txt");

      const {
        boardData,
        protocolData,
        tasksData,
        activeIncidents,
        criticalIncidents,
        totalPersonnel,
        protocolCount,
        openTasks
      } = await getSummarizationPromptData();

      systemPrompt = summarizationSystemTemplate;
      userPrompt = fillTemplate(summarizationUserTemplate, {
        boardData,
        protocolData,
        tasksData,
        activeIncidents: String(activeIncidents),
        criticalIncidents: String(criticalIncidents),
        totalPersonnel: String(totalPersonnel),
        protocolCount: String(protocolCount),
        openTasks: String(openTasks)
      });
    } else if (taskType === "chat") {
      // Chat: Verwende Chat-Prompts
      systemPrompt = buildSystemPromptChat();
      userPrompt = buildUserPromptChat(question, "(Knowledge-Kontext wird bei echtem Chat-Aufruf hinzugefügt)", "", "");
    } else if (taskType === "situation-question") {
      // Situation-Question: Verwende Frage-Prompts (Text-Output, kein JSON)
      // Verwendet ECHTE Daten wie in der Produktionsumgebung
      const situationQuestionSystemTemplate = loadPromptTemplate("situation_question_system.txt");

      // Rollen-Beschreibung für Test (S2 als Default)
      const testRole = "S2";
      const roleDescription = "Stabsstelle 2 - Lage und Dokumentation. KERNAUFGABEN: Lagekarte mit allen Einsatzstellen führen, Pegelstände/Messwerte dokumentieren, Lagemeldungen zu festen Zeiten erstellen, Einsatztagebuch führen, Wetterdaten abfragen.";

      // Prüfe ob LLM-Summarization aktiviert ist (wie bei Analysis)
      const analysisConfig = await getAnalysisConfig();
      const useLLMSummarization = analysisConfig.contextMode === "llm" ||
                                  analysisConfig.llmSummarization?.enabled === true;

      // Disaster Context holen - entsprechend der Konfiguration
      let disasterSummary;
      let contextMode;
      if (useLLMSummarization) {
        logDebug("Modelltest Situation-Question: Verwende LLM-Summarization für Kontext");
        const llmResult = await getLLMSummarizedContext({ maxLength: 1500 });
        disasterSummary = llmResult.summary;
        contextMode = llmResult.llmUsed ? "llm" : "rules-fallback";
      } else {
        logDebug("Modelltest Situation-Question: Verwende regelbasierte Filterung für Kontext");
        const { summary } = await getFilteredDisasterContextSummary({ maxLength: 1500 });
        disasterSummary = summary;
        contextMode = "rules";
      }
      logDebug("Modelltest Situation-Question: Context-Modus", { contextMode, useLLMSummarization });

      // RAG-Context holen (ECHT - wie in answerQuestion)
      const [vectorRagResult, sessionContext] = await Promise.all([
        getKnowledgeContextWithSources(question, { topK: 3, maxChars: 1500 }),
        getCurrentSession().getContextForQuery(question, { maxChars: 1000, topK: 3 })
      ]);

      // RAG-Context zusammenbauen
      let ragContextSection = "";
      if (vectorRagResult.context) {
        ragContextSection += "FACHLICHES WISSEN (Knowledge-Base):\n" + vectorRagResult.context + "\n\n";
      }
      if (sessionContext) {
        ragContextSection += sessionContext;
      }

      systemPrompt = fillTemplate(situationQuestionSystemTemplate, {
        role: testRole,
        roleDescription: roleDescription,
        disasterSummary: disasterSummary || "(Keine aktuellen Lagedaten verfügbar)",
        ragContext: ragContextSection || "(Kein relevanter RAG-Kontext gefunden)"
      });
      userPrompt = question;
    } else if (taskType === "operations" || taskType === "start") {
      // Operations/Start: Verwende echte Simulationsdaten wie im laufenden Betrieb
      const scenario = getActiveScenario();
      const { roles, board, aufgaben, protokoll } = await readEinfoInputs();

      await updateDisasterContextFromEinfo({ board, protokoll, aufgaben, roles });

      const compressedBoard = compressBoard(board);
      const compressedAufgaben = compressAufgaben(aufgaben);
      const compressedProtokoll = compressProtokoll(protokoll);

      const knowledgeContext = await getKnowledgeContextVector(
        "Stabsarbeit Kat-E Einsatzleiter LdStb Meldestelle S1 S2 S3 S4 S5 S6"
      );
      const { summary: disasterContext } = await getFilteredDisasterContextSummary({ maxLength: 1500 });
      const contextQuery = `${compressedBoard.substring(0, 200)} Katastrophenmanagement Einsatzleitung`;
      const learnedResponses = await getLearnedResponsesContext(contextQuery, { maxLength: 1000 });

      const memoryQuery = buildMemoryQueryFromState({
        boardCount: board.length,
        aufgabenCount: aufgaben.length,
        protokollCount: protokoll.length
      });
      const memoryHits = await searchMemory({
        query: memoryQuery,
        topK: CONFIG.memoryRag.longScenarioTopK,
        now: new Date(),
        maxAgeMinutes: CONFIG.memoryRag.maxAgeMinutes,
        recencyHalfLifeMinutes: CONFIG.memoryRag.recencyHalfLifeMinutes,
        longScenarioMinItems: CONFIG.memoryRag.longScenarioMinItems
      });
      const memorySnippets = memoryHits.map((hit) => hit.text);

      const { delta: protokollDelta } = buildDelta(
        protokoll,
        simulationState.lastSnapshot?.protokoll,
        toComparableProtokoll
      );
      const messagesNeedingResponse = identifyMessagesNeedingResponse(protokoll, protokollDelta, roles);
      const openQuestions = identifyOpenQuestions(protokoll, roles);

      if (taskType === "start") {
        const startPrompts = buildStartPrompts({
          roles,
          scenario,
          allowScenarioFallback: false
        });
        systemPrompt = startPrompts.systemPrompt;
        userPrompt = startPrompts.userPrompt;
      } else {
        const opsContext = {
          roles: { active: roles.active },
          compressedBoard,
          compressedAufgaben,
          compressedProtokoll,
          firstStep: false,
          elapsedMinutes: simulationState.elapsedMinutes,
          messagesNeedingResponse: messagesNeedingResponse.length > 0 ? messagesNeedingResponse : null,
          openQuestions: openQuestions.length > 0 ? openQuestions : null,
          scenarioControl: buildScenarioControlSummary({
            scenario,
            elapsedMinutes: simulationState.elapsedMinutes
          })
        };

        systemPrompt = buildSystemPrompt({ memorySnippets });
        userPrompt = buildUserPrompt({
          llmInput: opsContext,
          compressedBoard,
          compressedAufgaben,
          compressedProtokoll,
          knowledgeContext,
          memorySnippets,
          messagesNeedingResponse: opsContext.messagesNeedingResponse,
          openQuestions: opsContext.openQuestions,
          disasterContext,
          learnedResponses,
          scenario,
          allowPlaceholders: false
        });
      }
    } else {
      // Default: Einfacher System-Prompt
      systemPrompt = "Du bist ein hilfreicher Assistent für Katastrophenmanagement.";
      userPrompt = question;
    }
  } catch (promptErr) {
    logError("Fehler beim Erstellen der Prompts", { taskType, error: String(promptErr) });
    // Fallback auf einfache Prompts
    systemPrompt = "Du bist ein hilfreicher Assistent.";
    userPrompt = question;
  }

  const rawRequest = {
    model: model,
    stream: true,
    format: taskType === "analysis" ? "json" : undefined,
    options: {
      temperature: taskConfig.temperature,
      num_ctx: taskConfig.numCtx,
      num_gpu: taskConfig.numGpu,
      num_predict: taskConfig.maxTokens,
      top_p: taskConfig.topP,
      top_k: taskConfig.topK,
      repeat_penalty: taskConfig.repeatPenalty
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  // Bei previewOnly: Nur Prompts zurückgeben ohne LLM-Aufruf
  if (previewOnly) {
    sendSSE("prompts", {
      ok: true,
      rawRequest,
      taskType,
      model
    });
    res.end();
    return;
  }

  // Metriken sammeln
  const collectAllMetrics = async () => {
    if (llmFinished) return;
    try {
      const timestamp = Date.now() - startTime;
      const gpuStatus = await getGpuStatus();
      let gpuData = {
        utilizationPercent: null,
        memoryUsedMb: null,
        memoryTotalMb: null,
        temperatureCelsius: null
      };
      if (gpuStatus.available && gpuStatus.gpus && gpuStatus.gpus[0]) {
        const gpu = gpuStatus.gpus[0];
        gpuData = {
          utilizationPercent: gpu.utilizationPercent,
          memoryUsedMb: gpu.memoryUsedMb,
          memoryTotalMb: gpu.memoryTotalMb,
          temperatureCelsius: gpu.temperatureCelsius
        };
      }

      const systemMetrics = collectSystemMetrics(timestamp, previousCpuSnapshot);
      previousCpuSnapshot = systemMetrics._cpuSnapshot;

      const metricPoint = {
        timestamp,
        utilizationPercent: gpuData.utilizationPercent,
        memoryUsedMb: gpuData.memoryUsedMb,
        memoryTotalMb: gpuData.memoryTotalMb,
        temperatureCelsius: gpuData.temperatureCelsius,
        cpuUsagePercent: systemMetrics.cpuUsagePercent,
        ramUsedMb: systemMetrics.memoryUsedMb,
        ramTotalMb: systemMetrics.memoryTotalMb
      };
      metrics.push(metricPoint);

      // Metriken live senden
      sendSSE("metrics", metricPoint);
    } catch {
      // Ignoriere Fehler
    }
  };

  // Token-Callback für Streaming
  const onToken = (token) => {
    fullAnswer += token;
    sendSSE("token", { token });
  };

  await collectAllMetrics();
  metricsInterval = setInterval(collectAllMetrics, 2000);

  try {
    // Verwende die zusammengestellten Prompts für den LLM-Aufruf
    await callLLMForChat(systemPrompt, userPrompt, {
      taskType,
      model,
      stream: true,
      onToken,
      requireJson: taskType === "analysis"
    });
    llmFinished = true;
    clearInterval(metricsInterval);

    await collectAllMetrics();

    const duration = Date.now() - startTime;

    // Statistiken berechnen
    const gpuUtilizationValues = metrics.map(m => m.utilizationPercent).filter(v => v !== null);
    const gpuMemoryValues = metrics.map(m => m.memoryUsedMb).filter(v => v !== null);
    const cpuUsageValues = metrics.map(m => m.cpuUsagePercent).filter(v => v !== null);
    const ramUsageValues = metrics.map(m => m.ramUsedMb).filter(v => v !== null);

    const stats = {
      duration,
      gpuUtilization: {
        min: gpuUtilizationValues.length > 0 ? Math.min(...gpuUtilizationValues) : null,
        max: gpuUtilizationValues.length > 0 ? Math.max(...gpuUtilizationValues) : null,
        avg: gpuUtilizationValues.length > 0
          ? Math.round(gpuUtilizationValues.reduce((a, b) => a + b, 0) / gpuUtilizationValues.length)
          : null
      },
      memoryUsedMb: {
        min: gpuMemoryValues.length > 0 ? Math.min(...gpuMemoryValues) : null,
        max: gpuMemoryValues.length > 0 ? Math.max(...gpuMemoryValues) : null,
        avg: gpuMemoryValues.length > 0
          ? Math.round(gpuMemoryValues.reduce((a, b) => a + b, 0) / gpuMemoryValues.length)
          : null
      },
      memoryTotalMb: metrics.length > 0 ? metrics[0].memoryTotalMb : null,
      cpuUsage: {
        min: cpuUsageValues.length > 0 ? Math.min(...cpuUsageValues) : null,
        max: cpuUsageValues.length > 0 ? Math.max(...cpuUsageValues) : null,
        avg: cpuUsageValues.length > 0
          ? Math.round(cpuUsageValues.reduce((a, b) => a + b, 0) / cpuUsageValues.length)
          : null
      },
      ramUsedMb: {
        min: ramUsageValues.length > 0 ? Math.min(...ramUsageValues) : null,
        max: ramUsageValues.length > 0 ? Math.max(...ramUsageValues) : null,
        avg: ramUsageValues.length > 0
          ? Math.round(ramUsageValues.reduce((a, b) => a + b, 0) / ramUsageValues.length)
          : null
      },
      ramTotalMb: metrics.length > 0 ? metrics[0].ramTotalMb : null
    };

    logInfo("LLM-Streaming-Test erfolgreich", { model, duration, metricsCount: metrics.length });
    logLlmRequest({
      source: "test-with-metrics-stream",
      model,
      durationMs: duration,
      hasResponse: true
    });

    // RAW Response zusammenstellen
    const rawResponse = {
      model: model,
      created_at: new Date().toISOString(),
      message: {
        role: "assistant",
        content: fullAnswer
      },
      done: true,
      total_duration: duration * 1000000, // in Nanosekunden wie Ollama
      eval_count: fullAnswer.length // Approximation
    };

    // Finale Zusammenfassung senden (vollständige Antwort ohne Abschneiden)
    sendSSE("done", {
      ok: true,
      answer: fullAnswer,
      duration,
      model,
      taskType,
      modelParams: {
        temperature: taskConfig.temperature,
        maxTokens: taskConfig.maxTokens,
        numGpu: taskConfig.numGpu,
        numCtx: taskConfig.numCtx,
        topP: taskConfig.topP,
        topK: taskConfig.topK,
        repeatPenalty: taskConfig.repeatPenalty,
        timeout: taskConfig.timeout
      },
      metrics,
      stats,
      rawRequest,
      rawResponse
    });

    res.end();
  } catch (err) {
    llmFinished = true;
    clearInterval(metricsInterval);

    const duration = Date.now() - startTime;
    logError("LLM-Streaming-Test fehlgeschlagen", { model, error: String(err), duration });
    logLlmRequest({
      source: "test-with-metrics-stream",
      model,
      durationMs: duration,
      hasResponse: false,
      error: String(err)
    });
    logEvent("error", "llm_request_failed", {
      source: "test-with-metrics-stream",
      error: String(err)
    });

    sendSSE("error", {
      ok: false,
      error: String(err),
      duration,
      model,
      metrics
    });

    res.end();
  }
});

// Alle Modell-Profile mit aktuellem Status
app.get("/api/llm/profiles", async (_req, res) => {
  try {
    const allModels = getAllModels();
    const modelStatus = await checkConfiguredModels();
    const activeConfig = getActiveModelConfig();
    
    const profiles = {};
    for (const [key, config] of Object.entries(allModels)) {
      const isAvailable = modelStatus.available.some(m => m.key === key);
      profiles[key] = {
        ...config,
        available: isAvailable,
        isActive: activeConfig.key === key
      };
    }
    
    res.json({
      ok: true,
      profiles,
      activeModel: activeConfig,
      taskModels: CONFIG.llm.taskModels
    });
  } catch (err) {
    logError("Fehler beim Laden der Modell-Profile", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// API für Prompt-Template-Verwaltung
// ============================================================
const PROMPT_TEMPLATES_DIR = path.resolve(__dirname, "prompt_templates");

// Liste alle verfügbaren Prompt-Templates
app.get("/api/llm/prompt-templates", rateLimit(RateLimitProfiles.LENIENT), async (_req, res) => {
  try {
    const files = await fs.readdir(PROMPT_TEMPLATES_DIR);
    const templates = files
      .filter(f => f.endsWith(".txt"))
      .map(f => ({
        name: f,
        displayName: f.replace(".txt", "").replace(/_/g, " ")
      }));
    res.json({ ok: true, templates });
  } catch (err) {
    logError("Fehler beim Laden der Prompt-Templates", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Lade ein einzelnes Prompt-Template
app.get("/api/llm/prompt-templates/:name", rateLimit(RateLimitProfiles.LENIENT), async (req, res) => {
  try {
    const { name } = req.params;
    // Sicherheit: Nur erlaubte Zeichen im Namen
    if (!/^[a-zA-Z0-9_-]+\.txt$/.test(name)) {
      return res.status(400).json({ ok: false, error: "invalid_template_name" });
    }
    const filePath = path.join(PROMPT_TEMPLATES_DIR, name);
    const content = await fs.readFile(filePath, "utf-8");
    res.json({ ok: true, name, content });
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ ok: false, error: "template_not_found" });
    }
    logError("Fehler beim Laden des Prompt-Templates", { name: req.params.name, error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Speichere ein Prompt-Template
app.put("/api/llm/prompt-templates/:name", rateLimit(RateLimitProfiles.STRICT), async (req, res) => {
  try {
    const { name } = req.params;
    const { content } = req.body || {};

    // Sicherheit: Nur erlaubte Zeichen im Namen
    if (!/^[a-zA-Z0-9_-]+\.txt$/.test(name)) {
      return res.status(400).json({ ok: false, error: "invalid_template_name" });
    }

    if (typeof content !== "string") {
      return res.status(400).json({ ok: false, error: "missing_content" });
    }

    const filePath = path.join(PROMPT_TEMPLATES_DIR, name);

    // Prüfe ob Datei existiert (nur existierende Templates können bearbeitet werden)
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ ok: false, error: "template_not_found" });
    }

    // Backup erstellen bevor wir überschreiben
    const backupDir = path.join(PROMPT_TEMPLATES_DIR, "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `${name}.${timestamp}.bak`);
    const originalContent = await fs.readFile(filePath, "utf-8");
    await fs.writeFile(backupPath, originalContent, "utf-8");

    // Speichere neue Version
    await fs.writeFile(filePath, content, "utf-8");

    logInfo("Prompt-Template aktualisiert", { name, backupPath });
    res.json({ ok: true, message: "Template gespeichert", backupPath });
  } catch (err) {
    logError("Fehler beim Speichern des Prompt-Templates", { name: req.params.name, error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// API für LLM Action-History (KI-Aktionen)
// ============================================================
const ACTION_HISTORY_FILE = path.resolve(__dirname, "../../server/data/llm_action_history.json");

async function readJsonFile(filePath, defaultValue = []) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return defaultValue;
  }
}

app.get("/api/llm/action-history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    const category = req.query.category || null; // "protokoll", "aufgabe", "einsatz" oder null für alle

    let history = await readJsonFile(ACTION_HISTORY_FILE, []);

    // Nach Kategorie filtern
    if (category) {
      history = history.filter(entry => entry.category === category);
    }

    // Paginierung
    const total = history.length;
    const items = history.slice(offset, offset + limit);

    res.json({
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    });
  } catch (err) {
    logError("Fehler beim Laden der Action-History", { error: String(err) });
    res.status(500).json({ error: "Fehler beim Laden der Action-History" });
  }
});

// ============================================================
// API-Routen für Audit-Trail (Übungs-Protokollierung)
// ============================================================

// Status der aktuellen Übung abrufen
app.get("/api/audit/status", (req, res) => {
  try {
    const status = getAuditStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    logError("Audit-Status Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Neue Übung starten
app.post("/api/audit/start", async (req, res) => {
  try {
    const { 
      exerciseName, 
      templateId, 
      mode, 
      participants, 
      instructor 
    } = req.body || {};
    
    const exerciseId = await startAuditTrail({
      exerciseName: exerciseName || "Unbenannte Übung",
      templateId,
      mode: mode || "free",
      participants: participants || [],
      instructor
    });
    
    logInfo("Übung gestartet", { exerciseId, exerciseName, mode });
    
    // SSE-Broadcast an alle verbundenen Clients
    broadcastSSE("exercise_started", { exerciseId, exerciseName, mode });
    
    res.json({ ok: true, exerciseId });
  } catch (err) {
    logError("Übung starten fehlgeschlagen", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung beenden und speichern
app.post("/api/audit/end", async (req, res) => {
  try {
    const result = await endAuditTrail();
    if (!result) {
      return res.status(400).json({ ok: false, error: "Keine aktive Übung" });
    }
    logInfo("Übung beendet", { 
      exerciseId: result.metadata?.exerciseId,
      eventCount: result.events?.length 
    });
    
    // SSE-Broadcast
    broadcastSSE("exercise_ended", { 
      exerciseId: result.metadata?.exerciseId,
      eventCount: result.events?.length 
    });
    
    res.json({ ok: true, result });
  } catch (err) {
    logError("Übung beenden fehlgeschlagen", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Liste aller gespeicherten Übungen
app.get("/api/audit/list", async (req, res) => {
  try {
    const list = await listAuditTrails();
    res.json({ ok: true, exercises: list });
  } catch (err) {
    logError("Audit-Liste Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Bestimmte Übung laden
app.get("/api/audit/:exerciseId", async (req, res) => {
  try {
    const { exerciseId } = req.params;
    const exercise = await loadAuditTrail(exerciseId);
    if (!exercise) {
      return res.status(404).json({ ok: false, error: "Übung nicht gefunden" });
    }
    res.json({ ok: true, exercise });
  } catch (err) {
    logError("Audit laden Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung löschen
app.delete("/api/audit/:exerciseId", async (req, res) => {
  try {
    const { exerciseId } = req.params;
    const deleted = await deleteAuditTrail(exerciseId);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: "Übung nicht gefunden" });
    }
    res.json({ ok: true });
  } catch (err) {
    logError("Audit löschen Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung pausieren
app.post("/api/audit/pause", (req, res) => {
  try {
    pauseExercise();
    broadcastSSE("exercise_paused", {});
    res.json({ ok: true });
  } catch (err) {
    logError("Audit pausieren Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung fortsetzen
app.post("/api/audit/resume", (req, res) => {
  try {
    resumeExercise();
    broadcastSSE("exercise_resumed", {});
    res.json({ ok: true });
  } catch (err) {
    logError("Audit fortsetzen Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Events filtern
app.post("/api/audit/events", async (req, res) => {
  try {
    const { filters } = req.body || {};
    const events = getFilteredEvents(filters);
    res.json({ ok: true, events });
  } catch (err) {
    logError("Events filtern Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// API-Routen für Templates
// ============================================================

// Alle Templates laden
app.get("/api/templates", async (req, res) => {
  try {
    const templates = await loadAllTemplates();
    res.json({ ok: true, templates });
  } catch (err) {
    logError("Templates laden Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Einzelnes Template laden
app.get("/api/templates/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    const template = await loadTemplate(templateId);
    if (!template) {
      return res.status(404).json({ ok: false, error: "Template nicht gefunden" });
    }
    res.json({ ok: true, template });
  } catch (err) {
    logError("Template laden Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Template speichern
app.post("/api/templates", async (req, res) => {
  try {
    const template = req.body;
    const validation = validateTemplate(template);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.errors.join(", ") });
    }
    const saved = await saveTemplate(template);
    res.json({ ok: true, template: saved });
  } catch (err) {
    logError("Template speichern Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Template löschen
app.delete("/api/templates/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    const deleted = await deleteTemplate(templateId);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: "Template nicht gefunden" });
    }
    res.json({ ok: true });
  } catch (err) {
    logError("Template löschen Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung aus Template erstellen
app.post("/api/templates/:templateId/create-exercise", async (req, res) => {
  try {
    const { templateId } = req.params;
    const { exerciseName, participants, instructor } = req.body || {};
    
    const result = await createExerciseFromTemplate(templateId, {
      exerciseName,
      participants,
      instructor
    });
    
    if (!result) {
      return res.status(404).json({ ok: false, error: "Template nicht gefunden" });
    }
    
    broadcastSSE("exercise_created_from_template", { 
      templateId, 
      exerciseId: result.exerciseId 
    });
    
    res.json({ ok: true, ...result });
  } catch (err) {
    logError("Übung aus Template erstellen Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// API-Routen für Disaster Context
// ============================================================

// Aktuellen Disaster Context abrufen
app.get("/api/disaster/current", (req, res) => {
  try {
    const context = getCurrentDisasterContext();
    res.json({ ok: true, context });
  } catch (err) {
    logError("Disaster Context Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Disaster Context Summary abrufen (mit Filterregeln + Admin-Status Update)
app.get("/api/disaster/summary", async (req, res) => {
  try {
    const { maxLength } = req.query;
    const result = await getFilteredDisasterContextSummary({
      maxLength: maxLength ? parseInt(maxLength, 10) : 1500
    });
    res.json({ ok: true, summary: result.summary });
  } catch (err) {
    logError("Disaster Summary Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Neuen Disaster Context initialisieren
app.post("/api/disaster/init", async (req, res) => {
  try {
    const { disasterType, location, severity } = req.body || {};
    const context = await initializeDisasterContext({
      disasterType: disasterType || "Hochwasser",
      location: location || "Bezirk Feldkirchen",
      severity: severity || "mittel"
    });
    broadcastSSE("disaster_initialized", { disasterId: context.disasterId });
    res.json({ ok: true, context });
  } catch (err) {
    logError("Disaster Init Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Disaster Context aus EINFO aktualisieren
app.post("/api/disaster/update", async (req, res) => {
  try {
    const context = await updateDisasterContextFromEinfo();
    if (context) {
      broadcastSSE("disaster_updated", { disasterId: context.disasterId });
    }
    res.json({ ok: true, context });
  } catch (err) {
    logError("Disaster Update Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Liste aller Disaster Contexts
app.get("/api/disaster/list", async (req, res) => {
  try {
    const list = await listDisasterContexts();
    res.json({ ok: true, disasters: list });
  } catch (err) {
    logError("Disaster Context Liste Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Disaster Context laden
app.get("/api/disaster/:disasterId", async (req, res) => {
  try {
    const { disasterId } = req.params;
    const context = await loadDisasterContext(disasterId);
    if (!context) {
      return res.status(404).json({ ok: false, error: "Disaster Context nicht gefunden" });
    }
    res.json({ ok: true, context });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Disaster Context abschließen
app.post("/api/disaster/finalize", async (req, res) => {
  try {
    const context = await finalizeDisasterContext();
    if (!context) {
      return res.status(404).json({ ok: false, error: "Kein aktiver Disaster Context" });
    }
    broadcastSSE("disaster_completed", { disasterId: context.disasterId });
    res.json({ ok: true, context });
  } catch (err) {
    logError("Disaster Context Finalize Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// LLM-Suggestion aufzeichnen
app.post("/api/disaster/record-suggestion", async (req, res) => {
  try {
    const { suggestion, accepted, madeBy } = req.body || {};
    if (!suggestion) {
      return res.status(400).json({ ok: false, error: "suggestion fehlt" });
    }
    await recordLLMSuggestion({ suggestion, accepted, madeBy });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// API-Routen für LLM Feedback & Learning
// ============================================================

// Feedback zu LLM-Antwort speichern
app.post("/api/feedback", async (req, res) => {
  try {
    const {
      disasterId,
      disasterType,
      disasterPhase,
      interactionType,
      question,
      llmResponse,
      llmModel,
      rating,
      helpful,
      accurate,
      actionable,
      userId,
      userRole,
      comment,
      implemented,
      outcome
    } = req.body || {};

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: "Ungültiges Rating (1-5)" });
    }

    const feedback = await saveFeedback({
      disasterId,
      disasterType,
      disasterPhase,
      interactionType,
      question,
      llmResponse,
      llmModel,
      rating,
      helpful,
      accurate,
      actionable,
      userId,
      userRole,
      comment,
      implemented,
      outcome
    });

    if (feedback) {
      broadcastSSE("feedback_received", { feedbackId: feedback.feedbackId, rating });
    }

    res.json({ ok: true, feedback });
  } catch (err) {
    logError("Feedback speichern Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Alle Feedbacks abrufen
app.get("/api/feedback/list", async (req, res) => {
  try {
    const { limit, minRating } = req.query;
    const feedbacks = await listFeedbacks({
      limit: limit ? parseInt(limit, 10) : 50,
      minRating: minRating ? parseInt(minRating, 10) : null
    });
    res.json({ ok: true, feedbacks });
  } catch (err) {
    logError("Feedback Liste Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Feedback-Statistiken abrufen
app.get("/api/feedback/stats", async (req, res) => {
  try {
    const stats = await getFeedbackStatistics();
    res.json({ ok: true, stats });
  } catch (err) {
    logError("Feedback Statistiken Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Ähnliche gelernte Antworten finden
app.post("/api/feedback/similar", async (req, res) => {
  try {
    const { question, topK, minScore } = req.body || {};
    if (!question) {
      return res.status(400).json({ ok: false, error: "question fehlt" });
    }

    const similar = await findSimilarLearnedResponses(question, {
      topK: topK || 3,
      minScore: minScore || 0.6
    });

    res.json({ ok: true, similar });
  } catch (err) {
    logError("Ähnliche Antworten Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Learned Responses Context für LLM abrufen
app.post("/api/feedback/learned-context", async (req, res) => {
  try {
    const { question, maxLength } = req.body || {};
    if (!question) {
      return res.status(400).json({ ok: false, error: "question fehlt" });
    }

    const context = await getLearnedResponsesContext(question, {
      maxLength: maxLength || 1000
    });

    res.json({ ok: true, context });
  } catch (err) {
    logError("Learned Context Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// API-Routen für Situationsanalyse
// ============================================================

// Status der Situationsanalyse (inkl. Timer-Info für nächste Analyse)
app.get("/api/situation/status", (req, res) => {
  try {
    const status = getAnalysisStatus();
    const timerStatus = getAnalysisTimerStatus();
    res.json({ ok: true, ...status, timer: timerStatus });
  } catch (err) {
    logError("Situationsanalyse-Status Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post("/api/situation/analysis-loop/sync", async (_req, res) => {
  try {
    const status = await syncAnalysisLoop();
    res.json({ ok: true, ...status });
  } catch (err) {
    logError("Situationsanalyse-Sync Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Analyse für eine Rolle abrufen
// cacheOnly=true: Nur gecachte Daten abrufen, keine neue Analyse starten
// forceRefresh=true: Neue Analyse erzwingen (ignoriert cacheOnly)
app.get("/api/situation/analysis", async (req, res) => {
  try {
    const { role, forceRefresh, cacheOnly } = req.query;

    if (!role) {
      return res.status(400).json({ ok: false, error: "role Parameter fehlt" });
    }

    // Bei cacheOnly=true nur gecachte Daten zurückgeben (keine neue Analyse)
    if (cacheOnly === "true" && forceRefresh !== "true") {
      const cached = getCachedAnalysisForRole(role);
      const timerStatus = getAnalysisTimerStatus();
      // Füge auch den Status hinzu ob gerade eine Analyse läuft + Timer-Info
      return res.json({
        ok: true,
        ...cached,
        analysisInProgress: timerStatus.analysisInProgress,
        timer: timerStatus
      });
    }

    const analysis = await analyzeForRole(role, forceRefresh === "true");

    if (analysis.error) {
      return res.status(analysis.isActive === false ? 503 : 400).json({
        ok: false,
        error: analysis.error,
        ...analysis
      });
    }

    res.json({ ok: true, ...analysis });
  } catch (err) {
    logError("Situationsanalyse Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Frage an KI stellen (blockiert bei laufender KI-Analyse)
app.post(
  "/api/situation/question",
  rateLimit(RateLimitProfiles.GENEROUS),
  createSituationQuestionHandler({ answerQuestion, logError, isAnalysisInProgress })
);

// Feedback zu Vorschlag speichern (binäres System)
// Bei "nicht hilfreich" wird der Vorschlag als dismissed gespeichert,
// sodass ähnliche Vorschläge in Zukunft nicht mehr angezeigt werden
app.post("/api/situation/suggestion/feedback", async (req, res) => {
  try {
    const {
      suggestionId,
      analysisId,
      helpful,
      userNotes,
      editedContent,
      userId,
      userRole,
      suggestionTitle,
      suggestionDescription,
      targetRole
    } = req.body || {};

    if (!suggestionId) {
      return res.status(400).json({ ok: false, error: "suggestionId fehlt" });
    }
    if (typeof helpful !== "boolean") {
      return res.status(400).json({ ok: false, error: "helpful (boolean) fehlt" });
    }

    const feedback = await saveSuggestionFeedback({
      suggestionId,
      analysisId,
      helpful,
      userNotes,
      editedContent,
      userId,
      userRole,
      suggestionTitle,
      suggestionDescription,
      targetRole
    });

    // SSE-Broadcast für Feedback
    broadcastSSE("suggestion_feedback", { feedback });

    res.json({ ok: true, feedback });
  } catch (err) {
    logError("Vorschlags-Feedback Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Feedback zu Frage/Antwort speichern (binäres System)
// Bei "Hilfreich" wird Frage+Antwort ins RAG gespeichert
// Bei "Nicht hilfreich" mit Korrektur wird die Korrektur gespeichert
app.post("/api/situation/question/feedback", async (req, res) => {
  try {
    const {
      questionId,
      question,  // Ursprüngliche Frage für RAG
      answer,    // Ursprüngliche Antwort für RAG (bei "Hilfreich")
      helpful,
      correction,
      userId,
      userRole
    } = req.body || {};

    if (!questionId) {
      return res.status(400).json({ ok: false, error: "questionId fehlt" });
    }
    if (typeof helpful !== "boolean") {
      return res.status(400).json({ ok: false, error: "helpful (boolean) fehlt" });
    }

    const feedback = await saveQuestionFeedback({
      questionId,
      question,
      answer,
      helpful,
      correction,
      userId,
      userRole
    });

    res.json({ ok: true, feedback });
  } catch (err) {
    logError("Fragen-Feedback Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// Rate-Limit Stats API (Admin)
// ============================================================

app.get("/api/admin/rate-limit-stats", rateLimit(RateLimitProfiles.ADMIN), (req, res) => {
  try {
    const stats = getRateLimitStats();
    res.json({ ok: true, stats });
  } catch (err) {
    logError("Rate-Limit-Stats Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// Server-Sent Events für Live-Updates
// ============================================================

// Speichert alle verbundenen SSE-Clients
const sseClients = new Set();
const sseHeartbeats = new Map();  // Map von res -> heartbeat interval

// SSE-Endpoint für Echtzeit-Updates
app.get("/api/events", (req, res) => {
  // SSE-Header setzen
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Für nginx
  res.flushHeaders();

  // Client registrieren
  sseClients.add(res);
  logInfo("SSE-Client verbunden", { clientCount: sseClients.size });

  // Initial-Status senden
  try {
    const status = getAuditStatus();
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);

    // Modell-Status senden
    const modelConfig = getActiveModelConfig();
    res.write(`event: model_status\ndata: ${JSON.stringify(modelConfig)}\n\n`);
  } catch {
    // Ignorieren wenn kein Audit aktiv
  }

  // Heartbeat alle 30 Sekunden (hält Verbindung offen)
  const heartbeat = setInterval(() => {
    // Prüfe ob Response noch beschreibbar ist
    if (!res.writable || res.destroyed) {
      clearInterval(heartbeat);
      sseHeartbeats.delete(res);
      sseClients.delete(res);
      return;
    }

    try {
      res.write(`: heartbeat\n\n`);
    } catch (err) {
      // Client disconnected - cleanup
      clearInterval(heartbeat);
      sseHeartbeats.delete(res);
      sseClients.delete(res);
    }
  }, 30000);

  // Speichere Heartbeat-Referenz
  sseHeartbeats.set(res, heartbeat);

  // Aufräumen bei Disconnect
  req.on("close", () => {
    const intervalId = sseHeartbeats.get(res);
    if (intervalId) {
      clearInterval(intervalId);
      sseHeartbeats.delete(res);
    }
    sseClients.delete(res);
    logInfo("SSE-Client getrennt", { clientCount: sseClients.size });
  });
});

/**
 * Sendet Event an alle verbundenen SSE-Clients
 * Kann von anderen Modulen verwendet werden
 * @param {string} eventType - Name des Events
 * @param {object} data - Daten die gesendet werden
 */
function broadcastSSE(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

  // Bereinige ungültige Clients während des Broadcasts
  const deadClients = [];

  for (const client of sseClients) {
    if (!client.writable || client.destroyed) {
      deadClients.push(client);
      continue;
    }

    try {
      client.write(message);
    } catch {
      // Client konnte nicht erreicht werden
      deadClients.push(client);
    }
  }

  // Entferne tote Clients
  for (const dead of deadClients) {
    const heartbeat = sseHeartbeats.get(dead);
    if (heartbeat) {
      clearInterval(heartbeat);
      sseHeartbeats.delete(dead);
    }
    sseClients.delete(dead);
  }
}

// Cleanup-Funktion für Server-Shutdown
function cleanupSSE() {
  logInfo("Cleanup: Schließe alle SSE-Clients", { count: sseClients.size });

  for (const client of sseClients) {
    try {
      const heartbeat = sseHeartbeats.get(client);
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      if (client.writable) {
        client.end();
      }
    } catch {
      // Ignoriere Fehler beim Cleanup
    }
  }

  sseClients.clear();
  sseHeartbeats.clear();
}

// Export für andere Module (z.B. sim_loop.js)
export { broadcastSSE, cleanupSSE };

// ============================================================
// Bootstrap & Server-Start
// ============================================================

async function bootstrap() {
  try {
    await initMemoryStore();
    logInfo("Memory-Store initialisiert");
  } catch (err) {
    logError("Fehler beim Initialisieren des Memory-Stores", {
      error: String(err)
    });
    process.exit(1);
  }

  // Situationsanalyse initialisieren
  try {
    await initSituationAnalyzer();
    // SSE-Callback registrieren um Clients zu benachrichtigen wenn Analyse fertig ist
    setOnAnalysisComplete((analysisResult) => {
      broadcastSSE("analysis_complete", analysisResult);
      logInfo("SSE: Analyse-Fertigstellung gebroadcastet", {
        analysisId: analysisResult.analysisId,
        roles: analysisResult.roles
      });
    });
    logInfo("Situationsanalyse-System initialisiert");
  } catch (err) {
    logError("Fehler beim Initialisieren der Situationsanalyse", {
      error: String(err)
    });
    // Nicht kritisch, weiter starten
  }

  // Geo-Index laden (async, blockiert nicht den Start)
  getGeoIndex().then(geoIndex => {
    geoIndex.getStats().then(stats => {
      logInfo("Geo-Index geladen", stats);
    });
  }).catch(err => {
    logError("Fehler beim Laden des Geo-Index", { error: String(err) });
  });

  // SSE-Broadcast für Statistik-Updates registrieren
  setStatisticsChangeCallback((statistics) => {
    broadcastSSE("statistics_update", { statistics });
  });

  setEventLoggedCallback((event) => {
    broadcastSSE("audit_event", event);
  });

  const PORT = process.env.CHATBOT_PORT || 3100;
  const HOST = process.env.CHATBOT_HOST || "0.0.0.0";
  app.listen(PORT, HOST, () => {
    logInfo(`Chatbot läuft auf http://${HOST}:${PORT} (GUI: /gui)`, null);
    logInfo("Verfügbare Endpoints:", {
      simulation: ["/api/sim/start", "/api/sim/pause", "/api/sim/step"],
      chat: ["/api/chat"],
      llm: ["/api/llm/models", "/api/llm/gpu", "/api/llm/test", "/api/llm/config", "/api/llm/model", "/api/llm/profiles"],
      audit: ["/api/audit/status", "/api/audit/start", "/api/audit/end", "/api/audit/list"],
      templates: ["/api/templates"],
      disaster: ["/api/disaster/current", "/api/disaster/summary", "/api/disaster/init"],
      feedback: ["/api/feedback", "/api/feedback/list", "/api/feedback/stats"],
      situation: ["/api/situation/status", "/api/situation/analysis", "/api/situation/question"],
      sse: ["/api/events"]
    });
    
    // Modell-Konfiguration beim Start loggen
    const activeModel = getActiveModelConfig();
    logInfo("LLM-Konfiguration:", {
      activeModel: activeModel.key,
      mode: activeModel.mode,
      taskModels: CONFIG.llm.taskModels
    });
    
    // Verfügbare Modelle prüfen
    checkConfiguredModels().then(status => {
      if (status.missing.length > 0) {
        logInfo("WARNUNG: Fehlende Modelle", { 
          missing: status.missing.map(m => m.name) 
        });
      }
      logInfo("Installierte Modelle", { 
        count: status.installed.length,
        available: status.available.map(m => m.key)
      });
    }).catch(() => {
      // Ignorieren beim Start
    });
  });
}

bootstrap();

// ============================================================
// Graceful Shutdown
// ============================================================
process.on("SIGINT", () => {
  logInfo("SIGINT empfangen, fahre Server herunter...", null);
  cleanupSSE();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logInfo("SIGTERM empfangen, fahre Server herunter...", null);
  cleanupSSE();
  process.exit(0);
});
