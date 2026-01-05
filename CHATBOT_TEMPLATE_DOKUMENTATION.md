# EINFO Chatbot - Template Dokumentation

Detaillierte Aufstellung aller Templates im EINFO Chatbot-System, wann sie verwendet werden und was sie bewirken.

---

## Übersicht

Der EINFO Chatbot verwendet ein modulares Template-System mit **11 verschiedenen Template-Dateien**, die je nach Betriebsmodus und Situation dynamisch kombiniert werden. Diese befinden sich in `/chatbot/server/prompt_templates/`.

---

## 1. START-MODUS Templates

### 1.1 `start_system_prompt.txt`

**Verwendung:** Beim **ersten Simulationsschritt** (wenn `llmInput.firstStep === true`)

**Zweck:** System-Prompt für die Initialisierung eines neuen Katastrophenszenarios

**Aufgabe:**
- Definiert die Rolle als "EINFO-Start-Assistent für den Bezirks-Einsatzstab"
- Erzwingt striktes JSON-Format ohne Markdown
- Gibt die Grundregeln für Rollenverwendung vor
- Zeigt ein vollständiges Beispiel-JSON für das Start-Szenario
- Definiert Pflichtfelder und Limits (3 Einsatzstellen, max. 5 Aufgaben, max. 3 Protokolleinträge)

**Trigger:**
```javascript
// In llm_client.js, Zeile 135-139
if (llmInput.firstStep) {
  const start = buildStartPrompts({ roles: llmInput.roles, scenario });
  systemPrompt = start.systemPrompt;
  userPrompt = start.userPrompt;
}
```

**Enthaltene Anweisungen:**
- JSON-Struktur mit `operations.board.createIncidentSites`, `operations.aufgaben.create`, `operations.protokoll.create`
- Verwendung konkreter Rollennamen (EL, LtStb, S1-S6) statt activeRoles
- Deutsche Sprache für alle Inhalte
- Präzise Feldnamen und Datentypen

---

### 1.2 `start_user_prompt.txt`

**Verwendung:** Beim **ersten Simulationsschritt** als User-Prompt

**Zweck:** Beschreibt die Ausgangslage und gibt konkrete Anweisungen für die Szenario-Initialisierung

**Dynamische Platzhalter:**
- `{{rolesJson}}` - JSON-Array der aktiven Rollen
- `{{scenarioContext}}` - Szenario-Beschreibung (siehe 2.4)
- `{{initialBoard}}` - Vordefinierte Einsatzstellen aus dem Szenario
- `{{scenarioHints}}` - Hinweise für die Szenario-Durchführung

**Trigger:** Gleicher wie 1.1

**Anforderungen:**
- Wenn INITIALE EINSATZSTELLEN definiert sind: Diese exakt anlegen
- Andernfalls: 1-3 passende Einsatzstellen basierend auf Szenario-Kontext erstellen
- 1-5 Aufgaben und 1-3 Protokolleinträge für den Start
- Keine Verwendung von activeRoles in Rollen-Feldern

---

## 2. OPERATIONS-MODUS Templates

### 2.1 `operations_system_prompt.txt`

**Verwendung:** Bei **allen Folgeschritten** der Simulation (wenn `llmInput.firstStep === false`)

**Zweck:** System-Prompt für die laufende Simulation und Stabsarbeit

**Aufgabe:**
- Definiert die Rolle als "EINFO-Chatbot für den Bezirks-Einsatzstab"
- Erzwingt JSON-Format
- Erklärt die Rollenlogik (activeRoles = reale Personen)
- Definiert detaillierte Absender-Regeln für Protokolle und Aufgaben
- Legt Qualitätsstandards für deutsche Fachsprache fest
- Gibt das vollständige JSON-Schema vor
- Definiert Limits pro Schritt (max. 5 Einsatzstellen, 8 Aufgaben, 8 Protokolleinträge)

**Trigger:**
```javascript
// In llm_client.js, Zeile 140-164
else {
  systemPrompt = buildSystemPrompt({ memorySnippets });
  userPrompt = buildUserPrompt({ ... });
}
```

**Besondere Regeln:**
- **ABSENDER-REGELN:** Detaillierte Anweisungen für `anvon` und `assignedBy` Felder
- **TEXTQUALITÄT:** Vollständige deutsche Sätze, keine Abkürzungen
- **PROTOKOLL-KATEGORIEN:** Lagemeldung, Auftrag, Rückfrage, Rückmeldung, Info

---

### 2.2 `operations_user_prompt.txt`

**Verwendung:** Bei **allen Folgeschritten** als User-Prompt

**Zweck:** Stellt die aktuelle Lage zusammen und gibt die Aufgabe vor

**Dynamische Platzhalter:**
- `{{rolesPart}}` - JSON der aktiven Rollen
- `{{compressedBoard}}` - Kompakte Darstellung aller Einsatzstellen
- `{{compressedAufgaben}}` - Kompakte Darstellung aller Aufgaben
- `{{compressedProtokoll}}` - Kompakte Darstellung der letzten Protokolleinträge
- `{{formattedMemorySnippets}}` - RAG-Erinnerungen aus der Vektor-Datenbank
- `{{knowledgeContext}}` - Wissen aus der Knowledge-Base
- `{{taskSection}}` - Aufgabenstellung (siehe 2.5/2.6)
- `{{responseRequests}}` - Meldungen die Antwort benötigen (siehe 2.3)
- `{{disasterContext}}` - Katastrophen-Kontext (siehe disaster_context.js)
- `{{learnedResponses}}` - Gelernte Antworten aus Feedback (siehe llm_feedback.js)

**Trigger:** Gleicher wie 2.1

**Wichtige Regeln am Ende:**
1. Keine Rollen aus activeRoles verwenden
2. Volle Feldnamen verwenden
3. Alle Texte in korrektem Deutsch
4. Vollständige Sätze, keine Stichworte

---

### 2.3 `response_guide.txt`

**Verwendung:** Wenn **Meldungen auf Antwort warten** (`messagesNeedingResponse.length > 0`)

**Zweck:** Anleitung für realistische Antworten von externen Stellen

**Trigger:**
```javascript
// In prompts.js, Zeile 126-214
if (messagesNeedingResponse && messagesNeedingResponse.length > 0) {
  responseRequests = "\n\n" + responseGuideTemplate + "\n\n";
  // ... Einzelne Meldungen auflisten
}
```

**Inhalt:**
- Erklärung positiver vs. negativer Antworten
- **Detaillierte Antwortmuster** für externe Stellen:
  - **Leitstelle (LAWZ):** Alarmierungsbestätigungen
  - **Polizei (POL):** Absperrungen, Verkehrsregelung
  - **Bürgermeister (BM):** Evakuierungsentscheidungen
  - **WLV/Wildbach:** Gefahrenbeurteilung
  - **Straßenmeisterei:** Straßensperren
  - **EVN/Energieversorger:** Stromabschaltung
  - **Rotes Kreuz (RK):** Sanitätsdienst
  - **Bundesheer (BH):** Assistenzeinsatz
- Vorgeschriebenes Antwort-Format für Protokolleinträge

**Eingefügt in:** `operations_user_prompt.txt` unter `{{responseRequests}}`

---

### 2.4 `scenario_context.txt`

**Verwendung:** Wenn ein **vordefiniertes Szenario** geladen wird

**Zweck:** Strukturierte Darstellung des Szenario-Kontexts

**Trigger:**
```javascript
// In prompts.js, Zeile 241-253
if (scenario) {
  scenarioContext = fillTemplate(scenarioContextTemplate, {
    title: scenario.title,
    eventType: ctx.event_type,
    region: ctx.region,
    weather: ctx.weather,
    initialSituation: ctx.initial_situation,
    affectedAreas: ...,
    specialConditions: ...
  });
}
```

**Dynamische Platzhalter:**
- `{{title}}` - Szenario-Titel
- `{{eventType}}` - Art des Ereignisses (z.B. "Hochwasser")
- `{{region}}` - Betroffene Region
- `{{weather}}` - Wetterbedingungen
- `{{initialSituation}}` - Ausgangslage
- `{{affectedAreas}}` - Betroffene Gebiete (Liste)
- `{{specialConditions}}` - Besondere Bedingungen (Liste)

**Eingefügt in:** `start_user_prompt.txt` unter `{{scenarioContext}}`

---

### 2.5 `task_section_first_step.txt`

**Verwendung:** Beim **ersten Simulationsschritt**

**Zweck:** Beschreibt die Spezialaufgabe für den Start

**Trigger:**
```javascript
// In prompts.js (nicht direkt sichtbar, aber in taskSection-Logik)
if (llmInput.firstStep) {
  taskSection = taskSectionFirstStep;
}
```

**Inhalt:**
- Hinweis auf leeres Board/Aufgaben/Protokoll
- Anweisung zur Erzeugung eines realistischen Start-Szenarios
- 1-3 neue Einsatzstellen erstellen
- Passende Protokolleinträge und Aufgaben für den Stab
- Einhaltung von JSON-Schema und Rollenregeln

**Eingefügt in:** `start_user_prompt.txt` (implizit über taskSection-Variable)

---

### 2.6 `task_section_operations.txt`

**Verwendung:** Bei **allen Folgeschritten** der Simulation

**Zweck:** Beschreibt die Aufgabe für laufende Operations

**Trigger:**
```javascript
// In prompts.js (nicht direkt sichtbar, aber in taskSection-Logik)
if (!llmInput.firstStep) {
  taskSection = taskSectionOperations;
}
```

**Inhalt:**
- **KRITISCH:** Exaktes JSON-Schema
- **VERBOTENE Formate:** Falsche Feldnamen werden explizit aufgelistet
- **Aufgabe in 3 Schritten:**
  1. Offene Aufgaben bearbeiten
  2. Lageentwicklung simulieren
  3. Stabsarbeit der fehlenden Rollen (S2-S5, LtStb)
- **Pflicht:** Mindestens 1-2 Protokolleinträge, keine activeRoles als Absender

**Eingefügt in:** `operations_user_prompt.txt` unter `{{taskSection}}`

---

## 3. CHAT-MODUS Templates

### 3.1 `chat_system_prompt.txt`

**Verwendung:** Im **QA-Chat-Modus** (wenn Simulation pausiert)

**Zweck:** System-Prompt für Fragen und Antworten zu Katastropheneinsätzen

**Trigger:**
```javascript
// In llm_client.js, Zeile 241-242
const systemPrompt = buildSystemPromptChat();
const userPrompt = buildUserPromptChat(question, knowledgeContext, ...);
```

**Aufgaben:**
- Fragen zu Katastropheneinsätzen beantworten
- Stabsarbeit (S1-S6, Einsatzleiter, LdStb) erklären
- Lokale Richtlinien und Verfahren erläutern
- Wissen aus der Knowledge-Base nutzen

**Regeln:**
- Immer auf Deutsch
- **AUSFÜHRLICH** und informativ
- Wissenskontext vollständig nutzen und zitieren
- Feuerwehr-Fachsprache erwünscht
- Ehrlich sagen wenn Kontext nicht ausreicht

**Antwort-Stil:**
1. Direkte Antwort auf die Frage
2. Details aus Wissenskontext ergänzen
3. Zusammenhänge und Hintergründe erklären
4. Praktische Hinweise geben

---

### 3.2 `chat_user_prompt.txt`

**Verwendung:** Im **QA-Chat-Modus** als User-Prompt

**Zweck:** Stellt die Frage zusammen mit Kontext und Anweisungen

**Dynamische Platzhalter:**
- `{{question}}` - Die Frage des Benutzers
- `{{disasterContext}}` - Aktuelle Lage und Verlauf (max. 1000 Zeichen)
- `{{learnedResponses}}` - Gelernte Antworten aus Feedback (max. 800 Zeichen)
- `{{knowledgeContext}}` - Wissen aus der RAG-Knowledge-Base

**Trigger:** Gleicher wie 3.1

**Anweisungen für die Antwort:**
1. **Wissen ausführlich nutzen:** Zitieren, erklären, Quellen nennen
2. **Kontext berücksichtigen:** Katastrophen-Kontext und gelernte Antworten einbeziehen
3. **Strukturiert antworten:** Klar beginnen, Details ergänzen, Aufzählungen nutzen
4. **Qualität vor Kürze:** Ausführliche Antworten bevorzugen
5. **Ehrlichkeit:** Klar sagen wenn Wissenskontext nicht ausreicht

---

## 4. UTILITY-Templates

### 4.1 `json_repair_system.txt`

**Verwendung:** Wenn das LLM **ungültiges JSON** zurückgibt

**Zweck:** Repariert defektes JSON durch erneuten LLM-Aufruf

**Trigger:**
```javascript
// In llm_client.js, Zeile 328-403
async function requestJsonRepairFromLLM({
  invalidJson,
  model,
  phaseLabel,
  messageCount
}) {
  // ... verwendet jsonRepairSystemPrompt
}
```

**Funktion:**
- Kurzer, fokussierter Prompt
- Extrahiert und repariert JSON aus Text
- Antwortet NUR mit repariertem JSON
- Wird mit `format: "json"` aufgerufen für erzwungenes JSON-Format

**Nur verwendet in:** Operations-Modus (nicht im Chat-Modus!)

---

## Template-Verwendung: Flussdiagramm

```
┌─────────────────────────────────────────────────────────┐
│                 EINFO Chatbot Start                     │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │  Modus-Auswahl   │
          └────────┬─────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────┐     ┌──────────────┐
│   CHAT-MODUS │     │SIMULATIONS-  │
│   (pausiert) │     │    MODUS     │
└───────┬──────┘     └───────┬──────┘
        │                    │
        ▼                    ▼
  ┌─────────────┐   ┌─────────────────┐
  │ 3.1 + 3.2   │   │  Erster Schritt?│
  │ chat_system │   └────────┬────────┘
  │ chat_user   │            │
  └─────────────┘   ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
            ┌──────────────┐  ┌──────────────┐
            │   JA (first) │  │ NEIN (ops)   │
            │ 1.1 + 1.2    │  │ 2.1 + 2.2    │
            │ start_system │  │ ops_system   │
            │ start_user   │  │ ops_user     │
            │   + 2.4      │  │   + 2.6      │
            │   + 2.5      │  │   + 2.3*     │
            │scenario_ctx  │  │response_guide│
            │task_first    │  └──────────────┘
            └──────────────┘
                    │
                    │ * nur wenn
                    │   Meldungen
                    │   Antwort
                    │   benötigen
                    ▼
            ┌──────────────┐
            │ JSON ungültig?│
            └───────┬──────┘
                    │
                    ▼ JA
            ┌──────────────┐
            │ 4.1          │
            │json_repair   │
            └──────────────┘
```

---

## Template-Kombinationen: Übersichtstabelle

| Situation | System Prompt | User Prompt | Zusätzliche Templates |
|-----------|--------------|-------------|----------------------|
| **Start-Szenario** | 1.1 `start_system_prompt` | 1.2 `start_user_prompt` | 2.4 `scenario_context`<br>2.5 `task_section_first_step` |
| **Laufende Simulation** | 2.1 `operations_system_prompt` | 2.2 `operations_user_prompt` | 2.6 `task_section_operations` |
| **Simulation + Antworten** | 2.1 `operations_system_prompt` | 2.2 `operations_user_prompt` | 2.3 `response_guide`<br>2.6 `task_section_operations` |
| **QA-Chat** | 3.1 `chat_system_prompt` | 3.2 `chat_user_prompt` | - |
| **JSON-Reparatur** | 4.1 `json_repair_system` | User: "Repariere dieses JSON: ..." | - |

---

## Dynamische Kontexte (nicht Template-Dateien)

Diese Daten werden zur Laufzeit generiert und in Templates eingefügt:

### Disaster Context
- **Quelle:** `disaster_context.js`
- **Funktion:** `getDisasterContextSummary()`
- **Verwendet in:** Operations User Prompt (2.2), Chat User Prompt (3.2)
- **Zweck:** Verlauf und Entwicklung der aktuellen Katastrophenlage
- **Max. Länge:** 1500 Zeichen (Operations), 1000 Zeichen (Chat)

### Learned Responses
- **Quelle:** `llm_feedback.js`
- **Funktion:** `getLearnedResponsesContext()`
- **Verwendet in:** Operations User Prompt (2.2), Chat User Prompt (3.2)
- **Zweck:** Positiv bewertete frühere LLM-Antworten als Lernkontext
- **Max. Länge:** 1000 Zeichen (Operations), 800 Zeichen (Chat)

### RAG Knowledge Context
- **Quelle:** `rag/rag_vector.js`
- **Funktion:** `getKnowledgeContextVector()`
- **Verwendet in:** Operations User Prompt (2.2), Chat User Prompt (3.2)
- **Zweck:** Relevante Dokumente aus der Vektor-Datenbank
- **Berechnet:** Mittels Embedding-Ähnlichkeit

### Memory Snippets
- **Quelle:** `memory_manager.js`
- **Verwendet in:** Operations System Prompt (2.1)
- **Zweck:** Kurzzeit-Erinnerungen aus vorherigen Schritten
- **Format:** Array von Strings

---

## Modell-Auswahl für Template-Typen

Die Templates werden mit unterschiedlichen LLM-Modellen ausgeführt:

| Template-Typ | Task-Type | Standard-Modell | Einstellungen |
|--------------|-----------|----------------|---------------|
| **Start** (1.1, 1.2) | `"start"` | `balanced` oder `fast` | temperature: 0.1<br>numPredict: 6000 |
| **Operations** (2.1-2.6) | `"operations"` | `balanced` oder `fast` | temperature: 0.2<br>numPredict: 6000 |
| **Chat** (3.1, 3.2) | `"chat"` | `balanced` | temperature: 0.4<br>numPredict: 2048 |
| **JSON Repair** (4.1) | (verwendet aktuelles Modell) | - | temperature: 0<br>format: "json" |

Konfiguriert in: `config.js` → `CONFIG.llm.taskModels`

---

## Wichtige Code-Referenzen

### Template-Loading
- **Datei:** `prompts.js`
- **Zeilen:** 19-48
- **Funktion:** `loadPromptTemplate(fileName)`

### Template-Builder Funktionen
- **buildSystemPrompt()** → Operations System (2.1)
- **buildUserPrompt()** → Operations User (2.2)
- **buildStartPrompts()** → Start System + User (1.1, 1.2)
- **buildSystemPromptChat()** → Chat System (3.1)
- **buildUserPromptChat()** → Chat User (3.2)

### Template-Auswahl in LLM-Client
- **Datei:** `llm_client.js`
- **Start:** Zeile 126-165 (`callLLMForOps`)
- **Chat:** Zeile 226-281 (`callLLMForChat`)

### Szenario-Template Integration
- **Datei:** `prompts.js`
- **Zeilen:** 241-287 (Szenario-Kontext-Aufbau)
- **Verwendet:** 2.4 `scenario_context.txt`

---

## Qualitätsmerkmale der Templates

### Sprachqualität
- **Deutsch:** Alle Templates erzwingen korrekte deutsche Sprache
- **Fachsprache:** Feuerwehr- und Katastrophenschutz-Terminologie
- **Vollständigkeit:** Keine Abkürzungen oder Stichworte in Freitexten

### JSON-Struktur
- **Strikt:** Exakte Feldnamen und Verschachtelung vorgeschrieben
- **Validierung:** `json_sanitizer.js` prüft die Struktur
- **Reparatur:** Bei Fehlern automatische Reparatur über 4.1

### Rollenkonzept
- **activeRoles:** Werden NIE als Absender verwendet
- **Stabs-Rollen:** S1-S6, LtStb, EL für Simulationen
- **Externe Stellen:** POL, LST, RK, BH, etc. für realistische Kommunikation

---

## Best Practices für Template-Anpassungen

1. **Niemals JSON-Struktur ändern** ohne `json_sanitizer.js` anzupassen
2. **Platzhalter** immer mit `{{name}}` kennzeichnen
3. **Lange Texte** in eigene Template-Dateien auslagern
4. **Deutsche Sprache** in allen Anweisungen verwenden
5. **Beispiele** in Templates einbauen für bessere LLM-Compliance
6. **Limits** explizit nennen (max. Anzahl Einträge)
7. **Verbotene Formate** explizit auflisten
8. **Testbarkeit** sicherstellen durch klare Trigger-Bedingungen

---

## Wartung und Versionierung

- **Letzte Aktualisierung:** 2026-01-05
- **Version:** v2.0 (mit Learned Responses und Disaster Context)
- **Dokumentations-Datei:** `CHATBOT_TEMPLATE_DOKUMENTATION.md`
- **Code-Referenzen:** Alle Zeilennummern beziehen sich auf aktuellen Stand

Bei Änderungen an Templates:
1. Diese Dokumentation aktualisieren
2. Testszenarien durchführen
3. JSON-Validierung prüfen
4. Deutsche Sprachqualität sicherstellen

---

**Ende der Template-Dokumentation**
