# EINFO Chatbot - Admin-Panel Features

**Datum:** 2025-12-22
**Version:** 1.0
**Status:** ✅ Implementiert, bereit für npm install

---

## 🎯 Neue Features

Das Admin-Panel wurde um folgende Funktionen erweitert:

### 1. **Chatbot-Steuerung**
   - ▶️ Simulation starten
   - ⏸️ Simulation pausieren
   - ➡️ Einzelschritt ausführen
   - 📊 Live-Status (Uptime, Memory)

### 2. **Knowledge-Management**
   - 📚 Knowledge-Status anzeigen (Coverage, Chunks, Files)
   - 🔨 Index neu bauen (mit Progress-Bar)
   - 📁 Knowledge-Dateien hochladen (Drag & Drop)
   - 🗑️ Knowledge-Dateien löschen
   - 🔄 Status aktualisieren

### 3. **Live-Monitoring**
   - Echtzeit-Status über Server-Sent Events (SSE)
   - Automatische Aktualisierung alle 10 Sekunden
   - Progress-Tracking für Index-Build

---

## 🚀 Zugriff

```
http://localhost:3100/admin
```

**Alternative URLs:**
- Dashboard (Übungsleiter): http://localhost:3100/dashboard
- GUI (alt): http://localhost:3100/gui

---

## 📋 Installation & Setup

### Voraussetzungen

```bash
cd /home/user/EINFO/chatbot
```

### Dependencies installieren

```bash
npm install
```

**Neue Dependency:**
- `multer` - File-Upload-Middleware

**Wichtig:** Falls `npm install` wegen Netzwerk-Problemen fehlschlägt:
```bash
# Workaround: Multer separat installieren
npm install multer --save

# Oder: Offline-Installation
# Lade multer@1.4.5-lts.1 von npmjs.com herunter
# und extrahiere nach node_modules/multer
```

### Server starten

```bash
npm start
# → Chatbot läuft auf http://localhost:3100
```

---

## 🔧 API-Endpunkte

### Chatbot-Steuerung

#### GET /api/admin/chatbot-status
**Beschreibung:** Status des Chatbot-Servers abrufen

**Response:**
```json
{
  "ok": true,
  "status": {
    "running": true,
    "uptime": 12345,
    "memoryUsage": {
      "heapUsed": 52428800,
      "heapTotal": 104857600
    },
    "nodeVersion": "v22.21.1"
  }
}
```

---

### Knowledge-Management

#### GET /api/admin/knowledge-status
**Beschreibung:** Status des Knowledge-Systems abrufen

**Response:**
```json
{
  "ok": true,
  "knowledge": {
    "totalFiles": 22,
    "indexedFiles": 22,
    "missingFiles": [],
    "totalChunks": 320,
    "coverage": 100,
    "indexExists": true,
    "files": ["e31.pdf", "hochwasser.txt", ...]
  }
}
```

**Use Case:**
- Zeigt Coverage-Prozentsatz
- Listet fehlende Dateien
- Warnt, wenn Index fehlt oder unvollständig ist

---

#### POST /api/admin/rebuild-index
**Beschreibung:** Knowledge-Index neu aufbauen (asynchron)

**Response (sofort):**
```json
{
  "ok": true,
  "message": "Index-Build gestartet"
}
```

**Hintergrund-Prozess:**
- Führt `node server/rag/index_builder.js` aus
- Dauert 5-10 Minuten (abhängig von Dateigröße)
- Sendet Progress-Updates über SSE
- Timeout: 10 Minuten

**Polling-Endpunkt:**
```
GET /api/admin/index-build-status
```

**Response:**
```json
{
  "ok": true,
  "running": true,
  "progress": {
    "status": "building",
    "percent": 45
  }
}
```

**Status-Werte:**
- `starting` - Wird gestartet
- `building` - Läuft
- `completed` - Erfolgreich
- `failed` - Fehler

**SSE-Event:**
```javascript
event: index_rebuild
data: {"status": "completed"}
```

---

#### POST /api/admin/upload-knowledge
**Beschreibung:** Knowledge-Datei hochladen

**Request:** `multipart/form-data`
```
POST /api/admin/upload-knowledge
Content-Type: multipart/form-data

file: <file-data>
```

**Erlaubte Formate:**
- `.pdf` - PDF-Dokumente
- `.txt` - Text-Dateien
- `.json` - JSON-Daten
- `.md` - Markdown

**Maximale Größe:** 10 MB

**Response:**
```json
{
  "ok": true,
  "file": {
    "name": "neue_datei.pdf",
    "size": 524288,
    "path": "/home/user/EINFO/chatbot/knowledge/neue_datei.pdf"
  },
  "message": "Datei hochgeladen. Bitte Index neu bauen."
}
```

**SSE-Event:**
```javascript
event: knowledge_uploaded
data: {"filename": "neue_datei.pdf"}
```

**Wichtig:** Nach dem Upload muss der Index neu gebaut werden!

---

#### DELETE /api/admin/knowledge/:filename
**Beschreibung:** Knowledge-Datei löschen

**Request:**
```
DELETE /api/admin/knowledge/hochwasser.txt
```

**Response:**
```json
{
  "ok": true,
  "message": "Datei gelöscht. Bitte Index neu bauen."
}
```

**Fehler (404):**
```json
{
  "ok": false,
  "error": "Datei nicht gefunden"
}
```

**Sicherheit:**
- Filename wird mit `path.basename()` sanitized
- Verhindert Directory-Traversal-Angriffe
- Nur Dateien im Knowledge-Verzeichnis können gelöscht werden

**SSE-Event:**
```javascript
event: knowledge_deleted
data: {"filename": "hochwasser.txt"}
```

---

## 🖥️ Admin-Panel UI

### Aufbau

```
┌─────────────────────────────────────────────┐
│  ⚙️ EINFO Admin Panel    [Status: Läuft]   │
├─────────────────────────────────────────────┤
│ ┌───────────────┐  ┌──────────────────────┐ │
│ │ Chatbot       │  │ Knowledge-Management │ │
│ │ - Uptime      │  │ - 22 Dateien         │ │
│ │ - Memory      │  │ - 320 Chunks         │ │
│ │ [Start]       │  │ - 100% Coverage      │ │
│ │ [Pause]       │  │ [Index neu bauen]    │ │
│ │ [Schritt]     │  │ [Aktualisieren]      │ │
│ └───────────────┘  └──────────────────────┘ │
│ ┌───────────────┐  ┌──────────────────────┐ │
│ │ File-Upload   │  │ Knowledge-Dateien    │ │
│ │ [Drag & Drop] │  │ - e31.pdf       [🗑]│ │
│ └───────────────┘  │ - hochwasser.txt [🗑]│ │
│                    │ ...                  │ │
│                    └──────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Features

#### 1. Chatbot-Steuerung
- **Uptime:** Zeigt Laufzeit in Stunden und Minuten
- **Memory:** Heap-Nutzung in MB
- **Buttons:**
  - `▶ Simulation starten` - Startet automatische Simulation
  - `⏸ Simulation pausieren` - Pausiert Simulation
  - `➡ Einzelschritt` - Führt einen Simulationsschritt aus

**Auto-Disable-Logik:**
- Start-Button disabled, wenn Simulation läuft
- Pause-Button disabled, wenn Simulation gestoppt

#### 2. Knowledge-Management
- **Live-Statistiken:**
  - Anzahl Knowledge-Dateien
  - Anzahl indizierte Dateien
  - Anzahl Chunks im Index
  - Coverage-Prozentsatz

- **Status-Alerts:**
  - ✅ Grün: Alle Dateien indiziert
  - ⚠️ Gelb: Einige Dateien fehlen im Index
  - ❌ Rot: Index existiert nicht

- **Progress-Bar:**
  - Zeigt Index-Build-Fortschritt
  - 0% → 10% (Start) → 100% (Abgeschlossen)

#### 3. File-Upload
- **Drag & Drop Zone:**
  - Datei hierher ziehen oder klicken
  - Hover-Effekt (blau)
  - Dragover-Effekt (grün)

- **File-Filter:**
  - Nur `.pdf`, `.txt`, `.json`, `.md` erlaubt
  - Max. 10 MB

- **Upload-Status:**
  - Info: "Lade hoch: ..."
  - Erfolg: "✓ Datei hochgeladen. Bitte Index neu bauen."
  - Fehler: "✗ Fehler: ..."

#### 4. Knowledge-Dateien-Liste
- **Scrollbare Liste** (max. 300px Höhe)
- **Pro Datei:**
  - Dateiname (monospace)
  - Badge: "✓ Indiziert" (grün) oder "⚠ Nicht indiziert" (gelb)
  - Löschen-Button (🗑️)

**Löschen-Funktion:**
1. Klick auf 🗑️
2. Bestätigung: "Datei wirklich löschen?"
3. DELETE-Request an API
4. Erfolg → Liste aktualisiert

---

## 🔄 Workflow: Knowledge-Datei hinzufügen

### Schritt-für-Schritt

1. **Admin-Panel öffnen**
   ```
   http://localhost:3100/admin
   ```

2. **Datei hochladen**
   - Drag & Drop in die Upload-Zone
   - ODER: Klick → Datei auswählen

3. **Warten auf Upload**
   - Status: "Lade hoch: neue_datei.pdf"
   - Erfolg: "✓ Datei hochgeladen. Bitte Index neu bauen."

4. **Index neu bauen**
   - Klick auf "🔨 Index neu bauen"
   - Bestätigung: "Index neu bauen? Dies kann 5-10 Minuten dauern."
   - Progress-Bar zeigt Fortschritt

5. **Warten auf Completion**
   - Status ändert sich: "starting" → "building" → "completed"
   - Auto-Refresh nach Abschluss
   - Neuer Status: "22 Dateien, 320+ Chunks, 100% Coverage"

6. **Fertig!**
   - Chatbot hat nun Zugriff auf die neue Datei
   - Test: Frage zum neuen Thema stellen

---

## 🔒 Sicherheit

### File-Upload

**Filename-Sanitization:**
```javascript
const safeName = file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
```

**Verhindert:**
- Directory-Traversal (`../../../etc/passwd`)
- Special Characters (`; rm -rf /`)
- Path-Injection

**File-Type-Validation:**
```javascript
const allowedExts = [".pdf", ".txt", ".json", ".md"];
const ext = path.extname(file.originalname).toLowerCase();
```

**Size-Limit:**
```javascript
limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
```

### File-Delete

**Path-Sanitization:**
```javascript
const safeName = path.basename(filename); // Entfernt Pfad-Komponenten
const filePath = path.join(knowledgeDir, safeName);
```

**Verhindert:**
- Löschen außerhalb des Knowledge-Verzeichnisses
- Directory-Traversal

**Existence-Check:**
```javascript
if (!fs.existsSync(filePath)) {
  return res.status(404).json({ ok: false, error: "Datei nicht gefunden" });
}
```

---

## 🐛 Troubleshooting

### Problem: "Index-Build läuft bereits"

**Ursache:** Ein vorheriger Build wurde nicht abgeschlossen

**Lösung:**
1. Warte 60 Sekunden (Auto-Reset)
2. ODER: Server neu starten

### Problem: "fetch failed" beim Index-Build

**Ursache:** Ollama-Service nicht erreichbar

**Lösung:**
```bash
# Check Ollama
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### Problem: Upload-Button reagiert nicht

**Ursache:** Multer nicht installiert

**Lösung:**
```bash
cd /home/user/EINFO/chatbot
npm install multer
npm start
```

**Check:**
```bash
ls node_modules/multer
# Sollte Verzeichnis anzeigen
```

### Problem: "Cannot find module 'multer'"

**Ursache:** Dependencies nicht installiert

**Lösung:**
```bash
cd /home/user/EINFO/chatbot
npm install

# Logs prüfen
npm start 2>&1 | grep -i multer
```

### Problem: Index-Build hängt bei 10%

**Ursache:** Ollama-Embedding-Service langsam oder überlastet

**Lösung:**
1. Geduld haben (kann 5-10 Min dauern)
2. Ollama-Logs prüfen:
   ```bash
   journalctl -u ollama.service -f
   ```
3. Bei Timeout: Neu starten

---

## 📊 Monitoring & Logs

### Server-Logs

```bash
cd /home/user/EINFO/chatbot

# Chatbot-Logs
tail -f logs/chatbot.log

# LLM-Logs
tail -f logs/LLM.log
```

### Index-Build-Logs

**Während des Builds:**
```
[INFO] Knowledge-Build gestartet
[INFO] Verarbeite Knowledge-Datei { file: 'e31.pdf' }
[INFO] Verarbeite Knowledge-Datei { file: 'hochwasser.txt' }
...
[INFO] Index-Build abgeschlossen { stdout: '...' }
```

**Bei Fehler:**
```
[ERROR] Index-Build fehlgeschlagen { error: '...' }
```

### Browser-Console

**Öffne:** DevTools → Console (F12)

**Nützliche Messages:**
```
Fehler beim Laden des Chatbot-Status: ...
Fehler beim Laden des Knowledge-Status: ...
Poll-Fehler: ...
```

---

## 🧪 Testing

### Manuelle Tests

#### Test 1: Chatbot-Status abrufen

```bash
curl http://localhost:3100/api/admin/chatbot-status
```

**Erwartung:**
```json
{"ok":true,"status":{"running":false,"uptime":123,...}}
```

#### Test 2: Knowledge-Status abrufen

```bash
curl http://localhost:3100/api/admin/knowledge-status
```

**Erwartung:**
```json
{"ok":true,"knowledge":{"totalFiles":22,"indexedFiles":22,...}}
```

#### Test 3: Index neu bauen

```bash
curl -X POST http://localhost:3100/api/admin/rebuild-index
```

**Erwartung:**
```json
{"ok":true,"message":"Index-Build gestartet"}
```

**Dann:**
```bash
# Prüfe Status (mehrmals)
curl http://localhost:3100/api/admin/index-build-status
```

#### Test 4: Datei hochladen

```bash
# Test-Datei erstellen
echo "Test-Wissen für Feuerwehr" > /tmp/test.txt

# Upload
curl -X POST http://localhost:3100/api/admin/upload-knowledge \
  -F "file=@/tmp/test.txt"
```

**Erwartung:**
```json
{"ok":true,"file":{"name":"test.txt",...}}
```

**Verify:**
```bash
ls /home/user/EINFO/chatbot/knowledge/test.txt
```

#### Test 5: Datei löschen

```bash
curl -X DELETE http://localhost:3100/api/admin/knowledge/test.txt
```

**Erwartung:**
```json
{"ok":true,"message":"Datei gelöscht. ..."}
```

**Verify:**
```bash
ls /home/user/EINFO/chatbot/knowledge/test.txt
# Sollte "No such file or directory" zeigen
```

---

## 📝 Code-Beispiele

### Backend: File-Upload-Handler

```javascript
app.post("/api/admin/upload-knowledge", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "Keine Datei hochgeladen" });
  }

  logInfo("Knowledge-Datei hochgeladen", {
    filename: req.file.filename,
    size: req.file.size
  });

  res.json({
    ok: true,
    file: {
      name: req.file.filename,
      size: req.file.size
    },
    message: "Datei hochgeladen. Bitte Index neu bauen."
  });

  // SSE-Broadcast
  broadcastSSE("knowledge_uploaded", { filename: req.file.filename });
});
```

### Frontend: Drag & Drop

```javascript
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    uploadFile(files[0]);
  }
});

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/admin/upload-knowledge", {
    method: "POST",
    body: formData
  });

  const data = await res.json();
  // ... Handle response
}
```

---

## 🚀 Deployment-Checklist

- [ ] Dependencies installiert (`npm install`)
- [ ] Ollama läuft (`ollama serve`)
- [ ] Models geladen (`ollama pull llama3.1:8b`, `ollama pull mxbai-embed-large`)
- [ ] Knowledge-Index gebaut (`npm run build-index`)
- [ ] Server gestartet (`npm start`)
- [ ] Admin-Panel erreichbar (http://localhost:3100/admin)
- [ ] Alle Features getestet:
  - [ ] Chatbot-Steuerung
  - [ ] Knowledge-Status
  - [ ] Index-Build
  - [ ] File-Upload
  - [ ] File-Delete

---

## 📚 Weiterführende Docs

- **Haupt-Testbericht:** `/home/user/EINFO/CHATBOT_TEST_REPORT.md`
- **Projekt-Struktur:** `/home/user/EINFO/PROJEKT_STRUKTUR.md`
- **Diese Doku:** `/home/user/EINFO/chatbot/ADMIN_PANEL_FEATURES.md`

---

*Version 1.0 - 2025-12-22*
*Implementiert von Claude*
