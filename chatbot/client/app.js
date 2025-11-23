const logEl = document.getElementById("log");
const incidentsEl = document.getElementById("incidents");
const metaEl = document.getElementById("meta");
const statusEl = document.getElementById("status");

const btnStart = document.getElementById("btn-start");
const btnStep = document.getElementById("btn-step");
const btnPause = document.getElementById("btn-pause");
const btnExport = document.getElementById("btn-export");

const API_BASE = "/api";

function appendLog(line) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${line}\n` + logEl.textContent;
}

async function fetchState() {
  const res = await fetch(`${API_BASE}/state`);
  const data = await res.json();
  renderState(data);
}

function renderState(state) {
  if (!state || !state.scenarioConfig) {
    incidentsEl.innerHTML = "<p>Keine aktive Simulation.</p>";
    metaEl.textContent = "";
    statusEl.textContent = "Status: inaktiv";
    return;
  }

  statusEl.textContent = `Status: aktiv – Schritt ${state.timeStep}, ${state.simulatedMinutes} min`;

  const inc = state.incidents || [];
  if (inc.length === 0) {
    incidentsEl.innerHTML = "<p>Noch keine Einsatzstellen generiert.</p>";
  } else {
    incidentsEl.innerHTML = inc
      .map((i) => {
        const koord =
          i.koordinaten && typeof i.koordinaten.lat === "number"
            ? `${i.koordinaten.lat.toFixed(5)}, ${i.koordinaten.lng.toFixed(
                5
              )}`
            : "n/a";
        return `
          <div class="incident">
            <div><strong>${i.name || i.id}</strong></div>
            <div>${i.adresse || "Adresse n/a"}</div>
            <div class="meta">
              Art: ${i.art || "n/a"} · Priorität: ${
          i.prioritaet || "n/a"
        } · Status: ${i.status || "n/a"}
            </div>
            <div class="meta">Koordinaten: ${koord}</div>
          </div>
        `;
      })
      .join("");
  }

  metaEl.textContent = `Szenario: ${
    state.scenarioConfig.artDesEreignisses || "n/a"
  } im Bereich ${state.scenarioConfig.geografischerBereich || "n/a"}`;
}

btnStart.addEventListener("click", async () => {
  appendLog("Simulation wird gestartet…");
  const res = await fetch(`${API_BASE}/sim/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioConfigOverride: null })
  });
  const data = await res.json();
  if (data.ok) {
    appendLog("Simulation gestartet.");
    fetchState();
  } else {
    appendLog("Fehler beim Starten der Simulation.");
  }
});

btnStep.addEventListener("click", async () => {
  appendLog("Simulationsschritt wird ausgeführt…");
  const res = await fetch(`${API_BASE}/sim/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await res.json();
  if (data.ok) {
    appendLog(
      `Schritt OK. Neue Events: ${
        data.chatbotEvents?.length || 0
      }, neue Einsatzstellen: ${data.chatbotIncidents?.length || 0}`
    );
    fetchState();
  } else {
    appendLog("Fehler im Simulationsschritt: " + (data.error || data.reason));
  }
});

btnPause.addEventListener("click", async () => {
  const res = await fetch(`${API_BASE}/sim/pause`, { method: "POST" });
  const data = await res.json();
  if (data.ok) {
    appendLog("Simulation pausiert.");
    statusEl.textContent = "Status: pausiert";
  }
});

btnExport.addEventListener("click", async () => {
  const res = await fetch(`${API_BASE}/export`);
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chatbot_szenario_export_${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  appendLog("Szenario exportiert (Download gestartet).");
});

// Initialer Zustand
fetchState().catch(() => {});
