import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { generateWeatherFileIfWarning } from "../utils/weatherWarning.mjs";

const isoKey = (date) => date.toISOString().slice(0, 10);

function formatDottedDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

test("schreibt Wetterwarnungs-Daten und erzeugt Datei bei aktueller Warnung", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const mailDir = path.join(tempDir, "mail");
  const outFile = path.join(tempDir, "weather-incidents.txt");
  const warningDateFile = path.join(tempDir, "warning-dates.txt");
  const categoryFile = path.join(tempDir, "categories.json");

  await mkdir(mailDir, { recursive: true });
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const today = new Date();
  const mailContent = `From: Tauernwetter\nDate: ${today.toUTCString()}\n\nWarnung für:\n${formatDottedDate(today)}\n`;
  await writeFile(path.join(mailDir, "mail1.eml"), mailContent, "utf8");

  const incidents = [
    { ort: "Testdorf", kategorie: "Sturm" },
    { ort: "Anders", kategorie: "Anderes" },
  ];

  await generateWeatherFileIfWarning({
    incidents,
    categoryFile,
    outFile,
    mailDir,
    warningDateFile,
  });

  const dateContent = await readFile(warningDateFile, "utf8");
  assert.ok(dateContent.includes(isoKey(today)), "Datumsdatei enthält aktuelles Datum");

  const incidentsContent = await readFile(outFile, "utf8");
  assert.ok(incidentsContent.includes("Testdorf"));
  assert.ok(!incidentsContent.includes("Anders"));
});

test("entfernt Ausgabe aber aktualisiert Datumsfile ohne Warnung heute", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const mailDir = path.join(tempDir, "mail");
  const outFile = path.join(tempDir, "weather-incidents.txt");
  const warningDateFile = path.join(tempDir, "warning-dates.txt");

  await mkdir(mailDir, { recursive: true });

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const mailContent = `From: Tauernwetter\n\nWarnung für:\n${formatDottedDate(tomorrow)}\n`;
  await writeFile(path.join(mailDir, "mail2.eml"), mailContent, "utf8");

  await writeFile(outFile, "alte daten", "utf8");

  await generateWeatherFileIfWarning({
    incidents: [],
    categoryFile: path.join(tempDir, "categories.json"),
    outFile,
    mailDir,
    warningDateFile,
  });

  const dateContent = await readFile(warningDateFile, "utf8");
  assert.ok(dateContent.includes(isoKey(tomorrow)), "Datumsdatei enthält zukünftige Warnung");

  await assert.rejects(stat(outFile), { code: "ENOENT" });
});
