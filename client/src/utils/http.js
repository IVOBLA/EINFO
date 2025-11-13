const ENV_API_BASE_URL = import.meta.env?.VITE_API_BASE_URL;
const ENV_LOGIN_BASE_URL = import.meta.env?.VITE_LOGIN_BASE_URL;

export const DEFAULT_NETWORK_ERROR_MESSAGE = "Verbindung zum Server fehlgeschlagen. Bitte prüfen, ob das Backend erreichbar ist.";

export function sanitizeBaseUrl(value) {
  if (value === undefined || value === null) return "";
  try {
    return String(value).trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function resolveRuntimeBaseUrl() {
  if (typeof window === "undefined") return "";
  const candidates = [
    window.__APP_LOGIN_BASE_URL__,
    window.__APP_API_BASE_URL__,
    window.__APP_BASE_URL__,
  ];
  for (const candidate of candidates) {
    if (candidate) return sanitizeBaseUrl(candidate);
  }
  return "";
}

export function resolveAppBaseUrl() {
  const runtime = resolveRuntimeBaseUrl();
  if (runtime) return runtime;

  if (ENV_API_BASE_URL) return sanitizeBaseUrl(ENV_API_BASE_URL);
  if (ENV_LOGIN_BASE_URL) return sanitizeBaseUrl(ENV_LOGIN_BASE_URL);

  if (typeof window !== "undefined") {
    return sanitizeBaseUrl(`${window.location.protocol}//${window.location.host}`);
  }
  return "";
}

function normalizePath(path) {
  if (!path) return "";
  const str = String(path);
  return str.startsWith("/") ? str : `/${str}`;
}

const ABSOLUTE_URL_RE = /^https?:/i;

export function buildAppUrl(path, base = resolveAppBaseUrl()) {
  const normalizedBase = sanitizeBaseUrl(base);
  if (!path) return normalizedBase;
  if (ABSOLUTE_URL_RE.test(path)) return path;
  const normalizedPath = normalizePath(path);
  if (!normalizedBase) return normalizedPath;
  return `${normalizedBase}${normalizedPath}`;
}

export function buildApiUrl(path, base = resolveAppBaseUrl()) {
  return buildAppUrl(path, base);
}

export function createNetworkError(error, message = DEFAULT_NETWORK_ERROR_MESSAGE) {
  if (error && (error.name === "TypeError" || error instanceof TypeError)) {
    const wrapped = new Error(message);
    try {
      wrapped.cause = error;
    } catch {
      // ignore: cause not supported
    }
    return wrapped;
  }
  if (error instanceof Error) return error;
  return new Error(message);
}
