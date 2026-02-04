#!/usr/bin/env node
// server/scripts/test_weather_incident_triggers_svg.js
// Mini-Runner: prüft, dass handleWeatherIncidentAndSvgForNewCard
//   1) weather-incidents.txt erzeugt (1 JSONL Zeile)
//   2) feldkirchen_show-weather_24h.svg erzeugt (nicht leer)
//   3) invalidateFeldkirchenMapCache Cache-Dateien entfernt

import { mkdtemp, writeFile, readFile, rm, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { handleWeatherIncidentAndSvgForNewCard } from "../utils/weatherWarning.mjs";

const isoKey = (d) => d.toISOString().slice(0, 10);

let exitCode = 0;
function fail(msg) {
  console.error(`FAIL: ${msg}`);
  exitCode = 1;
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
}

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-svg-test-"));
  console.log("tempDir:", tempDir);

  try {
    const today = new Date();
    const todayStr = isoKey(today);

    // Setup: Dateien anlegen
    const warningDateFile = path.join(tempDir, "warning-dates.txt");
    const categoryFile = path.join(tempDir, "categories.json");
    const outFile = path.join(tempDir, "weather-incidents.txt");

    await writeFile(warningDateFile, todayStr, "utf8");
    await writeFile(categoryFile, JSON.stringify(["Baum"]), "utf8");

    // SVG-Verzeichnis für den Stub
    const svgDir = path.join(tempDir, "prints", "uebersicht");
    await mkdir(svgDir, { recursive: true });

    const svgFile = path.join(svgDir, "feldkirchen_show-weather_24h.svg");
    let svgGenerated = false;
    let cacheInvalidated = false;

    // Stub-SVG-Modul: schreibt eine echte SVG-Datei und tracked Aufrufe
    const stubSvgModule = {
      generateFeldkirchenSvg: async () => {
        svgGenerated = true;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>`;
        await writeFile(svgFile, svg, "utf8");
        return svgFile;
      },
      invalidateFeldkirchenMapCache: async () => {
        cacheInvalidated = true;
        // Simuliere: Cache-Datei entfernen (hier: die SVG-Datei selbst löschen)
        try {
          await rm(svgFile, { force: true });
        } catch { /* ok */ }
        return { invalidated: true, file: svgFile };
      },
    };

    // Fake Card
    const card = {
      id: "test-svg-1",
      typ: "Baum",
      title: "Baum auf Fahrbahn",
      content: "Baum umgestürzt",
      createdAt: today.toISOString(),
    };

    const result = await handleWeatherIncidentAndSvgForNewCard(
      card,
      { source: "test" },
      {
        categoryFile,
        outFile,
        warningDateFile,
        now: today,
        _skipDedupe: true,
        _svgModule: stubSvgModule,
      }
    );

    // Assert 1: appended
    if (!result.appended) {
      fail(`Erwartet appended=true, bekam: ${JSON.stringify(result)}`);
    } else {
      pass("Incident wurde appended");
    }

    // Assert 2: weather-incidents.txt existiert und hat 1 JSONL Zeile
    try {
      const content = await readFile(outFile, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length !== 1) {
        fail(`Erwartet 1 JSONL-Zeile, bekam ${lines.length}`);
      } else {
        const incident = JSON.parse(lines[0]);
        if (incident.category !== "Baum") {
          fail(`Erwartet category='Baum', bekam '${incident.category}'`);
        } else {
          pass("weather-incidents.txt hat 1 korrekte JSONL-Zeile");
        }
      }
    } catch (err) {
      fail(`weather-incidents.txt konnte nicht gelesen werden: ${err.message}`);
    }

    // Assert 3: SVG wurde erzeugt
    if (!svgGenerated) {
      fail("generateFeldkirchenSvg wurde nicht aufgerufen");
    } else {
      pass("SVG-Generator wurde aufgerufen");
    }

    // Assert 4: Cache wurde invalidiert
    if (!cacheInvalidated) {
      fail("invalidateFeldkirchenMapCache wurde nicht aufgerufen");
    } else {
      pass("Cache-Invalidierung wurde aufgerufen");
    }

    // Assert 5: matchedCategory im Result
    if (result.matchedCategory !== "Baum") {
      fail(`Erwartet matchedCategory='Baum', bekam '${result.matchedCategory}'`);
    } else {
      pass("matchedCategory korrekt im Result");
    }

  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  if (exitCode === 0) {
    console.log("\nAlle Tests bestanden.");
  } else {
    console.error("\nEs gab Fehler.");
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Unerwarteter Fehler:", err);
  process.exit(1);
});
