import test from "node:test";
import assert from "node:assert/strict";

import {
  createMailScheduleRunner,
  sanitizeMailScheduleEntry,
  resolveAttachmentPath,
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

test("resolveAttachmentPath verhindert Path Traversal und akzeptiert gültige Pfade", () => {
  const baseDir = "/data";
  assert.equal(resolveAttachmentPath(baseDir, "reports/summary.pdf"), "/data/reports/summary.pdf");
  assert.equal(resolveAttachmentPath(baseDir, "../geheim.txt"), null);
  assert.equal(resolveAttachmentPath(baseDir, "/etc/passwd"), null);
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
  const baseEntry = buildBaseEntry({ id: "attachment", label: "TestJob", attachmentPath: "missing/report.pdf" });
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
  assert.match(logMessages[0].message, /ATTACHMENT_MISSING/);
  assert.equal(logMessages[0].context.attachmentPath, "missing/report.pdf");
  assert.equal(logMessages[0].context.resolvedPath, "/data/missing/report.pdf");
  assert.equal(logMessages[0].context.code, "ENOENT");
  assert.equal(logMessages[0].context.id, "attachment");
  assert.equal(logMessages[0].context.label, "TestJob");
  assert.equal(logMessages[0].context.to, "demo@example.com");

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

test("runMailScheduleSweep does not update lastSentAt when attachment is missing", async () => {
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  const baseEntry = buildBaseEntry({ id: "notsent", attachmentPath: "missing/file.pdf", lastSentAt: null });
  let storage = [baseEntry];
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
    logMailEvent: async () => {},
    isMailLoggingEnabled: true,
  });

  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 0, "mail must not be sent");
  assert.notEqual(storage[0].lastSentAt, now, "lastSentAt must not be set to current time when attachment is missing");
  assert.equal(storage[0].enabled, true, "job must stay enabled after attachment failure");
});

test("runMailScheduleSweep retries on next sweep when attachment was missing", async () => {
  let now = Date.UTC(2024, 0, 1, 12, 0, 0);
  const baseEntry = buildBaseEntry({ id: "retry", attachmentPath: "missing/file.pdf", lastSentAt: null });
  let storage = [baseEntry];
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
    logMailEvent: async () => {},
    isMailLoggingEnabled: true,
  });

  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 0, "first sweep: mail must not be sent (attachment missing)");

  now += 60_000;
  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 0, "second sweep: still not sent (attachment still missing)");
  assert.notEqual(storage[0].lastSentAt, now, "lastSentAt must not be updated across retries");
});

test("runMailScheduleSweep sends without attachment when attachmentPath is empty", async () => {
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  const baseEntry = buildBaseEntry({ id: "noattach", attachmentPath: "", lastSentAt: null });
  let storage = [baseEntry];
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
    logMailEvent: async () => {},
    isMailLoggingEnabled: true,
  });

  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 1, "mail must be sent without attachment");
  assert.deepEqual(sentMails[0].attachments, [], "attachments must be empty array");
  assert.equal(storage[0].lastSentAt, now, "lastSentAt must be updated");
});

test("runMailScheduleSweep blocks path traversal in attachmentPath and logs", async () => {
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  const baseEntry = buildBaseEntry({ id: "traversal", attachmentPath: "../../../etc/passwd", lastSentAt: null });
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
    nowProvider: () => now,
    logMailEvent: async (message, context) => logMessages.push({ message, context }),
    isMailLoggingEnabled: true,
  });

  await runner.runMailScheduleSweep();
  assert.equal(sentMails.length, 0, "mail must not be sent with path traversal");
  assert.equal(logMessages.length, 1, "should log path traversal attempt");
  assert.equal(logMessages[0].context.code, "INVALID_PATH");
  assert.equal(logMessages[0].context.resolvedPath, null);
});
