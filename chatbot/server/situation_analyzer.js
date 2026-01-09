// chatbot/server/situation_analyzer.js
//
// Situationsanalyse-System: Generiert rollenspezifische Handlungsvorschläge
// basierend auf der aktuellen Lage (funktioniert unabhängig vom Simulationsstatus)

import fsPromises from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError, logInfo } from "./logger.js";
// isSimulationRunning nicht mehr benötigt - KI-Analyse ist immer verfügbar
import { getDisasterContextSummary, getCurrentDisasterContext } from "./disaster_context.js";
import { callLLMForChat } from "./llm_client.js";
import { saveFeedback, getLearnedResponsesContext } from "./llm_feedback.js";
import { embedText } from "./rag/embedding.js";
import { loadPromptTemplate, fillTemplate } from "./prompts.js";
import { getKnowledgeContextWithSources } from "./rag/rag_vector.js";
import { getCurrentSession } from "./rag/session_rag.js";

const __filename = fileURLToPath(import.meta.url);

// Prompt-Templates laden (einmalig beim Modulstart)
const situationAnalysisSystemTemplate = loadPromptTemplate("situation_analysis_system.txt");
const situationAnalysisUserTemplate = loadPromptTemplate("situation_analysis_user.txt");
const situationQuestionSystemTemplate = loadPromptTemplate("situation_question_system.txt");
const __dirname = path.dirname(__filename);

// Pfade für Analyse-Storage
const ANALYSIS_DIR = path.resolve(__dirname, "../../server/data/situation_analysis");
const LEARNED_SUGGESTIONS_FILE = path.resolve(ANALYSIS_DIR, "learned_suggestions.json");
const AI_ANALYSIS_CFG_FILE = path.resolve(__dirname, CONFIG.dataDir, "conf", "ai-analysis.json");
const AI_ANALYSIS_DEFAULT_INTERVAL_MINUTES = 5;
const AI_ANALYSIS_MIN_INTERVAL_MINUTES = 1;

// Rollen-Beschreibungen für kontextbezogene Analysen
const ROLE_DESCRIPTIONS = {
  "LTSTB": "Leiter Technischer Einsatzleitung - Gesamtverantwortung, strategische Entscheidungen, Koordination aller Stabsstellen",
  "S1": "Stabsstelle 1 - Personal und Innerer Dienst, Personalverwaltung, Verpflegung, Unterkunft",
  "S2": "Stabsstelle 2 - Lage, Lagebild, Lagekarte, Dokumentation, Auswertung",
  "S3": "Stabsstelle 3 - Einsatz, Taktische Planung, Einsatzführung, Ressourcensteuerung",
  "S4": "Stabsstelle 4 - Versorgung, Logistik, Material, Fahrzeuge, Nachschub",
  "S5": "Stabsstelle 5 - Presse und Medien, Öffentlichkeitsarbeit, Kommunikation nach außen",
  "S6": "Stabsstelle 6 - Kommunikation und IT, Fernmeldetechnik, Datenverarbeitung"
};

// In-Memory Cache
let analysisCache = new Map(); // role -> { timestamp, analysis }
let learnedSuggestions = [];
let cacheLoaded = false;

// Analyse-Intervall (Default: 5 Minuten)
let analysisIntervalMs = 5 * 60 * 1000;
let analysisIntervalId = null;

function sanitizeAnalysisIntervalMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < AI_ANALYSIS_MIN_INTERVAL_MINUTES) {
    return AI_ANALYSIS_DEFAULT_INTERVAL_MINUTES;
  }
  return Math.floor(parsed);
}

async function readAnalysisConfig() {
  try {
    const raw = await fsPromises.readFile(AI_ANALYSIS_CFG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled !== false,
      intervalMinutes: sanitizeAnalysisIntervalMinutes(parsed?.intervalMinutes)
    };
  } catch (err) {
    if (err?.code !== "ENOENT") {
      logError("Fehler beim Lesen der Analyse-Konfiguration", { error: String(err) });
    }
    return {
      enabled: true,
      intervalMinutes: AI_ANALYSIS_DEFAULT_INTERVAL_MINUTES
    };
  }
}

/**
 * Initialisiert das Situationsanalyse-System
 */
export async function initSituationAnalyzer() {
  try {
    await fsPromises.mkdir(ANALYSIS_DIR, { recursive: true });

    // Lade gelernte Vorschläge
    if (fs.existsSync(LEARNED_SUGGESTIONS_FILE)) {
      const raw = await fsPromises.readFile(LEARNED_SUGGESTIONS_FILE, "utf8");
      learnedSuggestions = JSON.parse(raw);
    } else {
      learnedSuggestions = [];
    }

    const cfg = await readAnalysisConfig();
    setAnalysisInterval(cfg.intervalMinutes);

    cacheLoaded = true;
    logInfo("Situationsanalyse-System initialisiert", {
      learnedSuggestionsCount: learnedSuggestions.length,
      analysisIntervalMinutes: cfg.intervalMinutes
    });
  } catch (err) {
    logError("Fehler beim Initialisieren des Situationsanalyse-Systems", {
      error: String(err)
    });
  }
}

/**
 * Prüft ob Situationsanalyse aktiv sein soll
 * (Immer aktiv - unabhängig vom Simulationsstatus)
 */
export function isAnalysisActive() {
  return true; // KI-Analyse ist immer verfügbar
}

/**
 * Gibt den Status der Situationsanalyse zurück
 */
export function getAnalysisStatus() {
  const roles = Object.keys(ROLE_DESCRIPTIONS);
  const rolesAnalyzed = [];

  for (const role of roles) {
    const cached = analysisCache.get(role);
    if (cached && (Date.now() - cached.timestamp) < analysisIntervalMs) {
      rolesAnalyzed.push(role);
    }
  }

  return {
    isActive: isAnalysisActive(),
    analysisInterval: analysisIntervalMs,
    lastAnalysisTimes: Object.fromEntries(
      Array.from(analysisCache.entries()).map(([role, data]) => [role, data.timestamp])
    ),
    rolesAnalyzed,
    learnedSuggestionsCount: learnedSuggestions.length
  };
}

/**
 * Setzt das Analyse-Intervall
 */
export function setAnalysisInterval(minutes) {
  const normalizedMinutes = sanitizeAnalysisIntervalMinutes(minutes);
  analysisIntervalMs = normalizedMinutes * 60 * 1000;
  logInfo("Analyse-Intervall geändert", { intervalMinutes: normalizedMinutes });

  if (analysisIntervalId) {
    clearInterval(analysisIntervalId);
    analysisIntervalId = null;
    startAnalysisLoop();
  }
}

/**
 * Holt gelernte Vorschläge für einen Kontext
 */
async function getLearnedSuggestionsForContext(role, contextSummary) {
  if (!learnedSuggestions.length) return [];

  // Filtere nach Rolle
  const roleSpecific = learnedSuggestions.filter(s => s.targetRole === role);
  if (!roleSpecific.length) return [];

  // Einfache Keyword-basierte Relevanz (ohne Embedding für Performance)
  const contextLower = contextSummary.toLowerCase();
  const relevant = roleSpecific
    .map(s => {
      const searchText = `${s.title} ${s.description} ${s.userNotes || ""}`.toLowerCase();
      const words = searchText.split(/\s+/).filter(w => w.length > 3);
      const matches = words.filter(w => contextLower.includes(w)).length;
      return { ...s, relevance: matches };
    })
    .filter(s => s.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3);

  return relevant;
}

/**
 * Führt eine Gesamtanalyse für ALLE Rollen in einem LLM-Aufruf durch
 * Effizienter und konsistenter als einzelne Aufrufe pro Rolle
 */
export async function analyzeAllRoles(forceRefresh = false) {
  if (!isAnalysisActive()) {
    return {
      error: "Analyse nicht aktiv (Simulation läuft)",
      isActive: false
    };
  }

  const now = Date.now();
  const roles = Object.keys(ROLE_DESCRIPTIONS);

  // Cache prüfen - wenn alle Rollen noch gültig sind, Cache zurückgeben
  if (!forceRefresh) {
    const allCached = roles.every(role => {
      const cached = analysisCache.get(role);
      return cached && (now - cached.timestamp) < analysisIntervalMs;
    });

    if (allCached) {
      const cachedResults = {};
      for (const role of roles) {
        cachedResults[role] = analysisCache.get(role).analysis;
      }
      return {
        fromCache: true,
        timestamp: analysisCache.get(roles[0]).timestamp,
        roles: cachedResults,
        nextAnalysisIn: analysisIntervalMs - (now - analysisCache.get(roles[0]).timestamp)
      };
    }
  }

  // Aktuellen Kontext holen (immer aktuelle EINFO-Daten)
  const disasterSummary = await getDisasterContextSummary({ maxLength: 2500 });

  // Gelernte Vorschläge sammeln
  const learnedByRole = {};
  for (const role of roles) {
    learnedByRole[role] = await getLearnedSuggestionsForContext(role, disasterSummary);
  }

  // Rollen-Beschreibungen für Prompt
  const rolesDescription = roles.map(r => `- ${r}: ${ROLE_DESCRIPTIONS[r]}`).join("\n");

  // LLM-Prompts aus Templates generieren
  const systemPrompt = fillTemplate(situationAnalysisSystemTemplate, {
    rolesDescription
  });

  const userPrompt = fillTemplate(situationAnalysisUserTemplate, {
    disasterSummary
  });

  try {
    logInfo("Starte Gesamtanalyse für alle Rollen");

    const llmResponse = await callLLMForChat(systemPrompt, userPrompt, {
      temperature: 0.3,
      maxTokens: 4000
    });

    // JSON parsen
    let parsed;
    try {
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Kein JSON gefunden");
      }
    } catch (parseErr) {
      logError("JSON-Parse-Fehler bei Gesamtanalyse", {
        error: String(parseErr),
        response: llmResponse.substring(0, 500)
      });
      return {
        error: "Analyse-Ergebnis konnte nicht verarbeitet werden",
        rawResponse: llmResponse.substring(0, 500)
      };
    }

    // Analyse-ID für diese Runde
    const analysisId = `analysis_${now}_${Math.random().toString(36).substr(2, 9)}`;
    const situation = parsed.situation || { summary: "Keine Zusammenfassung", severity: "medium", criticalFactors: [] };

    // Für jede Rolle Cache aktualisieren
    const results = {};
    for (const role of roles) {
      const roleSuggestions = parsed.rolesSuggestions?.[role] || [];

      const analysis = {
        analysisId,
        timestamp: now,
        role,
        situation,
        suggestions: roleSuggestions.map((s, i) => ({
          id: `sug_${now}_${role}_${i}`,
          analysisId,
          targetRole: role,
          ...s,
          status: "new",
          createdAt: now
        })),
        nextAnalysisIn: analysisIntervalMs
      };

      // In Cache speichern
      analysisCache.set(role, { timestamp: now, analysis });
      results[role] = analysis;
    }

    logInfo("Gesamtanalyse abgeschlossen", {
      roles: roles.length,
      totalSuggestions: Object.values(results).reduce((sum, r) => sum + r.suggestions.length, 0),
      severity: situation.severity
    });

    return {
      analysisId,
      timestamp: now,
      situation,
      roles: results,
      nextAnalysisIn: analysisIntervalMs
    };

  } catch (err) {
    logError("Fehler bei Gesamtanalyse", { error: String(err) });
    return {
      error: "Analyse fehlgeschlagen",
      details: String(err)
    };
  }
}

/**
 * Holt Analyse für eine spezifische Rolle (aus Cache oder triggert Gesamtanalyse)
 */
export async function analyzeForRole(role, forceRefresh = false) {
  if (!isAnalysisActive()) {
    return {
      error: "Analyse nicht aktiv (Simulation läuft)",
      isActive: false
    };
  }

  const normalizedRole = role.toUpperCase();
  if (!ROLE_DESCRIPTIONS[normalizedRole]) {
    return {
      error: `Unbekannte Rolle: ${role}`,
      validRoles: Object.keys(ROLE_DESCRIPTIONS)
    };
  }

  // Cache prüfen
  const cached = analysisCache.get(normalizedRole);
  const now = Date.now();
  if (!forceRefresh && cached && (now - cached.timestamp) < analysisIntervalMs) {
    return {
      ...cached.analysis,
      fromCache: true,
      cacheAge: now - cached.timestamp,
      nextAnalysisIn: analysisIntervalMs - (now - cached.timestamp)
    };
  }

  // Gesamtanalyse durchführen (analysiert alle Rollen auf einmal)
  const allResults = await analyzeAllRoles(forceRefresh);

  if (allResults.error) {
    return allResults;
  }

  // Ergebnis für die angeforderte Rolle zurückgeben
  return allResults.roles[normalizedRole] || {
    error: `Keine Analyse für Rolle ${normalizedRole} gefunden`
  };
}

/**
 * Beantwortet eine direkte Frage zur Lage
 * Nutzt RAG (Vector + Session) für fundierte Antworten mit Quellenangaben
 */
export async function answerQuestion(question, role, context = "aufgabenboard") {
  if (!isAnalysisActive()) {
    return {
      error: "Fragen nicht möglich (Simulation läuft)",
      isActive: false
    };
  }

  const normalizedRole = role.toUpperCase();
  const disasterSummary = await getDisasterContextSummary({ maxLength: 1500 });

  // RAG-Context holen (parallel für Performance)
  const [vectorRagResult, sessionContext] = await Promise.all([
    getKnowledgeContextWithSources(question, { topK: 3, maxChars: 1500 }),
    getCurrentSession().getContextForQuery(question, { maxChars: 1000, topK: 3 })
  ]);

  // RAG-Context zusammenbauen
  let ragContextSection = "";
  const allSources = [];

  if (vectorRagResult.context) {
    ragContextSection += "FACHLICHES WISSEN (Knowledge-Base):\n" + vectorRagResult.context + "\n\n";
    allSources.push(...vectorRagResult.sources.map(s => ({
      type: "knowledge",
      fileName: s.fileName,
      relevance: s.score,
      preview: s.preview
    })));
  }

  if (sessionContext) {
    ragContextSection += sessionContext;
    allSources.push({
      type: "session",
      fileName: "Aktuelle Einsatzdaten",
      relevance: 100,
      preview: "Live-Daten aus laufendem Einsatz"
    });
  }

  // System-Prompt aus Template generieren
  const systemPrompt = fillTemplate(situationQuestionSystemTemplate, {
    role: normalizedRole,
    roleDescription: ROLE_DESCRIPTIONS[normalizedRole] || "Stabsmitglied",
    disasterSummary,
    ragContext: ragContextSection
  });

  try {
    const answer = await callLLMForChat(systemPrompt, question, {
      temperature: 0.2,
      maxTokens: 500
    });

    const questionId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Confidence basierend auf RAG-Quellen berechnen
    const hasRagSources = allSources.length > 0;
    const avgRelevance = hasRagSources
      ? allSources.reduce((sum, s) => sum + s.relevance, 0) / allSources.length / 100
      : 0.5;
    const confidence = hasRagSources ? Math.min(0.95, 0.6 + avgRelevance * 0.35) : 0.6;

    logInfo("Frage mit RAG beantwortet", {
      questionId,
      role: normalizedRole,
      ragSourcesCount: allSources.length,
      confidence: confidence.toFixed(2)
    });

    return {
      questionId,
      question,
      answer: answer.trim(),
      sources: allSources,
      confidence,
      timestamp: Date.now(),
      role: normalizedRole,
      context,
      ragUsed: hasRagSources
    };

  } catch (err) {
    logError("Fehler bei Fragebeantwortung", {
      question,
      role: normalizedRole,
      error: String(err)
    });
    return {
      error: "Frage konnte nicht beantwortet werden",
      details: String(err)
    };
  }
}

/**
 * Speichert Feedback zu einem Vorschlag (binäres System)
 */
export async function saveSuggestionFeedback({
  suggestionId,
  analysisId,
  helpful,
  userNotes,
  editedContent,
  userId,
  userRole
}) {
  const feedbackId = `fb_sug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const feedbackData = {
    feedbackId,
    suggestionId,
    analysisId,
    helpful,
    userNotes: userNotes || "",
    editedContent: editedContent || null,
    userId: userId || "anonymous",
    userRole: userRole || "unknown",
    timestamp: Date.now()
  };

  // Bei "Hilfreich" -> In Learned Suggestions aufnehmen
  if (helpful) {
    await addLearnedSuggestion(feedbackData);
  }

  logInfo("Vorschlags-Feedback gespeichert", {
    feedbackId,
    suggestionId,
    helpful,
    hasEdits: !!editedContent
  });

  return feedbackData;
}

/**
 * Speichert Feedback zu einer Frage/Antwort (binäres System)
 * Bei Korrekturen wird das Session-RAG aktualisiert
 */
export async function saveQuestionFeedback({
  questionId,
  question,
  helpful,
  correction,
  userId,
  userRole
}) {
  const feedbackId = `fb_q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const feedbackData = {
    feedbackId,
    questionId,
    helpful,
    correction: correction || "",
    userId: userId || "anonymous",
    userRole: userRole || "unknown",
    timestamp: Date.now()
  };

  // Bei Korrektur und helpful=false -> Korrektur ins Session-RAG aufnehmen
  if (!helpful && correction) {
    try {
      const session = getCurrentSession();
      const correctionId = `correction_${feedbackId}`;

      // Korrektur als durchsuchbares Item ins Session-RAG aufnehmen
      const correctionText = question
        ? `Frage: ${question}\nKorrigierte Antwort: ${correction}`
        : correction;

      await session.add(correctionId, correctionText, {
        type: "correction",
        originalQuestionId: questionId,
        userId,
        userRole,
        source: "user_feedback"
      });

      logInfo("Korrektur ins Session-RAG aufgenommen", {
        feedbackId,
        questionId,
        correctionId
      });
    } catch (err) {
      logError("Fehler beim Speichern der Korrektur ins RAG", {
        feedbackId,
        error: String(err)
      });
    }
  }

  logInfo("Frage-Feedback gespeichert", {
    feedbackId,
    questionId,
    helpful,
    hasCorrection: !!correction
  });

  return feedbackData;
}

/**
 * Fügt einen hilfreichen Vorschlag zu den gelernten Vorschlägen hinzu
 */
async function addLearnedSuggestion(feedbackData) {
  // Finde den Original-Vorschlag aus dem Cache
  let originalSuggestion = null;
  for (const [role, cached] of analysisCache.entries()) {
    const found = cached.analysis.suggestions?.find(s => s.id === feedbackData.suggestionId);
    if (found) {
      originalSuggestion = { ...found, targetRole: role };
      break;
    }
  }

  if (!originalSuggestion) {
    logDebug("Original-Vorschlag nicht im Cache gefunden", { suggestionId: feedbackData.suggestionId });
    return;
  }

  const learnedSuggestion = {
    id: `learned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    originalSuggestionId: feedbackData.suggestionId,

    // Inhalt (ggf. bearbeitet)
    title: feedbackData.editedContent?.title || originalSuggestion.title,
    description: feedbackData.editedContent?.description || originalSuggestion.description,
    reasoning: originalSuggestion.reasoning,
    priority: originalSuggestion.priority,
    category: originalSuggestion.category,

    // Kontext
    targetRole: originalSuggestion.targetRole || feedbackData.userRole,

    // Feedback-Daten
    helpful: true,
    userNotes: feedbackData.userNotes,

    createdAt: Date.now()
  };

  learnedSuggestions.push(learnedSuggestion);

  // Persistieren
  try {
    await fsPromises.writeFile(
      LEARNED_SUGGESTIONS_FILE,
      JSON.stringify(learnedSuggestions, null, 2),
      "utf8"
    );
    logInfo("Gelernter Vorschlag gespeichert", {
      learnedId: learnedSuggestion.id,
      title: learnedSuggestion.title
    });
  } catch (err) {
    logError("Fehler beim Speichern gelernter Vorschläge", { error: String(err) });
  }
}

/**
 * Startet den automatischen Analyse-Loop
 * Analysiert alle Rollen in einem einzigen LLM-Aufruf
 */
export function startAnalysisLoop() {
  if (analysisIntervalId) {
    logDebug("Analyse-Loop läuft bereits");
    return;
  }

  analysisIntervalId = setInterval(async () => {
    if (!isAnalysisActive()) {
      logDebug("Analyse übersprungen (Simulation aktiv)");
      return;
    }

    logInfo("Starte automatische Situationsanalyse für alle Rollen");

    try {
      // Ein Aufruf für alle Rollen
      await analyzeAllRoles(true);
    } catch (err) {
      logError("Fehler bei automatischer Gesamtanalyse", { error: String(err) });
    }
  }, analysisIntervalMs);

  logInfo("Analyse-Loop gestartet", {
    intervalMs: analysisIntervalMs,
    mode: "all-roles-at-once"
  });
}

/**
 * Stoppt den automatischen Analyse-Loop
 */
export function stopAnalysisLoop() {
  if (analysisIntervalId) {
    clearInterval(analysisIntervalId);
    analysisIntervalId = null;
    logInfo("Analyse-Loop gestoppt");
  }
}

export async function syncAnalysisLoop() {
  const cfg = await readAnalysisConfig();
  setAnalysisInterval(cfg.intervalMinutes);
  if (cfg.enabled) {
    startAnalysisLoop();
  } else {
    stopAnalysisLoop();
  }
  return {
    enabled: cfg.enabled,
    intervalMinutes: cfg.intervalMinutes,
    running: Boolean(analysisIntervalId)
  };
}

// Export des aktuellen Disaster-Contexts
export { getCurrentDisasterContext } from "./disaster_context.js";
