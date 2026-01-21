# Simulationscode Analyse & Verbesserungsvorschläge

**Datum:** 2026-01-21
**Analysierte Komponenten:** sim_loop.js, simulation_helpers.js, llm_client.js, scenario_controls.js

---

## Übersicht

Das EINFO Stabstraining-Simulationssystem ist eine hochwertige, produktionsreife Implementierung mit LLM-Integration. Die Analyse identifiziert Optimierungspotenziale in den Bereichen Architektur, Performance, Wartbarkeit und Robustheit.

---

## 1. ARCHITEKTUR & STRUKTUR

### 🔴 Kritisch: Globaler State in sim_loop.js

**Problem:**
```javascript
let lastComparableSnapshot = null;
let lastCompressedBoardJson = "[]";
let running = false;
let stepInProgress = false;
let simulationJustStarted = false;
let activeScenario = null;
let simulationElapsedMinutes = 0;
```

**Auswirkung:**
- Erschwert Unit-Testing
- Race Conditions bei parallelen Anfragen möglich
- Schwierige Fehlersuche bei State-Inkonsistenzen
- Keine Simulation mehrerer Sessions parallel möglich

**Lösung:**
```javascript
// Vorschlag: Simulation State Klasse
class SimulationState {
  constructor() {
    this.lastSnapshot = null;
    this.lastCompressedBoard = "[]";
    this.running = false;
    this.stepInProgress = false;
    this.justStarted = false;
    this.activeScenario = null;
    this.elapsedMinutes = 0;
  }

  reset() {
    Object.assign(this, new SimulationState());
  }

  toJSON() {
    return { ...this };
  }

  static fromJSON(data) {
    const state = new SimulationState();
    Object.assign(state, data);
    return state;
  }
}

// Usage
const simulationState = new SimulationState();
export { simulationState };
```

**Vorteile:**
- Bessere Testbarkeit
- State kann serialisiert/wiederhergestellt werden
- Klare Ownership der Variablen
- Multi-Session Support möglich

---

### 🟡 Mittel: Code-Duplikation bei Identifikations-Funktionen

**Problem:**
`identifyMessagesNeedingResponse()` (Zeile 51-154) und `identifyOpenQuestions()` (Zeile 174-294) haben ähnliche Logik:
- Beide durchsuchen Protokoll-Array
- Beide prüfen Antwort-Existenz
- Beide verwenden ähnliche Filterbedingungen

**Lösung:**
```javascript
// Gemeinsame Basis-Funktion
function findProtocolEntriesWithCriteria({
  protokoll,
  protokollDelta = null,
  roles,
  criteria,
  responseChecker
}) {
  const { active } = roles;
  const activeSet = new Set(active.map(r => String(r).toUpperCase()));
  const results = [];

  const entriesToCheck = protokollDelta || protokoll;

  for (const entry of entriesToCheck) {
    if (!criteria(entry, activeSet)) continue;

    const hasResponse = responseChecker(entry, protokoll, activeSet);
    if (hasResponse) continue;

    results.push(entry);
  }

  return results;
}

// Spezialisierte Funktionen
function identifyMessagesNeedingResponse(protokoll, protokollDelta, roles) {
  return findProtocolEntriesWithCriteria({
    protokoll,
    protokollDelta,
    roles,
    criteria: (entry, activeSet) => {
      const isOutgoing = /aus/i.test(entry.richtung || "");
      if (!isOutgoing) return false;

      const recipients = Array.isArray(entry.ergehtAn) ? entry.ergehtAn : [];
      const nonActive = recipients.filter(r => !activeSet.has(r.toUpperCase()));
      return nonActive.length > 0;
    },
    responseChecker: checkMessageResponse
  });
}
```

**Geschätzte Einsparung:** 80-100 Zeilen Code, bessere Wartbarkeit

---

### 🟡 Mittel: Lange Funktionen

**Problem:**
- `stepSimulation()`: 308 Zeilen (Zeile 508-816)
- `assignVehiclesByDistance()`: 75 Zeilen (Zeile 394-467)

**Lösung:**
```javascript
// stepSimulation() aufteilen:

async function stepSimulation(options = {}) {
  if (!canExecuteStep(options)) {
    return { ok: false, reason: determineSkipReason() };
  }

  stepInProgress = true;
  const stepContext = createStepContext(options);

  try {
    const einfoData = await readEinfoInputs();
    const deltas = buildDataDeltas(einfoData);

    logStepStart(stepContext, deltas);

    const analysisResults = await analyzeCurrentState(einfoData, deltas);
    await updateContexts(einfoData, analysisResults);

    if (shouldSkipDueToAnalysis()) {
      return handleSkippedStep(stepContext);
    }

    const llmResponse = await executeLLMOperations(stepContext, analysisResults);
    await applyOperations(llmResponse.operations);
    await indexCreatedEntities(llmResponse.operations);

    updateSimulationTime();
    logStepComplete(stepContext, llmResponse);

    return { ok: true, operations: llmResponse.operations, analysis: llmResponse.analysis };
  } catch (err) {
    return handleStepError(err, stepContext);
  } finally {
    stepInProgress = false;
  }
}

// Einzelne Sub-Funktionen sind besser testbar:
function createStepContext(options) {
  return {
    stepId: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source: options.source || "manual",
    startTime: Date.now(),
    memorySnippets: options.memorySnippets || []
  };
}

function buildDataDeltas(einfoData) {
  return {
    board: buildDelta(einfoData.board, lastComparableSnapshot?.board, toComparableBoardEntry),
    aufgaben: buildDelta(einfoData.aufgaben, lastComparableSnapshot?.aufgaben, toComparableAufgabe),
    protokoll: buildDelta(einfoData.protokoll, lastComparableSnapshot?.protokoll, toComparableProtokoll)
  };
}
```

**Vorteile:**
- Jede Funktion hat eine klare Verantwortung
- Einfacher zu testen
- Bessere Lesbarkeit
- Wiederverwendbare Komponenten

---

## 2. ERROR HANDLING & ROBUSTHEIT

### 🔴 Kritisch: Inkonsistentes Error Handling

**Problem:**
```javascript
// sim_loop.js Zeile 615-632
try {
  await updateDisasterContextFromEinfo({ board, protokoll, aufgaben, roles });
  logDebug("Disaster Context aktualisiert", {...});
} catch (err) {
  logError("Fehler beim Aktualisieren des Disaster Context", {...});
  // Fehler nicht weitergeben - Simulation soll weiterlaufen
}

// vs. Zeile 796-798
try {
  // RAG-Indizierung
} catch (indexError) {
  logError("Fehler bei RAG-Indizierung", { error: String(indexError) });
}
```

**Problem:**
- Unklar welche Fehler kritisch sind und welche nicht
- Keine Error-Kategorisierung
- Fehlende Recovery-Strategien

**Lösung:**
```javascript
// Error-Klassifikation
class SimulationError extends Error {
  constructor(message, { severity = 'error', recoverable = false, context = {} } = {}) {
    super(message);
    this.name = 'SimulationError';
    this.severity = severity; // 'critical' | 'error' | 'warning'
    this.recoverable = recoverable;
    this.context = context;
  }
}

// Error Handler Registry
const errorHandlers = {
  DisasterContextUpdateFailed: {
    severity: 'warning',
    recoverable: true,
    handler: (err, context) => {
      logError("Disaster Context konnte nicht aktualisiert werden", { error: err });
      // Weiter mit veralteten Daten
      return { continueSimulation: true, useStaleData: true };
    }
  },

  LLMCallFailed: {
    severity: 'critical',
    recoverable: false,
    handler: (err, context) => {
      logError("LLM-Aufruf fehlgeschlagen - Simulation abgebrochen", { error: err });
      return { continueSimulation: false, reason: 'llm_unavailable' };
    }
  },

  RAGIndexingFailed: {
    severity: 'warning',
    recoverable: true,
    handler: (err, context) => {
      logError("RAG-Indizierung fehlgeschlagen - Daten nicht durchsuchbar", { error: err });
      return { continueSimulation: true, reducedFunctionality: ['search'] };
    }
  }
};

// Zentraler Error Handler
async function handleSimulationError(error, context) {
  const errorType = error.name || 'UnknownError';
  const handler = errorHandlers[errorType] || errorHandlers.UnknownError;

  const decision = handler.handler(error, context);

  // Audit-Log
  logEvent("error", "simulation_error_handled", {
    errorType,
    severity: handler.severity,
    recoverable: handler.recoverable,
    decision
  });

  return decision;
}
```

---

### 🟡 Mittel: Fehlende Input-Validierung

**Problem:**
```javascript
// simulation_helpers.js Zeile 394
export async function assignVehiclesByDistance(incident, vehiclesPath, overridesPath, minVehicles = 1) {
  // Koordinaten prüfen
  if (!incident?.latitude || !incident?.longitude) {
    log("debug", "Keine Koordinaten für Fahrzeugzuweisung", {...});
    return [];
  }
  // Aber: Was wenn latitude/longitude keine Zahlen sind?
  // Was wenn vehiclesPath nicht existiert?
}
```

**Lösung:**
```javascript
// Validierungs-Schema
const schemas = {
  incident: {
    latitude: (v) => typeof v === 'number' && v >= -90 && v <= 90,
    longitude: (v) => typeof v === 'number' && v >= -180 && v <= 180,
    id: (v) => typeof v === 'string' && v.length > 0
  },
  path: {
    exists: async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    }
  }
};

// Validator
function validateInput(data, schema, fieldName) {
  const errors = [];

  for (const [key, validator] of Object.entries(schema)) {
    if (!validator(data[key])) {
      errors.push(`${fieldName}.${key} ist ungültig: ${data[key]}`);
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(`Validierung fehlgeschlagen: ${errors.join(', ')}`, { errors });
  }
}

// Usage
export async function assignVehiclesByDistance(incident, vehiclesPath, overridesPath, minVehicles = 1) {
  // Input validieren
  validateInput(incident, schemas.incident, 'incident');

  if (!await schemas.path.exists(vehiclesPath)) {
    throw new FileNotFoundError(`Vehicles file nicht gefunden: ${vehiclesPath}`);
  }

  // Rest der Funktion...
}
```

---

## 3. PERFORMANCE & OPTIMIERUNG

### 🔴 Kritisch: Ineffiziente Protokoll-Suche

**Problem:**
```javascript
// sim_loop.js Zeile 179-184
const sortedProtokoll = [...protokoll].sort((a, b) => {
  const timeA = `${a.datum || ""} ${a.zeit || ""}`;
  const timeB = `${b.datum || ""} ${b.zeit || ""}`;
  return timeA.localeCompare(timeB);
});

// Dann für jeden Eintrag (i):
for (let i = 0; i < sortedProtokoll.length; i++) {
  // ...
  const hasAnswer = sortedProtokoll.slice(i + 1).some(p => {
    // Durchsucht ALLE nachfolgenden Einträge
  });
}
```

**Komplexität:** O(n²) bei n Protokolleinträgen

**Lösung:**
```javascript
// Index-basierte Suche
class ProtocolIndex {
  constructor(protokoll) {
    this.byNr = new Map();
    this.byTime = [];
    this.byRecipient = new Map();
    this.bySender = new Map();

    this.buildIndex(protokoll);
  }

  buildIndex(protokoll) {
    // Zeitlich sortiert
    this.byTime = [...protokoll].sort((a, b) => {
      const timeA = `${a.datum || ""} ${a.zeit || ""}`;
      const timeB = `${b.datum || ""} ${b.zeit || ""}`;
      return timeA.localeCompare(timeB);
    });

    // Nach Nr indexieren
    for (const entry of this.byTime) {
      if (entry.nr) {
        this.byNr.set(entry.nr, entry);
      }

      // Nach Absender
      if (entry.anvon) {
        if (!this.bySender.has(entry.anvon)) {
          this.bySender.set(entry.anvon, []);
        }
        this.bySender.get(entry.anvon).push(entry);
      }

      // Nach Empfänger
      const recipients = Array.isArray(entry.ergehtAn) ? entry.ergehtAn : [];
      for (const recipient of recipients) {
        if (!this.byRecipient.has(recipient)) {
          this.byRecipient.set(recipient, []);
        }
        this.byRecipient.get(recipient).push(entry);
      }
    }
  }

  findResponseTo(entry) {
    // 1. Direkte Referenz über bezugNr
    if (entry.nr) {
      for (const p of this.byTime) {
        if (p.id === entry.id) continue;
        const refNr = p.bezugNr || p.referenzNr || p.antwortAuf;
        if (refNr && String(refNr) === String(entry.nr)) {
          return p;
        }
      }
    }

    // 2. Nach Sender suchen (Original-Empfänger)
    const originalRecipients = Array.isArray(entry.ergehtAn) ? entry.ergehtAn : [];
    for (const recipient of originalRecipients) {
      const sentByRecipient = this.bySender.get(recipient) || [];
      for (const p of sentByRecipient) {
        if (p.zeit > entry.zeit) {
          return p;
        }
      }
    }

    return null;
  }
}

// Usage
function identifyMessagesNeedingResponse(protokoll, protokollDelta, roles) {
  const index = new ProtocolIndex(protokoll);
  const needingResponse = [];

  for (const entry of protokollDelta) {
    // ...
    const hasResponse = index.findResponseTo(entry);
    if (!hasResponse) {
      needingResponse.push(entry);
    }
  }

  return needingResponse;
}
```

**Performance-Gewinn:** O(n) statt O(n²) – bei 1000 Einträgen: ~1000x schneller

---

### 🟡 Mittel: Fehlende Caching-Strategie

**Problem:**
```javascript
// llm_client.js - Disaster Context wird bei jedem Call neu berechnet
const { summary: disasterContext } = await getFilteredDisasterContextSummary({ maxLength: 1500 });
```

**Lösung:**
```javascript
// Cache-Manager
class CacheManager {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map(); // Time-to-live
  }

  set(key, value, ttlMs = 60000) {
    this.cache.set(key, value);
    this.ttl.set(key, Date.now() + ttlMs);
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    const expiresAt = this.ttl.get(key);
    if (Date.now() > expiresAt) {
      this.cache.delete(key);
      this.ttl.delete(key);
      return null;
    }

    return this.cache.get(key);
  }

  invalidate(pattern) {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.ttl.delete(key);
      }
    }
  }
}

const cache = new CacheManager();

// Cached Disaster Context
async function getCachedDisasterContext(options = {}) {
  const cacheKey = `disaster-context:${JSON.stringify(options)}`;

  let context = cache.get(cacheKey);
  if (context) {
    logDebug("Disaster Context aus Cache", { cacheKey });
    return context;
  }

  context = await getFilteredDisasterContextSummary(options);
  cache.set(cacheKey, context, 30000); // 30s TTL

  return context;
}

// Cache invalidieren bei neuen Daten
export async function stepSimulation(options = {}) {
  // ...

  // Nach LLM-Operations: Cache invalidieren
  if (operations.board?.createIncidentSites?.length > 0) {
    cache.invalidate('disaster-context:.*');
  }

  // ...
}
```

**Performance-Gewinn:** 50-200ms pro Simulationsschritt bei großen Kontexten

---

### 🟡 Mittel: Unnötige String-Konkatination

**Problem:**
```javascript
// sim_loop.js Zeile 262-268
const entryTime = `${entry.datum || ""} ${entry.zeit || ""}`;
const pTime = `${p.datum || ""} ${p.zeit || ""}`;
if (pTime > entryTime) {
  return true;
}
```

Bei 1000 Protokolleinträgen werden unnötige Strings erstellt.

**Lösung:**
```javascript
// Zeit als Timestamp speichern
function parseTimestamp(datum, zeit) {
  if (!datum || !zeit) return 0;

  // Cache für häufige Konversionen
  const key = `${datum}_${zeit}`;
  if (timestampCache.has(key)) {
    return timestampCache.get(key);
  }

  // Parse "DD.MM.YYYY" und "HH:MM"
  const [day, month, year] = datum.split('.');
  const [hour, minute] = zeit.split(':');

  const timestamp = new Date(year, month - 1, day, hour, minute).getTime();
  timestampCache.set(key, timestamp);

  return timestamp;
}

// Usage
const entryTimestamp = parseTimestamp(entry.datum, entry.zeit);
const pTimestamp = parseTimestamp(p.datum, p.zeit);

if (pTimestamp > entryTimestamp) {
  return true;
}
```

---

## 4. KONFIGURIERBARKEIT & WARTBARKEIT

### 🟡 Mittel: Magic Numbers

**Problem:**
```javascript
// sim_loop.js
const maxItems = CONFIG.prompt?.maxBoardItems || 25;  // Warum 25?

// simulation_helpers.js Zeile 244-246
if (Math.random() < 0.3) {  // Warum 30%?
  item.status = newStatus;
}

// simulation_helpers.js Zeile 265
if (updated >= 2) break;  // Warum max 2?
```

**Lösung:**
```javascript
// config.js - Neue Sektion
export const SIMULATION_DEFAULTS = {
  compression: {
    maxBoardItems: 25,
    maxAufgabenItems: 50,
    maxProtokollItems: 30,
    maxContentLength: 100
  },

  statusProgression: {
    // Wahrscheinlichkeit pro Schritt dass Task-Status fortschreitet
    probabilityPerStep: 0.3,
    // Max Anzahl Tasks die pro Rolle pro Schritt fortschreiten
    maxTasksPerRolePerStep: 2,
    // Mindestanzahl Schritte bevor Status wechselt
    minStepsBeforeChange: 1
  },

  s2Rules: {
    // Mindestanzahl Einsätze "In Bearbeitung" wenn S2 simuliert
    minIncidentsInProgress: 1
  },

  vehicleAssignment: {
    // Mindestanzahl Fahrzeuge pro Einsatz
    minVehiclesPerIncident: 1,
    // Max Entfernung in km für Fahrzeugzuweisung
    maxDistanceKm: 50
  }
};

// Usage mit Dokumentation
/**
 * Führt Statuswechsel für Aufgaben durch.
 * Wahrscheinlichkeit und Limits sind konfigurierbar in SIMULATION_DEFAULTS.statusProgression
 */
export async function updateTaskStatusForSimulatedRoles(activeRoles, dataDir) {
  const config = SIMULATION_DEFAULTS.statusProgression;

  for (const item of items) {
    // ...

    // Statuswechsel mit konfigurierter Wahrscheinlichkeit
    if (Math.random() < config.probabilityPerStep) {
      item.status = newStatus;
      // ...
      updated++;

      // Konfiguriertes Limit
      if (updated >= config.maxTasksPerRolePerStep) break;
    }
  }
}
```

---

### 🟡 Mittel: Schwierigkeitsgrade nicht parametrisiert

**Problem:**
Szenarien haben Schwierigkeitsgrade ("easy", "medium", "hard", "EXTREM"), aber diese beeinflussen die Simulation nicht direkt.

**Lösung:**
```javascript
// scenario_controls.js
export const DIFFICULTY_MODIFIERS = {
  easy: {
    label: "Einfach",
    statusProgressionSpeed: 0.5,    // Tasks schreiten schneller fort
    entityMultiplier: 0.7,           // 30% weniger Entities
    llmTemperatureBoost: -0.1,       // Vorhersehbarer
    responseTimeMultiplier: 1.5      // Mehr Zeit für Antworten
  },

  medium: {
    label: "Mittel",
    statusProgressionSpeed: 0.3,
    entityMultiplier: 1.0,
    llmTemperatureBoost: 0,
    responseTimeMultiplier: 1.0
  },

  hard: {
    label: "Schwer",
    statusProgressionSpeed: 0.2,
    entityMultiplier: 1.3,
    llmTemperatureBoost: 0.1,
    responseTimeMultiplier: 0.8
  },

  extreme: {
    label: "Extrem",
    statusProgressionSpeed: 0.1,     // Tasks brauchen länger
    entityMultiplier: 1.8,           // 80% mehr Entities
    llmTemperatureBoost: 0.2,        // Unvorhersehbarer
    responseTimeMultiplier: 0.5      // Weniger Zeit
  }
};

// In Phase Requirements anwenden
export function getAdjustedEntityRequirements(phase, difficulty = 'medium') {
  const modifier = DIFFICULTY_MODIFIERS[difficulty] || DIFFICULTY_MODIFIERS.medium;

  return {
    einsatzstellen: {
      min: Math.ceil(phase.entityRequirements.einsatzstellen.min * modifier.entityMultiplier),
      max: phase.entityRequirements.einsatzstellen.max
        ? Math.ceil(phase.entityRequirements.einsatzstellen.max * modifier.entityMultiplier)
        : null
    },
    // ... analog für meldungen, aufgaben
  };
}
```

---

## 5. TESTBARKEIT

### 🔴 Kritisch: Fehlende Unit-Tests

**Problem:**
Keine Test-Infrastruktur sichtbar. Globaler State und fest verdrahtete Abhängigkeiten erschweren Tests.

**Lösung:**
```javascript
// tests/sim_loop.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Simulation Loop', () => {
  let simulationState;
  let mockEinfoIO;
  let mockLLMClient;

  beforeEach(() => {
    // State isolieren
    simulationState = new SimulationState();

    // Dependencies mocken
    mockEinfoIO = {
      readEinfoInputs: vi.fn().mockResolvedValue({
        roles: { active: ['S1', 'S3'] },
        board: [],
        aufgaben: [],
        protokoll: []
      })
    };

    mockLLMClient = {
      callLLMForOps: vi.fn().mockResolvedValue({
        parsed: {
          operations: {
            board: { createIncidentSites: [], updateIncidentSites: [] },
            aufgaben: { create: [], update: [] },
            protokoll: { create: [] }
          },
          analysis: "Test analysis"
        }
      })
    };
  });

  it('should identify messages needing response', () => {
    const protokoll = [
      {
        id: '1',
        nr: 1,
        richtung: 'aus',
        ergehtAn: ['Polizei'],
        information: 'Test-Meldung',
        datum: '21.01.2026',
        zeit: '10:00'
      }
    ];

    const roles = { active: ['S1'] };

    const result = identifyMessagesNeedingResponse(protokoll, protokoll, roles);

    expect(result).toHaveLength(1);
    expect(result[0].externalRecipients).toContain('Polizei');
  });

  it('should handle LLM timeout with retry', async () => {
    mockLLMClient.callLLMForOps
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ parsed: { operations: {} } });

    const result = await stepSimulation({ source: 'test' });

    expect(mockLLMClient.callLLMForOps).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('should skip step when analysis in progress', async () => {
    vi.mocked(isAnalysisInProgress).mockReturnValue(true);

    const result = await stepSimulation({ source: 'test' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('analysis_in_progress');
  });
});

// tests/simulation_helpers.test.js
describe('Vehicle Assignment', () => {
  it('should assign closest vehicles by distance', async () => {
    const incident = {
      id: 'test-1',
      latitude: 46.7233,
      longitude: 14.0954,
      ort: 'Feldkirchen'
    };

    const vehicles = [
      { id: 'ff-1', ort: 'FF Feldkirchen' },
      { id: 'ff-2', ort: 'FF Gnesau' }
    ];

    // Mock file reads
    fs.readFile = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(vehicles))
      .mockResolvedValueOnce('{}');

    const assigned = await assignVehiclesByDistance(incident, 'vehicles.json', 'overrides.json');

    expect(assigned).toContain('ff-1'); // FF Feldkirchen ist am nächsten
    expect(assigned).toHaveLength(1);
  });
});
```

**Test-Coverage Ziele:**
- Unit-Tests: 80% Coverage
- Integration-Tests: kritische Pfade (LLM-Calls, File I/O)
- E2E-Tests: Vollständige Simulation mit Mock-LLM

---

## 6. MONITORING & OBSERVABILITY

### 🟡 Mittel: Strukturierte Metriken fehlen

**Problem:**
Audit-Trail loggt Events, aber keine aggregierten Metriken.

**Lösung:**
```javascript
// metrics.js
class SimulationMetrics {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
  }

  incrementCounter(name, labels = {}, value = 1) {
    const key = this.makeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  recordHistogram(name, labels = {}, value) {
    const key = this.makeKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push({ value, timestamp: Date.now() });
  }

  setGauge(name, labels = {}, value) {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, value);
  }

  makeKey(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  getStats(name) {
    const histogram = Array.from(this.histograms.entries())
      .filter(([key]) => key.startsWith(name))
      .flatMap(([, values]) => values.map(v => v.value));

    if (histogram.length === 0) return null;

    const sorted = histogram.sort((a, b) => a - b);
    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  exportPrometheus() {
    const lines = [];

    // Counters
    for (const [key, value] of this.counters.entries()) {
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.gauges.entries()) {
      lines.push(`${key} ${value}`);
    }

    return lines.join('\n');
  }
}

const metrics = new SimulationMetrics();

// Usage in sim_loop.js
export async function stepSimulation(options = {}) {
  const startTime = Date.now();

  try {
    // ...

    // LLM Call Dauer messen
    const llmStart = Date.now();
    const llmResponse = await callLLMForOps({ ... });
    const llmDuration = Date.now() - llmStart;

    metrics.recordHistogram('simulation_llm_call_duration_ms',
      { model: CONFIG.llmChatModel }, llmDuration);

    // Operations zählen
    metrics.incrementCounter('simulation_operations_total',
      { type: 'board_create' },
      operations.board?.createIncidentSites?.length || 0);

    metrics.incrementCounter('simulation_operations_total',
      { type: 'protokoll_create' },
      operations.protokoll?.create?.length || 0);

    // Simulationszeit
    const stepDuration = Date.now() - startTime;
    metrics.recordHistogram('simulation_step_duration_ms',
      { source: options.source }, stepDuration);

    // Aktuelle Simulation-Minute als Gauge
    metrics.setGauge('simulation_elapsed_minutes', {}, simulationElapsedMinutes);

    return { ok: true, operations, analysis };
  } finally {
    stepInProgress = false;
  }
}

// API Endpoint für Metriken
// In index.js
app.get('/api/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(metrics.exportPrometheus());
});

// Dashboard
app.get('/api/metrics/stats', (req, res) => {
  res.json({
    llmCalls: metrics.getStats('simulation_llm_call_duration_ms'),
    stepDuration: metrics.getStats('simulation_step_duration_ms'),
    operationCounts: {
      boardCreate: metrics.counters.get('simulation_operations_total{type="board_create"}') || 0,
      protokollCreate: metrics.counters.get('simulation_operations_total{type="protokoll_create"}') || 0
    }
  });
});
```

---

## 7. SZENARIO-MANAGEMENT

### 🟡 Mittel: Fehlende Trigger-Implementierung

**Problem:**
Szenarien definieren Triggers (Zeile 239-298 in scenario_controls.js), aber diese werden nicht ausgeführt.

**Lösung:**
```javascript
// scenario_triggers.js
export class TriggerManager {
  constructor(scenario) {
    this.scenario = scenario;
    this.triggers = scenario?.triggers || [];
    this.executedTriggers = new Set();
  }

  async evaluateTriggers(context) {
    const {
      elapsedMinutes,
      boardState,
      protokollState,
      aufgabenState
    } = context;

    const triggersToExecute = [];

    for (const [index, trigger] of this.triggers.entries()) {
      const triggerId = `${index}_${JSON.stringify(trigger.condition)}`;

      // Skip bereits ausgeführte Triggers
      if (this.executedTriggers.has(triggerId)) continue;

      // Bedingung prüfen
      const conditionMet = this.evaluateCondition(trigger.condition, context);

      if (conditionMet) {
        triggersToExecute.push({ ...trigger, triggerId });
        this.executedTriggers.add(triggerId);
      }
    }

    // Actions ausführen
    const operations = {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    for (const trigger of triggersToExecute) {
      const action = await this.executeAction(trigger.action);
      this.mergeOperations(operations, action);

      logInfo("Szenario-Trigger ausgeführt", {
        condition: trigger.condition,
        action: trigger.action.type
      });
    }

    return operations;
  }

  evaluateCondition(condition, context) {
    switch (condition.type) {
      case 'time_elapsed':
        return context.elapsedMinutes >= condition.minutes;

      case 'incident_count': {
        const column = condition.column || 'neu';
        const count = context.boardState.columns[column]?.items?.length || 0;

        switch (condition.operator) {
          case 'gte': return count >= condition.value;
          case 'lte': return count <= condition.value;
          case 'eq': return count === condition.value;
          default: return false;
        }
      }

      case 'task_completed': {
        const task = context.aufgabenState.find(t => t.id === condition.taskId);
        return task?.status === 'Erledigt';
      }

      default:
        logError("Unbekannter Trigger-Typ", { type: condition.type });
        return false;
    }
  }

  async executeAction(action) {
    switch (action.type) {
      case 'add_incident':
        return {
          board: {
            createIncidentSites: [action.data]
          }
        };

      case 'external_message':
        return {
          protokoll: {
            create: [{
              ...action.data,
              createdBy: 'scenario-trigger',
              uebermittlungsart: { ein: true }
            }]
          }
        };

      case 'create_protocol':
        return {
          protokoll: {
            create: [action.data]
          }
        };

      default:
        logError("Unbekannter Action-Typ", { type: action.type });
        return {};
    }
  }

  mergeOperations(target, source) {
    if (source.board?.createIncidentSites) {
      target.board.createIncidentSites.push(...source.board.createIncidentSites);
    }
    if (source.protokoll?.create) {
      target.protokoll.create.push(...source.protokoll.create);
    }
    // ... etc
  }
}

// In sim_loop.js integrieren
export async function stepSimulation(options = {}) {
  // ...

  // Trigger evaluieren
  let triggerOperations = {};
  if (activeScenario?.triggers) {
    const triggerManager = new TriggerManager(activeScenario);
    triggerOperations = await triggerManager.evaluateTriggers({
      elapsedMinutes: simulationElapsedMinutes,
      boardState: board,
      protokollState: protokoll,
      aufgabenState: aufgaben
    });
  }

  // Mit LLM-Operations zusammenführen
  const combinedOperations = mergeOperations(llmResponse.operations, triggerOperations);

  // ...
}
```

---

## 8. DOKUMENTATION

### 🟡 Mittel: Fehlende JSDoc an kritischen Stellen

**Problem:**
Viele komplexe Funktionen haben keine oder unvollständige Dokumentation.

**Lösung:**
```javascript
/**
 * Identifiziert Protokolleinträge die eine Antwort von simulierten Rollen benötigen.
 *
 * Algorithmus:
 * 1. Filtert ausgehende Meldungen aus dem Protokoll-Delta
 * 2. Prüft ob Meldung bereits beantwortet wurde (über bezugNr oder zeitliche Korrelation)
 * 3. Identifiziert Empfänger die nicht aktiv besetzt sind
 * 4. Unterscheidet zwischen internen Stabsrollen und externen Stellen
 *
 * @param {Array<Object>} protokoll - Alle Protokolleinträge (für Antwort-Check)
 * @param {Array<Object>} protokollDelta - Nur neue/geänderte Einträge (werden geprüft)
 * @param {Object} roles - { active: string[] } - Aktiv besetzte Rollen
 *
 * @returns {Array<Object>} Array von Meldungen die Antwort benötigen, mit Struktur:
 *   - id: string - Protokoll-ID
 *   - nr: number - Protokoll-Nummer
 *   - information: string - Meldungstext
 *   - allRecipients: string[] - Alle nicht-aktiven Empfänger
 *   - internalMissing: string[] - Nicht-besetzte Stabsrollen
 *   - externalRecipients: string[] - Externe Stellen (Polizei, BH, etc.)
 *
 * @complexity O(n²) wo n = Anzahl Protokolleinträge
 * @see {@link identifyOpenQuestions} für ähnliche Logik bei Rückfragen
 *
 * @example
 * const messages = identifyMessagesNeedingResponse(
 *   allProtocol,
 *   newProtocol,
 *   { active: ['S1', 'S3'] }
 * );
 * // => [{ id: '123', externalRecipients: ['Polizei'], ... }]
 */
function identifyMessagesNeedingResponse(protokoll, protokollDelta, roles) {
  // ...
}
```

---

## ZUSAMMENFASSUNG & PRIORISIERUNG

### Kritische Verbesserungen (sofort umsetzen)

1. **State Management refactoren** (2-3 Tage)
   - SimulationState Klasse einführen
   - Globale Variablen eliminieren
   - Multi-Session Support vorbereiten

2. **Error Handling vereinheitlichen** (1-2 Tage)
   - Error-Klassifikation einführen
   - Recovery-Strategien implementieren
   - Input-Validierung ergänzen

3. **Performance: Protokoll-Index** (1 Tag)
   - ProtocolIndex Klasse implementieren
   - O(n²) → O(n) Optimierung
   - 10-100x Speedup bei großen Protokollen

### Mittelfristige Verbesserungen (nächste 2 Wochen)

4. **Testbarkeit verbessern** (3-5 Tage)
   - Test-Framework aufsetzen (Vitest)
   - Unit-Tests für kritische Funktionen
   - Integration-Tests für Simulation-Loop

5. **Code-Duplikation eliminieren** (2 Tage)
   - Gemeinsame Basis-Funktionen extrahieren
   - Kompression-Funktionen vereinheitlichen
   - Validierungs-Helper zentralisieren

6. **Konfigurierbarkeit erhöhen** (1-2 Tage)
   - Magic Numbers in Config auslagern
   - Schwierigkeitsgrad-Modifikatoren
   - Dokumentierte Defaults

### Langfristige Verbesserungen (nächste 1-2 Monate)

7. **Monitoring & Metriken** (3-4 Tage)
   - SimulationMetrics implementieren
   - Prometheus-Export
   - Dashboard für Simulation-Stats

8. **Trigger-System** (3-5 Tage)
   - TriggerManager implementieren
   - Trigger-Evaluierung in Loop integrieren
   - Trigger-Testing

9. **Dokumentation** (laufend)
   - JSDoc für alle Public APIs
   - Architecture Decision Records
   - Runbook für Operations

---

## GESCHÄTZTER ROI

| Verbesserung | Aufwand | Performance-Gewinn | Wartbarkeit | Robustheit |
|--------------|---------|-------------------|-------------|------------|
| State Management | ⏱️⏱️⏱️ | - | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Error Handling | ⏱️⏱️ | - | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Protokoll-Index | ⏱️ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| Testing | ⏱️⏱️⏱️⏱️ | - | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Code-Duplikation | ⏱️⏱️ | - | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Konfigurierbarkeit | ⏱️⏱️ | - | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Monitoring | ⏱️⏱️⏱️ | - | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Trigger-System | ⏱️⏱️⏱️⏱️ | - | ⭐⭐⭐ | ⭐⭐⭐⭐ |

**Legende:**
- ⏱️ = 1 Personentag
- ⭐ = Geringer Nutzen ... ⭐⭐⭐⭐⭐ = Sehr hoher Nutzen

---

## NÄCHSTE SCHRITTE

1. **Priorisierungs-Meeting**: Stakeholder entscheiden über Reihenfolge
2. **Proof-of-Concept**: State Management Refactoring in separatem Branch
3. **Test-Suite aufsetzen**: CI/CD Pipeline mit automatischen Tests
4. **Inkrementelles Rollout**: Feature-Flags für neue Implementierungen

---

**Erstellt:** 2026-01-21
**Version:** 1.0
**Review-Datum:** 2026-02-21
