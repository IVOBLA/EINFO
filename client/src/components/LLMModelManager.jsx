import React, { useEffect, useState } from "react";

/**
 * LLMModelManager - Komponente zur Verwaltung der KI-Modellzuordnung
 *
 * Ermöglicht:
 * - Anzeige verfügbarer Modelle und deren Konfiguration
 * - Task-spezifische Modellzuordnung (start, operations, chat, default)
 * - Globales Modell-Override
 * - Modell-Testing
 */
export default function LLMModelManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Modell-Daten
  const [config, setConfig] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [profiles, setProfiles] = useState([]);

  // Lokale Änderungen
  const [taskModels, setTaskModels] = useState({
    start: "",
    operations: "",
    chat: "",
    default: ""
  });
  const [activeModel, setActiveModel] = useState("auto");

  // Test-Dialog
  const [testingModel, setTestingModel] = useState(null);
  const [testQuestion, setTestQuestion] = useState("Was ist 2+2?");
  const [testResult, setTestResult] = useState(null);
  const [testRunning, setTestRunning] = useState(false);

  // Daten laden
  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setErr("");
    try {
      // Config laden
      const configRes = await fetch("/api/llm/config", { credentials: "include" });
      const configData = await configRes.json();
      if (!configRes.ok) throw new Error(configData.error || "Fehler beim Laden der Config");
      setConfig(configData);

      // Lokale States mit Server-Daten synchronisieren
      setTaskModels(configData.taskModels || {});
      setActiveModel(configData.activeModel || "auto");

      // Ollama-Modelle laden
      const modelsRes = await fetch("/api/llm/models", { credentials: "include" });
      const modelsData = await modelsRes.json();
      if (!modelsRes.ok) throw new Error(modelsData.error || "Fehler beim Laden der Modelle");
      setOllamaModels(modelsData.models || []);

      // Profile laden
      const profilesRes = await fetch("/api/llm/profiles", { credentials: "include" });
      const profilesData = await profilesRes.json();
      if (!profilesRes.ok) throw new Error(profilesData.error || "Fehler beim Laden der Profile");
      setProfiles(profilesData.profiles || []);

    } catch (ex) {
      setErr(ex.message || "Fehler beim Laden der Daten");
    } finally {
      setLoading(false);
    }
  }

  async function saveTaskModel(taskType, modelKey) {
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/llm/task-model", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType, modelKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Speichern");

      setMsg(`Task "${taskType}" → Modell "${modelKey}" gespeichert`);
      await loadAll();
    } catch (ex) {
      setErr(ex.message || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function saveActiveModel(modelKey) {
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/llm/model", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Speichern");

      setMsg(`Globales Modell auf "${modelKey}" gesetzt`);
      await loadAll();
    } catch (ex) {
      setErr(ex.message || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function testModel(modelName) {
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/llm/test-model", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          question: testQuestion
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test fehlgeschlagen");

      setTestResult(data);
    } catch (ex) {
      setTestResult({ error: ex.message || "Test fehlgeschlagen" });
    } finally {
      setTestRunning(false);
    }
  }

  if (loading) {
    return <div className="p-4 text-gray-500">Lade Modell-Konfiguration…</div>;
  }

  if (!config) {
    return <div className="p-4 text-red-600">Fehler: Keine Konfiguration geladen</div>;
  }

  const availableModels = config.models || {};
  const modelKeys = Object.keys(availableModels);

  return (
    <div className="space-y-6">
      {/* Status-Meldungen */}
      {err && <div className="text-rose-700 text-sm">{err}</div>}
      {msg && <div className="text-emerald-700 text-sm">{msg}</div>}

      {/* 1. Globales Modell-Override */}
      <div className="border rounded p-4 bg-gray-50">
        <h3 className="font-medium mb-3">Globales Modell-Override</h3>
        <div className="text-xs text-gray-600 mb-3">
          Wenn nicht "auto", wird dieses Modell für ALLE Tasks verwendet (überschreibt task-spezifische Zuordnung).
        </div>
        <div className="flex items-center gap-3">
          <select
            className="border rounded px-3 py-2 flex-1"
            value={activeModel}
            onChange={(e) => setActiveModel(e.target.value)}
            disabled={saving}
          >
            <option value="auto">auto (task-spezifisch)</option>
            {modelKeys.map((key) => (
              <option key={key} value={key}>
                {key} ({availableModels[key].name})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
            onClick={() => saveActiveModel(activeModel)}
            disabled={saving || activeModel === config.activeModel}
          >
            Speichern
          </button>
        </div>
        {config.activeModel !== "auto" && (
          <div className="mt-2 text-sm text-amber-700">
            ⚠️ Aktuell aktiv: <b>{config.activeModel}</b> - Task-spezifische Zuordnungen werden ignoriert!
          </div>
        )}
      </div>

      {/* 2. Task-spezifische Modellzuordnung */}
      <div className="border rounded p-4">
        <h3 className="font-medium mb-3">Task-spezifische Modellzuordnung</h3>
        <div className="text-xs text-gray-600 mb-3">
          Ordne jedem Task-Typ ein Modell-Profil zu. Nur aktiv wenn globales Override = "auto".
        </div>

        <div className="space-y-3">
          {[
            { key: "start", label: "Start (Erstes Szenario)", description: "Wird beim Erstellen eines neuen Szenarios verwendet" },
            { key: "operations", label: "Operations (Laufende Simulation)", description: "Wird während der Simulation für Operationen verwendet" },
            { key: "chat", label: "Chat (QA-Chat)", description: "Wird für Fragen & Antworten im Chat verwendet" },
            { key: "analysis", label: "Analysis (KI-Situationsanalyse)", description: "Wird für die automatische Situationsanalyse und Handlungsempfehlungen verwendet" },
            { key: "default", label: "Default (Fallback)", description: "Fallback für alle nicht-spezifizierten Tasks" }
          ].map((task) => (
            <div key={task.key} className="flex items-start gap-3 pb-3 border-b last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">{task.label}</div>
                <div className="text-xs text-gray-500">{task.description}</div>
              </div>
              <select
                className="border rounded px-3 py-2 min-w-[200px]"
                value={taskModels[task.key] || "balanced"}
                onChange={(e) => setTaskModels((prev) => ({ ...prev, [task.key]: e.target.value }))}
                disabled={saving}
              >
                {modelKeys.map((key) => (
                  <option key={key} value={key}>
                    {key} ({availableModels[key].name})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm"
                onClick={() => saveTaskModel(task.key, taskModels[task.key])}
                disabled={saving || taskModels[task.key] === config.taskModels[task.key]}
              >
                Speichern
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Verfügbare Modell-Profile */}
      <div className="border rounded p-4">
        <h3 className="font-medium mb-3">Verfügbare Modell-Profile</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Profil-Key</th>
                <th className="px-3 py-2 text-left">Modellname</th>
                <th className="px-3 py-2 text-left">Beschreibung</th>
                <th className="px-3 py-2 text-left">Temperatur</th>
                <th className="px-3 py-2 text-left">Timeout</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {modelKeys.map((key) => {
                const model = availableModels[key];
                return (
                  <tr key={key} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-medium">{key}</td>
                    <td className="px-3 py-2 font-mono text-xs">{model.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{model.description || "–"}</td>
                    <td className="px-3 py-2 text-xs">{model.temperature ?? "–"}</td>
                    <td className="px-3 py-2 text-xs">{model.timeout ? `${model.timeout / 1000}s` : "–"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-blue-600 hover:text-blue-800 text-xs"
                        onClick={() => setTestingModel(model.name)}
                      >
                        Testen
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Ollama-Modelle */}
      <div className="border rounded p-4">
        <h3 className="font-medium mb-3">Verfügbare Ollama-Modelle</h3>
        <div className="text-xs text-gray-600 mb-3">
          Diese Modelle sind in Ollama verfügbar. Um sie zu verwenden, müssen sie in der .env Datei konfiguriert werden.
        </div>
        {ollamaModels.length === 0 ? (
          <div className="text-sm text-gray-500">Keine Modelle gefunden oder Ollama nicht erreichbar</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Größe</th>
                  <th className="px-3 py-2 text-left">Geändert</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {ollamaModels.map((model) => (
                  <tr key={model.name} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">{model.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {model.size ? `${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB` : "–"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {model.modified_at ? new Date(model.modified_at).toLocaleString("de-AT", { hour12: false }) : "–"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-blue-600 hover:text-blue-800 text-xs"
                        onClick={() => setTestingModel(model.name)}
                      >
                        Testen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Test-Dialog */}
      {testingModel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-lg">Modell testen: {testingModel}</h3>
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    setTestingModel(null);
                    setTestResult(null);
                  }}
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Testfrage</label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-2"
                  value={testQuestion}
                  onChange={(e) => setTestQuestion(e.target.value)}
                  disabled={testRunning}
                />
              </div>

              <button
                type="button"
                className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                onClick={() => testModel(testingModel)}
                disabled={testRunning || !testQuestion.trim()}
              >
                {testRunning ? "Teste..." : "Test starten"}
              </button>

              {testResult && (
                <div className="border rounded p-4 bg-gray-50">
                  {testResult.error ? (
                    <div className="text-red-600">
                      <div className="font-medium">Fehler:</div>
                      <div className="text-sm mt-1">{testResult.error}</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-gray-600 mb-1">Antwort:</div>
                        <div className="text-sm whitespace-pre-wrap">{testResult.answer}</div>
                      </div>
                      {testResult.duration && (
                        <div className="text-xs text-gray-500">
                          Dauer: {testResult.duration}ms
                        </div>
                      )}
                      {testResult.gpuStatus && (
                        <div className="text-xs text-gray-500">
                          GPU: {testResult.gpuStatus.available ? "✓ Verfügbar" : "✗ Nicht verfügbar"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Aktions-Buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          className="px-4 py-2 border rounded hover:bg-gray-50"
          onClick={loadAll}
          disabled={loading || saving}
        >
          Neu laden
        </button>
      </div>
    </div>
  );
}
