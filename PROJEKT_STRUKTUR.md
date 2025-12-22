# EINFO - Projekt-Struktur & Konfiguration

**Letzte Aktualisierung:** 2025-12-22
**Status:** ✅ Knowledge-System vollständig indiziert (22/22 Dateien)

---

## 📁 Übersicht der Hauptordner

```
EINFO/
├── server/              # Haupt-Backend (Express, Websockets)
├── client/              # Frontend (React/Vue)
├── chatbot/             # KI-Chatbot System (Llama 3.1)
├── feldkirchen-adressen/
└── script/              # Utilities
```

---

## 🤖 CHATBOT - Detaillierte Struktur

Das Chatbot-System ist ein eigenständiges Modul mit eigener Package.json.

### Hauptverzeichnisse

```
chatbot/
├── server/                    # Backend-Logik
│   ├── config.js              # ⚙️ HAUPT-KONFIGURATION
│   ├── index.js               # Express-Server, API-Endpunkte
│   ├── sim_loop.js            # Simulationsschleife
│   ├── llm_client.js          # LLM-Kommunikation (Ollama)
│   ├── prompts.js             # Prompt-Management
│   ├── logger.js              # Logging-System
│   ├── memory_manager.js      # Langzeit-Memory (RAG)
│   ├── einfo_io.js            # Daten von/zu EINFO-Server
│   ├── field_mapper.js        # Token-Optimierung (kurze Feldnamen)
│   ├── simulation_helpers.js  # Rollen-Logik, Validierung
│   ├── json_sanitizer.js      # LLM-Output Cleanup
│   │
│   ├── rag/                   # 📚 Knowledge-System (RAG)
│   │   ├── rag_vector.js      # Vector-Suche (Cosine-Similarity)
│   │   ├── index_builder.js   # 🔨 Index-Build-Script
│   │   ├── embedding.js       # Ollama Embedding-API
│   │   └── chunk.js           # Text-Chunking
│   │
│   ├── prompt_templates/      # 📝 Prompt-Templates (TXT)
│   │   ├── start_system_prompt.txt
│   │   ├── operations_system_prompt.txt
│   │   ├── operations_user_prompt.txt
│   │   └── chat_system_prompt.txt
│   │
│   └── scenarios/             # 🎭 Übungs-Szenarien
│       ├── hochwasser_basic.json
│       ├── hochwasser_feldkirchen.json
│       └── sturm_bezirk.json
│
├── knowledge/                 # 📚 KNOWLEDGE-DATEIEN (22 Dateien)
│   ├── e31.pdf               # Stabsarbeit-Richtlinie (948 KB)
│   ├── richtlinie.pdf        # Feuerwehr-Richtlinie (1.7 MB)
│   ├── E5_web.pdf            # Gefahren-EK (1.3 MB)
│   ├── E6_compressed_web.pdf # Anforderungen (50 KB)
│   │
│   ├── hochwasser.txt        # Hochwasser-Wissen
│   ├── schnee.txt            # Schnee-Wissen
│   ├── sturm.txt             # Sturm-Wissen
│   ├── mure.txt              # Muren-Wissen
│   ├── unfall.txt            # Unfall-Wissen
│   │
│   ├── rag_flood_hazards.json    # RAG für Hochwasser
│   ├── rag_snow_hazards.json     # RAG für Schnee
│   ├── rag_storm_hazards.json    # RAG für Sturm
│   ├── rag_mudflow_hazards.json  # RAG für Muren
│   ├── rag_accident_hazards.json # RAG für Unfälle
│   │
│   ├── rollen_Einsatzleiter.json    # Rolle: EL
│   ├── rollen_LtStb.json            # Rolle: LtStb
│   ├── rollen_S1_Personal.json      # Rolle: S1
│   ├── rollen_S2_Lage.json          # Rolle: S2
│   ├── rollen_S3_Einsatz.json       # Rolle: S3
│   ├── rollen_S4_Versorgung.json    # Rolle: S4
│   ├── rollen_S5_Kommunikation.json # Rolle: S5
│   └── rollen_S6_IT_Meldestelle.json # Rolle: S6
│
├── knowledge_index/           # 🗂️ GENERIERTER INDEX (nicht editieren!)
│   ├── meta.json              # Chunk-Metadaten (alle 22 Dateien)
│   ├── embeddings.json        # Vektoren (ca. 320 Chunks)
│   └── index.json             # Legacy (leer)
│
├── logs/                      # 📊 LOG-DATEIEN
│   ├── chatbot.log            # Allgemeine Logs
│   ├── LLM.log                # LLM-Requests/-Responses
│   └── ops_verworfen.log      # Verworfene Operations
│
├── ingest/                    # 🔧 Index-Build-Tools (Legacy)
│   └── ingest_all.js          # Alter Index-Builder
│
├── client/                    # 🖥️ Web-GUI (Dashboard)
│   ├── dashboard.html
│   ├── app.js
│   └── styles.css
│
├── package.json               # NPM-Konfiguration
└── node_modules/              # Dependencies
```

---

## ⚙️ KONFIGURATION: chatbot/server/config.js

**Die zentrale Konfigurationsdatei für das gesamte Chatbot-System!**

### 1️⃣ Verzeichnis-Pfade

```javascript
const base = {
  // Pfad zu EINFO-Server Daten (relativ zu chatbot/server/)
  dataDir: "../../server/data",

  // Knowledge & Index (relativ zu chatbot/server/rag/)
  knowledgeDir: "../../knowledge",
  knowledgeIndexDir: "../../knowledge_index",

  // ...
};
```

**Wichtig:**
- ✅ **RICHTIG:** `"../../knowledge"` (von server/rag/ aus 2 Ebenen hoch)
- ❌ **FALSCH:** `"../knowledge"` (zu wenig), `"../../chatbot/knowledge"` (zu viel)

**Warum diese Pfade?**
- Der Index-Builder läuft von `chatbot/server/rag/index_builder.js`
- `__dirname` ist `/home/user/EINFO/chatbot/server/rag`
- `path.resolve(__dirname, "../../knowledge")` → `/home/user/EINFO/chatbot/knowledge` ✅

### 2️⃣ LLM-Konfiguration

```javascript
const base = {
  // Ollama-Server URL
  llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",

  // Models
  llmChatModel: process.env.LLM_CHAT_MODEL || "llama3.1:8b",
  llmEmbedModel: process.env.LLM_EMBED_MODEL || "mxbai-embed-large",

  // Timeouts
  llmChatTimeoutMs: 60000,      // 1 Min für Chat
  llmSimTimeoutMs: 300000,      // 5 Min für Simulation
  llmEmbedTimeoutMs: 30000,     // 30 Sek für Embeddings

  // Context-Window & Batch-Size
  llmNumCtx: 8192,              // Context-Tokens
  llmNumBatch: 512,             // Batch-Size

  // ...
};
```

**Umgebungsvariablen (optional):**
```bash
# Custom Ollama-URL
export LLM_BASE_URL=http://192.168.1.100:11434

# Anderes Model
export LLM_CHAT_MODEL=mistral:7b

# Debug-Modus
export CHATBOT_DEBUG=1
```

### 3️⃣ RAG-Einstellungen

```javascript
const base = {
  rag: {
    dim: 1024,                     // Embedding-Dimension (mxbai-embed-large)
    indexMaxElements: 50000,       // Max. Chunks im Index
    topK: 5,                       // Top-K Chunks für Context
    maxContextChars: 2500,         // Max. Zeichen für LLM-Prompt
    scoreThreshold: 0.35           // Min. Similarity-Score
  },
  // ...
};
```

**Was bedeutet das?**
- `dim: 1024` → mxbai-embed-large erzeugt 1024-dimensionale Vektoren
- `topK: 5` → Es werden die 5 ähnlichsten Chunks gesucht
- `scoreThreshold: 0.35` → Nur Chunks mit Similarity > 0.35 werden verwendet

**Tuning-Tipps:**
- **Mehr Context benötigt?** → `topK: 8`, `maxContextChars: 4000`
- **Schneller, weniger Kontext?** → `topK: 3`, `maxContextChars: 1500`
- **Strengere Relevanz?** → `scoreThreshold: 0.45`

### 4️⃣ Prompt-Limits

```javascript
const base = {
  prompt: {
    maxBoardItems: 25,         // Max. Einsatzstellen im Prompt
    maxAufgabenItems: 50,      // Max. Aufgaben im Prompt
    maxProtokollItems: 30      // Max. Protokolleinträge im Prompt
  },
  // ...
};
```

**Zweck:** Token-Limit einhalten (8192 Context-Tokens)

**Bei Token-Problemen:**
```javascript
// Reduziere Limits:
maxBoardItems: 15,
maxAufgabenItems: 30,
maxProtokollItems: 20
```

### 5️⃣ Memory-RAG

```javascript
const base = {
  memoryRag: {
    longScenarioMinItems: 100,        // Min. Einträge für "lange Übung"
    maxAgeMinutes: 720,               // Max. Alter: 12 Stunden
    recencyHalfLifeMinutes: 120,      // Halbwertszeit: 2 Stunden
    longScenarioTopK: 12              // Top-K für lange Übungen
  },
  // ...
};
```

**Zweck:** Chatbot merkt sich wichtige Entscheidungen über die Zeit

### 6️⃣ Profile (optional)

```javascript
const profiles = {
  default: {
    // Standard-Profil (base-Werte)
  },

  llama_8b_gpu: {
    // Optimiert für Llama 3.1 8B auf GPU
    llmChatModel: "llama3.1:8b",
    defaultTemperature: 0.25,
    rag: { topK: 5, maxContextChars: 2500 }
  },

  mixtral_gpu: {
    // Legacy: Mixtral
    llmChatModel: "mixtral_einfo",
    rag: { dim: 768, topK: 8 }
  }
};
```

**Verwendung:**
```bash
# Profil aktivieren
export CHATBOT_PROFILE=llama_8b_gpu

# Standard-Profil
unset CHATBOT_PROFILE
```

---

## 📂 SERVER (EINFO-Haupt-Backend)

```
server/
├── index.js              # Express-Server
├── package.json          # Dependencies
│
├── routes/               # API-Routen
│   └── data/             # Datei-basierte Routes
│
├── data/                 # 🗄️ DATENBANK (JSON-Dateien)
│   ├── board.json        # Einsatzstellen-Board
│   ├── protocol.json     # Protokoll
│   ├── roles.json        # Aktive Rollen
│   │
│   ├── Aufg_board_S2.json  # S2-Aufgaben
│   ├── Aufg_board_S3.json  # S3-Aufgaben
│   │
│   ├── scenario_config.json  # Übungs-Konfiguration
│   ├── group_locations.json  # Feuerwehr-Standorte
│   │
│   ├── conf/             # Konfigurationen
│   │   ├── vehicles.json      # Fahrzeug-Definitionen
│   │   ├── types.json         # Einsatztypen
│   │   └── ...
│   │
│   ├── initial/          # Initial-State (Reset)
│   └── user/             # User-Management
│
└── utils/                # Helper-Funktionen
```

### Wichtige Daten-Dateien

| Datei | Zweck | Geändert von |
|-------|-------|--------------|
| `board.json` | Einsatzstellen (Kanban) | Frontend + Chatbot |
| `protocol.json` | Protokoll-Einträge | Meldestelle + Chatbot |
| `roles.json` | Aktive/Fehlende Rollen | Frontend + Chatbot |
| `Aufg_board_S2.json` | S2-Aufgaben | S2 + Chatbot |
| `scenario_config.json` | Übungs-Setup | Admin |

**Datenaustausch Chatbot ↔ Server:**

```javascript
// chatbot/server/einfo_io.js
export async function readEinfoInputs() {
  const dataDir = path.resolve(__dirname, CONFIG.dataDir);

  // Liest von server/data/
  const board = await readJson(path.join(dataDir, "board.json"));
  const roles = await readJson(path.join(dataDir, "roles.json"));
  const protokoll = await readJson(path.join(dataDir, "protocol.json"));
  // ...

  return { board, roles, protokoll, ... };
}
```

**Pfade:**
- Chatbot liegt in: `/home/user/EINFO/chatbot/`
- Server-Daten: `/home/user/EINFO/server/data/`
- Config sagt: `dataDir: "../../server/data"` (relativ zu `chatbot/server/`)
- Resultat: `/home/user/EINFO/chatbot/server/../../server/data` = `/home/user/EINFO/server/data` ✅

---

## 📝 PROMPT-TEMPLATES

**Verzeichnis:** `chatbot/server/prompt_templates/`

### Template-Dateien

| Datei | Verwendung |
|-------|------------|
| `start_system_prompt.txt` | Erster Simulationsschritt (Szenario-Initialisierung) |
| `operations_system_prompt.txt` | Normale Simulation (Rollen-Logik, JSON-Schema) |
| `operations_user_prompt.txt` | User-Prompt für Operations (mit Platzhaltern) |
| `chat_system_prompt.txt` | QA-Chat (User-Fragen) |
| `chat_user_prompt.txt` | User-Prompt für Chat |

### Template-Syntax

**Platzhalter:**
```
{{rolesPart}}          → JSON mit active/missing roles
{{compressedBoard}}    → Komprimiertes Board (JSON)
{{knowledgeContext}}   → RAG-Chunks
{{taskSection}}        → Spezielle Anweisungen
{{responseRequests}}   → Meldungen die Antwort brauchen
```

**Beispiel** (`operations_user_prompt.txt`):
```
Aktuelle Rollen:
{{rolesPart}}

Einsatzstellen (kompakt):
{{compressedBoard}}

Knowledge-Kontext:
{{knowledgeContext}}

{{taskSection}}

{{responseRequests}}
```

**Laden & Füllen** (`prompts.js`):
```javascript
function loadPromptTemplate(fileName) {
  const fullPath = path.join(TEMPLATE_DIR, fileName);
  return fs.readFileSync(fullPath, "utf8").trim();
}

function fillTemplate(template, replacements) {
  return Object.entries(replacements).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{{${key}}}`, value);
  }, template);
}
```

---

## 🔧 WICHTIGE BEFEHLE & SCRIPTS

### Chatbot starten

```bash
cd /home/user/EINFO/chatbot

# Installiere Dependencies (einmalig)
npm install

# Starte Chatbot-Server
npm start
# → http://localhost:3100
```

### Knowledge-Index aufbauen

```bash
cd /home/user/EINFO/chatbot

# Vollständiger Rebuild (5-10 Min)
npm run build-index

# Überprüfe Status
ls -lh knowledge_index/
# Sollte zeigen:
# - meta.json (~50 KB, 320 Chunks)
# - embeddings.json (~80 MB, Vektoren)
```

### Chatbot Worker (Simulation)

**Separate Prozess** (wird im Hintergrund gestartet):

```bash
cd /home/user/EINFO/server

# Startet Worker, der alle 30 Sek einen Schritt macht
node chatbot_worker.js
```

**Was macht der Worker?**
1. Prüft `server/data/roles.json` auf fehlende Rollen
2. Wenn Rollen fehlen → Ruft `/api/sim/step` auf
3. LLM generiert Operations (board, aufgaben, protokoll)
4. Worker schreibt Changes zurück in `server/data/`

**Konfiguration** (`server/chatbot_worker.js`):
```javascript
const CHATBOT_STEP_URL = "http://127.0.0.1:3100/api/sim/step";
const WORKER_INTERVAL_MS = 30000;  // 30 Sekunden
```

---

## 🗂️ KNOWLEDGE-DATEIEN: Format & Struktur

### Unterstützte Formate

| Format | Extension | Verwendung |
|--------|-----------|------------|
| PDF | `.pdf` | Richtlinien, Handbücher |
| Text | `.txt` | Fach-Wissen (Hochwasser, Schnee, etc.) |
| JSON | `.json` | Strukturierte Daten (Rollen, RAG) |

### Knowledge-Typen

#### 1. PDFs (Richtlinien)

```
e31.pdf                  → Info E-31: Stabsarbeit im Feuerwehrdienst
richtlinie.pdf           → Führungsrichtlinien
E5_web.pdf               → Hochwasser-Fachunterlagen
E6_compressed_web.pdf    → Anforderungen im Ereignisfall
```

**Zweck:** Basis-Wissen für Stabsarbeit & Einsatzleitung

#### 2. TXT (Fachwissen)

**Beispiel** (`hochwasser.txt`):
```
Hochwasser - Einsatztaktik und Maßnahmen

Gefährdungsbeurteilung:
- Wasserstand und Fließgeschwindigkeit prüfen
- Gefahr für Personen und Gebäude bewerten
- Zufahrtswege und Rückzugsmöglichkeiten sichern

Maßnahmen:
1. Absperren und Warnen
2. Personen evakuieren
3. Sandsäcke und Pumpen einsetzen
...
```

**Zweck:** Spezifisches Fach-Wissen für Chatbot-Antworten

#### 3. JSON (Strukturierte Daten)

**A) Rollen-Definitionen** (`rollen_S2_Lage.json`):
```json
{
  "rolle": "S2 - Lage",
  "kuerzel": "S2",
  "aufgaben": [
    "Lageerfassung und Lagebild erstellen",
    "Lagekarten führen",
    "Lagebeurteilung durchführen",
    "Lageinformationen sammeln und auswerten"
  ],
  "befugnisse": [
    "Anordnung von Erkundungsmaßnahmen",
    "Anforderung von Lageinformationen"
  ],
  "schnittstellen": ["EL", "S3", "S6"]
}
```

**B) RAG-Hazards** (`rag_flood_hazards.json`):
```json
{
  "hazard_type": "flood",
  "scenarios": [
    {
      "id": "flood_01",
      "severity": "high",
      "description": "Starkes Hochwasser mit Überflutungsgefahr",
      "indicators": [
        "Wasserstand über 3m",
        "Fließgeschwindigkeit > 2m/s"
      ],
      "actions": [
        "Sofortige Evakuierung",
        "Absperren der Gefahrenzone"
      ]
    }
  ]
}
```

**Zweck:** Strukturierte Daten für LLM-Reasoning

---

## 🔨 KNOWLEDGE-INDEX: Wie funktioniert das?

### Workflow

```
1. Knowledge-Dateien → 2. Text-Extraktion → 3. Chunking → 4. Embeddings → 5. Index
   (22 Dateien)         (PDF→Text)          (~1000 Zeichen)   (Ollama)      (meta.json)
```

### Schritt-für-Schritt

**1. Text-Extraktion** (`index_builder.js`):
```javascript
async function extractText(file) {
  if (file.ext === ".pdf") {
    const buf = await fsPromises.readFile(file.path);
    const data = await pdfParse(buf);  // pdf-parse library
    return data.text || "";
  }
  if (file.ext === ".json") {
    // JSON → Pretty-printed String
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  }
  // TXT → Direkt lesen
  return await fsPromises.readFile(file.path, "utf8");
}
```

**2. Chunking** (`chunk.js`):
```javascript
export function chunkText(text, maxChunkSize = 1000, overlap = 200) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += maxChunkSize - overlap) {
    const chunk = words.slice(i, i + maxChunkSize).join(" ");
    chunks.push(chunk);
  }

  return chunks;
}
```

**Warum Overlap?**
- Verhindert, dass wichtige Infos "zwischen" Chunks verloren gehen
- Beispiel: "...Lagebeurteilung durchführen. [CHUNK-GRENZE] S2 erstellt Lagekarten..."
  → Mit Overlap: Beide Chunks enthalten "Lagebeurteilung"

**3. Embeddings** (`embedding.js`):
```javascript
export async function embedText(text) {
  const response = await fetch(`${CONFIG.llmBaseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CONFIG.llmEmbedModel,  // mxbai-embed-large
      prompt: text
    })
  });

  const data = await response.json();
  return new Float32Array(data.embedding);  // [1024 Zahlen]
}
```

**Was sind Embeddings?**
- Vektoren, die die semantische Bedeutung eines Textes repräsentieren
- Ähnliche Texte haben ähnliche Vektoren
- Beispiel:
  ```
  "Hochwasser bekämpfen" → [0.12, -0.45, 0.78, ...]
  "Überflutung eindämmen" → [0.15, -0.42, 0.80, ...]  (ähnlich!)
  "Fahrzeug reparieren"  → [-0.23, 0.67, -0.11, ...]  (anders!)
  ```

**4. Index speichern** (`index_builder.js`):
```javascript
// meta.json
await fsPromises.writeFile(metaPath, JSON.stringify({
  dim: 1024,
  files: [
    { name: "e31.pdf", chunks: 107 },
    { name: "hochwasser.txt", chunks: 7 },
    // ...
  ],
  chunks: [
    { id: 0, fileName: "e31.pdf", text: "..." },
    { id: 1, fileName: "e31.pdf", text: "..." },
    // ... 320 Chunks
  ]
}, null, 2));

// embeddings.json
await fsPromises.writeFile(embeddingsPath, JSON.stringify({
  dim: 1024,
  vectors: [
    [0.12, -0.45, ...],  // 1024 Zahlen
    [0.23, 0.56, ...],
    // ... 320 Vektoren
  ]
}));
```

---

## 🔍 RAG-SUCHE: Wie funktioniert die Knowledge-Retrieval?

### Ablauf bei User-Frage

```
User: "Was sind die Aufgaben von S2?"
   ↓
1. Query-Embedding erstellen
   → [0.34, -0.12, 0.67, ...] (1024-dim)
   ↓
2. Similarity-Search im Index
   → Top-5 ähnlichste Chunks finden
   ↓
3. Chunks als Context an LLM
   → "Basierend auf: [rollen_S2_Lage.json|0.89] ..."
   ↓
4. LLM generiert Antwort
   → "S2 ist zuständig für: 1. Lageerfassung..."
```

### Code (`rag_vector.js`)

```javascript
export async function getKnowledgeContextVector(query) {
  // 1. Query embedden
  const queryEmbedding = await embedText(query);

  // 2. Similarity berechnen für alle Chunks
  const results = [];
  for (let i = 0; i < vectors.length; i++) {
    const score = cosineSimilarity(queryEmbedding, vectors[i]);

    if (score >= CONFIG.rag.scoreThreshold) {  // >= 0.35
      results.push({
        idx: i,
        score: score,
        text: meta.chunks[i].text,
        fileName: meta.chunks[i].fileName
      });
    }
  }

  // 3. Top-K auswählen (beste 5)
  results.sort((a, b) => b.score - a.score);
  const topK = results.slice(0, CONFIG.rag.topK);

  // 4. Context-String erstellen
  let context = "";
  for (const r of topK) {
    context += `[${r.fileName}|${r.score.toFixed(2)}]\n`;
    context += r.text + "\n\n";
  }

  return context;
}
```

### Cosine-Similarity

```javascript
function cosineSimilarity(a, b) {
  let dot = 0;   // Skalarprodukt
  let na = 0;    // Norm von a
  let nb = 0;    // Norm von b

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb));
  // Ergebnis: 0.0 (komplett unterschiedlich) bis 1.0 (identisch)
}
```

**Warum Cosine?**
- Misst den Winkel zwischen zwei Vektoren
- Unabhängig von der Länge (nur Richtung zählt)
- Perfekt für Embeddings!

---

## 🎯 KONFIGURATION FÜR VERSCHIEDENE USE-CASES

### Use Case 1: Mehr Knowledge-Context

**Problem:** Chatbot findet relevante Infos nicht

**Lösung** (`config.js`):
```javascript
rag: {
  topK: 8,                    // War: 5
  maxContextChars: 4000,      // War: 2500
  scoreThreshold: 0.30        // War: 0.35 (weniger streng)
}
```

### Use Case 2: Schnellere Antworten

**Problem:** LLM braucht zu lange

**Lösung:**
```javascript
rag: {
  topK: 3,                    // Weniger Context
  maxContextChars: 1500       // Kürzer
},

llmSimTimeoutMs: 120000       // 2 Min statt 5 Min
```

### Use Case 3: Andere Models

**Problem:** Llama 3.1 zu langsam, will Mistral verwenden

**Lösung:**
```javascript
llmChatModel: "mistral:7b",
llmEmbedModel: "nomic-embed-text",

rag: {
  dim: 768                    // nomic = 768-dim, nicht 1024!
}
```

**⚠️ WICHTIG:** Nach Model-Wechsel Index neu bauen!
```bash
npm run build-index
```

### Use Case 4: Externe Ollama-Server

**Problem:** Ollama läuft auf anderem Server

**Lösung:**
```bash
export LLM_BASE_URL=http://192.168.1.50:11434
npm start
```

Oder direkt in `config.js`:
```javascript
llmBaseUrl: "http://192.168.1.50:11434",
```

---

## 🔒 WICHTIGE DATEIEN (NICHT LÖSCHEN!)

### Kritische Dateien

| Datei/Ordner | Zweck | Bei Verlust |
|--------------|-------|-------------|
| `chatbot/knowledge/` | Source of Truth | Knowledge fehlt! |
| `chatbot/knowledge_index/meta.json` | Chunk-Mapping | Index neu bauen |
| `chatbot/knowledge_index/embeddings.json` | Vektoren | Index neu bauen |
| `chatbot/server/config.js` | Konfiguration | System funktioniert nicht |
| `chatbot/server/prompt_templates/` | Prompts | LLM generiert Müll |
| `server/data/` | Datenbank | Alle Daten weg! |

### Kann regeneriert werden

| Datei/Ordner | Regenerieren mit |
|--------------|------------------|
| `chatbot/knowledge_index/` | `npm run build-index` |
| `chatbot/logs/` | Starte Server neu |
| `chatbot/node_modules/` | `npm install` |

---

## 📊 TYPISCHE DATEIGRÖSSEN

```
chatbot/knowledge/
  e31.pdf                      948 KB
  richtlinie.pdf              1700 KB
  E5_web.pdf                  1280 KB
  E6_compressed_web.pdf         50 KB
  *.txt                      2-6 KB je
  *.json                    1-24 KB je

chatbot/knowledge_index/
  meta.json                     50 KB  (320 Chunks)
  embeddings.json            80000 KB  (320 × 1024 × 4 bytes)
  index.json                     1 KB  (leer, legacy)

chatbot/logs/
  chatbot.log                 5-50 KB pro Tag
  LLM.log                   100-500 KB pro Tag
```

---

## ❓ FAQ: Konfiguration & Troubleshooting

### Q: Wo stelle ich die Ollama-URL ein?

**A:** `chatbot/server/config.js`, Zeile 17:
```javascript
llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",
```

Oder als Umgebungsvariable:
```bash
export LLM_BASE_URL=http://192.168.1.50:11434
```

### Q: Wie ändere ich das LLM-Model?

**A:** `config.js`, Zeile 20:
```javascript
llmChatModel: "llama3.1:8b",  // Ändere hier
```

Dann Model laden:
```bash
ollama pull <model-name>
```

### Q: Knowledge-Dateien hinzufügen - was muss ich tun?

**A:**
1. Datei in `chatbot/knowledge/` legen (.pdf, .txt, .json)
2. Index neu bauen: `npm run build-index`
3. Fertig!

### Q: Index-Build schlägt fehl mit "fetch failed"

**A:** Ollama läuft nicht!
```bash
# Check
curl http://localhost:11434/api/tags

# Start
ollama serve
```

### Q: Chatbot findet bestimmte Infos nicht

**A:** Mehrere Möglichkeiten:
1. **File nicht im Index?** → Check `knowledge_index/meta.json`
2. **Similarity zu niedrig?** → `scoreThreshold` reduzieren (0.30)
3. **Zu wenig Context?** → `topK` erhöhen (8)

### Q: LLM antwortet zu langsam

**A:**
1. **Kleineres Model:** `llama3.1:8b` → `mistral:7b`
2. **Weniger Context:** `topK: 3`, `maxContextChars: 1500`
3. **GPU nutzen:** Ollama mit CUDA/Metal starten

### Q: Wo finde ich die Logs?

**A:**
- Chatbot: `chatbot/logs/chatbot.log`
- LLM-Calls: `chatbot/logs/LLM.log`
- Verworfene Ops: `chatbot/logs/ops_verworfen.log`

### Q: Config-Änderung wirkt nicht

**A:** Server neu starten!
```bash
# Ctrl+C zum Stoppen
npm start  # Neu starten
```

### Q: Kann ich mehrere Chatbot-Instanzen laufen lassen?

**A:** Ja, aber Port ändern:
```bash
export CHATBOT_PORT=3101
npm start
```

---

## 🎓 LERNRESSOURCEN

### Understanding RAG

- **Was ist RAG?** Retrieval-Augmented Generation = LLM + Knowledge-Suche
- **Warum Embeddings?** Semantische Suche statt Keyword-Matching
- **Chunking?** Lange Texte in verdaubare Happen teilen

### Understanding Prompts

- **System-Prompt:** "Du bist..." (Rolle definieren)
- **User-Prompt:** Konkrete Aufgabe + Daten
- **Templates:** Wiederverwendbare Prompt-Bausteine

### Ollama

- **Docs:** https://ollama.com/library
- **Models:** https://ollama.com/library (llama3.1, mistral, etc.)
- **API:** https://github.com/ollama/ollama/blob/main/docs/api.md

---

## 🚀 QUICK-START CHECKLISTE

### Ersteinrichtung

- [ ] Node.js 18+ installiert
- [ ] Ollama installiert & gestartet (`ollama serve`)
- [ ] Models geladen:
  ```bash
  ollama pull llama3.1:8b
  ollama pull mxbai-embed-large
  ```
- [ ] Chatbot-Dependencies:
  ```bash
  cd /home/user/EINFO/chatbot
  npm install
  ```
- [ ] Knowledge-Index bauen:
  ```bash
  npm run build-index
  ```
- [ ] Chatbot starten:
  ```bash
  npm start
  ```
- [ ] Test:
  ```bash
  curl http://localhost:3100/api/admin/knowledge-status
  ```

### Bei Problemen

1. **Logs prüfen:** `chatbot/logs/chatbot.log`
2. **Ollama läuft?** `curl http://localhost:11434/api/tags`
3. **Index vollständig?** `cat chatbot/knowledge_index/meta.json | grep chunks`
4. **Config korrekt?** `chatbot/server/config.js` Zeile 13-14
5. **Debug-Modus:** `CHATBOT_DEBUG=1 npm start`

---

## 📞 SUPPORT & WEITERFÜHRENDE DOCS

- **Haupt-Testbericht:** `/home/user/EINFO/CHATBOT_TEST_REPORT.md`
- **Diese Strukturdoku:** `/home/user/EINFO/PROJEKT_STRUKTUR.md`
- **Ollama Docs:** https://github.com/ollama/ollama
- **LLM Prompting:** https://www.promptingguide.ai/

**Bei Fragen oder Problemen:**
1. Logs prüfen (`chatbot/logs/`)
2. Debug-Modus aktivieren (`CHATBOT_DEBUG=1`)
3. GitHub Issues: https://github.com/IVOBLA/EINFO/issues

---

*Letzte Aktualisierung: 2025-12-22*
*Version: 1.0 - Vollständige Struktur-Dokumentation*
