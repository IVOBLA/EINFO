import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { startSimulation, pauseSimulation, stepSimulation } from "./sim_loop.js";
import { exportScenario, getCurrentState } from "./state_store.js";
import { logInfo } from "./logger.js";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GUI statisch ausliefern
const clientDir = path.resolve(__dirname, "../client");
app.use("/gui", express.static(clientDir));

app.post("/api/sim/start", async (req, res) => {
  const { scenarioConfigOverride } = req.body || {};
  await startSimulation(scenarioConfigOverride);
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

app.get("/api/state", (req, res) => {
  res.json(getCurrentState());
});

app.get("/api/export", (req, res) => {
  const exportData = exportScenario();
  res.json(exportData);
});

const PORT = process.env.CHATBOT_PORT || 3100;
app.listen(PORT, () => {
  logInfo(`Chatbot läuft auf http://localhost:${PORT} (GUI: /gui)`);
});
