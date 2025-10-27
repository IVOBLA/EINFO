import React, { useEffect, useMemo, useState } from "react";
import { fetchBoard, fetchVehicles } from "./api";
import User_LogoffButton from "./components/User_LogoffButton.jsx";

/* ---------- kompakte Skalierung (Layout-Feintuning, unabhängig von Schrift) ---------- */
function useCompactScale() {
  const [scale, setScale] = useState(0.9);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const s = Math.min(Math.max(Math.min(w / 1440, h / 900), 0.78), 0.95);
      setScale(Number(s.toFixed(2)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return scale;
}

/* ---------- Basis-Schriftgröße: URL (?font=) > LocalStorage > Default ---------- */
function getBaseFontScale() {
  try {
    const sp = new URLSearchParams(window.location.search);
    const q = parseFloat(sp.get("font"));
    if (Number.isFinite(q) && q >= 0.5 && q <= 5) return q;
  } catch {}
  try {
    const ls = parseFloat(localStorage.getItem("ff_font_scale") || "");
    if (Number.isFinite(ls) && ls >= 0.5 && ls <= 5) return ls;
  } catch {}
  return 1.2; // sanfter Default
}

/* ---------- Hilfen ---------- */
const fmt24 = (iso) =>
  new Intl.DateTimeFormat("de-AT", {
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(new Date(iso || Date.now()));

const cardVehicleCountDyn = (card) =>
  Array.isArray(card?.assignedVehicles) ? card.assignedVehicles.length : 0;

const cardPersonnelCountDyn = (card, vehiclesById) =>
  (card?.assignedVehicles || []).reduce((sum, vid) => {
    const v = vehiclesById.get(vid);
    return sum + (typeof v?.mannschaft === "number" ? v.mannschaft : 0);
  }, 0);

const readAreaFilterParams = () => {
  if (typeof window === "undefined") return { id: "", label: "" };
  try {
    const sp = new URLSearchParams(window.location.search);
    const idParam =
      sp.get("bereichId") || sp.get("abschnittId") || sp.get("areaId") || "";
    const labelParam =
      sp.get("bereich") || sp.get("abschnitt") || sp.get("area") || "";
    return {
      id: String(idParam || "").trim(),
      label: String(labelParam || "").trim()
    };
  } catch {
    return { id: "", label: "" };
  }
};

/* ---------- Kachel ---------- */
function CardCompact({ c, vehiclesById, showBottomCounts = true, headerRight, kind }) {
  const isDone = kind === "erledigt";
  const vCount = isDone
    ? (Array.isArray(c?.everVehicles) ? c.everVehicles.length : 0)
    : cardVehicleCountDyn(c);

  const pCount = isDone
    ? (Number.isFinite(c?.everPersonnel) ? c.everPersonnel : 0)
    : cardPersonnelCountDyn(c, vehiclesById);

  const cardBgClass = c?.isArea
    ? "bg-slate-100 border-slate-200"
    : "bg-white";

  return (
    <div
      className={`border rounded-lg p-2 shadow-sm text-[0.9rem] leading-tight ${cardBgClass}`}
    >
      <div className="flex items-start justify-between text-[0.72rem] text-gray-600 mb-1">
        <span>{fmt24(c.createdAt)}</span>
        <span className="font-semibold">{headerRight}</span>
      </div>

      <div className="font-semibold">{c.content /* Titel */}</div>

      {(c.humanId || c.typ || c.ort || c.alerted) && (
        <div className="text-[0.75rem] text-gray-600 mt-0.5 space-y-0.5">
          {(c.humanId || c.typ) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {c.humanId && <span className="font-semibold text-gray-700">{c.humanId}</span>}
              {c.typ && <span>🏷️ {c.typ}</span>}
            </div>
          )}
          {(c.ort || c.alerted) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {c.ort && <span>📍 {c.ort}</span>}
              {c.alerted && <span className="text-gray-500">🔔 {c.alerted}</span>}
            </div>
          )}
        </div>
      )}

      {showBottomCounts && (
        <div className="mt-1 text-[0.78rem] text-gray-700 flex items-center gap-2">
          <span>🚒 {vCount}</span>
          <span>👥 {pCount}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Spalte (mit Summen & Auto-Grid) ---------- */
function StatusColumn({ title, cards, vehiclesById, kind, viewportH }) {
  const headerH = 56;
  const approxCardH = 96;
  const usableH = Math.max(160, viewportH - headerH - 40);
  const capacityOneCol = Math.max(1, Math.floor(usableH / approxCardH));
  const capacityTwoCol = capacityOneCol * 2;

  const oneToTwo = capacityOneCol + 1;
  const twoToThree = Math.max(capacityTwoCol + 2, oneToTwo + 6);

  let gridColsClass = "grid-cols-1";
  if (cards.length >= twoToThree) gridColsClass = "grid-cols-3";
  else if (cards.length >= oneToTwo) gridColsClass = "grid-cols-2";

  const headerRightFor = (card) => fmt24(card.statusSince);

  const totals = useMemo(() => {
    let cardCount = 0;
    let areaCount = 0;
    let incidentCount = 0;
    let unitSum = 0;
    let personSum = 0;

    for (const c of cards) {
      cardCount += 1;
      if (c?.isArea) areaCount += 1;
      else incidentCount += 1;

      if (kind === "erledigt") {
        unitSum += Array.isArray(c?.everVehicles) ? c.everVehicles.length : 0;
        personSum += Number.isFinite(c?.everPersonnel) ? c.everPersonnel : 0;
      } else {
        unitSum += Array.isArray(c?.assignedVehicles) ? c.assignedVehicles.length : 0;
        const vIds = Array.isArray(c?.assignedVehicles) ? c.assignedVehicles : [];
        for (const vid of vIds) {
          const v = vehiclesById.get(vid);
          if (typeof v?.mannschaft === "number") personSum += v.mannschaft;
        }
      }
    }

    return { cardCount, areaCount, incidentCount, unitSum, personSum };
  }, [cards, kind, vehiclesById]);

  const colBg =
    { neu: "bg-red-100", "in-bearbeitung": "bg-yellow-100", erledigt: "bg-green-100" }[kind] || "bg-gray-100";

  return (
    <section className={`${colBg} rounded-xl shadow p-3 h-full flex flex-col min-h-0`}>
      <h3 className="text-sm font-semibold mb-2">
        {title} — ⬛ {totals.incidentCount} | 🗺️ {totals.areaCount} | 🚒 {totals.unitSum} | 👥 {totals.personSum}
      </h3>

      <div className={`grid ${gridColsClass} gap-2 overflow-auto pr-1 flex-1 min-h-0 place-content-start`}>
        {cards.map((c) => (
          <CardCompact
            key={c.id}
            c={c}
            vehiclesById={vehiclesById}
            headerRight={headerRightFor(c)}
            showBottomCounts={true}
            kind={kind}
          />
        ))}
      </div>

      {cards.length === 0 && (
        <div className="text-[0.8rem] text-gray-500 italic text-center py-4">
          — keine Einträge —
        </div>
      )}
    </section>
  );
}

/* ---------- Seite ---------- */
export default function StatusPage() {
  useCompactScale(); // (behält Layout-Feintuning; wirkt nicht auf Schrift)
  const [baseScale, setBaseScale] = useState(getBaseFontScale()); // 1.2 … 5.0

  /* Root-Font-Size dynamisch setzen: Tailwind rems skalieren mit */
  useEffect(() => {
    const prev = document.documentElement.style.fontSize || "";
    const pct = Math.max(50, Math.min(500, Math.round(baseScale * 100))); // 50% … 500%
    document.documentElement.style.fontSize = pct + "%";
    return () => { document.documentElement.style.fontSize = prev; };
  }, [baseScale]);

  /* Reaktion auf LocalStorage-Änderungen (anderer Tab/Fenster) */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "ff_font_scale") {
        const v = parseFloat(e.newValue || "");
        if (Number.isFinite(v) && v >= 0.5 && v <= 5) setBaseScale(v);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const [board, setBoard] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [vh, setVh] = useState(window.innerHeight);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [b, v] = await Promise.all([fetchBoard(), fetchVehicles()]);
      if (mounted) { setBoard(b); setVehicles(v); }
    };
    load();
    const t = setInterval(load, 7000);
    const onRes = () => setVh(window.innerHeight);
    window.addEventListener("resize", onRes);
    return () => { mounted = false; clearInterval(t); window.removeEventListener("resize", onRes); };
  }, []);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("print") === "1" || sp.get("pdf") === "1") {
        // kleines Delay, damit Inhalte sicher gerendert sind
        const t = setTimeout(() => {
          window.print();
        }, 600);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);


  useEffect(() => {
    const onAfterPrint = () => {
      try { window.close(); } catch {}
    };
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  const areaFilter = useMemo(() => readAreaFilterParams(), []);

  const vehiclesById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);

  const { columns: cols, areaLabel } = useMemo(() => {
    const empty = {
      neu: { name: "Neu", items: [] },
      "in-bearbeitung": { name: "In Bearbeitung", items: [] },
      erledigt: { name: "Erledigt", items: [] }
    };

    const baseCols = board?.columns || empty;

    const buildSafeColumn = (key) => {
      const src = baseCols[key] || empty[key];
      return {
        name: src?.name || empty[key].name,
        items: Array.isArray(src?.items) ? [...src.items] : []
      };
    };

    const safeCols = {
      neu: buildSafeColumn("neu"),
      "in-bearbeitung": buildSafeColumn("in-bearbeitung"),
      erledigt: buildSafeColumn("erledigt")
    };

    const allAreaCards = [];
    for (const key of ["neu", "in-bearbeitung", "erledigt"]) {
      for (const card of baseCols[key]?.items || []) {
        if (card?.isArea) allAreaCards.push(card);
      }
    }

    const wantedId = areaFilter.id;
    const wantedLabel = areaFilter.label;
    const hasAreaFilter = Boolean(wantedId || wantedLabel);
    const wantedIdLower = String(wantedId || "").toLowerCase();
    const wantedLabelLower = String(wantedLabel || "").toLowerCase();

    let match = null;
    if (allAreaCards.length && hasAreaFilter) {
      if (wantedId) {
        match =
          allAreaCards.find((c) => String(c?.id) === wantedId) ||
          allAreaCards.find((c) => String(c?.id || "").toLowerCase() === wantedIdLower) ||
          allAreaCards.find((c) => String(c?.humanId || "").toLowerCase() === wantedIdLower);
      }
      if (!match && wantedLabel) {
        match = allAreaCards.find(
          (c) => String(c?.content || "").toLowerCase() === wantedLabelLower
        );
      }
      if (!match && wantedLabel) {
        match = allAreaCards.find((c) =>
          String(c?.content || "").toLowerCase().includes(wantedLabelLower)
        );
      }
    }

    if (match) {
      const matchId = String(match.id);
      for (const key of ["neu", "in-bearbeitung", "erledigt"]) {
        const items = safeCols[key]?.items || [];
        safeCols[key] = {
          ...safeCols[key],
          items: items.filter((card) => {
            if (card?.isArea) return String(card.id) === matchId;
            const ref = card?.areaCardId != null ? String(card.areaCardId) : "";
            return ref === matchId;
          })
        };
      }
    } else if (hasAreaFilter) {
      for (const key of ["neu", "in-bearbeitung", "erledigt"]) {
        safeCols[key] = { ...safeCols[key], items: [] };
      }
    }

    const derivedLabel =
      (match?.content || "").trim() ||
      (match?.humanId || "").trim() ||
      (hasAreaFilter ? areaFilter.label || areaFilter.id || "" : "");

    return { columns: safeCols, areaLabel: derivedLabel };
  }, [board, areaFilter.id, areaFilter.label]);

  const pageTitle = useMemo(() => {
    const base = "Einsatzstellen-Übersicht-Feuerwehr";
    return areaLabel ? `${base} - ${areaLabel}` : base;
  }, [areaLabel]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const prev = document.title;
    document.title = pageTitle;
    return () => {
      document.title = prev;
    };
  }, [pageTitle]);

  const activeVehicles = useMemo(() => {
    let sum = 0;
    for (const k of ["neu", "in-bearbeitung"]) {
      for (const c of cols[k].items || []) sum += cardVehicleCountDyn(c);
    }
    return sum;
  }, [cols]);

  const activePersons = useMemo(() => {
    let ppl = 0;
    for (const k of ["neu", "in-bearbeitung"]) {
      for (const c of cols[k].items || []) ppl += cardPersonnelCountDyn(c, vehiclesById);
    }
    return ppl;
  }, [cols, vehiclesById]);

  const activeIncidents = useMemo(() => {
    let count = 0;
    for (const c of cols["neu"].items || []) if (!c?.isArea) count += 1;
    for (const c of cols["in-bearbeitung"].items || []) if (!c?.isArea) count += 1;
    return count;
  }, [cols]);
  const totalIncidents = useMemo(() => {
    let count = activeIncidents;
    for (const c of cols["erledigt"].items || []) if (!c?.isArea) count += 1;
    return count;
  }, [activeIncidents, cols]);

  if (!board) {
    return (
      <div className="h-screen w-screen bg-gray-100 p-2 md:p-3 overflow-hidden">
        <User_LogoffButton className="fixed top-3 right-3 z-50" />
        <div className="h-full w-full flex items-center justify-center">Lade…</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-100 p-2 md:p-3 overflow-hidden">
      <User_LogoffButton className="fixed top-3 right-3 z-50" />
      <div className="h-full w-full flex flex-col gap-2">
        {/* Kopfzeile */}
        <header className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">{pageTitle}</h1>
          <div className="text-base md:text-lg font-bold flex flex-wrap gap-4">
            <span>🚒 {activeVehicles}</span>
            <span>👥 {activePersons}</span>
            <span>🟡 Aktiv: {activeIncidents}</span>
            <span>📦 Gesamt: {totalIncidents}</span>
          </div>
        </header>

        {/* Spalten */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 min-h-0 flex-1">
          <StatusColumn
            title="Neu"
            cards={cols["neu"].items}
            vehiclesById={vehiclesById}
            kind="neu"
            viewportH={vh}
          />
          <StatusColumn
            title="In Bearbeitung"
            cards={cols["in-bearbeitung"].items}
            vehiclesById={vehiclesById}
            kind="in-bearbeitung"
            viewportH={vh}
          />
          <StatusColumn
            title="Erledigt"
            cards={cols["erledigt"].items}
            vehiclesById={vehiclesById}
            kind="erledigt"
            viewportH={vh}
          />
        </div>
      </div>
    </div>
  );
}
