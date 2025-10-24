const FALLBACK_MINUTES = 30;

function readEnvOffset() {
  try {
    const env = typeof import.meta !== "undefined" ? import.meta?.env ?? {} : {};
    const raw = env?.VITE_DEFAULT_DUE_OFFSET_MINUTES ?? env?.DEFAULT_DUE_OFFSET_MINUTES;
    if (raw == null || raw === "") return null;
    return raw;
  } catch {
    return null;
  }
}

function normalizeOffset(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, num);
}

export function getFallbackDueOffsetMinutes() {
  const fromEnv = readEnvOffset();
  if (fromEnv != null) return normalizeOffset(fromEnv, FALLBACK_MINUTES);
  return FALLBACK_MINUTES;
}

export function ensureValidDueOffset(value) {
  return normalizeOffset(value, getFallbackDueOffsetMinutes());
}