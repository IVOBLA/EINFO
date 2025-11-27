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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamAnswer(res, answer) {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked"
  });

  const tokens = answer.match(/\S+|\s+/g) || [];
  for (const token of tokens) {
    res.write(token);
    await delay(60);
  }

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
    const answer = await callLLMForChat({ question });
    await streamAnswer(res, answer || "(keine Antwort)");
  } catch (err) {
    logError("Fehler im Chat-Endpoint", { error: String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.CHATBOT_PORT || 3100;
app.listen(PORT, () => {
  logInfo(`Chatbot läuft auf http://localhost:${PORT} (GUI: /gui)`, null);
});
