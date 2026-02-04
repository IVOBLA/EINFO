import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  appendWeatherIncidentFromBoardEntry,
  collectWarningDatesFromMails,
  handleNewIncidentCard,
  handleWeatherIncidentAndSvgForNewCard,
  getWeatherHookDiagnose,
} from "../utils/weatherWarning.mjs";

const isoKey = (date) => date.toISOString().slice(0, 10);

// Stub-SVG-Modul, damit Tests keine echte Karte erzeugen
const noopSvgModule = {
  generateFeldkirchenSvg: async () => "/tmp/fake.svg",
  invalidateFeldkirchenMapCache: async () => ({ invalidated: false }),
};

function makeTestFiles(tempDir) {
  return {
    outFile: path.join(tempDir, "weather-incidents.txt"),
    warningDateFile: path.join(tempDir, "warning-dates.txt"),
    categoryFile: path.join(tempDir, "categories.json"),
  };
}

test("legt einen Wetter-Eintrag bei aktueller Warnung und Kategorie an", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
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

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
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

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const entry = { id: "a3", createdAt: today.toISOString(), content: "Sturmwarnung für Süden" };

  await appendWeatherIncidentFromBoardEntry(entry, { categoryFile, outFile, warningDateFile, now: today });
  await appendWeatherIncidentFromBoardEntry(entry, { categoryFile, outFile, warningDateFile, now: today });

  const lines = (await readFile(outFile, "utf8")).split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);
});

test("ID-Duplikat case-insensitive: 'A3' und 'a3' erzeugen nur 1 Zeile", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const entry1 = { id: "A3", createdAt: today.toISOString(), description: "Sturmwarnung Süd" };
  const entry2 = { id: "a3", createdAt: today.toISOString(), description: "Sturmwarnung Süd" };

  const r1 = await appendWeatherIncidentFromBoardEntry(entry1, { categoryFile, outFile, warningDateFile, now: today });
  const r2 = await appendWeatherIncidentFromBoardEntry(entry2, { categoryFile, outFile, warningDateFile, now: today });

  assert.equal(r1.appended, true);
  assert.equal(r2.appended, false);
  assert.equal(r2.reason, "duplicate");

  const lines = (await readFile(outFile, "utf8")).split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);
});

test("Fallback-Duplikat ohne ID: gleiche Meldung in anderer Schreibweise wird erkannt", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const entry1 = { description: "Heftiger STURM im Ortsgebiet" };
  const entry2 = { description: "heftiger sturm im ortsgebiet" };

  const r1 = await appendWeatherIncidentFromBoardEntry(entry1, { categoryFile, outFile, warningDateFile, now: today });
  const r2 = await appendWeatherIncidentFromBoardEntry(entry2, { categoryFile, outFile, warningDateFile, now: today });

  assert.equal(r1.appended, true);
  assert.equal(r2.appended, false);
  assert.equal(r2.reason, "duplicate");

  const lines = (await readFile(outFile, "utf8")).split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);
});

test("Kategorie mit Whitespace in JSON matcht korrekt", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-warning-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify([" Sturm "]), "utf8");

  const entry = { id: "ws-1", description: "sturmwarnung für den Bezirk" };

  const result = await appendWeatherIncidentFromBoardEntry(entry, { categoryFile, outFile, warningDateFile, now: today });

  assert.equal(result.appended, true);
  assert.ok(result.incident.category === "Sturm");
});

// ---------------------------------------------------------------------------
// handleNewIncidentCard – zentraler Hook
// ---------------------------------------------------------------------------

test("handleNewIncidentCard: source='ui' erzeugt Incident", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-hook-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const card = { id: "ui-1", createdAt: today.toISOString(), typ: "Sturm", title: "Sturmschaden Ort A" };

  const result = await handleNewIncidentCard(card, { source: "ui" }, {
    categoryFile, outFile, warningDateFile, now: today, _skipDedupe: true,
    _svgModule: noopSvgModule,
  });

  assert.equal(result.appended, true);
  assert.equal(result.source, "ui");

  const content = await readFile(outFile, "utf8");
  const incident = JSON.parse(content.trim());
  assert.equal(incident.source, "ui");
  assert.equal(incident.category, "Sturm");
});

test("handleNewIncidentCard: source='fetcher' erzeugt Incident", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-hook-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Baum"]), "utf8");

  const card = { id: "fetch-1", createdAt: today.toISOString(), typ: "Baum", description: "Baum auf Straße" };

  const result = await handleNewIncidentCard(card, { source: "fetcher" }, {
    categoryFile, outFile, warningDateFile, now: today, _skipDedupe: true,
    _svgModule: noopSvgModule,
  });

  assert.equal(result.appended, true);
  assert.equal(result.source, "fetcher");

  const content = await readFile(outFile, "utf8");
  const incident = JSON.parse(content.trim());
  assert.equal(incident.source, "fetcher");
  assert.equal(incident.category, "Baum");
});

test("handleNewIncidentCard: source='import' erzeugt Incident", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-hook-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Unwetter"]), "utf8");

  const card = { id: "imp-1", createdAt: today.toISOString(), description: "Unwetter Einsatz Süd" };

  const result = await handleNewIncidentCard(card, { source: "import" }, {
    categoryFile, outFile, warningDateFile, now: today, _skipDedupe: true,
    _svgModule: noopSvgModule,
  });

  assert.equal(result.appended, true);
  assert.equal(result.source, "import");
});

test("handleNewIncidentCard: Dedupe verhindert doppeltes Logging", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-hook-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const card = { id: "dedup-1", createdAt: today.toISOString(), typ: "Sturm" };
  const opts = { categoryFile, outFile, warningDateFile, now: today, _svgModule: noopSvgModule };

  const r1 = await handleNewIncidentCard(card, { source: "ui" }, opts);
  assert.equal(r1.appended, true);

  const r2 = await handleNewIncidentCard(card, { source: "import" }, opts);
  assert.equal(r2.appended, false);
  assert.equal(r2.reason, "deduped");

  const lines = (await readFile(outFile, "utf8")).split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);
});

test("handleNewIncidentCard: verschiedene Cards im gleichen Batch werden einzeln geloggt", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-hook-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm", "Baum"]), "utf8");

  const card1 = { id: "batch-1", createdAt: today.toISOString(), typ: "Sturm" };
  const card2 = { id: "batch-2", createdAt: today.toISOString(), typ: "Baum" };
  const opts = { categoryFile, outFile, warningDateFile, now: today, _svgModule: noopSvgModule };

  const r1 = await handleNewIncidentCard(card1, { source: "fetcher" }, opts);
  const r2 = await handleNewIncidentCard(card2, { source: "fetcher" }, opts);

  assert.equal(r1.appended, true);
  assert.equal(r2.appended, true);

  const lines = (await readFile(outFile, "utf8")).split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 2);
});

test("getWeatherHookDiagnose liefert lastHookCalls und dedupeSize", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "weather-hook-"));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  const { outFile, warningDateFile, categoryFile } = makeTestFiles(tempDir);
  const today = new Date();

  await writeFile(warningDateFile, isoKey(today), "utf8");
  await writeFile(categoryFile, JSON.stringify(["Sturm"]), "utf8");

  const card = { id: "diag-1", createdAt: today.toISOString(), typ: "Sturm" };
  await handleNewIncidentCard(card, { source: "ui" }, {
    categoryFile, outFile, warningDateFile, now: today, _skipDedupe: true,
    _svgModule: noopSvgModule,
  });

  const diag = getWeatherHookDiagnose();
  assert.ok(Array.isArray(diag.lastHookCalls));
  assert.ok(diag.lastHookCalls.length > 0);
  assert.equal(typeof diag.dedupeSize, "number");

  const last = diag.lastHookCalls[diag.lastHookCalls.length - 1];
  assert.equal(last.source, "ui");
  assert.equal(last.reason, "appended");
});
