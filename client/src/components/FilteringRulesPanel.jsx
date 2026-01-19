import React, { useEffect, useState } from "react";

/**
 * FilteringRulesPanel - Zeigt Informationen über das Hybrid-Filtersystem
 * - Angewendete Regeln und deren Status
 * - Token-Nutzung
 * - Context-Fingerprint Details
 * - Gelernte Gewichte und deren Erfolgsraten
 */
export default function FilteringRulesPanel({ locked = false }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState(null);
  const [learnedWeights, setLearnedWeights] = useState(null);

  useEffect(() => {
    loadStatus();
    loadLearnedWeights();
  }, []);

  async function loadStatus() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/filtering-rules/status", { credentials: "include" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Laden fehlgeschlagen");
      setStatus(data);
      setErr("");
    } catch (ex) {
      setErr(ex.message || "Status laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  async function loadLearnedWeights() {
    try {
      const res = await fetch("/api/admin/filtering-rules/learned", { credentials: "include" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Laden fehlgeschlagen");
      setLearnedWeights(data.learned_weights || {});
    } catch (ex) {
      console.warn("Learned weights laden fehlgeschlagen:", ex.message);
    }
  }

  async function resetLearnedWeights() {
    if (!confirm("Alle gelernten Gewichte zurücksetzen? Dies kann nicht rückgängig gemacht werden.")) {
      return;
    }
    try {
      setLoading(true);
      const res = await fetch("/api/admin/filtering-rules/reset-learned", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Reset fehlgeschlagen");
      await loadLearnedWeights();
      setErr("");
      alert("Gelernte Gewichte erfolgreich zurückgesetzt.");
    } catch (ex) {
      setErr(ex.message || "Reset fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  if (loading && !status) {
    return <div className="text-sm text-gray-500">Lade Filterregeln-Status...</div>;
  }

  const lastAnalysis = status?.lastAnalysis;
  const appliedRules = lastAnalysis?.appliedRules;
  const fingerprint = lastAnalysis?.fingerprint;

  return (
    <div className="space-y-4 text-sm">
      {err && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">
          {err}
        </div>
      )}

      {/* Letzte Analyse-Details */}
      {lastAnalysis ? (
        <div className="border rounded p-4 bg-gray-50">
          <div className="font-medium text-base mb-3">📊 Letzte Analyse-Details</div>

          <div className="grid gap-2 text-sm">
            <div>
              <span className="text-gray-600">Zeitstempel:</span>{" "}
              <code className="text-xs bg-white px-1 rounded">
                {new Date(lastAnalysis.timestamp).toLocaleString("de-AT", { hour12: false })}
              </code>
            </div>

            {fingerprint && (
              <>
                <div>
                  <span className="text-gray-600">Disaster:</span>{" "}
                  <strong>{fingerprint.disaster_type || "unbekannt"}</strong>
                  {fingerprint.phase && <span className="text-gray-500"> ({fingerprint.phase})</span>}
                </div>
                <div>
                  <span className="text-gray-600">Abschnitte:</span>{" "}
                  {fingerprint.total_sections} gesamt
                  {fingerprint.critical_sections > 0 && (
                    <span className="text-red-600 font-medium"> ({fingerprint.critical_sections} kritisch)</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-600">Geograf. Verteilung:</span>{" "}
                  <span className="capitalize">{fingerprint.geographic_pattern || "unbekannt"}</span>
                </div>
                <div>
                  <span className="text-gray-600">Trend:</span>{" "}
                  <span className="capitalize">{fingerprint.trend_direction || "stabil"}</span>
                </div>
                <div>
                  <span className="text-gray-600">Ressourcen-Auslastung:</span>{" "}
                  {fingerprint.utilization_percent}%
                </div>
              </>
            )}

            <div className="mt-2 pt-2 border-t">
              <span className="text-gray-600">Token-Nutzung:</span>{" "}
              <strong>{lastAnalysis.tokensUsed.toLocaleString("de-AT")}</strong> / {lastAnalysis.tokensLimit.toLocaleString("de-AT")}
              <span className="text-gray-500 ml-2">
                ({Math.round((lastAnalysis.tokensUsed / lastAnalysis.tokensLimit) * 100)}% genutzt)
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="border rounded p-4 bg-gray-50 text-gray-500">
          Noch keine Analyse durchgeführt.
        </div>
      )}

      {/* Angewendete Regeln */}
      {appliedRules && (
        <div className="border rounded p-4">
          <div className="font-medium text-base mb-3">✅ Angewendete Regeln</div>

          <div className="space-y-2">
            {/* R1: Abschnitte-Priorität */}
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                {appliedRules.R1_ABSCHNITTE?.enabled ? (
                  <span className="text-green-600 font-bold">✓</span>
                ) : (
                  <span className="text-gray-400">✗</span>
                )}
                <span className={appliedRules.R1_ABSCHNITTE?.enabled ? "" : "text-gray-400"}>
                  R1 Abschnitte-Priorität
                </span>
              </div>
              {appliedRules.R1_ABSCHNITTE?.enabled && (
                <div className="text-xs text-gray-600">
                  {appliedRules.R1_ABSCHNITTE.items_shown} / {appliedRules.R1_ABSCHNITTE.max_items} Abschnitte
                </div>
              )}
            </div>

            {/* R2: Protokoll-Relevanz */}
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                {appliedRules.R2_PROTOKOLL?.enabled ? (
                  <span className="text-green-600 font-bold">✓</span>
                ) : (
                  <span className="text-gray-400">✗</span>
                )}
                <span className={appliedRules.R2_PROTOKOLL?.enabled ? "" : "text-gray-400"}>
                  R2 Protokoll-Relevanz
                </span>
              </div>
              {appliedRules.R2_PROTOKOLL?.enabled && (
                <div className="text-xs text-gray-600">
                  {appliedRules.R2_PROTOKOLL.items_shown} / {appliedRules.R2_PROTOKOLL.max_items} Einträge
                </div>
              )}
            </div>

            {/* R3: Trends-Erkennung */}
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                {appliedRules.R3_TRENDS?.enabled ? (
                  <span className="text-green-600 font-bold">✓</span>
                ) : (
                  <span className="text-gray-400">✗</span>
                )}
                <span className={appliedRules.R3_TRENDS?.enabled ? "" : "text-gray-400"}>
                  R3 Trends-Erkennung
                </span>
              </div>
              {appliedRules.R3_TRENDS?.enabled && (
                <div className="text-xs text-gray-600 capitalize">
                  {appliedRules.R3_TRENDS.direction} ({appliedRules.R3_TRENDS.strength})
                </div>
              )}
            </div>

            {/* R4: Ressourcen-Status */}
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                {appliedRules.R4_RESSOURCEN?.enabled ? (
                  <span className="text-green-600 font-bold">✓</span>
                ) : (
                  <span className="text-gray-400">✗</span>
                )}
                <span className={appliedRules.R4_RESSOURCEN?.enabled ? "" : "text-gray-400"}>
                  R4 Ressourcen-Status
                </span>
              </div>
              {appliedRules.R4_RESSOURCEN?.enabled && (
                <div className="text-xs text-gray-600">
                  {appliedRules.R4_RESSOURCEN.utilization}% Auslastung
                  {appliedRules.R4_RESSOURCEN.shortage && (
                    <span className="text-red-600 ml-2">⚠ Engpass</span>
                  )}
                </div>
              )}
            </div>

            {/* R5: Stabs-Fokus */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {appliedRules.R5_STABS_FOKUS?.enabled ? (
                  <span className="text-green-600 font-bold">✓</span>
                ) : (
                  <span className="text-gray-400">✗</span>
                )}
                <span className={appliedRules.R5_STABS_FOKUS?.enabled ? "" : "text-gray-400"}>
                  R5 Stabs-Fokus
                </span>
              </div>
              {appliedRules.R5_STABS_FOKUS?.enabled && (
                <div className="text-xs text-gray-600">
                  {appliedRules.R5_STABS_FOKUS.individual_incidents_shown} Einzeleinsätze
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gelernte Gewichte */}
      {learnedWeights && Object.keys(learnedWeights).length > 0 && (
        <div className="border rounded p-4">
          <div className="font-medium text-base mb-3">🧠 Gelernte Gewichte</div>

          {learnedWeights.protocol_factors && Object.keys(learnedWeights.protocol_factors).length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Protokoll-Faktoren:</div>
              {Object.entries(learnedWeights.protocol_factors).map(([name, data]) => (
                <div key={name} className="border-l-2 border-blue-400 pl-3 py-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-xs text-gray-600">
                      {data.initial_weight?.toFixed(2)} → {data.current_weight?.toFixed(2)}
                    </span>
                  </div>
                  {data.success_rate !== undefined && (
                    <div className="text-xs text-gray-500">
                      Erfolgsrate: {(data.success_rate * 100).toFixed(1)}%
                      ({data.helpful_count}/{data.feedback_count} Feedbacks)
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-60"
              disabled={locked || loading}
              onClick={resetLearnedWeights}
            >
              Gelernte Gewichte zurücksetzen
            </button>
            <span className="text-xs text-gray-500">
              Setzt alle gelernten Gewichte auf ihre Ausgangswerte zurück
            </span>
          </div>
        </div>
      )}

      {/* Aktionen */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          disabled={locked || loading}
          onClick={() => {
            loadStatus();
            loadLearnedWeights();
          }}
        >
          Aktualisieren
        </button>
      </div>

      <div className="text-xs text-gray-500 mt-4 pt-4 border-t">
        <strong>Info:</strong> Das Hybrid-Filtersystem kombiniert regelbasierte Filterung (R1-R5) mit
        Context-Fingerprinting und maschinellem Lernen. Gelernte Gewichte werden automatisch basierend
        auf Feedback angepasst und bleiben über Neustarts hinweg erhalten.
      </div>
    </div>
  );
}
