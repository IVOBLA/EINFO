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
  getActiveScenario  // NEU: Szenario-Getter aus sim_loop
} from "./sim_loop.js";
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
import { logInfo, logError } from "./logger.js";
import { initMemoryStore } from "./memory_manager.js";
import { getGpuStatus } from "./gpu_status.js";
import { getGeoIndex } from "./rag/geo_search.js";

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
  setStatisticsChangeCallback
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

// ============================================================
// Imports für Situationsanalyse
// ============================================================
import {
  initSituationAnalyzer,
  isAnalysisActive,
  getAnalysisStatus,
  analyzeForRole,
  answerQuestion,
  saveSuggestionFeedback,
  saveQuestionFeedback,
  syncAnalysisLoop
} from "./situation_analyzer.js";

import fs from "fs/promises";

// ============================================================
// Szenarien-Verwaltung
// ============================================================
const SCENARIOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "scenarios");

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
  getDisasterContextSummary,
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

  await callLLMForChat({
    question,
    stream: true,
    onToken: (token) => res.write(token)
  });

  res.end();
}

// ============================================================
// Express-App Setup
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

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
    const { scenarioId } = req.body || {};
    let scenario = null;

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

    // NEU: Szenario wird jetzt an startSimulation übergeben und in sim_loop.js verwaltet
    await startSimulation(scenario);

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

app.post("/api/sim/pause", (req, res) => {
  pauseSimulation();
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

app.post("/api/llm/test", rateLimit(RateLimitProfiles.STRICT), async (req, res) => {
  const { question, model } = req.body || {};
  const gpuStatus = await getGpuStatus();

  if (!question || typeof question !== "string") {
    return res.status(400).json({ ok: false, error: "missing_question", gpuStatus });
  }

  if (!model || typeof model !== "string") {
    return res.status(400).json({ ok: false, error: "missing_model", gpuStatus });
  }

  try {
    const models = await listAvailableLlmModels();
    if (!models.includes(model)) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_model", gpuStatus });
    }

    const answer = await callLLMForChat({ question, model });
    res.json({ ok: true, answer, gpuStatus });
  } catch (err) {
    logError("Fehler im LLM-Test-Endpunkt", { error: String(err) });
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
    const { exerciseId, filters } = req.body || {};
    const events = await getFilteredEvents(exerciseId, filters);
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

// Disaster Context Summary abrufen (immer aktuelle EINFO-Daten)
app.get("/api/disaster/summary", async (req, res) => {
  try {
    const { maxLength } = req.query;
    const summary = await getDisasterContextSummary({
      maxLength: maxLength ? parseInt(maxLength, 10) : 1500
    });
    res.json({ ok: true, summary });
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

// Status der Situationsanalyse
app.get("/api/situation/status", (req, res) => {
  try {
    const status = getAnalysisStatus();
    res.json({ ok: true, ...status });
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
app.get("/api/situation/analysis", async (req, res) => {
  try {
    const { role, forceRefresh } = req.query;

    if (!role) {
      return res.status(400).json({ ok: false, error: "role Parameter fehlt" });
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

// Frage an KI stellen
app.post("/api/situation/question", rateLimit(RateLimitProfiles.GENEROUS), async (req, res) => {
  try {
    const { question, role, context } = req.body || {};

    if (!question) {
      return res.status(400).json({ ok: false, error: "question fehlt" });
    }
    if (!role) {
      return res.status(400).json({ ok: false, error: "role fehlt" });
    }

    const answer = await answerQuestion(question, role, context || "aufgabenboard");

    if (answer.error) {
      return res.status(answer.isActive === false ? 503 : 500).json({
        ok: false,
        ...answer
      });
    }

    res.json({ ok: true, ...answer });
  } catch (err) {
    logError("Situationsfrage Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Feedback zu Vorschlag speichern (binäres System)
app.post("/api/situation/suggestion/feedback", async (req, res) => {
  try {
    const {
      suggestionId,
      analysisId,
      helpful,
      userNotes,
      editedContent,
      userId,
      userRole
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
      userRole
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
