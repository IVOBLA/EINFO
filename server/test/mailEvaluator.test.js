import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMail, parseRawMail, readAndEvaluateInbox } from "../utils/mailEvaluator.mjs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TEMP_DIR = path.join(os.tmpdir(), "kanban-mail-test");

async function ensureTempMailDir() {
  await fsp.rm(TEMP_DIR, { recursive: true, force: true });
  await fsp.mkdir(TEMP_DIR, { recursive: true });
}

test("parseRawMail extrahiert Header und Body", () => {
  const raw = [
    "Subject: Testmail",
    "From: Demo <demo@example.com>",
    "To: unit@example.com",
    "Date: Wed, 01 Jan 2020 12:00:00 +0000",
    "",
    "Dies ist der Body der Mail.",
    "Mit zweiter Zeile.",
  ].join("\n");

  const parsed = parseRawMail(raw, { id: "mail1", file: "demo.eml" });
  assert.equal(parsed.subject, "Testmail");
  assert.equal(parsed.from, "Demo <demo@example.com>");
  assert.equal(parsed.to, "unit@example.com");
  assert.ok(parsed.body.includes("Mit zweiter Zeile."));
  assert.equal(parsed.id, "mail1");
  assert.equal(parsed.file, "demo.eml");
  assert.ok(parsed.date);
});

test("parseRawMail dekodiert Base64-Text aus Multipart-Mails", () => {
  const plainText = "Dies ist der Klartext.";
  const encoded = Buffer.from(plainText, "utf8").toString("base64");
  const raw = [
    "Subject: Base64-Mail",
    "From: Demo <demo@example.com>",
    "Content-Type: multipart/alternative; boundary=XYZ123",
    "",
    "--XYZ123",
    "Content-Type: text/plain; charset=\"utf-8\"",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
    "--XYZ123--",
  ].join("\n");

  const parsed = parseRawMail(raw, { id: "mail2" });
  assert.equal(parsed.body, plainText);
  assert.equal(parsed.text, plainText);
});

test("parseRawMail dekodiert quoted-printable mit Charset", () => {
  const raw = [
    "Subject: Grüße",
    "From: Demo <demo@example.com>",
    "Content-Type: text/plain; charset=ISO-8859-1",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Gr=FC=DFe aus dem Test",
  ].join("\n");

  const parsed = parseRawMail(raw, { id: "mail3" });
  assert.equal(parsed.body, "Grüße aus dem Test");
});

test("parseRawMail dekodiert verdächtige Base64-Bodies ohne Encoding-Header", () => {
  const plainText = "Lesbarer Inhalt ohne Encoding-Header.";
  const encoded = Buffer.from(plainText, "utf8").toString("base64");
  const raw = [
    "Subject: Fehlender Header",
    "From: Demo <demo@example.com>",
    "", // kein Content-Transfer-Encoding gesetzt
    encoded,
  ].join("\n");

  const parsed = parseRawMail(raw, { id: "mail3b" });
  assert.equal(parsed.body, plainText);
});

test("evaluateMail markiert passende Regeln", () => {
  const mail = {
    subject: "Unwetterwarnung",
    body: "Bitte beachten Sie die Warnung",
    from: "leitstelle@example.com",
  };

  const rules = [
    { name: "Warnung", patterns: [/warnung/i], fields: ["subject", "body"], weight: 2 },
    { name: "Absender", patterns: [/leitstelle/i], fields: ["from"], weight: 1 },
  ];

  const result = evaluateMail(mail, rules);
  assert.equal(result.score, 3);
  assert.equal(result.matches.length, 2);
});

test("readAndEvaluateInbox liest Mails aus dem Postfach", async () => {
  await ensureTempMailDir();
  const sampleFile = path.join(TEMP_DIR, "20240101-0001.eml");
  await fsp.writeFile(sampleFile, [
    "Subject: Einsatz",
    "From: Leitstelle <leitstelle@example.com>",
    "",
    "Stichwort: Alarm",
  ].join("\n"), "utf8");

  const result = await readAndEvaluateInbox({ mailDir: TEMP_DIR, rules: [
    { name: "Einsatz", patterns: [/einsatz/i], fields: ["subject"], weight: 1 },
    { name: "Alarm", patterns: [/alarm/i], fields: ["body"], weight: 1 },
  ] });

  assert.equal(result.mails.length, 1);
  assert.equal(result.mails[0].evaluation.score, 2);
});

test("readAndEvaluateInbox filtert Absender anhand von allowedFrom", async () => {
  await ensureTempMailDir();

  const allowedFile = path.join(TEMP_DIR, "20240101-0002.eml");
  const blockedFile = path.join(TEMP_DIR, "20240101-0003.eml");

  await fsp.writeFile(allowedFile, [
    "Subject: Alarm",
    "From: Leitstelle <leitstelle@example.com>",
    "",
    "Einsatzalarm",
  ].join("\n"), "utf8");

  await fsp.writeFile(blockedFile, [
    "Subject: Info",
    "From: Unbekannt <spam@example.com>",
    "",
    "Test",
  ].join("\n"), "utf8");

  const result = await readAndEvaluateInbox({
    mailDir: TEMP_DIR,
    rules: [{ name: "Alarm", patterns: [/alarm/i], fields: ["subject"], weight: 1 }],
    allowedFrom: ["leitstelle@example.com"],
  });

  assert.equal(result.mails.length, 1);
  assert.equal(result.mails[0].from, "Leitstelle <leitstelle@example.com>");
  assert.equal(result.mails[0].evaluation.score, 1);
});

test("readAndEvaluateInbox erkennt erlaubte Absender auch ohne sauberes From-Header-Parsing", async () => {
  await ensureTempMailDir();

  const noisyHeaderFile = path.join(TEMP_DIR, "20240101-0004.eml");
  await fsp.writeFile(noisyHeaderFile, [
    "Subject: Alarm",
    "From: Leitstelle leitstelle@example.com (Alarmierung)",
    "",
    "Einsatzalarm",
  ].join("\n"), "utf8");

  const result = await readAndEvaluateInbox({
    mailDir: TEMP_DIR,
    rules: [{ name: "Alarm", patterns: [/alarm/i], fields: ["subject"], weight: 1 }],
    allowedFrom: ["leitstelle@example.com"],
  });

  assert.equal(result.mails.length, 1);
  assert.equal(result.mails[0].from, "Leitstelle leitstelle@example.com (Alarmierung)");
  assert.equal(result.mails[0].evaluation.score, 1);
});

test("readAndEvaluateInbox blockiert nur scheinbar erlaubte Absender", async () => {
  await ensureTempMailDir();

  const commentSpoofFile = path.join(TEMP_DIR, "20240101-0005.eml");
  const subaddressSpoofFile = path.join(TEMP_DIR, "20240101-0006.eml");

  await fsp.writeFile(commentSpoofFile, [
    "Subject: Alarm",
    "From: Angreifer <bad@evil.com> (leitstelle@example.com)",
    "",
    "Einsatzalarm",
  ].join("\n"), "utf8");

  await fsp.writeFile(subaddressSpoofFile, [
    "Subject: Alarm",
    "From: leitstelle@example.com.attacker@evil.com",
    "",
    "Einsatzalarm",
  ].join("\n"), "utf8");

  const result = await readAndEvaluateInbox({
    mailDir: TEMP_DIR,
    rules: [{ name: "Alarm", patterns: [/alarm/i], fields: ["subject"], weight: 1 }],
    allowedFrom: ["leitstelle@example.com"],
  });

  assert.equal(result.mails.length, 0);
});
