# Board.json Datenstruktur - Abschnitte & Einsatzstellen

**Datum:** 2026-01-18
**Quelle:** server/server.js Analyse

---

## Struktur

### Abschnitte (Areas)

```javascript
{
  "id": "a7f8e9d0",
  "humanId": "A-1",           // Prefix "A-" für Area
  "content": "Abschnitt Nord",
  "isArea": true,             // ← WICHTIG: Kennzeichen für Abschnitt
  "areaColor": "#ff5733",     // Farbe für Visualisierung
  "areaCardId": null,         // Abschnitte haben keinen Parent

  // Standard-Felder
  "ort": "",
  "typ": "",
  "latitude": 48.1234,
  "longitude": 14.5678,
  "location": "Innenstadt",
  "description": "",
  "timestamp": "2026-01-18T10:00:00Z",

  // Status
  "column": "in-bearbeitung",
  "personnel": 0,
  "everPersonnel": 0
}
```

### Einsatzstellen (normale Incidents)

```javascript
{
  "id": "b3c4d5e6",
  "humanId": "M-15",          // Prefix "M-" für Manual (oder "I-" für Import)
  "content": "Baum umgestürzt Hauptstraße 12",
  "isArea": false,            // ← Normale Einsatzstelle
  "areaCardId": "a7f8e9d0",   // ← Zuordnung zu Abschnitt (ID von "A-1")
  "areaColor": "#ff5733",     // Farbe vom Parent-Abschnitt übernommen

  // Standard-Felder
  "ort": "Hauptstraße 12",
  "typ": "Technischer Einsatz",
  "latitude": 48.1250,
  "longitude": 14.5690,
  "location": "Stadtteil Nord",
  "description": "Baum auf Fahrbahn, ca. 1,5m Durchmesser",
  "timestamp": "2026-01-18T10:15:00Z",
  "alerted": "FF Musterstadt, FF Nord",

  // Status
  "column": "in-bearbeitung",
  "personnel": 8,
  "everPersonnel": 12
}
```

---

## Board-Struktur (Kanban)

```javascript
{
  "columns": {
    "neu": {
      "name": "Neu",
      "items": [
        { "id": "...", "isArea": false, ... },
        { "id": "...", "isArea": true, ... }  // Abschnitt
      ]
    },
    "in-bearbeitung": {
      "name": "In Bearbeitung",
      "items": [ ... ]
    },
    "erledigt": {
      "name": "Erledigt",
      "items": [ ... ]
    }
  }
}
```

---

## Wichtige Unterscheidungen

### Abschnitt vs. Einsatzstelle

| Merkmal | Abschnitt | Einsatzstelle |
|---------|-----------|---------------|
| `isArea` | `true` | `false` |
| `humanId` | `A-1`, `A-2`, ... | `M-1`, `I-5`, ... |
| `areaCardId` | `null` (hat keinen Parent) | ID des Parent-Abschnitts (oder `null`) |
| `areaColor` | Eigene Farbe definiert | Übernommen vom Parent |
| Zweck | Gruppierung von Einsatzstellen | Einzelner Einsatz |

### Zuordnung

- **Einsatzstelle ohne Abschnitt:**
  ```javascript
  { "isArea": false, "areaCardId": null, "areaColor": null }
  ```

- **Einsatzstelle mit Abschnitt:**
  ```javascript
  {
    "isArea": false,
    "areaCardId": "a7f8e9d0",  // ID des Abschnitts
    "areaColor": "#ff5733"     // Automatisch vom Abschnitt übernommen
  }
  ```

- **Abschnitt erstellen/ändern:**
  - Wenn `isArea: true` → `areaCardId` wird automatisch auf `null` gesetzt
  - Wenn `isArea: false → true` → alle zugeordneten Einsatzstellen verlieren die Zuordnung

---

## Filterung für Regelsystem

### Alle Abschnitte finden

```javascript
function getAreas(board) {
  const areas = [];
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    for (const card of column.items || []) {
      if (card?.isArea) {
        areas.push(card);
      }
    }
  }
  return areas;
}
```

### Einsatzstellen eines Abschnitts finden

```javascript
function getIncidentsInArea(board, areaId) {
  const incidents = [];
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    for (const card of column.items || []) {
      if (card && !card.isArea && card.areaCardId === areaId) {
        incidents.push(card);
      }
    }
  }
  return incidents;
}
```

### Abschnitts-Statistiken berechnen

```javascript
function calculateAreaStats(board, area) {
  const incidents = getIncidentsInArea(board, area.id);

  return {
    id: area.id,
    humanId: area.humanId,
    name: area.content,
    location: area.location,
    color: area.areaColor,

    // Statistiken
    total_incidents: incidents.length,
    active_incidents: incidents.filter(i => i.column !== "erledigt").length,
    critical_incidents: incidents.filter(i => i.priority === "critical").length,

    // Priorität des Abschnitts (höchste Priorität der Einsatzstellen)
    priority: incidents.some(i => i.priority === "critical") ? "critical" :
              incidents.some(i => i.priority === "high") ? "high" : "medium",

    // Ressourcen
    total_personnel: incidents.reduce((sum, i) => sum + (i.personnel || 0), 0),

    // Status
    column: area.column
  };
}
```

### Einsatzstellen ohne Abschnitt finden

```javascript
function getUnassignedIncidents(board) {
  const incidents = [];
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    for (const card of column.items || []) {
      if (card && !card.isArea && !card.areaCardId) {
        incidents.push(card);
      }
    }
  }
  return incidents;
}
```

---

## Regel R1: Abschnitte-Priorität

### Input

```javascript
const rawData = {
  board: { /* board.json Struktur */ }
};
```

### Verarbeitung

```javascript
function applyRule_R1_AbschnittePrioritaet(board, rules) {
  const areas = getAreas(board);

  const areasWithStats = areas.map(area => {
    const stats = calculateAreaStats(board, area);

    // Bewerte Abschnitt
    let priority_score = 0;

    if (stats.critical_incidents > 0) {
      priority_score += 10;
    }

    if (stats.total_incidents >= 5) {
      priority_score += 5;
    }

    if (stats.total_personnel > 20) {
      priority_score += 3;
    }

    // Ressourcen-Engpass prüfen (z.B. wenn viele Einsätze aber wenig Personal)
    const avg_personnel_per_incident = stats.total_personnel / stats.active_incidents;
    if (avg_personnel_per_incident < 3) {
      priority_score += 4;
    }

    return {
      ...stats,
      priority_score
    };
  });

  // Sortiere nach Priority Score
  areasWithStats.sort((a, b) => b.priority_score - a.priority_score);

  // Nehme Top N (aus Regel-Config)
  const maxAreas = rules.output.max_items || 5;
  return areasWithStats.slice(0, maxAreas);
}
```

### Output

```javascript
[
  {
    "id": "a7f8e9d0",
    "humanId": "A-1",
    "name": "Abschnitt Nord",
    "location": "Innenstadt",
    "color": "#ff5733",
    "total_incidents": 18,
    "active_incidents": 15,
    "critical_incidents": 3,
    "priority": "critical",
    "total_personnel": 45,
    "priority_score": 18,
    "column": "in-bearbeitung"
  },
  {
    "id": "b8g9h0i1",
    "humanId": "A-2",
    "name": "Abschnitt Süd",
    "location": "Stadtteil Süd",
    "color": "#33ff57",
    "total_incidents": 12,
    "active_incidents": 10,
    "critical_incidents": 1,
    "priority": "high",
    "total_personnel": 28,
    "priority_score": 13,
    "column": "in-bearbeitung"
  }
]
```

---

## Context-Fingerprint Integration

### Geografische Verteilung mit Abschnitten

```javascript
function analyzeGeographicDistribution(board) {
  const areas = getAreas(board);
  const unassigned = getUnassignedIncidents(board);

  // Wenn Abschnitte vorhanden sind
  if (areas.length > 0) {
    const areasWithIncidents = areas.filter(a => {
      const incidents = getIncidentsInArea(board, a.id);
      return incidents.length > 0;
    });

    const totalIncidents = getTotalIncidents(board);
    const incidentsInAreas = areasWithIncidents.reduce((sum, area) => {
      return sum + getIncidentsInArea(board, area.id).length;
    }, 0);

    let pattern;
    if (areasWithIncidents.length === 1 && incidentsInAreas > totalIncidents * 0.8) {
      pattern = "concentrated";  // Ein Abschnitt dominiert
    } else if (areasWithIncidents.length >= 4) {
      pattern = "distributed";   // Viele Abschnitte
    } else {
      pattern = "clustered";     // 2-3 Abschnitte
    }

    return {
      geographic_pattern: pattern,
      hotspot_count: areasWithIncidents.length,
      hotspot_locations: areasWithIncidents.map(a => a.content),
      incidents_in_hotspots: incidentsInAreas,
      incidents_scattered: unassigned.length,
      max_distance_km: calculateMaxDistance(areas)
    };
  }

  // Fallback: Wenn keine Abschnitte, verwende GPS-basiertes Clustering
  return analyzeGeographicDistributionByGPS(board);
}
```

---

## Validierung

### Beim Speichern

```javascript
// Aus server.js, Zeile 1268-1274
if (!("isArea" in card)) card.isArea = false;
if (!("areaCardId" in card)) card.areaCardId = null;
if (!("areaColor" in card)) card.areaColor = null;

if (card.isArea) {
  card.areaCardId = null;  // Abschnitte haben keinen Parent
  card.areaColor = normalizeAreaColor(card.areaColor || DEFAULT_AREA_COLOR, DEFAULT_AREA_COLOR);
}
```

### Human-ID Präfixe

```javascript
const HUMAN_ID_PREFIX_AREA = "A";     // Abschnitte: A-1, A-2, ...
const HUMAN_ID_PREFIX_MANUAL = "M";   // Manuelle Einsätze: M-1, M-2, ...
const HUMAN_ID_PREFIX_IMPORT = "I";   // Importierte Einsätze: I-1, I-2, ...
```

---

## Notizen

1. **Abschnitte sind optional** - Einsatzstellen können mit oder ohne Abschnitt existieren
2. **Dynamische Zuordnung** - Einsatzstellen können jederzeit Abschnitten zugeordnet werden
3. **Farb-Vererbung** - Einsatzstellen übernehmen automatisch die Farbe ihres Abschnitts
4. **Kaskadierende Updates** - Wenn Abschnitts-Farbe ändert, ändern sich alle zugeordneten Einsatzstellen
5. **Keine Hierarchie** - Abschnitte können nicht verschachtelt werden (kein Abschnitt in Abschnitt)

---

**Status:** Datenstruktur dokumentiert, bereit für Regel-Implementierung
