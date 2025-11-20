import crypto from "node:crypto";

const MODE_ALIASES = new Map([
  ["time", "time"],
  ["uhrzeit", "time"],
  ["clock", "time"],
  ["daily", "time"],
  ["daily-at", "time"],
  ["interval", "interval"],
  ["intervall", "interval"],
]);

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function normalizeApiMode(value) {
  if (typeof value !== "string") return "interval";
  const normalized = value.trim().toLowerCase();
  if (MODE_ALIASES.has(normalized)) return MODE_ALIASES.get(normalized);
  return "interval";
}

export function normalizeTimeOfDay(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hh = match[1].padStart(2, "0");
  const mm = match[2].padStart(2, "0");
  return `${hh}:${mm}`;
}

function normalizeMethod(value) {
  if (typeof value !== "string") return "GET";
  const upper = value.trim().toUpperCase();
  return ALLOWED_METHODS.includes(upper) ? upper : "GET";
}

export function sanitizeApiScheduleEntry(entry, { defaultIntervalMinutes, minIntervalMinutes }) {
  const mode = normalizeApiMode(entry?.mode);
  const intervalRaw = Number(entry?.intervalMinutes ?? entry?.interval ?? defaultIntervalMinutes);
  const intervalMinutes = Number.isFinite(intervalRaw)
    ? Math.max(minIntervalMinutes, Math.floor(intervalRaw))
    : defaultIntervalMinutes;

  return {
    id: typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : crypto.randomUUID(),
    label: typeof entry?.label === "string" ? entry.label.trim() : "",
    url: typeof entry?.url === "string" ? entry.url.trim() : "",
    method: normalizeMethod(entry?.method),
    body: typeof entry?.body === "string" ? entry.body : "",
    mode,
    intervalMinutes,
    timeOfDay: mode === "time" ? normalizeTimeOfDay(entry?.timeOfDay ?? entry?.time ?? entry?.clock) : null,
    enabled: entry?.enabled === false ? false : true,
    lastRunAt: (() => {
      const ts = Number(entry?.lastRunAt);
      return Number.isFinite(ts) ? ts : null;
    })(),
  };
}

export function validateApiScheduleEntry(entry, { minIntervalMinutes }) {
  if (!entry.url) return "URL fehlt.";
  try {
    const parsed = new URL(entry.url);
    if (![`http:`, `https:`].includes(parsed.protocol)) {
      return "Nur http/https URLs erlaubt.";
    }
  } catch (_err) {
    return "Ungültige URL.";
  }

  if (!ALLOWED_METHODS.includes(entry.method)) return "Ungültige HTTP-Methode.";

  if (entry.mode === "time") {
    if (!entry.timeOfDay) return "Uhrzeit im Format HH:MM benötigt.";
  }
  if (entry.mode === "interval") {
    const minutes = Number(entry.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes < minIntervalMinutes) {
      return `Intervall muss mindestens ${minIntervalMinutes} Minute(n) betragen.`;
    }
  }
  return null;
}

export function shouldCallApiNow(entry, { now = Date.now(), defaultIntervalMinutes, minIntervalMinutes }) {
  if (!entry?.enabled) return false;
  if (!entry.url) return false;
  const normalizedMode = normalizeApiMode(entry.mode);
  if (normalizedMode === "time") {
    const timeValue = normalizeTimeOfDay(entry.timeOfDay);
    if (!timeValue) return false;
    const [hh, mm] = timeValue.split(":").map((v) => Number(v));
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    const targetMs = target.getTime();
    const last = Number(entry.lastRunAt);
    if (now >= targetMs && (!Number.isFinite(last) || last < targetMs)) return true;
    return false;
  }

  const intervalMinutes = Number.isFinite(Number(entry.intervalMinutes))
    ? Math.max(minIntervalMinutes, Math.floor(entry.intervalMinutes))
    : defaultIntervalMinutes;
  const intervalMs = intervalMinutes * 60_000;
  const last = Number(entry.lastRunAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= intervalMs;
}

async function callScheduledApi(entry, { fetchImpl, timeoutMs = 10_000 }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch nicht verfügbar");
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const opts = { method: entry.method || "GET" };
    if (controller) opts.signal = controller.signal;
    if (entry.body && entry.method !== "GET") {
      opts.body = entry.body;
      opts.headers = { "Content-Type": "application/json" };
    }
    const res = await fetchImpl(entry.url, opts);
    if (!res?.ok) {
      throw new Error(`HTTP ${res?.status || ""}`.trim());
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createApiScheduleRunner({
  scheduleFile,
  defaultIntervalMinutes,
  minIntervalMinutes,
  sweepIntervalMs,
  appendError,
  readJson,
  writeJson,
  fetchImpl = globalThis?.fetch,
  nowProvider = () => Date.now(),
}) {
  let apiScheduleTimer = null;
  let apiScheduleRunning = false;

  const sanitize = (entry) => sanitizeApiScheduleEntry(entry, { defaultIntervalMinutes, minIntervalMinutes });

  async function readApiSchedule() {
    const raw = await readJson(scheduleFile, []);
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const normalized = [];
    for (const entry of list) {
      const next = sanitize(entry);
      if (!next.id || seen.has(next.id)) {
        next.id = crypto.randomUUID();
      }
      seen.add(next.id);
      normalized.push(next);
    }
    return normalized;
  }

  async function writeApiSchedule(next = []) {
    const normalized = Array.isArray(next) ? next.map((entry) => sanitize(entry)) : [];
    await writeJson(scheduleFile, normalized);
    return normalized;
  }

  async function runApiScheduleSweep() {
    if (apiScheduleRunning) return;
    apiScheduleRunning = true;
    try {
      const schedules = await readApiSchedule();
      if (!schedules.length) return;
      const now = nowProvider();
      let changed = false;
      const updated = [];
      for (const entry of schedules) {
        const normalized = sanitize(entry);
        if (shouldCallApiNow(normalized, { now, defaultIntervalMinutes, minIntervalMinutes })) {
          try {
            await callScheduledApi(normalized, { fetchImpl });
            normalized.lastRunAt = now;
            changed = true;
          } catch (err) {
            await appendError("api-schedule/call", err, { id: normalized.id, url: normalized.url });
          }
        }
        updated.push(normalized);
      }
      if (changed) {
        await writeApiSchedule(updated);
      }
    } finally {
      apiScheduleRunning = false;
    }
  }

  function clearApiScheduleTimer() {
    if (apiScheduleTimer) {
      clearInterval(apiScheduleTimer);
      apiScheduleTimer = null;
    }
  }

  async function startApiScheduleTimer({ immediate = false } = {}) {
    clearApiScheduleTimer();
    const runner = async () => {
      try {
        await runApiScheduleSweep();
      } catch (err) {
        await appendError("api-schedule/run", err);
      }
    };
    apiScheduleTimer = setInterval(runner, sweepIntervalMs);
    apiScheduleTimer.unref?.();
    if (immediate) await runner();
  }

  return {
    readApiSchedule,
    writeApiSchedule,
    runApiScheduleSweep,
    startApiScheduleTimer,
    clearApiScheduleTimer,
    sanitize,
  };
}

