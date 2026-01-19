// chatbot/server/suggestion_filter.js
//
// Filtert KI-Vorschläge um Duplikate zu vermeiden:
// - Vorschläge, die bereits als Task existieren (manuell oder aus KI-Vorschlag)
// - Vorschläge, die als "nicht hilfreich" bewertet wurden
//
// WICHTIG: Die Filterung erfolgt NACH der LLM-Generierung (Post-Processing),
// damit die Prompts nicht größer werden.

import fsPromises from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logDebug, logInfo, logError } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pfade für Storage
const DATA_DIR = path.resolve(__dirname, "../../server/data");
const DISMISSED_FILE = path.resolve(DATA_DIR, "situation_analysis/dismissed_suggestions.json");
const ACCEPTED_FILE = path.resolve(DATA_DIR, "situation_analysis/accepted_suggestions.json");

// In-Memory Cache für dismissed suggestions
let dismissedSuggestions = [];
let dismissedLoaded = false;

// NEU: In-Memory Cache für akzeptierte Vorschläge (die in Tasks konvertiert wurden)
let acceptedSuggestions = [];
let acceptedLoaded = false;

/**
 * Initialisiert den Filter (lädt dismissed und accepted suggestions)
 */
export async function initSuggestionFilter() {
  try {
    await fsPromises.mkdir(path.dirname(DISMISSED_FILE), { recursive: true });

    // Dismissed Suggestions laden
    if (fs.existsSync(DISMISSED_FILE)) {
      const raw = await fsPromises.readFile(DISMISSED_FILE, "utf8");
      dismissedSuggestions = JSON.parse(raw);
    } else {
      dismissedSuggestions = [];
    }

    // NEU: Accepted Suggestions laden (in Tasks konvertierte Vorschläge)
    if (fs.existsSync(ACCEPTED_FILE)) {
      const raw = await fsPromises.readFile(ACCEPTED_FILE, "utf8");
      acceptedSuggestions = JSON.parse(raw);
    } else {
      acceptedSuggestions = [];
    }

    dismissedLoaded = true;
    acceptedLoaded = true;
    logInfo("Suggestion-Filter initialisiert", {
      dismissedCount: dismissedSuggestions.length,
      acceptedCount: acceptedSuggestions.length
    });
  } catch (err) {
    logError("Fehler beim Initialisieren des Suggestion-Filters", {
      error: String(err)
    });
    dismissedSuggestions = [];
    acceptedSuggestions = [];
    dismissedLoaded = true;
    acceptedLoaded = true;
  }
}

/**
 * Berechnet die Ähnlichkeit zwischen zwei Texten (0-1)
 * Verwendet Jaccard-Ähnlichkeit auf Wort-Ebene (effizient und robust)
 */
function textSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  // Normalisierung: lowercase, nur alphanumerisch, Worte extrahieren
  const normalize = (text) => {
    return text
      .toLowerCase()
      .replace(/[^a-zäöüß0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2); // Nur Worte > 2 Zeichen
  };

  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard-Ähnlichkeit: |A ∩ B| / |A ∪ B|
  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return intersection / union;
}

/**
 * Prüft ob ein Vorschlag zu ähnlich zu einem existierenden Task ist
 * NEU: Niedrigerer Threshold (0.35) und zusätzliche Keyword-Prüfung
 */
function isSimilarToTask(suggestion, tasks, threshold = 0.35) {
  const suggestionText = `${suggestion.title || ""} ${suggestion.description || ""}`.toLowerCase();
  const suggestionKeywords = extractKeywords(suggestionText);

  for (const task of tasks) {
    const taskText = `${task.title || ""} ${task.desc || task.description || ""}`.toLowerCase();
    const taskKeywords = extractKeywords(taskText);

    // Jaccard-Ähnlichkeit
    const similarity = textSimilarity(suggestionText, taskText);

    // Zusätzlich: Keyword-Overlap (z.B. Adressen, Zahlen, spezifische Begriffe)
    const keywordOverlap = suggestionKeywords.filter(k => taskKeywords.includes(k)).length;
    const keywordScore = keywordOverlap / Math.max(suggestionKeywords.length, 1);

    // Kombinierter Score
    const combinedScore = similarity * 0.6 + keywordScore * 0.4;

    if (combinedScore >= threshold || similarity >= threshold + 0.1) {
      logDebug("Vorschlag ähnelt existierendem Task", {
        suggestionTitle: suggestion.title,
        taskTitle: task.title,
        similarity: similarity.toFixed(2),
        keywordOverlap,
        combinedScore: combinedScore.toFixed(2)
      });
      return true;
    }
  }

  return false;
}

/**
 * Extrahiert wichtige Keywords aus einem Text (Adressen, Zahlen, spezifische Begriffe)
 */
function extractKeywords(text) {
  if (!text) return [];

  // Extrahiere: Zahlen, Adressen (Straßennamen), spezifische Begriffe
  const keywords = [];

  // Zahlen (z.B. "12 Kräfte", "3 Fahrzeuge")
  const numbers = text.match(/\d+/g) || [];
  keywords.push(...numbers);

  // Wörter mit Großbuchstaben (potenzielle Namen/Orte) - nur wenn > 3 Zeichen
  const properNouns = text.match(/[A-ZÄÖÜ][a-zäöüß]{3,}/g) || [];
  keywords.push(...properNouns.map(w => w.toLowerCase()));

  // Wichtige Begriffe für Einsatzleitung
  const importantTerms = [
    "ablösung", "verpflegung", "pumpe", "sandsack", "evakuierung",
    "lagemeldung", "presseinfo", "funkkanal", "materiallager",
    "bereitschaft", "einsatzstelle", "transport", "koordination"
  ];
  for (const term of importantTerms) {
    if (text.includes(term)) {
      keywords.push(term);
    }
  }

  return [...new Set(keywords)]; // Deduplizieren
}

/**
 * Prüft ob ein Vorschlag zu ähnlich zu einem dismissed Vorschlag ist
 */
function isSimilarToDismissed(suggestion, role, threshold = 0.6) {
  const suggestionText = `${suggestion.title || ""} ${suggestion.description || ""}`;

  // Nur dismissed suggestions für diese Rolle prüfen
  const roleDismissed = dismissedSuggestions.filter(d => d.targetRole === role);

  for (const dismissed of roleDismissed) {
    const dismissedText = `${dismissed.title || ""} ${dismissed.description || ""}`;
    const similarity = textSimilarity(suggestionText, dismissedText);

    if (similarity >= threshold) {
      logDebug("Vorschlag ähnelt dismissed Vorschlag", {
        suggestionTitle: suggestion.title,
        dismissedTitle: dismissed.title,
        similarity: similarity.toFixed(2)
      });
      return true;
    }
  }

  return false;
}

/**
 * Lädt existierende Tasks für eine Rolle
 */
async function loadTasksForRole(role) {
  const normalizedRole = role.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const boardFile = path.join(DATA_DIR, `Aufg_board_${normalizedRole}.json`);

  try {
    if (!fs.existsSync(boardFile)) {
      return [];
    }

    const raw = await fsPromises.readFile(boardFile, "utf8");
    const board = JSON.parse(raw);

    // Nur aktive Tasks (Neu, In Bearbeitung) - nicht erledigte/archivierte
    const activeTasks = (board.items || []).filter(item => {
      const status = (item.status || "").toLowerCase();
      return status === "neu" || status === "in bearbeitung" || status === "new" || status === "in progress";
    });

    return activeTasks;
  } catch (err) {
    logDebug("Keine Tasks für Rolle gefunden", { role, error: String(err) });
    return [];
  }
}

/**
 * Filtert Vorschläge für eine Rolle
 * Entfernt:
 * - Vorschläge die zu ähnlich zu existierenden Tasks sind
 * - Vorschläge die als "nicht hilfreich" bewertet wurden
 * - NEU: Vorschläge die bereits in Tasks konvertiert wurden (akzeptiert)
 *
 * @param {Array} suggestions - Die generierten Vorschläge
 * @param {string} role - Die Rolle (z.B. "S1", "LTSTB")
 * @returns {Array} - Gefilterte Vorschläge
 */
export async function filterSuggestionsForRole(suggestions, role) {
  if (!suggestions || suggestions.length === 0) {
    return [];
  }

  if (!dismissedLoaded || !acceptedLoaded) {
    await initSuggestionFilter();
  }

  // Tasks für diese Rolle laden
  const existingTasks = await loadTasksForRole(role);

  const filteredSuggestions = [];
  let filteredByTask = 0;
  let filteredByDismissed = 0;
  let filteredByAccepted = 0;

  for (const suggestion of suggestions) {
    // Prüfe Ähnlichkeit zu existierenden Tasks
    if (isSimilarToTask(suggestion, existingTasks)) {
      filteredByTask++;
      continue;
    }

    // Prüfe Ähnlichkeit zu dismissed Vorschlägen
    if (isSimilarToDismissed(suggestion, role)) {
      filteredByDismissed++;
      continue;
    }

    // NEU: Prüfe Ähnlichkeit zu bereits akzeptierten Vorschlägen
    if (isSimilarToAccepted(suggestion, role)) {
      filteredByAccepted++;
      continue;
    }

    filteredSuggestions.push(suggestion);
  }

  if (filteredByTask > 0 || filteredByDismissed > 0 || filteredByAccepted > 0) {
    logInfo("Vorschläge gefiltert", {
      role,
      original: suggestions.length,
      filtered: filteredSuggestions.length,
      byExistingTask: filteredByTask,
      byDismissed: filteredByDismissed,
      byAccepted: filteredByAccepted
    });
  }

  return filteredSuggestions;
}

/**
 * Speichert einen Vorschlag als "dismissed" (nicht hilfreich)
 * Wird aufgerufen wenn der Benutzer "Nicht hilfreich" klickt
 */
export async function dismissSuggestion({
  suggestionId,
  title,
  description,
  targetRole,
  reason,
  userId
}) {
  const dismissedEntry = {
    id: suggestionId,
    title: title || "",
    description: description || "",
    targetRole: targetRole || "unknown",
    reason: reason || "not_helpful",
    userId: userId || "anonymous",
    dismissedAt: Date.now()
  };

  // Prüfe ob bereits vorhanden (exakte ID)
  const existingIndex = dismissedSuggestions.findIndex(d => d.id === suggestionId);
  if (existingIndex >= 0) {
    dismissedSuggestions[existingIndex] = dismissedEntry;
  } else {
    dismissedSuggestions.push(dismissedEntry);
  }

  // Persistieren
  try {
    await fsPromises.writeFile(
      DISMISSED_FILE,
      JSON.stringify(dismissedSuggestions, null, 2),
      "utf8"
    );
    logInfo("Vorschlag dismissed", {
      suggestionId,
      title,
      targetRole
    });
  } catch (err) {
    logError("Fehler beim Speichern des dismissed Vorschlags", {
      error: String(err)
    });
  }

  return dismissedEntry;
}

/**
 * Holt alle dismissed suggestions (für Admin/Debug)
 */
export function getDismissedSuggestions(role = null) {
  if (role) {
    return dismissedSuggestions.filter(d => d.targetRole === role);
  }
  return [...dismissedSuggestions];
}

/**
 * Löscht einen dismissed Vorschlag (z.B. wenn Admin ihn wieder freigeben will)
 */
export async function undismissSuggestion(suggestionId) {
  const index = dismissedSuggestions.findIndex(d => d.id === suggestionId);
  if (index < 0) {
    return false;
  }

  dismissedSuggestions.splice(index, 1);

  try {
    await fsPromises.writeFile(
      DISMISSED_FILE,
      JSON.stringify(dismissedSuggestions, null, 2),
      "utf8"
    );
    logInfo("Dismissed Vorschlag wiederhergestellt", { suggestionId });
    return true;
  } catch (err) {
    logError("Fehler beim Wiederherstellen", { error: String(err) });
    return false;
  }
}

/**
 * Erstellt eine detaillierte Zusammenfassung für den LLM-Prompt
 * Enthält: Existierende Tasks + Abgelehnte Vorschläge
 *
 * NEU: Detaillierter mit Beschreibungen für besseres Matching
 *
 * @param {Array} roles - Die Rollen für die Zusammenfassung erstellt werden soll
 * @returns {string} - Zusammenfassung für den Prompt
 */
export async function getExcludeContextForPrompt(roles) {
  if (!dismissedLoaded) {
    await initSuggestionFilter();
  }

  const lines = [];

  // 1. Existierende Tasks pro Rolle (mit Beschreibung für besseres Matching)
  const allTasks = [];
  for (const role of roles) {
    const tasks = await loadTasksForRole(role);
    for (const task of tasks) {
      allTasks.push({
        role,
        title: task.title || "",
        desc: task.desc || task.description || ""
      });
    }
  }

  if (allTasks.length > 0) {
    lines.push("BEREITS ALS AUFGABE VORHANDEN - NICHT ERNEUT VORSCHLAGEN:");
    // Gruppiere nach Rolle und zeige Details
    const byRole = {};
    for (const task of allTasks) {
      if (!byRole[task.role]) byRole[task.role] = [];
      byRole[task.role].push(task);
    }

    for (const [role, tasks] of Object.entries(byRole)) {
      const taskList = tasks.slice(0, 5).map(t => {
        const title = (t.title || "").substring(0, 50);
        const desc = (t.desc || "").substring(0, 80);
        return desc ? `• "${title}" (${desc})` : `• "${title}"`;
      }).join("\n");
      lines.push(`[${role}]\n${taskList}`);
    }
    lines.push(""); // Leerzeile
  }

  // 2. Abgelehnte Vorschläge (mit Details)
  const recentDismissed = [...dismissedSuggestions]
    .sort((a, b) => (b.dismissedAt || 0) - (a.dismissedAt || 0))
    .slice(0, 10);

  if (recentDismissed.length > 0) {
    lines.push("ABGELEHNTE VORSCHLÄGE - NICHT ERNEUT VORSCHLAGEN:");
    for (const d of recentDismissed) {
      const title = (d.title || "").substring(0, 50);
      const desc = (d.description || "").substring(0, 80);
      const role = d.targetRole || "?";
      lines.push(desc ? `• [${role}] "${title}" (${desc})` : `• [${role}] "${title}"`);
    }
  }

  // 3. NEU: Akzeptierte Vorschläge (die bereits in Tasks konvertiert wurden)
  const recentAccepted = [...acceptedSuggestions]
    .sort((a, b) => (b.acceptedAt || 0) - (a.acceptedAt || 0))
    .slice(0, 10);

  if (recentAccepted.length > 0) {
    lines.push("");
    lines.push("BEREITS IN AUFGABE KONVERTIERT - NICHT ERNEUT VORSCHLAGEN:");
    for (const a of recentAccepted) {
      const title = (a.title || "").substring(0, 50);
      const role = a.targetRole || "?";
      lines.push(`• [${role}] "${title}"`);
    }
  }

  const result = lines.join("\n");

  if (result) {
    logDebug("Exclude-Kontext für Prompt erstellt", {
      taskCount: allTasks.length,
      dismissedCount: recentDismissed.length,
      acceptedCount: recentAccepted.length,
      totalChars: result.length
    });
  }

  return result;
}

/**
 * NEU: Markiert einen Vorschlag als akzeptiert (in Task konvertiert)
 * Wird aufgerufen wenn der Benutzer "Als Aufgabe übernehmen" klickt
 */
export async function acceptSuggestion({
  suggestionId,
  title,
  description,
  targetRole,
  taskId,
  userId
}) {
  if (!acceptedLoaded) {
    await initSuggestionFilter();
  }

  const acceptedEntry = {
    id: suggestionId,
    title: title || "",
    description: description || "",
    targetRole: targetRole || "unknown",
    taskId: taskId || null,
    userId: userId || "anonymous",
    acceptedAt: Date.now()
  };

  // Prüfe ob bereits vorhanden (exakte ID)
  const existingIndex = acceptedSuggestions.findIndex(a => a.id === suggestionId);
  if (existingIndex >= 0) {
    acceptedSuggestions[existingIndex] = acceptedEntry;
  } else {
    acceptedSuggestions.push(acceptedEntry);
  }

  // Persistieren
  try {
    await fsPromises.writeFile(
      ACCEPTED_FILE,
      JSON.stringify(acceptedSuggestions, null, 2),
      "utf8"
    );
    logInfo("Vorschlag als akzeptiert markiert", {
      suggestionId,
      title,
      targetRole,
      taskId
    });
  } catch (err) {
    logError("Fehler beim Speichern des akzeptierten Vorschlags", {
      error: String(err)
    });
  }

  return acceptedEntry;
}

/**
 * Prüft ob ein Vorschlag zu ähnlich zu einem akzeptierten Vorschlag ist
 */
function isSimilarToAccepted(suggestion, role, threshold = 0.5) {
  const suggestionText = `${suggestion.title || ""} ${suggestion.description || ""}`;

  // Nur accepted suggestions für diese Rolle prüfen
  const roleAccepted = acceptedSuggestions.filter(a => a.targetRole === role);

  for (const accepted of roleAccepted) {
    const acceptedText = `${accepted.title || ""} ${accepted.description || ""}`;
    const similarity = textSimilarity(suggestionText, acceptedText);

    if (similarity >= threshold) {
      logDebug("Vorschlag ähnelt akzeptiertem Vorschlag", {
        suggestionTitle: suggestion.title,
        acceptedTitle: accepted.title,
        similarity: similarity.toFixed(2)
      });
      return true;
    }
  }

  return false;
}
