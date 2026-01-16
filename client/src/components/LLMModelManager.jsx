import React, { useEffect, useState, useRef } from "react";
import { buildChatbotApiUrl, CHATBOT_SERVER_ERROR_MESSAGE } from "../utils/http.js";

/**
 * SVG-basierter Linien-Graph für GPU-Metriken
 */
function MetricsGraph({ data, dataKey, label, unit, color, minY = 0, maxY = 100, height = 120 }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-xs text-gray-500 text-center py-4">
        Keine Daten verfügbar
      </div>
    );
  }

  const width = 400;
  const padding = { top: 20, right: 50, bottom: 30, left: 50 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // Zeitbereich berechnen
  const maxTime = Math.max(...data.map(d => d.timestamp));
  const minTime = 0;
  const timeRange = maxTime - minTime || 1;

  // Y-Bereich aus Daten berechnen (mit Puffer)
  const values = data.map(d => d[dataKey]).filter(v => v !== null && v !== undefined);
  if (values.length === 0) {
    return (
      <div className="text-xs text-gray-500 text-center py-4">
        Keine {label}-Daten
      </div>
    );
  }

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const yMin = Math.min(minY, dataMin * 0.9);
  const yMax = Math.max(maxY, dataMax * 1.1);
  const yRange = yMax - yMin || 1;

  // Koordinaten berechnen
  const points = data
    .filter(d => d[dataKey] !== null && d[dataKey] !== undefined)
    .map(d => {
      const x = padding.left + (d.timestamp - minTime) / timeRange * graphWidth;
      const y = padding.top + graphHeight - ((d[dataKey] - yMin) / yRange * graphHeight);
      return { x, y, value: d[dataKey], time: d.timestamp };
    });

  // SVG-Pfad erstellen
  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Bereich unter der Linie füllen
  const areaPath = pathData + ` L ${points[points.length - 1].x} ${padding.top + graphHeight} L ${points[0].x} ${padding.top + graphHeight} Z`;

  // Y-Achsen-Ticks
  const yTicks = [yMin, yMin + yRange / 2, yMax].map(v => ({
    value: Math.round(v),
    y: padding.top + graphHeight - ((v - yMin) / yRange * graphHeight)
  }));

  // X-Achsen-Ticks (Zeit in Sekunden)
  const xTicks = [];
  const tickInterval = Math.ceil(maxTime / 4000) * 1000; // Runde auf Sekunden
  for (let t = 0; t <= maxTime; t += tickInterval || 2000) {
    xTicks.push({
      value: (t / 1000).toFixed(0) + "s",
      x: padding.left + (t - minTime) / timeRange * graphWidth
    });
  }

  return (
    <div className="bg-gray-900 rounded p-2">
      <div className="text-xs text-gray-400 mb-1 flex justify-between">
        <span>{label}</span>
        <span>
          Min: {Math.round(dataMin)}{unit} | Max: {Math.round(dataMax)}{unit}
        </span>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Hintergrund-Gitter */}
        {yTicks.map((tick, i) => (
          <line
            key={`grid-y-${i}`}
            x1={padding.left}
            y1={tick.y}
            x2={width - padding.right}
            y2={tick.y}
            stroke="#374151"
            strokeWidth="1"
            strokeDasharray="4,4"
          />
        ))}

        {/* Fläche unter der Linie */}
        <path d={areaPath} fill={color} fillOpacity="0.2" />

        {/* Hauptlinie */}
        <path d={pathData} fill="none" stroke={color} strokeWidth="2" />

        {/* Datenpunkte */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            fill={color}
            stroke="#1f2937"
            strokeWidth="1"
          >
            <title>{p.value}{unit} @ {(p.time / 1000).toFixed(1)}s</title>
          </circle>
        ))}

        {/* Y-Achse */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + graphHeight}
          stroke="#4B5563"
          strokeWidth="1"
        />
        {yTicks.map((tick, i) => (
          <text
            key={`y-${i}`}
            x={padding.left - 8}
            y={tick.y + 4}
            fontSize="10"
            fill="#9CA3AF"
            textAnchor="end"
          >
            {tick.value}{unit}
          </text>
        ))}

        {/* X-Achse */}
        <line
          x1={padding.left}
          y1={padding.top + graphHeight}
          x2={width - padding.right}
          y2={padding.top + graphHeight}
          stroke="#4B5563"
          strokeWidth="1"
        />
        {xTicks.map((tick, i) => (
          <text
            key={`x-${i}`}
            x={tick.x}
            y={padding.top + graphHeight + 15}
            fontSize="10"
            fill="#9CA3AF"
            textAnchor="middle"
          >
            {tick.value}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * LLMModelManager - Task-basierte LLM-Konfiguration mit GPU/CPU/RAM-Monitoring
 *
 * Features:
 * - Task-spezifische Parameter (model, temperature, maxTokens, timeout, numGpu, numCtx, topP, topK, repeatPenalty)
 * - Globales Modell-Override
 * - Live GPU-Monitoring (Auslastung, Temperatur, VRAM)
 * - Live System-Monitoring (CPU-Auslastung, Arbeitsspeicher)
 * - Verfügbare Ollama-Modelle
 * - Modell-Testing mit GPU/CPU/RAM-Metriken-Verlauf
 */
export default function LLMModelManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // taskType beim Speichern
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [retrying, setRetrying] = useState(false); // Retry-Status bei Netzwerkfehlern

  // Config-Daten
  const [globalModelOverride, setGlobalModelOverride] = useState(null);
  const [tasks, setTasks] = useState({});
  const [ollamaModels, setOllamaModels] = useState([]);

  // GPU-Status
  const [gpuStatus, setGpuStatus] = useState(null);
  const [gpuLoading, setGpuLoading] = useState(false);

  // System-Status (CPU + RAM)
  const [systemStatus, setSystemStatus] = useState(null);

  // GPU-Historie für Liniendiagramme
  const [gpuHistory, setGpuHistory] = useState([]);
  const historyStartTimeRef = useRef(null); // useRef statt useState für Closure-Problem
  const [historyTimeRange, setHistoryTimeRange] = useState(300); // in Sekunden (default: 5 Min)
  const [updateInterval, setUpdateInterval] = useState(5000); // in Millisekunden (default: 5s)

  // Refs für aktuelle Werte in Closures
  const updateIntervalRef = useRef(updateInterval);
  const historyTimeRangeRef = useRef(historyTimeRange);
  useEffect(() => { updateIntervalRef.current = updateInterval; }, [updateInterval]);
  useEffect(() => { historyTimeRangeRef.current = historyTimeRange; }, [historyTimeRange]);

  // Lokale Änderungen (Draft)
  const [taskDrafts, setTaskDrafts] = useState({});

  // Test-Dialog
  const [testingModel, setTestingModel] = useState(null);
  const [testQuestion, setTestQuestion] = useState("Was ist 2+2?");
  const [testResult, setTestResult] = useState(null);
  const [testRunning, setTestRunning] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState(""); // Live-gestreamte Antwort

  // Daten laden mit Auto-Retry bei Netzwerkfehlern
  useEffect(() => {
    loadAll();
    const gpuInterval = setInterval(loadGpuStatus, updateInterval); // GPU-Status mit gewähltem Intervall

    // Retry-Mechanismus: Versuche alle 3 Sekunden neu zu laden wenn Netzwerkfehler
    const retryInterval = setInterval(() => {
      if (retrying) {
        loadAll();
      }
    }, 3000);

    return () => {
      clearInterval(gpuInterval);
      clearInterval(retryInterval);
    };
  }, [retrying, updateInterval]);

  async function loadAll() {
    // Beim ersten Laden oder manuellen Reload: zeige Loading-Spinner
    // Bei Auto-Retry: zeige nur Retry-Meldung, kein Loading-Spinner
    if (!retrying) {
      setLoading(true);
    }
    setErr("");
    try {
      // Config laden
      const configRes = await fetch(buildChatbotApiUrl("/api/llm/config"), { credentials: "include" });
      const configData = await configRes.json();
      if (!configRes.ok) throw new Error(configData.error || "Fehler beim Laden der Config");

      setGlobalModelOverride(configData.globalModelOverride);
      setTasks(configData.tasks || {});
      setTaskDrafts(configData.tasks || {}); // Initialisiere Drafts

      // Ollama-Modelle laden
      const modelsRes = await fetch(buildChatbotApiUrl("/api/llm/models"), { credentials: "include" });
      const modelsData = await modelsRes.json();
      if (!modelsRes.ok) throw new Error(modelsData.error || "Fehler beim Laden der Modelle");
      setOllamaModels(modelsData.models || []);

      // GPU-Status initial laden
      await loadGpuStatus();

      // Erfolgreich geladen - stoppe Retry
      setRetrying(false);
    } catch (ex) {
      // NetworkError / TypeError indicates server not reachable
      if (ex instanceof TypeError || ex.name === "TypeError" ||
          (ex.message && ex.message.toLowerCase().includes("network"))) {
        setErr(CHATBOT_SERVER_ERROR_MESSAGE);
        setRetrying(true); // Aktiviere Auto-Retry
      } else {
        setErr(ex.message || "Fehler beim Laden der Daten");
        setRetrying(false); // Kein Auto-Retry bei anderen Fehlern
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadGpuStatus() {
    setGpuLoading(true);
    try {
      // GPU-Status laden
      const gpuRes = await fetch(buildChatbotApiUrl("/api/llm/gpu"), { credentials: "include" });
      const gpuData = await gpuRes.json();
      if (gpuRes.ok) {
        setGpuStatus(gpuData.gpuStatus);

        // Historie-Daten sammeln (nur wenn GPU verfügbar)
        if (gpuData.gpuStatus?.available && gpuData.gpuStatus?.gpus?.length > 0) {
          const gpu = gpuData.gpuStatus.gpus[0]; // Erste GPU
          const now = Date.now();

          // Wenn Historie noch nicht gestartet, setze Start-Zeit
          if (historyStartTimeRef.current === null) {
            historyStartTimeRef.current = now;
          }

          const timestamp = now - historyStartTimeRef.current;

          const newPoint = {
            timestamp,
            utilizationPercent: gpu.utilizationPercent,
            memoryUsedMb: gpu.memoryUsedMb,
            temperatureCelsius: gpu.temperatureCelsius
          };

          setGpuHistory((prev) => {
            // Neue Daten hinzufügen und auf gewählten Zeitraum begrenzen
            // maxPoints = timeRange (in Sekunden) / Intervall (in Sekunden)
            const intervalSeconds = updateIntervalRef.current / 1000;
            const maxPoints = Math.ceil(historyTimeRangeRef.current / intervalSeconds);
            const updated = [...prev, newPoint];
            return updated.slice(-maxPoints);
          });
        }
      }

      // System-Status laden (CPU + RAM)
      const sysRes = await fetch(buildChatbotApiUrl("/api/llm/system"), { credentials: "include" });
      const sysData = await sysRes.json();
      if (sysRes.ok) setSystemStatus(sysData.systemStatus);
    } catch {
      // Ignoriere Fehler beim Status-Laden
    } finally {
      setGpuLoading(false);
    }
  }

  async function saveGlobalModel() {
    setSaving("global");
    setErr("");
    setMsg("");
    try {
      const res = await fetch(buildChatbotApiUrl("/api/llm/global-model"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: globalModelOverride })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Speichern");

      setMsg(data.message || "Globales Modell gespeichert");
      await loadAll();
    } catch (ex) {
      if (ex instanceof TypeError || ex.name === "TypeError" ||
          (ex.message && ex.message.toLowerCase().includes("network"))) {
        setErr(CHATBOT_SERVER_ERROR_MESSAGE);
      } else {
        setErr(ex.message || "Fehler beim Speichern");
      }
    } finally {
      setSaving(null);
    }
  }

  async function saveTaskConfig(taskType) {
    setSaving(taskType);
    setErr("");
    setMsg("");
    try {
      const draft = taskDrafts[taskType];
      const res = await fetch(buildChatbotApiUrl("/api/llm/task-config"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType, updates: draft })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Speichern");

      setMsg(`Task "${taskType}" gespeichert`);
      await loadAll();
    } catch (ex) {
      if (ex instanceof TypeError || ex.name === "TypeError" ||
          (ex.message && ex.message.toLowerCase().includes("network"))) {
        setErr(CHATBOT_SERVER_ERROR_MESSAGE);
      } else {
        setErr(ex.message || "Fehler beim Speichern");
      }
    } finally {
      setSaving(null);
    }
  }

  async function testModel(modelName) {
    setTestRunning(true);
    setTestResult(null);
    setStreamingAnswer("");

    try {
      // Verwende SSE-Streaming-Endpunkt für Live-Antwort
      const res = await fetch(buildChatbotApiUrl("/api/llm/test-with-metrics-stream"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName, question: testQuestion })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Test fehlgeschlagen");
      }

      // SSE-Stream verarbeiten
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);

              // Token-Event: Live-Antwort aktualisieren
              if (data.token !== undefined) {
                setStreamingAnswer(prev => prev + data.token);
              }

              // Done-Event: Finale Ergebnisse setzen
              if (data.ok !== undefined && data.answer !== undefined) {
                setTestResult(data);
              }

              // Error-Event
              if (data.error !== undefined && data.ok === false) {
                setTestResult(data);
              }
            } catch {
              // Ignoriere ungültiges JSON
            }
          }
        }
      }
    } catch (ex) {
      if (ex instanceof TypeError || ex.name === "TypeError" ||
          (ex.message && ex.message.toLowerCase().includes("network"))) {
        setTestResult({ error: CHATBOT_SERVER_ERROR_MESSAGE });
      } else {
        setTestResult({ error: ex.message || "Test fehlgeschlagen" });
      }
    } finally {
      setTestRunning(false);
    }
  }

  function updateTaskDraft(taskType, field, value) {
    setTaskDrafts((prev) => ({
      ...prev,
      [taskType]: {
        ...prev[taskType],
        [field]: value
      }
    }));
  }

  function hasChanges(taskType) {
    const original = tasks[taskType];
    const draft = taskDrafts[taskType];
    if (!original || !draft) return false;
    return JSON.stringify(original) !== JSON.stringify(draft);
  }

  if (loading) {
    return <div className="p-4 text-gray-500">Lade Konfiguration…</div>;
  }

  const taskList = [
    { key: "start", label: "Start", description: "Erstes Szenario" },
    { key: "operations", label: "Operations", description: "Laufende Simulation" },
    { key: "chat", label: "Chat", description: "QA-Chat" },
    { key: "analysis", label: "Analysis", description: "KI-Situationsanalyse" },
    { key: "default", label: "Default", description: "Fallback" }
  ];

  return (
    <div className="space-y-6">
      {/* Status-Meldungen */}
      {err && (
        <div className="text-rose-700 text-sm bg-rose-50 p-3 rounded border border-rose-200">
          {err}
          {retrying && (
            <div className="mt-2 text-amber-700 flex items-center gap-2">
              <span className="animate-spin">⟳</span>
              <span>Versuche automatisch erneut, Verbindung herzustellen...</span>
            </div>
          )}
        </div>
      )}
      {msg && <div className="text-emerald-700 text-sm bg-emerald-50 p-3 rounded border border-emerald-200">{msg}</div>}

      {/* System-Status (GPU + CPU + RAM) */}
      <div className="border rounded p-4 bg-gradient-to-r from-gray-50 to-blue-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium flex items-center gap-2">
            <span className="text-xl">🖥️</span> System-Status
          </h3>
          <button
            type="button"
            className="text-xs px-2 py-1 border rounded hover:bg-white"
            onClick={loadGpuStatus}
            disabled={gpuLoading}
          >
            {gpuLoading ? "⟳" : "↻"} Aktualisieren
          </button>
        </div>

        <div className="space-y-3">
          {/* GPU-Status */}
          {gpuStatus && gpuStatus.available && gpuStatus.gpus ? (
            <>
              {gpuStatus.gpus.map((gpu, idx) => (
                <div key={idx} className="bg-white rounded p-3 border">
                  <div className="font-medium text-sm mb-2">{gpu.name}</div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-gray-500">GPU-Auslastung</div>
                      <div className="text-lg font-bold" style={{ color: gpu.utilizationPercent > 80 ? "#dc2626" : "#10b981" }}>
                        {gpu.utilizationPercent ?? "–"}%
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Temperatur</div>
                      <div className="text-lg font-bold" style={{ color: gpu.temperatureCelsius > 75 ? "#dc2626" : "#10b981" }}>
                        {gpu.temperatureCelsius ?? "–"}°C
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">VRAM</div>
                      <div className="text-lg font-bold">
                        {gpu.memoryUsedMb && gpu.memoryTotalMb
                          ? `${(gpu.memoryUsedMb / 1024).toFixed(1)} / ${(gpu.memoryTotalMb / 1024).toFixed(1)} GB`
                          : "–"}
                      </div>
                      {gpu.memoryUsedMb && gpu.memoryTotalMb && (
                        <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${(gpu.memoryUsedMb / gpu.memoryTotalMb) * 100}%`,
                              backgroundColor: (gpu.memoryUsedMb / gpu.memoryTotalMb) > 0.9 ? "#dc2626" : "#10b981"
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {gpuStatus.warning && (
                <div className="text-amber-700 text-xs bg-amber-50 p-2 rounded">⚠️ {gpuStatus.warning}</div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-500 bg-white rounded p-3 border">
              GPU: {gpuStatus?.error || "Nicht verfügbar"}
            </div>
          )}

          {/* CPU + RAM Status */}
          {systemStatus && systemStatus.available ? (
            <div className="bg-white rounded p-3 border">
              <div className="font-medium text-sm mb-2">System ({systemStatus.hostname})</div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-gray-500">CPU-Auslastung</div>
                  <div className="text-lg font-bold" style={{ color: systemStatus.cpu.usagePercent > 80 ? "#dc2626" : "#3b82f6" }}>
                    {systemStatus.cpu.usagePercent ?? "–"}%
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {systemStatus.cpu.count} Kerne
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Load Avg (1/5/15)</div>
                  <div className="text-sm font-medium mt-1">
                    {systemStatus.cpu.loadAverage?.oneMin ?? "–"} / {systemStatus.cpu.loadAverage?.fiveMin ?? "–"} / {systemStatus.cpu.loadAverage?.fifteenMin ?? "–"}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Arbeitsspeicher</div>
                  <div className="text-lg font-bold">
                    {systemStatus.memory.usedMb && systemStatus.memory.totalMb
                      ? `${(systemStatus.memory.usedMb / 1024).toFixed(1)} / ${(systemStatus.memory.totalMb / 1024).toFixed(1)} GB`
                      : "–"}
                  </div>
                  {systemStatus.memory.usedMb && systemStatus.memory.totalMb && (
                    <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${systemStatus.memory.usagePercent}%`,
                          backgroundColor: systemStatus.memory.usagePercent > 90 ? "#dc2626" : "#3b82f6"
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 bg-white rounded p-3 border">
              System: {systemStatus?.error || "Nicht verfügbar"}
            </div>
          )}

          {/* Liniendiagramme für GPU-Metriken über Zeit */}
          {gpuStatus?.available && gpuHistory.length > 0 && (
            <div className="space-y-3 mt-4">
              <div className="text-sm font-medium text-gray-700 mb-2 flex justify-between items-center">
                <span>
                  Verlauf (
                  {(() => {
                    const seconds = Math.floor((gpuHistory[gpuHistory.length - 1]?.timestamp || 0) / 1000);
                    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
                    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
                    return `${seconds}s`;
                  })()}
                  )
                </span>
                <div className="flex gap-2 items-center flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600">Intervall:</span>
                    <select
                      className="text-xs px-2 py-1 border rounded bg-white text-gray-700"
                      value={updateInterval}
                      onChange={(e) => {
                        const newInterval = Number(e.target.value);
                        setUpdateInterval(newInterval);
                        // Historie zurücksetzen bei Intervall-Änderung
                        setGpuHistory([]);
                        historyStartTimeRef.current = null;
                      }}
                    >
                      <option value={2000}>2s</option>
                      <option value={5000}>5s</option>
                      <option value={10000}>10s</option>
                      <option value={30000}>30s</option>
                      <option value={60000}>60s</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600">Zeitraum:</span>
                    <select
                      className="text-xs px-2 py-1 border rounded bg-white text-gray-700"
                      value={historyTimeRange}
                      onChange={(e) => {
                        const newRange = Number(e.target.value);
                        setHistoryTimeRange(newRange);
                        // Schneide Historie auf neue Länge zu
                        const intervalSeconds = updateInterval / 1000;
                        const maxPoints = Math.ceil(newRange / intervalSeconds);
                        setGpuHistory((prev) => prev.slice(-maxPoints));
                      }}
                    >
                      <option value={300}>5 Min</option>
                      <option value={900}>15 Min</option>
                      <option value={1800}>30 Min</option>
                      <option value={3600}>1 Std</option>
                      <option value={7200}>2 Std</option>
                      <option value={14400}>4 Std</option>
                      <option value={28800}>8 Std</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 border rounded hover:bg-white text-gray-600"
                    onClick={() => {
                      setGpuHistory([]);
                      historyStartTimeRef.current = null;
                    }}
                  >
                    Löschen
                  </button>
                </div>
              </div>

              {/* Statistik-Übersicht für GPU-Metriken */}
              {(() => {
                const gpuValues = gpuHistory.map(d => d.utilizationPercent).filter(v => v !== null && v !== undefined);
                const vramValues = gpuHistory.map(d => d.memoryUsedMb).filter(v => v !== null && v !== undefined);
                const tempValues = gpuHistory.map(d => d.temperatureCelsius).filter(v => v !== null && v !== undefined);

                return (
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {/* GPU-Auslastung Stats */}
                    {gpuValues.length > 0 && (
                      <div className="bg-emerald-50 rounded p-3 border border-emerald-200">
                        <div className="text-xs text-emerald-700 font-medium mb-2">GPU-Auslastung</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-gray-600">Min</div>
                            <div className="text-lg font-bold text-emerald-700">{Math.round(Math.min(...gpuValues))}%</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Max</div>
                            <div className="text-lg font-bold text-emerald-700">{Math.round(Math.max(...gpuValues))}%</div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 mt-2">
                          Ø {Math.round(gpuValues.reduce((a, b) => a + b, 0) / gpuValues.length)}%
                        </div>
                      </div>
                    )}

                    {/* VRAM Stats */}
                    {vramValues.length > 0 && (
                      <div className="bg-purple-50 rounded p-3 border border-purple-200">
                        <div className="text-xs text-purple-700 font-medium mb-2">VRAM-Nutzung</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-gray-600">Min</div>
                            <div className="text-lg font-bold text-purple-700">
                              {(Math.min(...vramValues) / 1024).toFixed(1)} GB
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-600">Max</div>
                            <div className="text-lg font-bold text-purple-700">
                              {(Math.max(...vramValues) / 1024).toFixed(1)} GB
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 mt-2">
                          Ø {(vramValues.reduce((a, b) => a + b, 0) / vramValues.length / 1024).toFixed(1)} GB
                        </div>
                      </div>
                    )}

                    {/* Temperatur Stats */}
                    {tempValues.length > 0 && (
                      <div className="bg-amber-50 rounded p-3 border border-amber-200">
                        <div className="text-xs text-amber-700 font-medium mb-2">GPU-Temperatur</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-gray-600">Min</div>
                            <div className="text-lg font-bold text-amber-700">{Math.round(Math.min(...tempValues))}°C</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Max</div>
                            <div className="text-lg font-bold text-amber-700">{Math.round(Math.max(...tempValues))}°C</div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 mt-2">
                          Ø {Math.round(tempValues.reduce((a, b) => a + b, 0) / tempValues.length)}°C
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* GPU-Auslastung */}
              <MetricsGraph
                data={gpuHistory}
                dataKey="utilizationPercent"
                label="GPU-Auslastung"
                unit="%"
                color="#10B981"
                minY={0}
                maxY={100}
                height={120}
              />

              {/* VRAM-Nutzung (MiB) */}
              <MetricsGraph
                data={gpuHistory}
                dataKey="memoryUsedMb"
                label="VRAM-Nutzung"
                unit=" MiB"
                color="#8B5CF6"
                minY={0}
                maxY={gpuStatus.gpus?.[0]?.memoryTotalMb || 8192}
                height={120}
              />

              {/* GPU-Temperatur */}
              <MetricsGraph
                data={gpuHistory}
                dataKey="temperatureCelsius"
                label="GPU-Temperatur"
                unit="°C"
                color="#F59E0B"
                minY={0}
                maxY={100}
                height={120}
              />
            </div>
          )}
        </div>
      </div>

      {/* Globales Modell-Override */}
      <div className="border rounded p-4 bg-gray-50">
        <h3 className="font-medium mb-3">Globales Modell-Override</h3>
        <div className="text-xs text-gray-600 mb-3">
          Optional: Überschreibt alle task-spezifischen Modelle. Leer lassen für task-spezifische Konfiguration.
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            className="border rounded px-3 py-2 flex-1 font-mono text-sm"
            value={globalModelOverride || ""}
            onChange={(e) => setGlobalModelOverride(e.target.value || null)}
            placeholder="z.B. einfo-balanced (leer = deaktiviert)"
            disabled={saving === "global"}
          />
          <button
            type="button"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
            onClick={saveGlobalModel}
            disabled={saving === "global"}
          >
            {saving === "global" ? "Speichere..." : "Speichern"}
          </button>
        </div>
        {globalModelOverride && (
          <div className="mt-2 text-sm text-amber-700">
            ⚠️ Aktiv: Alle Tasks verwenden <b>{globalModelOverride}</b>
          </div>
        )}
      </div>

      {/* Task-Konfigurationen */}
      <div className="border rounded p-4">
        <h3 className="font-medium mb-3">Task-Konfigurationen</h3>
        <div className="text-xs text-gray-600 mb-4">
          Jeder Task kann individuelle Parameter haben. Nur aktiv wenn globales Override leer ist.
        </div>

        <div className="space-y-6">
          {taskList.map((task) => {
            const draft = taskDrafts[task.key] || {};
            const changed = hasChanges(task.key);

            return (
              <details key={task.key} className="border rounded bg-white" open={task.key === "chat"}>
                <summary className="cursor-pointer p-3 font-medium hover:bg-gray-50 flex items-center justify-between">
                  <span>
                    {task.label} <span className="text-xs text-gray-500">({task.description})</span>
                  </span>
                  {changed && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded">Ungespeichert</span>}
                </summary>

                <div className="p-4 border-t space-y-3">
                  {/* Modell */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Modell</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2 font-mono text-sm"
                      value={draft.model || ""}
                      onChange={(e) => updateTaskDraft(task.key, "model", e.target.value)}
                      placeholder="z.B. einfo-balanced"
                    />
                  </div>

                  {/* Parameter-Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Temperature */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Temperature</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="2"
                        className="w-full border rounded px-3 py-2"
                        value={draft.temperature ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "temperature", Number(e.target.value))}
                      />
                      <div className="text-xs text-gray-500 mt-1">0.0 = deterministisch, 1.0 = kreativ</div>
                    </div>

                    {/* Max Tokens */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Max Tokens</label>
                      <input
                        type="number"
                        step="100"
                        min="100"
                        max="8000"
                        className="w-full border rounded px-3 py-2"
                        value={draft.maxTokens ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "maxTokens", Number(e.target.value))}
                      />
                    </div>

                    {/* Timeout */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Timeout (ms)</label>
                      <input
                        type="number"
                        step="1000"
                        min="10000"
                        max="600000"
                        className="w-full border rounded px-3 py-2"
                        value={draft.timeout ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "timeout", Number(e.target.value))}
                      />
                      <div className="text-xs text-gray-500 mt-1">{((draft.timeout || 0) / 1000).toFixed(0)}s</div>
                    </div>

                    {/* Num GPU */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Num GPU (Layers)</label>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        className="w-full border rounded px-3 py-2"
                        value={draft.numGpu ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "numGpu", Number(e.target.value))}
                      />
                      <div className="text-xs text-gray-500 mt-1">0 = CPU, 20+ = GPU</div>
                    </div>

                    {/* Num Ctx */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Context Size</label>
                      <input
                        type="number"
                        step="512"
                        min="512"
                        max="32768"
                        className="w-full border rounded px-3 py-2"
                        value={draft.numCtx ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "numCtx", Number(e.target.value))}
                      />
                    </div>

                    {/* Top P */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Top P</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        className="w-full border rounded px-3 py-2"
                        value={draft.topP ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "topP", Number(e.target.value))}
                      />
                    </div>

                    {/* Top K */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Top K</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        className="w-full border rounded px-3 py-2"
                        value={draft.topK ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "topK", Number(e.target.value))}
                      />
                    </div>

                    {/* Repeat Penalty */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Repeat Penalty</label>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        max="2"
                        className="w-full border rounded px-3 py-2"
                        value={draft.repeatPenalty ?? 0}
                        onChange={(e) => updateTaskDraft(task.key, "repeatPenalty", Number(e.target.value))}
                      />
                    </div>
                  </div>

                  {/* Aktionen */}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                      onClick={() => saveTaskConfig(task.key)}
                      disabled={saving === task.key || !changed}
                    >
                      {saving === task.key ? "Speichere..." : "Speichern"}
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 border rounded hover:bg-gray-50"
                      onClick={() => setTaskDrafts((prev) => ({ ...prev, [task.key]: tasks[task.key] }))}
                      disabled={!changed}
                    >
                      Zurücksetzen
                    </button>
                    <button
                      type="button"
                      className="ml-auto px-4 py-2 border rounded hover:bg-gray-50 text-blue-600"
                      onClick={() => setTestingModel(draft.model)}
                    >
                      Modell testen
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </div>

      {/* Verfügbare Ollama-Modelle */}
      <div className="border rounded p-4">
        <h3 className="font-medium mb-3">Verfügbare Ollama-Modelle</h3>
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
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-lg">Modell testen: {testingModel}</h3>
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    setTestingModel(null);
                    setTestResult(null);
                    setStreamingAnswer("");
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

              {/* Live-Streaming-Anzeige während des Tests */}
              {testRunning && streamingAnswer && (
                <div className="border rounded p-4 bg-gray-50">
                  <div className="text-xs text-gray-600 mb-1 flex items-center gap-2">
                    <span className="animate-pulse">●</span>
                    Antwort wird generiert...
                  </div>
                  <div className="text-sm whitespace-pre-wrap bg-white p-2 rounded border min-h-[60px]">
                    {streamingAnswer}
                    <span className="animate-pulse text-blue-500">▌</span>
                  </div>
                </div>
              )}

              {testResult && (
                <div className="border rounded p-4 bg-gray-50 space-y-4">
                  {testResult.error ? (
                    <div className="text-red-600">
                      <div className="font-medium">Fehler:</div>
                      <div className="text-sm mt-1">{testResult.error}</div>
                      {testResult.debug && (
                        <details className="mt-2 text-xs text-gray-500">
                          <summary className="cursor-pointer hover:text-gray-700">Debug-Info</summary>
                          <pre className="mt-1 p-2 bg-gray-100 rounded overflow-auto text-gray-700">
                            {JSON.stringify(testResult.debug, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Antwort */}
                      <div>
                        <div className="text-xs text-gray-600 mb-1">Antwort:</div>
                        <div className="text-sm whitespace-pre-wrap bg-white p-2 rounded border">
                          {testResult.answer}
                        </div>
                      </div>

                      {/* Statistik-Übersicht */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {/* Dauer */}
                        <div className="bg-blue-50 rounded p-2 text-center">
                          <div className="text-xs text-gray-600">Dauer</div>
                          <div className="text-lg font-bold text-blue-700">
                            {testResult.duration ? `${(testResult.duration / 1000).toFixed(2)}s` : "–"}
                          </div>
                        </div>

                        {/* GPU Max */}
                        {testResult.stats?.gpuUtilization && (
                          <div className="bg-emerald-50 rounded p-2 text-center">
                            <div className="text-xs text-gray-600">GPU Max</div>
                            <div className="text-lg font-bold text-emerald-700">
                              {testResult.stats.gpuUtilization.max ?? "–"}%
                            </div>
                          </div>
                        )}

                        {/* VRAM Peak */}
                        {testResult.stats?.memoryUsedMb && (
                          <div className="bg-purple-50 rounded p-2 text-center">
                            <div className="text-xs text-gray-600">VRAM Peak</div>
                            <div className="text-lg font-bold text-purple-700">
                              {testResult.stats.memoryUsedMb.max
                                ? `${(testResult.stats.memoryUsedMb.max / 1024).toFixed(1)} GB`
                                : "–"}
                            </div>
                          </div>
                        )}

                        {/* CPU Max */}
                        {testResult.stats?.cpuUsage && (
                          <div className="bg-sky-50 rounded p-2 text-center">
                            <div className="text-xs text-gray-600">CPU Max</div>
                            <div className="text-lg font-bold text-sky-700">
                              {testResult.stats.cpuUsage.max ?? "–"}%
                            </div>
                          </div>
                        )}

                        {/* RAM Peak */}
                        {testResult.stats?.ramUsedMb && (
                          <div className="bg-amber-50 rounded p-2 text-center">
                            <div className="text-xs text-gray-600">RAM Peak</div>
                            <div className="text-lg font-bold text-amber-700">
                              {testResult.stats.ramUsedMb.max
                                ? `${(testResult.stats.ramUsedMb.max / 1024).toFixed(1)} GB`
                                : "–"}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Metriken-Graphen */}
                      {testResult.metrics && testResult.metrics.length > 0 && (
                        <div className="space-y-3">
                          <div className="text-sm font-medium text-gray-700">Metriken-Verlauf</div>

                          {/* GPU Utilization Graph */}
                          <MetricsGraph
                            data={testResult.metrics}
                            dataKey="utilizationPercent"
                            label="GPU-Auslastung"
                            unit="%"
                            color="#10B981"
                            minY={0}
                            maxY={100}
                            height={140}
                          />

                          {/* VRAM Usage Graph */}
                          <MetricsGraph
                            data={testResult.metrics}
                            dataKey="memoryUsedMb"
                            label="VRAM-Nutzung"
                            unit=" MiB"
                            color="#8B5CF6"
                            minY={0}
                            maxY={testResult.stats?.memoryTotalMb || 8192}
                            height={140}
                          />

                          {/* CPU Usage Graph */}
                          <MetricsGraph
                            data={testResult.metrics}
                            dataKey="cpuUsagePercent"
                            label="CPU-Auslastung"
                            unit="%"
                            color="#0EA5E9"
                            minY={0}
                            maxY={100}
                            height={140}
                          />

                          {/* RAM Usage Graph */}
                          <MetricsGraph
                            data={testResult.metrics}
                            dataKey="ramUsedMb"
                            label="Arbeitsspeicher"
                            unit=" MiB"
                            color="#F59E0B"
                            minY={0}
                            maxY={testResult.stats?.ramTotalMb || 32768}
                            height={140}
                          />

                          {/* Messpunkte Info */}
                          <div className="text-xs text-gray-500 text-center">
                            {testResult.metrics.length} Messpunkte (2s Intervall)
                          </div>
                        </div>
                      )}

                      {/* Detaillierte Statistiken */}
                      {testResult.stats && (
                        <div className="text-xs text-gray-600 bg-gray-100 rounded p-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="font-medium">GPU:</span>{" "}
                              Min {testResult.stats.gpuUtilization?.min ?? "–"}% |{" "}
                              Max {testResult.stats.gpuUtilization?.max ?? "–"}% |{" "}
                              Avg {testResult.stats.gpuUtilization?.avg ?? "–"}%
                            </div>
                            <div>
                              <span className="font-medium">VRAM:</span>{" "}
                              Min {testResult.stats.memoryUsedMb?.min ? (testResult.stats.memoryUsedMb.min / 1024).toFixed(1) : "–"} GB |{" "}
                              Max {testResult.stats.memoryUsedMb?.max ? (testResult.stats.memoryUsedMb.max / 1024).toFixed(1) : "–"} GB |{" "}
                              Total {testResult.stats.memoryTotalMb ? (testResult.stats.memoryTotalMb / 1024).toFixed(1) : "–"} GB
                            </div>
                            <div>
                              <span className="font-medium">CPU:</span>{" "}
                              Min {testResult.stats.cpuUsage?.min ?? "–"}% |{" "}
                              Max {testResult.stats.cpuUsage?.max ?? "–"}% |{" "}
                              Avg {testResult.stats.cpuUsage?.avg ?? "–"}%
                            </div>
                            <div>
                              <span className="font-medium">RAM:</span>{" "}
                              Min {testResult.stats.ramUsedMb?.min ? (testResult.stats.ramUsedMb.min / 1024).toFixed(1) : "–"} GB |{" "}
                              Max {testResult.stats.ramUsedMb?.max ? (testResult.stats.ramUsedMb.max / 1024).toFixed(1) : "–"} GB |{" "}
                              Total {testResult.stats.ramTotalMb ? (testResult.stats.ramTotalMb / 1024).toFixed(1) : "–"} GB
                            </div>
                          </div>
                        </div>
                      )}

                      {/* RAW Request/Response - Aufklappbare Bereiche */}
                      <div className="space-y-2 mt-4">
                        {testResult.rawRequest && (
                          <details className="border rounded">
                            <summary className="px-3 py-2 bg-gray-100 cursor-pointer hover:bg-gray-200 text-sm font-medium text-gray-700">
                              RAW Request (Ollama API)
                            </summary>
                            <pre className="p-3 text-xs bg-gray-50 overflow-auto max-h-60 text-gray-800">
                              {JSON.stringify(testResult.rawRequest, null, 2)}
                            </pre>
                          </details>
                        )}

                        {testResult.rawResponse && (
                          <details className="border rounded">
                            <summary className="px-3 py-2 bg-gray-100 cursor-pointer hover:bg-gray-200 text-sm font-medium text-gray-700">
                              RAW Response (Ollama API)
                            </summary>
                            <pre className="p-3 text-xs bg-gray-50 overflow-auto max-h-60 text-gray-800">
                              {JSON.stringify(testResult.rawResponse, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
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
