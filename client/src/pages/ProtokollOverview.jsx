import { useCallback, useEffect, useMemo, useState } from "react";
import { initRolePolicy, canEditApp, hasRole } from "../auth/roleUtils";
import { useUserAuth } from "../components/User_AuthProvider.jsx";
import useOnlineRoles from "../hooks/useOnlineRoles.js";
import {
  getLastChangeInfo,
  loadSeenEntries,
  resolveSeenStorageKey,
  updateSeenEntry,
} from "../utils/protokollSeen.js";

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

export default function ProtokollOverview() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const { user } = useUserAuth() || {};
  const userNameVariants = useMemo(() => collectUserNameVariants(user), [user]);
  const { roles: onlineRoles } = useOnlineRoles();
  const ltStbOnline = useMemo(
    () => onlineRoles.some((roleId) => roleId === "LTSTB" || roleId === "LTSTBSTV"),
    [onlineRoles]
  );
  const s3User = hasRole("S3", user);
  const s3BlockedByLtStb = s3User && ltStbOnline;
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
    (async () => {
      try {
        await initRolePolicy();
        if (cancelled) return;
        const baseCanEdit = canEditApp("protokoll", user);
        const s3Fallback = !ltStbOnline && hasRole("S3", user);
        setCanEdit(baseCanEdit || s3Fallback);
      } catch {
        if (cancelled) return;
        setCanEdit(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ltStbOnline, user]);

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

const rows = useMemo(
    () => [...data].sort((a, b) => (Number(b.nr) || 0) - (Number(a.nr) || 0)),
    [data]
  );

  return (
  <div className="p-3 md:p-4 max-w-[1400px] mx-auto h-full flex flex-col">
    {/* Kopf */}
    <div className="flex items-center justify-between gap-2 mb-3">
      <h1 className="text-xl md:text-2xl font-bold">Meldungsübersicht</h1>
      <div className="flex items-center gap-2">
        <a
          href="/api/protocol/csv/file"
          className="px-3 py-1.5 rounded-md border bg-white"
          title="protocol.csv herunterladen"
        >
          CSV
        </a>
        <button
          onClick={() => {
            if (!canEdit || s3BlockedByLtStb) return;
            window.location.hash = "/protokoll/neu";
          }}
          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
           title={
      !canEdit
        ? "Keine Berechtigung (Meldestelle)"
        : s3BlockedByLtStb
          ? "S3 darf nur anlegen, wenn LtStb nicht angemeldet ist"
          : undefined
    }
        >
          + Eintrag anlegen
        </button>
      </div>
    </div>

    {/* Tabelle */}
    <div className="flex-1 overflow-auto border rounded-lg bg-white">
      {loading ? (
        <div className="p-4 text-gray-500">Lade…</div>
      ) : (
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold border-b">
              <th style={{ width: 70 }} className="text-center" title="Druckanzahl">NR</th>
              <th style={{ width: 70 }} className="text-center">ZU</th>
              <th style={{ width: 60 }}>Druck</th>
              <th style={{ width: 110 }}>Datum</th>
              <th style={{ width: 80 }}>Zeit</th>
              <th style={{ width: 120 }}>Kanal</th>
              <th style={{ width: 110 }}>Richtung</th>
              <th style={{ width: 160 }}>An/Von</th>
              <th>Information</th>
              <th style={{ width: 260 }}>Meldungstyp</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-2">
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
 const hoverTitle = isHighlighted
   ? `Erstellt/geändert durch ${lastActor}`
   : `Geändert durch ${lastActor}`;
              // --- Anzeige-Logik Druckanzeige ---
              const showPrintCircle = !!confirmation?.confirmed; // Kreis nur bei bestätigten Einträgen
              const printTitleParts = [`${printCount}× gedruckt`];

              if (openTasks) {
                printTitleParts.push("Offene Aufgaben vorhanden");
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
              const printPlainTextClass = openTasks ? "text-red-600" : "";
              const hasCompletedTasks = relevantMeasures.some((m) => !!m?.done);
              const rowClasses = [
                "border-b align-top cursor-pointer",
                isHighlighted
                  ? "bg-yellow-50 hover:bg-yellow-100"
				  : "hover:bg-gray-50",          
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
                    {showPrintCircle ? (
                      <span
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-semibold ${printCircleClass}`}
                        title={printTitle}
                        aria-label={printTitle}
                      >
                        {r.nr}
                      </span>
                    ) : (
                      <span className={`inline-block min-w-[2ch] text-sm font-semibold ${printPlainTextClass}`} title={printTitle} aria-label={printTitle}>

                        {r.nr}
                      </span>
                    )}
                  </td>
                  <td className="align-middle text-center font-semibold">{r.zu ? r.zu : "—"}</td>
                  <td className="font-semibold">{printCount}</td>
                  <td>{r.datum}</td>
                  <td>{r.zeit}</td>
                  <td title={kanal}>{kanal}</td>
                  <td title={richtung}>{richtung}</td>
                  <td>{r.anvon}</td>
                  <td className="whitespace-pre-wrap">{short30(r.information)}</td>
                  <td className="whitespace-pre-wrap">{r.infoTyp || "—"}</td>
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
