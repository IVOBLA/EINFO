import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";
import {
  getLastChangeInfo,
  loadSeenEntries,
  resolveSeenStorageKey,
  updateSeenEntry,
} from "../utils/protokollSeen.js";
import { requiresOtherRecipientConfirmation } from "../utils/protocolRecipients.js";

const TOKEN_SEPARATOR = "||";
const DONE_TOKEN_PREFIX = "done:";

function normalizeNameValue(value) {
  if (value == null) return "";
  try {
    return String(value)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return String(value)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
}

function short200NoBreak(s) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim(); // linefeeds + doppelte Spaces entfernen
  return t.length > 200 ? t.slice(0, 200) + "…" : t;
}

function describeHistoryPath(path) {
  const p = String(path || "");

  if (p === "information" || p.startsWith("information.")) return "Information";
  if (p === "rueckmeldung1" || p.startsWith("rueckmeldung1.")) return "Rückmeldung";
  if (p === "lagebericht" || p.startsWith("lagebericht.")) return "Lagebericht";
  if (p.startsWith("otherRecipientConfirmation")) return "Empfängerbestätigung";
  if (p.startsWith("ergehtAn")) return "Verteiler (ergeht an)";
  if (p.startsWith("uebermittlungsart")) return "Übermittlungsart";
  if (p === "datum" || p === "zeit") return "Datum/Zeit";
  if (p === "zu") return "Zu-Nummer";

  // Maßnahmen inkl. Index hübsch darstellen
  const m = /^massnahmen\.(\d+)(?:\.(.+))?$/.exec(p);
  if (m) {
    const idx = Number(m[1]) + 1;
    const sub = m[2] || "";
    if (sub === "text") return `Maßnahme ${idx} Text`;
    if (sub === "done") return `Maßnahme ${idx} Status`;
    return `Maßnahme ${idx}${sub ? ` (${sub})` : ""}`;
  }

  // Fallback: rohen Pfad verwenden
  return p || "Feld";
}

function formatChangeValueForTooltip(value) {
  if (value === null || typeof value === "undefined") return "—";

  if (typeof value === "string") {
    const t = value.replace(/\s+/g, " ").trim();
    if (!t) return "—";
    return t.length > 80 ? t.slice(0, 77) + "…" : t;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const len = value.length;
    return len === 0 ? "[]" : `[${len} Einträge]`;
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") {
      return formatChangeValueForTooltip(value.text);
    }
    if (typeof value.name === "string") {
      return formatChangeValueForTooltip(value.name);
    }
    try {
      const json = JSON.stringify(value);
      return json.length > 80 ? json.slice(0, 77) + "…" : json;
    } catch {
      return "[Objekt]";
    }
  }

  return String(value);
}

function buildLastUpdateChangeDetails(item) {
  const history = Array.isArray(item?.history) ? item.history : [];
  if (!history.length) return null;

  // letzte UPDATE-History finden
  let entry = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.action === "update" && Array.isArray(h.changes)) {
      entry = h;
      break;
    }
  }
  if (!entry) return null;

  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  if (!changes.length) return null;

  const lines = [];
  for (const ch of changes) {
    const label = describeHistoryPath(ch.path);
    const beforeStr = formatChangeValueForTooltip(ch.before);
    const afterStr = formatChangeValueForTooltip(ch.after);
    if (beforeStr === afterStr) continue;
    lines.push(`${label}: ${beforeStr} → ${afterStr}`);
  }

  if (!lines.length) return null;

  const MAX_LINES = 5;
  if (lines.length > MAX_LINES) {
    const visible = lines.slice(0, MAX_LINES);
    const remaining = lines.length - MAX_LINES;
    visible.push(`(+${remaining} weitere Änderungen)`);
    return visible.join("\n");
  }

  return lines.join("\n");
}


function collectNameVariants(value) {
  const variants = new Set();
  if (value == null) return variants;

  const raw = String(value);
  const normalized = normalizeNameValue(raw);
  if (normalized) {
    variants.add(normalized);
    const collapsed = normalized.replace(/\s+/g, "");
    if (collapsed && collapsed !== normalized) variants.add(collapsed);
  }

  const parts = raw.split(/[/()[\]|]+/);
  for (const part of parts) {
    const norm = normalizeNameValue(part);
    if (!norm) continue;
    variants.add(norm);
    const collapsed = norm.replace(/\s+/g, "");
    if (collapsed && collapsed !== norm) variants.add(collapsed);
  }

  return variants;
}

function collectUserNameVariants(user) {
  const variants = new Set();
  const add = (value) => {
    if (value == null) return;
    for (const variant of collectNameVariants(value)) {
      variants.add(variant);
    }
  };

  if (user && typeof user === "object") {
    add(user.displayName);
    add(user.username);
    add(user.name);
    add(user.userId);
    if (user.id != null) add(user.id);
    add(user.role);
    if (user.role && typeof user.role === "object") {
      add(user.role.id);
      add(user.role.name);
      add(user.role.label);
      add(user.role.displayName);
    }
  }

  return variants;
}

function parseHighlightToken(token) {
  if (typeof token !== "string" || !token) {
    return { raw: token ?? null, base: token ?? null, doneSignature: null };
  }

  const parts = token.split(TOKEN_SEPARATOR);
  const base = parts[0] || token;
  let doneSignature = null;

  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.startsWith(DONE_TOKEN_PREFIX)) {
      const raw = part.slice(DONE_TOKEN_PREFIX.length);
      if (!raw) {
        doneSignature = "";
      } else {
        try {
          doneSignature = decodeURIComponent(raw);
        } catch {
          doneSignature = raw;
        }
      }
    }
  }

  return { raw: token, base, doneSignature };
}

function short30(s) {
  const t = (s ?? "").toString();
  return t.length > 30 ? t.slice(0, 30) + "…" : t;
}

function sumPrintHistory(history) {
  if (!Array.isArray(history)) return { sum: 0, hasPrintEntries: false };
  return history.reduce(
    (acc, entry) => {
      if (!entry || entry.action !== "print") return acc;
      const value = Number(entry?.printCount ?? entry?.pages ?? 0);
      if (!Number.isFinite(value)) return acc;
      acc.sum += Math.max(0, value);
      acc.hasPrintEntries = true;
      return acc;
    },
    { sum: 0, hasPrintEntries: false }
  );
}


function getTotalPrints(item) {
  if (!item) return 0;
  const hist = Array.isArray(item.history) ? item.history : [];
  const sum = hist.reduce((acc, h) => {
    if (h?.action === "print") {
      const val = Number(h.printCount ?? h.pages ?? 0);
      if (Number.isFinite(val)) acc += val;
    }
    return acc;
  }, 0);
  // falls History fehlt, fallback auf backend-Wert
  return sum > 0 ? sum : Number(item.printCount ?? 0);
}

function resolvePrintCount(item) {
  const { sum: historyPrints, hasPrintEntries } = sumPrintHistory(item?.history);
  if (hasPrintEntries) return historyPrints;
  const direct = Number(item?.printCount);
  return Number.isFinite(direct) ? Math.max(0, direct) : 0;
}

export default function ProtokollOverview({ searchTerm = "" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useUserAuth() || {};
  const userNameVariants = useMemo(() => collectUserNameVariants(user), [user]);
  const seenStorageKey = useMemo(() => resolveSeenStorageKey(user), [user]);
  const [seenEntries, setSeenEntries] = useState({});

  useEffect(() => {
    if (!seenStorageKey) {
      setSeenEntries({});
      return;
    }
    setSeenEntries(loadSeenEntries(seenStorageKey));
  }, [seenStorageKey]);

  useEffect(() => {
    if (!seenStorageKey || typeof window === "undefined") return () => {};
    const handleStorage = (event) => {
      if (event?.key === seenStorageKey) {
        setSeenEntries(loadSeenEntries(seenStorageKey));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [seenStorageKey]);

  const markEntrySeen = useCallback(
    (nr, token) => {
      if (!seenStorageKey) return;
      setSeenEntries((prev) => updateSeenEntry(seenStorageKey, nr, token, prev));
    },
    [seenStorageKey]
  );

  const handleRowClick = useCallback(
    (item, token) => {
      markEntrySeen(item.nr, token);
      window.location.hash = `/protokoll/edit/${item.nr}`;
    },
    [markEntrySeen]
  );

  useEffect(() => {
    let cancelled = false;
    let controller = null;
    let intervalId = null;
    let initialLoad = true;
    let isFetching = false;

    const fetchData = async () => {
      if (cancelled || isFetching) return;
      isFetching = true;
      if (initialLoad) setLoading(true);

      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;

      try {
        const response = await fetch("/api/protocol", {
          credentials: "include",
          signal: currentController.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (cancelled || controller !== currentController) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setData(items);
      } catch (error) {
        if (cancelled || error?.name === "AbortError") return;
        if (initialLoad) setData([]);
        console.warn("[ProtokollOverview] Aktualisierung fehlgeschlagen", error);
      } finally {
        if (!cancelled && initialLoad) {
          setLoading(false);
        }
        initialLoad = false;
        isFetching = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchData();
      }
    };

    fetchData();
    intervalId = window.setInterval(fetchData, 5000);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      controller?.abort();
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const searchNeedle = useMemo(() => normalizeNameValue(searchTerm), [searchTerm]);
  const hasSearch = searchNeedle.length > 0;

  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) => (Number(b.nr) || 0) - (Number(a.nr) || 0));
    if (!hasSearch) return sorted;

    const match = (value) => normalizeNameValue(value).includes(searchNeedle);

    return sorted.filter((item) => {
      const u = item?.uebermittlungsart || {};
      const directions = []
        .concat(u.ein ? "Eingang" : [])
        .concat(u.aus ? "Ausgang" : []);

      const searchableFields = [
        item?.nr,
        item?.zu,
        item?.datum,
        item?.zeit,
        item?.anvon,
        item?.information,
        item?.infoTyp,
        u.kanal,
        u.kanalNr,
        u.art,
        directions.join(" / "),
      ];

      if (Array.isArray(item?.massnahmen)) {
        for (const m of item.massnahmen) {
          searchableFields.push(m?.massnahme, m?.verantwortlich);
        }
      }

      return searchableFields.some((field) => match(field));
    });
  }, [data, hasSearch, searchNeedle]);

  return (
    <div className="p-3 md:p-4 h-full flex flex-col w-full floating-actions-safe-area">
    {/* Tabelle */}
    <div className="flex-1 overflow-auto border rounded-lg bg-white">
      {loading ? (
        <div className="p-4 text-gray-500">Lade…</div>
      ) : (
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold border-b">
              <th className="text-center whitespace-nowrap w-1">✓</th>
              <th className="text-center whitespace-nowrap w-1">NR.</th>
              <th className="whitespace-nowrap w-1">Druck</th>
              <th className="whitespace-nowrap w-1">Datum</th>
              <th className="whitespace-nowrap w-1">Zeit</th>
              <th className="whitespace-nowrap w-1">Kanal</th>
              <th className="whitespace-nowrap w-1">Richtung</th>
              <th className="whitespace-nowrap w-1">An/Von</th>
              <th>Information</th>
             <th className="whitespace-nowrap w-1">Meldungstyp</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-2 [&>tr>td]:align-middle">
            {rows.map((r) => {
              const u = r?.uebermittlungsart || {};
              const kanal = u.kanal ?? u.kanalNr ?? u.art ?? "";
              const richtungen = []
                .concat(u.ein ? "Eingang" : [])
                .concat(u.aus ? "Ausgang" : []);
              const richtung = richtungen.join(" / ");
              const printCount = resolvePrintCount(r);
              const printed = printCount > 0;
              const massnahmen = Array.isArray(r?.massnahmen) ? r.massnahmen : [];
              const relevantMeasures = massnahmen.filter((m) => {
                const text = `${m?.massnahme ?? ""} ${m?.verantwortlich ?? ""}`.trim();
                return text.length > 0;
              });
              const openTasks = relevantMeasures.some((m) => !m?.done);
              const confirmation = r?.otherRecipientConfirmation || {};
              const confirmedRole = String(confirmation?.byRole || "").toUpperCase();
              const confirmedByLtStbOrS3 = !!confirmation?.confirmed && (confirmedRole === "LTSTB" || confirmedRole === "S3");
              const requiresConfirmation = requiresOtherRecipientConfirmation(r);
              const awaitingConfirmation = requiresConfirmation && !confirmation?.confirmed;
              const changeInfo = getLastChangeInfo(r);
              const entryToken = changeInfo.token;
              const entryKey = String(r?.nr ?? "");
              const seenToken = entryKey && seenEntries ? seenEntries[entryKey] : null;
              const hasSeenStorage = !!seenStorageKey;
              const tokenChanged = hasSeenStorage && entryToken && seenToken !== entryToken;
              const entryTokenInfo = parseHighlightToken(entryToken);
              const seenTokenInfo = parseHighlightToken(seenToken);
              const entryHasDoneSignature = !!entryTokenInfo.doneSignature;
              const seenHasDoneSignature = !!seenTokenInfo.doneSignature;
              const doneAcknowledged =
                entryHasDoneSignature &&
                seenHasDoneSignature &&
                entryTokenInfo.doneSignature === seenTokenInfo.doneSignature;
              const actorRawName = typeof changeInfo.by === "string" ? changeInfo.by : null;
              let changeByCurrentUser = false;
              if (actorRawName && userNameVariants.size) {
                const variants = collectNameVariants(actorRawName);
                for (const variant of variants) {
                  if (userNameVariants.has(variant)) {
                    changeByCurrentUser = true;
                    break;
                  }
                }
              }
              const highlightDueToDone = entryHasDoneSignature && (!hasSeenStorage || !doneAcknowledged);
              const highlightByOthers = tokenChanged && !changeByCurrentUser;
              const isHighlighted = highlightDueToDone || highlightByOthers;
 const fallbackActor = actorRawName && actorRawName.trim() ? actorRawName.trim() : "Unbekannt";
 const rawDoneSig = entryTokenInfo.doneSignature && String(entryTokenInfo.doneSignature).trim();
 // NUR den *letzten* Bearbeiter aus der Done-Signatur nehmen, "#<index>" entfernen
 const lastDoneActor = rawDoneSig
   ? (() => {
       const parts = rawDoneSig.split(",").map(p => p.trim()).filter(Boolean);
       const last = parts[parts.length - 1] || "";
       return last.replace(/\s*#\d+\s*$/, "").trim() || null;
     })()
   : null;

const lastActor = lastDoneActor || fallbackActor;

// Nur bei markierten (gelben) Einträgen die Detail-Änderungen anhängen
const changeDetails = isHighlighted ? buildLastUpdateChangeDetails(r) : null;

const hoverBase = isHighlighted
  ? `Erstellt/geändert durch ${lastActor}`
  : `Geändert durch ${lastActor}`;

const hoverTitle = changeDetails
  ? `${hoverBase}\n${changeDetails}`
  : hoverBase;
   
   
   
              // --- Anzeige-Logik Druckanzeige ---
              const showPrintCircle = !!confirmation?.confirmed; // Kreis nur bei bestätigten Einträgen
              const printTitleParts = [`${printCount}× gedruckt`];

              if (openTasks) {
                printTitleParts.push("Offene Aufgaben vorhanden");
              }
              if (awaitingConfirmation) {
                printTitleParts.push("Bestätigung ausstehend");
              }
              if (confirmation?.confirmed) {
                const label = confirmedRole || "Bestätigt";
                printTitleParts.push(`Bestätigt durch ${label}`);
              }

              const printTitle = printTitleParts.join(" • ");

              // Farbe abhängig vom Zustand
              const printCircleClass = openTasks
                ? "border-red-500 text-red-600"
                : "border-emerald-500 text-emerald-600";
              // auch ohne Kreis rot färben, wenn offene Aufgaben existieren
              const printPlainTextClass = awaitingConfirmation
                ? "text-gray-400"
                : openTasks
                  ? "text-red-600"
                  : "";
              const hasRelevantTasks = relevantMeasures.length > 0;
              const measuresCompleted = !openTasks;
              const isConfirmed = !!confirmation?.confirmed;
              const shouldShowGreenCheck = isConfirmed && measuresCompleted;
              //const shouldShowBlackCheck = !isConfirmed && !hasRelevantTasks;
              const rowClasses = [
                "border-b  cursor-pointer",
                isHighlighted
                  ? "bg-yellow-50 hover:bg-yellow-100"
                  : "hover:bg-gray-50",
                awaitingConfirmation ? "text-gray-400 [&>td]:text-gray-400" : "",
              ].join(" ");
              return (
                <tr
                  key={r.nr}
                  className={rowClasses}
                  onClick={() => handleRowClick(r, entryToken)}
                  title={hoverTitle}
                  aria-label={hoverTitle}
                >
                  <td className="align-middle text-center">
  {shouldShowGreenCheck ? (
     <span
        className="inline-flex items-center justify-center text-emerald-600 text-lg font-semibold"
        title="Bestätigt und alle Maßnahmen erledigt"
     >
        ✓
     </span>
  ) : null}
                  </td>
                  <td className="align-middle text-center font-semibold whitespace-nowrap">
                    {(() => {
                      const nrLabel = r.nr ?? "—";
                      const hasZu = r.zu !== null && r.zu !== undefined && String(r.zu).trim() !== "";
                      const zuLabel = hasZu ? String(r.zu) : "";
                      const display = hasZu ? `${nrLabel}/${zuLabel}` : `${nrLabel}`;
                      return showPrintCircle ? (
                        <span
                          className={`inline-flex items-center justify-center px-3 h-8 rounded-full border-2 text-sm font-semibold ${printCircleClass}`}
                          title={printTitle}
                          aria-label={printTitle}
                        >
                          {display}
                        </span>
                      ) : (
                        <span
                          className={`inline-block text-sm font-semibold ${printPlainTextClass}`}
                          title={printTitle}
                          aria-label={printTitle}
                        >
                          {display}
                        </span>
                      );
                    })()}
                  </td>
 <td className="font-semibold whitespace-nowrap">{printCount}</td>
 <td className="whitespace-nowrap">{r.datum}</td>
 <td className="whitespace-nowrap">{r.zeit}</td>
 <td className="whitespace-nowrap" title={kanal}>{kanal}</td>
 <td className="whitespace-nowrap" title={richtung}>{richtung}</td>
 <td className="whitespace-nowrap">{r.anvon}</td>
 <td className="whitespace-pre-wrap">{short200NoBreak(r.information)}</td>
 <td className="whitespace-nowrap">{r.infoTyp || "—"}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="p-4 text-gray-500 italic">— keine Einträge —</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

}
