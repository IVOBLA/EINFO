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
import { getKnowledgeContextWithSources, addToVectorRAG } from "./rag/rag_vector.js";
import { getCurrentSession } from "./rag/session_rag.js";
import { filterSuggestionsForRole, dismissSuggestion, initSuggestionFilter } from "./suggestion_filter.js";

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
// Erweiterte Beschreibungen mit konkreten Aufgabenbereichen für präzise Vorschläge
const ROLE_DESCRIPTIONS = {
  "LTSTB": `Leiter Technischer Einsatzleitung - Gesamtverantwortung und strategische Führung.
    KERNAUFGABEN: Lagebesprechungen einberufen, Einsatzschwerpunkte festlegen, Ressourcenverteilung zwischen Abschnitten entscheiden,
    Eskalation an übergeordnete Stellen (BH, LWZ), Koordination mit externen Stellen (Gemeinde, Polizei, Rettung).
    ENTSCHEIDUNGEN: Evakuierungsanordnungen, Alarmstufen-Änderungen, Anforderung Katastrophenhilfe Bundesheer`,

  "S1": `Stabsstelle 1 - Personal und Innerer Dienst.
    KERNAUFGABEN: Personalstärke erfassen (Anzahl Kräfte pro Einheit), Ablöseplanung mit konkreten Uhrzeiten erstellen,
    Verpflegung organisieren (Mengen, Ausgabeorte, Zeiten), Unterkünfte für Bereitschaft einrichten.
    MESSBARE ERGEBNISSE: X Einsatzkräfte im Einsatz, Y in Bereitschaft, Ablösung um HH:MM, Essen für Z Personen`,

  "S2": `Stabsstelle 2 - Lage und Dokumentation.
    KERNAUFGABEN: Lagekarte mit allen Einsatzstellen führen, Pegelstände/Messwerte dokumentieren,
    Lagemeldungen zu festen Zeiten erstellen, Einsatztagebuch führen, Wetterdaten abfragen.
    MESSBARE ERGEBNISSE: Lagemeldung Nr. X erstellt, Pegel bei Y cm, Z aktive Einsatzstellen dokumentiert`,

  "S3": `Stabsstelle 3 - Einsatz und Taktik.
    KERNAUFGABEN: Einsatzbefehle formulieren (WER macht WAS, WO, bis WANN), Fahrzeuge/Geräte zuweisen,
    Einsatzabschnitte gliedern, taktische Maßnahmen anordnen (Pumpenstrecken, Sandsackverbau, Evakuierungsrouten).
    MESSBARE ERGEBNISSE: Einsatzbefehl für Adresse X, Y Fahrzeuge zugewiesen, Pumpenstrecke A nach B aktiv`,

  "S4": `Stabsstelle 4 - Versorgung und Logistik.
    KERNAUFGABEN: Material beschaffen (Sandsäcke, Pumpen, Treibstoff mit Mengenangaben), Nachschub organisieren,
    Gerätewartung koordinieren, Betankung sicherstellen, Materiallager einrichten.
    MESSBARE ERGEBNISSE: X Sandsäcke bestellt/geliefert, Y Liter Diesel verfügbar, Materiallager bei Adresse Z`,

  "S5": `Stabsstelle 5 - Presse und Öffentlichkeitsarbeit.
    KERNAUFGABEN: Pressemitteilungen mit konkreten Fakten erstellen, Warndurchsagen formulieren (Inhalt, Gebiet),
    Social-Media-Updates, Bürgertelefon koordinieren, Pressekonferenzen organisieren.
    MESSBARE ERGEBNISSE: Pressemeldung um HH:MM, Warnung für Gebiet X, Bürgertelefon erreichbar unter Y`,

  "S6": `Stabsstelle 6 - Kommunikation und IT.
    KERNAUFGABEN: Funkverkehr organisieren (Kanäle, Rufgruppen), IT-Systeme betreuen, Relaisstationen aufbauen,
    Kommunikationsausfälle beheben, Einsatzleitsystem-Support.
    MESSBARE ERGEBNISSE: Funkkanal X aktiv, Relaisstation bei Y aufgebaut, IT-Problem Z behoben`
};

// In-Memory Cache
let analysisCache = new Map(); // role -> { timestamp, analysis }
let learnedSuggestions = [];
let cacheLoaded = false;

// Analyse-Intervall (Default: 5 Minuten)
let analysisIntervalMs = 5 * 60 * 1000;
let analysisIntervalId = null;

// Flag um gleichzeitige Analysen zu verhindern (Stream muss fertig sein bevor nächste Analyse startet)
let analysisInProgress = false;

// Callback für SSE-Broadcast wenn Analyse fertig ist
let onAnalysisCompleteCallback = null;

/**
 * Setzt den Callback für SSE-Broadcast wenn eine Analyse abgeschlossen ist
 */
export function setOnAnalysisComplete(callback) {
  onAnalysisCompleteCallback = callback;
}

/**
 * Gibt zurück ob gerade eine Analyse läuft
 */
export function isAnalysisInProgress() {
  return analysisInProgress;
}

/**
 * Holt gecachte Analyse für eine Rolle OHNE neue Analyse zu triggern
 * Gibt null zurück wenn kein Cache vorhanden ist
 */
export function getCachedAnalysisForRole(role) {
  const normalizedRole = role.toUpperCase();
  if (!ROLE_DESCRIPTIONS[normalizedRole]) {
    return {
      error: `Unbekannte Rolle: ${role}`,
      validRoles: Object.keys(ROLE_DESCRIPTIONS)
    };
  }

  const cached = analysisCache.get(normalizedRole);
  if (!cached) {
    return {
      noCache: true,
      role: normalizedRole,
      message: "Noch keine Analyse durchgeführt"
    };
  }

  const now = Date.now();
  const cacheAge = now - cached.timestamp;

  return {
    ...cached.analysis,
    fromCache: true,
    cacheAge,
    nextAnalysisIn: Math.max(0, analysisIntervalMs - cacheAge),
    analysisInProgress
  };
}

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

    // Initialisiere Suggestion-Filter (lädt dismissed suggestions)
    await initSuggestionFilter();

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
 * NEU: Nutzt Context-Fingerprint für intelligentes Matching
 */
async function getLearnedSuggestionsForContext(role, contextSummary, contextFingerprint = null) {
  if (!learnedSuggestions.length) return [];

  // Filtere nach Rolle
  const roleSpecific = learnedSuggestions.filter(s => s.targetRole === role);
  if (!roleSpecific.length) return [];

  // Wenn Fingerprint vorhanden: Nutze Fingerprint-Matching
  if (contextFingerprint) {
    const { matchFingerprints } = await import("./context_fingerprint.js");

    const relevant = roleSpecific
      .map(s => {
        const score = s.context_fingerprint
          ? matchFingerprints(contextFingerprint, s.context_fingerprint)
          : 0;
        return { ...s, relevance: score };
      })
      .filter(s => s.relevance >= 15) // Min-Schwelle
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 3);

    logDebug("Fingerprint-basiertes Matching", {
      role,
      candidates: roleSpecific.length,
      matches: relevant.length,
      scores: relevant.map(r => r.relevance)
    });

    return relevant;
  }

  // Fallback: Einfache Keyword-basierte Relevanz (alte Methode)
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
 *
 * WICHTIG: Diese Funktion wartet den LLM-Stream vollständig ab,
 * bevor weitere Schritte erfolgen. Das analysisInProgress-Flag
 * verhindert gleichzeitige Analysen.
 */
export async function analyzeAllRoles(forceRefresh = false) {
  if (!isAnalysisActive()) {
    return {
      error: "Analyse nicht aktiv (Simulation läuft)",
      isActive: false
    };
  }

  // Verhindere gleichzeitige Analysen - Stream muss erst fertig sein
  if (analysisInProgress) {
    logDebug("Analyse übersprungen - vorherige Analyse läuft noch (Stream nicht fertig)");
    return {
      error: "Analyse läuft bereits",
      inProgress: true
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

  // Flag setzen BEVOR die Analyse startet (inkl. Datenaufbereitung)
  analysisInProgress = true;
  logInfo("Starte Gesamtanalyse für alle Rollen (Stream wird abgewartet)");

  try {
    // Aktuellen Kontext holen (NEU: mit Filterregeln + Fingerprint)
    const { getFilteredDisasterContextSummary } = await import("./disaster_context.js");
    const { summary: disasterSummary, fingerprint, filtered } = await getFilteredDisasterContextSummary({ maxLength: 2500 });

    // Gelernte Vorschläge sammeln (NEU: mit Fingerprint-Matching)
    const learnedByRole = {};
    for (const role of roles) {
      learnedByRole[role] = await getLearnedSuggestionsForContext(role, disasterSummary, fingerprint);
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

    let llmResponse;
    try {
      // LLM-Stream wird vollständig abgewartet bevor die Funktion zurückkehrt
      llmResponse = await callLLMForChat(systemPrompt, userPrompt, {
        taskType: "analysis" // Verwendet alle Parameter aus analysis-Task-Config
      });
    } catch (llmErr) {
      logError("LLM-Aufruf fehlgeschlagen bei Gesamtanalyse", {
        error: String(llmErr)
      });
      return {
        error: "KI-Modell nicht erreichbar oder Anfrage fehlgeschlagen",
        details: String(llmErr)
      };
    }

    // Prüfe ob LLM-Antwort gültig ist (erst nach vollständigem Stream)
    if (!llmResponse || typeof llmResponse !== "string" || !llmResponse.trim()) {
      logError("LLM gab leere Antwort bei Gesamtanalyse", {
        responseType: typeof llmResponse,
        responseLength: llmResponse?.length || 0
      });
      return {
        error: "KI-Modell hat keine gültige Antwort geliefert",
        details: "Leere oder ungültige Antwort vom Modell"
      };
    }

    // JSON parsen
    let parsed;
    try {
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Kein JSON in der Antwort gefunden");
      }
    } catch (parseErr) {
      logError("JSON-Parse-Fehler bei Gesamtanalyse", {
        error: String(parseErr),
        response: llmResponse.substring(0, 500)
      });
      return {
        error: "Analyse-Ergebnis konnte nicht verarbeitet werden",
        details: String(parseErr)
      };
    }

    // Fallback: Malformed LLM response format detection and conversion
    // Some models output formats like: { ".": { "1)": "summary", "2)": { "\"S1\"": "..." } } }
    // This tries to convert such formats to the expected structure
    if (parsed && !parsed.situation && !parsed.rolesSuggestions) {
      const convertMalformedResponse = (obj) => {
        // Check for the weird "." key pattern
        const dotContent = obj["."] || obj[""] || Object.values(obj)[0];
        if (!dotContent || typeof dotContent !== "object") return null;

        // Try to extract summary from numbered key like "1)"
        let summaryText = "";
        let rolesData = null;
        for (const [key, value] of Object.entries(dotContent)) {
          if (key.match(/^1\)?$/)) {
            summaryText = typeof value === "string" ? value : "";
          } else if (key.match(/^2\)?$/) && typeof value === "object") {
            rolesData = value;
          }
        }

        if (!rolesData) return null;

        // Convert role suggestions from format { "\"S1\"": "text", ... } to expected format
        const rolesSuggestions = {};
        const validRoles = ["LTSTB", "S1", "S2", "S3", "S4", "S5", "S6"];

        for (const [key, value] of Object.entries(rolesData)) {
          // Remove extra quotes from keys like "\"S1\"" -> "S1"
          const cleanKey = key.replace(/^["']|["']$/g, "").toUpperCase();
          const matchedRole = validRoles.find(r => cleanKey.includes(r));
          if (!matchedRole) continue;

          // Parse suggestion text into structured format
          const suggestionText = typeof value === "string" ? value : "";
          const suggestions = suggestionText
            .split(/\\n|-\s+/)
            .filter(line => line.trim().length > 10)
            .map((line, i) => ({
              priority: "medium",
              title: line.trim().substring(0, 60) + (line.length > 60 ? "..." : ""),
              description: line.trim(),
              reasoning: "Automatisch aus LLM-Antwort extrahiert",
              category: "coordination",
              isProactive: false
            }));

          if (suggestions.length > 0) {
            rolesSuggestions[matchedRole] = suggestions;
          }
        }

        if (Object.keys(rolesSuggestions).length === 0) return null;

        logDebug("Malformed LLM response converted to expected format", {
          originalKeys: Object.keys(obj),
          convertedRoles: Object.keys(rolesSuggestions)
        });

        return {
          situation: {
            summary: summaryText || "Automatisch konvertierte Analyse",
            severity: "medium",
            criticalFactors: []
          },
          rolesSuggestions
        };
      };

      const converted = convertMalformedResponse(parsed);
      if (converted) {
        parsed = converted;
      }
    }

    // Analyse-ID für diese Runde
    const analysisId = `analysis_${now}_${Math.random().toString(36).substr(2, 9)}`;
    const situation = parsed.situation || { summary: "Keine Zusammenfassung", severity: "medium", criticalFactors: [] };

    const normalizeRoleSuggestions = (raw) => {
      const unwrapSuggestions = (value) => {
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object" && Array.isArray(value.suggestions)) {
          return value.suggestions;
        }
        return [];
      };

      if (!raw) return {};
      if (Array.isArray(raw)) {
        return raw.reduce((acc, entry) => {
          if (!entry || typeof entry !== "object") return acc;
          const key = String(entry.role || entry.roleId || "").toUpperCase();
          if (key) {
            acc[key] = unwrapSuggestions(entry.suggestions);
          }
          return acc;
        }, {});
      }
      if (typeof raw === "object") {
        return Object.fromEntries(
          Object.entries(raw).map(([key, value]) => [String(key).toUpperCase(), unwrapSuggestions(value)])
        );
      }
      return {};
    };

    const normalizedRoleSuggestions = normalizeRoleSuggestions(
      parsed.rolesSuggestions || parsed.roleSuggestions || parsed.roles || parsed.suggestions
    );

    // Für jede Rolle Cache aktualisieren
    const results = {};
    let totalFiltered = 0;
    for (const role of roles) {
      const roleSuggestions = normalizedRoleSuggestions[role] || [];

      // Vorschläge mit IDs versehen
      const suggestionsWithIds = roleSuggestions.map((s, i) => ({
        id: `sug_${now}_${role}_${i}`,
        analysisId,
        targetRole: role,
        ...s,
        status: "new",
        createdAt: now
      }));

      // POST-PROCESSING: Filtere Duplikate (existierende Tasks + dismissed)
      // Dies hält die Prompts klein, da die Filterung NACH der LLM-Generierung erfolgt
      const filteredSuggestions = await filterSuggestionsForRole(suggestionsWithIds, role);
      totalFiltered += suggestionsWithIds.length - filteredSuggestions.length;

      const analysis = {
        analysisId,
        timestamp: now,
        role,
        situation,
        suggestions: filteredSuggestions,
        nextAnalysisIn: analysisIntervalMs
      };

      // In Cache speichern
      analysisCache.set(role, { timestamp: now, analysis });
      results[role] = analysis;
    }

    logInfo("Gesamtanalyse abgeschlossen", {
      roles: roles.length,
      totalSuggestions: Object.values(results).reduce((sum, r) => sum + r.suggestions.length, 0),
      filteredDuplicates: totalFiltered,
      severity: situation.severity
    });

    // SSE-Broadcast dass Analyse fertig ist
    if (onAnalysisCompleteCallback) {
      try {
        onAnalysisCompleteCallback({
          analysisId,
          timestamp: now,
          situation,
          roles: Object.keys(results),
          nextAnalysisIn: analysisIntervalMs
        });
      } catch (callbackErr) {
        logError("Fehler beim SSE-Broadcast", { error: String(callbackErr) });
      }
    }

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
  } finally {
    // Flag IMMER zurücksetzen, egal ob Erfolg oder Fehler
    analysisInProgress = false;
    logDebug("Gesamtanalyse beendet, Flag zurückgesetzt");
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
    let answer;
    try {
      answer = await callLLMForChat(systemPrompt, question, {
        taskType: "analysis", // Verwendet alle Parameter aus analysis-Task-Config
        requireJson: false    // Antworten sollen Text sein, kein JSON
      });
    } catch (llmErr) {
      logError("LLM-Aufruf fehlgeschlagen bei Fragebeantwortung", {
        question,
        role: normalizedRole,
        error: String(llmErr)
      });
      return {
        error: "KI-Modell nicht erreichbar oder Anfrage fehlgeschlagen",
        details: String(llmErr)
      };
    }

    // Prüfe ob LLM-Antwort gültig ist
    if (!answer || typeof answer !== "string" || !answer.trim()) {
      logError("LLM gab leere Antwort bei Fragebeantwortung", {
        question,
        role: normalizedRole,
        responseType: typeof answer,
        responseLength: answer?.length || 0
      });
      return {
        error: "KI-Modell hat keine gültige Antwort geliefert",
        details: "Leere oder ungültige Antwort vom Modell"
      };
    }

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
  userRole,
  suggestionTitle,
  suggestionDescription,
  targetRole
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
  } else {
    // Bei "Nicht hilfreich" -> Als dismissed speichern (verhindert erneutes Vorschlagen)
    await dismissSuggestion({
      suggestionId,
      title: suggestionTitle || editedContent?.title || "",
      description: suggestionDescription || editedContent?.description || "",
      targetRole: targetRole || userRole || "unknown",
      reason: userNotes || "not_helpful",
      userId: userId || "anonymous"
    });
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
 * - Bei "Hilfreich": Frage+Antwort ins Session-RAG + Vector-RAG speichern
 * - Bei "Nicht hilfreich" mit Korrektur: Korrigierte Antwort speichern
 */
export async function saveQuestionFeedback({
  questionId,
  question,
  answer,
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

  // Bei "Hilfreich" -> Frage+Antwort ins Session-RAG + Vector-RAG speichern
  if (helpful && question && answer) {
    const ragEntryId = `qa_${questionId}`;
    const ragText = `Frage: ${question}\nAntwort: ${answer}`;

    try {
      // 1. Ins Session-RAG speichern (für aktuelle Session)
      const session = getCurrentSession();
      await session.add(ragEntryId, ragText, {
        type: "verified_qa",
        questionId,
        userId,
        userRole,
        source: "user_verified"
      });

      // 2. Ins Vector-RAG speichern (persistent für alle Sessions)
      const vectorResult = await addToVectorRAG(ragText, {
        fileName: "verified_answers",
        id: ragEntryId
      });

      logInfo("Hilfreiche Antwort ins RAG aufgenommen", {
        feedbackId,
        questionId,
        ragEntryId,
        vectorSuccess: vectorResult.success
      });
    } catch (err) {
      logError("Fehler beim Speichern ins RAG", {
        feedbackId,
        error: String(err)
      });
    }
  }

  // Bei "Nicht hilfreich" mit Korrektur -> Korrigierte Antwort speichern
  if (!helpful && correction && question) {
    const correctionId = `correction_${questionId}`;
    const correctionText = `Frage: ${question}\nKorrigierte Antwort: ${correction}`;

    try {
      // Ins Session-RAG speichern
      const session = getCurrentSession();
      await session.add(correctionId, correctionText, {
        type: "correction",
        originalQuestionId: questionId,
        userId,
        userRole,
        source: "user_correction"
      });

      // Ins Vector-RAG speichern (persistent)
      const vectorResult = await addToVectorRAG(correctionText, {
        fileName: "user_corrections",
        id: correctionId
      });

      logInfo("Korrektur ins RAG aufgenommen", {
        feedbackId,
        questionId,
        correctionId,
        vectorSuccess: vectorResult.success
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
    hasCorrection: !!correction,
    hasAnswer: !!answer
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
 *
 * Der Loop wird gestartet wenn:
 * - KI-Analyse aktiviert ist UND Chatbot gestartet wird (via syncAnalysisLoop)
 * - Chatbot bereits läuft UND Checkbox für KI-Analyse im Admin Panel gesetzt wird
 *
 * WICHTIG: Der LLM-Stream wird bei jeder Analyse vollständig abgewartet
 * bevor die nächste Analyse gestartet werden kann (analysisInProgress-Flag)
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

    // analysisInProgress wird in analyzeAllRoles() geprüft
    // Falls vorherige Analyse noch läuft (Stream nicht fertig), wird übersprungen
    try {
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
 *
 * Der Loop wird gestoppt wenn:
 * - Chatbot gestoppt wird (Prozess beendet sich -> Timer wird automatisch gestoppt)
 * - Checkbox für KI-Analyse im Admin Panel entfernt wird (via syncAnalysisLoop)
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
