import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logError } from "../../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, "experimental_config.json");

let cachedConfig = null;

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    cachedConfig = JSON.parse(raw);
  } catch (error) {
    logError("Experimental ScenarioPack: Konfiguration konnte nicht geladen werden", {
      error: String(error)
    });
    cachedConfig = {};
  }
  return cachedConfig;
}

export function getExperimentalConfig() {
  return loadConfig();
}
