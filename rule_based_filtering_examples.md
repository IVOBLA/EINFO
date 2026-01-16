# Regelbasiertes Filtern - Konkrete Implementierung

## Konzept

Statt alle Daten ungefiltert an die LLM zu senden, werden **vor dem LLM-Call** intelligente Filter und Aggregationen angewendet. Keine KI, nur Logik!

---

## Beispiel 1: Einsatzstellen filtern

### AKTUELL (disaster_context.js:544)
```javascript
// Nimmt Top 10 nach Priorität
.sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99))
.slice(0, 10);
```

✅ **Bereits gut!** Aber kann verbessert werden:

### VERBESSERT - Intelligente Priorisierung
```javascript
function filterCriticalIncidents(activeIncidents, maxCount = 10) {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  // REGEL 1: Alle critical/high Priority IMMER zeigen
  const highPriority = activeIncidents.filter(i =>
    i.priority === 'critical' || i.priority === 'high'
  );

  // REGEL 2: Von medium/low nur die neuesten/aktivsten
  const remaining = activeIncidents.filter(i =>
    i.priority !== 'critical' && i.priority !== 'high'
  );

  // REGEL 3: Bevorzuge Einsätze mit vielen Kräften (größerer Impact)
  const sorted = remaining.sort((a, b) => {
    // Sortiere nach: 1) Priorität, 2) Anzahl alarmierter Einheiten, 3) Zeit
    const priorityDiff = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;

    const unitsA = (a.alerted || '').split(',').length;
    const unitsB = (b.alerted || '').split(',').length;
    return unitsB - unitsA; // Mehr Einheiten = wichtiger
  });

  // Kombiniere: Alle high-prio + gefüllte slots mit medium/low
  const fillSlots = Math.max(0, maxCount - highPriority.length);
  return [...highPriority, ...sorted.slice(0, fillSlots)];
}
```

**Vorteil:**
- Critical/High werden NIEMALS ausgefiltert (auch wenn > 10)
- Medium/Low werden intelligent nach Ressourcen-Impact sortiert
- Deterministisch & nachvollziehbar

---

## Beispiel 2: Protokoll filtern (GROSSE Verbesserung!)

### AKTUELL (disaster_context.js:621)
```javascript
const recentEntries = sorted.slice(0, 10); // Einfach neueste 10
```

❌ **Problem:** Die neuesten 10 sind oft belanglos!

### VERBESSERT - Content-basiertes Filtern
```javascript
function filterRelevantProtocolEntries(protokoll, maxCount = 10) {
  // REGEL 1: Kategorisiere jeden Eintrag
  const categorized = protokoll.map(entry => {
    const info = String(entry.information || '').toLowerCase();
    const sender = String(entry.anvon || '').toLowerCase();

    let relevance = 0;
    let category = 'routine';

    // HOCHRELEVANT (immer zeigen)
    if (info.includes('?')) {
      relevance += 10;
      category = 'open_question';
    }
    if (info.includes('evakuierung') || info.includes('evakuieren')) {
      relevance += 10;
      category = 'safety_critical';
    }
    if (info.includes('dringend') || info.includes('sofort') || info.includes('kritisch')) {
      relevance += 8;
      category = 'urgent';
    }

    // RELEVANT
    if (info.includes('anfrage') || info.includes('benötige') || info.includes('brauche')) {
      relevance += 5;
      category = 'resource_request';
    }
    if (sender.includes('s1') || sender.includes('s2') || sender.includes('ltstb')) {
      relevance += 3; // Stabs-Kommunikation wichtiger
    }

    // WENIG RELEVANT
    if (info.includes('information') || info.includes('zur kenntnis')) {
      relevance -= 2;
      category = 'info_only';
    }

    return { ...entry, relevance, category };
  });

  // REGEL 2: Sortiere nach Relevanz, dann Zeit
  const sorted = categorized.sort((a, b) => {
    if (a.relevance !== b.relevance) {
      return b.relevance - a.relevance; // Höchste Relevanz zuerst
    }
    // Bei gleicher Relevanz: Neuere zuerst
    return (b._timestamp ?? 0) - (a._timestamp ?? 0);
  });

  // REGEL 3: Garantiere Diversität (nicht nur Fragen!)
  const result = [];
  const byCat = {};

  for (const entry of sorted) {
    if (result.length >= maxCount) break;

    // Max 3 pro Kategorie, um Diversität zu garantieren
    byCat[entry.category] = (byCat[entry.category] || 0) + 1;
    if (byCat[entry.category] <= 3) {
      result.push(entry);
    }
  }

  return result;
}
```

**Vorteil:**
- Offene Fragen werden IMMER priorisiert
- Safety-critical Events (Evakuierung) nie verloren
- Routine-Dokumentation wird automatisch ausgefiltert
- Diversität verhindert "nur Fragen" oder "nur Info"

---

## Beispiel 3: Aufgaben aggregieren (NEU!)

### AKTUELL (disaster_context.js:578-592)
```javascript
// Zeigt pro Rolle die ersten 3 Aufgaben im Detail
for (const [role, tasks] of Object.entries(byRole)) {
  summary += `\n**${role}** (${tasks.length} Aufgaben):\n`;
  const topTasks = tasks.slice(0, 3);
  for (const task of topTasks) {
    const title = task.title || task.desc || task.description || "Unbenannte Aufgabe";
    summary += `  - ${title.substring(0, 50)}${statusLabel}${dueInfo}\n`;
  }
}
```

❌ **Problem:** Bei 50 offenen Aufgaben = 50+ Zeilen Text!

### VERBESSERT - Aggregation + Detail bei Kritischem
```javascript
function buildOptimizedTasksSummary(aufgaben) {
  const openTasks = aufgaben.filter(task => {
    const status = String(task?.status || "").toLowerCase();
    return status !== "erledigt" && status !== "done";
  });

  if (openTasks.length === 0) {
    return "### OFFENE AUFGABEN ###\nKeine.\n\n";
  }

  // REGEL 1: Gruppiere nach Rolle
  const byRole = {};
  openTasks.forEach(task => {
    const role = task._role || task.responsible || "Unbekannt";
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(task);
  });

  // REGEL 2: Nur AGGREGAT + kritische Details
  let summary = `### OFFENE AUFGABEN (${openTasks.length} gesamt) ###\n`;

  for (const [role, tasks] of Object.entries(byRole)) {
    // AGGREGAT (immer zeigen)
    summary += `\n**${role}**: ${tasks.length} offene Aufgaben`;

    // REGEL 3: Details nur bei überlasteten Rollen (> 5 Aufgaben)
    if (tasks.length > 5) {
      summary += ` ⚠️ ÜBERLASTET`;
    }

    // REGEL 4: Zeige nur überfällige oder dringende Aufgaben
    const critical = tasks.filter(t => {
      const isOverdue = t.dueAt && new Date(t.dueAt) < Date.now();
      const isUrgent = String(t.title || '').toLowerCase().includes('dringend');
      return isOverdue || isUrgent;
    });

    if (critical.length > 0) {
      summary += `\n  Kritisch (${critical.length}):`;
      for (const task of critical.slice(0, 2)) { // Max 2 pro Rolle!
        const title = (task.title || "Unbenannt").substring(0, 40);
        summary += `\n    - ${title}`;
      }
    }
    summary += `\n`;
  }

  return summary;
}
```

**Vorteil:**
- Von 50 Zeilen → ~10 Zeilen (80% Reduktion!)
- LLM sieht trotzdem: "S3 hat 8 Aufgaben ⚠️ ÜBERLASTET"
- Kritische Details (überfällig) gehen nicht verloren
- LLM kann sinnvolle Vorschläge machen: "S3 entlasten, Aufgaben delegieren"

---

## Beispiel 4: Ressourcen-Status berechnen (FEHLT AKTUELL!)

### NEU - Aggregierte Ressourcen-Übersicht
```javascript
function calculateResourceStatus(board) {
  const activeIncidents = board.filter(item => {
    const status = String(item?.column || item?.status || "").toLowerCase();
    return status !== "erledigt" && status !== "done";
  });

  // REGEL 1: Zähle alarmierte Einheiten
  let totalUnitsDeployed = 0;
  const unitsByType = {};

  for (const incident of activeIncidents) {
    if (incident.alerted) {
      const units = incident.alerted.split(',').map(u => u.trim());
      totalUnitsDeployed += units.length;

      units.forEach(unit => {
        // Erkenne Einheitstyp (FF, RK, POL, etc.)
        const type = detectUnitType(unit); // z.B. "FF Himmelberg" -> "FF"
        unitsByType[type] = (unitsByType[type] || 0) + 1;
      });
    }
  }

  // REGEL 2: Schätze verfügbare Kapazität (basierend auf Typ)
  // Beispiel: FF hat typisch 3-5 Fahrzeuge, wenn 3 alarmiert -> Auslastung hoch
  const capacityWarnings = [];
  if (unitsByType['FF'] > 10) {
    capacityWarnings.push('Feuerwehr stark ausgelastet (>10 Einheiten)');
  }
  if (unitsByType['RK'] > 5) {
    capacityWarnings.push('Rettungsdienst ausgelastet (>5 Einheiten)');
  }

  return {
    totalIncidents: activeIncidents.length,
    totalUnitsDeployed,
    byType: unitsByType,
    warnings: capacityWarnings
  };
}
```

**Output-Beispiel:**
```
### RESSOURCEN-STATUS ###
Einsätze: 18 aktiv
Alarmierte Einheiten: 35 gesamt (FF: 22, RK: 8, POL: 5)
⚠️ Feuerwehr stark ausgelastet (>10 Einheiten)
```

**Vorteil:**
- LLM sieht sofort: "FF überlastet" → Vorschlag: "S1: Weitere FF-Einheiten nachfordern"
- Kompakt (4 Zeilen statt 35 einzelne Alarmierungen)
- Basis für intelligente S1-Vorschläge

---

## Beispiel 5: Trend-Berechnung (FEHLT AKTUELL!)

### NEU - Automatische Trend-Erkennung
```javascript
function calculateIncidentTrends(timeline, currentBoard) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // REGEL 1: Zähle neue Einsätze pro Zeitfenster
  const recentIncidents = timeline.filter(event =>
    event.timestamp > oneHourAgo &&
    event.event.includes('Neuer Einsatz')
  );

  const incidentsPerHour = recentIncidents.length;

  // REGEL 2: Bestimme Trend
  let trend = 'stable';
  if (incidentsPerHour > 10) {
    trend = 'rapidly_escalating'; // > 10 neue Einsätze/h
  } else if (incidentsPerHour > 5) {
    trend = 'escalating'; // 5-10 neue/h
  } else if (incidentsPerHour < 2) {
    trend = 'resolving'; // < 2 neue/h
  }

  // REGEL 3: Prüfe Abschlussrate
  const resolvedRecently = timeline.filter(event =>
    event.timestamp > oneHourAgo &&
    event.event.includes('erledigt')
  ).length;

  const netChange = incidentsPerHour - resolvedRecently;

  return {
    trend,
    incidentsPerHour,
    resolvedPerHour: resolvedRecently,
    netChange, // Positiv = Eskalation, Negativ = Entspannung
    interpretation: interpretTrend(trend, netChange)
  };
}

function interpretTrend(trend, netChange) {
  if (trend === 'rapidly_escalating') {
    return `⚠️ KRITISCH: ${netChange > 0 ? '+' : ''}${netChange} Einsätze/h - Lage eskaliert`;
  }
  if (trend === 'escalating') {
    return `Lage verschärft sich (+${netChange} Einsätze/h)`;
  }
  if (trend === 'resolving') {
    return `✓ Lage entspannt sich (${resolvedRecently} erledigt/h)`;
  }
  return 'Lage stabil';
}
```

**Output-Beispiel:**
```
### LAGE-ENTWICKLUNG ###
Trend: eskalierend
Neue Einsätze: 7/Stunde | Erledigt: 3/Stunde
⚠️ Netto: +4 Einsätze/h - Lage verschärft sich

→ LLM Interpretation: "Personal-Nachschub JETZT organisieren, Lage eskaliert"
```

**Vorteil:**
- LLM muss nicht raten, ob Lage besser/schlechter wird
- Basis für proaktive Vorschläge (S1: Ablösung vorbereiten, S4: Nachschub)
- Nur 3 Zeilen statt "Timeline mit 50 Events"

---

## Vergleich: Vorher vs. Nachher

### VORHER (aktuell)
```
### AKTIVE EINSÄTZE (28 gesamt) ###
- [HIGH] Kellerüberflutung @ Hauptstr. 5: Wasser steigt, Pumpen... [Alarmiert: FF Himmelberg, FF...]
- [MEDIUM] Baum auf Straße @ Landstraße 12: ... [Alarmiert: FF ...]
... (8 weitere)

### OFFENE AUFGABEN (47 gesamt) ###
**S1** (8 Aufgaben):
  - Ablösung für Einsatz Hauptstr. 5 organisieren [offen]
  - Verpflegung für 45 Kräfte bestellen [in Arbeit]
  - Bereitstellung weiterer FF prüfen [offen]
**S3** (12 Aufgaben):
  - ... (und 9 weitere)

### PROTOKOLL (125 Einträge) ###
- [14:23] S1 → S4: Brauchen wir mehr Sandsäcke?
- [14:20] LTSTB → Alle: Information zur aktuellen Lage
... (8 weitere)

→ Gesamt: ~1200 Tokens
```

### NACHHER (mit Regelfilterung)
```
### LAGE-ÜBERSICHT ###
Phase: peak (Minute 240)
Trend: ⚠️ KRITISCH: +4 Einsätze/h - Lage eskaliert

### KRITISCHE EINSÄTZE (10 von 28 gezeigt) ###
- [HIGH] Kellerüberflutung @ Hauptstr. 5 (6 Einheiten, seit 90min)
- [HIGH] Hangrutschung @ Bergstraße 23 (4 Einheiten, seit 45min)
- [MEDIUM] Baum auf Straße @ L12 (2 Einheiten, seit 20min)
... (7 weitere)

### RESSOURCEN ###
35 Einheiten alarmiert (FF: 22, RK: 8, POL: 5)
⚠️ Feuerwehr stark ausgelastet

### AUFGABEN-ÜBERSICHT ###
S1: 8 Aufgaben (2 überfällig!)
S3: 12 Aufgaben ⚠️ ÜBERLASTET
S4: 5 Aufgaben
... (andere <5)

### OFFENE FRAGEN (3 kritisch) ###
- [14:23] S1 → S4: Brauchen wir mehr Sandsäcke? (15min alt)
- [14:15] S3 → S1: Ablösung für Hauptstr. 5? (23min alt)
- [14:10] S2 → LTSTB: Evakuierung Glanhofen prüfen? (30min alt)

→ Gesamt: ~500 Tokens (60% Reduktion!)
```

---

## Implementierung: Wo ändern?

### Schritt 1: Neue Filter-Funktionen in `disaster_context.js`
```javascript
// Ersetze/erweitere bestehende Funktionen:
- buildCurrentIncidentsSummary() → buildOptimizedIncidentsSummary()
- buildCurrentTasksSummary() → buildOptimizedTasksSummary()
- buildCurrentProtocolSummary() → buildOptimizedProtocolSummary()

// NEU hinzufügen:
- calculateResourceStatus()
- calculateIncidentTrends()
```

### Schritt 2: Nutze in `getDisasterContextSummary()`
```javascript
export async function getDisasterContextSummary({ maxLength = 1500 } = {}) {
  const einfoData = await loadCurrentEinfoData();

  // NEU: Berechnete Insights
  const resourceStatus = calculateResourceStatus(einfoData.board);
  const trends = calculateIncidentTrends(currentDisasterContext.timeline, einfoData.board);

  let summary = `### LAGE-ÜBERSICHT ###\n`;
  summary += `Phase: ${currentDisasterContext.currentPhase}\n`;
  summary += `Trend: ${trends.interpretation}\n\n`;

  summary += `### RESSOURCEN ###\n`;
  summary += `${resourceStatus.totalUnitsDeployed} Einheiten alarmiert\n`;
  // ...

  // Rest wie bisher, aber mit optimierten Funktionen
}
```

---

## Vorteile zusammengefasst

✅ **50-60% Token-Reduktion** (1200 → 500 Tokens)
✅ **Bessere Informationsdichte** (mehr Signal, weniger Rauschen)
✅ **Keine Informationsverluste** (kritische Details bleiben)
✅ **Deterministisch** (keine LLM-Halluzinationen)
✅ **Nachvollziehbar** (Regeln können angepasst werden)
✅ **Performant** (nur JS-Operationen, kein extra API-Call)
✅ **Strukturierte Insights** (Trends, Ressourcen-Status)

## Nächste Schritte

1. Implementiere neue Filter-Funktionen in `disaster_context.js`
2. Teste mit realen Szenarien (kleine vs. große Lagen)
3. Vergleiche LLM-Output-Qualität (vorher/nachher)
4. Iteriere auf Basis der Ergebnisse
