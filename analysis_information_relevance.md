# Welche Informationen sind für Lageeinschätzung wirklich relevant?

## 1. KRITISCH (Ohne diese keine sinnvolle Analyse möglich) 🔴

### Aktive Einsatzstellen
**Was:** Typ, Ort, Priorität/Schwere, Status
**Warum:** Kern der Lage - ohne zu wissen WO und WAS passiert, keine Analyse möglich
**Wie viel:** Top 10-15 nach Priorität (nicht alle 50!)
**Detailgrad:**
- ✅ BRAUCHT: Typ (Brand, Hochwasser), Ort (Adresse), Priorität, Status (neu/aktiv/abgeschlossen)
- ❌ NICHT NÖTIG: Vollständige Beschreibung, alle Metadaten, exakte Timestamps
- ⚠️ DISKUTABEL: Alarmierte Einheiten (wichtig für S1/S3, aber macht Prompt länger)

### Aktuelle Phase der Katastrophe
**Was:** initial → escalation → peak → resolution
**Warum:** Bestimmt die Art der Vorschläge (Aufbau vs. Rückbau, proaktiv vs. reaktiv)
**Wie viel:** Ein Wort + kurze Begründung (z.B. "peak - 25 Einsätze gleichzeitig")

### Typ und Beschreibung der Katastrophe
**Was:** Hochwasser, Sturm, Mure, etc.
**Warum:** Bestimmt rollenspezifische Fachkenntnisse (Hochwasser → S4 braucht Sandsäcke/Pumpen)
**Wie viel:** 1-2 Sätze

---

## 2. WICHTIG (Verbessert Qualität deutlich) 🟡

### Offene Aufgaben pro Rolle
**Was:** Was ist bereits delegiert, aber nicht abgeschlossen?
**Warum:** Vermeidet Duplikate, zeigt Überlastung, hilft Priorisierung
**Wie viel:** Top 3-5 pro Rolle (nicht alle!)
**Detailgrad:**
- ✅ BRAUCHT: Titel, Rolle, Status (in Bearbeitung vs. offen)
- ❌ NICHT NÖTIG: Vollständige Beschreibung, Historie, wer erstellt hat
- ⚠️ DISKUTABEL: Frist (wichtig für Priorisierung, aber oft nicht gesetzt)

### Offene Fragen aus Protokoll
**Was:** Anfragen die noch nicht beantwortet wurden (erkennt durch "?")
**Warum:** Zeigt Kommunikationslücken, die geschlossen werden müssen
**Wie viel:** Top 5 dringendste (nicht alle 20!)
**Detailgrad:**
- ✅ BRAUCHT: Sender, Empfänger, Frage, Zeitpunkt (wie lange schon offen?)
- ❌ NICHT NÖTIG: Vollständiger Nachrichtenverlauf

### Ressourcen-Status
**Was:** Anzahl verfügbarer/gebundener Einsatzkräfte, Fahrzeuge, Material
**Warum:** Basis für S1/S4 Vorschläge (Nachschub, Ablösung)
**Wie viel:** Aggregierte Zahlen (z.B. "120 Kräfte im Einsatz, 30 verfügbar")
**Problem:** Aktuell NICHT in disasterSummary enthalten! Wird vermutlich aus "alerted" implizit abgeleitet

---

## 3. HILFREICH (Kontext & Trends) 🟢

### Trends & Entwicklung
**Was:** Steigt/sinkt Anzahl Einsätze? Pegeltrend? Wetterprognose?
**Warum:** Erlaubt vorausschauende Vorschläge (proaktive Gefahrenanalyse!)
**Wie viel:** 2-3 Kernindikatoren
**Beispiel:**
- ✅ "Pegel Glan steigt 15cm/h (aktuell 2,8m, kritisch ab 3,2m)"
- ✅ "Einsatzstellen +5 in letzter Stunde (Trend: Eskalation)"
- ❌ Vollständige Wetterdaten für 5 Stationen

### Erkannte Muster
**Was:** Häufigste Einsatztypen, betroffene Gebiete
**Warum:** Hilft Muster zu erkennen (z.B. "alle Einsätze im Tal-Bereich")
**Wie viel:** Top 3 Muster
**Beispiel:** "8x Kellerüberflutung, 5x Hangrutschung, 3x umgestürzte Bäume"

### Jüngste Timeline-Events
**Was:** Letzte 5-10 wichtige Ereignisse (nicht alle!)
**Warum:** Zeigt Dynamik und kritische Wendepunkte
**Wie viel:** Nur significant events (high/critical), nicht jeden Aufgaben-Status
**Detailgrad:**
- ✅ BRAUCHT: "14:35 - Phase gewechselt zu peak", "14:50 - Evakuierung Glanhofen begonnen"
- ❌ NICHT NÖTIG: "14:23 - Aufgabe #123 erstellt", "14:25 - Protokoll #45 erfasst"

### Gelernte Vorschläge (RAG)
**Was:** Ähnliche Situationen aus der Vergangenheit, was hat funktioniert?
**Warum:** LLM kann erfolgreiche Strategien wiederverwenden
**Wie viel:** Top 3-5 ähnlichste, mit hohem Rating
**Problem:** Macht Prompt länger, aber verbessert Qualität erheblich

---

## 4. WENIG RELEVANT (Kann weggelassen werden) ⚪

### Vollständiges Protokoll
**Was:** Alle Protokolleinträge chronologisch
**Warum:** Meiste Einträge sind Routine-Dokumentation ohne Entscheidungsrelevanz
**Besser:** Nur offene Fragen + kritische Events (Evakuierung angeordnet, Lage geändert)

### Statistiken (LLM-Akzeptanzrate)
**Was:** "45 Vorschläge akzeptiert, 12 abgelehnt"
**Warum:** Interessant für Monitoring, aber irrelevant für aktuelle Lageeinschätzung
**Wann relevant:** Nur wenn Akzeptanzrate sehr niedrig (< 30%) → LLM macht schlechte Vorschläge

### Erledigte Einsätze/Aufgaben
**Was:** Was bereits abgeschlossen ist
**Warum:** Historisch interessant, aber für aktuelle Entscheidung nicht relevant
**Ausnahme:** Wenn kürzlich erledigt (< 30min) für Kontext "Lage entspannt sich"

### Detaillierte Einsatz-Beschreibungen
**Was:** Vollständiger Content-Text jedes Einsatzes
**Warum:** Zu viel Detail, lenkt ab
**Besser:** Nur Typ + Ort + Priorität, ggf. sehr kurzer Preview (< 30 chars)

### Alarmierte Einheiten (diskutabel!)
**Was:** Welche Feuerwehr/Einheit ist wo alarmiert?
**Warum PRO:** Wichtig für S1 (wer ist verfügbar?) und S3 (wer ist wo?)
**Warum CONTRA:** Macht Prompt sehr lang bei vielen Einsätzen
**Lösung:** Nur bei high/critical priority Einsätzen, sonst weglassen

---

## 5. KRITISCH FÜR QUALITÄT: Was aktuell FEHLT ❌

### Ressourcen-Verfügbarkeit
- Wie viele Kräfte sind gebunden vs. verfügbar?
- Welche Spezialgeräte sind im Einsatz?
- Material-Status (Sandsäcke, Treibstoff, Pumpen)?

**Problem:** Nicht strukturiert erfasst, LLM muss raten!

### Einsatzdauer pro Einsatzstelle
- Seit wann läuft der Einsatz?
- Wann ist Ablösung fällig (Arbeitszeitrichtlinien)?

**Problem:** Nicht in disasterSummary! Wichtig für S1 (Personalplanung)

### Gefahren-Indikatoren
- Pegelstände + Trend
- Wetterprognose (Regen setzt ein, Wind verstärkt sich)
- Betroffene Bevölkerung (Anzahl Personen in Gefahr)

**Problem:** Teilweise in Timeline, aber nicht strukturiert

---

## EMPFEHLUNG: Minimal-Set für hochwertige Analyse

### Schritt 1: Strukturierte Fakten-Extraktion (LLM-1)
```json
{
  "situation": {
    "type": "Hochwasser",
    "phase": "peak",
    "duration_minutes": 240,
    "trend": "escalating|stable|resolving"
  },
  "incidents": {
    "total": 28,
    "by_priority": {"critical": 3, "high": 12, "medium": 10, "low": 3},
    "top_critical": [
      {"type": "Kellerüberflutung", "location": "Hauptstr. 5", "since": "14:20", "units": "FF Himmelberg"}
    ]
  },
  "resources": {
    "personnel_deployed": 120,
    "personnel_available": 30,
    "critical_shortages": ["Sandsäcke", "Hochleistungspumpen"]
  },
  "open_tasks_by_role": {
    "S1": 5,
    "S3": 8,
    "S4": 3
  },
  "open_questions": [
    {"from": "S3", "question": "Sind weitere Pumpen verfügbar?", "age_minutes": 15}
  ],
  "hazard_indicators": [
    {"type": "Pegel Glan", "current": "2.8m", "trend": "+15cm/h", "critical_at": "3.2m"}
  ]
}
```

### Schritt 2: Analyse mit kompakten Fakten (LLM-2)
- Eingabe: Obige JSON-Struktur (~500 tokens statt 1200+)
- System-Prompt: Vollständig erhalten (Qualitätsrichtlinien!)
- Output: Rollenspezifische Vorschläge wie bisher

---

## ALTERNATIVE: Intelligentes Filtern statt Zusammenfassen

Statt zwei LLM-Schritte:
1. **Regelbasierte Vorfilterung** (kein LLM):
   - Sortiere Einsätze nach Priorität, nimm Top 10
   - Filtere Protokoll auf offene Fragen + critical events
   - Aggregiere Aufgaben-Counts statt einzeln auflisten
   - Berechne Trends aus Daten (Einsätze/Stunde)

2. **Ein LLM-Call mit gefilterten Daten**:
   - Viel kompakter (50% Reduktion)
   - Keine Informationsverlust durch LLM-Zusammenfassung
   - Deterministisch, nachvollziehbar

**Vorteil:** Schneller, günstiger, keine Fehlerquelle durch LLM-1
**Nachteil:** Erfordert gute Filter-Heuristiken
