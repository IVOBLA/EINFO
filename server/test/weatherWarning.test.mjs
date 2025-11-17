import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { appendWeatherIncidentFromBoardEntry, collectWarningDatesFromMails } from "../utils/weatherWarning.mjs";

const isoKey = (date) => date.toISOString().slice(0, 10);

test("legt einen Wetter-Eintrag bei aktueller Warnung und Kategorie an", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const outFile = path.join(tempDir, "weather-incidents.txt");
  const warningDateFile = path.join(tempDir, "warning-dates.txt");
  const categoryFile = path.join(tempDir, "categories.json");
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const entry = { id: "a1", createdAt: today.toISOString(), description: "Heftiger Sturm im Ortsgebiet" };

  const result = await appendWeatherIncidentFromBoardEntry(entry, {
    categoryFile,
    outFile,
    warningDateFile,
    now: today,
  });

  assert.equal(result.appended, true);

  const incidentsContent = await readFile(outFile, "utf8");
  assert.ok(incidentsContent.includes(isoKey(today)));
  assert.ok(incidentsContent.toLowerCase().includes("sturm"));
});

test("legt keinen Eintrag ohne aktuelle Warnung an", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const outFile = path.join(tempDir, "weather-incidents.txt");
  const warningDateFile = path.join(tempDir, "warning-dates.txt");
  const categoryFile = path.join(tempDir, "categories.json");
  const today = new Date();

  await writeFile(warningDateFile, "2020-01-01", "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const entry = { id: "a2", createdAt: today.toISOString(), typ: "Sturm" };

  const result = await appendWeatherIncidentFromBoardEntry(entry, {
    categoryFile,
    outFile,
    warningDateFile,
    now: today,
  });

  assert.equal(result.appended, false);
  await assert.rejects(stat(outFile), { code: "ENOENT" });
});

test("extrahiert mehrere Warn-Daten aus 'Warnung für:' Zeile", () => {
  const currentYear = new Date().getFullYear();
  const mails = [
    {
      text: "Betreff\nWarnung für: 05.06., 06.06.24, 07.06.2024",
      date: `${currentYear}-05-31T12:00:00Z`,
    },
  ];

  const dates = collectWarningDatesFromMails(mails);

  assert.ok(dates.includes(`${currentYear}-06-05`), "Datum ohne Jahr wird erkannt");
  assert.ok(dates.includes("2024-06-06"), "Datum mit zweistelligem Jahr wird erkannt");
  assert.ok(dates.includes("2024-06-07"), "Datum mit vierstelligem Jahr wird erkannt");
});

test("fügt keine Duplikate hinzu", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const outFile = path.join(tempDir, "weather-incidents.txt");
  const warningDateFile = path.join(tempDir, "warning-dates.txt");
  const categoryFile = path.join(tempDir, "categories.json");
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const entry = { id: "a3", createdAt: today.toISOString(), content: "Sturmwarnung für Süden" };

  await appendWeatherIncidentFromBoardEntry(entry, { categoryFile, outFile, warningDateFile, now: today });
  await appendWeatherIncidentFromBoardEntry(entry, { categoryFile, outFile, warningDateFile, now: today });

  const lines = (await readFile(outFile, "utf8")).split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);
});
