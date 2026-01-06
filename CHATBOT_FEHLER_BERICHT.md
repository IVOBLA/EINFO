# Chatbot Fehleranalyse-Bericht

**Datum:** 2026-01-06
**Analysierte Komponenten:** Chatbot-Server, Worker, LLM-Client, Simulation Loop

## Zusammenfassung

Die Chatbot-Implementierung wurde auf potentielle Fehler und Probleme untersucht. Es wurden mehrere kritische und nicht-kritische Probleme identifiziert, die die Stabilität und Zuverlässigkeit des Systems beeinträchtigen könnten.

## Gefundene Fehler

### 🔴 Kritisch

#### 1. Race Condition im Worker-Retry-Mechanismus
**Datei:** `server/chatbot_worker.js:986-1026`
**Problem:**
- Die While-Schleife mit `MAX_RETRIES = 10` wird verwendet, aber bei vielen Fehlertypen wird `return` aufgerufen, ohne die Schleife korrekt zu verlassen
- Bei einem HTTP-Fehler außer `step_in_progress` wird die Funktion beendet, aber die Schleife wird nicht durch `break` verlassen
- Dies könnte zu inkonsistentem Verhalten führen

**Code:**
```javascript
while (retries < MAX_RETRIES) {
  const res = await fetch(CHATBOT_STEP_URL, ...);

  if (!res.ok) {
    // ...
    if (res.status === 500 && reason === "step_in_progress") {
      retries++;
      // ...
      continue;
    }

    log("HTTP-Fehler:", res.status, bodyText.slice(0, 200));
    return;  // ⚠️ Verlässt Funktion, aber Schleife nicht korrekt
  }
  // ...
}
```

**Empfehlung:** Verwende `break` statt `return` um die Schleife zu verlassen, oder strukturiere die Fehlerbehandlung um.

---

#### 2. Potential Memory Leak bei SSE-Clients
**Datei:** `chatbot/server/index.js:1085-1127`
**Problem:**
- SSE-Clients werden in einem Set gespeichert
- Heartbeat-Intervalle könnten weiter laufen, auch wenn die Verbindung bereits geschlossen ist
- Kein expliziter Cleanup beim Server-Shutdown

**Code:**
```javascript
const sseClients = new Set();

app.get("/api/events", (req, res) => {
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      // Client disconnected - aber Interval läuft weiter
    }
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});
```

**Empfehlung:**
- Implementiere einen Server-Shutdown-Handler der alle Intervalle stoppt
- Prüfe ob `res.writable` vor dem Schreiben

---

#### 3. Unzuverlässige Prozess-Erkennung auf Windows
**Datei:** `server/chatbotRunner.js:31-39`
**Problem:**
- `process.kill(pid, 0)` funktioniert auf Windows-Systemen nicht zuverlässig
- Könnte zu Zombie-Prozessen oder fehlerhaften Status-Meldungen führen

**Code:**
```javascript
function processIsAlive(proc) {
  if (!proc) return false;
  try {
    process.kill(proc.pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

**Empfehlung:** Verwende plattformspezifische Checks oder `proc.exitCode !== null` und `proc.killed` Properties.

---

### 🟡 Mittelschwer

#### 4. Fehlende Thread-Sicherheit bei Snapshot-Updates
**Datei:** `chatbot/server/sim_loop.js:293-295, 732-738`
**Problem:**
- `lastComparableSnapshot` und `lastCompressedBoardJson` werden global gespeichert
- Bei parallelen Simulationsschritten (wenn `forceConcurrent` gesetzt ist) könnte es zu Race Conditions kommen

**Code:**
```javascript
let lastComparableSnapshot = null;
let lastCompressedBoardJson = "[]";

// Später:
lastComparableSnapshot = {
  board: boardSnapshot,
  aufgaben: aufgabenSnapshot,
  protokoll: protokollSnapshot
};
```

**Empfehlung:**
- Implementiere einen Mutex/Lock-Mechanismus
- Oder entferne die `forceConcurrent` Option komplett, da sie zu Datenverlust führen kann

---

#### 5. Inkonsistente Fehlerbehandlung bei JSON-Parsing
**Datei:** Mehrere Dateien (`chatbot_worker.js`, `sim_loop.js`, etc.)
**Problem:**
- `JSON.parse()` wird oft ohne try-catch verwendet
- Könnte zu unerwarteten Abstürzen führen

**Beispiele:**
```javascript
// chatbot_worker.js:232
const raw = await fsPromises.readFile(filePath, "utf8");
return JSON.parse(raw);  // ⚠️ Kein try-catch

// sim_loop.js:334
return JSON.stringify(compact);  // OK
```

**Empfehlung:** Konsistente Verwendung von `safeReadJson` oder try-catch Blöcken überall.

---

#### 6. Timeout-Kaskaden bei LLM-Aufrufen
**Datei:** `chatbot/server/llm_client.js:33-41`
**Problem:**
- Der Retry-Mechanismus erhöht das Timeout bei jedem Versuch (`timeoutMultiplier: 1.5`)
- Bei MAX_RETRIES=3 könnte das zu sehr langen Wartezeiten führen
- Der AbortController wird in einem finally aufgeräumt, aber der Timer könnte bereits abgelaufen sein

**Code:**
```javascript
function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const finalOptions = { ...options, signal: controller.signal };

  return fetch(url, finalOptions).finally(() => {
    clearTimeout(id);  // Wird immer aufgerufen, aber Timeout könnte schon ausgelöst sein
  });
}
```

**Empfehlung:** Überprüfe ob der Timer bereits ausgelöst wurde, bevor `clearTimeout` aufgerufen wird.

---

### 🟢 Niedrig / Code-Qualität

#### 7. Unused Variable Warning
**Datei:** `server/chatbot_worker.js:39`
**Problem:**
- Die Variable `isRunning` wird nur gesetzt, aber an einer Stelle gibt es einen früheren Check bei Zeile 946 der verhindert, dass parallele Durchläufe starten

**Empfehlung:** Stelle sicher, dass `isRunning` konsequent verwendet wird.

---

#### 8. Inkonsistente Log-Levels
**Datei:** Verschiedene Dateien
**Problem:**
- Einige kritische Fehler werden nur als `logError` geloggt, aber nicht an die Aufrufende Funktion zurückgegeben
- Beispiel: `disaster_context.js` Fehler werden "geschluckt" in `sim_loop.js:620-624`

**Empfehlung:** Definiere klare Richtlinien, wann Fehler geloggt vs. geworfen werden sollen.

---

#### 9. Fehlende Input-Validierung
**Datei:** `chatbot/server/index.js` (verschiedene Endpunkte)
**Problem:**
- Viele API-Endpunkte validieren Eingaben nur minimal
- Beispiel: `/api/feedback` validiert nur Rating, aber nicht die anderen Felder

**Empfehlung:** Implementiere Input-Validierung mit einem Schema-Validator (z.B. Zod, Joi).

---

#### 10. Hardcodierte Magic Numbers
**Datei:** Verschiedene Dateien
**Problem:**
- Viele hardcodierte Werte wie `60000` (Timeout), `30000` (Heartbeat), etc.
- Erschwert Wartung und Testing

**Beispiele:**
```javascript
const WORKER_INTERVAL_MS = 30000;  // OK - konstante
const heartbeat = setInterval(() => { ... }, 30000);  // ⚠️ Hardcoded
```

**Empfehlung:** Verschiebe alle Timeouts und Intervalle in CONFIG oder Environment-Variablen.

---

## Log-Analyse

Die Chatbot-Logs zeigen keine akuten Fehler:
- Normale DEBUG-Meldungen über Embedding-Cache
- SSE-Client Verbindungen/Trennungen
- LLM-Aufrufe erfolgreich

**Positive Beobachtungen:**
- Rate-Limiting funktioniert korrekt
- Embedding-Cache wird effizient genutzt
- Keine Memory-Leaks in den Logs sichtbar

---

## Empfohlene Maßnahmen

### Sofort (Kritisch):
1. ✅ Fixe die While-Schleife im Worker (Race Condition)
2. ✅ Implementiere SSE-Cleanup beim Server-Shutdown
3. ✅ Verbessere `processIsAlive` für Windows-Kompatibilität

### Kurz- bis Mittelfristig:
4. Entferne `forceConcurrent` oder implementiere Thread-Safety
5. Füge Input-Validierung zu allen API-Endpunkten hinzu
6. Konsolidiere Error-Handling-Strategie

### Langfristig:
7. Refactoring: Verschiebe Magic Numbers in Konfiguration
8. Implementiere umfassendes Logging-System mit Levels
9. Füge automatisierte Tests hinzu (Unit + Integration)

---

## Fazit

Der Chatbot ist generell gut strukturiert und funktionsfähig. Die identifizierten Fehler sind größtenteils **Edge Cases** oder **potentielle Probleme**, die unter bestimmten Bedingungen auftreten könnten. Es wurden keine akuten Fehler gefunden, die den normalen Betrieb beeinträchtigen.

**Gesamtbewertung:** 🟢 Stabil mit Verbesserungspotential
