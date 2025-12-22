# Disaster History & Learning System

**Erstellt:** 2025-12-22
**Status:** ✅ Vollständig implementiert

---

## 📋 Übersicht

Das EINFO-System wurde um ein umfassendes **Disaster History & Learning System** erweitert, das:

1. **Den gesamten Verlauf der aktuellen Katastrophe** erfasst und analysiert
2. **LLM-Antworten bewerten** lässt und aus positiven Bewertungen lernt
3. **Kontextbewusste Antworten** generiert basierend auf:
   - Laufenden Einsätzen
   - Vorhandenen Meldungen
   - Katastrophenverlauf
   - Gelernten Antworten aus früheren Einsätzen

---

## 🎯 Hauptkomponenten

### 1. Disaster Context System (`disaster_context.js`)

**Zweck:** Verfolgt den gesamten Verlauf einer Katastrophe in Echtzeit.

**Datenstruktur:**
```javascript
{
  disasterId: "disaster_2025_001",
  type: "hochwasser" | "sturm" | "schnee" | "mure" | "unfall",
  startTime: timestamp,
  currentPhase: "initial" | "escalation" | "peak" | "resolution" | "completed",

  timeline: [
    {
      timestamp: number,
      phase: string,
      event: string,
      significance: "low" | "medium" | "high" | "critical"
    }
  ],

  activeIncidents: [/* Aktive Einsätze */],
  keyDecisions: [/* Wichtige Entscheidungen */],
  resources: {/* Ressourcen-Status */},
  statistics: {/* Einsatz-Statistiken */},
  patterns: [/* Erkannte Muster */]
}
```

**Funktionen:**
- `initializeDisasterContext({ type, description })` - Startet neuen Context
- `updateDisasterContextFromEinfo({ board, protokoll, aufgaben, roles })` - Update aus EINFO-Daten
- `getDisasterContextSummary({ maxLength })` - Komprimierter Summary für LLM
- `recordLLMSuggestion({ suggestion, accepted })` - Erfasst LLM-Vorschläge
- `finalizeDisasterContext()` - Schließt Context ab

**Automatische Features:**
- **Phase-Erkennung:** Automatische Erkennung von "initial" → "escalation" → "peak" → "resolution" → "completed"
- **Pattern-Erkennung:** Erkennt wiederkehrende Einsatztypen und Muster
- **Statistik-Tracking:** Zählt Einsätze, LLM-Vorschläge, etc.

**Speicherort:** `/server/data/disaster_history/*.json`

---

### 2. LLM Feedback System (`llm_feedback.js`)

**Zweck:** Sammelt Bewertungen von LLM-Antworten und lernt aus positiven Erfahrungen.

**Feedback-Struktur:**
```javascript
{
  feedbackId: "feedback_...",
  timestamp: number,

  // Context
  disasterId: string,
  disasterType: string,
  disasterPhase: string,

  // Interaction
  interactionType: "operations" | "chat" | "suggestion",
  question: string,
  llmResponse: string,
  llmModel: string,

  // Rating
  rating: 1-5,  // 1=sehr schlecht, 5=sehr gut
  helpful: boolean,
  accurate: boolean,
  actionable: boolean,

  // User Feedback
  userId: string,
  userRole: string,
  comment: string,

  // Outcome
  implemented: boolean,
  outcome: string
}
```

**Learned Responses:**
Antworten mit Rating ≥ 4 werden automatisch als "gelernte Antworten" gespeichert:

```javascript
{
  learnedId: "learned_...",
  question: string,
  questionEmbedding: Float32Array,  // Für Similarity-Search
  response: string,
  avgRating: number,
  timesReferenced: number,
  successRate: number,
  tags: string[],
  category: string
}
```

**Funktionen:**
- `saveFeedback({ rating, question, llmResponse, ... })` - Speichert Feedback
- `findSimilarLearnedResponses(question, { topK, minScore })` - Findet ähnliche gelernte Antworten
- `getLearnedResponsesContext(question)` - Generiert Context-String für LLM
- `getFeedbackStatistics()` - Statistiken über alle Feedbacks

**Speicherort:**
- `/server/data/llm_feedback/feedback_*.json` - Einzelne Feedbacks
- `/server/data/llm_feedback/learned_responses.json` - Gelernte Antworten
- `/server/data/llm_feedback/learned_embeddings.json` - Embeddings für Similarity-Search

---

### 3. Erweiterte LLM-Prompts

**Operations-Prompt (`operations_user_prompt.txt`):**
```
ROLLEN: ...
EINSATZSTELLEN: ...
AUFGABEN: ...
PROTOKOLL: ...

═══════════════════════════════════════════════════════════════
KATASTROPHEN-KONTEXT (Verlauf der aktuellen Lage):
═══════════════════════════════════════════════════════════════
{{disasterContext}}

═══════════════════════════════════════════════════════════════
GELERNTE ANTWORTEN (aus positiv bewerteten Erfahrungen):
═══════════════════════════════════════════════════════════════
{{learnedResponses}}

WISSEN: ...
```

**Chat-Prompt (`chat_user_prompt.txt`):**
```
FRAGE: {{question}}

═══════════════════════════════════════════════════════════════
KATASTROPHEN-KONTEXT (Verlauf der aktuellen Lage):
═══════════════════════════════════════════════════════════════
{{disasterContext}}

═══════════════════════════════════════════════════════════════
GELERNTE ANTWORTEN (aus positiv bewerteten Erfahrungen):
═══════════════════════════════════════════════════════════════
{{learnedResponses}}

WISSEN (aus Knowledge-Base): ...
```

---

## 🔌 API-Endpunkte

### Disaster Context

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| POST | `/api/disaster/init` | Initialisiert neuen Disaster Context |
| GET | `/api/disaster/current` | Gibt aktuellen Context zurück |
| GET | `/api/disaster/summary` | Gibt komprimierten Summary zurück |
| GET | `/api/disaster/list` | Listet alle Contexts auf |
| GET | `/api/disaster/:disasterId` | Lädt spezifischen Context |
| POST | `/api/disaster/finalize` | Schließt aktuellen Context ab |
| POST | `/api/disaster/record-suggestion` | Erfasst LLM-Suggestion |

**Beispiel: Context initialisieren**
```bash
curl -X POST http://localhost:3100/api/disaster/init \
  -H "Content-Type: application/json" \
  -d '{
    "type": "hochwasser",
    "description": "Starkregen in Feldkirchen",
    "scenario": "hochwasser_feldkirchen"
  }'
```

**Beispiel: Summary abrufen**
```bash
curl http://localhost:3100/api/disaster/summary
```

### LLM Feedback

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| POST | `/api/feedback` | Speichert Feedback zu LLM-Antwort |
| GET | `/api/feedback/list` | Listet alle Feedbacks auf |
| GET | `/api/feedback/stats` | Gibt Statistiken zurück |
| POST | `/api/feedback/similar` | Findet ähnliche gelernte Antworten |
| POST | `/api/feedback/learned-context` | Generiert Learned Context für LLM |

**Beispiel: Feedback speichern**
```bash
curl -X POST http://localhost:3100/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Wie gehe ich bei Hochwasser vor?",
    "llmResponse": "1. Lage erfassen 2. Evakuierung prüfen 3. ...",
    "rating": 5,
    "helpful": true,
    "accurate": true,
    "actionable": true,
    "userId": "user123",
    "userRole": "S2",
    "implemented": true
  }'
```

**Beispiel: Statistiken abrufen**
```bash
curl http://localhost:3100/api/feedback/stats
```

---

## 🔄 Workflow: Wie funktioniert das System?

### 1. Disaster Context Tracking

```
Simulation startet
    ↓
initializeDisasterContext()
    ↓ (bei jedem Simulationsschritt)
updateDisasterContextFromEinfo({ board, protokoll, ... })
    ↓
- Neue Einsätze → Timeline-Event
- Gelöste Einsätze → Timeline-Event
- Phase-Änderungen erkennen
- Patterns erkennen
    ↓
Context wird in LLM-Prompts eingebunden
    ↓
Simulation endet
    ↓
finalizeDisasterContext()
```

### 2. Feedback & Learning

```
User stellt Frage
    ↓
LLM generiert Antwort (mit Disaster Context + Learned Responses)
    ↓
User bewertet Antwort (Rating 1-5)
    ↓
saveFeedback()
    ↓
Falls Rating ≥ 4 und helpful=true und accurate=true:
    ↓
addToLearnedResponses()
    - Embedding der Frage erstellen
    - In learned_responses.json speichern
    - In learned_embeddings.json speichern
    ↓
Bei zukünftigen Fragen:
    ↓
findSimilarLearnedResponses(question)
    - Cosine-Similarity-Search
    - Top-3 ähnliche Antworten
    ↓
In LLM-Prompt einbinden
```

### 3. LLM Context-Integration

**Operations (Simulation):**
```javascript
// llm_client.js: callLLMForOps()

// 1. Knowledge Context (RAG)
const knowledgeContext = await getKnowledgeContextVector("Stabsarbeit...");

// 2. Disaster Context
const disasterContext = getDisasterContextSummary({ maxLength: 1500 });

// 3. Learned Responses
const learnedResponses = await getLearnedResponsesContext(contextQuery);

// 4. Prompt bauen
const userPrompt = buildUserPrompt({
  ...,
  knowledgeContext,
  disasterContext,
  learnedResponses
});
```

**Chat:**
```javascript
// llm_client.js: callLLMForChat()

// 1. Knowledge Context (RAG)
const knowledgeContext = await getKnowledgeContextVector(question);

// 2. Disaster Context
const disasterContext = getDisasterContextSummary({ maxLength: 1000 });

// 3. Learned Responses
const learnedResponses = await getLearnedResponsesContext(question);

// 4. Prompt bauen
const userPrompt = buildUserPromptChat(
  question,
  knowledgeContext,
  disasterContext,
  learnedResponses
);
```

---

## 💾 Datenstruktur & Speicherorte

```
/home/user/EINFO/
├── server/
│   └── data/
│       ├── disaster_history/       # NEU: Disaster Contexts
│       │   ├── disaster_1703251234567.json
│       │   └── disaster_1703252345678.json
│       │
│       └── llm_feedback/           # NEU: LLM Feedbacks
│           ├── feedback_*.json     # Einzelne Feedbacks
│           ├── learned_responses.json
│           └── learned_embeddings.json
│
└── chatbot/
    └── server/
        ├── disaster_context.js     # NEU: Disaster Context System
        ├── llm_feedback.js         # NEU: Feedback & Learning System
        ├── llm_client.js           # ERWEITERT: Context-Integration
        ├── prompts.js              # ERWEITERT: Neue Parameter
        └── prompt_templates/
            ├── operations_user_prompt.txt  # ERWEITERT
            └── chat_user_prompt.txt        # ERWEITERT
```

---

## 🎨 Frontend-Integration (Vorschlag)

### 1. Feedback-UI für LLM-Antworten

```javascript
// Nach jeder LLM-Antwort anzeigen:
<div class="llm-feedback">
  <p>War diese Antwort hilfreich?</p>

  <div class="rating">
    <button onclick="rateLLM(1)">⭐</button>
    <button onclick="rateLLM(2)">⭐⭐</button>
    <button onclick="rateLLM(3)">⭐⭐⭐</button>
    <button onclick="rateLLM(4)">⭐⭐⭐⭐</button>
    <button onclick="rateLLM(5)">⭐⭐⭐⭐⭐</button>
  </div>

  <label>
    <input type="checkbox" id="helpful"> Hilfreich
  </label>
  <label>
    <input type="checkbox" id="accurate"> Korrekt
  </label>
  <label>
    <input type="checkbox" id="actionable"> Umsetzbar
  </label>

  <textarea placeholder="Kommentar (optional)"></textarea>

  <button onclick="submitFeedback()">Bewertung absenden</button>
</div>

<script>
async function submitFeedback() {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: lastQuestion,
      llmResponse: lastResponse,
      rating: selectedRating,
      helpful: document.getElementById('helpful').checked,
      accurate: document.getElementById('accurate').checked,
      actionable: document.getElementById('actionable').checked,
      userId: currentUser.id,
      userRole: currentUser.role
    })
  });

  if (response.ok) {
    alert('Feedback gespeichert - Danke!');
  }
}
</script>
```

### 2. Disaster Context Dashboard

```javascript
// Zeige aktuellen Katastrophen-Status
<div class="disaster-dashboard">
  <h3>Katastrophen-Übersicht</h3>

  <div class="disaster-header">
    <span class="disaster-type">Hochwasser</span>
    <span class="disaster-phase">Escalation</span>
    <span class="disaster-duration">2:34:12</span>
  </div>

  <div class="disaster-stats">
    <div class="stat">
      <label>Aktive Einsätze</label>
      <value>12</value>
    </div>
    <div class="stat">
      <label>Abgeschlossen</label>
      <value>5</value>
    </div>
    <div class="stat">
      <label>LLM-Vorschläge</label>
      <value>23 (18 akzeptiert)</value>
    </div>
  </div>

  <div class="disaster-timeline">
    <h4>Jüngste Ereignisse</h4>
    <ul>
      <li>[14:23] Neuer Einsatz: Überflutung - Hauptstraße</li>
      <li>[14:18] Einsatz abgeschlossen: Evakuierung - Schulgebäude</li>
      <li>[14:12] Phase-Wechsel: initial → escalation</li>
    </ul>
  </div>
</div>

<script>
// Live-Updates via SSE
const eventSource = new EventSource('/api/events');

eventSource.addEventListener('disaster_updated', (e) => {
  const data = JSON.parse(e.data);
  updateDisasterDashboard(data);
});
</script>
```

---

## 📊 Statistiken & Analytics

### Feedback-Statistiken abrufen

```javascript
const response = await fetch('/api/feedback/stats');
const stats = await response.json();

console.log(stats);
// {
//   total: 127,
//   avgRating: 4.2,
//   byRating: { 1: 3, 2: 5, 3: 18, 4: 45, 5: 56 },
//   helpfulCount: 98,
//   accurateCount: 102,
//   implementedCount: 67,
//   byCategory: {
//     "procedure": 45,
//     "recommendation": 38,
//     "definition": 22,
//     ...
//   },
//   byDisasterType: {
//     "hochwasser": 78,
//     "sturm": 32,
//     ...
//   }
// }
```

---

## 🧪 Testing

### 1. Test Disaster Context

```bash
# Context initialisieren
curl -X POST http://localhost:3100/api/disaster/init \
  -H "Content-Type: application/json" \
  -d '{"type": "hochwasser", "description": "Test"}'

# Summary abrufen
curl http://localhost:3100/api/disaster/summary

# Aktuellen Context abrufen
curl http://localhost:3100/api/disaster/current
```

### 2. Test Feedback System

```bash
# Feedback speichern
curl -X POST http://localhost:3100/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Test-Frage",
    "llmResponse": "Test-Antwort",
    "rating": 5,
    "helpful": true,
    "accurate": true
  }'

# Statistiken abrufen
curl http://localhost:3100/api/feedback/stats

# Ähnliche Antworten finden
curl -X POST http://localhost:3100/api/feedback/similar \
  -H "Content-Type: application/json" \
  -d '{"question": "Wie gehe ich bei Hochwasser vor?"}'
```

---

## 🔧 Konfiguration

Keine zusätzliche Konfiguration notwendig - das System nutzt die bestehende Config:

```javascript
// chatbot/server/config.js
const CONFIG = {
  // RAG-Einstellungen (auch für Learned Responses)
  rag: {
    dim: 1024,              // Embedding-Dimension
    topK: 5,                // Top-K für Similarity-Search
    scoreThreshold: 0.35    // Min. Similarity-Score
  },

  // Ollama-URL für Embeddings
  llmBaseUrl: "http://127.0.0.1:11434",
  llmEmbedModel: "mxbai-embed-large"
};
```

---

## 🚀 Nächste Schritte / Erweiterungen

### Kurzfristig
- [ ] **Frontend-UI für Feedback-Rating** implementieren
- [ ] **Disaster Context Dashboard** im Frontend
- [ ] **Testing** mit realen Szenarien

### Mittelfristig
- [ ] **Pattern-basierte Vorschläge:** "Bei ähnlichen Lagen wurde X gemacht"
- [ ] **Auto-Learning:** Automatische Feedback-Generierung basierend auf Outcomes
- [ ] **Export/Import:** Gelernte Antworten zwischen Instanzen teilen

### Langfristig
- [ ] **ML-basierte Pattern-Recognition:** Vorhersage von Eskalationen
- [ ] **Multi-Disaster-Learning:** Lernen über Katastrophentypen hinweg
- [ ] **Benchmarking:** Vergleich von LLM-Performance über Zeit

---

## 📚 Referenzen

- **Disaster Context:** `/chatbot/server/disaster_context.js`
- **LLM Feedback:** `/chatbot/server/llm_feedback.js`
- **LLM Client:** `/chatbot/server/llm_client.js`
- **Prompts:** `/chatbot/server/prompts.js`
- **API-Endpunkte:** `/chatbot/server/index.js` (Zeilen 454-679)

---

## ✅ Status

**Implementiert:** 2025-12-22
**Version:** 1.0
**Getestet:** ⚠️ Noch nicht vollständig getestet
**Dokumentiert:** ✅ Vollständig

---

*Für Fragen oder Probleme: Siehe `/home/user/EINFO/PROJEKT_STRUKTUR.md`*
