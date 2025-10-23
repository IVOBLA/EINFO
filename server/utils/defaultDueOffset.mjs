import "dotenv/config";

const FALLBACK_MINUTES = 30;

function parseOffset(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return FALLBACK_MINUTES;
  return Math.max(0, num);
}

export function getDefaultDueOffsetMinutes() {
  const raw =
    process.env.AUFG_DEFAULT_DUE_MINUTES ??
    process.env.TASK_DEFAULT_DUE_OFFSET_MINUTES ??
    process.env.DEFAULT_DUE_OFFSET_MINUTES ??
    String(FALLBACK_MINUTES);

  return parseOffset(raw);
}
