// Verwaltet den Simulationszustand im Speicher

let currentState = {
  scenarioId: null,
  scenarioConfig: null,
  timeStep: 0,
  simulatedMinutes: 0,
  incidents: [],
  messages: [],
  staffDecisions: [],
  meta: {}
};

let llmHistorySummary = "";

export function initState(scenarioConfig) {
  currentState = {
    scenarioId: scenarioConfig.scenarioId || `scenario-${Date.now()}`,
    scenarioConfig,
    timeStep: 0,
    simulatedMinutes: 0,
    incidents: [],
    messages: [],
    staffDecisions: [],
    meta: {}
  };

  llmHistorySummary = "";
}

export function getCurrentState() {
  return currentState;
}

// Snapshot als plain JS-Objekt
export function getCurrentStateSnapshot() {
  return JSON.parse(JSON.stringify(currentState));
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

  const newState = {
    ...prevState,
    timeStep: prevState.timeStep + 1,
    simulatedMinutes: prevState.simulatedMinutes + (meta.nextStepMinutes || nextMinutes),
    incidents: mergeIncidents(prevState.incidents, incidents),
    messages: [...prevState.messages, ...messages],
    staffDecisions: [...prevState.staffDecisions, ...staffDecisions],
    meta
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

export function setLLMHistorySummary(summary) {
  if (typeof summary === "string") {
    llmHistorySummary = summary.trim();
    return;
  }

  if (summary === null || summary === undefined) {
    llmHistorySummary = "";
  }
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
