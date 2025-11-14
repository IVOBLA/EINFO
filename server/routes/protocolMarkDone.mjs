import fs from "fs";
import path from "path";
import { appendHistoryEntriesToCsv } from "../utils/protocolCsv.mjs";
import { DATA_ROOT } from "../utils/pdfPaths.mjs";

const DATA_DIR   = DATA_ROOT;
const JSON_FILE  = path.join(DATA_DIR, "protocol.json");
const CSV_FILE   = path.join(DATA_DIR, "protocol.csv");

function snapshotForHistory(src) {
  const seen = new WeakSet();
  const clone = (v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return undefined;
      seen.add(v);
      if (Array.isArray(v)) return v.map(clone);
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === "history") continue;
        o[k] = clone(val);
      }
      return o;
    }
    return v;
  };
  return clone(src);
}

export async function markResponsibleDone(nr, roleId, actorName = "Automatisch") {
  try {
    const arr = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
    const i = arr.findIndex((x) => Number(x?.nr) === Number(nr));
    if (i < 0) return;
    const it = arr[i];
    let changed = false;
    const before = JSON.parse(JSON.stringify(it));

    if (Array.isArray(it.massnahmen)) {
      for (const [idx, m] of it.massnahmen.entries()) {
        if (String(m?.verantwortlich || "").toUpperCase() === String(roleId).toUpperCase() && !m.done) {
          m.done = true;
          changed = true;
        }
      }
    }

    if (changed) {
      const now = Date.now();
      const after = snapshotForHistory(it);
      const changes = [{ path: "massnahmen[].done", before: false, after: true }];

      const entry = {
        ts: now,
        action: "update",
        by: actorName,
        changes,
        after,
      };

      it.history = Array.isArray(it.history) ? [...it.history, entry] : [entry];
      it.lastBy = actorName;

      arr[i] = it;
      fs.writeFileSync(JSON_FILE, JSON.stringify(arr, null, 2), "utf8");

      appendHistoryEntriesToCsv(it, [entry], CSV_FILE);
    }
  } catch (err) {
    console.warn("[markResponsibleDone]", err);
  }
}
