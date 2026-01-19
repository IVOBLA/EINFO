# Chat-Protokoll: Hybrid-Filterung Regeln + Lernen
**Datum:** 2026-01-18
**Thema:** Entwicklung eines Hybrid-Systems aus JSON-Regeln und adaptivem Lernen für LLM-Kontext-Filterung

---

## 🎯 Kontext & Anforderungen

### Einsatzstab-Kontext (vom Benutzer)
- **Einsatzstab tritt zusammen bei:** Großereignissen (großflächig mit vielen Einsatzstellen ODER einzelne Einsatzstelle mit großer Auswirkung)
- **Fokus des Stabs:** Vorausschauende Planung und Koordination (NICHT operative Details einzelner Einsatzstellen)
- **Abschnitte:** Viele aneinander liegende Einsatzstellen werden zu Abschnitten zusammengefasst
- **Software-Ziel:** KI-Analyse soll Stabsstellen unterstützen und vorausplanen

### Kritische Anforderungen
1. **Regeln ohne Programmierkenntnisse erweiterbar** → JSON/YAML-basiert
2. **Gelerntes überlebt Neustart** → Persistierung im RAG-System
3. **GUI für Regel-Erstellung** → Stabsmitglieder können selbst Regeln anpassen
4. **Vordefinierte Regeln** → Einige Basis-Regeln müssen vorab existieren

### Technische Rahmenbedingungen
- **Abschnitte werden in `board.json` abgebildet** (wie Einsätze)
- Bestehendes Feedback-System in `llm_feedback.js`
- Bestehendes RAG-System (`rag_vector.js`, `session_rag.js`)
- Kontext-Vorbereitung in `disaster_context.js`
- Situations-Analyse in `situation_analyzer.js`

---

## 💡 Lösungsansatz: Hybrid-Architektur

### Grundprinzip
```
┌──────────────────────────────────────────────────────────┐
│          REGELSCHICHT (filtering_rules.json)             │
│  Hart-codierte Grenzen, Struktur-Vorgaben                │
│  ✓ Änderbar ohne Programmierung (JSON-Edit oder GUI)     │
│  ✓ Transparent & nachvollziehbar                         │
└───────────────────┬──────────────────────────────────────┘
                    │
                    ↓
┌──────────────────────────────────────────────────────────┐
│         LERN-SCHICHT (learned_filters.json)              │
│  Adaptive Gewichtungen, optimiert durch Feedback         │
│  ✓ Persistiert (überlebt Neustart)                      │
│  ✓ Kontinuierliches Lernen über Einsätze hinweg         │
└──────────────────────────────────────────────────────────┘
```

**Regeln setzen Grenzen → Lernen optimiert innerhalb dieser Grenzen**

---

## 📋 Identifizierte Regel-Typen

### 1. R1: ABSCHNITTE_PRIORITÄT
- **Zweck:** Zeigt Abschnitte priorisiert (kritische zuerst)
- **Anwendbar auf:** `abschnitte` (aus board.json)
- **Bedingungen:**
  - `has_critical_incidents == true` → Priorität 1.0, immer zeigen
  - `incident_count >= 5` → Priorität 0.8, Trend zeigen
  - `resource_shortage == true` → Priorität 0.9, als "RESSOURCEN-ENGPASS" markieren
- **Output:** Max 5 Abschnitte, Felder: name, incident_count, critical_count, trend, resource_status

### 2. R2: PROTOKOLL_RELEVANZ
- **Zweck:** Filtert Protokoll nach Relevanz für Stab
- **Anwendbar auf:** `protocol` (aus protocol.json)
- **Scoring-Faktoren:**
  - Offene Fragen (`\?`): Gewicht 1.2, **lernbar**
  - Sicherheitskritisch (Keywords: evakuierung, gefahr, notfall, dringend): Gewicht 1.5, **NICHT lernbar**
  - Ressourcen-Anfrage (Keywords: benötigt, anforderung, fahrzeug, personal): Gewicht 0.8, **lernbar**
  - Statusmeldung (Keywords: status, meldung, bericht): Gewicht 0.5, **lernbar**
  - Abgeschlossene Aufgabe (Keywords: erledigt, fertig, abgeschlossen): Gewicht 0.3, **lernbar**
- **Output:** Max 10 Einträge, min Score 0.6

### 3. R3: TRENDS_ERKENNUNG
- **Zweck:** Berechnet Trends für vorausschauende Planung
- **Anwendbar auf:** `incidents` (aus board.json)
- **Zeitfenster:** 30, 60, 120 Minuten (konfigurierbar, lernbar)
- **Metriken:**
  - Neue Einsatzstellen (Warnung: 5, Kritisch: 10)
  - Durchschnittliche Dauer (Warnung: 120min, Kritisch: 240min)
  - Ressourcen-Auslastung in % (Warnung: 70%, Kritisch: 90%)
- **Output:** Zusammenfassungs-Text + Vorhersage für nächste 120min

### 4. R4: RESSOURCEN_STATUS
- **Zweck:** Aggregiert Ressourcen-Status über Abschnitte
- **Anwendbar auf:** `resources`
- **Aggregation:** Group by `abschnitt`
- **Metriken:**
  - Verfügbar (count_available_units)
  - Im Einsatz (count_deployed_units)
  - Auslastung in % (deployed / (deployed + available) * 100)
- **Highlight wenn:** Auslastung >= 80%

### 5. R5: STABS_FOKUS
- **Zweck:** Filtert Details für Stabsarbeit (Abschnitte statt Einzelstellen)
- **Anwendbar auf:** `all`
- **Stabs-Modus:**
  - Aggregiere zu Abschnitten: JA
  - Zeige Einzeleinsätze nur wenn:
    - Priorität == "critical"
    - has_open_questions == true
    - affects_multiple_sections == true
  - Max 3 Einzeleinsätze

---

## 🧠 Lern-Mechanismus

### Gewichts-Anpassung
```javascript
// Einfacher, transparenter Algorithmus

Bei Feedback (alle 5 Feedbacks):
  IF success_rate > 0.7 → Gewicht +0.1 bis +0.2
  IF success_rate < 0.4 → Gewicht -0.1 bis -0.2

Grenzen:
  - Min: 0.1
  - Max: 2.0
  - Max Änderung pro Schritt: 0.2
  - Nur für Faktoren mit "learnable: true"
```

### Persistierung in `learned_filters.json`
```json
{
  "learned_weights": {
    "protocol_factors": {
      "Offene Fragen": {
        "initial_weight": 1.2,
        "current_weight": 1.45,
        "adjustment_history": [
          { "timestamp": ..., "delta": 0.05, "reason": "5 helpful feedbacks" },
          { "timestamp": ..., "delta": 0.10, "reason": "10 helpful feedbacks" }
        ],
        "feedback_count": 15,
        "helpful_count": 13,
        "success_rate": 0.867
      }
    }
  },

  "disaster_type_preferences": {
    "hochwasser": {
      "preferred_protocol_types": ["Ressourcen-Anfrage", "Sicherheitskritisch"],
      "preferred_trend_window": 120
    }
  }
}
```

### Feedback-Erweiterung
```javascript
// Aktuell
saveFeedback({ helpful: true, rating: 5, ... })

// NEU: + Kontext-Metadaten
saveFeedback({
  helpful: true,
  rating: 5,

  context_metadata: {
    rules_applied: ["R1_ABSCHNITTE_PRIORITÄT", "R2_PROTOKOLL_RELEVANZ"],
    protocol_types_shown: {
      "Offene Fragen": { count: 3, weight: 1.45 },
      "Ressourcen-Anfrage": { count: 2, weight: 0.95 }
    },
    incidents_per_section: 4,
    trend_window_used: 90,
    total_tokens: 1850,
    disaster_type: "hochwasser",
    disaster_phase: "escalation"
  }
})
```

---

## 🎨 GUI-Anforderungen (Neue Erkenntnis)

### Anforderungen
1. **Regel-Editor:** Stabsmitglieder können Regeln selbst erstellen/anpassen
2. **Vordefinierte Regeln:** 5 Basis-Regeln (R1-R5) müssen vorab existieren
3. **Keine Code-Kenntnisse nötig:** Drag & Drop, Formular-basiert

### Mögliche UI-Komponenten

#### Regel-Liste (Übersicht)
```
┌─────────────────────────────────────────────────────────┐
│  ⚙️ Filter-Regeln                    [+ Neue Regel]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ☑ R1: ABSCHNITTE_PRIORITÄT          [Bearbeiten] [🗑] │
│     Zeigt Abschnitte priorisiert (kritische zuerst)    │
│     ✓ Aktiv | Lernbar: Nein | Max Items: 5            │
│                                                         │
│  ☑ R2: PROTOKOLL_RELEVANZ            [Bearbeiten] [🗑] │
│     Filtert Protokoll nach Relevanz für Stab           │
│     ✓ Aktiv | Lernbar: Ja | Max Items: 10             │
│     📊 Gewicht "Offene Fragen": 1.2 → 1.45 (gelernt)   │
│                                                         │
│  ☑ R3: TRENDS_ERKENNUNG              [Bearbeiten] [🗑] │
│     Berechnet Trends für vorausschauende Planung       │
│     ✓ Aktiv | Zeitfenster: 60min → 90min (gelernt)    │
│                                                         │
│  ☐ R4: RESSOURCEN_STATUS             [Bearbeiten] [🗑] │
│     Aggregiert Ressourcen-Status über Abschnitte       │
│     ✗ Deaktiviert                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Regel-Editor (Detail)
```
┌─────────────────────────────────────────────────────────┐
│  📝 Regel bearbeiten: R2_PROTOKOLL_RELEVANZ             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Regel-ID: [R2_PROTOKOLL_RELEVANZ________]             │
│  Name: [Protokoll-Relevanz_____________]               │
│  Beschreibung:                                         │
│  [Filtert Protokoll nach Relevanz für Stab______]     │
│                                                         │
│  Anwendbar auf: [Protocol ▼]                           │
│                                                         │
│  ☑ Regel aktiv                                         │
│                                                         │
│  ──────────────────────────────────────────────────    │
│  📊 Scoring-Faktoren:                                  │
│                                                         │
│  ┌───────────────────────────────────────────────┐     │
│  │ Faktor 1: Offene Fragen                       │     │
│  │                                               │     │
│  │ Pattern/Keywords: [\\?_______________]        │     │
│  │ Gewicht: [1.2__] (Initial)                    │     │
│  │ Aktuell: 1.45 (gelernt, 13/15 hilfreich)     │     │
│  │ ☑ Lernbar                                     │     │
│  │                              [Löschen]        │     │
│  └───────────────────────────────────────────────┘     │
│                                                         │
│  ┌───────────────────────────────────────────────┐     │
│  │ Faktor 2: Sicherheitskritisch                 │     │
│  │                                               │     │
│  │ Keywords: [evakuierung, gefahr, notfall___]   │     │
│  │ Gewicht: [1.5__]                              │     │
│  │ ☐ Lernbar (FIX für Sicherheit)               │     │
│  │                              [Löschen]        │     │
│  └───────────────────────────────────────────────┘     │
│                                                         │
│  [+ Neuer Faktor hinzufügen]                           │
│                                                         │
│  ──────────────────────────────────────────────────    │
│  🎯 Output-Einstellungen:                              │
│                                                         │
│  Max Einträge: [10__]                                  │
│  Min Score: [0.6__]                                    │
│  Score anzeigen: ☐                                     │
│                                                         │
│  ──────────────────────────────────────────────────    │
│                                                         │
│  [Abbrechen]  [Änderungen speichern]  [Als Vorlage]   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Lern-Statistik (Dashboard)
```
┌─────────────────────────────────────────────────────────┐
│  📊 Lern-Statistik & Performance                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🎯 Gesamtperformance:                                 │
│     Analysen: 127 | Feedback: 89 | Hilfreich: 73%     │
│                                                         │
│  📈 Top-Faktoren (nach Erfolgsrate):                   │
│                                                         │
│  1. Offene Fragen              86.7%  ████████████▌    │
│     Initial: 1.2 → Aktuell: 1.45                       │
│     13/15 hilfreich                                    │
│                                                         │
│  2. Ressourcen-Anfrage         80.0%  ████████████     │
│     Initial: 0.8 → Aktuell: 0.95                       │
│     8/10 hilfreich                                     │
│                                                         │
│  3. Statusmeldung              20.0%  ██▌              │
│     Initial: 0.5 → Aktuell: 0.30                       │
│     2/10 hilfreich  ⚠️ Niedrige Erfolgsrate           │
│                                                         │
│  🔥 Effektivste Kombinationen:                         │
│                                                         │
│  1. "Offene Fragen" + "Ressourcen-Anfrage"            │
│     Erfolgsrate: 85% | 23x verwendet                   │
│                                                         │
│  2. "Sicherheitskritisch" + "Offene Fragen"           │
│     Erfolgsrate: 82% | 18x verwendet                   │
│                                                         │
│  💡 Katastrophen-spezifische Präferenzen:              │
│                                                         │
│  Hochwasser (45 Feedbacks):                            │
│    Beste Faktoren: Ressourcen-Anfrage, Sicherheit     │
│    Bestes Zeitfenster: 120 Minuten                    │
│                                                         │
│  Sturm (28 Feedbacks):                                 │
│    Beste Faktoren: Offene Fragen, Sicherheit          │
│    Bestes Zeitfenster: 60 Minuten                     │
│                                                         │
│  [Alle Gewichte zurücksetzen] [Export als JSON]       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🗂️ Datenstrukturen

### filtering_rules.json (Beispiel)
```json
{
  "version": "1.0.0",
  "description": "Filterregeln für LLM-Kontext",

  "limits": {
    "max_total_tokens": 2500,
    "max_incidents_total": 10,
    "max_protocol_entries": 10,
    "max_tasks_per_role": 3
  },

  "rules": [
    {
      "rule_id": "R2_PROTOKOLL_RELEVANZ",
      "enabled": true,
      "description": "Filtert Protokoll nach Relevanz für Stab",
      "applies_to": "protocol",
      "scoring": {
        "base_score": 0.5,
        "factors": [
          {
            "name": "Offene Fragen",
            "pattern": "\\?",
            "weight": 1.2,
            "learnable": true
          },
          {
            "name": "Sicherheitskritisch",
            "keywords": ["evakuierung", "gefahr", "notfall", "dringend"],
            "weight": 1.5,
            "learnable": false
          }
        ]
      },
      "output": {
        "max_entries": 10,
        "min_score": 0.6
      }
    }
  ]
}
```

### learned_filters.json (Beispiel)
```json
{
  "version": "1.0.0",
  "last_updated": 1737158400000,

  "learned_weights": {
    "protocol_factors": {
      "Offene Fragen": {
        "initial_weight": 1.2,
        "current_weight": 1.45,
        "adjustment_history": [
          { "timestamp": 1737100000000, "delta": 0.05, "reason": "5 helpful feedbacks" },
          { "timestamp": 1737140000000, "delta": 0.10, "reason": "10 helpful feedbacks" },
          { "timestamp": 1737158000000, "delta": 0.10, "reason": "15 helpful feedbacks" }
        ],
        "feedback_count": 15,
        "helpful_count": 13,
        "success_rate": 0.867
      }
    }
  },

  "disaster_type_preferences": {
    "hochwasser": {
      "preferred_protocol_types": ["Ressourcen-Anfrage", "Sicherheitskritisch"],
      "preferred_trend_window": 120,
      "feedback_count": 45
    }
  }
}
```

---

## 🔄 Technischer Ablauf

### 1. Initialisierung (beim Chatbot-Start)
```javascript
// Lade Regel-System
const rules = await loadFilteringRules(); // filtering_rules.json
const learned = await loadLearnedFilters(); // learned_filters.json

// Merge: Regeln + gelernte Gewichte
const activeRules = mergeRulesWithLearned(rules, learned);
```

### 2. Kontext-Vorbereitung (alle 5 Minuten)
```javascript
async function getDisasterContextSummary() {
  // Lade EINFO-Daten
  const rawData = await loadCurrentEinfoData();

  // Wende aktive Regeln an
  const filteredContext = {
    abschnitte: applyRule(activeRules["R1"], rawData.abschnitte),
    protocol: applyRule(activeRules["R2"], rawData.protocol),
    trends: applyRule(activeRules["R3"], rawData.incidents),
    resources: applyRule(activeRules["R4"], rawData.resources)
  };

  // Komprimiere zu Token-Limit
  const compressed = compressToTokenLimit(filteredContext, rules.limits.max_total_tokens);

  // Speichere Metadaten für Feedback
  currentContextMetadata = extractMetadata(filteredContext, activeRules);

  return compressed;
}
```

### 3. Feedback-Verarbeitung
```javascript
async function saveFeedback(feedback) {
  // Erweitere mit Kontext-Metadaten
  feedback.context_metadata = currentContextMetadata;

  // Speichere Feedback (wie bisher)
  await saveFeedbackToFile(feedback);

  // Update gelernte Gewichte (NEU)
  if (feedback.feedback_count % 5 === 0) {
    await updateLearnedWeights(feedback);
  }
}

async function updateLearnedWeights(feedback) {
  const learnedFilters = await loadLearnedFilters();

  // Für jeden verwendeten Protokoll-Typ
  for (const [type, data] of Object.entries(feedback.context_metadata.protocol_types_shown)) {
    const factorData = learnedFilters.learned_weights.protocol_factors[type];

    if (!factorData.learnable) continue; // Skip fixed weights

    // Update Statistiken
    factorData.feedback_count++;
    if (feedback.helpful) factorData.helpful_count++;
    factorData.success_rate = factorData.helpful_count / factorData.feedback_count;

    // Gewichts-Anpassung
    if (factorData.feedback_count % 5 === 0) {
      const delta = calculateWeightAdjustment(factorData);
      factorData.current_weight = clamp(
        factorData.current_weight + delta,
        0.1, // min
        2.0  // max
      );

      // History speichern
      factorData.adjustment_history.push({
        timestamp: Date.now(),
        delta: delta,
        reason: `${factorData.helpful_count} helpful feedbacks`
      });
    }
  }

  // Persistiere
  await saveLearnedFilters(learnedFilters);
}
```

---

## 📂 Dateien & Integration

### Neue Dateien
1. **/server/data/conf/filtering_rules.json** - Regel-Definitionen
2. **/server/data/llm_feedback/learned_filters.json** - Gelernte Gewichte
3. **/chatbot/server/filtering_engine.js** - Regel-Parser & Anwender (NEU)
4. **/chatbot/server/rule_learner.js** - Lern-Algorithmus (NEU)

### Bestehende Dateien erweitern
1. **/chatbot/server/disaster_context.js** - Integration der Regel-Engine
2. **/chatbot/server/llm_feedback.js** - Erweitere `saveFeedback()` um Metadaten
3. **/chatbot/server/situation_analyzer.js** - Nutze gefilterten Kontext

### Frontend (GUI) - NEU
1. **/client/src/components/RuleEditor/RuleList.jsx** - Regel-Übersicht
2. **/client/src/components/RuleEditor/RuleDetail.jsx** - Regel-Editor
3. **/client/src/components/RuleEditor/LearningStats.jsx** - Lern-Dashboard
4. **/client/src/components/RuleEditor/RulePreview.jsx** - Live-Vorschau

---

## ✅ Nächste Schritte (offen)

### Zu klärende Fragen

1. **Abschnitts-Struktur in board.json:**
   - Wie genau werden Abschnitte modelliert?
   - Welche Felder existieren?
   - Beispiel-Daten vorhanden?

2. **GUI-Priorität:**
   - Vollständiger Regel-Editor von Anfang an?
   - Oder zuerst Backend + einfache JSON-Bearbeitung?

3. **Vordefinierte Regeln:**
   - Alle 5 Regeln (R1-R5) als Standard?
   - Oder nur eine Teilmenge?
   - Weitere Standard-Regeln gewünscht?

4. **Hot-Reload:**
   - Regel-Änderungen sofort aktiv (ohne Neustart)?
   - Oder Neustart akzeptabel?

5. **Implementierungs-Reihenfolge:**
   - Welche Regel zuerst? (Empfehlung: R2 - Protokoll-Relevanz)
   - Welcher Teil zuerst? (Backend-Engine → GUI → Lernen?)

---

## 📝 Wichtige Erkenntnisse

1. **Abschnitte sind bereits in board.json** - keine neue Datenstruktur nötig
2. **GUI ist Pflicht** - nicht nur JSON-Bearbeitung
3. **Vordefinierte Regeln notwendig** - System muss sofort nutzbar sein
4. **Persistierung kritisch** - Gelerntes MUSS Neustart überleben
5. **Transparenz wichtig** - Jede Änderung muss nachvollziehbar sein (adjustment_history)

---

## 📚 Erstellte Dokumente

1. **HYBRID_FILTERING_KONZEPT.md** - Vollständiges technisches Konzept
2. **CHAT_HYBRID_FILTERING_2026-01-18.md** - Dieses Protokoll

---

## 🎯 ENTSCHEIDUNG: Context-Fingerprint-Ansatz (2026-01-18 Fortsetzung)

### Problem identifiziert
Das aktuelle System nutzt **einfaches Keyword-Matching** für gelernte Vorschläge:
- Code in `situation_analyzer.js:246-267`
- "Einfache Keyword-basierte Relevanz (ohne Embedding für Performance)"
- **Problem:** Semantisch ähnliche Situationen werden nicht erkannt
  - Beispiel: "großflächig" ≠ "viele Einsatzstellen" → kein Match
  - Aber semantisch identisch!

### Evaluierte Alternativen
1. **Semantisches RAG (Embeddings)** - Beste Qualität, aber Performance-Overhead
2. **Zwei-Stufen-LLM** - Risiko von Informationsverlust ❌
3. **Rollenspezifisch** - 7 API-Calls statt 1 (zu teuer) ❌
4. **Incremental Context** - Nur Änderungen (gute Ergänzung)
5. **Context-Fingerprint** - Strukturierte Metadaten ⭐

### ✅ Entschiedener Ansatz: Context-Fingerprint + Regelsystem

**Architektur:**
```
┌─────────────────────────────────────────────────┐
│     1. REGELSYSTEM filtert Kontext              │
│  ├─ R1: Abschnitte (critical_sections: 3)      │
│  ├─ R2: Protokoll (types: [Fragen, Ressourcen])│
│  ├─ R3: Trends (escalating, +8/h)              │
│  └─ R4: Ressourcen (shortage: true, 85%)       │
│                                                 │
│  Output: Gefilterter Kontext (800 Tokens)      │
│          + Context-Fingerprint (Metadaten)      │
└──────────────────┬──────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────┐
│  2. LERNEN findet ähnliche Situationen         │
│  ├─ Vergleiche Context-Fingerprints             │
│  ├─ Match: Disaster-Type + Phase + Ressourcen  │
│  └─ Top 3 relevante Vorschläge (aus 50)        │
│                                                 │
│  Output: 3 gelernte Vorschläge (200 Tokens)    │
└──────────────────┬──────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────┐
│     3. LLM ANALYSIERT kombiniert                │
│  Input: 1200 Tokens (statt 3000!)              │
│  Output: Hochwertige Vorschläge für alle Rollen│
└─────────────────────────────────────────────────┘
```

### Context-Fingerprint-Struktur

```json
{
  "disaster_type": "hochwasser",
  "phase": "escalation",

  "critical_sections": 3,
  "total_incidents": 45,

  "dominant_protocol_types": ["Offene Fragen", "Ressourcen-Anfrage"],

  "trend_direction": "escalating",
  "new_incidents_per_hour": 8,

  "resource_shortage": true,
  "avg_utilization": 85
}
```

### Matching-Algorithmus

```javascript
function matchFingerprints(current, learned) {
  let score = 0;

  // Disaster-Type (wichtigster Faktor)
  if (current.disaster_type === learned.disaster_type) score += 20;

  // Phase
  if (current.phase === learned.phase) score += 10;

  // Trend-Richtung
  if (current.trend_direction === learned.trend_direction) score += 5;

  // Ressourcen-Situation
  if (current.resource_shortage === learned.resource_shortage) score += 5;

  // Protocol-Type Overlap
  const typeOverlap = current.dominant_protocol_types.filter(t =>
    learned.dominant_protocol_types.includes(t)
  ).length;
  score += typeOverlap * 3;

  return score;
}
```

### Vorteile der Lösung
1. ✅ **Hochwertige Entscheidungen:** LLM bekommt relevanten Kontext + passende gelernte Vorschläge
2. ✅ **Strukturiert:** Context-Fingerprint ist nachvollziehbar (nicht Black-Box)
3. ✅ **Effizient:** Kein Embedding nötig, schnelles Matching
4. ✅ **Regeln + Lernen:** Beste Kombination aus beiden Welten
5. ✅ **Disaster-spezifisch:** Hochwasser-Learnings ≠ Sturm-Learnings
6. ✅ **Kein Informationsverlust:** Anders als Zwei-Stufen-LLM
7. ✅ **Ein API-Call:** Anders als rollenspezifische Ansätze

### Implementierungs-Komponenten

**Schritt 1:** Erweitere `applyAllFilteringRules()`
```javascript
function applyAllFilteringRules(rules, learned, rawData) {
  const filtered = { ... };

  // NEU: Erstelle Context-Fingerprint
  const fingerprint = extractContextFingerprint(filtered, rawData);

  return { filtered, fingerprint };
}
```

**Schritt 2:** Erweitere `saveFeedback()`
```javascript
export async function saveFeedback(feedback) {
  // Füge aktuellen Fingerprint hinzu
  feedback.context_fingerprint = currentContextFingerprint;

  // Speichere wie bisher
  await saveFeedbackToFile(feedback);
}
```

**Schritt 3:** Intelligentes Matching
```javascript
function getLearnedSuggestionsForContext(role, fingerprint) {
  const roleSpecific = learnedSuggestions.filter(s => s.targetRole === role);

  const scored = roleSpecific.map(s => ({
    ...s,
    relevance: matchFingerprints(fingerprint, s.context_fingerprint)
  }))
  .filter(s => s.relevance > 15)  // Min-Schwelle
  .sort((a, b) => b.relevance - a.relevance)
  .slice(0, 3);

  return scored;
}
```

### Optionale Erweiterung: Incremental Context

Kann später hinzugefügt werden für zusätzliche Token-Reduktion:
- Erste Analyse: Voller Kontext (2000 Tokens)
- Folge-Analysen: Nur Diff + Kritisches (700 Tokens)
- Alle 60min: Refresh mit vollem Kontext

---

**Status:** Ansatz entschieden, bereit für Implementierungsplanung
