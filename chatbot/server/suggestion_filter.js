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

// In-Memory Cache für dismissed suggestions
let dismissedSuggestions = [];
let dismissedLoaded = false;

/**
 * Initialisiert den Filter (lädt dismissed suggestions)
 */
export async function initSuggestionFilter() {
  try {
    await fsPromises.mkdir(path.dirname(DISMISSED_FILE), { recursive: true });

    if (fs.existsSync(DISMISSED_FILE)) {
      const raw = await fsPromises.readFile(DISMISSED_FILE, "utf8");
      dismissedSuggestions = JSON.parse(raw);
    } else {
      dismissedSuggestions = [];
    }

    dismissedLoaded = true;
    logInfo("Suggestion-Filter initialisiert", {
      dismissedCount: dismissedSuggestions.length
    });
  } catch (err) {
    logError("Fehler beim Initialisieren des Suggestion-Filters", {
      error: String(err)
    });
    dismissedSuggestions = [];
    dismissedLoaded = true;
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
 */
function isSimilarToTask(suggestion, tasks, threshold = 0.5) {
  const suggestionText = `${suggestion.title || ""} ${suggestion.description || ""}`;

  for (const task of tasks) {
    const taskText = `${task.title || ""} ${task.desc || ""}`;
    const similarity = textSimilarity(suggestionText, taskText);

    if (similarity >= threshold) {
      logDebug("Vorschlag ähnelt existierendem Task", {
        suggestionTitle: suggestion.title,
        taskTitle: task.title,
        similarity: similarity.toFixed(2)
      });
      return true;
    }
  }

  return false;
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
 *
 * @param {Array} suggestions - Die generierten Vorschläge
 * @param {string} role - Die Rolle (z.B. "S1", "LTSTB")
 * @returns {Array} - Gefilterte Vorschläge
 */
export async function filterSuggestionsForRole(suggestions, role) {
  if (!suggestions || suggestions.length === 0) {
    return [];
  }

  if (!dismissedLoaded) {
    await initSuggestionFilter();
  }

  // Tasks für diese Rolle laden
  const existingTasks = await loadTasksForRole(role);

  const filteredSuggestions = [];
  let filteredByTask = 0;
  let filteredByDismissed = 0;

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

    filteredSuggestions.push(suggestion);
  }

  if (filteredByTask > 0 || filteredByDismissed > 0) {
    logInfo("Vorschläge gefiltert", {
      role,
      original: suggestions.length,
      filtered: filteredSuggestions.length,
      byExistingTask: filteredByTask,
      byDismissed: filteredByDismissed
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
