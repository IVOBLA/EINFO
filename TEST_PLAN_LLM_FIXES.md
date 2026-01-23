# Test-Plan für LLM Operations Format Fixes

**Branch:** `claude/fix-llm-operations-format-28F28`
**Datum:** 2026-01-23
**Fixes:** (A) Array→Objekt, (B) assignedBy, (C) anvon=null, (D) from/sender, (E) id→incidentId/taskId, (F) Schema cleanup

---

## 🎯 Test-Ziele

1. Verifizieren dass LLM-generierte Operations korrekt verarbeitet werden
2. Sicherstellen dass Protokolle, Einsätze und Aufgaben angelegt werden
3. Prüfen dass die Szenario-Konfiguration im Admin Panel angezeigt wird

---

## 📋 Test-Szenarien

### Test 1: LLM liefert operations als Array (Issue A)

**Eingabe:**
```json
{
  "operations": [
    {"type": "board.create", "content": "Test"}
  ]
}
```

**Erwartetes Verhalten:**
- ✅ `sim_loop.js:853` erkennt Array-Format
- ✅ Loggt ERROR: "LLM lieferte operations als Array statt Objekt"
- ✅ Verwendet leere Operations statt Absturz
- ✅ Simulation läuft weiter (keine 0-Ops mehr)

**Verifikation:**
```bash
# Nach Simulation-Step:
grep "operations als Array" /home/user/EINFO/chatbot/logs/chatbot.log

# Erwartete Log-Ausgabe:
# {"level":"ERROR","msg":"LLM lieferte operations als Array statt Objekt"...}
```

---

### Test 2: assignedBy fehlt (Issue B)

**Eingabe (von LLM):**
```json
{
  "operations": {
    "aufgaben": {
      "create": [{
        "title": "Lagebeurteilung erstellen",
        "responsible": "S2",
        "status": "open",
        "priority": "high"
        // assignedBy fehlt!
      }]
    }
  }
}
```

**Erwartetes Verhalten:**
- ✅ `chatbot_worker.js:820` setzt `assignedBy = "S2"` (von responsible)
- ✅ Aufgabe wird NICHT verworfen
- ✅ Aufgabe erscheint in `Aufg_board_S2.json`

**Verifikation:**
```bash
# Nach Simulation-Step:
cat /home/user/EINFO/server/data/Aufg_board_S2.json | jq '.items[] | select(.title=="Lagebeurteilung erstellen")'

# Erwartete Ausgabe:
# {
#   "title": "Lagebeurteilung erstellen",
#   "assignedBy": "S2",  # <-- automatisch gesetzt
#   "responsible": "S2",
#   ...
# }
```

---

### Test 3: anvon=null (Issue C)

**Eingabe (von LLM):**
```json
{
  "operations": {
    "protokoll": {
      "create": [{
        "information": "Einsatzstelle E-1 unter Kontrolle",
        "infoTyp": "Rueckmeldung",
        "richtung": "ein"
        // anvon fehlt komplett!
      }]
    }
  }
}
```

**Erwartetes Verhalten:**
- ✅ `chatbot_worker.js:799` setzt `anvon = "bot"` als Fallback
- ✅ Protokoll wird NICHT verworfen
- ✅ Protokoll erscheint in `protocol.json`

**Verifikation:**
```bash
# Nach Simulation-Step:
cat /home/user/EINFO/server/data/protocol.json | jq '.[-1]'

# Erwartete Ausgabe:
# {
#   "information": "Einsatzstelle E-1 unter Kontrolle",
#   "anvon": "bot",  # <-- automatisch gesetzt
#   "richtung": "ein",
#   ...
# }
```

---

### Test 4: from/sender statt anvon (Issue D)

**Eingabe (von LLM):**
```json
{
  "operations": {
    "protokoll": {
      "create": [{
        "information": "Straßensperrung aufgehoben",
        "from": "POL",
        "sender": "Polizei Feldkirchen",
        "infoTyp": "Info",
        "richtung": "ein"
        // anvon fehlt, aber from/sender vorhanden
      }]
    }
  }
}
```

**Erwartetes Verhalten:**
- ✅ `chatbot_worker.js:790-791` erkennt `from` oder `sender`
- ✅ `resolveProtokollAnvon()` mappt `from` → `anvon`
- ✅ Protokoll wird NICHT verworfen
- ✅ Log: "Protokoll anvon sanitized"

**Verifikation:**
```bash
# Worker-Log prüfen:
grep "anvon sanitized" /home/user/EINFO/server/logs/chatbot_worker.log

# Protocol-JSON prüfen:
cat /home/user/EINFO/server/data/protocol.json | jq '.[-1].anvon'
# Erwartete Ausgabe: "POL"
```

---

### Test 5: id statt incidentId (Issue E)

**Eingabe (von LLM):**
```json
{
  "operations": {
    "board": {
      "updateIncidentSites": [{
        "id": "inc_abc123",  // <-- falsch! sollte incidentId sein
        "changes": {
          "status": "active"
        }
      }]
    }
  }
}
```

**Erwartetes Verhalten:**
- ✅ `chatbot_worker.js:758-760` normalisiert `id` → `incidentId`
- ✅ Update wird angewendet
- ✅ Log: "Board update: id → incidentId normalisiert"

**Verifikation:**
```bash
# Worker-Log prüfen:
grep "id → incidentId normalisiert" /home/user/EINFO/server/logs/chatbot_worker.log

# Board.json prüfen:
cat /home/user/EINFO/server/data/board.json | jq '.columns."in-bearbeitung".items[] | select(.id=="inc_abc123")'
# Erwartete Ausgabe: Eintrag mit status="active"
```

---

### Test 6: analysis/meta Felder (Issue F)

**Eingabe (vor Fix - vom LLM):**
```json
{
  "operations": {
    "board": {"createIncidentSites": []},
    "aufgaben": {"create": []},
    "protokoll": {"create": []}
  },
  "analysis": "Die Lage verschärft sich...",  // <-- VERBOTEN!
  "meta": {"confidence": 0.8}  // <-- VERBOTEN!
}
```

**Erwartetes Verhalten:**
- ✅ Prompt verbietet explizit analysis/meta Felder
- ✅ LLM liefert NUR operations-Objekt
- ✅ Falls doch vorhanden: werden ignoriert (keine Nutzung im Code)

**Verifikation:**
```bash
# Prüfe operations_system_prompt.txt:
grep "VERBOTEN" /home/user/EINFO/chatbot/server/prompt_templates/operations_system_prompt.txt
# Erwartete Ausgabe: "VERBOTEN: Keine analysis, meta, oder andere Felder außerhalb von operations!"

# Prüfe dass Schema kein analysis/meta enthält:
grep -E "analysis|meta" /home/user/EINFO/chatbot/server/prompt_templates/operations_system_prompt.txt | grep -v VERBOTEN
# Erwartete Ausgabe: (leer - keine Matches)
```

---

### Test 7: Szenario-Konfiguration Display

**Szenario:** `hochwasser_basic.json` starten

**Erwartetes Verhalten:**
- ✅ `sim_loop.js:555` schreibt `scenario_config.json`
- ✅ Admin Panel zeigt korrekte Daten

**Verifikation:**
```bash
# 1. Simulation starten:
# POST /api/user/admin/chatbot/start mit scenarioId: "hochwasser_basic"

# 2. scenario_config.json prüfen:
cat /home/user/EINFO/server/data/scenario_config.json

# Erwartete Ausgabe:
# {
#   "scenarioId": "hochwasser_basic",
#   "artDesEreignisses": "Hochwasser",
#   "geografischerBereich": "Musterstadt",
#   "wetter": "Starkregen seit 24 Stunden, Pegelstände steigend",
#   "zeit": "2026-01-23T20:30:00.000Z",
#   "infrastruktur": "Sandsäcke am Bauhof verfügbar"
# }

# 3. Admin Panel öffnen:
# http://localhost:5010/admin-panel
# Erwartete Anzeige:
# - Art des Ereignisses: Hochwasser (nicht "Unbekannt")
# - Geografischer Bereich: Musterstadt (nicht "Nicht definiert")
```

---

## 🔬 Code-Review Checkliste

### ✅ sim_loop.js

- [x] Line 853: Array-Detection korrekt
- [x] Line 861-893: Normalisierung vollständig (board, aufgaben, protokoll)
- [x] Line 895: Debug-Log vorhanden
- [x] Line 500-533: writeScenarioConfig() Funktion hinzugefügt
- [x] Line 555: writeScenarioConfig() Aufruf bei resetState

### ✅ chatbot_worker.js

- [x] Line 721-743: resolveProtokollAnvon() prüft from/sender
- [x] Line 749-834: sanitizeOperations() Funktion komplett
- [x] Line 758-762: Board id→incidentId Normalisierung
- [x] Line 774-778: Aufgaben id→taskId Normalisierung
- [x] Line 790-796: Protokoll from/sender→anvon Mapping
- [x] Line 799-802: Protokoll anvon Fallback zu "bot"
- [x] Line 820-822: Aufgaben assignedBy Fallback
- [x] Line 1033: sanitizeOperations() Integration

### ✅ operations_system_prompt.txt

- [x] Line 34: Warnung gegen zusätzliche Felder
- [x] Line 45: incidentId statt id
- [x] Line 52: taskId statt id
- [x] Line 63: Explizites Verbot von analysis/meta
- [x] Kein analysis/meta im Schema

---

## 🚀 Manuelle Test-Durchführung

### Vorbereitung

1. **Ollama starten:**
   ```bash
   ollama serve &
   ollama pull llama3.1:8b
   ollama pull mxbai-embed-large
   ```

2. **Chatbot-Server starten:**
   ```bash
   cd /home/user/EINFO/chatbot
   npm install
   npm start &
   ```

3. **Worker starten:**
   ```bash
   cd /home/user/EINFO/server
   npm install
   npm start &
   ```

4. **Admin Panel öffnen:**
   ```
   http://localhost:5010/admin-panel
   ```

### Test-Durchführung

1. **Simulation starten:**
   - Im Admin Panel: "Chatbot starten" klicken
   - Szenario auswählen: "Hochwasser - Grundübung"
   - "Simulation starten" klicken

2. **Szenario-Konfiguration prüfen:**
   - Scrolle zu "Szenario-Konfiguration"
   - Prüfe dass angezeigt wird:
     - Art des Ereignisses: **Hochwasser** (nicht "Unbekannt")
     - Geografischer Bereich: **Musterstadt** (nicht "Nicht definiert")

3. **Erste Steps ausführen:**
   - Klicke 3x auf "Nächster Schritt"
   - Warte jeweils auf Abschluss

4. **Operations prüfen:**
   ```bash
   # Protokoll-Einträge zählen:
   cat /home/user/EINFO/server/data/protocol.json | jq 'length'
   # Erwartung: > 0 (mindestens einige Einträge)

   # Board-Einsatzstellen zählen:
   cat /home/user/EINFO/server/data/board.json | jq '.columns | to_entries | map(.value.items | length) | add'
   # Erwartung: > 1 (mindestens einige Einsatzstellen)

   # Aufgaben zählen (für alle Rollen):
   ls /home/user/EINFO/server/data/Aufg_board_*.json | while read f; do echo "$f: $(jq '.items | length' $f)"; done
   # Erwartung: Mindestens bei einer Rolle > 0 Aufgaben
   ```

5. **Logs prüfen:**
   ```bash
   # Sanitization-Logs:
   grep -E "sanitized|normalisiert" /home/user/EINFO/server/logs/chatbot_worker.log

   # LLM Operations-Logs:
   grep "LLM-Operations normalisiert" /home/user/EINFO/chatbot/logs/chatbot.log
   ```

---

## ✅ Erfolgs-Kriterien

### Must-Have (Critical):

- [ ] **Keine verworfenen Operations** wegen anvon=null
- [ ] **Keine verworfenen Operations** wegen assignedBy
- [ ] **Keine Abstürze** bei Array-Format
- [ ] **Szenario-Konfiguration** wird angezeigt

### Should-Have (Important):

- [ ] **Mindestens 3 Protokoll-Einträge** nach 3 Steps
- [ ] **Mindestens 1 Einsatzstelle** erstellt
- [ ] **Mindestens 1 Aufgabe** erstellt
- [ ] **Logs zeigen Sanitization** (wenn LLM falsche Formate liefert)

### Nice-to-Have (Optional):

- [ ] **Performance** < 15s pro Step
- [ ] **Keine ERROR-Logs** außer erwarteten Array-Detections
- [ ] **Vollständige Audit-Trail** in chatbot.log

---

## 🐛 Bekannte Limitationen

1. **LLM-Abhängigkeit:** Fixes funktionieren nur wenn LLM überhaupt antwortet
2. **Ollama muss laufen:** Ohne Ollama keine LLM-Calls möglich
3. **Experimenteller Modus:** Fixes betreffen nur normale Simulation, nicht `experimental_szenariopack`
4. **Netzwerk-Timeouts:** Bei langsamen LLM-Responses können Timeouts auftreten

---

## 📊 Test-Report Template

Nach Test-Durchführung:

```markdown
# Test-Report: LLM Operations Format Fixes

**Datum:** [Datum]
**Tester:** [Name]
**Branch:** claude/fix-llm-operations-format-28F28

## Ergebnisse

| Test | Status | Anmerkungen |
|------|--------|-------------|
| Test 1: Array→Objekt | ✅/❌ | |
| Test 2: assignedBy | ✅/❌ | |
| Test 3: anvon=null | ✅/❌ | |
| Test 4: from/sender | ✅/❌ | |
| Test 5: id→incidentId | ✅/❌ | |
| Test 6: analysis/meta | ✅/❌ | |
| Test 7: Szenario-Config | ✅/❌ | |

## Statistiken

- Simulierte Steps: [Anzahl]
- Erstellte Protokolle: [Anzahl]
- Erstellte Einsatzstellen: [Anzahl]
- Erstellte Aufgaben: [Anzahl]
- Verworfene Operations: [Anzahl]

## Logs

[Relevante Log-Auszüge hier einfügen]

## Fazit

[Zusammenfassung: Funktioniert / Funktioniert nicht / Teilweise]
```

---

## 📞 Support

Bei Problemen:
1. Logfiles prüfen: `/home/user/EINFO/chatbot/logs/chatbot.log`
2. Worker-Logs prüfen: `/home/user/EINFO/server/logs/chatbot_worker.log`
3. Ollama-Status: `curl http://localhost:11434/api/tags`
4. GitHub Issue erstellen mit Log-Auszügen
