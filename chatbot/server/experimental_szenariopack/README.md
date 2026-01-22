# Experimental ScenarioPack (entfernbar)

Dieses Verzeichnis enthält ein experimentelles, vollständig entfernbares Szenario-Pack für eine deterministische, tick-basierte Hochwasser-Simulation.

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
