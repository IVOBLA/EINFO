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
import { callLLMForChat } from "./llm_client.js";
import { logInfo, logError } from "./logger.js";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientDir = path.resolve(__dirname, "../client");
app.use("/gui", express.static(clientDir));

app.post("/api/sim/start", async (req, res) => {
  await startSimulation();
  res.json({ ok: true });
});

app.post("/api/sim/pause", (req, res) => {
  pauseSimulation();
  res.json({ ok: true });
});

app.post("/api/sim/step", async (req, res) => {
  const options = req.body || {};
  const result = await stepSimulation(options);
  res.json(result);
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
    const answer = await callLLMForChat({ question });
    res.json({ ok: true, answer });
  } catch (err) {
    logError("Fehler im Chat-Endpoint", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.CHATBOT_PORT || 3100;
app.listen(PORT, () => {
  logInfo(`Chatbot läuft auf http://localhost:${PORT} (GUI: /gui)`, null);
});
