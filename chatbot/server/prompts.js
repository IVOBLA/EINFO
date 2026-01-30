// chatbot/server/prompts.js
// Zentrale Prompt-Definition für den EINFO-Chatbot (Simulationsmodus / Operations)
//
// Ziel:
// - möglichst robuste, kompakte Prompts
// - klare JSON-Constraints
// - erste Initialisierung (firstStep) explizit geregelt

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildScenarioControlSummary,
  buildPhaseRequirementsSummary,
  buildCompactScenarioControl,
  getScenarioMinutesPerStep
} from "./scenario_controls.js";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.join(__dirname, "prompt_templates");
const USE_EXPERIMENTAL_PROMPTS = process.env.EINFO_EXPERIMENTAL_SCENARIOPACK === "1";

function resolveExperimentalTemplateName(fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  return `${base}_experimental${ext}`;
}

export function loadPromptTemplate(fileName) {
  let resolvedName = fileName;
  if (USE_EXPERIMENTAL_PROMPTS) {
    const experimentalName = resolveExperimentalTemplateName(fileName);
    const experimentalPath = path.join(TEMPLATE_DIR, experimentalName);
    if (fs.existsSync(experimentalPath)) {
      resolvedName = experimentalName;
    }
  }
  const fullPath = path.join(TEMPLATE_DIR, resolvedName);
  return fs.readFileSync(fullPath, "utf8").trim();
}

export function fillTemplate(template, replacements) {
  return Object.entries(replacements).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{{${key}}}`, value);
  }, template);
}

// ============================================================
// Template Loading (einmalig beim Modulstart)
// ============================================================
const defaultStartSystemPrompt = loadPromptTemplate("start_system_prompt.txt");
const operationsSystemPrompt = loadPromptTemplate("operations_system_prompt.txt");
const operationsUserPromptTemplate = loadPromptTemplate("operations_user_prompt.txt");
const startUserPromptTemplate = loadPromptTemplate("start_user_prompt.txt");
const chatSystemPromptTemplate = loadPromptTemplate("chat_system_prompt.txt");
const chatUserPromptTemplate = loadPromptTemplate("chat_user_prompt.txt");

// NEU: Task-Abschnitt Templates
const taskSectionFirstStep = loadPromptTemplate("task_section_first_step.txt");
const taskSectionOperations = loadPromptTemplate("task_section_operations.txt");
const scenarioContextTemplate = loadPromptTemplate("scenario_context.txt");
// NEU: Offene Rückfragen Template
const openQuestionsGuideTemplate = loadPromptTemplate("open_questions_guide.txt");
// NEU: Initial Board Section Template
const initialBoardSectionTemplate = loadPromptTemplate("initial_board_section.txt");

// JSON-Reparatur Prompt (wird von llm_client.js verwendet)
export const jsonRepairSystemPrompt = loadPromptTemplate("json_repair_system.txt");

/**
 * System-Prompt:
 * - Rollenlogik (activeRoles)
 * - Meldestelle-Pflicht
 * - Operations-Schema
 * - Kompaktheit / JSON-Disziplin
 */
export function buildSystemPrompt() {
  // Erinnerungen werden NUR im User-Prompt gesendet (via {{formattedMemorySnippets}})
  // um Redundanz zu vermeiden
  return operationsSystemPrompt;
}

/**
 * User-Prompt:
 * - Übergibt Rollen, kompaktes Board/Aufgaben/Protokoll und KnowledgeContext.
 * - Beschreibt ganz knapp die Aufgabe im aktuellen Schritt.
 */
export function buildUserPrompt({
  llmInput,
  compressedBoard,
  compressedAufgaben,
  compressedProtokoll,
  knowledgeContext,
  memorySnippets,
  openQuestions = null,      // NEU: Offene Rückfragen
  disasterContext = "",      // NEU
  learnedResponses = "",     // NEU
  scenario = null,
  allowPlaceholders = true
}) {
  const safeMemorySnippets = Array.isArray(memorySnippets)
    ? memorySnippets
    : [];
  // Dedupliziere Memory-Snippets
  const uniqueSnippets = [...new Set(safeMemorySnippets)];
  const formattedMemorySnippets =
    uniqueSnippets.length > 0
      ? uniqueSnippets.map((m) => `- ${m}`).join("\n")
      : "";
  const rolesPart = JSON.stringify(
    { active: llmInput.roles?.active || [] },
    null,
    2
  );

  // Phase Requirements für den aktuellen Schritt
  const phaseRequirements = buildPhaseRequirementsSummary({
    scenario,
    elapsedMinutes: llmInput.elapsedMinutes || 0
  });

  // Task-Section basierend auf Szenario-Zustand wählen und füllen
  let taskSection;
  if (llmInput.firstStep) {
    // Für ersten Schritt: initiale Einsatzstellen extrahieren
    let initialBoardSection = "";
    if (scenario) {
      const allItems = [];
      const board = scenario.initial_state?.board;
      if (board?.columns) {
        for (const column of Object.values(board.columns)) {
          if (Array.isArray(column.items)) {
            allItems.push(...column.items);
          }
        }
      } else if (Array.isArray(board)) {
        for (const column of board) {
          if (Array.isArray(column?.items)) {
            allItems.push(...column.items);
          }
        }
      }
      if (allItems.length > 0) {
        const initialBoardItems = allItems.map(item =>
          `  - ${item.humanId || item.id}: ${item.content} (${item.ort || "Ort unbekannt"})
    Typ: ${item.typ || "Unbekannt"}
    Beschreibung: ${item.description || ""}`
        ).join("\n");

        initialBoardSection = fillTemplate(initialBoardSectionTemplate, {
          initialBoardItems
        });
      }
    }
    taskSection = fillTemplate(taskSectionFirstStep, { initialBoardSection });
  } else {
    // Für normale Operations: phaseRequirements einfügen
    taskSection = fillTemplate(taskSectionOperations, { phaseRequirements });
  }

  // Formatiere offene Rückfragen (kompakt)
  let openQuestionsSection = "";
  if (openQuestions && openQuestions.length > 0) {
    openQuestionsSection = "\n\n" + openQuestionsGuideTemplate + "\n\n";
    for (let i = 0; i < openQuestions.length; i++) {
      const q = openQuestions[i];
      const recipients = Array.isArray(q.ergehtAn) ? q.ergehtAn.join(", ") : q.ergehtAn || "";
      openQuestionsSection += `[FRAGE ${i + 1}] Nr.${q.nr || "?"} ${q.datum || ""} ${q.zeit || ""}\n`;
      openQuestionsSection += `bezugNr (Pflicht für Rueckmeldung): ${q.nr || "?"}\n`;
      openQuestionsSection += `Von: ${q.anvon} | An: ${recipients}`;
      if (q.externalRecipients?.length > 0) {
        openQuestionsSection += ` | EXTERN: ${q.externalRecipients.join(", ")}`;
      }
      openQuestionsSection += `\nTyp: ${q.infoTyp} | "${q.information}"\n`;
      openQuestionsSection += `Antwort VON: ${recipients} AN: ${q.anvon} (infoTyp: Rueckmeldung)\n\n`;
    }
  }

  // OPTIMIERUNG: Kompakte Szenario-Steuerung mit nur aktuellen Informationen
  // statt vollständigem Szenario-Verlauf (spart signifikant Tokens)
  const minutesPerStep = getScenarioMinutesPerStep(scenario, 5);
  const compactControl = buildCompactScenarioControl({
    scenario,
    elapsedMinutes: llmInput.elapsedMinutes || 0,
    minutesPerStep
  });
  const scenarioControlText =
    USE_EXPERIMENTAL_PROMPTS && typeof llmInput.scenarioControl === "string" && llmInput.scenarioControl.trim().length > 0
      ? llmInput.scenarioControl
      : compactControl;
  const llmProtokollMin = llmInput.llmProtokollMin ?? "";
  const llmProtokollMax = llmInput.llmProtokollMax ?? "";

  const includeBoard = typeof compressedBoard === "string" && compressedBoard.trim().length > 0;
  const template = includeBoard
    ? operationsUserPromptTemplate
    : operationsUserPromptTemplate.replace(/\nEINSATZSTELLEN:\n\{\{compressedBoard\}\}\n\n/, "\n");

  return fillTemplate(template, {
    rolesPart,
    compressedBoard: includeBoard ? compressedBoard : "",
    compressedAufgaben,
    compressedProtokoll,
    formattedMemorySnippets,
    knowledgeContext: knowledgeContext || "",
    taskSection,
    openQuestionsSection,
    disasterContext: disasterContext || "",
    learnedResponses: learnedResponses || "",
    scenarioControl: scenarioControlText,
    "scenarioControl.llm_protokoll_min": llmProtokollMin,
    "scenarioControl.llm_protokoll_max": llmProtokollMax
  });
}

// ----------------------------------------------------------
// Spezieller Start-Prompt für den ALLERERSTEN Simulationsschritt
// (wird bei llmInput.firstStep über llm_client.js verwendet)
// ----------------------------------------------------------
export function buildStartPrompts({ roles, scenario = null, allowScenarioFallback = true } = {}) {
  const rolesJson = JSON.stringify({ active: roles?.active || [] }, null, 2);
  const systemPrompt = defaultStartSystemPrompt.trim();

  // NEU: Wenn ein Szenario vorhanden ist, dieses in den Prompt einbauen
  let scenarioContext = "";
  let initialBoardSection = "";
  let scenarioHints = "";
  let scenarioControl = "";

  if (scenario) {
    const ctx = scenario.scenario_context || {};
    // Szenario-Kontext aus Template generieren
    scenarioContext = fillTemplate(scenarioContextTemplate, {
      title: scenario.title || "Unbekannt",
      eventType: ctx.event_type || "Katastrophe",
      region: ctx.region || "Bezirk Feldkirchen",
      weather: ctx.weather || "",
      initialSituation: ctx.initial_situation || "",
      affectedAreas: (ctx.affected_areas || []).map(a => `  - ${a}`).join("\n") || "  (keine angegeben)",
      specialConditions: (ctx.special_conditions || []).map(c => `  - ${c}`).join("\n") || "  (keine angegeben)"
    });

    // Initiale Einsatzstellen aus dem Szenario extrahieren
    const allItems = [];
    const board = scenario.initial_state?.board;
    if (board?.columns) {
      for (const column of Object.values(board.columns)) {
        if (Array.isArray(column.items)) {
          allItems.push(...column.items);
        }
      }
    } else if (Array.isArray(board)) {
      for (const column of board) {
        if (Array.isArray(column?.items)) {
          allItems.push(...column.items);
        }
      }
    }
    if (allItems.length > 0) {
      const initialBoardItems = allItems.map(item =>
        `  - ${item.humanId || item.id}: ${item.content} (${item.ort || "Ort unbekannt"})
    Typ: ${item.typ || "Unbekannt"}
    Beschreibung: ${item.description || ""}`
      ).join("\n");

      initialBoardSection = fillTemplate(initialBoardSectionTemplate, {
        initialBoardItems
      });
    }

    // Hinweise aus dem Szenario
    if (scenario.hints && scenario.hints.length > 0) {
      scenarioHints = `
HINWEISE für dieses Szenario:
${scenario.hints.map(h => `  → ${h}`).join("\n")}`;
    }

    scenarioControl = buildScenarioControlSummary({
      scenario,
      elapsedMinutes: 0
    });
  }

  // Template mit Szenario-Kontext füllen
  const userPrompt = fillTemplate(startUserPromptTemplate, {
    rolesJson,
    scenarioContext: scenarioContext || (allowScenarioFallback ? "(Kein Szenario vorgegeben - erstelle ein realistisches Katastrophenszenario)" : ""),
    initialBoardSection: initialBoardSection || "",
    scenarioHints: scenarioHints || "",
    scenarioControl: scenarioControl || (allowScenarioFallback ? "(keine Szenario-Steuerung definiert)" : "")
  });

  return { systemPrompt, userPrompt };
}
// --------------------------------------------------------
// Chat-Modus: System- und User-Prompts
// --------------------------------------------------------

/**
 * System-Prompt für den normalen QA-Chat.
 * - Immer Deutsch
 * - Keine personenbezogenen Daten
 * - Fokus auf Richtlinie / E-31 / Feuerwehr-Kontext
 */
export function buildSystemPromptChat() {
  return chatSystemPromptTemplate;
}

/**
 * User-Prompt für den QA-Chat.
 * question: Originalfrage des Benutzers
 * knowledgeContext: zusammengesetzter Text aus RAG (kann leer sein)
 * disasterContext: Katastrophen-Kontext (NEU)
 * learnedResponses: Gelernte Antworten (NEU)
 */
export function buildUserPromptChat(question, knowledgeContext, disasterContext = "", learnedResponses = "") {
  return fillTemplate(chatUserPromptTemplate, {
    question,
    knowledgeContext: knowledgeContext || "(kein KnowledgeContext verfügbar)",
    disasterContext: disasterContext || "(kein Katastrophen-Kontext verfügbar)",
    learnedResponses: learnedResponses || "(keine gelernten Antworten verfügbar)"
  });
}
