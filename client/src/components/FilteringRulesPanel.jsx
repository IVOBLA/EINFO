import React, { useEffect, useState } from "react";

/**
 * FilteringRulesPanel - Zeigt Informationen über das Hybrid-Filtersystem
 * - Angewendete Regeln und deren Status
 * - Token-Nutzung
 * - Context-Fingerprint Details
 * - Gelernte Gewichte und deren Erfolgsraten
 * - GUI zum Bearbeiten von Regeln
 */
export default function FilteringRulesPanel({ locked = false }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState(null);
  const [learnedWeights, setLearnedWeights] = useState(null);
  const [rules, setRules] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editedRules, setEditedRules] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showAddFactor, setShowAddFactor] = useState(false);
  const [newFactor, setNewFactor] = useState({ name: "", keywords: "", weight: 0.2 });
  const [showHelp, setShowHelp] = useState(false);

  // Szenario-Konfiguration
  const [scenario, setScenario] = useState(null);
  const [editingScenario, setEditingScenario] = useState(false);
  const [editedScenario, setEditedScenario] = useState({});
  const [savingScenario, setSavingScenario] = useState(false);

  useEffect(() => {
    loadStatus();
    loadLearnedWeights();
    loadRules();
    loadScenario();
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

  async function loadRules() {
    try {
      const res = await fetch("/api/admin/filtering-rules", { credentials: "include" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Laden fehlgeschlagen");
      setRules(data);
      setEditedRules(JSON.parse(JSON.stringify(data))); // Deep copy
    } catch (ex) {
      console.warn("Regeln laden fehlgeschlagen:", ex.message);
    }
  }

  async function loadScenario() {
    try {
      const res = await fetch("/api/admin/filtering-rules/scenario", { credentials: "include" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Laden fehlgeschlagen");
      setScenario(data);
      setEditedScenario(data);
    } catch (ex) {
      console.warn("Szenario laden fehlgeschlagen:", ex.message);
    }
  }

  async function saveScenario() {
    try {
      setSavingScenario(true);
      const res = await fetch("/api/admin/filtering-rules/scenario", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editedScenario)
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Speichern fehlgeschlagen");

      setScenario(editedScenario);
      setEditingScenario(false);
      setErr("");
      // Status neu laden um aktualisierte Werte zu sehen
      await loadStatus();
    } catch (ex) {
      setErr(ex.message || "Szenario speichern fehlgeschlagen");
    } finally {
      setSavingScenario(false);
    }
  }

  async function saveRules() {
    if (!editedRules) return;

    try {
      setSaving(true);
      const res = await fetch("/api/admin/filtering-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editedRules)
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Speichern fehlgeschlagen");

      setRules(editedRules);
      setEditMode(false);
      setErr("");
      // Status neu laden um aktualisierte Regeln zu sehen
      await loadStatus();
    } catch (ex) {
      setErr(ex.message || "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditedRules(JSON.parse(JSON.stringify(rules)));
    setEditMode(false);
    setShowAddFactor(false);
    setNewFactor({ name: "", keywords: "", weight: 0.2 });
  }

  function toggleRuleEnabled(ruleId) {
    if (!editedRules?.rules?.[ruleId]) return;
    setEditedRules(prev => ({
      ...prev,
      rules: {
        ...prev.rules,
        [ruleId]: {
          ...prev.rules[ruleId],
          enabled: !prev.rules[ruleId].enabled
        }
      }
    }));
  }

  function updateRuleOutput(ruleId, field, value) {
    if (!editedRules?.rules?.[ruleId]) return;
    setEditedRules(prev => ({
      ...prev,
      rules: {
        ...prev.rules,
        [ruleId]: {
          ...prev.rules[ruleId],
          output: {
            ...prev.rules[ruleId].output,
            [field]: value
          }
        }
      }
    }));
  }

  function updateRuleScoring(ruleId, field, value) {
    if (!editedRules?.rules?.[ruleId]?.scoring) return;
    setEditedRules(prev => ({
      ...prev,
      rules: {
        ...prev.rules,
        [ruleId]: {
          ...prev.rules[ruleId],
          scoring: {
            ...prev.rules[ruleId].scoring,
            [field]: value
          }
        }
      }
    }));
  }

  function addCustomFactor() {
    if (!newFactor.name.trim() || !newFactor.keywords.trim()) return;

    const keywordsArray = newFactor.keywords.split(",").map(k => k.trim()).filter(k => k);
    if (keywordsArray.length === 0) return;

    const factor = {
      name: newFactor.name.trim(),
      keywords: keywordsArray,
      weight: parseFloat(newFactor.weight) || 0.2,
      learnable: true,
      custom: true
    };

    setEditedRules(prev => ({
      ...prev,
      rules: {
        ...prev.rules,
        R2_PROTOKOLL_RELEVANZ: {
          ...prev.rules.R2_PROTOKOLL_RELEVANZ,
          scoring: {
            ...prev.rules.R2_PROTOKOLL_RELEVANZ.scoring,
            factors: [...(prev.rules.R2_PROTOKOLL_RELEVANZ.scoring?.factors || []), factor]
          }
        }
      }
    }));

    setNewFactor({ name: "", keywords: "", weight: 0.2 });
    setShowAddFactor(false);
  }

  function removeFactor(index) {
    setEditedRules(prev => ({
      ...prev,
      rules: {
        ...prev.rules,
        R2_PROTOKOLL_RELEVANZ: {
          ...prev.rules.R2_PROTOKOLL_RELEVANZ,
          scoring: {
            ...prev.rules.R2_PROTOKOLL_RELEVANZ.scoring,
            factors: prev.rules.R2_PROTOKOLL_RELEVANZ.scoring.factors.filter((_, i) => i !== index)
          }
        }
      }
    }));
  }

  function updateFactorWeight(index, weight) {
    setEditedRules(prev => ({
      ...prev,
      rules: {
        ...prev.rules,
        R2_PROTOKOLL_RELEVANZ: {
          ...prev.rules.R2_PROTOKOLL_RELEVANZ,
          scoring: {
            ...prev.rules.R2_PROTOKOLL_RELEVANZ.scoring,
            factors: prev.rules.R2_PROTOKOLL_RELEVANZ.scoring.factors.map((f, i) =>
              i === index ? { ...f, weight: parseFloat(weight) || 0 } : f
            )
          }
        }
      }
    }));
  }

  async function resetLearnedWeights() {
    if (!confirm("Alle gelernten Gewichte zurücksetzen? Dies kann nicht rückgängig gemacht werden.")) {
      return;
    }
    try {
      setLoading(true);
      const res = await fetch("/api/admin/filtering-rules/reset-learned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirmReset: true })
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
  const currentRules = editMode ? editedRules : rules;

  return (
    <div className="space-y-4 text-sm">
      {err && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">
          {err}
        </div>
      )}

      {/* Regel-Editor */}
      {currentRules?.rules && (
        <div className="border rounded p-4 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium text-base">Filterregeln konfigurieren</div>
            {!editMode ? (
              <button
                type="button"
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-60"
                disabled={locked || loading}
                onClick={() => setEditMode(true)}
              >
                Bearbeiten
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-gray-500 hover:bg-gray-600 text-white text-sm"
                  onClick={cancelEdit}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60"
                  disabled={saving}
                  onClick={saveRules}
                >
                  {saving ? "Speichern..." : "Speichern"}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {/* R1: Abschnitte-Priorität */}
            <div className={`border rounded p-3 ${currentRules.rules.R1_ABSCHNITTE_PRIORITAET?.enabled ? "bg-green-50 border-green-200" : "bg-gray-50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {editMode ? (
                    <input
                      type="checkbox"
                      checked={currentRules.rules.R1_ABSCHNITTE_PRIORITAET?.enabled || false}
                      onChange={() => toggleRuleEnabled("R1_ABSCHNITTE_PRIORITAET")}
                      className="w-4 h-4"
                    />
                  ) : (
                    currentRules.rules.R1_ABSCHNITTE_PRIORITAET?.enabled ? (
                      <span className="text-green-600 font-bold">ON</span>
                    ) : (
                      <span className="text-gray-400">OFF</span>
                    )
                  )}
                  <span className="font-medium">R1 Abschnitte-Priorität</span>
                </div>
                {editMode && currentRules.rules.R1_ABSCHNITTE_PRIORITAET?.enabled && (
                  <div className="flex items-center gap-2 text-xs">
                    <label>Max Abschnitte:</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={currentRules.rules.R1_ABSCHNITTE_PRIORITAET?.output?.max_items || 5}
                      onChange={(e) => updateRuleOutput("R1_ABSCHNITTE_PRIORITAET", "max_items", parseInt(e.target.value) || 5)}
                      className="w-16 px-2 py-1 border rounded"
                    />
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {currentRules.rules.R1_ABSCHNITTE_PRIORITAET?.description}
              </div>
            </div>

            {/* R2: Protokoll-Relevanz */}
            <div className={`border rounded p-3 ${currentRules.rules.R2_PROTOKOLL_RELEVANZ?.enabled ? "bg-green-50 border-green-200" : "bg-gray-50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {editMode ? (
                    <input
                      type="checkbox"
                      checked={currentRules.rules.R2_PROTOKOLL_RELEVANZ?.enabled || false}
                      onChange={() => toggleRuleEnabled("R2_PROTOKOLL_RELEVANZ")}
                      className="w-4 h-4"
                    />
                  ) : (
                    currentRules.rules.R2_PROTOKOLL_RELEVANZ?.enabled ? (
                      <span className="text-green-600 font-bold">ON</span>
                    ) : (
                      <span className="text-gray-400">OFF</span>
                    )
                  )}
                  <span className="font-medium">R2 Protokoll-Relevanz</span>
                </div>
                {editMode && currentRules.rules.R2_PROTOKOLL_RELEVANZ?.enabled && (
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <label>Max Einträge:</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={currentRules.rules.R2_PROTOKOLL_RELEVANZ?.output?.max_entries || 10}
                        onChange={(e) => updateRuleOutput("R2_PROTOKOLL_RELEVANZ", "max_entries", parseInt(e.target.value) || 10)}
                        className="w-16 px-2 py-1 border rounded"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label>Min Score:</label>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={currentRules.rules.R2_PROTOKOLL_RELEVANZ?.output?.min_score || 0.6}
                        onChange={(e) => updateRuleOutput("R2_PROTOKOLL_RELEVANZ", "min_score", parseFloat(e.target.value) || 0.6)}
                        className="w-16 px-2 py-1 border rounded"
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {currentRules.rules.R2_PROTOKOLL_RELEVANZ?.description}
              </div>

              {/* Scoring-Faktoren */}
              {editMode && currentRules.rules.R2_PROTOKOLL_RELEVANZ?.enabled && currentRules.rules.R2_PROTOKOLL_RELEVANZ?.scoring?.factors && (
                <div className="mt-3 pt-3 border-t">
                  <div className="text-xs font-medium mb-2">Scoring-Faktoren (Keywords):</div>
                  <div className="space-y-2">
                    {currentRules.rules.R2_PROTOKOLL_RELEVANZ.scoring.factors.map((factor, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs bg-white p-2 rounded border">
                        <span className="font-medium min-w-[120px]">{factor.name}</span>
                        <span className="text-gray-500 flex-1">
                          {factor.keywords ? factor.keywords.join(", ") : factor.pattern || "-"}
                        </span>
                        <div className="flex items-center gap-1">
                          <label>Gewicht:</label>
                          <input
                            type="number"
                            min="-1"
                            max="2"
                            step="0.05"
                            value={factor.weight}
                            onChange={(e) => updateFactorWeight(idx, e.target.value)}
                            className="w-16 px-1 py-0.5 border rounded text-xs"
                          />
                        </div>
                        {factor.custom && (
                          <button
                            type="button"
                            onClick={() => removeFactor(idx)}
                            className="text-red-600 hover:text-red-800 px-1"
                            title="Faktor entfernen"
                          >
                            X
                          </button>
                        )}
                        {factor.learnable && (
                          <span className="text-blue-500 text-[10px]" title="Wird durch ML angepasst">ML</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Neuen Faktor hinzufügen */}
                  {showAddFactor ? (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                      <div className="text-xs font-medium mb-2">Neuen Faktor hinzufügen:</div>
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Name (z.B. 'Evakuierung')"
                          value={newFactor.name}
                          onChange={(e) => setNewFactor(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-2 py-1 border rounded text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Keywords (kommagetrennt, z.B. 'evakuieren, räumung, verlassen')"
                          value={newFactor.keywords}
                          onChange={(e) => setNewFactor(prev => ({ ...prev, keywords: e.target.value }))}
                          className="w-full px-2 py-1 border rounded text-xs"
                        />
                        <div className="flex items-center gap-2">
                          <label className="text-xs">Gewicht:</label>
                          <input
                            type="number"
                            min="-1"
                            max="2"
                            step="0.05"
                            value={newFactor.weight}
                            onChange={(e) => setNewFactor(prev => ({ ...prev, weight: e.target.value }))}
                            className="w-20 px-2 py-1 border rounded text-xs"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={addCustomFactor}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs"
                          >
                            Hinzufügen
                          </button>
                          <button
                            type="button"
                            onClick={() => { setShowAddFactor(false); setNewFactor({ name: "", keywords: "", weight: 0.2 }); }}
                            className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs"
                          >
                            Abbrechen
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAddFactor(true)}
                      className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
                    >
                      + Eigenen Faktor hinzufügen
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* R3: Trends-Erkennung */}
            <div className={`border rounded p-3 ${currentRules.rules.R3_TRENDS_ERKENNUNG?.enabled ? "bg-green-50 border-green-200" : "bg-gray-50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {editMode ? (
                    <input
                      type="checkbox"
                      checked={currentRules.rules.R3_TRENDS_ERKENNUNG?.enabled || false}
                      onChange={() => toggleRuleEnabled("R3_TRENDS_ERKENNUNG")}
                      className="w-4 h-4"
                    />
                  ) : (
                    currentRules.rules.R3_TRENDS_ERKENNUNG?.enabled ? (
                      <span className="text-green-600 font-bold">ON</span>
                    ) : (
                      <span className="text-gray-400">OFF</span>
                    )
                  )}
                  <span className="font-medium">R3 Trends-Erkennung</span>
                </div>
                {editMode && currentRules.rules.R3_TRENDS_ERKENNUNG?.enabled && (
                  <div className="flex items-center gap-2 text-xs">
                    <label>Prognose-Horizont (Min):</label>
                    <input
                      type="number"
                      min="30"
                      max="480"
                      step="30"
                      value={currentRules.rules.R3_TRENDS_ERKENNUNG?.output?.forecast_horizon_minutes || 120}
                      onChange={(e) => updateRuleOutput("R3_TRENDS_ERKENNUNG", "forecast_horizon_minutes", parseInt(e.target.value) || 120)}
                      className="w-20 px-2 py-1 border rounded"
                    />
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {currentRules.rules.R3_TRENDS_ERKENNUNG?.description}
              </div>
            </div>

            {/* R4: Ressourcen-Status */}
            <div className={`border rounded p-3 ${currentRules.rules.R4_RESSOURCEN_STATUS?.enabled ? "bg-green-50 border-green-200" : "bg-gray-50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {editMode ? (
                    <input
                      type="checkbox"
                      checked={currentRules.rules.R4_RESSOURCEN_STATUS?.enabled || false}
                      onChange={() => toggleRuleEnabled("R4_RESSOURCEN_STATUS")}
                      className="w-4 h-4"
                    />
                  ) : (
                    currentRules.rules.R4_RESSOURCEN_STATUS?.enabled ? (
                      <span className="text-green-600 font-bold">ON</span>
                    ) : (
                      <span className="text-gray-400">OFF</span>
                    )
                  )}
                  <span className="font-medium">R4 Ressourcen-Status</span>
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {currentRules.rules.R4_RESSOURCEN_STATUS?.description}
              </div>
            </div>

            {/* R5: Stabs-Fokus */}
            <div className={`border rounded p-3 ${currentRules.rules.R5_STABS_FOKUS?.enabled ? "bg-green-50 border-green-200" : "bg-gray-50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {editMode ? (
                    <input
                      type="checkbox"
                      checked={currentRules.rules.R5_STABS_FOKUS?.enabled || false}
                      onChange={() => toggleRuleEnabled("R5_STABS_FOKUS")}
                      className="w-4 h-4"
                    />
                  ) : (
                    currentRules.rules.R5_STABS_FOKUS?.enabled ? (
                      <span className="text-green-600 font-bold">ON</span>
                    ) : (
                      <span className="text-gray-400">OFF</span>
                    )
                  )}
                  <span className="font-medium">R5 Stabs-Fokus</span>
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {currentRules.rules.R5_STABS_FOKUS?.description}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Szenario-Konfiguration */}
      <div className="border rounded p-4 bg-blue-50">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium text-base">Szenario-Konfiguration</div>
          {!editingScenario ? (
            <button
              onClick={() => setEditingScenario(true)}
              disabled={locked}
              className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              Bearbeiten
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={saveScenario}
                disabled={savingScenario}
                className="text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
              >
                {savingScenario ? "..." : "Speichern"}
              </button>
              <button
                onClick={() => {
                  setEditedScenario(scenario || {});
                  setEditingScenario(false);
                }}
                className="text-xs px-2 py-1 bg-gray-400 text-white rounded hover:bg-gray-500"
              >
                Abbrechen
              </button>
            </div>
          )}
        </div>

        {editingScenario ? (
          <div className="grid gap-3 text-sm">
            <div>
              <label className="block text-gray-600 mb-1">Art des Ereignisses:</label>
              <select
                value={editedScenario.artDesEreignisses || ""}
                onChange={(e) => setEditedScenario({...editedScenario, artDesEreignisses: e.target.value})}
                className="w-full p-2 border rounded text-sm"
              >
                <option value="">-- Bitte wählen --</option>
                <option value="Hochwasser">Hochwasser</option>
                <option value="Sturm">Sturm</option>
                <option value="Schnee">Schnee/Winterdienst</option>
                <option value="Brand">Brand/Waldbrand</option>
                <option value="Mure">Mure/Hangrutschung</option>
                <option value="Verkehrsunfall">Verkehrsunfall (groß)</option>
                <option value="Technischer Einsatz">Technischer Einsatz</option>
                <option value="Sonstiges">Sonstiges</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Geografischer Bereich:</label>
              <input
                type="text"
                value={editedScenario.geografischerBereich || ""}
                onChange={(e) => setEditedScenario({...editedScenario, geografischerBereich: e.target.value})}
                placeholder="z.B. Bezirk Feldkirchen"
                className="w-full p-2 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Wetter (optional):</label>
              <input
                type="text"
                value={editedScenario.wetter || ""}
                onChange={(e) => setEditedScenario({...editedScenario, wetter: e.target.value})}
                placeholder="z.B. Dauerregen, starker Wind"
                className="w-full p-2 border rounded text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <div>
              <span className="text-gray-600">Art des Ereignisses:</span>{" "}
              <strong>{scenario?.artDesEreignisses || "Nicht definiert"}</strong>
            </div>
            <div>
              <span className="text-gray-600">Geografischer Bereich:</span>{" "}
              {scenario?.geografischerBereich || "Nicht definiert"}
            </div>
            {scenario?.wetter && (
              <div>
                <span className="text-gray-600">Wetter:</span>{" "}
                {scenario.wetter}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Letzte Analyse-Details */}
      {lastAnalysis ? (
        <div className="border rounded p-4 bg-gray-50">
          <div className="font-medium text-base mb-3">Letzte Analyse-Details</div>

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
          <div className="font-medium text-base mb-3">Angewendete Regeln</div>

          <div className="space-y-2">
            {/* R1: Abschnitte-Priorität */}
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                {appliedRules.R1_ABSCHNITTE?.enabled ? (
                  <span className="text-green-600 font-bold">OK</span>
                ) : (
                  <span className="text-gray-400">-</span>
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
                  <span className="text-green-600 font-bold">OK</span>
                ) : (
                  <span className="text-gray-400">-</span>
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
                  <span className="text-green-600 font-bold">OK</span>
                ) : (
                  <span className="text-gray-400">-</span>
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
                  <span className="text-green-600 font-bold">OK</span>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
                <span className={appliedRules.R4_RESSOURCEN?.enabled ? "" : "text-gray-400"}>
                  R4 Ressourcen-Status
                </span>
              </div>
              {appliedRules.R4_RESSOURCEN?.enabled && (
                <div className="text-xs text-gray-600">
                  {appliedRules.R4_RESSOURCEN.utilization}% Auslastung
                  {appliedRules.R4_RESSOURCEN.shortage && (
                    <span className="text-red-600 ml-2">Engpass!</span>
                  )}
                </div>
              )}
            </div>

            {/* R5: Stabs-Fokus */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {appliedRules.R5_STABS_FOKUS?.enabled ? (
                  <span className="text-green-600 font-bold">OK</span>
                ) : (
                  <span className="text-gray-400">-</span>
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
          <div className="font-medium text-base mb-3">Gelernte Gewichte</div>

          {learnedWeights.protocol_factors && Object.keys(learnedWeights.protocol_factors).length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Protokoll-Faktoren:</div>
              {Object.entries(learnedWeights.protocol_factors).map(([name, data]) => (
                <div key={name} className="border-l-2 border-blue-400 pl-3 py-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-xs text-gray-600">
                      {data.initial_weight?.toFixed(2)} -> {data.current_weight?.toFixed(2)}
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
            loadRules();
          }}
        >
          Aktualisieren
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-700 text-white"
          onClick={() => setShowHelp(true)}
        >
          Hilfe zur Regel-Erstellung
        </button>
      </div>

      <div className="text-xs text-gray-500 mt-4 pt-4 border-t">
        <strong>Info:</strong> Das Hybrid-Filtersystem kombiniert regelbasierte Filterung (R1-R5) mit
        Context-Fingerprinting und maschinellem Lernen. Gelernte Gewichte werden automatisch basierend
        auf Feedback angepasst und bleiben über Neustarts hinweg erhalten.
      </div>

      {/* Hilfe-Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Hilfe: Filterregeln konfigurieren</h2>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="px-6 py-4 space-y-6">
              {/* Einführung */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Was sind Filterregeln?</h3>
                <p className="text-sm text-gray-700">
                  Filterregeln bestimmen, welche Informationen dem KI-Chatbot zur Verfügung gestellt werden.
                  Sie helfen dabei, die relevantesten Daten auszuwählen und unwichtige Informationen auszublenden.
                  So erhält der Chatbot genau die Informationen, die er braucht, um hilfreiche Antworten zu geben.
                </p>
              </div>

              {/* Die 5 Regeln */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Die 5 Standard-Regeln</h3>

                <div className="space-y-4">
                  <div className="border rounded p-3 bg-green-50">
                    <h4 className="font-medium text-green-800">R1: Abschnitte-Priorität</h4>
                    <p className="text-sm text-gray-700 mt-1">
                      Sortiert und filtert Einsatz-Abschnitte nach Wichtigkeit. Abschnitte mit kritischen
                      Einsätzen, vielen Einsätzen oder viel Personal werden priorisiert.
                    </p>
                    <div className="mt-2 text-xs text-gray-600">
                      <strong>Einstellung:</strong> "Max Abschnitte" bestimmt, wie viele Abschnitte maximal angezeigt werden.
                    </div>
                  </div>

                  <div className="border rounded p-3 bg-blue-50">
                    <h4 className="font-medium text-blue-800">R2: Protokoll-Relevanz</h4>
                    <p className="text-sm text-gray-700 mt-1">
                      Bewertet Protokoll-Einträge nach Relevanz anhand von Schlüsselwörtern.
                      Einträge mit Fragen, dringenden Meldungen oder Ressourcen-Anfragen werden höher bewertet.
                    </p>
                    <div className="mt-2 text-xs text-gray-600">
                      <strong>Einstellungen:</strong>
                      <ul className="list-disc ml-4 mt-1">
                        <li>"Max Einträge" - Maximale Anzahl der Protokoll-Einträge</li>
                        <li>"Min Score" - Mindest-Relevanz (0-1). Höher = nur sehr relevante Einträge</li>
                      </ul>
                    </div>
                  </div>

                  <div className="border rounded p-3 bg-purple-50">
                    <h4 className="font-medium text-purple-800">R3: Trends-Erkennung</h4>
                    <p className="text-sm text-gray-700 mt-1">
                      Erkennt Entwicklungstrends im Einsatzgeschehen (steigend, stabil, fallend)
                      und erstellt Prognosen für die kommenden Stunden.
                    </p>
                    <div className="mt-2 text-xs text-gray-600">
                      <strong>Einstellung:</strong> "Prognose-Horizont" bestimmt, wie weit in die Zukunft prognostiziert wird (in Minuten).
                    </div>
                  </div>

                  <div className="border rounded p-3 bg-orange-50">
                    <h4 className="font-medium text-orange-800">R4: Ressourcen-Status</h4>
                    <p className="text-sm text-gray-700 mt-1">
                      Analysiert die Auslastung der verfügbaren Ressourcen (Fahrzeuge, Personal)
                      und erkennt Engpässe automatisch.
                    </p>
                  </div>

                  <div className="border rounded p-3 bg-gray-100">
                    <h4 className="font-medium text-gray-800">R5: Stabs-Fokus (Standard: AUS)</h4>
                    <p className="text-sm text-gray-700 mt-1">
                      Spezialansicht für Stabsarbeit. Aggregiert Daten auf Abschnitts-Ebene und
                      zeigt nur kritische Einzeleinsätze an. Für strategische Übersicht statt operative Details.
                    </p>
                  </div>
                </div>
              </div>

              {/* Anleitung: Regeln aktivieren/deaktivieren */}
              <div>
                <h3 className="text-lg font-semibold mb-2">So aktivieren/deaktivieren Sie Regeln</h3>
                <ol className="list-decimal ml-5 text-sm text-gray-700 space-y-2">
                  <li>Klicken Sie auf den Button <strong>"Bearbeiten"</strong> oben rechts im Regel-Bereich</li>
                  <li>Setzen oder entfernen Sie das Häkchen bei der gewünschten Regel</li>
                  <li>Klicken Sie auf <strong>"Speichern"</strong> um die Änderungen zu übernehmen</li>
                </ol>
              </div>

              {/* Anleitung: Parameter anpassen */}
              <div>
                <h3 className="text-lg font-semibold mb-2">So passen Sie Regel-Parameter an</h3>
                <ol className="list-decimal ml-5 text-sm text-gray-700 space-y-2">
                  <li>Klicken Sie auf <strong>"Bearbeiten"</strong></li>
                  <li>Bei aktivierten Regeln erscheinen Eingabefelder für die Parameter</li>
                  <li>Ändern Sie die Werte nach Bedarf:
                    <ul className="list-disc ml-5 mt-1">
                      <li><strong>Max Abschnitte/Einträge:</strong> Weniger = kompaktere Übersicht, mehr = detailliertere Information</li>
                      <li><strong>Min Score:</strong> 0.0 bis 1.0 - Je höher, desto strenger die Filterung</li>
                      <li><strong>Prognose-Horizont:</strong> In Minuten, z.B. 120 = 2 Stunden Vorausschau</li>
                    </ul>
                  </li>
                  <li>Klicken Sie auf <strong>"Speichern"</strong></li>
                </ol>
              </div>

              {/* Anleitung: Eigene Keyword-Faktoren */}
              <div>
                <h3 className="text-lg font-semibold mb-2">So fügen Sie eigene Schlüsselwörter hinzu (R2)</h3>
                <p className="text-sm text-gray-700 mb-3">
                  Sie können eigene Begriffe definieren, die Protokoll-Einträge als wichtig markieren sollen.
                  Das ist nützlich für organisationsspezifische Begriffe oder aktuelle Ereignisse.
                </p>
                <ol className="list-decimal ml-5 text-sm text-gray-700 space-y-2">
                  <li>Klicken Sie auf <strong>"Bearbeiten"</strong></li>
                  <li>Scrollen Sie zur Regel <strong>R2 Protokoll-Relevanz</strong></li>
                  <li>Klicken Sie auf <strong>"+ Eigenen Faktor hinzufügen"</strong></li>
                  <li>Geben Sie einen <strong>Namen</strong> ein (z.B. "Evakuierung")</li>
                  <li>Geben Sie <strong>Schlüsselwörter</strong> kommagetrennt ein (z.B. "evakuieren, räumung, verlassen, evakuierung")</li>
                  <li>Stellen Sie das <strong>Gewicht</strong> ein:
                    <ul className="list-disc ml-5 mt-1">
                      <li><strong>0.1 - 0.2:</strong> Niedrige Priorität (leichte Erhöhung der Relevanz)</li>
                      <li><strong>0.3 - 0.4:</strong> Mittlere Priorität (deutliche Erhöhung)</li>
                      <li><strong>0.5+:</strong> Hohe Priorität (starke Erhöhung)</li>
                      <li><strong>Negative Werte:</strong> Verringert die Relevanz (z.B. für unwichtige Routine-Meldungen)</li>
                    </ul>
                  </li>
                  <li>Klicken Sie auf <strong>"Hinzufügen"</strong> und dann <strong>"Speichern"</strong></li>
                </ol>
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                  <strong>Beispiele für nützliche eigene Faktoren:</strong>
                  <ul className="list-disc ml-5 mt-1">
                    <li><strong>Evakuierung</strong> (evakuieren, räumung, verlassen) - Gewicht: 0.5</li>
                    <li><strong>Verletzte</strong> (verletzte, verletzt, sanitäter, rettung) - Gewicht: 0.4</li>
                    <li><strong>Routine</strong> (routinemeldung, standard, planmäßig) - Gewicht: -0.2</li>
                  </ul>
                </div>
              </div>

              {/* Maschinelles Lernen */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Maschinelles Lernen (ML)</h3>
                <p className="text-sm text-gray-700">
                  Faktoren mit dem <span className="text-blue-500 font-medium">ML</span>-Symbol werden automatisch
                  durch Benutzer-Feedback verbessert. Wenn Chatbot-Antworten als hilfreich oder nicht hilfreich
                  markiert werden, passt das System die Gewichte dieser Faktoren automatisch an.
                </p>
                <p className="text-sm text-gray-700 mt-2">
                  Die <strong>"Gelernte Gewichte"</strong> Sektion zeigt, wie sich die Gewichte durch Feedback
                  verändert haben. Mit <strong>"Gelernte Gewichte zurücksetzen"</strong> können Sie alle
                  Anpassungen rückgängig machen.
                </p>
              </div>

              {/* Tipps */}
              <div className="bg-blue-50 border border-blue-200 rounded p-4">
                <h3 className="text-lg font-semibold mb-2 text-blue-800">Tipps für optimale Einstellungen</h3>
                <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
                  <li>Beginnen Sie mit den <strong>Standard-Einstellungen</strong> und passen Sie nach Bedarf an</li>
                  <li>Bei <strong>großen Einsatzlagen</strong>: Reduzieren Sie Max-Werte für kompaktere Übersicht</li>
                  <li>Bei <strong>wenig Einsätzen</strong>: Erhöhen Sie Max-Werte für mehr Details</li>
                  <li>Der <strong>Min Score</strong> bei R2 sollte zwischen 0.5 und 0.7 liegen</li>
                  <li>Aktivieren Sie <strong>R5 Stabs-Fokus</strong> nur für strategische Stabsarbeit</li>
                  <li>Testen Sie Änderungen im <strong>Chatbot</strong> um die Auswirkungen zu sehen</li>
                </ul>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t px-6 py-4">
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
