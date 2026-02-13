import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";
import BBoxPickerModal from "../components/BBoxPickerModal.jsx";
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

// ---- Einsatz-Panel (collapsible) ------------------------------------------
function EinsatzPanel({ canInteract, onProtocolReload }) {
  const [open, setOpen] = useState(false);
  const [einsatztitel, setEinsatztitel] = useState("");
  const [ausgangslage, setAusgangslage] = useState("");
  const [wetter, setWetter] = useState("");
  const [bbox, setBbox] = useState(null);
  const [bboxModalOpen, setBboxModalOpen] = useState(false);
  const [bboxSaving, setBboxSaving] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [message, setMessage] = useState(null);

  const loadScenario = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/filtering-rules/scenario", { credentials: "include" });
      if (!res.ok) return;
      const cfg = await res.json();
      setEinsatztitel(cfg.einsatztitel ?? "");
      setAusgangslage(cfg.ausgangslage || cfg.artDesEreignisses || "");
      setWetter(cfg.wetter ?? "");
      setBbox(cfg.bbox ?? null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadScenario(); }, [loadScenario]);

  const doHochfahren = useCallback(async () => {
    setLoadingAction(true);
    setMessage(null);
    try {
      const res = await fetch("/api/protocol/stab/hochfahren", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ einsatztitel, ausgangslage, wetter }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler");
      await loadScenario();
      onProtocolReload?.();
      setMessage({ type: "ok", text: data.message || "Stab hochgefahren" });
    } catch (err) {
      setMessage({ type: "err", text: err.message });
    } finally {
      setLoadingAction(false);
    }
  }, [einsatztitel, ausgangslage, wetter, loadScenario, onProtocolReload]);

  const doBeenden = useCallback(async () => {
    if (!window.confirm("Einsatz wirklich beenden?")) return;
    setLoadingAction(true);
    setMessage(null);
    try {
      const res = await fetch("/api/protocol/einsatz/beenden", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler");
      onProtocolReload?.();
      setMessage({ type: "ok", text: "Einsatz beendet" });
    } catch (err) {
      setMessage({ type: "err", text: err.message });
    } finally {
      setLoadingAction(false);
    }
  }, [onProtocolReload]);

  const updateScenario = useCallback(async (payload) => {
    const res = await fetch("/api/admin/filtering-rules/scenario", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Fehler");
    return data;
  }, []);

  const handleSaveBBox = useCallback(async (newBbox) => {
    setBboxSaving(true);
    setMessage(null);
    try {
      await updateScenario({ bbox: newBbox });
      await loadScenario();
      setBboxModalOpen(false);
      setMessage({ type: "ok", text: "BBox gespeichert" });
    } catch (err) {
      setMessage({ type: "err", text: err.message });
      throw err;
    } finally {
      setBboxSaving(false);
    }
  }, [loadScenario, updateScenario]);

  const handleDeleteBBox = useCallback(async () => {
    setBboxSaving(true);
    setMessage(null);
    try {
      await updateScenario({ bbox: null });
      await loadScenario();
      setMessage({ type: "ok", text: "BBox gelöscht" });
    } catch (err) {
      setMessage({ type: "err", text: err.message });
    } finally {
      setBboxSaving(false);
    }
  }, [loadScenario, updateScenario]);

  const formattedBbox = useMemo(() => {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;
    return bbox.map((value) => Number(value).toFixed(5)).join(",");
  }, [bbox]);

  const disabledTitle = !canInteract ? "Nur LtStB oder S3 (wenn LtStB nicht angemeldet)" : undefined;
  const deleteDisabledTitle = !bbox ? "Keine BBox gesetzt" : disabledTitle;

  return (
    <div className="mb-3 border rounded-lg bg-white/90 shadow-sm">
      {/* Header – always visible */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-semibold hover:bg-gray-50 rounded-t-lg"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        <span className="flex-1 flex items-center gap-2">
          <span className="whitespace-nowrap">Einsatztitel:</span>
          <input
            className="flex-1 border rounded px-2 py-1 text-sm font-normal"
            value={einsatztitel}
            onChange={(e) => setEinsatztitel(e.target.value)}
            disabled={!canInteract}
            title={disabledTitle}
            placeholder="Einsatztitel eingeben…"
            onClick={(e) => e.stopPropagation()}
          />
        </span>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t">
          <label className="block text-sm font-medium mt-2">
            Ausgangslage:
            <textarea
              className="mt-1 w-full border rounded px-2 py-1 text-sm min-h-[80px]"
              value={ausgangslage}
              onChange={(e) => setAusgangslage(e.target.value)}
              disabled={!canInteract}
              title={disabledTitle}
              placeholder="Ausgangslage beschreiben…"
            />
          </label>
          <label className="block text-sm font-medium">
            Wetter:
            <textarea
              className="mt-1 w-full border rounded px-2 py-1 text-sm min-h-[80px]"
              value={wetter}
              onChange={(e) => setWetter(e.target.value)}
              disabled={!canInteract}
              title={disabledTitle}
              placeholder="Wetterlage beschreiben…"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={!canInteract || loadingAction}
              title={disabledTitle}
              onClick={doHochfahren}
            >
              {loadingAction ? "Läuft…" : "Stab hochfahren"}
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              disabled={!canInteract || loadingAction}
              title={disabledTitle}
              onClick={doBeenden}
            >
              Einsatz beenden
            </button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className="px-3 py-1.5 text-sm rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
              disabled={!canInteract || bboxSaving}
              title={disabledTitle}
              onClick={() => setBboxModalOpen(true)}
            >
              Bereich auf Karte auswählen
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
              disabled={!canInteract || bboxSaving || !bbox}
              title={deleteDisabledTitle}
              onClick={handleDeleteBBox}
            >
              BBox löschen
            </button>
          </div>
          {formattedBbox && (
            <div className="text-xs text-gray-600">
              BBox: {formattedBbox.split(",").slice(0, 2).join(",")} → {formattedBbox.split(",").slice(2).join(",")}
            </div>
          )}
          {message && (
            <div className={`text-sm mt-1 ${message.type === "ok" ? "text-green-700" : "text-red-700"}`}>
              {message.text}
            </div>
          )}
        </div>
      )}
      <BBoxPickerModal
        open={bboxModalOpen}
        initialBbox={bbox}
        onCancel={() => setBboxModalOpen(false)}
        onSave={handleSaveBBox}
      />
    </div>
  );
}

export default function ProtokollOverview({ searchTerm = "", protocolCanEdit = false, protocolS3Blocked = false, roleFilter = null }) {
  const canInteract = protocolCanEdit && !protocolS3Blocked;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const triggerReload = useCallback(() => setReloadTrigger((n) => n + 1), []);
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
      const currentHash = window.location.hash.replace(/^#/, "");
      const returnTo = encodeURIComponent(currentHash);
      window.location.hash = `/protokoll/edit/${item.nr}?returnTo=${returnTo}`;
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
  }, [reloadTrigger]);

  const searchNeedle = useMemo(() => normalizeNameValue(searchTerm), [searchTerm]);
  const hasSearch = searchNeedle.length > 0;

  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) => (Number(b.nr) || 0) - (Number(a.nr) || 0));

    // Apply role filter if active
    let filtered = sorted;
    if (roleFilter?.scope === "role" && roleFilter.roleId) {
      const roleUpper = roleFilter.roleId.toUpperCase();
      filtered = sorted.filter((item) => {
        const matchesRecipient =
          Array.isArray(item.ergehtAn) &&
          item.ergehtAn.some((r) => String(r).toUpperCase() === roleUpper);
        const createdRole = (
          item.createdByRole ?? item.meta?.createdByRole ??
          item.createdBy ?? item.erstelltVon ?? item.geaendertVon ?? ""
        ).toString().toUpperCase();
        const matchesCreator = createdRole === roleUpper;
        return matchesRecipient || matchesCreator;
      });
    }

    if (!hasSearch) return filtered;

    const match = (value) => normalizeNameValue(value).includes(searchNeedle);

    return filtered.filter((item) => {
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
        ...(Array.isArray(item?.ergehtAn) ? item.ergehtAn : []),
        item?.ergehtAnText,
        item?.createdByRole,
      ];

      if (Array.isArray(item?.massnahmen)) {
        for (const m of item.massnahmen) {
          searchableFields.push(m?.massnahme, m?.verantwortlich);
        }
      }

      return searchableFields.some((field) => match(field));
    });
  }, [data, hasSearch, searchNeedle, roleFilter]);

return (
  <div className="p-3 md:p-4 h-full flex flex-col w-full protokoll-overview-wrapper">
    {/* Einsatz-Panel */}
    <EinsatzPanel canInteract={canInteract} onProtocolReload={triggerReload} />
    {/* Tabelle */}
    <div className="flex-1 min-h-0 overflow-auto border rounded-lg bg-white/80 watermark-panel">
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
