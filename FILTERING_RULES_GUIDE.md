# Filtering Rules System - Anleitung

## Übersicht

Das Filtering Rules System ist ein modulares, erweiterbares System zur intelligenten Filterung von EINFO-Daten vor dem LLM-Aufruf.

**Datei:** `chatbot/server/filtering_rules.js`

## Architektur-Prinzipien

### ✅ Design-Ziele
- **Modular**: Jede Regel ist eine unabhängige Funktion
- **Konfigurierbar**: Alle Parameter in `FILTERING_CONFIG`
- **Erweiterbar**: Neue Regeln einfach hinzufügen
- **Testbar**: Jede Regel kann isoliert getestet werden
- **Transparent**: Nachvollziehbar was gefiltert wird

### 📁 Datei-Struktur

```javascript
filtering_rules.js
├── FILTERING_CONFIG          // Zentrale Konfiguration
├── filterIncidents()          // Regel 1: Einsätze filtern
├── scoreProtocolEntry()       // Regel 2a: Protokoll bewerten
├── filterProtocol()           // Regel 2b: Protokoll filtern
├── aggregateTasks()           // Regel 3: Aufgaben aggregieren
├── calculateResourceStatus()  // Regel 4: Ressourcen berechnen
├── calculateTrends()          // Regel 5: Trends erkennen
└── applyAllFilteringRules()   // Convenience: Alle Regeln anwenden
```

---

## Verwendung

### Basic Usage

```javascript
import { applyAllFilteringRules } from './filtering_rules.js';

// In disaster_context.js oder situation_analyzer.js:
const einfoData = await loadCurrentEinfoData();

const filtered = applyAllFilteringRules({
  activeIncidents: einfoData.board.filter(isActive),
  protokoll: einfoData.protokoll,
  openTasks: einfoData.aufgaben.filter(isOpen),
  timeline: disasterContext.timeline,
  board: einfoData.board
});

// Nutze gefilterte Daten:
console.log(filtered.incidents);      // Top 10 relevante Einsätze
console.log(filtered.protocol);       // Top 10 wichtige Protokoll-Einträge
console.log(filtered.tasks);          // Aggregierte Aufgaben-Übersicht
console.log(filtered.resources);      // Ressourcen-Status
console.log(filtered.trends);         // Trend-Analyse
```

### Custom Configuration

```javascript
// Eigene Config übergeben (wird mit defaults gemerged)
const filtered = applyAllFilteringRules(einfoData, {
  incidents: {
    maxCount: 15,  // Mehr Einsätze zeigen
    includeAlertedUnits: true  // Mit Details
  },
  protocol: {
    maxCount: 5  // Weniger Protokoll
  },
  trends: {
    enabled: false  // Trend-Analyse deaktivieren
  }
});
```

### Individual Rules

```javascript
// Nur einzelne Regeln nutzen
import { filterIncidents, calculateTrends } from './filtering_rules.js';

const topIncidents = filterIncidents(activeIncidents);
const trend = calculateTrends(timeline, board);
```

---

## Neue Regeln hinzufügen

### Schritt 1: Konfiguration erweitern

```javascript
// In FILTERING_CONFIG hinzufügen:
export const FILTERING_CONFIG = {
  // ... bestehende Regeln ...

  // NEUE REGEL: Wetterprognose einbeziehen
  weather: {
    enabled: true,
    sources: ['zamg', 'geosphere'],
    includeWarnings: true,
    forecastHours: 6
  }
};
```

### Schritt 2: Regel-Funktion schreiben

```javascript
/**
 * REGEL 6: Weather Impact Analysis
 * Analysiert Wetter-Einfluss auf Einsatzlage
 */
export function analyzeWeatherImpact(incidents, config = FILTERING_CONFIG.weather) {
  if (!config.enabled) {
    return { impact: 'unknown', warnings: [] };
  }

  // Sub-Regel 6.1: Hole Wetterdaten (z.B. von API)
  const weatherData = fetchWeatherData(config.sources);

  // Sub-Regel 6.2: Bestimme Impact
  const warnings = [];
  let impact = 'low';

  if (weatherData.precipitation > 50) {  // > 50mm Regen
    impact = 'high';
    warnings.push('Starkregen erwartet - Hochwassergefahr steigt');
  }

  if (weatherData.wind > 80) {  // > 80 km/h Wind
    impact = 'high';
    warnings.push('Sturm erwartet - weitere Schäden wahrscheinlich');
  }

  // Sub-Regel 6.3: Verknüpfe mit Einsatztypen
  const weatherRelated = incidents.filter(i => {
    const type = String(i.type || '').toLowerCase();
    return type.includes('überflutung') ||
           type.includes('baum') ||
           type.includes('wasser');
  });

  return {
    impact,
    warnings,
    affectedIncidents: weatherRelated.length,
    forecast: `${weatherData.precipitation}mm Regen, ${weatherData.wind}km/h Wind`
  };
}
```

### Schritt 3: In `applyAllFilteringRules()` integrieren

```javascript
export function applyAllFilteringRules(einfoData, customConfig = {}) {
  const config = {
    // ... bestehende configs ...
    weather: { ...FILTERING_CONFIG.weather, ...customConfig.weather }
  };

  return {
    incidents: filterIncidents(einfoData.activeIncidents, config.incidents),
    protocol: filterProtocol(einfoData.protokoll, config.protocol),
    tasks: aggregateTasks(einfoData.openTasks, config.tasks),
    resources: calculateResourceStatus(einfoData.activeIncidents, config.resources),
    trends: calculateTrends(einfoData.timeline, einfoData.board, config.trends),
    weather: analyzeWeatherImpact(einfoData.activeIncidents, config.weather)  // NEU!
  };
}
```

### Schritt 4: Nutzen im Prompt

```javascript
// In disaster_context.js:
function buildOptimizedDisasterSummary(filtered) {
  let summary = `### LAGE-ÜBERSICHT ###\n`;
  // ... bestehende Daten ...

  // NEU: Wetter-Impact
  if (filtered.weather.impact !== 'low') {
    summary += `\n### WETTER-EINFLUSS ###\n`;
    summary += `Impact: ${filtered.weather.impact}\n`;
    summary += `Prognose: ${filtered.weather.forecast}\n`;
    if (filtered.weather.warnings.length > 0) {
      summary += `Warnungen:\n`;
      filtered.weather.warnings.forEach(w => {
        summary += `  - ${w}\n`;
      });
    }
  }

  return summary;
}
```

---

## Beispiele für erweiterbare Regeln

### Regel-Idee 1: Geographische Cluster-Analyse

```javascript
geoclusters: {
  enabled: true,
  clusterRadius: 1000, // Meter
  minClusterSize: 3,
  highlightHotspots: true
}

export function detectGeoClusters(incidents, config) {
  // Gruppiere Einsätze nach geographischer Nähe
  // Erkenne Hotspots (z.B. "5 Einsätze in 500m Radius")
  // → LLM Insight: "Schwerpunkt in Stadtteil X"
}
```

### Regel-Idee 2: Einsatzdauer-Tracking

```javascript
duration: {
  enabled: true,
  longRunningThreshold: 120, // Minuten
  warnAt: 180 // Warn nach 3h (Ablösung nötig)
}

export function analyzeDurations(incidents, config) {
  // Berechne Einsatzdauer aus Timestamps
  // Markiere lang laufende Einsätze
  // → LLM Insight: "3 Einsätze > 3h, Ablösung nötig"
}
```

### Regel-Idee 3: Prioritäts-Drift Erkennung

```javascript
priorityDrift: {
  enabled: true,
  checkInterval: 30, // Minuten
  escalationTriggers: ['keine reaktion', 'verschlimmert']
}

export function detectPriorityDrift(incidents, timeline, config) {
  // Prüfe ob medium→high eskaliert ist
  // Erkenne stagnierende high-priority Einsätze
  // → LLM Insight: "Einsatz #42 seit 90min high-prio ohne Fortschritt"
}
```

### Regel-Idee 4: Kommunikations-Bottleneck

```javascript
communication: {
  enabled: true,
  slowResponseThreshold: 15, // Minuten
  trackRoles: ['S1', 'S3', 'LTSTB']
}

export function detectCommunicationBottlenecks(protocol, config) {
  // Finde unbeantwortete Anfragen
  // Identifiziere langsame Rollen
  // → LLM Insight: "S3 antwortet langsam (Ø 25min)"
}
```

---

## Testing

### Unit-Tests für Regeln

```javascript
// test/filtering_rules.test.js
import { filterIncidents, scoreProtocolEntry } from '../filtering_rules.js';

describe('filterIncidents', () => {
  it('sollte critical/high immer zeigen', () => {
    const incidents = [
      { id: 1, priority: 'critical' },
      { id: 2, priority: 'low' },
      { id: 3, priority: 'low' }
    ];

    const config = { maxCount: 1, alwaysShowPriorities: ['critical', 'high'] };
    const result = filterIncidents(incidents, config);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('sollte nach Einheiten-Anzahl sortieren', () => {
    const incidents = [
      { id: 1, priority: 'medium', alerted: 'FF A, FF B, FF C' },
      { id: 2, priority: 'medium', alerted: 'FF D' }
    ];

    const config = { maxCount: 1, preferLargeOps: true };
    const result = filterIncidents(incidents, config);

    expect(result[0].id).toBe(1); // Mehr Einheiten = wichtiger
  });
});

describe('scoreProtocolEntry', () => {
  it('sollte Fragen hoch bewerten', () => {
    const entry = { information: 'Brauchen wir mehr Pumpen?' };
    const result = scoreProtocolEntry(entry);

    expect(result.relevance).toBeGreaterThan(0);
    expect(result.category).toBe('open_question');
  });

  it('sollte Safety-Critical erkennen', () => {
    const entry = { information: 'Evakuierung in Sektor 3 notwendig' };
    const result = scoreProtocolEntry(entry);

    expect(result.category).toBe('safety_critical');
    expect(result.relevance).toBeGreaterThan(8);
  });
});
```

---

## Konfiguration zur Laufzeit ändern

### Option 1: Umgebungsvariablen

```javascript
// In config.js oder filtering_rules.js:
export const FILTERING_CONFIG = {
  incidents: {
    maxCount: parseInt(process.env.FILTER_MAX_INCIDENTS || '10'),
    includeAlertedUnits: process.env.FILTER_INCLUDE_UNITS === 'true'
  }
};
```

### Option 2: Config-Datei

```javascript
// config/filtering_rules.json
{
  "incidents": {
    "maxCount": 15,
    "alwaysShowPriorities": ["critical", "high"]
  }
}

// In filtering_rules.js:
import customConfig from '../config/filtering_rules.json';
export const FILTERING_CONFIG = {
  ...DEFAULT_CONFIG,
  ...customConfig
};
```

### Option 3: API Endpoint (dynamisch)

```javascript
// In index.js:
app.post('/api/filtering/config', (req, res) => {
  const { rule, config } = req.body;

  // Update Config zur Laufzeit
  FILTERING_CONFIG[rule] = { ...FILTERING_CONFIG[rule], ...config };

  res.json({ success: true, config: FILTERING_CONFIG[rule] });
});
```

---

## Best Practices

### ✅ DO

1. **Jede Regel dokumentieren** mit JSDoc-Kommentar
2. **Config-Parameter benennen** klar und eindeutig
3. **Default-Werte setzen** für alle Parameter
4. **Enabled-Flag** für jede Regel (ein-/ausschaltbar)
5. **Helper-Funktionen** am Ende der Datei
6. **Unit-Tests** für jede Regel schreiben

### ❌ DON'T

1. **Keine Hardcoded Values** in Regel-Funktionen
2. **Keine External API Calls** ohne Fehlerbehandlung
3. **Keine Performance-Killer** (z.B. O(n²) bei großen Daten)
4. **Keine Side-Effects** (Regeln sollen rein sein)
5. **Keine verschachtelten Configs** (max 2 Ebenen)

### 🎯 Naming Convention

```javascript
// Funktionen: Verb + Nomen
filterIncidents()      // ✅
scoreProtocolEntry()   // ✅
incidentFilter()       // ❌

// Config: Nomen oder Adjektiv
maxCount               // ✅
includeAlertedUnits    // ✅
shouldIncludeUnits     // ❌ (zu verbos)

// Thresholds: Zahl mit Kontext
overloadThreshold: 5   // ✅
threshold: 5           // ❌ (welcher?)
```

---

## Performance-Überlegungen

### Komplexität

| Regel | Komplexität | Kritisch bei |
|-------|-------------|--------------|
| filterIncidents | O(n log n) | > 1000 Einsätze |
| filterProtocol | O(n log n) | > 5000 Einträge |
| aggregateTasks | O(n) | Unkritisch |
| calculateResources | O(n) | Unkritisch |
| calculateTrends | O(n) | > 10000 Timeline-Events |

### Optimierungen

```javascript
// Wenn Daten sehr groß:
export function filterIncidents(incidents, config) {
  // Early return bei kleinen Datenmengen
  if (incidents.length <= config.maxCount) {
    return incidents;
  }

  // ... rest der Filterung
}

// Caching für teure Berechnungen
const trendsCache = new Map();
export function calculateTrends(timeline, board, config) {
  const cacheKey = `${timeline.length}-${board.length}`;
  if (trendsCache.has(cacheKey)) {
    return trendsCache.get(cacheKey);
  }

  const result = /* ... berechnung ... */;
  trendsCache.set(cacheKey, result);
  return result;
}
```

---

## Integration mit bestehendem Code

### In `disaster_context.js` nutzen:

```javascript
import { applyAllFilteringRules } from './filtering_rules.js';

export async function getDisasterContextSummary({ maxLength = 1500, useFiltering = true } = {}) {
  const einfoData = await loadCurrentEinfoData();

  if (!useFiltering) {
    // Alte Methode ohne Filterung
    return buildLegacySummary(einfoData);
  }

  // Neue Methode mit Filterung
  const filtered = applyAllFilteringRules({
    activeIncidents: einfoData.board.filter(isActive),
    protokoll: einfoData.protokoll,
    openTasks: einfoData.aufgaben.filter(isOpen),
    timeline: currentDisasterContext.timeline,
    board: einfoData.board
  });

  return buildOptimizedSummary(filtered);
}

function buildOptimizedSummary(filtered) {
  let summary = `### LAGE-ÜBERSICHT ###\n`;
  summary += `Trend: ${filtered.trends.interpretation}\n\n`;

  summary += `### KRITISCHE EINSÄTZE (${filtered.incidents.length} von ${filtered.resources.totalIncidents}) ###\n`;
  filtered.incidents.forEach(inc => {
    summary += `- [${inc.priority.toUpperCase()}] ${inc.type} @ ${inc.location}\n`;
  });

  summary += `\n### RESSOURCEN ###\n`;
  summary += `${filtered.resources.totalUnitsDeployed} Einheiten alarmiert\n`;
  filtered.resources.warnings.forEach(w => summary += `⚠️ ${w}\n`);

  summary += `\n### AUFGABEN ###\n`;
  for (const [role, data] of Object.entries(filtered.tasks)) {
    summary += `${role}: ${data.count} Aufgaben${data.overloaded ? ' ⚠️ ÜBERLASTET' : ''}\n`;
  }

  summary += `\n### OFFENE FRAGEN (${filtered.protocol.length}) ###\n`;
  filtered.protocol.forEach(entry => {
    summary += `- [${entry.category}] ${entry.anvon}: ${entry.information}\n`;
  });

  return summary;
}
```

---

## Zusammenfassung

Das Filtering Rules System ermöglicht:

✅ **Modulare Entwicklung** - Jede Regel unabhängig
✅ **Einfache Erweiterung** - 3 Schritte für neue Regel
✅ **Konfigurierbar** - Alle Parameter anpassbar
✅ **Testbar** - Unit-Tests für jede Regel
✅ **Transparent** - Nachvollziehbar was gefiltert wird
✅ **Performant** - O(n log n) für meiste Regeln

**Nächste Schritte:**
1. Implementiere `buildOptimizedSummary()` in `disaster_context.js`
2. Schreibe Unit-Tests für Regeln
3. Teste mit echten Szenarien
4. Iteriere basierend auf LLM-Output-Qualität
