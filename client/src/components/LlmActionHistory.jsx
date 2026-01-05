import React, { useState, useEffect, useCallback } from "react";
import { fetchLlmActionHistory } from "../api";

const CATEGORY_LABELS = {
  protokoll: "Protokolleintrag",
  aufgabe: "Aufgabe",
  einsatz: "Einsatz",
};

const CATEGORY_COLORS = {
  protokoll: "bg-blue-100 text-blue-800 border-blue-200",
  aufgabe: "bg-green-100 text-green-800 border-green-200",
  einsatz: "bg-red-100 text-red-800 border-red-200",
};

const TYPE_LABELS = {
  create: "Angelegt",
  update: "Bearbeitet",
};

function formatTimestamp(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getActionTitle(entry) {
  if (!entry) return "";
  const { category, type, data } = entry;
  const typeLabel = TYPE_LABELS[type] || type;
  const categoryLabel = CATEGORY_LABELS[category] || category;

  if (category === "protokoll") {
    const info = data?.information || "";
    return `${typeLabel}: ${categoryLabel} - ${info.slice(0, 50)}${info.length > 50 ? "..." : ""}`;
  }
  if (category === "aufgabe") {
    const title = data?.title || "";
    return `${typeLabel}: ${categoryLabel} - ${title.slice(0, 50)}${title.length > 50 ? "..." : ""}`;
  }
  if (category === "einsatz") {
    const content = data?.content || "";
    return `${typeLabel}: ${categoryLabel} - ${content.slice(0, 50)}${content.length > 50 ? "..." : ""}`;
  }
  return `${typeLabel}: ${categoryLabel}`;
}

function ActionDetailModal({ entry, onClose }) {
  if (!entry) return null;

  const { category, type, data, timestamp } = entry;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {TYPE_LABELS[type] || type}: {CATEGORY_LABELS[category] || category}
            </h2>
            <p className="text-sm text-gray-500">{formatTimestamp(timestamp)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
          {category === "protokoll" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Typ
                </label>
                <p className="text-gray-900">{data?.infoTyp || "-"}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Von
                </label>
                <p className="text-gray-900">{data?.anvon || "-"}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  An
                </label>
                <p className="text-gray-900">
                  {Array.isArray(data?.ergehtAn)
                    ? data.ergehtAn.join(", ")
                    : data?.ergehtAn || "-"}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Information
                </label>
                <p className="text-gray-900 whitespace-pre-wrap">
                  {data?.information || "-"}
                </p>
              </div>
            </div>
          )}

          {category === "aufgabe" && (
            <div className="space-y-4">
              {type === "create" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Titel
                    </label>
                    <p className="text-gray-900">{data?.title || "-"}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Typ
                    </label>
                    <p className="text-gray-900">{data?.type || "-"}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Verantwortlich
                    </label>
                    <p className="text-gray-900">{data?.responsible || "-"}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Beschreibung
                    </label>
                    <p className="text-gray-900 whitespace-pre-wrap">
                      {data?.desc || "-"}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Aufgaben-ID
                    </label>
                    <p className="text-gray-900 font-mono text-sm">
                      {data?.taskId || "-"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Änderungen
                    </label>
                    <div className="bg-gray-50 rounded p-3 font-mono text-sm">
                      <pre className="whitespace-pre-wrap">
                        {JSON.stringify(data?.changes || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {category === "einsatz" && (
            <div className="space-y-4">
              {type === "create" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Titel
                    </label>
                    <p className="text-gray-900">{data?.content || "-"}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Ort
                    </label>
                    <p className="text-gray-900">{data?.ort || "-"}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Beschreibung
                    </label>
                    <p className="text-gray-900 whitespace-pre-wrap">
                      {data?.description || "-"}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Einsatz-ID
                    </label>
                    <p className="text-gray-900 font-mono text-sm">
                      {data?.incidentId || "-"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      Änderungen
                    </label>
                    <div className="bg-gray-50 rounded p-3 font-mono text-sm">
                      <pre className="whitespace-pre-wrap">
                        {JSON.stringify(data?.changes || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LlmActionHistory({ className = "" }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedAction, setSelectedAction] = useState(null);
  const [filter, setFilter] = useState(""); // "", "protokoll", "aufgabe", "einsatz"
  const [expanded, setExpanded] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchLlmActionHistory({
        limit: 100,
        category: filter || null,
      });
      setActions(result.items || []);
    } catch (err) {
      console.error("Fehler beim Laden der Action-History:", err);
      setError("Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadHistory();
    // Auto-refresh alle 30 Sekunden
    const interval = setInterval(loadHistory, 30000);
    return () => clearInterval(interval);
  }, [loadHistory]);

  return (
    <div className={`bg-white rounded-lg shadow border border-gray-200 ${className}`}>
      {/* Header */}
      <div
        className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{expanded ? "▼" : "▶"}</span>
          <h3 className="font-semibold text-gray-800">
            KI-Aktionen
          </h3>
          <span className="text-sm text-gray-500">
            ({actions.length} Einträge)
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            loadHistory();
          }}
          className="text-sm text-blue-600 hover:text-blue-800"
          title="Aktualisieren"
        >
          ↻
        </button>
      </div>

      {expanded && (
        <>
          {/* Filter */}
          <div className="px-4 py-2 border-b bg-gray-50 flex gap-2 flex-wrap">
            <button
              onClick={() => setFilter("")}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                filter === ""
                  ? "bg-gray-700 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Alle
            </button>
            <button
              onClick={() => setFilter("protokoll")}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                filter === "protokoll"
                  ? "bg-blue-600 text-white"
                  : "bg-blue-100 text-blue-800 hover:bg-blue-200"
              }`}
            >
              Protokoll
            </button>
            <button
              onClick={() => setFilter("aufgabe")}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                filter === "aufgabe"
                  ? "bg-green-600 text-white"
                  : "bg-green-100 text-green-800 hover:bg-green-200"
              }`}
            >
              Aufgaben
            </button>
            <button
              onClick={() => setFilter("einsatz")}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                filter === "einsatz"
                  ? "bg-red-600 text-white"
                  : "bg-red-100 text-red-800 hover:bg-red-200"
              }`}
            >
              Einsätze
            </button>
          </div>

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {loading && actions.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500">
                Lade...
              </div>
            )}

            {error && (
              <div className="px-4 py-4 text-center text-red-600">
                {error}
              </div>
            )}

            {!loading && !error && actions.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500">
                Keine KI-Aktionen vorhanden
              </div>
            )}

            {actions.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {actions.map((action) => (
                  <li
                    key={action.id}
                    onClick={() => setSelectedAction(action)}
                    className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs border ${
                          CATEGORY_COLORS[action.category] || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {CATEGORY_LABELS[action.category] || action.category}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">
                          {getActionTitle(action)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatTimestamp(action.timestamp)}
                        </p>
                      </div>
                      <span className="text-gray-400 text-sm">→</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Detail Modal */}
      {selectedAction && (
        <ActionDetailModal
          entry={selectedAction}
          onClose={() => setSelectedAction(null)}
        />
      )}
    </div>
  );
}
