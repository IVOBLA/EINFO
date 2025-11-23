import fsPromises from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDirAbs = path.resolve(__dirname, CONFIG.dataDir);

const FILES = {
  scenarioConfig: "scenario_config.json",
  stabMessages: "stab_messages_in.json",
  lageInputs: "lage_in.json",
  chatbotEventsOut: "chatbot_events_out.json",
  chatbotIncidentsOut: "chatbot_incidents_out.json"
};

async function safeReadJson(filePath, defaultValue) {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      logError(`Fehler beim Lesen von ${filePath}`, { error: String(err) });
    }
    return defaultValue;
  }
}

async function safeWriteJson(filePath, data) {
  try {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    logError(`Fehler beim Schreiben von ${filePath}`, { error: String(err) });
  }
}

export async function readEinfoInputs() {
  const scenarioConfigPath = path.join(dataDirAbs, FILES.scenarioConfig);
  const stabMessagesPath = path.join(dataDirAbs, FILES.stabMessages);
  const lageInputsPath = path.join(dataDirAbs, FILES.lageInputs);

  const [scenarioConfig, stabMessages, lageInputs] = await Promise.all([
    safeReadJson(scenarioConfigPath, null),
    safeReadJson(stabMessagesPath, []),
    safeReadJson(lageInputsPath, [])
  ]);

  logDebug("EINFO-Inputs gelesen", {
    scenarioConfigPresent: !!scenarioConfig,
    stabMessagesCount: stabMessages.length || 0,
    lageInputsCount: lageInputs.length || 0
  });

  return {
    scenarioConfig,
    stabMessages,
    lageInputs
  };
}

export async function writeChatbotOutputs({ chatbotEvents, chatbotIncidents }) {
  const eventsPath = path.join(dataDirAbs, FILES.chatbotEventsOut);
  const incidentsPath = path.join(dataDirAbs, FILES.chatbotIncidentsOut);

  const existingEvents = fs.existsSync(eventsPath)
    ? await safeReadJson(eventsPath, [])
    : [];
  const existingIncidents = fs.existsSync(incidentsPath)
    ? await safeReadJson(incidentsPath, [])
    : [];

  const mergedEvents = [...existingEvents, ...(chatbotEvents || [])];
  const mergedIncidents = [...existingIncidents, ...(chatbotIncidents || [])];

  await Promise.all([
    safeWriteJson(eventsPath, mergedEvents),
    safeWriteJson(incidentsPath, mergedIncidents)
  ]);

  logDebug("Chatbot-Outputs geschrieben", {
    newEvents: chatbotEvents?.length || 0,
    newIncidents: chatbotIncidents?.length || 0
  });
}
