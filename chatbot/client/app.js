const logEl = document.getElementById("log");
const opsEl = document.getElementById("ops");
const statusEl = document.getElementById("status");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatLog = document.getElementById("chat-log");
const BOT_NAME = "Florian";

const btnStart = document.getElementById("btn-start");
const btnStep = document.getElementById("btn-step");
const btnPause = document.getElementById("btn-pause");

function appendLog(line) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${line}\n` + logEl.textContent;
}

function appendChat(role, text) {
  const ts = new Date().toLocaleTimeString();
  chatLog.textContent = `[${ts}] ${role}: ${text}\n` + chatLog.textContent;
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
    const data = await res.json();
    if (!data.ok) {
      if (data.error === "simulation_running") {
        appendChat(
          BOT_NAME,
          "Chat ist nur verfügbar, wenn die Simulation pausiert ist."
        );
      } else {
        appendChat(BOT_NAME, "Fehler: " + (data.error || "unbekannt"));
      }
      return;
    }
    appendChat(BOT_NAME, data.answer || "(keine Antwort)");
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
