const STORAGE_PREFIX = "prot.overview.seen";

function normalizeIdentifierPart(value) {
  if (typeof value !== "string") {
    if (value === null || typeof value === "undefined") return "";
    try {
      return String(value).trim();
    } catch {
      return "";
    }
  }
  return value.trim();
}

export function resolveSeenStorageKey(user) {
  const parts = [];
  if (user && typeof user === "object") {
    const userId = normalizeIdentifierPart(user.userId || user.id || "");
    const username = normalizeIdentifierPart(user.username || user.name || "");
    const role = normalizeIdentifierPart(user.role || "");
    if (userId) parts.push(userId);
    if (username && username !== userId) parts.push(username);
    if (role) parts.push(role.toUpperCase());
  }
  if (!parts.length) return null;
  return `${STORAGE_PREFIX}.${parts.join("|")}`;
}

function ensureWindow() {
  return typeof window !== "undefined" ? window : null;
}

export function loadSeenEntries(storageKey) {
  const win = ensureWindow();
  if (!win || !storageKey) return {};
  try {
    const raw = win.localStorage?.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    for (const [nr, value] of Object.entries(parsed)) {
      if (!nr) continue;
      if (typeof value === "string") {
        out[nr] = value;
      } else if (Number.isFinite(value)) {
        out[nr] = `ts:${value}`;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function persistSeenEntries(storageKey, map) {
  const win = ensureWindow();
  if (!win || !storageKey) return;
  try {
    win.localStorage?.setItem(storageKey, JSON.stringify(map || {}));
  } catch {
    /* ignore */
  }
}

export function updateSeenEntry(storageKey, nr, token, currentMap = null) {
  if (!storageKey) return currentMap || {};
  const key = String(nr ?? "").trim();
  if (!key) return currentMap || {};
  const normalizedToken = typeof token === "string" && token ? token : "__opened__";
  const base = currentMap && typeof currentMap === "object" ? currentMap : loadSeenEntries(storageKey);
  if (base[key] === normalizedToken) return base;
  const next = { ...base, [key]: normalizedToken };
  persistSeenEntries(storageKey, next);
  return next;
}

function buildDoneSignature(item) {
  if (!item || !Array.isArray(item.massnahmen)) {
    return { raw: null, encoded: null };
  }

  const entries = [];
  for (let i = 0; i < item.massnahmen.length; i += 1) {
    const measure = item.massnahmen[i];
    if (!measure || !measure.done) continue;

    const responsible = typeof measure.verantwortlich === "string" ? measure.verantwortlich.trim() : "";
    const normalizedResponsible = responsible ? responsible.toUpperCase() : "";
    const label = typeof measure.massnahme === "string" ? measure.massnahme.trim() : "";
    const keyBase = [normalizedResponsible, label].filter(Boolean).join("::") || `idx:${i}`;
    entries.push(`${keyBase}#${i}`);
  }

  if (!entries.length) {
    return { raw: null, encoded: null };
  }

  entries.sort((a, b) => {
    if (a === b) return 0;
    return a > b ? 1 : -1;
  });

  const rawSignature = entries.join("||");
  let encodedSignature = rawSignature;
  try {
    encodedSignature = encodeURIComponent(rawSignature);
  } catch {
    /* ignore */
  }

  return { raw: rawSignature, encoded: encodedSignature };
}

export function getLastChangeInfo(item) {
  const history = Array.isArray(item?.history) ? item.history : [];
  let token = null;
  let actor = null;
  let action = null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (!entry || typeof entry !== "object") continue;
    const act = entry.action;
    if (act !== "create" && act !== "update") continue;
    action = act;
    const rawTs = Number(entry.ts);
    if (Number.isFinite(rawTs)) {
      token = `ts:${rawTs}`;
    } else {
      token = `idx:${i}:${act}:${history.length}`;
    }
    if (!actor && typeof entry.by === "string" && entry.by.trim()) {
      actor = entry.by.trim();
    }
    break;
  }

  if (!actor) {
    const fallback = [item?.lastBy, item?.createdBy].find((value) => typeof value === "string" && value.trim());
    if (fallback) actor = fallback.trim();
  }

  if (!token) {
    const fallbackCandidates = [item?.updatedAt, item?.lastModifiedAt, item?.ts, item?.timestamp];
    for (const candidate of fallbackCandidates) {
      const num = Number(candidate);
      if (Number.isFinite(num) && num > 0) {
        token = `fallback:${num}`;
        break;
      }
    }
  }

  if (!token) {
    token = `init:${history.length}:${item?.nr ?? ""}`;
  }

  const doneSignature = buildDoneSignature(item);

  const baseToken = token;
  const finalToken = doneSignature.encoded ? `${baseToken}||done:${doneSignature.encoded}` : baseToken;

  return {
    token: finalToken,
    by: actor || null,
    action,
    doneSignature: doneSignature.raw,
  };
}
