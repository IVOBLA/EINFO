// server/utils/auditLog.mjs  (ESM)
import fs from "fs/promises";
import path from "node:path";

export function resolveUserName(req) {
  const u = req?.user || {};
  return (
    u.displayName || u.label || u.name || u.username || u.email || u.id ||
    req?.headers?.["x-user-name"] || req?.headers?.["x-user"] || req?.ip || ""
  );
}

function normCell(v) {
  return String(v ?? "").replace(/\r?\n|\r/g, " ").trim();
}
function toCsvLine(headers, row, delim) {
  const esc = (s) => (s.includes(delim) || s.includes('"') ? `"${s.replaceAll('"','""')}"` : s);
  return headers.map(h => esc(normCell(row[h]))).join(delim) + "\n";
}

async function ensureCsv(file, headers, delim) {
  try {
    await fs.access(file);
    const txt = await fs.readFile(file, "utf8");
    const [first, ...rest] = txt.split(/\r?\n/);
    if (!first) {
      await fs.writeFile(file, headers.join(delim) + "\n", "utf8");
      if (rest.length) await fs.appendFile(file, rest.join("\n"), "utf8");
      return;
    }
const have = first.split(delim).map(s => s.trim());
    const want = [
      ...headers,
      ...have.filter(h => !headers.includes(h))
    ];
    const changed =
      want.length !== have.length ||
      want.some((value, index) => value !== have[index]);
    if (changed) {
      await fs.writeFile(file, [want.join(delim), ...rest].join("\n"), "utf8");
    }
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, headers.join(delim) + "\n", "utf8");
  }
}

/**
 * ZENTRAL: in JEDEM Board aufrufen.
 * - file: Pfad zur board-spezifischen CSV (bleibt getrennt)
 * - headers: board-spezifische Spalten (bleiben erhalten)
 * - payload: bereits "einmal" gebautes Objekt pro Board
 * - opts: { delim, autoTimestampField, autoUserField }
 */
export async function appendCsvRow(file, headers, payload, req, opts = {}) {
  const {
    delim = ";",
    autoTimestampField = (headers.includes("timestamp") ? "timestamp" :
                          headers.includes("Zeitpunkt") ? "Zeitpunkt" : null),
    autoUserField      = (headers.includes("user") ? "user" :
                          headers.includes("Benutzer") ? "Benutzer" : null),
  } = opts;

  await ensureCsv(file, headers, delim);

  const row = { ...payload };
  // Zeit automatisch
  if (autoTimestampField && !row[autoTimestampField]) {
    if (autoTimestampField === "Zeitpunkt") {
      const d = new Date(), p = n => String(n).padStart(2,"0");
      row.Zeitpunkt = `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    } else {
      row.timestamp = new Date().toISOString();
    }
  }
  // Benutzer automatisch
  if (autoUserField && !row[autoUserField]) {
    const u = resolveUserName(req);
    if (autoUserField === "Benutzer") row.Benutzer = u; else row.user = u;
  }

  await fs.appendFile(file, toCsvLine(headers, row, delim), "utf8");
}
