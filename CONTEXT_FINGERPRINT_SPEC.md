# Context-Fingerprint Spezifikation
**Version:** 1.0
**Datum:** 2026-01-18

---

## Zweck

Der Context-Fingerprint ist eine **strukturierte Zusammenfassung** der aktuellen Lage, extrahiert aus den gefilterten Regeln. Er dient:

1. **Matching gelernter Vorschläge** - Findet ähnliche vergangene Situationen
2. **Feedback-Speicherung** - Kontext wird mit Feedback verknüpft
3. **Disaster-spezifisches Lernen** - Hochwasser ≠ Sturm
4. **Nachvollziehbarkeit** - Strukturiert statt Black-Box

---

## Vollständige Struktur

```json
{
  "version": "1.0",
  "timestamp": 1737201600000,

  // ============================================
  // BASIS-INFORMATIONEN
  // ============================================
  "disaster_type": "hochwasser",
  "phase": "escalation",
  "hours_running": 3.5,

  // ============================================
  // ABSCHNITTE (aus Regel R1)
  // ============================================
  "total_sections": 4,
  "critical_sections": 2,
  "critical_section_names": ["Nord", "Innenstadt"],

  // ============================================
  // EINSATZSTELLEN (aus Regel R1 + R3)
  // ============================================
  "total_incidents": 45,
  "active_incidents": 42,
  "critical_incidents": 8,
  "new_incidents_last_hour": 8,
  "closed_incidents_last_hour": 1,

  // ============================================
  // GEOGRAFISCHE VERTEILUNG (aus Regel R1)
  // ============================================
  "geographic_pattern": "concentrated",
  "hotspot_count": 2,
  "hotspot_locations": ["Innenstadt", "Nord"],
  "incidents_in_hotspots": 35,
  "incidents_scattered": 10,
  "max_distance_km": 12,

  // ============================================
  // TRENDS (aus Regel R3)
  // ============================================
  "trend_direction": "escalating",
  "trend_strength": "strong",
  "forecast_2h_incidents": 16,
  "forecast_4h_incidents": 28,

  // ============================================
  // RESSOURCEN (aus Regel R4)
  // ============================================
  "total_units": 45,
  "available_units": 7,
  "deployed_units": 38,
  "utilization_percent": 84,
  "resource_shortage": true,

  "total_personnel": 120,
  "deployed_personnel": 95,
  "available_personnel": 25,
  "avg_deployment_hours": 3.5,

  // ============================================
  // EINSATZ-DAUER (aus Regel R3)
  // ============================================
  "avg_incident_duration_minutes": 145,
  "longest_active_minutes": 380,
  "incidents_over_4h": 5,

  // ============================================
  // PROTOKOLL (aus Regel R2)
  // ============================================
  "dominant_protocol_types": ["Offene Fragen", "Ressourcen-Anfrage", "Sicherheit"],
  "open_questions_count": 5,
  "resource_requests_count": 3,
  "safety_critical_count": 2,
  "protocol_entries_total": 85,
  "protocol_entries_last_hour": 18,

  // ============================================
  // VERÄNDERUNGEN (Delta seit letzter Analyse)
  // ============================================
  "incidents_added_since_last": 3,
  "incidents_closed_since_last": 1,
  "utilization_change_percent": +5,
  "protocol_entries_since_last": 8,
  "personnel_change": +10,

  // ============================================
  // KRITISCHE INDIKATOREN
  // ============================================
  "external_deadlines": true,
  "media_interest": true,
  "infrastructure_threatened": false,
  "communication_problems": false,
  "requires_escalation": false
}
```

---

## Feld-Beschreibungen

### Basis-Informationen

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `disaster_type` | string | Art des Ereignisses (hochwasser, sturm, etc.) | `disaster_context.js` |
| `phase` | string | Aktuelle Phase (initial, escalation, peak, resolution, completed) | `disaster_context.js` |
| `hours_running` | number | Stunden seit Ereignis-Beginn | Berechnet |

### Abschnitte

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `total_sections` | number | Anzahl aller Abschnitte | Regel R1 |
| `critical_sections` | number | Anzahl kritischer Abschnitte | Regel R1 |
| `critical_section_names` | string[] | Namen der kritischen Abschnitte | Regel R1 |

### Einsatzstellen

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `total_incidents` | number | Anzahl aller Einsatzstellen | Regel R1 |
| `active_incidents` | number | Aktive Einsatzstellen (nicht abgeschlossen) | Regel R1 |
| `critical_incidents` | number | Kritische Priorität | Regel R1 |
| `new_incidents_last_hour` | number | Neue Einsatzstellen (letzte 60min) | Regel R3 |
| `closed_incidents_last_hour` | number | Abgeschlossene (letzte 60min) | Regel R3 |

### Geografische Verteilung

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `geographic_pattern` | string | concentrated / clustered / distributed | Regel R1 (berechnet) |
| `hotspot_count` | number | Anzahl geografischer Cluster | Regel R1 (berechnet) |
| `hotspot_locations` | string[] | Namen der Hotspots (z.B. Stadtteile) | Regel R1 |
| `incidents_in_hotspots` | number | Einsatzstellen in Hotspots | Regel R1 |
| `incidents_scattered` | number | Verstreute Einsatzstellen | Regel R1 |
| `max_distance_km` | number | Maximale Ausdehnung des Ereignisses | Regel R1 (berechnet) |

**Berechnung:**
- `concentrated`: >80% der Einsatzstellen in einem Cluster (Radius 2km)
- `clustered`: 2-3 Cluster
- `distributed`: >3 Cluster

### Trends

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `trend_direction` | string | escalating / stable / de-escalating | Regel R3 |
| `trend_strength` | string | weak / moderate / strong | Regel R3 |
| `forecast_2h_incidents` | number | Hochrechnung für nächste 2h | Regel R3 |
| `forecast_4h_incidents` | number | Hochrechnung für nächste 4h | Regel R3 |

**Berechnung:**
- `escalating`: Neue Einsatzstellen > Geschlossene
- `stable`: Neue ≈ Geschlossene
- `de-escalating`: Geschlossene > Neue

### Ressourcen

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `total_units` | number | Anzahl aller Einheiten | Regel R4 |
| `available_units` | number | Verfügbare Einheiten | Regel R4 |
| `deployed_units` | number | Im Einsatz befindliche Einheiten | Regel R4 |
| `utilization_percent` | number | Auslastung in % | Regel R4 |
| `resource_shortage` | boolean | true wenn >80% Auslastung | Regel R4 |
| `total_personnel` | number | Anzahl Einsatzkräfte gesamt | Regel R4 |
| `deployed_personnel` | number | Im Einsatz | Regel R4 |
| `available_personnel` | number | Verfügbar | Regel R4 |
| `avg_deployment_hours` | number | Durchschnittliche Einsatzzeit | Regel R4 |

**Schwellenwerte:**
- <70%: OK (grün)
- 70-80%: Warnung (gelb)
- 80-90%: Kritisch (orange)
- >90%: Akut (rot)

### Einsatz-Dauer

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `avg_incident_duration_minutes` | number | Durchschnittliche Dauer aller aktiven Einsätze | Regel R3 |
| `longest_active_minutes` | number | Längster laufender Einsatz | Regel R3 |
| `incidents_over_4h` | number | Anzahl Einsätze >4 Stunden | Regel R3 |

### Protokoll

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `dominant_protocol_types` | string[] | Top 3 Protokoll-Typen (nach Häufigkeit) | Regel R2 |
| `open_questions_count` | number | Anzahl offener Fragen | Regel R2 |
| `resource_requests_count` | number | Anzahl Ressourcen-Anfragen | Regel R2 |
| `safety_critical_count` | number | Anzahl sicherheitskritischer Einträge | Regel R2 |
| `protocol_entries_total` | number | Anzahl aller Einträge | Regel R2 |
| `protocol_entries_last_hour` | number | Einträge der letzten Stunde | Regel R2 |

**Protokoll-Typen:**
- "Offene Fragen"
- "Ressourcen-Anfrage"
- "Sicherheit"
- "Statusmeldung"
- "Entscheidung"
- "Externe Anfrage"

### Veränderungen

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `incidents_added_since_last` | number | Neue Einsatzstellen seit letzter Analyse | Diff |
| `incidents_closed_since_last` | number | Abgeschlossene seit letzter Analyse | Diff |
| `utilization_change_percent` | number | Änderung der Auslastung (kann negativ sein) | Diff |
| `protocol_entries_since_last` | number | Neue Protokoll-Einträge | Diff |
| `personnel_change` | number | Änderung Anzahl Einsatzkräfte | Diff |

### Kritische Indikatoren

| Feld | Typ | Beschreibung | Quelle |
|------|-----|--------------|--------|
| `external_deadlines` | boolean | Externe Deadlines vorhanden (Lagebericht, etc.) | Regel R2 |
| `media_interest` | boolean | Medien-Interesse vorhanden | Regel R2 |
| `infrastructure_threatened` | boolean | Kritische Infrastruktur bedroht | Regel R2 |
| `communication_problems` | boolean | Kommunikationsprobleme gemeldet | Regel R2 |
| `requires_escalation` | boolean | Eskalation an übergeordnete Stelle nötig | Berechnet |

---

## Matching-Algorithmus

### Gewichtung der Faktoren

```javascript
function matchFingerprints(current, learned) {
  let score = 0;

  // 1. DISASTER-TYPE (wichtigster Faktor)
  if (current.disaster_type === learned.disaster_type) {
    score += 20;
  }

  // 2. PHASE
  if (current.phase === learned.phase) {
    score += 10;
  }

  // 3. GEOGRAFISCHES MUSTER (NEU!)
  if (current.geographic_pattern === learned.geographic_pattern) {
    score += 8;
  }

  // 4. TREND-RICHTUNG
  if (current.trend_direction === learned.trend_direction) {
    score += 7;
  }

  // 5. RESSOURCEN-ENGPASS
  if (current.resource_shortage === learned.resource_shortage) {
    score += 6;
  }

  // 6. GRÖSSENORDNUNGen (ähnliche Anzahl Einsatzstellen)
  const incidentDiff = Math.abs(current.total_incidents - learned.total_incidents);
  if (incidentDiff < 10) score += 5;
  else if (incidentDiff < 20) score += 3;
  else if (incidentDiff < 30) score += 1;

  // 7. PROTOKOLL-TYPEN (Overlap)
  const typeOverlap = current.dominant_protocol_types.filter(t =>
    learned.dominant_protocol_types.includes(t)
  ).length;
  score += typeOverlap * 3;

  // 8. AUSLASTUNG (ähnliche Prozentzahl)
  const utilizationDiff = Math.abs(current.utilization_percent - learned.utilization_percent);
  if (utilizationDiff < 10) score += 4;
  else if (utilizationDiff < 20) score += 2;

  // 9. TREND-STÄRKE
  if (current.trend_strength === learned.trend_strength) {
    score += 3;
  }

  // 10. KRITISCHE INDIKATOREN (Bonus für Übereinstimmungen)
  if (current.external_deadlines === learned.external_deadlines) score += 2;
  if (current.media_interest === learned.media_interest) score += 2;
  if (current.infrastructure_threatened === learned.infrastructure_threatened) score += 2;

  return score;
}
```

### Schwellenwerte

- **Score < 15**: Nicht relevant (wird nicht verwendet)
- **Score 15-30**: Möglicherweise relevant
- **Score 31-50**: Relevant
- **Score > 50**: Sehr relevant

### Top-3-Auswahl

```javascript
function getLearnedSuggestionsForContext(role, fingerprint) {
  const roleSpecific = learnedSuggestions.filter(s => s.targetRole === role);

  const scored = roleSpecific.map(s => ({
    ...s,
    relevance_score: matchFingerprints(fingerprint, s.context_fingerprint)
  }))
  .filter(s => s.relevance_score >= 15)  // Min-Schwelle
  .sort((a, b) => b.relevance_score - a.relevance_score)
  .slice(0, 3);  // Top 3

  return scored;
}
```

---

## Extraktion aus Regeln

### Workflow

```javascript
async function extractContextFingerprint(filteredData, rawData, previousFingerprint) {
  const fingerprint = {
    version: "1.0",
    timestamp: Date.now(),

    // BASIS
    disaster_type: rawData.disaster?.type,
    phase: rawData.disaster?.phase,
    hours_running: calculateHoursRunning(rawData.disaster?.start_time),

    // ABSCHNITTE (aus Regel R1)
    total_sections: filteredData.abschnitte.length,
    critical_sections: filteredData.abschnitte.filter(a => a.priority === "critical").length,
    critical_section_names: filteredData.abschnitte
      .filter(a => a.priority === "critical")
      .map(a => a.name),

    // EINSATZSTELLEN (aus Regel R1 + R3)
    total_incidents: rawData.incidents.length,
    active_incidents: rawData.incidents.filter(i => i.status !== "closed").length,
    critical_incidents: rawData.incidents.filter(i => i.priority === "critical").length,
    new_incidents_last_hour: filteredData.trends.new_last_hour,
    closed_incidents_last_hour: filteredData.trends.closed_last_hour,

    // GEOGRAFISCH (aus Regel R1 - NEU!)
    ...analyzeGeographicDistribution(rawData.incidents),

    // TRENDS (aus Regel R3)
    trend_direction: filteredData.trends.direction,
    trend_strength: filteredData.trends.strength,
    forecast_2h_incidents: filteredData.trends.forecast_2h,
    forecast_4h_incidents: filteredData.trends.forecast_4h,

    // RESSOURCEN (aus Regel R4)
    total_units: filteredData.resources.total,
    available_units: filteredData.resources.available,
    deployed_units: filteredData.resources.deployed,
    utilization_percent: filteredData.resources.utilization,
    resource_shortage: filteredData.resources.utilization > 80,

    total_personnel: filteredData.resources.personnel_total,
    deployed_personnel: filteredData.resources.personnel_deployed,
    available_personnel: filteredData.resources.personnel_available,
    avg_deployment_hours: filteredData.resources.avg_deployment_hours,

    // DAUER (aus Regel R3)
    avg_incident_duration_minutes: filteredData.trends.avg_duration,
    longest_active_minutes: filteredData.trends.longest_active,
    incidents_over_4h: rawData.incidents.filter(i => i.duration_minutes > 240).length,

    // PROTOKOLL (aus Regel R2)
    dominant_protocol_types: getTopProtocolTypes(filteredData.protocol, 3),
    open_questions_count: filteredData.protocol.filter(p => p.type === "Offene Fragen").length,
    resource_requests_count: filteredData.protocol.filter(p => p.type === "Ressourcen-Anfrage").length,
    safety_critical_count: filteredData.protocol.filter(p => p.type === "Sicherheit").length,
    protocol_entries_total: rawData.protocol.length,
    protocol_entries_last_hour: filteredData.protocol.filter(p => isLastHour(p.timestamp)).length,

    // VERÄNDERUNGEN (Delta)
    ...calculateDelta(rawData, previousFingerprint),

    // KRITISCHE INDIKATOREN
    external_deadlines: hasExternalDeadlines(filteredData.protocol),
    media_interest: hasMediaInterest(filteredData.protocol),
    infrastructure_threatened: hasInfrastructureThreat(filteredData.protocol),
    communication_problems: hasCommunicationProblems(filteredData.protocol),
    requires_escalation: shouldEscalate(filteredData)
  };

  return fingerprint;
}
```

### Hilfsfunktionen

```javascript
function analyzeGeographicDistribution(incidents) {
  // Einfaches Clustering basierend auf Distanz
  const clusters = [];
  const maxDistance = 2; // 2km Radius

  for (const incident of incidents) {
    let foundCluster = false;
    for (const cluster of clusters) {
      const distance = calculateDistance(incident, cluster.center);
      if (distance < maxDistance) {
        cluster.incidents.push(incident);
        foundCluster = true;
        break;
      }
    }
    if (!foundCluster) {
      clusters.push({
        center: incident,
        incidents: [incident]
      });
    }
  }

  const largestCluster = clusters.reduce((max, c) =>
    c.incidents.length > max.incidents.length ? c : max, clusters[0]);

  let pattern;
  if (clusters.length === 1 || largestCluster.incidents.length > incidents.length * 0.8) {
    pattern = "concentrated";
  } else if (clusters.length >= 4) {
    pattern = "distributed";
  } else {
    pattern = "clustered";
  }

  // Hotspots = Cluster mit >5 Einsatzstellen
  const hotspots = clusters.filter(c => c.incidents.length >= 5);

  return {
    geographic_pattern: pattern,
    hotspot_count: hotspots.length,
    hotspot_locations: hotspots.map(h => h.center.location_name),
    incidents_in_hotspots: hotspots.reduce((sum, h) => sum + h.incidents.length, 0),
    incidents_scattered: incidents.length - hotspots.reduce((sum, h) => sum + h.incidents.length, 0),
    max_distance_km: calculateMaxDistance(incidents)
  };
}

function getTopProtocolTypes(protocol, topN = 3) {
  const typeCounts = {};
  for (const entry of protocol) {
    typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
  }

  return Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([type]) => type);
}

function calculateDelta(rawData, previousFingerprint) {
  if (!previousFingerprint) {
    return {
      incidents_added_since_last: 0,
      incidents_closed_since_last: 0,
      utilization_change_percent: 0,
      protocol_entries_since_last: 0,
      personnel_change: 0
    };
  }

  return {
    incidents_added_since_last: rawData.incidents.length - previousFingerprint.total_incidents,
    incidents_closed_since_last: previousFingerprint.active_incidents -
      rawData.incidents.filter(i => i.status !== "closed").length,
    utilization_change_percent:
      calculateUtilization(rawData.resources) - previousFingerprint.utilization_percent,
    protocol_entries_since_last:
      rawData.protocol.length - previousFingerprint.protocol_entries_total,
    personnel_change:
      rawData.resources.personnel_total - previousFingerprint.total_personnel
  };
}
```

---

## Beispiel

### Szenario: Hochwasser in Eskalations-Phase

```json
{
  "version": "1.0",
  "timestamp": 1737201600000,

  "disaster_type": "hochwasser",
  "phase": "escalation",
  "hours_running": 3.5,

  "total_sections": 4,
  "critical_sections": 2,
  "critical_section_names": ["Nord", "Innenstadt"],

  "total_incidents": 45,
  "active_incidents": 42,
  "critical_incidents": 8,
  "new_incidents_last_hour": 8,
  "closed_incidents_last_hour": 1,

  "geographic_pattern": "concentrated",
  "hotspot_count": 2,
  "hotspot_locations": ["Innenstadt", "Nord"],
  "incidents_in_hotspots": 35,
  "incidents_scattered": 10,
  "max_distance_km": 12,

  "trend_direction": "escalating",
  "trend_strength": "strong",
  "forecast_2h_incidents": 16,
  "forecast_4h_incidents": 28,

  "total_units": 45,
  "available_units": 7,
  "deployed_units": 38,
  "utilization_percent": 84,
  "resource_shortage": true,

  "total_personnel": 120,
  "deployed_personnel": 95,
  "available_personnel": 25,
  "avg_deployment_hours": 3.5,

  "avg_incident_duration_minutes": 145,
  "longest_active_minutes": 380,
  "incidents_over_4h": 5,

  "dominant_protocol_types": ["Offene Fragen", "Ressourcen-Anfrage", "Sicherheit"],
  "open_questions_count": 5,
  "resource_requests_count": 3,
  "safety_critical_count": 2,
  "protocol_entries_total": 85,
  "protocol_entries_last_hour": 18,

  "incidents_added_since_last": 3,
  "incidents_closed_since_last": 1,
  "utilization_change_percent": 5,
  "protocol_entries_since_last": 8,
  "personnel_change": 10,

  "external_deadlines": true,
  "media_interest": true,
  "infrastructure_threatened": false,
  "communication_problems": false,
  "requires_escalation": false
}
```

### Matching-Score für gelernten Vorschlag

**Gelernter Vorschlag** aus vergangenem Hochwasser:

```json
{
  "disaster_type": "hochwasser",
  "phase": "escalation",
  "geographic_pattern": "concentrated",
  "trend_direction": "escalating",
  "resource_shortage": true,
  "total_incidents": 38,
  "dominant_protocol_types": ["Offene Fragen", "Ressourcen-Anfrage"],
  "utilization_percent": 78
}
```

**Score-Berechnung:**
- Disaster-Type Match: +20
- Phase Match: +10
- Geographic Pattern Match: +8
- Trend-Direction Match: +7
- Resource Shortage Match: +6
- Incident Count (38 vs 45 = Diff 7): +5
- Protocol Type Overlap (2 von 3): +6
- Utilization (84% vs 78% = Diff 6%): +4

**Total Score: 66** → **Sehr relevant!**

---

## Persistierung

### Beim Feedback-Speichern

```javascript
export async function saveFeedback(feedback) {
  // Erweitere Feedback mit aktuellem Fingerprint
  feedback.context_fingerprint = currentContextFingerprint;

  // Speichere in Feedback-Datei
  const feedbackFile = path.join(FEEDBACK_DIR, `feedback_${Date.now()}.json`);
  await fsPromises.writeFile(feedbackFile, JSON.stringify(feedback, null, 2));

  logInfo("Feedback gespeichert mit Context-Fingerprint", {
    fingerprint_size: JSON.stringify(currentContextFingerprint).length
  });
}
```

### Laden für Matching

```javascript
async function loadLearnedSuggestionsWithFingerprints() {
  const feedbacks = await listFeedbacks({ minRating: 4 }); // Nur positive

  return feedbacks
    .filter(f => f.context_fingerprint)  // Nur mit Fingerprint
    .map(f => ({
      ...f,
      fingerprint: f.context_fingerprint
    }));
}
```

---

## Versionierung

**Version 1.0** (Initial)
- Alle Basis-Felder definiert
- Geografische Verteilung integriert
- Matching-Algorithmus definiert

**Zukünftige Versionen:**
- 1.1: Wetter-Prognose-Integration (falls nicht über Protokoll)
- 1.2: Kommunikations-Analyse (Engpässe)
- 1.3: Weitere Disaster-Types

---

**Status:** Finale Spezifikation, bereit für Implementierung
