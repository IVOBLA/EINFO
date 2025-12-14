import test from "node:test";
import assert from "node:assert/strict";

import {
  createApiScheduleRunner,
  sanitizeApiScheduleEntry,
  shouldCallApiNow,
} from "../utils/apiSchedule.mjs";

const API_OPTIONS = { defaultIntervalMinutes: 60, minIntervalMinutes: 1 };

function buildBaseEntry(overrides = {}) {
  return sanitizeApiScheduleEntry(
    {
      id: "demo",
      url: "https://example.com/hook",
      ...overrides,
    },
    API_OPTIONS,
  );
}

test("shouldCallApiNow respects time-based schedules once per day", () => {
  const now = Date.UTC(2024, 0, 2, 8, 30, 0);
  const morningTime = "08:00";
  const firstRun = buildBaseEntry({ mode: "time", timeOfDay: morningTime, lastRunAt: null });
  assert.equal(
    shouldCallApiNow(firstRun, { now, ...API_OPTIONS }),
    true,
    "first run should trigger",
  );

  const sentToday = { ...firstRun, lastRunAt: Date.UTC(2024, 0, 2, 8, 5, 0) };
  assert.equal(
    shouldCallApiNow(sentToday, { now, ...API_OPTIONS }),
    false,
    "must not re-run on same day after triggering",
  );

  const sentYesterday = { ...firstRun, lastRunAt: Date.UTC(2024, 0, 1, 8, 5, 0) };
  assert.equal(
    shouldCallApiNow(sentYesterday, { now, ...API_OPTIONS }),
    true,
    "should run again on the next day",
  );
});

test("runApiScheduleSweep calls due URLs and persists lastRunAt", async () => {
  let now = Date.UTC(2024, 0, 1, 12, 0, 0);
  let storage = [
    buildBaseEntry({ id: "interval", mode: "interval", intervalMinutes: 15, lastRunAt: null }),
  ];
  const calledUrls = [];

  const runner = createApiScheduleRunner({
    scheduleFile: "/data/conf/api-schedule.json",
    defaultIntervalMinutes: API_OPTIONS.defaultIntervalMinutes,
    minIntervalMinutes: API_OPTIONS.minIntervalMinutes,
    sweepIntervalMs: 1000,
    appendError: async () => {},
    readJson: async () => storage,
    writeJson: async (_file, next) => {
      storage = next;
      return next;
    },
    fetchImpl: async (url) => {
      calledUrls.push(url);
      return { ok: true, status: 200 };
    },
    nowProvider: () => now,
  });

  await runner.runApiScheduleSweep();
  assert.equal(calledUrls.length, 1);
  assert.equal(storage[0].lastRunAt, now);

  await runner.runApiScheduleSweep();
  assert.equal(calledUrls.length, 1, "should not re-run before interval passes");

  now += 16 * 60 * 1000;
  await runner.runApiScheduleSweep();
  assert.equal(calledUrls.length, 2, "should run again after interval elapsed");
  assert.equal(storage[0].lastRunAt, now);
});

test("runApiScheduleSweep serializes object bodies to JSON", async () => {
  let now = Date.UTC(2024, 0, 1, 10, 0, 0);
  const bodyPayload = { hello: "world", answer: 42 };
  let storage = [
    buildBaseEntry({
      id: "json", mode: "interval", intervalMinutes: 5, lastRunAt: null, body: bodyPayload,
    }),
  ];
  const receivedBodies = [];
  const receivedMethods = [];

  const runner = createApiScheduleRunner({
    scheduleFile: "/data/conf/api-schedule.json",
    defaultIntervalMinutes: API_OPTIONS.defaultIntervalMinutes,
    minIntervalMinutes: API_OPTIONS.minIntervalMinutes,
    sweepIntervalMs: 1000,
    appendError: async () => {},
    readJson: async () => storage,
    writeJson: async (_file, next) => {
      storage = next;
      return next;
    },
    fetchImpl: async (_url, opts) => {
      receivedBodies.push(opts?.body);
      receivedMethods.push(opts?.method);
      return { ok: true, status: 200 };
    },
    nowProvider: () => now,
  });

  await runner.runApiScheduleSweep();
  assert.deepEqual(receivedBodies, [JSON.stringify(bodyPayload)]);
  assert.deepEqual(receivedMethods, ["POST"]);
});

