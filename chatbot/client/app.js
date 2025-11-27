const logEl = document.getElementById("log");
const opsEl = document.getElementById("ops");
const statusEl = document.getElementById("status");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatLog = document.getElementById("chat-log");
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

    const decoder = new TextDecoder();
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
