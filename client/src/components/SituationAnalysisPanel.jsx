import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { buildApiUrl } from "../utils/http.js";

const ROLES = ["LTSTB", "S1", "S2", "S3", "S4", "S5", "S6"];
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

function SuggestionCard({ suggestion, onFeedback, onEdit }) {
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
      ) : (
        <div className="text-xs mt-2 pt-2 border-t border-gray-200 text-center">
          {feedbackGiven ? (
            <span className="text-green-600">Danke! Vorschlag wird gespeichert.</span>
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
      const res = await fetch(buildApiUrl("/api/situation/question"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), role })
      });
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
      await fetch(buildApiUrl("/api/situation/question/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: answer.questionId,
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
            <p className="text-sm text-red-600">{answer.error}</p>
          ) : (
            <>
              <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
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

export default function SituationAnalysisPanel({ currentRole = "LTSTB", enabled = true }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const [analysisData, setAnalysisData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const pollIntervalRef = useRef(null);

  // Rolle aktualisieren wenn sich currentRole ändert
  useEffect(() => {
    if (currentRole && ROLES.includes(currentRole.toUpperCase())) {
      setSelectedRole(currentRole.toUpperCase());
    }
  }, [currentRole]);

  const fetchAnalysis = useCallback(async (forceRefresh = false) => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    try {
      const url = buildApiUrl(`/api/situation/analysis?role=${selectedRole}${forceRefresh ? "&forceRefresh=true" : ""}`);
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        if (data.isActive === false) {
          setError("Analyse nicht verfügbar (Simulation läuft)");
        } else {
          setError(data.error);
        }
        return;
      }

      setAnalysisData(data);
      setLastUpdate(new Date());
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [selectedRole, enabled]);

  // Auto-Refresh alle 5 Minuten wenn Panel offen ist
  useEffect(() => {
    if (!isOpen || !enabled) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    fetchAnalysis();
    pollIntervalRef.current = setInterval(() => fetchAnalysis(), 5 * 60 * 1000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isOpen, enabled, fetchAnalysis]);

  const handleFeedback = async (suggestionId, helpful, userNotes, editedContent) => {
    try {
      await fetch(buildApiUrl("/api/situation/suggestion/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId,
          analysisId: analysisData?.analysisId,
          helpful,
          userNotes,
          editedContent,
          userRole: selectedRole
        })
      });
    } catch {
      // Feedback-Fehler ignorieren
    }
  };

  const currentRoleData = useMemo(() => {
    if (!analysisData?.roles) return null;
    return analysisData.roles[selectedRole];
  }, [analysisData, selectedRole]);

  const situation = useMemo(() => {
    return analysisData?.situation || currentRoleData?.situation;
  }, [analysisData, currentRoleData]);

  if (!enabled) return null;

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
                {situation && (
                  <p className="text-xs opacity-90">
                    Schweregrad: <span className="font-medium">{SEVERITY_LABELS[situation.severity]}</span>
                  </p>
                )}
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
              {/* Rollen-Tabs */}
              <div className="flex border-b border-gray-200 overflow-x-auto bg-gray-50 px-2">
                {ROLES.map((role) => (
                  <button
                    key={role}
                    onClick={() => setSelectedRole(role)}
                    className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                      selectedRole === role
                        ? "border-b-2 border-blue-600 text-blue-600 bg-white"
                        : "text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                    }`}
                  >
                    {role}
                    {analysisData?.roles?.[role]?.suggestions?.length > 0 && (
                      <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
                        {analysisData.roles[role].suggestions.length}
                      </span>
                    )}
                  </button>
                ))}
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
                    <p className="text-gray-500">Analysiere Situation...</p>
                  </div>
                ) : currentRoleData?.suggestions?.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">
                      Handlungsvorschläge für {selectedRole}
                    </h4>
                    {currentRoleData.suggestions.map((sug) => (
                      <SuggestionCard
                        key={sug.id}
                        suggestion={sug}
                        onFeedback={handleFeedback}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>Keine Vorschläge für {selectedRole} verfügbar.</p>
                    <button
                      onClick={() => fetchAnalysis(true)}
                      className="mt-2 text-sm text-blue-600 hover:underline"
                    >
                      Analyse starten
                    </button>
                  </div>
                )}

                {/* Fragen-Sektion */}
                <QuestionSection role={selectedRole} />

                {/* Letzte Aktualisierung */}
                {lastUpdate && (
                  <p className="text-xs text-gray-400 mt-4 text-center">
                    Letzte Aktualisierung: {lastUpdate.toLocaleTimeString()}
                  </p>
                )}
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
    </>
  );
}
