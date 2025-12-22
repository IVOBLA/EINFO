# EINFO Chatbot - Testbericht & Verbesserungsvorschläge
**Datum:** 2025-12-22
**Status:** ❌ KRITISCHE PROBLEME GEFUNDEN

---

## 1. KRITISCHER BEFUND: Knowledge-System nicht funktionsfähig

### Problem
Der Chatbot antwortet "kein Knowledge vorhanden", obwohl 22 Knowledge-Dateien existieren.

### Root Cause
1. **Embedding-Service (Ollama) läuft nicht**
   - Fehler: `fetch failed` bei http://127.0.0.1:11434/api/embeddings
   - Ohne laufenden Service können keine Embeddings erstellt werden

2. **Knowledge-Index fast leer**
   - Nur 2 von 22 Dateien indiziert: `e31.pdf`, `richtlinie.pdf`
   - 20 Dateien fehlen komplett:
     * hochwasser.txt
     * schnee.txt
     * sturm.txt
     * mure.txt
     * unfall.txt
     * rag_flood_hazards.json
     * rag_storm_hazards.json
     * rag_snow_hazards.json
     * rag_mudflow_hazards.json
     * rag_accident_hazards.json
     * rollen_Einsatzleiter.json
     * rollen_LtStb.json
     * rollen_S1_Personal.json
     * rollen_S2_Lage.json
     * rollen_S3_Einsatz.json
     * rollen_S4_Versorgung.json
     * rollen_S5_Kommunikation.json
     * rollen_S6_IT_Meldestelle.json
     * E5_web.pdf (1.3 MB)
     * E6_compressed_web.pdf (50 KB)

### Auswirkung
**KRITISCH:** Der Chatbot hat nur 9% der verfügbaren Knowledge-Daten und kann daher die meisten Fragen nicht beantworten.

---

## 2. SOFORTMASSNAHMEN (MUST-FIX)

### Priorität 1: Ollama-Service starten

```bash
# Ollama-Service starten (falls installiert)
ollama serve

# In separatem Terminal: Embedding-Model laden
ollama pull mxbai-embed-large

# LLM-Model laden
ollama pull llama3.1:8b
```

**Prüfung:**
```bash
curl http://127.0.0.1:11434/api/tags
```

### Priorität 2: Knowledge-Index neu aufbauen

```bash
cd /home/user/EINFO/chatbot
npm run build-index
```

**Erwartetes Ergebnis:**
- Alle 22 Knowledge-Dateien werden indiziert
- `knowledge_index/meta.json` enthält ~500-1000 Chunks
- `knowledge_index/embeddings.json` enthält entsprechende Vektoren

### Priorität 3: Chatbot-Server starten

```bash
cd /home/user/EINFO/chatbot
npm start
```

**Prüfung:**
```bash
# Test Chat-Endpoint
curl -X POST http://localhost:3100/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Was sind die Aufgaben von S2?"}'
```

---

## 3. SYSTEMARCHITEKTUR-ANALYSE

### ✅ Positive Aspekte

1. **Moderne Vector-RAG-Implementierung**
   - Pure JavaScript ohne native Dependencies
   - Cosine-Similarity mit Loop-Unrolling optimiert
   - Embedding-Cache für Performance

2. **Gute Code-Struktur**
   - Modulare Aufteilung (llm_client, rag_engine, prompts)
   - Konfigurationsmanagement mit Profilen
   - Logging-System (Debug, Info, Error)

3. **Umfassende Knowledge-Basis**
   - 22 Dateien mit Fachunterlagen
   - PDFs, TXT, JSON-Formate unterstützt
   - Rollen-Definitionen für alle Stabsstellen

4. **Robuste Prompt-Templates**
   - Separate Templates für Start, Operations, Chat
   - Token-Optimierung durch komprimierte Feldnamen
   - Memory-RAG für Kontext über Zeit

### ⚠️ Schwachstellen

1. **Keine Fehlerbehandlung bei fehlendem Ollama**
   - Index-Builder läuft durch, aber erstellt leeren Index
   - Keine klare Fehlermeldung für Admin

2. **Fehlende Monitoring-Funktionen**
   - Keine Health-Checks für Dependencies
   - Kein Dashboard für Index-Status

3. **Dokumentation fehlt**
   - Kein Setup-Guide für Erstinstallation
   - Keine Troubleshooting-Anleitung

---

## 4. VERBESSERUNGSVORSCHLÄGE

### A. KURZFRISTIG (1-2 Tage)

#### 1. Startup-Checks implementieren

**File:** `chatbot/server/health.js` (neu)
```javascript
export async function checkOllamaHealth() {
  try {
    const res = await fetch(`${CONFIG.llmBaseUrl}/api/tags`, {
      method: 'GET',
      timeout: 5000
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkKnowledgeIndex() {
  const metaPath = path.join(CONFIG.knowledgeIndexDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return { ok: false, reason: 'index_missing' };

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const chunkCount = meta.chunks?.length || 0;

  if (chunkCount < 50) {
    return { ok: false, reason: 'index_incomplete', chunks: chunkCount };
  }

  return { ok: true, chunks: chunkCount };
}
```

**Integration in server/index.js:**
```javascript
import { checkOllamaHealth, checkKnowledgeIndex } from './health.js';

async function bootstrap() {
  // Ollama-Check
  const ollamaOk = await checkOllamaHealth();
  if (!ollamaOk) {
    logError('Ollama-Service nicht erreichbar!', {
      url: CONFIG.llmBaseUrl,
      help: 'Starte Ollama mit: ollama serve'
    });
    process.exit(1);
  }

  // Knowledge-Index-Check
  const indexStatus = await checkKnowledgeIndex();
  if (!indexStatus.ok) {
    logError('Knowledge-Index unvollständig!', {
      reason: indexStatus.reason,
      chunks: indexStatus.chunks,
      help: 'Baue Index mit: npm run build-index'
    });
    process.exit(1);
  }

  logInfo('System-Checks OK', {
    ollama: 'running',
    indexChunks: indexStatus.chunks
  });

  // ... Rest der Initialisierung
}
```

#### 2. Admin-Dashboard erweitern

**Neue Route in server/index.js:**
```javascript
app.get('/api/admin/knowledge-status', async (req, res) => {
  const knowledgeDir = path.resolve(__dirname, CONFIG.knowledgeDir);
  const metaPath = path.join(CONFIG.knowledgeIndexDir, 'meta.json');

  const files = await fsPromises.readdir(knowledgeDir);
  const knowledgeFiles = files.filter(f =>
    ['.txt', '.pdf', '.json'].includes(path.extname(f).toLowerCase())
  );

  let indexedFiles = [];
  let indexedChunks = 0;

  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    indexedFiles = meta.files?.map(f => f.name) || [];
    indexedChunks = meta.chunks?.length || 0;
  }

  const missingFiles = knowledgeFiles.filter(f => !indexedFiles.includes(f));

  res.json({
    ok: true,
    knowledge: {
      totalFiles: knowledgeFiles.length,
      indexedFiles: indexedFiles.length,
      missingFiles,
      totalChunks: indexedChunks,
      coverage: Math.round((indexedFiles.length / knowledgeFiles.length) * 100)
    }
  });
});
```

**UI in client/dashboard.html:**
```html
<div class="knowledge-status">
  <h3>Knowledge-Status</h3>
  <div class="progress">
    <div class="progress-bar" id="knowledge-coverage"></div>
  </div>
  <p id="knowledge-stats"></p>
  <ul id="missing-files"></ul>
</div>

<script>
async function updateKnowledgeStatus() {
  const res = await fetch('/api/admin/knowledge-status');
  const data = await res.json();

  document.getElementById('knowledge-coverage').style.width =
    data.knowledge.coverage + '%';
  document.getElementById('knowledge-stats').innerText =
    `${data.knowledge.indexedFiles}/${data.knowledge.totalFiles} Dateien (${data.knowledge.totalChunks} Chunks)`;

  const list = document.getElementById('missing-files');
  list.innerHTML = data.knowledge.missingFiles
    .map(f => `<li class="missing">${f}</li>`)
    .join('');
}
</script>
```

#### 3. Setup-Dokumentation

**File:** `chatbot/SETUP.md` (neu)
```markdown
# EINFO Chatbot - Setup Guide

## 1. Voraussetzungen

- Node.js 18+
- Ollama (für LLM & Embeddings)
- 8 GB RAM mindestens

## 2. Ollama installieren

### Windows
```powershell
# Download: https://ollama.com/download
# Nach Installation:
ollama pull llama3.1:8b
ollama pull mxbai-embed-large
```

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1:8b
ollama pull mxbai-embed-large
```

## 3. Chatbot setup

```bash
cd /path/to/EINFO/chatbot
npm install
npm run build-index  # Dauert 5-10 Min
npm start
```

## 4. Überprüfung

```bash
# Ollama läuft?
curl http://localhost:11434/api/tags

# Chatbot läuft?
curl http://localhost:3100/api/admin/knowledge-status

# Dashboard öffnen
open http://localhost:3100/dashboard
```

## 5. Troubleshooting

### "Embedding-HTTP-Fehler: fetch failed"
→ Ollama läuft nicht. Starte mit: `ollama serve`

### "Knowledge-Index unvollständig"
→ Baue Index neu: `npm run build-index`

### "LLM-Fehler: Model not found"
→ Lade Model: `ollama pull llama3.1:8b`
```

---

### B. MITTELFRISTIG (1 Woche)

#### 1. Inkrementelles Index-Update

**Problem:** Aktuell muss der gesamte Index neu gebaut werden, wenn eine Datei hinzugefügt wird.

**Lösung:** `chatbot/server/rag/index_updater.js`
```javascript
export async function updateIndex() {
  const meta = loadMeta();
  const knowledgeFiles = await loadFiles();

  const indexed = new Set(meta.files.map(f => f.name));
  const newFiles = knowledgeFiles.filter(f => !indexed.has(f.name));

  if (newFiles.length === 0) {
    logInfo('Index bereits aktuell');
    return;
  }

  logInfo(`${newFiles.length} neue Dateien gefunden`, {
    files: newFiles.map(f => f.name)
  });

  // Nur neue Dateien indizieren
  for (const file of newFiles) {
    await indexFile(file, meta);
  }

  saveMeta(meta);
  logInfo('Index aktualisiert', { totalChunks: meta.chunks.length });
}
```

**Aufruf:**
```bash
npm run update-index  # Schneller als build-index
```

#### 2. RAG-Qualitäts-Monitoring

**File:** `chatbot/server/rag/rag_metrics.js`
```javascript
export function logRAGQuery(query, results) {
  const topScore = results[0]?.score || 0;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  logDebug('RAG-Query', {
    query: query.slice(0, 50),
    resultsCount: results.length,
    topScore: topScore.toFixed(3),
    avgScore: avgScore.toFixed(3),
    files: [...new Set(results.map(r => r.fileName))]
  });

  // Low-Quality-Warning
  if (topScore < 0.4 && results.length > 0) {
    logDebug('RAG-Quality niedrig', {
      query: query.slice(0, 100),
      topScore
    });
  }
}
```

**Integration in rag_vector.js:**
```javascript
const sims = heap.sort((a, b) => b.s - a.s);
const results = sims.map(/* ... */);

logRAGQuery(query, results);  // NEU

return results;
```

#### 3. Prompt-Optimierung testen

**Test verschiedene Prompt-Varianten:**

**Variante A - Aktuell:** Sehr detailliert, viele Tokens
**Variante B - Kompakt:** Nur Kernaufgaben, weniger Context

**A/B-Test:**
```javascript
// chatbot/server/prompts_v2.js (kompakte Variante)
export function buildSystemPromptCompact() {
  return `Du bist KI-Assistent für Katastrophenschutz.
Simuliere fehlende Stabsstellen basierend auf Richtlinien E-31.
Erstelle JSON-Operations (board, aufgaben, protokoll).`;
}
```

**Logging für Vergleich:**
```javascript
logLLMExchange({
  promptVersion: 'v1',  // oder 'v2'
  tokenEstimate: estimatedTokens,
  responseTime: duration,
  operationsCount: totalOps
});
```

**Auswertung nach 1 Woche:**
- Welche Version erzeugt bessere Operations?
- Token-Ersparnis vs. Qualitätsverlust?

---

### C. LANGFRISTIG (1 Monat)

#### 1. Multi-Model-Support

**Ziel:** Verschiedene LLMs für verschiedene Tasks

```javascript
// chatbot/server/config.js
export const CONFIG = {
  // ...
  models: {
    operations: 'llama3.1:8b',     // Simulation
    chat: 'llama3.1:8b',           // User-Chat
    embeddings: 'mxbai-embed-large',
    summarization: 'llama3.1:8b'   // Memory-Summaries
  }
};
```

**Vorteil:**
- Kleinere Models für einfache Tasks (schneller, günstiger)
- Größere Models für komplexe Reasoning

#### 2. RAG-Hybrid: Vector + Keyword

**Problem:** Vector-RAG findet manchmal exakte Matches nicht (Akronyme, Codes)

**Lösung:** Kombiniere Vector-Suche mit BM25 Keyword-Search

```javascript
export async function hybridSearch(query, topK = 5) {
  // Vector-Suche (semantic)
  const vectorResults = await vectorSearch(query, topK);

  // Keyword-Suche (BM25)
  const keywordResults = await bm25Search(query, topK);

  // Merge & Re-rank
  const combined = mergeResults(vectorResults, keywordResults);
  return combined.slice(0, topK);
}
```

**Use Case:**
- Query: "S2 Aufgaben" → Keyword findet exakte Matches in rollen_S2_Lage.json
- Query: "Lagebeurteilung" → Vector findet semantisch ähnliche Texte

#### 3. User-Feedback-Loop

**Feature:** User kann RAG-Antworten bewerten

```javascript
// Endpoint
app.post('/api/chat/feedback', (req, res) => {
  const { messageId, rating, comment } = req.body;

  // Log für spätere Analyse
  logInfo('User-Feedback', {
    messageId,
    rating,  // 1-5
    comment
  });

  // Optional: RAG-Tuning basierend auf Feedback
  if (rating <= 2) {
    // Markiere als "schlechte Antwort" für späteres Retraining
  }

  res.json({ ok: true });
});
```

**UI:**
```html
<div class="message">
  <p>{{ chatbotResponse }}</p>
  <div class="feedback">
    <button onclick="rate(5)">👍</button>
    <button onclick="rate(1)">👎</button>
  </div>
</div>
```

---

## 5. PERFORMANCE-OPTIMIERUNGEN

### Aktueller Stand (geschätzt):

| Metrik | Wert | Bewertung |
|--------|------|-----------|
| Index-Build-Zeit | ~5-10 Min | ⚠️ Langsam (1x pro Tag OK) |
| RAG-Query-Zeit | ~50-200ms | ✅ Gut |
| LLM-Response-Zeit | ~5-15s | ⚠️ Mittel (abhängig von GPU) |
| Memory-Verbrauch | ~2-4 GB | ✅ Gut |

### Optimierungsideen:

#### 1. Batch-Embeddings
**Aktuell:** Jeder Chunk wird einzeln embedded
**Besser:** Batches von 10-20 Chunks parallel

```javascript
// chatbot/server/rag/embedding.js
export async function embedTextBatch(texts) {
  const promises = texts.map(text => embedText(text));
  return await Promise.all(promises);
}

// In index_builder.js
const chunks = chunkText(text, 1000, 200);
const embeddings = await embedTextBatch(chunks);  // Parallel!
```

**Erwartete Verbesserung:** Index-Build 2-3x schneller

#### 2. Quantisierte Embeddings
**Aktuell:** Float32 (4 bytes pro Dimension)
**Besser:** Int8 (1 byte pro Dimension)

**Speicher-Ersparnis:** ~75%
**Qualitätsverlust:** ~2-3% (akzeptabel)

```javascript
function quantizeEmbedding(embedding) {
  const scale = 127 / Math.max(...embedding.map(Math.abs));
  return embedding.map(x => Math.round(x * scale));
}
```

#### 3. LLM-Response-Streaming verbessern
**Aktuell:** Streaming nur im Chat-Modus
**Besser:** Streaming auch für Operations

**Vorteil:** User sieht sofort, dass etwas passiert

---

## 6. TESTING-EMPFEHLUNGEN

### Unit-Tests (fehlen aktuell)

**Framework:** Vitest oder Jest

```javascript
// chatbot/server/rag/__tests__/rag_vector.test.js
import { cosineSimilarity } from '../rag_vector.js';

test('cosine similarity berechnet korrekt', () => {
  const a = [1, 0, 0];
  const b = [1, 0, 0];
  expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);

  const c = [1, 0, 0];
  const d = [0, 1, 0];
  expect(cosineSimilarity(c, d)).toBeCloseTo(0.0);
});
```

### Integration-Tests

```javascript
// chatbot/server/__tests__/llm_client.test.js
test('LLM-Client ruft Ollama erfolgreich auf', async () => {
  const result = await callLLMForChat({
    question: 'Test',
    stream: false
  });

  expect(result).toBeDefined();
  expect(typeof result).toBe('string');
});
```

### E2E-Tests

**Tool:** Playwright

```javascript
test('Chat-Interface funktioniert', async ({ page }) => {
  await page.goto('http://localhost:3100/dashboard');

  await page.fill('#chat-input', 'Was sind die Aufgaben von S2?');
  await page.click('#chat-send');

  await page.waitForSelector('.chat-response');
  const response = await page.textContent('.chat-response');

  expect(response).toContain('Lage');
});
```

---

## 7. ZUSAMMENFASSUNG & PRIORITÄTEN

### ⚠️ KRITISCH (sofort beheben):
1. ✅ **Ollama-Service starten**
2. ✅ **Knowledge-Index neu aufbauen**
3. ⬜ **Health-Checks implementieren** (verhindert Future-Probleme)

### 🔧 WICHTIG (diese Woche):
4. ⬜ **Setup-Dokumentation** (SETUP.md)
5. ⬜ **Admin-Dashboard erweitern** (Knowledge-Status anzeigen)
6. ⬜ **Error-Handling verbessern** (klare Fehlermeldungen)

### 📈 VERBESSERUNGEN (nächsten 2 Wochen):
7. ⬜ **Inkrementelles Index-Update**
8. ⬜ **RAG-Qualitäts-Monitoring**
9. ⬜ **Performance-Optimierungen** (Batch-Embeddings)

### 🚀 FEATURES (Monat):
10. ⬜ **Multi-Model-Support**
11. ⬜ **Hybrid-RAG (Vector + Keyword)**
12. ⬜ **User-Feedback-System**

---

## 8. NÄCHSTE SCHRITTE

1. **Admin führt Sofortmaßnahmen durch:**
   ```bash
   # Terminal 1: Ollama starten
   ollama serve

   # Terminal 2: Models laden
   ollama pull llama3.1:8b
   ollama pull mxbai-embed-large

   # Terminal 3: Index aufbauen
   cd /home/user/EINFO/chatbot
   npm install
   npm run build-index

   # Terminal 4: Chatbot starten
   npm start
   ```

2. **Test durchführen:**
   ```bash
   curl -X POST http://localhost:3100/api/chat \
     -H "Content-Type: application/json" \
     -d '{"question": "Was sind die Aufgaben von S2 Lage?"}'
   ```

   **Erwartetes Ergebnis:** Detaillierte Antwort mit Referenz zu e31.pdf oder Rollen-JSON

3. **Dashboard prüfen:**
   ```
   http://localhost:3100/dashboard
   ```

   **Prüfen:**
   - Knowledge-Status zeigt 100% Coverage
   - GPU-Status zeigt Auslastung
   - LLM-Logs zeigen erfolgreiche Queries

4. **Code-Changes committen:**
   ```bash
   git add .
   git commit -m "Fix: Knowledge-Index Pfade korrigiert"
   git push
   ```

---

## 9. KONTAKT & SUPPORT

Bei Fragen oder Problemen:
- **Logs prüfen:** `chatbot/logs/chatbot.log`, `chatbot/logs/LLM.log`
- **Debug-Mode:** `CHATBOT_DEBUG=1 npm start`
- **Ollama-Logs:** `journalctl -u ollama.service -f` (Linux)

**Häufige Fehler:**
- "ECONNREFUSED 11434" → Ollama nicht gestartet
- "Model not found" → `ollama pull <model-name>`
- "Index empty" → `npm run build-index` ausführen
