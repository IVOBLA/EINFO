# Experimental ScenarioPack (entfernbar)

Dieses Verzeichnis enthält ein experimentelles, vollständig entfernbares Szenario-Pack für eine deterministische, tick-basierte Hochwasser-Simulation mit Hybrid-Flow (Weltkern + LLM).

## Aktivieren

```bash
EINFO_EXPERIMENTAL_SCENARIOPACK=1 node server/index.js
```

## Deaktivieren

* ENV-Flag entfernen.

## Deinstallieren

1. Ordner `chatbot/server/experimental_szenariopack/` löschen.
2. Falls vorhanden: die **eine** Import-Änderung in `chatbot/server/index.js` zurücksetzen (Adapter → ursprüngliche `sim_loop.js`).

## Kompatibilität

* Das Operations-JSON bleibt im bestehenden Format.
* Der Worker bleibt kompatibel, keine Änderungen an Datenformaten nötig.

## Hinweis zur Integration

Die Aktivierung erfolgt ausschließlich über `EINFO_EXPERIMENTAL_SCENARIOPACK=1`. Ohne Flag verhält sich die Simulation wie zuvor.

## Hybrid-Flow (World Engine + LLM)

1. **World Engine (deterministisch)**: Das ScenarioPack definiert die Weltentwicklung (Pegelkurve, Wetter, Startressourcen, Zonen). Der Weltkern ist die Source of Truth.
2. **LLM pro Tick**: Pro Tick erhält das LLM den kompakten Weltstatus (NOW/DELTA/FORECAST), EINFO-Stand inkl. Deltas, offene Rückfragen und ein Budget für Operationen. Daraus leitet es *nur* Operations ab.
3. **Guardrails**: Serverseitig finden Validierung, Rollenfilter, Dedupe, Budgets und ein sparsamer Fallback statt, damit die Ausgabe stabil bleibt.

## Szenario-Control im Prompt

`prompts.js` darf nicht verändert werden. Deshalb werden die Weltinformationen als **String** in `llmInput.scenarioControl` eingebracht. Dieser String enthält kompakt:

* WORLD_NOW / WORLD_DELTA / WORLD_FORECAST (JSON)
* ACTIVE_EFFECTS (JSON)
* TASK_DELTA_SUMMARY (max. 10 Einträge)
* ACTION_BUDGET (JSON)
* CONSTRAINTS (bullet list)

## Effekt-Schema (User-Tasks → kontrollierter Einfluss)

Effekte dürfen **nur** aus Task-Deltas entstehen (neue/aktualisierte Tasks seit dem letzten Tick). Effekte werden validiert, begrenzt und verfallen nach TTL.

Schema (whitelist):

```json
{
  "effects": [
    { "typ": "resource_reservation", "ressource": "pumpen|bagger|sandsack_fueller", "deltaReserviert": 1, "dauerTicks": 3, "begruendung": "", "sourceTaskId": "..." },
    { "typ": "risk_modifier", "domain": "damm|strom|zone:Z1|zone:Z2|zone:Z3", "delta": -0.1, "dauerTicks": 2, "begruendung": "", "sourceTaskId": "..." },
    { "typ": "info_gain", "thema": "...", "reliability": "low|med|high", "dauerTicks": 2, "begruendung": "", "sourceTaskId": "..." }
  ]
}
```

Regeln:
* Effekte beeinflussen **nicht** die Pegelkurve, nur abgeleitete Felder (Risiko/Verfügbarkeit/Info).
* Ohne Task-Delta werden keine neuen Effekte angenommen.
* TTL/Verfall ist Pflicht und wird serverseitig durchgesetzt.
