// Verwaltet den Simulationszustand im Speicher

let currentState = {
  scenarioId: null,
  scenarioConfig: null,
  timeStep: 0,
  simulatedMinutes: 0,
  incidents: [],
  messages: [],
  staffDecisions: [],
  einfoSnapshot: {
    aufgaben: [],
    protokoll: []
  },
  meta: {}
};

const DEFAULT_HISTORY_STATE = Object.freeze({
  openIncidents: [],
  closedIncidents: [],
  openTasksByRole: {},
  lastMajorEvents: []
});

let llmHistorySummary = "";
let llmHistoryState = DEFAULT_HISTORY_STATE;

export function initState(scenarioConfig) {
  currentState = {
    scenarioId: scenarioConfig.scenarioId || `scenario-${Date.now()}`,
    scenarioConfig,
    timeStep: 0,
    simulatedMinutes: 0,
    incidents: [],
    messages: [],
    staffDecisions: [],
    einfoSnapshot: {
      aufgaben: [],
      protokoll: []
    },
    meta: {}
  };

  llmHistorySummary = "";
  llmHistoryState = DEFAULT_HISTORY_STATE;
}

export function getCurrentState() {
  return currentState;
}

// Snapshot als plain JS-Objekt
export function getCurrentStateSnapshot() {
  return JSON.parse(JSON.stringify(currentState));
}

export function setEinfoSnapshot({ aufgaben = [], protokoll = [] } = {}) {
  currentState = {
    ...currentState,
    einfoSnapshot: {
      aufgaben: Array.isArray(aufgaben) ? aufgaben : [],
      protokoll: Array.isArray(protokoll) ? protokoll : []
    }
  };
}

// LLM-Antwort einspielen
export function applyLLMChangesToState(prevState, llmResponse, minutesPerStep) {
  const nextMinutes = minutesPerStep ?? 10;
  const incidents = Array.isArray(llmResponse.incidents)
    ? llmResponse.incidents
    : [];
  const messages = Array.isArray(llmResponse.messages)
    ? llmResponse.messages
    : [];
  const staffDecisions = Array.isArray(llmResponse.staffDecisions)
    ? llmResponse.staffDecisions
    : [];

  const meta = llmResponse.meta || {};
  const { historySummary, historyState, ...metaWithoutHistory } = meta;

  const newState = {
    ...prevState,
    timeStep: prevState.timeStep + 1,
    simulatedMinutes: prevState.simulatedMinutes + (meta.nextStepMinutes || nextMinutes),
    incidents: mergeIncidents(prevState.incidents, incidents),
    messages: [...prevState.messages, ...messages],
    staffDecisions: [...prevState.staffDecisions, ...staffDecisions],
    // HistoryMeta nur separat speichern, nicht als zusätzlichen Prompt-Input verwenden
    meta: metaWithoutHistory
  };

  currentState = newState;

  // Für EINFO ausgeben wollen wir die delta-Informationen:
  const chatbotEvents = messages;
  const chatbotIncidents = incidents;

  return { newState, chatbotEvents, chatbotIncidents };
}

export function getLLMHistorySummary() {
  return llmHistorySummary;
}

export function getLLMHistoryState() {
  return JSON.parse(JSON.stringify(llmHistoryState));
}

function normalizeIncidentEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.id || entry.incidentId || null;
  const desc = entry.title || entry.description || entry.desc || null;
  const status = entry.status || entry.column || null;
  const location = entry.location || entry.ort || null;
  const typ = entry.typ || entry.type || null;

  if (!id && !desc && !location) return null;

  return {
    id: id || null,
    description: desc || null,
    status: status || null,
    location: location || null,
    typ: typ || null,
    statusSince: entry.statusSince || null,
    assignedVehicles: entry.assignedVehicles || null
  };
}

function normalizeHistoryState(state) {
  if (!state || typeof state !== "object") return DEFAULT_HISTORY_STATE;

  const openIncidents = Array.isArray(state.openIncidents)
    ? state.openIncidents
        .map(normalizeIncidentEntry)
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const closedIncidents = Array.isArray(state.closedIncidents)
    ? state.closedIncidents
        .map((id) => (id ? String(id) : null))
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const openTasksByRole = state.openTasksByRole && typeof state.openTasksByRole === "object"
    ? Object.entries(state.openTasksByRole).reduce((acc, [role, count]) => {
        const normalizedRole = String(role || "").trim();
        const normalizedCount = Number.isFinite(Number(count)) ? Number(count) : 0;
        if (normalizedRole && normalizedCount >= 0) {
          acc[normalizedRole] = normalizedCount;
        }
        return acc;
      }, {})
    : {};

  const lastMajorEvents = Array.isArray(state.lastMajorEvents)
    ? state.lastMajorEvents
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  return {
    openIncidents,
    closedIncidents,
    openTasksByRole,
    lastMajorEvents
  };
}

export function setLLMHistoryMeta(meta = {}) {
  if (typeof meta?.historySummary === "string") {
    llmHistorySummary = meta.historySummary.trim();
  } else if (meta.historySummary === null || meta.historySummary === undefined) {
    llmHistorySummary = "";
  }

  llmHistoryState = normalizeHistoryState(meta.historyState);
}

export function setLLMHistorySummary(summary) {
  setLLMHistoryMeta({ historySummary: summary, historyState: llmHistoryState });
}

// Einfache Merge-Logik via incident.id
function mergeIncidents(existing, updates) {
  const byId = new Map();
  for (const inc of existing) {
    if (inc && inc.id) {
      byId.set(inc.id, inc);
    }
  }
  for (const inc of updates) {
    if (!inc || !inc.id) continue;
    const prev = byId.get(inc.id) || {};
    byId.set(inc.id, { ...prev, ...inc });
  }
  return Array.from(byId.values());
}

export function exportScenario() {
  return getCurrentStateSnapshot();
}
