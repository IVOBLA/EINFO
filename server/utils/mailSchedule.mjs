import fs from "fs/promises";
import path from "path";
import crypto from "node:crypto";

import { isMailLoggingEnabled as defaultMailLoggingEnabled, logMailEvent as defaultLogMailEvent } from "./mailLogger.mjs";

const MAIL_MODE_ALIASES = new Map([
  ["time", "time"],
  ["uhrzeit", "time"],
  ["clock", "time"],
  ["daily", "time"],
  ["daily-at", "time"],
  ["interval", "interval"],
]);

export function normalizeMailMode(value) {
  if (typeof value !== "string") return "interval";
  const normalized = value.trim().toLowerCase();
  if (MAIL_MODE_ALIASES.has(normalized)) return MAIL_MODE_ALIASES.get(normalized);
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

export function sanitizeMailScheduleEntry(entry, { defaultIntervalMinutes, minIntervalMinutes }) {
  const mode = normalizeMailMode(entry?.mode);
  const intervalRaw = Number(
    entry?.intervalMinutes ?? entry?.interval ?? defaultIntervalMinutes
  );
  const intervalMinutes = Number.isFinite(intervalRaw)
    ? Math.max(minIntervalMinutes, Math.floor(intervalRaw))
    : defaultIntervalMinutes;

  const textRaw = typeof entry?.text === "string"
    ? entry.text
    : (typeof entry?.body === "string" ? entry.body : "");

  return {
    id: typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : crypto.randomUUID(),
    label: typeof entry?.label === "string" ? entry.label.trim() : "",
    to: typeof entry?.to === "string" ? entry.to.trim() : "",
    subject: typeof entry?.subject === "string" ? entry.subject.trim() : "",
    text: typeof textRaw === "string" ? textRaw : "",
    attachmentPath: typeof entry?.attachmentPath === "string" ? entry.attachmentPath.trim() : "",
    mode,
    intervalMinutes,
    timeOfDay: mode === "time" ? normalizeTimeOfDay(entry?.timeOfDay ?? entry?.time ?? entry?.clock) : null,
    enabled: entry?.enabled === false ? false : true,
    lastSentAt: (() => {
      const ts = Number(entry?.lastSentAt);
      return Number.isFinite(ts) ? ts : null;
    })(),
  };
}

export function validateMailScheduleEntry(entry, { minIntervalMinutes }) {
  if (!entry.to) return "Empfängeradresse fehlt.";
  if (!entry.subject) return "Betreff fehlt.";
  if (!String(entry.text || "").trim()) return "Mailtext fehlt.";
  if (entry.mode === "time" && !entry.timeOfDay) return "Uhrzeit im Format HH:MM benötigt.";
  if (entry.mode === "interval") {
    const minutes = Number(entry.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes < minIntervalMinutes) {
      return `Intervall muss mindestens ${minIntervalMinutes} Minute(n) betragen.`;
    }
  }
  return null;
}

export function shouldSendMailNow(entry, { now = Date.now(), defaultIntervalMinutes, minIntervalMinutes }) {
  if (!entry?.enabled) return false;
  if (!entry.to || !entry.subject || !String(entry.text || "").trim()) return false;
  const normalizedMode = normalizeMailMode(entry.mode);
  if (normalizedMode === "time") {
    const timeValue = normalizeTimeOfDay(entry.timeOfDay);
    if (!timeValue) return false;
    const [hh, mm] = timeValue.split(":").map((v) => Number(v));
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    const targetMs = target.getTime();
    const last = Number(entry.lastSentAt);
    if (now >= targetMs && (!Number.isFinite(last) || last < targetMs)) return true;
    return false;
  }

  const intervalMinutes = Number.isFinite(Number(entry.intervalMinutes))
    ? Math.max(minIntervalMinutes, Math.floor(entry.intervalMinutes))
    : defaultIntervalMinutes;
  const intervalMs = intervalMinutes * 60_000;
  const last = Number(entry.lastSentAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= intervalMs;
}

export function resolveAttachmentPath(dataDir, filePath) {
  const cleaned = typeof filePath === "string" ? filePath.trim() : "";
  if (!cleaned) return null;
  return path.isAbsolute(cleaned) ? cleaned : path.join(dataDir, cleaned);
}

export async function buildScheduledMailAttachments(
  dataDir,
  entry,
  { onMissingAttachment } = {},
) {
  const resolved = resolveAttachmentPath(dataDir, entry?.attachmentPath || "");
  if (!resolved) return [];
  try {
    const content = await fs.readFile(resolved);
    const filename = path.basename(resolved) || "Anhang";
    return [{ filename, content }];
  } catch (error) {
    if (error?.code === "ENOENT") {
      await onMissingAttachment?.(resolved);
      return null;
    }
    throw error;
  }
}

async function sendScheduledMail(entry, { dataDir, sendMail, logMailEvent, isMailLoggingEnabled }) {
  const attachments = await buildScheduledMailAttachments(dataDir, entry, {
    onMissingAttachment: async (resolvedPath) => {
      if (!isMailLoggingEnabled) return;
      await logMailEvent("Geplanter Mail-Anhang fehlt", {
        id: entry.id,
        attachmentPath: resolvedPath,
      });
    },
  });
  if (attachments === null) return false;
  await sendMail({
    to: entry.to,
    subject: entry.subject || "Geplante Nachricht",
    text: entry.text || "",
    attachments,
  });
  return true;
}

export function createMailScheduleRunner({
  dataDir,
  scheduleFile,
  defaultIntervalMinutes,
  minIntervalMinutes,
  sweepIntervalMs,
  sendMail,
  logMailEvent = defaultLogMailEvent,
  isMailLoggingEnabled = defaultMailLoggingEnabled,
  isMailConfigured,
  appendError,
  readJson,
  writeJson,
  nowProvider = () => Date.now(),
}) {
  let mailScheduleTimer = null;
  let mailScheduleRunning = false;

  const sanitize = (entry) =>
    sanitizeMailScheduleEntry(entry, { defaultIntervalMinutes, minIntervalMinutes });

  async function readMailSchedule() {
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

  async function writeMailSchedule(next = []) {
    const normalized = Array.isArray(next) ? next.map((entry) => sanitize(entry)) : [];
    await writeJson(scheduleFile, normalized);
    return normalized;
  }

  async function runMailScheduleSweep() {
    if (mailScheduleRunning) return;
    mailScheduleRunning = true;
    try {
      const schedules = await readMailSchedule();
      if (!schedules.length) return;
      if (!isMailConfigured()) return;
      const now = nowProvider();
      let changed = false;
      const updated = [];
      for (const entry of schedules) {
        const normalized = sanitize(entry);
        if (shouldSendMailNow(normalized, { now, defaultIntervalMinutes, minIntervalMinutes })) {
          try {
            const sent = await sendScheduledMail(normalized, {
              dataDir,
              sendMail,
              logMailEvent,
              isMailLoggingEnabled,
            });
            if (sent) {
              normalized.lastSentAt = now;
              changed = true;
            }
          } catch (err) {
            await appendError("mail-schedule/send", err, { id: normalized.id, to: normalized.to });
          }
        }
        updated.push(normalized);
      }
      if (changed) {
        await writeMailSchedule(updated);
      }
    } finally {
      mailScheduleRunning = false;
    }
  }

  function clearMailScheduleTimer() {
    if (mailScheduleTimer) {
      clearInterval(mailScheduleTimer);
      mailScheduleTimer = null;
    }
  }

  async function startMailScheduleTimer({ immediate = false } = {}) {
    clearMailScheduleTimer();
    const runner = async () => {
      try {
        await runMailScheduleSweep();
      } catch (err) {
        await appendError("mail-schedule/run", err);
      }
    };
    mailScheduleTimer = setInterval(runner, sweepIntervalMs);
    mailScheduleTimer.unref?.();
    if (immediate) await runner();
  }

  return {
    readMailSchedule,
    writeMailSchedule,
    runMailScheduleSweep,
    startMailScheduleTimer,
    clearMailScheduleTimer,
    sanitize,
  };
}

