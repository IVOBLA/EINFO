export function parseAutoPrintTimestamp(value){
  if (value === null || value === undefined) return null;
  if (value instanceof Date){
    const ms = value.valueOf();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number"){
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string"){
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint"){
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

const HISTORY_TIMESTAMP_FIELDS = ["ts", "at", "time"];

function extractHistoryTimestamp(entry){
  if (!entry || typeof entry !== "object") return null;
  for (const field of HISTORY_TIMESTAMP_FIELDS){
    const ts = parseAutoPrintTimestamp(entry[field]);
    if (ts !== null) return ts;
  }
  return null;
}

export function getProtocolCreatedAt(item){
  if (!item || typeof item !== "object") return null;
  const history = Array.isArray(item.history) ? item.history : [];

  for (const entry of history){
    if (entry?.action !== "create") continue;
    const ts = extractHistoryTimestamp(entry);
    if (ts !== null) return ts;
  }

  const candidates = [
    item?.createdAt,
    item?.created,
    item?.timestamp,
    item?.ts,
    item?.meta?.createdAt,
  ];
  for (const cand of candidates){
    const ts = parseAutoPrintTimestamp(cand);
    if (ts !== null) return ts;
  }

  if (history.length){
    let oldest = null;
    for (const entry of history){
      const ts = extractHistoryTimestamp(entry);
      if (ts === null) continue;
      if (oldest === null || ts < oldest) oldest = ts;
    }
    if (oldest !== null) return oldest;
  }

  return null;
}

export default {
  parseAutoPrintTimestamp,
  getProtocolCreatedAt,
};
