import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { buildChatbotApiUrl } from "../utils/http.js";
import AufgAddModal from "./AufgAddModal.jsx";

const PRIORITY_COLORS = {
  high: "bg-red-100 border-red-300 text-red-800",
  medium: "bg-yellow-100 border-yellow-300 text-yellow-800",
  low: "bg-green-100 border-green-300 text-green-800"
};
const SEVERITY_LABELS = {
  low: "Gering",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch"
};
const SEVERITY_COLORS = {
  low: "text-green-600",
  medium: "text-yellow-600",
  high: "text-orange-600",
  critical: "text-red-600"
};
const MIN_ANALYSIS_INTERVAL_MINUTES = 0;

function sanitizeAnalysisIntervalMinutes(value, fallback = 5) {
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : 5;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_ANALYSIS_INTERVAL_MINUTES) {
    return Math.max(MIN_ANALYSIS_INTERVAL_MINUTES, Math.floor(fallbackValue));
  }
  return Math.max(MIN_ANALYSIS_INTERVAL_MINUTES, Math.floor(parsed));
}

function SuggestionCard({ suggestion, onFeedback, onEdit, onCreateTask, onDismiss }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(suggestion.title);
  const [editedDescription, setEditedDescription] = useState(suggestion.description);
  const [userNotes, setUserNotes] = useState("");
  const [feedbackGiven, setFeedbackGiven] = useState(null);

  const handleSave = () => {
    setIsEditing(false);
    onEdit?.(suggestion.id, { title: editedTitle, description: editedDescription });
  };

  const handleFeedback = async (helpful) => {
    setFeedbackGiven(helpful);
    await onFeedback?.(suggestion.id, helpful, userNotes, {
      title: editedTitle,
      description: editedDescription
    }, {
      // Original-Suggestion-Daten für server-seitige Speicherung
      title: suggestion.title,
      description: suggestion.description,
      targetRole: suggestion.targetRole
    });
    // Bei "Nicht hilfreich" den Vorschlag ausblenden
    if (!helpful) {
      onDismiss?.(suggestion.id);
    }
  };

  const handleCreateTask = () => {
    onCreateTask?.({
      title: editedTitle,
      description: editedDescription,
      priority: suggestion.priority,
      category: suggestion.category,
      reasoning: suggestion.reasoning,
      suggestionId: suggestion.id
    });
  };

  return (
    <div className={`rounded-lg border p-3 mb-2 ${PRIORITY_COLORS[suggestion.priority] || "bg-gray-50 border-gray-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          {isEditing ? (
            <input
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              className="w-full text-sm font-semibold px-2 py-1 rounded border"
            />
          ) : (
            <h4 className="text-sm font-semibold">{suggestion.title}</h4>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            suggestion.priority === "high" ? "bg-red-200" :
            suggestion.priority === "medium" ? "bg-yellow-200" : "bg-green-200"
          }`}>
            {suggestion.priority === "high" ? "Hoch" :
             suggestion.priority === "medium" ? "Mittel" : "Niedrig"}
          </span>
        </div>
        {!feedbackGiven && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="text-xs text-gray-500 hover:text-gray-700"
            title={isEditing ? "Abbrechen" : "Bearbeiten"}
          >
            {isEditing ? "✕" : "✏️"}
          </button>
        )}
      </div>

      {isEditing ? (
        <textarea
          value={editedDescription}
          onChange={(e) => setEditedDescription(e.target.value)}
          className="w-full mt-2 text-xs px-2 py-1 rounded border resize-none"
          rows={3}
        />
      ) : (
        <p className="text-xs mt-1 opacity-80">{suggestion.description}</p>
      )}

      {suggestion.reasoning && (
        <p className="text-xs mt-1 italic text-gray-600">
          {suggestion.reasoning}
        </p>
      )}

      {isEditing && (
        <div className="mt-2">
          <input
            type="text"
            placeholder="Anmerkungen (optional)"
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            className="w-full text-xs px-2 py-1 rounded border"
          />
          <button
            onClick={handleSave}
            className="mt-1 text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Speichern
          </button>
        </div>
      )}

      {!feedbackGiven ? (
        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-200">
          <button
            onClick={() => handleFeedback(true)}
            className="flex-1 text-xs py-1 px-2 rounded bg-green-500 text-white hover:bg-green-600"
            title="Als hilfreich markieren"
          >
            Hilfreich
          </button>
          <button
            onClick={handleCreateTask}
            className="flex-1 text-xs py-1 px-2 rounded bg-blue-500 text-white hover:bg-blue-600"
            title="Aufgabe aus diesem Vorschlag erstellen"
          >
            Aufgabe erstellen
          </button>
          <button
            onClick={() => handleFeedback(false)}
            className="flex-1 text-xs py-1 px-2 rounded bg-gray-400 text-white hover:bg-gray-500"
            title="Als nicht hilfreich markieren und ausblenden"
          >
            Nicht hilfreich
          </button>
        </div>
      ) : (
        <div className="text-xs mt-2 pt-2 border-t border-gray-200 text-center">
          {feedbackGiven ? (
            <div className="space-y-2">
              <span className="text-green-600 block">Danke! Vorschlag wird gespeichert.</span>
              <button
                onClick={handleCreateTask}
                className="text-xs py-1 px-3 rounded bg-blue-500 text-white hover:bg-blue-600"
              >
                Aufgabe erstellen
              </button>
            </div>
          ) : (
            <span className="text-gray-500">Feedback erfasst.</span>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionSection({ role, onQuestionAsked }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [questionFeedbackGiven, setQuestionFeedbackGiven] = useState(false);

  const handleAsk = async () => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setAnswer(null);
    setQuestionFeedbackGiven(false);

    try {
      const res = await fetch(buildChatbotApiUrl("/api/situation/question"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), role })
      });

      // Prüfe Content-Type und Status vor JSON-Parsing
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        const errorText = contentType.includes("application/json")
          ? (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`
          : `Server-Fehler: ${res.status} ${res.statusText}`;
        setAnswer({ error: errorText });
        return;
      }

      if (!contentType.includes("application/json")) {
        setAnswer({ error: "Server hat keine gültige JSON-Antwort geliefert" });
        return;
      }

      const data = await res.json();
      if (data.error) {
        setAnswer({ error: data.error });
      } else {
        setAnswer(data);
        onQuestionAsked?.(data);
      }
    } catch (err) {
      setAnswer({ error: String(err.message || err) });
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (helpful, correction = "") => {
    if (!answer?.questionId) return;
    setQuestionFeedbackGiven(true);

    try {
      await fetch(buildChatbotApiUrl("/api/situation/question/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: answer.questionId,
          question: answer.question || question,
          answer: answer.answer, // Für RAG-Speicherung bei "Hilfreich"
          helpful,
          correction
        })
      });
    } catch {
      // Feedback-Fehler ignorieren
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-300">
      <h4 className="text-sm font-semibold mb-2">Frage stellen</h4>
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Was muss ich als nächstes tun?"
          className="flex-1 text-sm px-3 py-2 rounded border"
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          disabled={loading}
        />
        <button
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "..." : "Fragen"}
        </button>
      </div>

      {answer && (
        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
          {answer.error ? (
            <div>
              <p className="text-sm text-red-600">{answer.error}</p>
              {answer.debug && (
                <details className="mt-2 text-xs text-gray-500">
                  <summary className="cursor-pointer hover:text-gray-700">Debug-Info</summary>
                  <pre className="mt-1 p-2 bg-gray-100 rounded overflow-auto">
                    {JSON.stringify(answer.debug, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
              {/* RAG-Quellenangabe */}
              {answer.sources && answer.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-blue-200">
                  <details className="text-xs text-gray-500">
                    <summary className="cursor-pointer hover:text-gray-700">
                      📚 {answer.sources.length} Quelle{answer.sources.length !== 1 ? "n" : ""} verwendet
                      {answer.confidence && ` (${Math.round(answer.confidence * 100)}% Konfidenz)`}
                    </summary>
                    <ul className="mt-1 ml-4 list-disc">
                      {answer.sources.map((src, i) => (
                        <li key={i} className="text-gray-600">
                          <span className="font-medium">{src.fileName}</span>
                          {src.relevance && <span className="text-gray-400"> ({src.relevance}%)</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
              {!questionFeedbackGiven && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-blue-200">
                  <button
                    onClick={() => handleFeedback(true)}
                    className="flex-1 text-xs py-1 px-2 rounded bg-green-500 text-white hover:bg-green-600"
                  >
                    Hilfreich
                  </button>
                  <button
                    onClick={() => handleFeedback(false)}
                    className="flex-1 text-xs py-1 px-2 rounded bg-gray-400 text-white hover:bg-gray-500"
                  >
                    Nicht hilfreich
                  </button>
                </div>
              )}
              {questionFeedbackGiven && (
                <p className="text-xs text-center mt-2 text-green-600">Danke!</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// LocalStorage-Key für ausgeblendete Vorschläge
const DISMISSED_SUGGESTIONS_KEY = "dismissed_ai_suggestions";

function loadDismissedSuggestions() {
  try {
    const stored = localStorage.getItem(DISMISSED_SUGGESTIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveDismissedSuggestions(ids) {
  try {
    localStorage.setItem(DISMISSED_SUGGESTIONS_KEY, JSON.stringify(ids));
  } catch {
    // localStorage nicht verfügbar
  }
}

export default function SituationAnalysisPanel({ currentRole = "LTSTB", enabled = true, incidentOptions = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);
  // Initialisiere mit currentRole oder Fallback auf "LTSTB" wenn leer
  const [selectedRole, setSelectedRole] = useState(() =>
    (currentRole && currentRole.trim()) ? currentRole.trim().toUpperCase() : "LTSTB"
  );
  const [analysisData, setAnalysisData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollIntervalRef = useRef(null);
  const [analysisConfig, setAnalysisConfig] = useState({
    enabled: true,
    intervalMinutes: 5,
  });
  const resolvedEnabled = enabled && analysisConfig.enabled;

  // State für ausgeblendete Vorschläge
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => loadDismissedSuggestions());

  // State für Aufgaben-Modal
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskModalData, setTaskModalData] = useState(null);

  // Rolle aktualisieren wenn sich currentRole ändert - nur die Board-Rolle verwenden
  useEffect(() => {
    if (currentRole && currentRole.trim()) {
      setSelectedRole(currentRole.trim().toUpperCase());
    }
  }, [currentRole]);

  const [analysisInProgress, setAnalysisInProgress] = useState(false);

  // fetchAnalysis: cacheOnly=true lädt nur gecachte Daten ohne neue Analyse zu starten
  // forceRefresh=true erzwingt eine neue Analyse
  const fetchAnalysis = useCallback(async (forceRefresh = false, cacheOnly = false) => {
    if (!resolvedEnabled) return;
    setLoading(true);
    setError(null);

    try {
      let url = buildChatbotApiUrl(`/api/situation/analysis?role=${selectedRole}`);
      if (forceRefresh) {
        url += "&forceRefresh=true";
      } else if (cacheOnly) {
        url += "&cacheOnly=true";
      }
      const res = await fetch(url);

      // Prüfe Content-Type und Status vor JSON-Parsing
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        const errorText = contentType.includes("application/json")
          ? (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`
          : `Server-Fehler: ${res.status} ${res.statusText}`;
        setError(errorText);
        return;
      }

      if (!contentType.includes("application/json")) {
        setError("Server hat keine gültige JSON-Antwort geliefert");
        return;
      }

      const data = await res.json();

      // Wenn noCache=true bedeutet das, dass noch keine Analyse durchgeführt wurde
      if (data.noCache) {
        setAnalysisData(null);
        setAnalysisInProgress(data.analysisInProgress || false);
        return;
      }

      if (data.error) {
        if (data.isActive === false) {
          setError("Analyse nicht verfügbar (Simulation läuft)");
        } else {
          setError(data.error);
        }
        return;
      }

      setAnalysisData(data);
      setAnalysisInProgress(data.analysisInProgress || false);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [selectedRole, resolvedEnabled]);

  // SSE-Verbindung für Live-Updates wenn Analyse fertig ist
  useEffect(() => {
    if (!isOpen || !resolvedEnabled) return;

    let eventSource = null;
    try {
      eventSource = new EventSource(buildChatbotApiUrl("/api/events"));

      eventSource.addEventListener("analysis_complete", (event) => {
        try {
          const data = JSON.parse(event.data);
          // Wenn unsere Rolle in den aktualisierten Rollen ist, Cache neu laden
          if (data.roles && data.roles.includes(selectedRole)) {
            fetchAnalysis(false, true); // cacheOnly=true, neue Daten aus Cache holen
          }
        } catch (e) {
          // JSON-Parse-Fehler ignorieren
        }
      });

      eventSource.onerror = () => {
        // SSE-Verbindungsfehler ignorieren, reconnect erfolgt automatisch
      };
    } catch (e) {
      // SSE nicht verfügbar, ignorieren
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [isOpen, resolvedEnabled, selectedRole, fetchAnalysis]);

  // Beim Öffnen des Panels nur gecachte Daten laden (keine neue Analyse starten)
  // Neue Analysen werden automatisch im Backend nach dem eingestellten Intervall durchgeführt
  useEffect(() => {
    if (!isOpen || !resolvedEnabled) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Beim Öffnen nur Cache laden - KEINE neue Analyse starten
    fetchAnalysis(false, true); // cacheOnly=true

    // Polling um analysisInProgress-Status zu aktualisieren (alle 10 Sekunden wenn Panel offen)
    // Dies ist nur für den Status-Indikator, nicht um neue Analysen zu starten
    pollIntervalRef.current = setInterval(() => {
      fetchAnalysis(false, true); // cacheOnly=true
    }, 10000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isOpen, resolvedEnabled, fetchAnalysis]);

  useEffect(() => {
    let active = true;
    const loadConfig = async () => {
      try {
        const res = await fetch(buildChatbotApiUrl("/api/situation/analysis-config"), {
          credentials: "include",
          cache: "no-store"
        });
        if (!res.ok) return;
        const cfg = await res.json().catch(() => ({}));
        const intervalMinutes = sanitizeAnalysisIntervalMinutes(cfg?.intervalMinutes, 5);
        if (!active) return;
        setAnalysisConfig({
          enabled: !!cfg?.enabled,
          intervalMinutes,
        });
      } catch {
        // Optional: Konfig-Fehler ignorieren
      }
    };
    loadConfig();
    return () => {
      active = false;
    };
  }, []);

  const handleFeedback = async (suggestionId, helpful, userNotes, editedContent, suggestionData) => {
    try {
      await fetch(buildChatbotApiUrl("/api/situation/suggestion/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId,
          analysisId: analysisData?.analysisId,
          helpful,
          userNotes,
          editedContent,
          userRole: selectedRole,
          // Für server-seitige Speicherung der dismissed suggestions
          suggestionTitle: suggestionData?.title || editedContent?.title,
          suggestionDescription: suggestionData?.description || editedContent?.description,
          targetRole: suggestionData?.targetRole || selectedRole
        })
      });
    } catch {
      // Feedback-Fehler ignorieren
    }
  };

  // Vorschlag ausblenden (bei "Nicht hilfreich")
  const handleDismissSuggestion = useCallback((suggestionId) => {
    setDismissedSuggestions((prev) => {
      const updated = [...prev, suggestionId];
      saveDismissedSuggestions(updated);
      return updated;
    });
  }, []);

  // Aufgabe aus Vorschlag erstellen
  const handleCreateTaskFromSuggestion = useCallback((suggestionData) => {
    setTaskModalData(suggestionData);
    setTaskModalOpen(true);
  }, []);

  // Aufgabe wurde erstellt - auch Feedback senden
  const handleTaskCreated = useCallback(async (taskData) => {
    // Aufgabe an Backend senden
    try {
      const res = await fetch(`/api/aufgaben?role=${selectedRole}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...taskData,
          meta: {
            fromAiSuggestion: true,
            suggestionId: taskModalData?.suggestionId
          }
        })
      });
      if (!res.ok) {
        console.error("Fehler beim Erstellen der Aufgabe");
      }
    } catch (err) {
      console.error("Fehler beim Erstellen der Aufgabe:", err);
    }

    // Feedback als "hilfreich" senden, da Aufgabe erstellt wurde
    if (taskModalData?.suggestionId) {
      try {
        await fetch(buildChatbotApiUrl("/api/situation/suggestion/feedback"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestionId: taskModalData.suggestionId,
            analysisId: analysisData?.analysisId,
            helpful: true,
            userNotes: "Aufgabe erstellt",
            editedContent: { title: taskData.title, description: taskData.desc },
            userRole: selectedRole
          })
        });
      } catch {
        // Feedback-Fehler ignorieren
      }
    }

    setTaskModalOpen(false);
    setTaskModalData(null);
  }, [selectedRole, analysisData?.analysisId, taskModalData?.suggestionId]);

  // API gibt die Rollen-Daten direkt zurück (nicht in einem roles-Objekt)
  const currentRoleData = useMemo(() => {
    if (!analysisData) return null;
    // Die API gibt die Analyse für die angefragte Rolle direkt zurück
    return analysisData;
  }, [analysisData]);

  const situation = useMemo(() => {
    return analysisData?.situation || currentRoleData?.situation;
  }, [analysisData, currentRoleData]);

  if (!resolvedEnabled) return null;

  return (
    <>
      {/* Tab am unteren Rand - immer sichtbar */}
      <div
        className={`fixed bottom-0 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${
          isOpen ? "translate-y-full opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <button
          onClick={() => { setIsOpen(true); setIsMinimized(false); }}
          className="bg-blue-600 text-white px-6 py-2 rounded-t-lg shadow-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <span className="text-lg">📊</span>
          <span className="text-sm font-medium">KI-Analyse</span>
          {analysisData?.situation?.severity && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              analysisData.situation.severity === "critical" ? "bg-red-500" :
              analysisData.situation.severity === "high" ? "bg-orange-500" :
              analysisData.situation.severity === "medium" ? "bg-yellow-500" : "bg-green-500"
            }`}>
              {SEVERITY_LABELS[analysisData.situation.severity]}
            </span>
          )}
        </button>
      </div>

      {/* Slide-Up Panel */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 transform transition-transform duration-300 ease-out ${
          isOpen ? (isMinimized ? "translate-y-[calc(100%-3rem)]" : "translate-y-0") : "translate-y-full"
        }`}
        style={{ maxHeight: "70vh" }}
      >
        <div className="bg-white rounded-t-xl shadow-2xl border-t border-gray-200 flex flex-col" style={{ height: "70vh" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-xl cursor-pointer"
               onClick={() => setIsMinimized(!isMinimized)}>
            <div className="flex items-center gap-3">
              <span className="text-xl">📊</span>
              <div>
                <h3 className="font-semibold">KI-Situationsanalyse</h3>
                <div className="flex flex-wrap items-center gap-x-3 text-xs opacity-90">
                  {analysisInProgress && (
                    <span className="flex items-center gap-1 text-yellow-300">
                      <span className="animate-pulse">●</span> Analyse läuft...
                    </span>
                  )}
                  {analysisData?.timestamp ? (
                    <span>
                      Analyse vom: <span className="font-medium">{new Date(analysisData.timestamp).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </span>
                  ) : !analysisInProgress && (
                    <span className="text-gray-300">Noch keine Analyse durchgeführt</span>
                  )}
                  {situation && (
                    <span>
                      Schweregrad: <span className="font-medium">{SEVERITY_LABELS[situation.severity]}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loading && (
                <span className="text-xs animate-pulse">Lade...</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); fetchAnalysis(true); }}
                className="p-1 hover:bg-white/20 rounded"
                title="Neu analysieren"
              >
                🔄
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
                className="p-1 hover:bg-white/20 rounded"
                title={isMinimized ? "Maximieren" : "Minimieren"}
              >
                {isMinimized ? "▲" : "▼"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                className="p-1 hover:bg-white/20 rounded"
                title="Schließen"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Content - nur sichtbar wenn nicht minimiert */}
          {!isMinimized && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Aktuelle Rolle anzeigen */}
              <div className="flex border-b border-gray-200 bg-gray-50 px-4 py-2">
                <span className="text-sm font-medium text-gray-700">
                  Analyse für Rolle: <span className="text-blue-600 font-semibold">{selectedRole}</span>
                </span>
              </div>

              {/* Lage-Zusammenfassung */}
              {situation && (
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-start gap-2">
                    <span className={`text-lg ${SEVERITY_COLORS[situation.severity]}`}>
                      {situation.severity === "critical" ? "🔴" :
                       situation.severity === "high" ? "🟠" :
                       situation.severity === "medium" ? "🟡" : "🟢"}
                    </span>
                    <div>
                      <p className="text-sm">{situation.summary}</p>
                      {situation.criticalFactors?.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {situation.criticalFactors.map((factor, i) => (
                            <span key={i} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                              {factor}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Scrollbare Vorschläge */}
              <div className="flex-1 overflow-y-auto p-4">
                {error ? (
                  <div className="text-center py-8">
                    <p className="text-red-600 mb-2">{error}</p>
                    <button
                      onClick={() => fetchAnalysis(true)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Erneut versuchen
                    </button>
                  </div>
                ) : loading && !currentRoleData ? (
                  <div className="text-center py-8">
                    <div className="animate-spin text-3xl mb-2">⏳</div>
                    <p className="text-gray-500">Lade Analyse...</p>
                  </div>
                ) : !analysisData && !analysisInProgress ? (
                  <div className="text-center py-8 text-gray-500">
                    <p className="mb-2">Noch keine Analyse für {selectedRole} durchgeführt.</p>
                    <p className="text-xs text-gray-400 mb-4">
                      Analysen werden automatisch im eingestellten Intervall durchgeführt.
                    </p>
                    <button
                      onClick={() => fetchAnalysis(true)}
                      className="text-sm px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Jetzt analysieren
                    </button>
                  </div>
                ) : !analysisData && analysisInProgress ? (
                  <div className="text-center py-8">
                    <div className="animate-spin text-3xl mb-2">⏳</div>
                    <p className="text-gray-500">Analyse läuft...</p>
                    <p className="text-xs text-gray-400 mt-2">
                      Das Panel wird automatisch aktualisiert wenn die Analyse fertig ist.
                    </p>
                  </div>
                ) : currentRoleData?.suggestions?.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">
                      Handlungsvorschläge für {selectedRole}
                    </h4>
                    {currentRoleData.suggestions
                      .filter((sug) => !dismissedSuggestions.includes(sug.id))
                      .map((sug) => (
                      <SuggestionCard
                        key={sug.id}
                        suggestion={sug}
                        onFeedback={handleFeedback}
                        onCreateTask={handleCreateTaskFromSuggestion}
                        onDismiss={handleDismissSuggestion}
                      />
                    ))}
                    {currentRoleData.suggestions.filter((sug) => !dismissedSuggestions.includes(sug.id)).length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-4">
                        Alle Vorschläge wurden bearbeitet.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>Keine Vorschläge für {selectedRole} verfügbar.</p>
                    {analysisData?.timestamp && (
                      <p className="text-xs text-gray-400 mt-2">
                        Letzte Analyse: {new Date(analysisData.timestamp).toLocaleString("de-DE")}
                      </p>
                    )}
                    <button
                      onClick={() => fetchAnalysis(true)}
                      className="mt-4 text-sm px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Neu analysieren
                    </button>
                  </div>
                )}

                {/* Fragen-Sektion */}
                <QuestionSection role={selectedRole} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backdrop wenn Panel offen */}
      {isOpen && !isMinimized && (
        <div
          className="fixed inset-0 bg-black/20 z-30"
          onClick={() => setIsMinimized(true)}
        />
      )}

      {/* Aufgaben-Modal für Vorschläge */}
      <AufgAddModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false);
          setTaskModalData(null);
        }}
        onAdded={handleTaskCreated}
        incidentOptions={incidentOptions}
        initialTitle={taskModalData?.title || ""}
        initialDesc={taskModalData?.description || ""}
        initialResponsible={selectedRole}
        initialType={taskModalData?.category || "KI-Vorschlag"}
      />
    </>
  );
}
