const logEl = document.getElementById("log");
const opsEl = document.getElementById("ops");
const statusEl = document.getElementById("status");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatLog = document.getElementById("chat-log");
const llmModelSelect = document.getElementById("llm-model-select");
const llmPrompt = document.getElementById("llm-prompt");
const llmSend = document.getElementById("llm-send");
const llmOutput = document.getElementById("llm-output");
const llmRefresh = document.getElementById("llm-refresh");
const llmGpuStatus = document.getElementById("llm-gpu-status");
const llmError = document.getElementById("llm-error");
const BOT_NAME = "Florian";
const chatEntries = [];

const btnStart = document.getElementById("btn-start");
const btnStep = document.getElementById("btn-step");
const btnPause = document.getElementById("btn-pause");

function appendLog(line) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${line}\n` + logEl.textContent;
}

function renderChatLog() {
  chatLog.textContent = chatEntries
    .map((entry) => `[${entry.ts}] ${entry.role}: ${entry.text}`)
    .join("\n");
}

function appendChat(role, text) {
  const entry = { ts: new Date().toLocaleTimeString(), role, text };
  chatEntries.unshift(entry);
  renderChatLog();
  return entry;
}

function updateChatEntry(entry, newText) {
  entry.text = newText;
  renderChatLog();
}

function setBusy(busy) {
  btnStep.disabled = busy;
  btnStart.disabled = busy;
  btnPause.disabled = busy;
}

function setLlmBusy(busy) {
  if (llmSend) llmSend.disabled = busy;
  if (llmRefresh) llmRefresh.disabled = busy;
  if (llmModelSelect) llmModelSelect.disabled = busy;
}

function setLlmOutput(text) {
  if (llmOutput) {
    llmOutput.textContent = text;
  }
}

function setLlmError(text) {
  if (llmError) {
    llmError.textContent = text || "";
  }
}

function renderGpuStatus(status) {
  if (!llmGpuStatus) return;

  llmGpuStatus.classList.remove("unavailable");
  const errorText = status?.error ? String(status.error) : "";

  if (!status) {
    llmGpuStatus.textContent = "GPU: keine Daten";
    return;
  }

  if (status.available && Array.isArray(status.gpus) && status.gpus.length) {
    const parts = status.gpus.map((gpu) => {
      const utilization =
        typeof gpu.utilizationPercent === "number"
          ? `${gpu.utilizationPercent}%`
          : "?";
      const memoryUsed =
        typeof gpu.memoryUsedMb === "number" ? gpu.memoryUsedMb : "?";
      const memoryTotal =
        typeof gpu.memoryTotalMb === "number" ? gpu.memoryTotalMb : "?";
      return `${gpu.name || "GPU"}: ${utilization} – ${memoryUsed}/${memoryTotal} MiB`;
    });
    const joined = `GPU: ${parts.join(" | ")}`;
    llmGpuStatus.textContent = errorText ? `${joined} (Hinweis: ${errorText})` : joined;
    return;
  }

  if (status.available) {
    const text = errorText || "verfügbar, aber keine Details";
    llmGpuStatus.textContent = `GPU: ${text}`;
    return;
  }

  llmGpuStatus.classList.add("unavailable");
  const errorMsg = errorText || "nicht verfügbar";
  llmGpuStatus.textContent = `GPU: ${errorMsg}`;
}

async function refreshGpuStatus() {
  if (!llmGpuStatus) return;

  try {
    const res = await fetch("/api/llm/gpu");
    const data = await res.json().catch(() => null);

    if (data?.gpuStatus) {
      renderGpuStatus(data.gpuStatus);
      return;
    }

    renderGpuStatus({ available: false, error: "Keine GPU-Daten vom Server" });
  } catch (err) {
    renderGpuStatus({ available: false, error: String(err) });
  }
}

async function loadLlmModels() {
  if (!llmModelSelect) return;

  setLlmBusy(true);
  llmModelSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.textContent = "Modelle werden geladen…";
  placeholder.disabled = true;
  placeholder.selected = true;
  llmModelSelect.appendChild(placeholder);
  if (llmSend) llmSend.disabled = true;

  try {
    const res = await fetch("/api/llm/models");
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || res.statusText || "Unbekannter Fehler");
    }

    const models = Array.isArray(data.models) ? data.models : [];
    llmModelSelect.innerHTML = "";

    if (!models.length) {
      const opt = document.createElement("option");
      opt.textContent = "Keine Modelle gefunden";
      opt.disabled = true;
      opt.selected = true;
      llmModelSelect.appendChild(opt);
      if (llmSend) llmSend.disabled = true;
      return;
    }

    for (const model of models) {
      const opt = document.createElement("option");
      opt.value = model;
      opt.textContent = model;
      llmModelSelect.appendChild(opt);
    }

    if (llmSend) llmSend.disabled = false;
  } catch (err) {
    llmModelSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.textContent = "Laden fehlgeschlagen";
    opt.disabled = true;
    opt.selected = true;
    llmModelSelect.appendChild(opt);
    if (llmSend) llmSend.disabled = true;
    setLlmOutput("Fehler beim Laden der Modelle: " + err);
  } finally {
    setLlmBusy(false);
  }
}

async function runLlmTest() {
  if (!llmPrompt || !llmModelSelect || !llmSend) return;

  const prompt = (llmPrompt.value || "").trim();
  const model = llmModelSelect.value;

  if (!prompt || !model) return;

  setLlmBusy(true);
  setLlmError("");
  setLlmOutput("LLM wird abgefragt…");

  try {
    const res = await fetch("/api/llm/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: prompt, model })
    });

    const data = await res.json().catch(() => null);
    if (data?.gpuStatus) {
      renderGpuStatus(data.gpuStatus);
    }

    if (!res.ok || !data?.ok) {
      const message = data?.error || res.statusText || "Unbekannter Fehler";
      setLlmError(message);
      setLlmOutput("Fehler beim Test: " + message);
      return;
    }

    const answer =
      typeof data.answer === "string"
        ? data.answer
        : JSON.stringify(data.answer, null, 2);

    setLlmError("");
    setLlmOutput(answer || "(keine Antwort)");
  } catch (err) {
    renderGpuStatus({ available: false, error: String(err) });
    setLlmError(String(err));
    setLlmOutput("Fehler beim Test: " + err);
  } finally {
    setLlmBusy(false);
  }
}

btnStart.addEventListener("click", async () => {
  setBusy(true);
  appendLog("Simulation wird gestartet…");
  try {
    const res = await fetch("/api/sim/start", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      appendLog("Simulation gestartet.");
      statusEl.textContent = "Status: aktiv (Simulation)";
    } else {
      appendLog("Fehler beim Starten.");
    }
  } catch (err) {
    appendLog("Fehler: " + err);
  } finally {
    setBusy(false);
  }
});

btnStep.addEventListener("click", async () => {
  setBusy(true);
  appendLog("Manueller Schritt…");
  try {
    const res = await fetch("/api/sim/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "manual" })
    });
    const data = await res.json();
    if (data.ok) {
      appendLog("Schritt OK – Operations empfangen.");
      opsEl.textContent = JSON.stringify(
        { operations: data.operations, analysis: data.analysis },
        null,
        2
      );
    } else {
      appendLog("Fehler: " + (data.error || data.reason));
    }
  } catch (err) {
    appendLog("Fehler: " + err);
  } finally {
    setBusy(false);
  }
});

btnPause.addEventListener("click", async () => {
  setBusy(true);
  appendLog("Simulation wird pausiert…");
  try {
    const res = await fetch("/api/sim/pause", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      appendLog("Simulation pausiert.");
      statusEl.textContent = "Status: pausiert (Chat möglich)";
    } else {
      appendLog("Fehler beim Pausieren.");
    }
  } catch (err) {
    appendLog("Fehler: " + err);
  } finally {
    setBusy(false);
  }
});

chatSend.addEventListener("click", async () => {
  const q = (chatInput.value || "").trim();
  if (!q) return;
  chatInput.value = "";
  appendChat("Du", q);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });
    const contentType = res.headers.get("content-type") || "";

    if (!res.ok || contentType.includes("application/json")) {
      const data = await res.json().catch(() => null);
      if (data?.error === "simulation_running") {
        appendChat(
          BOT_NAME,
          "Chat ist nur verfügbar, wenn die Simulation pausiert ist."
        );
        return;
      }
      const msg = data?.error || data?.reason || res.statusText || "unbekannt";
      appendChat(BOT_NAME, "Fehler: " + msg);
      return;
    }

    // UTF-8 explizit erzwingen für korrekte Sonderzeichen (ü, ö, ä, ß)
    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
    const reader = res.body?.getReader();
    if (!reader) {
      appendChat(BOT_NAME, "(keine Antwort)");
      return;
    }

    const botEntry = appendChat(BOT_NAME, "");
    let accumulated = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      updateChatEntry(botEntry, accumulated);
    }
    accumulated += decoder.decode();
    updateChatEntry(botEntry, accumulated.trim());
  } catch (err) {
    appendChat(BOT_NAME, "Fehler beim Senden: " + err);
  }
});

chatInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    chatSend.click();
  }
});

if (llmRefresh) {
  llmRefresh.addEventListener("click", () => {
    loadLlmModels();
    refreshGpuStatus();
  });
}

if (llmSend) {
  llmSend.addEventListener("click", () => {
    runLlmTest();
  });
}

if (llmPrompt) {
  llmPrompt.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      runLlmTest();
    }
  });
}

loadLlmModels();
refreshGpuStatus();
