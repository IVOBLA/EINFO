// chatbot/server/index.js

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import {
  startSimulation,
  pauseSimulation,
  stepSimulation,
  isSimulationRunning
} from "./sim_loop.js";
import { callLLMForChat, listAvailableLlmModels } from "./llm_client.js";
import { logInfo, logError } from "./logger.js";
import { initMemoryStore } from "./memory_manager.js";
import { getGpuStatus } from "./gpu_status.js";

// ============================================================
// NEU: Imports für Audit-Trail und Templates
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
  logEvent
} from "./audit_trail.js";

import {
  loadAllTemplates,
  loadTemplate,
  saveTemplate,
  deleteTemplate,
  validateTemplate,
  createExerciseFromTemplate
} from "./template_manager.js";

// ============================================================
// NEU: Imports für Disaster Context und LLM Feedback
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
app.use("/gui", express.static(clientDir));

// Dashboard-Route
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(clientDir, "dashboard.html"));
});

// ============================================================
// Bestehende Simulations-Routen
// ============================================================

app.post("/api/sim/start", async (req, res) => {
  try {
    await startSimulation();
    res.json({ ok: true });
  } catch (err) {
    logError("Fehler beim Starten der Simulation", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
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

app.post("/api/chat", async (req, res) => {
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

app.post("/api/llm/test", async (req, res) => {
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
// NEU: API-Routen für Audit-Trail (Übungs-Protokollierung)
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
      statistics: result.statistics 
    });
    
    res.json({ ok: true, result });
  } catch (err) {
    logError("Übung beenden fehlgeschlagen", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung pausieren
app.post("/api/audit/pause", (req, res) => {
  try {
    const success = pauseExercise();
    if (success) {
      broadcastSSE("exercise_paused", { timestamp: Date.now() });
    }
    res.json({ ok: success });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung fortsetzen
app.post("/api/audit/resume", (req, res) => {
  try {
    const success = resumeExercise();
    if (success) {
      broadcastSSE("exercise_resumed", { timestamp: Date.now() });
    }
    res.json({ ok: success });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Alle vergangenen Übungen auflisten
app.get("/api/audit/list", async (req, res) => {
  try {
    const trails = await listAuditTrails();
    res.json({ ok: true, trails });
  } catch (err) {
    logError("Audit-Liste Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Live-Events der aktuellen Übung abrufen (mit Filter)
app.get("/api/audit/events", (req, res) => {
  try {
    const { category, since, limit } = req.query;
    const events = getFilteredEvents({
      category: category || undefined,
      since: since || undefined,
      limit: limit ? parseInt(limit, 10) : undefined
    });
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Einzelne vergangene Übung laden (für Nachbesprechung)
app.get("/api/audit/:exerciseId", async (req, res) => {
  try {
    const { exerciseId } = req.params;
    if (!exerciseId) {
      return res.status(400).json({ ok: false, error: "exerciseId fehlt" });
    }
    const trail = await loadAuditTrail(exerciseId);
    if (!trail) {
      return res.status(404).json({ ok: false, error: "Übung nicht gefunden" });
    }
    res.json({ ok: true, trail });
  } catch (err) {
    logError("Audit laden Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung löschen
app.delete("/api/audit/:exerciseId", async (req, res) => {
  try {
    const { exerciseId } = req.params;
    const success = await deleteAuditTrail(exerciseId);
    res.json({ ok: success });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// NEU: API-Routen für Übungs-Templates (Szenarien)
// ============================================================

// Alle Templates auflisten
app.get("/api/templates", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "true";
    const templates = await loadAllTemplates(forceRefresh);
    res.json({ ok: true, templates });
  } catch (err) {
    logError("Templates laden Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Einzelnes Template laden (vollständig mit initial_state, triggers, etc.)
app.get("/api/templates/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    if (!templateId) {
      return res.status(400).json({ ok: false, error: "templateId fehlt" });
    }
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

// Neues Template speichern oder bestehendes aktualisieren
app.post("/api/templates", async (req, res) => {
  try {
    const template = req.body;
    if (!template) {
      return res.status(400).json({ ok: false, error: "Template-Daten fehlen" });
    }
    
    // Validierung
    const validation = validateTemplate(template);
    if (!validation.valid) {
      return res.status(400).json({ 
        ok: false, 
        error: "Validierungsfehler", 
        details: validation.errors 
      });
    }
    
    await saveTemplate(template);
    logInfo("Template gespeichert", { id: template.id });
    res.json({ ok: true, id: template.id });
  } catch (err) {
    logError("Template speichern Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Template löschen
app.delete("/api/templates/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    const success = await deleteTemplate(templateId);
    if (!success) {
      return res.status(404).json({ ok: false, error: "Template nicht gefunden" });
    }
    logInfo("Template gelöscht", { id: templateId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Übung aus Template erstellen (kopiert initial_state)
app.post("/api/templates/:templateId/create-exercise", async (req, res) => {
  try {
    const { templateId } = req.params;
    const exercise = await createExerciseFromTemplate(templateId);
    if (!exercise) {
      return res.status(404).json({ ok: false, error: "Template nicht gefunden" });
    }
    res.json({ ok: true, exercise });
  } catch (err) {
    logError("Übung aus Template erstellen Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================
// NEU: API-Routen für Disaster Context
// ============================================================

// Disaster Context initialisieren
app.post("/api/disaster/init", async (req, res) => {
  try {
    const { type, description, scenario } = req.body || {};
    const context = await initializeDisasterContext({
      type,
      description,
      scenario
    });
    logInfo("Disaster Context initialisiert", { disasterId: context.disasterId });
    broadcastSSE("disaster_started", { disasterId: context.disasterId, type });
    res.json({ ok: true, context });
  } catch (err) {
    logError("Disaster Context Init Fehler", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Aktuellen Disaster Context abrufen
app.get("/api/disaster/current", (req, res) => {
  try {
    const context = getCurrentDisasterContext();
    if (!context) {
      return res.status(404).json({ ok: false, error: "Kein aktiver Disaster Context" });
    }
    res.json({ ok: true, context });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Disaster Context Summary abrufen (für LLM-Prompts)
app.get("/api/disaster/summary", (req, res) => {
  try {
    const { maxLength } = req.query;
    const summary = getDisasterContextSummary({
      maxLength: maxLength ? parseInt(maxLength, 10) : 1500
    });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Alle Disaster Contexts auflisten
app.get("/api/disaster/list", async (req, res) => {
  try {
    const contexts = await listDisasterContexts();
    res.json({ ok: true, contexts });
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
// NEU: API-Routen für LLM Feedback & Learning
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
// NEU: Server-Sent Events für Live-Updates
// ============================================================

// Speichert alle verbundenen SSE-Clients
const sseClients = new Set();

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
  } catch {
    // Ignorieren wenn kein Audit aktiv
  }
  
  // Heartbeat alle 30 Sekunden (hält Verbindung offen)
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      // Client disconnected
    }
  }, 30000);
  
  // Aufräumen bei Disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    logInfo("SSE-Client getrennt", { clientCount: sseClients.size });
  });
});

/**
 * Sendet Event an alle verbundenen SSE-Clients
 * Kann von anderen Modulen verwendet werden
 * @param {string} eventType - Name des Events (z.B. "exercise_started", "step_complete")
 * @param {object} data - Daten die gesendet werden
 */
function broadcastSSE(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      // Client wird beim nächsten Heartbeat entfernt
    }
  }
}

// Export für andere Module (z.B. sim_loop.js)
export { broadcastSSE };

// ============================================================
// Bootstrap & Server-Start
// ============================================================

async function bootstrap() {
  try {
    await initMemoryStore();
  } catch (err) {
    logError("Fehler beim Initialisieren des Memory-Stores", {
      error: String(err)
    });
    process.exit(1);
  }

  const PORT = process.env.CHATBOT_PORT || 3100;
  app.listen(PORT, () => {
    logInfo(`Chatbot läuft auf http://localhost:${PORT} (GUI: /gui)`, null);
    logInfo("Verfügbare Endpoints:", {
      simulation: ["/api/sim/start", "/api/sim/pause", "/api/sim/step"],
      chat: ["/api/chat"],
      llm: ["/api/llm/models", "/api/llm/gpu", "/api/llm/test"],
      audit: ["/api/audit/status", "/api/audit/start", "/api/audit/end", "/api/audit/list"],
      templates: ["/api/templates"],
      sse: ["/api/events"]
    });
  });
}

bootstrap();

