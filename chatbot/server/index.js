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

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientDir = path.resolve(__dirname, "../client");
app.use("/gui", express.static(clientDir));

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

// Chat nur wenn Simulation pausiert
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

app.get("/api/llm/models", async (_req, res) => {
  try {
    const models = await listAvailableLlmModels();
    res.json({ ok: true, models });
  } catch (err) {
    logError("Fehler beim Laden der LLM-Modelle", { error: String(err) });
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
  });
}

bootstrap();
