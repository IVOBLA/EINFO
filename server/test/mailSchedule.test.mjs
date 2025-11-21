import test from "node:test";
import assert from "node:assert/strict";

import {
  createMailScheduleRunner,
  sanitizeMailScheduleEntry,
  shouldSendMailNow,
} from "../utils/mailSchedule.mjs";

const MAIL_OPTIONS = { defaultIntervalMinutes: 60, minIntervalMinutes: 1 };

function buildBaseEntry(overrides = {}) {
  return sanitizeMailScheduleEntry(
    {
      id: "demo",
      to: "demo@example.com",
      subject: "Hallo",
      text: "Test",
      ...overrides,
    },
    MAIL_OPTIONS,
  );
}

test("shouldSendMailNow respects time-based schedules once per day", () => {
  const now = Date.UTC(2024, 0, 2, 8, 30, 0);
  const morningTime = "08:00";
  const firstRun = buildBaseEntry({ mode: "time", timeOfDay: morningTime, lastSentAt: null });
  assert.equal(
    shouldSendMailNow(firstRun, { now, ...MAIL_OPTIONS }),
    true,
    "first run should trigger",
  );

  const sentToday = { ...firstRun, lastSentAt: Date.UTC(2024, 0, 2, 8, 5, 0) };
  assert.equal(
    shouldSendMailNow(sentToday, { now, ...MAIL_OPTIONS }),
    false,
    "must not re-send on same day after sending",
  );

  const sentYesterday = { ...firstRun, lastSentAt: Date.UTC(2024, 0, 1, 8, 5, 0) };
  assert.equal(
    shouldSendMailNow(sentYesterday, { now, ...MAIL_OPTIONS }),
    true,
    "should send again on the next day",
  );
});

test("sanitizeMailScheduleEntry preserves literal and aliased time modes", () => {
  const literalTime = buildBaseEntry({ mode: "time", timeOfDay: "7:05" });
  assert.equal(literalTime.mode, "time");
  assert.equal(literalTime.timeOfDay, "07:05");

  const aliasTime = buildBaseEntry({ mode: "uhrzeit", time: "9:30" });
  assert.equal(aliasTime.mode, "time");
  assert.equal(aliasTime.timeOfDay, "09:30");
});

test("runMailScheduleSweep sends due mails and persists lastSentAt", async () => {
  let now = Date.UTC(2024, 0, 1, 12, 0, 0);
  let storage = [
    buildBaseEntry({ id: "interval", mode: "interval", intervalMinutes: 15, lastSentAt: null }),
  ];
  const sentMails = [];

  const runner = createMailScheduleRunner({
    dataDir: "/data",
    scheduleFile: "/data/conf/mail-schedule.json",
    defaultIntervalMinutes: MAIL_OPTIONS.defaultIntervalMinutes,
    minIntervalMinutes: MAIL_OPTIONS.minIntervalMinutes,
    sweepIntervalMs: 1000,
    sendMail: async (mail) => sentMails.push(mail),
    isMailConfigured: () => true,
    appendError: async () => {},
    readJson: async () => storage,
    writeJson: async (_file, next) => {
      storage = next;
      return next;
    },
    nowProvider: () => now,
  });

  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 1);
  assert.equal(storage[0].lastSentAt, now);

  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 1, "should not re-send before interval passes");

  now += 16 * 60 * 1000;
  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 2, "should send after interval elapsed");
  assert.equal(storage[0].lastSentAt, now);
});

test("runMailScheduleSweep skips mails with missing attachments and logs when enabled", async () => {
  const baseEntry = buildBaseEntry({ id: "attachment", attachmentPath: "missing/report.pdf" });
  let storage = [baseEntry];
  const sentMails = [];
  const logMessages = [];

  const runner = createMailScheduleRunner({
    dataDir: "/data",
    scheduleFile: "/data/conf/mail-schedule.json",
    defaultIntervalMinutes: MAIL_OPTIONS.defaultIntervalMinutes,
    minIntervalMinutes: MAIL_OPTIONS.minIntervalMinutes,
    sweepIntervalMs: 1000,
    sendMail: async (mail) => sentMails.push(mail),
    isMailConfigured: () => true,
    appendError: async () => {},
    readJson: async () => storage,
    writeJson: async (_file, next) => {
      storage = next;
      return next;
    },
    nowProvider: () => Date.UTC(2024, 0, 1, 12, 0, 0),
    logMailEvent: async (message, context) => logMessages.push({ message, context }),
    isMailLoggingEnabled: true,
  });

  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 0, "should skip sending when attachment is missing");
  assert.equal(logMessages.length, 1, "should log a warning when mail logging is enabled");
  assert.equal(logMessages[0].message, "Geplanter Mail-Anhang fehlt");
  assert.equal(logMessages[0].context.attachmentPath, "/data/missing/report.pdf");

  const silentRunner = createMailScheduleRunner({
    dataDir: "/data",
    scheduleFile: "/data/conf/mail-schedule.json",
    defaultIntervalMinutes: MAIL_OPTIONS.defaultIntervalMinutes,
    minIntervalMinutes: MAIL_OPTIONS.minIntervalMinutes,
    sweepIntervalMs: 1000,
    sendMail: async (mail) => sentMails.push(mail),
    isMailConfigured: () => true,
    appendError: async () => {},
    readJson: async () => storage,
    writeJson: async (_file, next) => {
      storage = next;
      return next;
    },
    nowProvider: () => Date.UTC(2024, 0, 1, 12, 0, 0),
    logMailEvent: async (message, context) => logMessages.push({ message, context }),
    isMailLoggingEnabled: false,
  });

  await silentRunner.runMailScheduleSweep();
  assert.equal(logMessages.length, 1, "should not log when mail logging is disabled");
});
