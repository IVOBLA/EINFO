// chatbot/server/template_manager.js
// Verwaltung von Übungs-Szenarien

import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { logDebug, logError } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCENARIOS_DIR = path.join(__dirname, "scenarios");

let cachedTemplates = null;

/**
 * Lädt alle verfügbaren Templates
 */
export async function loadAllTemplates() {
  try {
    await fsPromises.mkdir(SCENARIOS_DIR, { recursive: true });
    const files = await fsPromises.readdir(SCENARIOS_DIR);
    const templates = [];
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      
      try {
        const content = await fsPromises.readFile(
          path.join(SCENARIOS_DIR, file),
          "utf8"
        );
        const template = JSON.parse(content);
        
        // Validierung
        if (!template.id || !template.title) {
          logError("Template ungültig - id oder title fehlt", { file });
          continue;
        }
        
        templates.push({
          id: template.id,
          title: template.title,
          description: template.description || "",
          difficulty: template.difficulty || "medium",
          duration_minutes: template.duration_minutes || 60,
          mode: template.mode || "free",
          _fileName: file
        });
      } catch (err) {
        logError("Template laden fehlgeschlagen", { file, error: String(err) });
      }
    }
    
    cachedTemplates = templates;
    logDebug("Templates geladen", { count: templates.length });
    
    return templates;
  } catch (err) {
    logError("Scenarios-Verzeichnis Fehler", { error: String(err) });
    return [];
  }
}

/**
 * Lädt ein spezifisches Template
 */
export async function loadTemplate(templateId) {
  const filePath = path.join(SCENARIOS_DIR, `${templateId}.json`);
  
  try {
    const content = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    logError("Template nicht gefunden", { templateId, error: String(err) });
    return null;
  }
}

/**
 * Gibt gecachte Template-Liste zurück
 */
export function getTemplateList() {
  return cachedTemplates || [];
}

/**
 * Speichert ein neues Template
 */
export async function saveTemplate(template) {
  if (!template.id || !template.title) {
    throw new Error("Template muss id und title haben");
  }
  
  const filePath = path.join(SCENARIOS_DIR, `${template.id}.json`);
  
  await fsPromises.mkdir(SCENARIOS_DIR, { recursive: true });
  await fsPromises.writeFile(
    filePath,
    JSON.stringify(template, null, 2),
    "utf8"
  );
  
  // Cache invalidieren
  cachedTemplates = null;
  
  logDebug("Template gespeichert", { id: template.id });
  return true;
}
