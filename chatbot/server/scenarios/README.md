# Szenario-Templates Dokumentation

Diese Dokumentation beschreibt alle Parameter der Szenario-Templates für das EINFO Stabstraining-System.

## Inhaltsverzeichnis

1. [Dateistruktur](#dateistruktur)
2. [Grundlegende Parameter](#grundlegende-parameter)
3. [Simulation](#simulation)
4. [Szenario-Kontext](#szenario-kontext)
5. [Initial State (Anfangszustand)](#initial-state)
6. [Triggers (Auslöser)](#triggers)
7. [Hints (Hinweise)](#hints)
8. [Vollständiges Beispiel](#vollständiges-beispiel)

---

## Dateistruktur

Szenario-Templates sind JSON-Dateien im Verzeichnis `chatbot/server/scenarios/`. Jede Datei definiert ein vollständiges Übungsszenario.

```
scenarios/
├── hochwasser_basic.json      # Einfache Hochwasser-Übung
├── hochwasser_feldkirchen.json # Mittelschweres Hochwasser-Szenario
├── sturm_bezirk.json          # Sturm-Szenario
└── README.md                  # Diese Dokumentation
```

---

## Grundlegende Parameter

Diese Parameter identifizieren und beschreiben das Szenario.

| Parameter | Typ | Pflicht | Beschreibung |
|-----------|-----|---------|--------------|
| `id` | string | Ja | Eindeutige Kennung des Szenarios (z.B. `"hochwasser_basic"`) |
| `title` | string | Ja | Angezeigter Titel (z.B. `"Hochwasser - Grundübung"`) |
| `description` | string | Ja | Kurze Beschreibung für die Szenario-Auswahl |
| `difficulty` | enum | Ja | Schwierigkeitsgrad: `"easy"`, `"medium"`, `"hard"` |
| `duration_minutes` | number | Ja | Geplante Übungsdauer in Minuten |
| `mode` | enum | Ja | Übungsmodus: `"free"` oder `"guided"` |

### Beispiel

```json
{
  "id": "sturm_bezirk",
  "title": "Sturmschäden Bezirk Feldkirchen",
  "description": "Ein schwerer Herbststurm mit umgestürzten Bäumen und Stromausfällen.",
  "difficulty": "easy",
  "duration_minutes": 60,
  "mode": "free"
}
```

### Schwierigkeitsgrade erklärt

- **easy**: Wenige gleichzeitige Einsätze, klare Prioritäten, für Einsteiger
- **medium**: Mehr Komplexität, parallele Ereignisse, erfordert Koordination
- **hard**: Hohe Belastung, schwierige Entscheidungen, für erfahrene Teilnehmer

### Modi erklärt

- **free**: Freie Übung ohne vorgegebene Schritte, realistische Simulation
- **guided**: Geführte Übung mit Hinweisen und Anleitungen (für Schulungen)

---

## Simulation

Der `simulation`-Block steuert das Zeitverhalten und die Lageentwicklung.

### Parameter

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `llm_interval_minutes` | number | Intervall in Minuten, in dem die KI neue Ereignisse generiert |
| `minutes_per_step` | number | Simulierte Minuten pro Simulationsschritt |
| `incident_limits.max_new_per_step` | number | Maximale Anzahl neuer Einsätze pro Schritt |
| `incident_limits.max_total` | number | Maximale Gesamtanzahl aller Einsätze im Szenario |
| `behavior_phases` | array | Definiert die drei Lagephasen |

### Behavior Phases (Lagephasen)

Jedes Szenario durchläuft drei Phasen:

| Phase | Beschreibung |
|-------|--------------|
| **Verschärfung** | Lage entwickelt sich, neue Einsätze nehmen zu |
| **Stabilisierung** | Lage bleibt auf hohem Niveau, Fokus auf Koordination |
| **Entspannung** | Weniger neue Einsätze, Fokus auf Abschluss |

**Parameter pro Phase:**

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `duration_minutes` | number | Dauer der Phase in Minuten |
| `label` | string | Name der Phase (für Anzeige) |
| `intensity` | string | Intensitätsentwicklung: `"steigend"`, `"gleichbleibend"`, `"abnehmend"` |
| `guidance` | string | Hinweis für die KI zur Ereignisgenerierung |

### Beispiel

```json
{
  "simulation": {
    "llm_interval_minutes": 5,
    "minutes_per_step": 5,
    "incident_limits": {
      "max_new_per_step": 3,
      "max_total": 18
    },
    "behavior_phases": [
      {
        "duration_minutes": 20,
        "label": "Verschärfung",
        "intensity": "steigend",
        "guidance": "Steigende Pegelstände, mehrere neue Einsatzstellen."
      },
      {
        "duration_minutes": 20,
        "label": "Stabilisierung",
        "intensity": "gleichbleibend",
        "guidance": "Lage bleibt kritisch, Fokus auf Koordination."
      },
      {
        "duration_minutes": 20,
        "label": "Entspannung",
        "intensity": "abnehmend",
        "guidance": "Weniger neue Meldungen, Übergang zu Aufräumarbeiten."
      }
    ]
  }
}
```

---

## Szenario-Kontext

Der `scenario_context`-Block beschreibt die Ausgangslage und wird der KI und den Teilnehmern angezeigt.

### Parameter

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `event_type` | string | Art des Ereignisses (z.B. `"Hochwasser"`, `"Sturm"`) |
| `region` | string | Betroffenes Gebiet (z.B. `"Bezirk Feldkirchen"`) |
| `affected_areas` | array | Liste der betroffenen Orte/Gebiete |
| `weather` | string | Aktuelle Wetterlage |
| `initial_situation` | string | Beschreibung der Ausgangslage |
| `special_conditions` | array | Besondere Umstände (z.B. Stromausfälle, Sperren) |

### Beispiel

```json
{
  "scenario_context": {
    "event_type": "Sturm",
    "region": "Bezirk Feldkirchen",
    "affected_areas": [
      "Gnesau",
      "Sirnitz",
      "Albeck",
      "Steuerberg"
    ],
    "weather": "Orkanböen bis 120 km/h, Regen",
    "initial_situation": "Seit 06:00 Uhr mehren sich die Einsatzmeldungen. Die Landesstraßen sind teilweise blockiert.",
    "special_conditions": [
      "Mehrere Stromleitungen beschädigt",
      "Mobilfunknetz in Gnesau gestört",
      "Schulen im Bezirk geschlossen"
    ]
  }
}
```

---

## Initial State

Der `initial_state`-Block definiert den Anfangszustand des Einsatzboards beim Szenariostart.

### Board-Struktur

Das Board besteht aus Spalten (columns), die jeweils Einsätze (items) enthalten:

```json
{
  "initial_state": {
    "board": {
      "columns": {
        "neu": { "name": "Neu", "items": [...] },
        "in-bearbeitung": { "name": "In Bearbeitung", "items": [] },
        "erledigt": { "name": "Erledigt", "items": [] }
      }
    }
  }
}
```

### Einsatz-Parameter (Items)

| Parameter | Typ | Pflicht | Beschreibung |
|-----------|-----|---------|--------------|
| `id` | string | Ja | Eindeutige technische ID (z.B. `"hw-001"`) |
| `humanId` | string | Ja | Lesbare Einsatznummer (z.B. `"E-1"`) |
| `content` | string | Ja | Kurzbeschreibung des Einsatzes |
| `typ` | string | Ja | Einsatzart mit Stufe (z.B. `"T3, Wasserschaden"`) |
| `ort` | string | Ja | Adresse/Standort des Einsatzes |
| `description` | string | Ja | Detaillierte Beschreibung der Lage |

### Einsatztypen (Empfohlen)

| Typ | Beschreibung |
|-----|--------------|
| `T1, Verkehrshindernis` | Einfache technische Hilfeleistung |
| `T2, Gebäudesicherung` | Mittlere technische Hilfeleistung |
| `T3, Wasserschaden` | Pumparbeiten, Kellerüberflutung |
| `T3, Gefahr durch Strom` | Stromleitung, Elektrizitätsgefahr |
| `T3, Menschenrettung` | Personen in Gefahr |
| `T4, Menschenrettung` | Größere Rettungsaktion |

### Beispiel

```json
{
  "initial_state": {
    "board": {
      "columns": {
        "neu": {
          "name": "Neu",
          "items": [
            {
              "id": "st-001",
              "humanId": "E-1",
              "content": "Baum auf Fahrbahn L87",
              "typ": "T1, Verkehrshindernis",
              "ort": "L87 km 3, Gnesau",
              "description": "Großer Baum blockiert beide Fahrspuren"
            },
            {
              "id": "st-002",
              "humanId": "E-2",
              "content": "Dachschaden Wohnhaus",
              "typ": "T2, Gebäudesicherung",
              "ort": "Dorfstraße 12, Sirnitz",
              "description": "Dachziegel abgedeckt, Regenwasser dringt ein"
            }
          ]
        },
        "in-bearbeitung": { "name": "In Bearbeitung", "items": [] },
        "erledigt": { "name": "Erledigt", "items": [] }
      }
    }
  }
}
```

---

## Triggers

Triggers sind automatische Ereignisse, die zu bestimmten Zeitpunkten oder bei bestimmten Bedingungen ausgelöst werden.

### Trigger-Struktur

```json
{
  "triggers": [
    {
      "id": "trigger-1",
      "condition": { ... },
      "action": { ... }
    }
  ]
}
```

### Condition-Typen (Auslösebedingungen)

#### 1. Zeit-basiert (`time_elapsed`)

Wird nach einer bestimmten Zeit seit Szenariostart ausgelöst.

```json
{
  "condition": {
    "type": "time_elapsed",
    "minutes": 15
  }
}
```

#### 2. Einsatzanzahl-basiert (`incident_count`)

Wird ausgelöst, wenn eine bestimmte Anzahl von Einsätzen in einer Spalte erreicht wird.

```json
{
  "condition": {
    "type": "incident_count",
    "column": "in-bearbeitung",
    "operator": ">=",
    "value": 2
  }
}
```

**Verfügbare Operatoren:** `>=`, `<=`, `==`, `>`

### Action-Typen (Aktionen)

#### 1. Einsatz hinzufügen (`add_incident`)

Fügt einen neuen Einsatz zum Board hinzu.

```json
{
  "action": {
    "type": "add_incident",
    "data": {
      "humanId": "E-4",
      "content": "Person unter Baum eingeklemmt",
      "typ": "T3, Menschenrettung",
      "ort": "Waldweg, Steuerberg",
      "description": "Waldarbeiter wurde von umstürzendem Baum getroffen",
      "priority": "high"
    }
  }
}
```

#### 2. Externe Nachricht (`external_message`)

Simuliert eine Nachricht von einer externen Stelle.

```json
{
  "action": {
    "type": "external_message",
    "data": {
      "from": "KELAG",
      "infoTyp": "Info",
      "information": "Stromleitung wurde abgeschaltet. Bereich ist stromfrei."
    }
  }
}
```

#### 3. Protokolleintrag (`create_protocol`)

Erstellt automatisch einen Protokolleintrag.

```json
{
  "action": {
    "type": "create_protocol",
    "data": {
      "information": "Wetterwarnung: Starkregen erwartet in den nächsten 2 Stunden",
      "infoTyp": "Warnung",
      "ergehtAn": ["S2", "S3"],
      "anvon": "ZAMG"
    }
  }
}
```

### Vollständiges Trigger-Beispiel

```json
{
  "triggers": [
    {
      "id": "trigger-1",
      "condition": {
        "type": "time_elapsed",
        "minutes": 10
      },
      "action": {
        "type": "external_message",
        "data": {
          "from": "KELAG",
          "infoTyp": "Info",
          "information": "Stromleitung in Albeck wurde abgeschaltet."
        }
      }
    },
    {
      "id": "trigger-2",
      "condition": {
        "type": "incident_count",
        "column": "in-bearbeitung",
        "operator": ">=",
        "value": 2
      },
      "action": {
        "type": "external_message",
        "data": {
          "from": "BH",
          "infoTyp": "Info",
          "information": "Die BH hat Katastrophenhilfe des Bundesheeres angefordert."
        }
      }
    }
  ]
}
```

---

## Hints

Der `hints`-Block enthält Tipps für die Übungsteilnehmer.

```json
{
  "hints": [
    "Bei Stromleitung auf der Straße: Bereich absichern, Abstand halten",
    "KELAG für Freischaltung kontaktieren",
    "Kettensägen-Einsätze nur mit entsprechender Ausbildung"
  ]
}
```

Diese Hinweise werden den Teilnehmern angezeigt und helfen bei der korrekten Bearbeitung der Lage.

---

## Vollständiges Beispiel

Hier ein minimales, aber vollständiges Szenario-Template:

```json
{
  "id": "beispiel_szenario",
  "title": "Beispiel-Szenario",
  "description": "Ein einfaches Beispiel für ein Szenario-Template",
  "difficulty": "easy",
  "duration_minutes": 45,
  "mode": "guided",

  "simulation": {
    "llm_interval_minutes": 5,
    "minutes_per_step": 5,
    "incident_limits": {
      "max_new_per_step": 2,
      "max_total": 8
    },
    "behavior_phases": [
      {
        "duration_minutes": 15,
        "label": "Verschärfung",
        "intensity": "steigend",
        "guidance": "Neue Einsätze kommen herein, Lage entwickelt sich."
      },
      {
        "duration_minutes": 15,
        "label": "Stabilisierung",
        "intensity": "gleichbleibend",
        "guidance": "Lage bleibt konstant, Fokus auf Abarbeitung."
      },
      {
        "duration_minutes": 15,
        "label": "Entspannung",
        "intensity": "abnehmend",
        "guidance": "Weniger neue Einsätze, Abschlussphase."
      }
    ]
  },

  "scenario_context": {
    "event_type": "Technischer Einsatz",
    "region": "Musterort",
    "affected_areas": ["Zentrum", "Industriegebiet"],
    "weather": "Bewölkt, 15°C",
    "initial_situation": "Mehrere technische Einsätze wurden gemeldet.",
    "special_conditions": ["Keine besonderen Umstände"]
  },

  "initial_state": {
    "board": {
      "columns": {
        "neu": {
          "name": "Neu",
          "items": [
            {
              "id": "ex-001",
              "humanId": "E-1",
              "content": "Wasserschaden im Keller",
              "typ": "T2, Wasserschaden",
              "ort": "Hauptstraße 10, Musterort",
              "description": "Keller eines Einfamilienhauses steht unter Wasser"
            }
          ]
        },
        "in-bearbeitung": { "name": "In Bearbeitung", "items": [] },
        "erledigt": { "name": "Erledigt", "items": [] }
      }
    }
  },

  "triggers": [
    {
      "id": "trigger-1",
      "condition": {
        "type": "time_elapsed",
        "minutes": 10
      },
      "action": {
        "type": "add_incident",
        "data": {
          "humanId": "E-2",
          "content": "Baum auf Straße",
          "typ": "T1, Verkehrshindernis",
          "ort": "Bundesstraße 1, km 5",
          "description": "Umgestürzter Baum blockiert eine Fahrspur"
        }
      }
    }
  ],

  "hints": [
    "Priorität hat immer die Menschenrettung",
    "Dokumentation im Protokoll nicht vergessen"
  ]
}
```

---

## Zusammenfassung der Parameter

| Bereich | Pflicht-Parameter | Optional |
|---------|-------------------|----------|
| **Grundlegend** | id, title, description, difficulty, duration_minutes, mode | - |
| **Simulation** | llm_interval_minutes, minutes_per_step, incident_limits, behavior_phases | - |
| **Szenario-Kontext** | event_type, region, affected_areas, weather, initial_situation | special_conditions |
| **Initial State** | board.columns mit mindestens einem Item | - |
| **Triggers** | condition, action | id |
| **Hints** | - | hints (empfohlen) |

---

## Tipps für neue Szenarien

1. **Realistische Zeitabstände**: Verwende `llm_interval_minutes` von 2-6 Minuten für ein angemessenes Tempo
2. **Ausgewogene Phasen**: Die drei Phasen sollten zusammen etwa der `duration_minutes` entsprechen
3. **Klare Einsatzbeschreibungen**: `content` sollte knapp sein, `description` detailliert
4. **Sinnvolle Triggers**: Nutze Triggers für wichtige Ereignisse, nicht für jeden kleinen Einsatz
5. **Hilfreiche Hints**: Gib den Teilnehmern praxisrelevante Tipps
