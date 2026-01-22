import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIRED_FIELDS = [
  "metadaten",
  "zeit",
  "standard",
  "akteure",
  "welt",
  "ressourcen",
  "umwelt",
  "verlauf",
  "npc_agenten",
  "regeln",
  "startzustand",
  "fragen_init"
];

function assertRequiredFields(payload) {
  const missing = REQUIRED_FIELDS.filter((field) => !(field in payload));
  if (missing.length > 0) {
    throw new Error(`Szenario-JSON fehlt Pflichtfelder: ${missing.join(", ")}`);
  }
}

function normalizeScenario(raw) {
  const zeit = raw.zeit || {};
  const schritt = Number(zeit.schritt_minuten || 5);
  const dauer = Number(zeit.dauer_stunden || 6);
  const takte = Number(zeit.takte || Math.round((dauer * 60) / schritt));

  return {
    ...raw,
    zeit: {
      ...zeit,
      schritt_minuten: schritt,
      dauer_stunden: dauer,
      takte
    }
  };
}

export async function loadScenarioFromFile(relativePath) {
  const filePath = path.resolve(__dirname, "..", relativePath);
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  assertRequiredFields(parsed);
  return normalizeScenario(parsed);
}

export function assertScenarioStructure(scenario) {
  assertRequiredFields(scenario);
  return normalizeScenario(scenario);
}
