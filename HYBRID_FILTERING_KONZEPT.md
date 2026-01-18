# Hybrid-Filterung: Regeln + Lernen

**Ziel:** Kombination aus starren Regeln (JSON-konfigurierbar, ohne Code-Änderungen) und adaptivem Lernen (persistiert im RAG, überlebt Neustart).

---

## 🎯 Kernprinzip

```
┌──────────────────────────────────────────────────────────┐
│          REGELSCHICHT (filtering_rules.json)             │
│  Hart-codierte Grenzen, Struktur-Vorgaben                │
│  ✓ Änderbar ohne Programmierung (JSON-Edit)              │
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

---

## 📋 Teil 1: JSON-Regel-System

### Datei: `/server/data/conf/filtering_rules.json`

**Struktur:**

```json
{
  "version": "1.0.0",
  "description": "Filterregeln für LLM-Kontext (ohne Programmierung erweiterbar)",

  "limits": {
    "max_total_tokens": 2500,
    "max_incidents_total": 10,
    "max_protocol_entries": 10,
    "max_tasks_per_role": 3
  },

  "rules": [
    {
      "rule_id": "R1_ABSCHNITTE_PRIORITÄT",
      "enabled": true,
      "description": "Zeigt Abschnitte priorisiert (kritische zuerst)",
      "applies_to": "abschnitte",
      "conditions": [
        {
          "field": "has_critical_incidents",
          "operator": "==",
          "value": true,
          "action": {
            "priority": 1.0,
            "always_include": true
          }
        },
        {
          "field": "incident_count",
          "operator": ">=",
          "value": 5,
          "action": {
            "priority": 0.8,
            "show_trend": true
          }
        },
        {
          "field": "resource_shortage",
          "operator": "==",
          "value": true,
          "action": {
            "priority": 0.9,
            "highlight": "RESSOURCEN-ENGPASS"
          }
        }
      ],
      "output": {
        "format": "summary",
        "include_fields": ["name", "incident_count", "critical_count", "trend", "resource_status"],
        "max_items": 5
      }
    },

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
          },
          {
            "name": "Ressourcen-Anfrage",
            "keywords": ["benötigt", "anforderung", "fahrzeug", "personal"],
            "weight": 0.8,
            "learnable": true
          },
          {
            "name": "Statusmeldung",
            "keywords": ["status", "meldung", "bericht"],
            "weight": 0.5,
            "learnable": true
          },
          {
            "name": "Abgeschlossene Aufgabe",
            "keywords": ["erledigt", "fertig", "abgeschlossen"],
            "weight": 0.3,
            "learnable": true
          }
        ]
      },
      "output": {
        "max_entries": 10,
        "min_score": 0.6,
        "show_score": false
      }
    },

    {
      "rule_id": "R3_TRENDS_ERKENNUNG",
      "enabled": true,
      "description": "Berechnet Trends für vorausschauende Planung",
      "applies_to": "incidents",
      "trend_analysis": {
        "time_windows": [30, 60, 120],
        "metrics": [
          {
            "name": "neue_einsatzstellen",
            "calculate": "count_new_incidents",
            "threshold_warning": 5,
            "threshold_critical": 10
          },
          {
            "name": "durchschnittliche_dauer",
            "calculate": "avg_duration_minutes",
            "threshold_warning": 120,
            "threshold_critical": 240
          },
          {
            "name": "ressourcen_auslastung",
            "calculate": "percent_units_deployed",
            "threshold_warning": 70,
            "threshold_critical": 90
          }
        ]
      },
      "output": {
        "format": "summary_text",
        "include_forecast": true,
        "forecast_horizon_minutes": 120
      }
    },

    {
      "rule_id": "R4_RESSOURCEN_STATUS",
      "enabled": true,
      "description": "Aggregiert Ressourcen-Status über Abschnitte",
      "applies_to": "resources",
      "aggregation": {
        "group_by": "abschnitt",
        "metrics": [
          {
            "name": "verfügbar",
            "calculate": "count_available_units"
          },
          {
            "name": "im_einsatz",
            "calculate": "count_deployed_units"
          },
          {
            "name": "auslastung_prozent",
            "calculate": "deployed / (deployed + available) * 100"
          }
        ],
        "highlight_if": {
          "auslastung_prozent": { ">=": 80 }
        }
      }
    },

    {
      "rule_id": "R5_STABS_FOKUS",
      "enabled": true,
      "description": "Filtert Details für Stabsarbeit (Abschnitte statt Einzelstellen)",
      "applies_to": "all",
      "stab_mode": {
        "aggregate_to_sections": true,
        "show_individual_incidents_only_if": [
          { "field": "priority", "value": "critical" },
          { "field": "has_open_questions", "value": true },
          { "field": "affects_multiple_sections", "value": true }
        ],
        "max_individual_incidents": 3
      }
    }
  ],

  "metadata": {
    "last_modified": "2026-01-18T00:00:00Z",
    "modified_by": "system",
    "notes": "Regeln können ohne Code-Änderungen angepasst werden. Felder mit 'learnable: true' können durch Feedback optimiert werden."
  }
}
```

---

## 🧠 Teil 2: Lern-System (Persistiert)

### Datei: `/server/data/llm_feedback/learned_filters.json`

**Struktur:**

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
      },
      "Statusmeldung": {
        "initial_weight": 0.5,
        "current_weight": 0.3,
        "adjustment_history": [
          { "timestamp": 1737120000000, "delta": -0.1, "reason": "5 not-helpful feedbacks" },
          { "timestamp": 1737150000000, "delta": -0.1, "reason": "8 not-helpful feedbacks" }
        ],
        "feedback_count": 10,
        "helpful_count": 2,
        "success_rate": 0.2
      },
      "Ressourcen-Anfrage": {
        "initial_weight": 0.8,
        "current_weight": 0.95,
        "adjustment_history": [
          { "timestamp": 1737130000000, "delta": 0.15, "reason": "8 helpful feedbacks" }
        ],
        "feedback_count": 10,
        "helpful_count": 8,
        "success_rate": 0.8
      }
    },

    "abschnitt_detail_level": {
      "initial_incidents_per_section": 3,
      "current_incidents_per_section": 4,
      "adjustment_history": [
        { "timestamp": 1737140000000, "delta": 1, "reason": "Users requested more detail" }
      ]
    },

    "trend_window_minutes": {
      "initial_value": 60,
      "current_value": 90,
      "adjustment_history": [
        { "timestamp": 1737150000000, "delta": 30, "reason": "90min window more predictive" }
      ]
    }
  },

  "context_effectiveness": {
    "contexts_analyzed": 127,
    "feedback_received": 89,
    "avg_helpfulness": 0.73,

    "most_effective_combinations": [
      {
        "combination": {
          "protocol_types": ["Offene Fragen", "Ressourcen-Anfrage"],
          "incidents_per_section": 4,
          "trend_window": 90
        },
        "success_rate": 0.85,
        "usage_count": 23
      },
      {
        "combination": {
          "protocol_types": ["Sicherheitskritisch", "Offene Fragen"],
          "incidents_per_section": 3,
          "trend_window": 60
        },
        "success_rate": 0.82,
        "usage_count": 18
      }
    ],

    "least_effective_combinations": [
      {
        "combination": {
          "protocol_types": ["Statusmeldung", "Abgeschlossene Aufgabe"],
          "incidents_per_section": 5,
          "trend_window": 30
        },
        "success_rate": 0.25,
        "usage_count": 12
      }
    ]
  },

  "disaster_type_preferences": {
    "hochwasser": {
      "preferred_protocol_types": ["Ressourcen-Anfrage", "Sicherheitskritisch"],
      "preferred_trend_window": 120,
      "feedback_count": 45
    },
    "sturm": {
      "preferred_protocol_types": ["Offene Fragen", "Sicherheitskritisch"],
      "preferred_trend_window": 60,
      "feedback_count": 28
    }
  },

  "metadata": {
    "learning_rate": 0.1,
    "min_feedback_for_adjustment": 5,
    "max_weight_change_per_step": 0.2,
    "weight_bounds": {
      "min": 0.1,
      "max": 2.0
    }
  }
}
```

---

## 🔄 Teil 3: Feedback-Erweiterung

### Erweitere `saveFeedback()` um Kontext-Metadaten

**Aktuell:**
```javascript
saveFeedback({
  helpful: true,
  rating: 5,
  ...
})
```

**NEU:**
```javascript
saveFeedback({
  helpful: true,
  rating: 5,

  // NEU: Welche Filter-Regeln wurden verwendet?
  context_metadata: {
    rules_applied: ["R1_ABSCHNITTE_PRIORITÄT", "R2_PROTOKOLL_RELEVANZ", "R3_TRENDS_ERKENNUNG"],

    protocol_types_shown: {
      "Offene Fragen": { count: 3, weight: 1.45 },
      "Ressourcen-Anfrage": { count: 2, weight: 0.95 },
      "Sicherheitskritisch": { count: 1, weight: 1.5 }
    },

    incidents_per_section: 4,
    trend_window_used: 90,

    total_tokens: 1850,
    sections_shown: 4,

    disaster_type: "hochwasser",
    disaster_phase: "escalation"
  }
})
```

---

## ⚙️ Teil 4: Lern-Algorithmus

### Einfacher, transparenter Lern-Prozess

```javascript
// Pseudo-Code für Gewichts-Anpassung

async function updateLearnedWeights(feedback) {
  const { helpful, context_metadata } = feedback;

  // Lade gelernte Gewichte
  const learnedFilters = await loadLearnedFilters();

  // Für jede verwendete Protokoll-Art
  for (const [type, data] of Object.entries(context_metadata.protocol_types_shown)) {
    const factorData = learnedFilters.learned_weights.protocol_factors[type];

    if (!factorData.learnable) continue; // Sicherheitskritisch ist fix

    // Update Feedback-Zähler
    factorData.feedback_count++;
    if (helpful) factorData.helpful_count++;
    factorData.success_rate = factorData.helpful_count / factorData.feedback_count;

    // Gewichts-Anpassung (nur wenn genug Feedback vorhanden)
    if (factorData.feedback_count % 5 === 0) {
      const delta = calculateWeightAdjustment(factorData);

      // Begrenzte Anpassung
      const boundedDelta = Math.max(-0.2, Math.min(0.2, delta));
      const newWeight = factorData.current_weight + boundedDelta;

      // Gewicht innerhalb Grenzen halten
      factorData.current_weight = Math.max(0.1, Math.min(2.0, newWeight));

      // Historie speichern
      factorData.adjustment_history.push({
        timestamp: Date.now(),
        delta: boundedDelta,
        reason: `${factorData.helpful_count} helpful feedbacks`
      });
    }
  }

  // Speichere Updates
  await saveLearnedFilters(learnedFilters);
}

function calculateWeightAdjustment(factorData) {
  const learningRate = 0.1;

  // Wenn success_rate > 0.7 → erhöhe Gewicht
  // Wenn success_rate < 0.4 → reduziere Gewicht

  if (factorData.success_rate > 0.7) {
    return learningRate * (factorData.success_rate - 0.5);
  } else if (factorData.success_rate < 0.4) {
    return -learningRate * (0.5 - factorData.success_rate);
  }

  return 0; // Keine Änderung bei mittlerer Performance
}
```

---

## 📊 Teil 5: Anwendung der Hybrid-Filter

### Haupt-Ablauf in `disaster_context.js`

```javascript
async function getDisasterContextSummary() {
  // 1. Lade Regelwerk
  const rules = await loadFilteringRules(); // filtering_rules.json

  // 2. Lade gelernte Gewichtungen
  const learned = await loadLearnedFilters(); // learned_filters.json

  // 3. Lade EINFO-Daten
  const rawData = await loadCurrentEinfoData();

  // 4. Wende Regeln + gelernte Gewichte an
  const context = {
    abschnitte: applyRule(rules["R1_ABSCHNITTE_PRIORITÄT"], rawData.abschnitte),

    protocol: applyRule(
      rules["R2_PROTOKOLL_RELEVANZ"],
      rawData.protocol,
      learned.learned_weights.protocol_factors // ← Gelernte Gewichte!
    ),

    trends: applyRule(
      rules["R3_TRENDS_ERKENNUNG"],
      rawData.incidents,
      { timeWindow: learned.learned_weights.trend_window_minutes.current_value }
    ),

    resources: applyRule(rules["R4_RESSOURCEN_STATUS"], rawData.resources)
  };

  // 5. Komprimiere zu Token-Limit (aus Regeln)
  const compressed = compressToTokenLimit(context, rules.limits.max_total_tokens);

  // 6. Speichere verwendete Metadaten für späteres Feedback
  currentContextMetadata = extractMetadata(context, rules, learned);

  return compressed;
}
```

---

## 🎛️ Teil 6: Regel-Verwaltung (ohne UI zuerst)

### Manuelle Regel-Anpassung

**Schritt 1:** Regel-Datei bearbeiten
```bash
nano /server/data/conf/filtering_rules.json
```

**Schritt 2:** Parameter ändern
```json
{
  "rule_id": "R2_PROTOKOLL_RELEVANZ",
  "scoring": {
    "factors": [
      {
        "name": "Offene Fragen",
        "pattern": "\\?",
        "weight": 1.2,  // ← Ändern auf 1.5
        "learnable": true
      }
    ]
  }
}
```

**Schritt 3:** Chatbot neu starten (oder Hot-Reload implementieren)
```bash
systemctl restart einfo-chatbot
```

---

## 🔄 Teil 7: Optionale UI-Erweiterung (Zukunft)

### Mögliche Stabs-UI für Regel-Verwaltung

```
┌─────────────────────────────────────────────────┐
│  ⚙️ Filter-Einstellungen                       │
├─────────────────────────────────────────────────┤
│                                                 │
│  📋 Protokoll-Filterung                        │
│                                                 │
│  ☑ Offene Fragen           [Gewicht: 1.45]     │
│     Initial: 1.2  →  Gelernt: 1.45             │
│     ✓ 13/15 hilfreiche Vorschläge              │
│     [Zurücksetzen] [Manuell ändern]            │
│                                                 │
│  ☑ Ressourcen-Anfragen     [Gewicht: 0.95]     │
│     Initial: 0.8  →  Gelernt: 0.95             │
│     ✓ 8/10 hilfreiche Vorschläge               │
│                                                 │
│  ☐ Statusmeldungen         [Gewicht: 0.30]     │
│     Initial: 0.5  →  Gelernt: 0.30             │
│     ✗ 2/10 hilfreiche Vorschläge               │
│     💡 Niedrige Erfolgsrate - deaktiviert      │
│                                                 │
│  🔄 Trend-Analyse                              │
│                                                 │
│  Zeitfenster: [90 Minuten ▼]                   │
│    Initial: 60min  →  Gelernt: 90min           │
│                                                 │
│  ⚡ Vorschau: 1850 Tokens (von 2500 max)       │
│                                                 │
│  [Änderungen speichern] [Alle zurücksetzen]    │
└─────────────────────────────────────────────────┘
```

---

## ✅ Vorteile dieser Hybrid-Lösung

### 1. **Ohne Programmierung erweiterbar**
- Neue Regel? → JSON bearbeiten
- Schwellenwerte ändern? → JSON bearbeiten
- Keine Code-Änderungen nötig

### 2. **Lernen überlebt Neustart**
- `learned_filters.json` persistiert alle Gewichte
- Nach Neustart: Gelernte Optimierungen bleiben erhalten
- Kontinuierliches Lernen über Einsätze hinweg

### 3. **Transparent & nachvollziehbar**
- Jede Gewichtsänderung wird in `adjustment_history` dokumentiert
- Sichtbar: Warum wurde ein Gewicht geändert?
- Regelwerk zeigt Initial- und aktuelle Werte

### 4. **Sicher durch Grenzen**
- `learnable: false` für sicherheitskritische Regeln
- Gewichte haben Min/Max-Grenzen (0.1 - 2.0)
- Max. Änderung pro Schritt begrenzt (0.2)

### 5. **Adaptive Optimierung**
- System lernt disaster-spezifische Präferenzen
- Hochwasser ≠ Sturm → unterschiedliche Filter-Gewichte
- Langfristige Verbesserung durch Feedback-Loop

---

## 📅 Umsetzungsplan

### Phase 1: Grundlagen (Woche 1-2)
1. JSON-Schema für `filtering_rules.json` erstellen
2. JSON-Schema für `learned_filters.json` erstellen
3. Lade-/Speicher-Funktionen implementieren
4. Validierung & Fehlerbehandlung

### Phase 2: Regel-Engine (Woche 3-4)
1. Regel-Parser implementieren
2. `applyRule()` für jeden Regel-Typ
3. Integration in `disaster_context.js`
4. Tests mit echten EINFO-Daten

### Phase 3: Lern-System (Woche 5-6)
1. Erweitere `saveFeedback()` um Kontext-Metadaten
2. Implementiere `updateLearnedWeights()`
3. Implementiere `calculateWeightAdjustment()`
4. Persistierung-Tests

### Phase 4: Integration & Testing (Woche 7-8)
1. End-to-End-Tests
2. Performance-Optimierung
3. Dokumentation
4. Training für Stabsmitglieder

### Phase 5: Optional - UI (Zukunft)
1. Regel-Editor-UI
2. Lern-Statistik-Dashboard
3. Live-Gewichtsanpassung

---

## 🔍 Monitoring & Validierung

### Metriken zur Erfolgs-Messung

1. **Token-Effizienz:**
   - Durchschnittliche Token-Reduktion
   - Ziel: 50-60% Reduktion bei gleicher Qualität

2. **Feedback-Rate:**
   - Prozentsatz hilfreicher Vorschläge
   - Ziel: > 70% hilfreiche Bewertungen

3. **Lern-Konvergenz:**
   - Wie schnell stabilisieren sich Gewichte?
   - Ziel: Nach 20-30 Feedbacks stabil

4. **Regel-Nutzung:**
   - Welche Regeln werden am häufigsten angewendet?
   - Welche Regeln werden nie verwendet? (ggf. entfernen)

---

## 🎓 Beispiel-Szenario

### Einsatz: Hochwasser, Tag 1

**Initial:**
```json
"Offene Fragen": { "weight": 1.2 }
"Statusmeldungen": { "weight": 0.5 }
```

**Nach 10 Vorschlägen:**
- 7x "Offene Fragen" → hilfreich
- 2x "Statusmeldungen" → nicht hilfreich

**Gelerntes Update:**
```json
"Offene Fragen": { "weight": 1.35, "success_rate": 0.85 }
"Statusmeldungen": { "weight": 0.4, "success_rate": 0.20 }
```

### Einsatz: Hochwasser, Tag 3

**System verwendet nun:**
- Mehr Gewicht auf "Offene Fragen" (1.35)
- Weniger Gewicht auf "Statusmeldungen" (0.4)
- → Bessere Vorschläge, höheres Feedback

### Einsatz: Neues Hochwasser, 6 Monate später

**System erinnert sich:**
```json
"disaster_type_preferences": {
  "hochwasser": {
    "preferred_protocol_types": ["Offene Fragen", "Ressourcen-Anfrage"],
    "preferred_trend_window": 120
  }
}
```

**→ Startet direkt mit optimierten Gewichten!**

---

## 💬 Nächste Diskussionspunkte

1. **Abschnitts-Struktur:** Wie werden Abschnitte in EINFO aktuell modelliert? Gibt es bereits Felder dafür?

2. **Regel-Prioritäten:** Welche der 5 Regeln ist am wichtigsten für erste Implementation?

3. **Hot-Reload:** Sollen Regel-Änderungen ohne Neustart wirksam werden?

4. **UI vs. Datei:** Zuerst JSON-basiert arbeiten, UI später? Oder sofort UI?

5. **Disaster-Type-Spezifisch:** Sollen Filter-Präferenzen pro Katastrophen-Typ gespeichert werden?

---

**Status:** Konzept fertig, bereit für Diskussion & Implementierung
