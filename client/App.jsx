import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  rectIntersection,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableCard } from "./components/SortableCard";
import { DraggableVehicle } from "./components/DraggableVehicle";
import { MapModal } from "./components/MapModal";
import NewVehicleModal from "./components/NewVehicleModal";
import AddIncidentModal from "./components/AddIncidentModal";
import DroppableColumn from "./components/DroppableColumn.jsx";
import IncidentInfoModal from "./components/IncidentInfoModal";
import FFMasterModal from "./components/FFMasterModal.jsx";

// Nur-AT-Autocomplete
import { usePlacesAutocomplete } from "./hooks/usePlacesAutocomplete";

// Start/Stop + Import (Icon & Button)
import FFFetchControl from "./components/FFFetchControl.jsx";

import {
  fetchBoard,
  fetchVehicles,
  fetchTypes,
  createCard,
  assignVehicle,
  transitionCard,
  unassignVehicle,
  resetBoard,
  setCardPersonnel,
  pdfExportUrl,
  getAutoImportConfig,
  setAutoImportConfig,
  fetchNearby,
  // ⬇️ NEU
  unlock,
  checkUnlocked,
} from "./api";

/** Skaliert die UI kompakt – unverändert */
function useCompactScale() {
  const [scale, setScale] = useState(0.9);
  useEffect(() => {
  let didRun = false;
  (async () => {
    if (didRun) return;
    didRun = true;
    try {
      for (let i = 0; i < 5; i++) {
        const ok = await checkUnlocked();
        if (ok) { setUnlocked(true); break; }
        await new Promise(r => setTimeout(r, 120));
      }
    } finally {
      setChecking(false);
    }
  })();
  }, []);
  return scale;
}
const CID = (id) => `card:${id}`;

/** Clientseitiges Geocoding über Google Maps JS API (Region AT) */
async function geocodeAddressClient(address) {
  if (!address) return null;
  if (!window.google?.maps?.Geocoder) return null;
  const geocoder = new google.maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address, region: "AT" }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const r = results[0];
        const loc = r.geometry?.location;
        resolve({
          lat: loc?.lat?.(),
          lng: loc?.lng?.(),
          formatted: r.formatted_address || address,
        });
      } else {
        resolve(null);
      }
    });
  });
}

export default function App() {
  const scale = useCompactScale();

  // 🔐 Master-Gate: erst nach Erfolg laden/rendern
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
  // Beim App-Start mehrfach kurz prüfen (Cookie kann beim Restore 1-2 Ticks „spät“ sein)
  (async () => {
   try {
      for (let i = 0; i < 5; i++) {
        const ok = await checkUnlocked();
        if (ok) { setUnlocked(true); break; }
        await new Promise(r => setTimeout(r, 120));
      }
    } finally {
      setChecking(false);
    }
  })();
 }, []);

  // === State wie gehabt =================================================
  const [board, setBoard] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [types, setTypes] = useState([]);

  const [newTitle, setNewTitle] = useState("");
  const [newOrt, setNewOrt] = useState("");
  const [newTyp, setNewTyp] = useState("");

  const [mapCtx, setMapCtx] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [loadingAddCard, setLoadingAddCard] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoInterval, setAutoInterval] = useState(30);

  const [showVehModal, setShowVehModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoCard, setInfoCard] = useState(null);
  const onShowInfo = (card) => { setInfoCard(card); setInfoOpen(true); };

  // === Proximity (keine Sichtbare UI) ==================================
  const [nearBySet, setNearBySet] = useState(() => new Set());
  const [pulseUntilMs, setPulseUntilMs] = useState(0);
  const pulseTimerRef = useRef(null);
  // =====================================================================
  



  // Places-Autocomplete (AT)
  const {
    query: ortQuery,
    setQuery: setOrtQuery,
    predictions: ortPredictions,
    getDetailsByPlaceId,
    resetSession,
    loading: ortLoading,
    error: ortError,
  } = usePlacesAutocomplete({ country: "at", debounceMs: 300, minLength: 3 });

  // Merker: Wenn der Nutzer aus den Vorschlägen wählt, haben wir direkt Geometrie
  const lastPlaceDetailsRef = useRef(null);

  // Titel
  useEffect(() => { document.title = "Einsatzstellen-Übersicht-Feuerwehr"; }, []);

  // 🧠 Initial data – NUR wenn unlocked === true!
  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      const [b, v, t] = await Promise.all([fetchBoard(), fetchVehicles(), fetchTypes()]);
      setBoard(b);
      setVehicles(v);
      setTypes(Array.isArray(t) ? t : []);
      try {
        const cfg = await getAutoImportConfig();
        setAutoEnabled(!!cfg.enabled);
        setAutoInterval(Number(cfg.intervalSec) || 30);
      } catch {}
    })();
  }, [unlocked]);

  // Sync: Hook-Query -> newOrt
  useEffect(() => { setNewOrt(ortQuery || ""); }, [ortQuery]);

  // Polling – NUR wenn unlocked === true!
  useEffect(() => {
    if (!unlocked) return;
    let timer;
    const period = Math.max(5, Math.min(60, autoEnabled ? 8 : 15));
    const tick = async () => {
      try { setBoard(await fetchBoard()); } catch {}
      timer = setTimeout(tick, period * 1000);
    };
    timer = setTimeout(tick, period * 1000);
    return () => clearTimeout(timer);
  }, [unlocked, autoEnabled]);

  // Hotkey Alt+E
  useEffect(() => {
    if (!unlocked) return;
    const onKey = (e) => {
      if (e.altKey && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        setShowAddModal(true);
        resetSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, resetSession]);

  const safeBoard = board ?? {
    columns: { neu: { items: [] }, "in-bearbeitung": { items: [] }, erledigt: { items: [] } },
  };

  // Sofort-Import (manuell)
  const [importBusy, setImportBusy] = useState(false);
  const doManualImport = async () => {
    if (importBusy) return;
    setImportBusy(true);
    try {
      const res = await fetch("/api/import/trigger", { method: "POST" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Import fehlgeschlagen (HTTP ${res.status}) ${txt}`);
      }
      setBoard(await fetchBoard());
    } catch (e) {
      alert(e.message || "Import fehlgeschlagen.");
    } finally {
      setImportBusy(false);
    }
  };

  // --- Clone-Funktionen für Fahrzeuge ---
  const [cloneBusy, setCloneBusy] = useState(false);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function nextCloneLabel(allVehicles, label) {
    const m = String(label).match(/^(.*?)-(\d+)$/);
    const base = m ? m[1] : String(label);
    let max = m ? parseInt(m[2], 10) : 1;
    for (const v of allVehicles) {
      const mm = String(v.label || "").match(new RegExp("^" + esc(base) + "-(\\d+)$"));
      if (!mm) continue;
      const n = parseInt(mm[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${base}-${max + 1}`;
  }
  async function cloneVehicleById(vehicleId, assignToCardId) {
    if (cloneBusy) return;
    const v = vehiclesById.get(vehicleId);
    if (!v) return;
    setCloneBusy(true);
    try {
      const newLabel = nextCloneLabel(vehicles, v.label || v.id);
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ort: v.ort || "", label: newLabel, mannschaft: 0 }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Clone fehlgeschlagen");

      const vRes = await fetch("/api/vehicles");
      const vList = await vRes.json();
      setVehicles(vList);

      let newId = js?.vehicle?.id;
      if (!newId) {
        const hit = vList.find(
          (x) => x.label === newLabel && x.ort === (v.ort || "") && Number(x.mannschaft) === 0
        );
        newId = hit?.id;
      }
      if (assignToCardId && newId) {
        await assignVehicle(assignToCardId, newId);
      }
      setBoard(await fetchBoard());
    } catch (e) {
      alert(e.message || "Clone fehlgeschlagen");
    } finally {
      setCloneBusy(false);
    }
  }

  const vehiclesById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);


  const [nearbyDistById, setNearbyDistById] = useState(new Map()); // unitId -> distanceKm|null
  
   const vehiclesByIdObj = useMemo(() => {
   const o = {};
   for (const [k, v] of vehiclesById.entries()) o[k] = v;
   return o;
 }, [vehiclesById]);

  const assignedIds = useMemo(() => {
    const s = new Set();
    const cols = safeBoard?.columns || {};
    for (const k of Object.keys(cols))
      for (const c of cols[k].items || [])
        for (const vid of c.assignedVehicles || []) s.add(vid);
    return s;
  }, [safeBoard]);

  const freeVehicles = useMemo(
    () => vehicles.filter((v) => v && typeof v.id !== "undefined" && !assignedIds.has(v.id)),
    [vehicles, assignedIds]
  );

  const freeByOrt = useMemo(() => {
    const map = {};
    for (const v of freeVehicles) {
      const k = v.ort || "Unbekannt";
      (map[k] ??= []).push(v);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [freeVehicles]);

  // Erst-Setup: alle Orte standardmäßig zuklappen (nur wenn noch keine Präferenz existiert)
  useEffect(() => {
    if (!unlocked) return;
    const raw = localStorage.getItem("ff_collapsed_groups");
    if (raw) return;
    if (!freeByOrt.length) return;
    const all = freeByOrt.map(([ort]) => ort);
    setCollapsedGroups(new Set(all));
    localStorage.setItem("ff_collapsed_groups", JSON.stringify(all));
  }, [unlocked, freeByOrt]);

  function getCardCol(b, id) {
    for (const k of ["neu", "in-bearbeitung", "erledigt"])
      if ((b.columns[k].items || []).some((c) => c?.id === id)) return k;
    return null;
  }
  function getCardById(b, id) {
    for (const k of ["neu", "in-bearbeitung", "erledigt"]) {
      const hit = (b.columns[k].items || []).find((c) => c?.id === id);
      if (hit) return hit;
    }
    return null;
  }
  function totalsForColumn(colId) {
    const cards = safeBoard?.columns?.[colId]?.items || [];
    if (colId === "erledigt") {
      const units   = cards.reduce((s, c) => s + (c.everVehicles?.length   || 0), 0);
      const persons = cards.reduce((s, c) => s + (Number.isFinite(c?.everPersonnel) ? c.everPersonnel : 0), 0);
      return { cards: cards.length, units, persons };
    }
    // Neu / In Bearbeitung: wie bisher (assigned + ggf. manuell)
    const units = cards.reduce((s, c) => s + (c.assignedVehicles?.length || 0), 0);
    const persons = cards.reduce((s, c) => {
      if (Number.isFinite(c?.manualPersonnel)) return s + c.manualPersonnel;
      return s + (c.assignedVehicles || []).reduce((p, id) => p + (vehiclesById.get(id)?.mannschaft ?? 0), 0);
    }, 0);
    return { cards: cards.length, units, persons };
  }
  const totalsNeu = totalsForColumn("neu");
  const totalsWip = totalsForColumn("in-bearbeitung");
  const totalsDone = totalsForColumn("erledigt");

  // === MANUELLER EINSATZ: Geocode + speichern ========================
  const addCard = async () => {
    const cleanTyp = newTyp.replace(/^T\d+\s*,?\s*/i, "").trim();
    const title = (newTitle || cleanTyp).trim();
    if (!title) { alert("Bitte Typ oder Titel angeben."); return; }

    const temp = {
      id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
      content: title,
      createdAt: new Date().toISOString(),
      statusSince: new Date().toISOString(),
      assignedVehicles: [],
      everVehicles: [],
      everPersonnel: 0,
      ort: (newOrt || "").trim(),
      typ: newTyp.trim(),
    };

    setLoadingAddCard(true);
    setBoard((p) => {
      if (!p) return p;
      const b = structuredClone(p);
      b.columns["neu"].items.unshift(temp);
      return b;
    });

    try {
      // 1) Koordinaten bestimmen:
      let coords = null;
      const d = lastPlaceDetailsRef.current;
      if (d?.geometry?.location?.lat && d?.geometry?.location?.lng) {
        coords = { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() };
      } else if (temp.ort) {
        coords = await geocodeAddressClient(temp.ort);
        if (coords) coords = { lat: coords.lat, lng: coords.lng };
      }

      // 2) Karte anlegen – Koordinaten werden an den Server übergeben und in board.json gespeichert
      const r = await createCard(title, "neu", 0, temp.ort, temp.typ, coords ?? undefined);

      // 3) Optimistische Karte ersetzen
      setBoard((p) => {
        if (!p) return p;
        const b = structuredClone(p);
        const arr = b.columns["neu"].items;
        const i = arr.findIndex((c) => c?.id === temp.id);
        if (i >= 0) arr[i] = r.card;
        else arr.unshift(r.card);
        return b;
      });

      setNewTitle("");
      setOrtQuery("");
      setNewOrt("");
      setNewTyp("");
      lastPlaceDetailsRef.current = null;
      resetSession();
    } catch {
      setBoard((p) => {
        if (!p) return p;
        const b = structuredClone(p);
        b.columns["neu"].items = b.columns["neu"].items.filter((c) => c?.id !== temp.id);
        return b;
      });
      alert("Einsatz konnte nicht angelegt werden.");
    } finally {
      setLoadingAddCard(false);
    }
  };
  // ===================================================================

  const pickOrtPrediction = async (p) => {
    try {
      const details = await getDetailsByPlaceId(p.place_id, [
        "formatted_address",
        "geometry",
        "address_components",
        "place_id",
      ]);
      lastPlaceDetailsRef.current = details || null;
      const addr = details?.formatted_address || p.description;
      setOrtQuery(addr);
      setNewOrt(addr);
    } catch (e) {
      console.error("Place details failed:", e);
      lastPlaceDetailsRef.current = null;
      setOrtQuery(p.description);
      setNewOrt(p.description);
    } finally {
      resetSession();
    }
  };


const parseAlertedTokens = (s) =>
  String(s || "")
    .split(/[;,/]/)
    .map(x => x.trim())
    .filter(Boolean);

// für robustere Vergleiche: "FF " Präfix ignorieren, lower-case, Trim
const norm = (s) => String(s || "")
  .replace(/^\s*FF\s+/i, "")
  .toLowerCase()
  .trim();

function addAllAlertedMatches(card, vehicles, idsSet, distMap) {
  const toks = parseAlertedTokens(card?.alerted).map(norm);
  if (!toks.length) return;
  for (const v of vehicles) {
    const ortOk   = toks.some(t => norm(v?.ort).includes(t));
    const labelOk = toks.some(t => norm(v?.label).includes(t));
    if (ortOk || labelOk) {
      const vid = String(v.id);
      idsSet.add(vid);
      if (!distMap.has(vid)) distMap.set(vid, null); // keine Distanz im Fallback
    }
  }
}



  // === PROXIMITY: Klick auf kleines 🚒-Icon in der Karte (nur „Neu“) ==
  async function onVehiclesIconClick(card, colId) {
    if (colId !== "neu" || !card?.id) return;
    try {
      const r = await fetchNearby(card.id);
      const ids = new Set((r?.units || []).map(u => String(u.unitId)));
      setNearBySet(ids);
      setPulseUntilMs(Date.now() + 3000);
	  
 // ✅ Distanzen in Map legen (als Number!)
 const m = new Map();
 for (const u of (r?.units || [])) {
   const val = Number(u?.distanceKm);
   m.set(String(u.unitId), Number.isFinite(val) ? val : null);
 }
 if (ids.size === 0 && card?.alerted) {
   // Nur freie Einheiten für das Fallback heranziehen
   addAllAlertedMatches(card, freeVehicles, ids, m);
 }
 setNearbyDistById(m);

 const freeIds = new Set((r?.units || []).filter(u => !u.assigned).map(u => String(u.unitId)));
 const freeUniverse = new Set(freeVehicles.map(v => String(v.id)));
 // Fallback-markierte IDs (ids) nur dann zum Aufklappen nutzen, wenn sie frei sind
 const expandIds = new Set([
   ...freeIds,
   ...[...ids].filter(id => freeUniverse.has(id))
 ]);
 for (const [ort, list] of freeByOrt) {
   if (list.some(v => expandIds.has(String(v.id)))) setCollapsed(ort, false);
 }

      clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => {
        setNearBySet(new Set());
        setPulseUntilMs(0);
		setNearbyDistById(new Map());
      }, 3200);
    } catch (e) {
      console.error("fetchNearby failed:", e);
    }
  }

  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try {
      const raw = localStorage.getItem("ff_collapsed_groups");
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const isCollapsed = (ort) => collapsedGroups.has(ort);
  const setCollapsed = (ort, collapsed) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (collapsed) next.add(ort);
      else next.delete(ort);
      localStorage.setItem("ff_collapsed_groups", JSON.stringify([...next]));
      return next;
    });
  };

  const [activeDrag, setActiveDrag] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 80, tolerance: 6 } })
  );

  const onDragEnd = async (e) => {
    const { active, over } = e;
    setActiveDrag(null);
    if (!active || !over) return;
    const aid = String(active.id || "");
    const oid = String(over.id || "");

    // Chip von Karte A -> Karte B umhängen
    if (aid.startsWith("ass:") && oid.startsWith("card:")) {
      const [, fromCardId, vehicleId] = aid.split(":");
      const toCardId = oid.slice(5);
      if (fromCardId && vehicleId && toCardId && fromCardId !== toCardId) {
        try {
          await unassignVehicle(fromCardId, vehicleId);
          await assignVehicle(toCardId, vehicleId);
          setBoard(await fetchBoard());
        } catch {
          alert("Einheit konnte nicht umgehängt werden.");
        }
      }
      return;
    }

    // Freie Einheit -> Karte
    if (aid.startsWith("veh:") && oid.startsWith("card:")) {
      try {
        await assignVehicle(oid.slice(5), aid.slice(4));
        setBoard(await fetchBoard());
      } catch {
        alert("Einheit konnte nicht zugewiesen werden.");
      }
      return;
    }

    // Karte -> Spalte / Karte (Statuswechsel)
    if (aid.startsWith("card:")) {
      const cardId = aid.slice(5);
      const from = getCardCol(safeBoard, cardId);
      if (!from) return;

      if (oid.startsWith("col:")) {
        const to = oid.slice(4);
        if (from !== to) {
          try {
            await transitionCard({ cardId, from, to, toIndex: 0 });
            setBoard(await fetchBoard());
          } catch {
            alert("Statuswechsel konnte nicht gespeichert werden.");
          }
        }
        return;
      }

      if (oid.startsWith("card:")) {
        const to = getCardCol(safeBoard, oid.slice(5));
        if (to) {
          try {
            await transitionCard({ cardId, from, to, toIndex: 0 });
            setBoard(await fetchBoard());
          } catch {
            alert("Statuswechsel konnte nicht gespeichert werden.");
          }
        }
      }
    }
  };

  const onReset = async () => {
    if (!confirm("Board wirklich zurücksetzen?")) return;
    setLoadingReset(true);
    try {
      await resetBoard();
      setBoard(await fetchBoard());
    } catch {
      alert("Reset fehlgeschlagen.");
    } finally {
      setLoadingReset(false);
    }
  };
  const onPdf = () => window.open(pdfExportUrl(), "_blank", "noopener,noreferrer");

  const toggleAuto = async () => {
    try {
      const next = await setAutoImportConfig({ enabled: !autoEnabled, intervalSec: autoInterval });
      setAutoEnabled(!!next.enabled);
      setAutoInterval(Number(next.intervalSec) || 30);
    } catch {
      alert("Konnte Auto-Import nicht ändern.");
    }
  };
  const changeInterval = async (v) => {
    const n = Math.max(5, Math.min(3600, Number(v) || 30));
    setAutoInterval(n);
    try {
      await setAutoImportConfig({ enabled: autoEnabled, intervalSec: n });
    } catch {}
  };

  const createIncident = async ({ title, ort, typ }) => {
    const r = await createCard(title, "neu", 0, ort, typ);
    setBoard((prev) => {
      if (!prev) return prev;
      const b = structuredClone(prev);
      b.columns["neu"].items.unshift(r.card);
      return b;
    });
  };

  const onTypeSelectChange = (value) => {
    setNewTyp(value);
    const clean = value.replace(/^T\d+\s*,?\s*/i, "").trim();
    if (!newTitle.trim()) setNewTitle(clean);
  };

// 🔐 Gate UI
if (checking) {
  return <div className="fixed inset-0 flex items-center justify-center bg-gray-50">Lade…</div>;
}
if (!unlocked) {
  return (
    <FFMasterModal
      open={true}
      onClose={() => {}}
      onConfirm={async (master) => {
        await unlock(master); // wirft bei falschem Passwort
        // Nach dem Setzen des Cookies: Status bis zu 4x kurz prüfen
        for (let i = 0; i < 4; i++) {
          if (await checkUnlocked()) { setUnlocked(true); return; }
          await new Promise(r => setTimeout(r, 120));
        }
        throw new Error("Sitzung noch nicht aktiv. Bitte nochmals bestätigen.");
      }}
    />
  );
}

  return (
    <div className="h-screen w-screen bg-gray-100 p-2 md:p-3 overflow-hidden flex flex-col" style={{ fontSize: `${scale}rem` }}>
      {!board && (
        <div className="fixed inset-0 z-10 bg-black/10 backdrop-blur-sm flex items-center justify-center">
          <div className="px-4 py-2 rounded-lg bg-white shadow">Lade…</div>
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h1 className="text-xl md:text-2xl font-bold">Einsatzstellen-Übersicht-Feuerwehr</h1>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onPdf} className="px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white">
            PDF
          </button>

          <button
            onClick={doManualImport}
            disabled={importBusy}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
            title="Import sofort ausführen"
          >
            {importBusy ? "Import…" : "Import"}
          </button>

          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white border">
            <input type="checkbox" checked={autoEnabled} onChange={toggleAuto} /> Auto-Import
          </label>

          <label className="inline-flex items-center gap-2 text-sm">
            Intervall (s):
            <input
              type="number"
              min="5"
              max="3600"
              value={autoInterval}
              onChange={(e) => changeInterval(e.target.value)}
              className="w-20 border rounded px-2 py-1 text-sm"
            />
          </label>

          {/* Feuerwehr-Fetcher Control */}
          <FFFetchControl />

          <button
            onClick={onReset}
            disabled={loadingReset}
            className={`px-3 py-1.5 rounded-md text-white ${loadingReset ? "bg-gray-400" : "bg-gray-700 hover:bg-gray-800"}`}
          >
            {loadingReset ? "Reset…" : "Reset"}
          </button>
        </div>
      </header>

      {/* Quick-Add – Reihenfolge: Typ → Titel → Ort */}
      <section className="mb-2 grid grid-cols-1 md:grid-cols-7 gap-2">
        {/* Typ */}
        <select
          className="border rounded px-2 py-1 md:col-span-2"
          value={newTyp}
          onChange={(e) => onTypeSelectChange(e.target.value)}
        >
          <option value="">— Typ auswählen —</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Titel */}
        <input
          className="border rounded px-2 py-1 md:col-span-2"
          placeholder="Titel (wird aus Typ übernommen)"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />

        {/* Ort (nur Österreich) */}
        <div className="relative md:col-span-2">
          <input
            className="border rounded px-2 py-1 w-full"
            placeholder="Ort (nur Österreich)"
            autoComplete="off"
            value={ortQuery}
            onChange={(e) => setOrtQuery(e.target.value)}
          />
          {ortLoading && (
            <div className="absolute z-10 mt-1 text-xs text-gray-500 bg-white border rounded px-2 py-1">Suche…</div>
          )}
          {ortError && (
            <div className="absolute z-10 mt-1 text-xs text-red-600 bg-white border rounded px-2 py-1">
              Fehler: {String(ortError)}
            </div>
          )}
          {!!ortPredictions.length && (
            <ul className="absolute z-10 mt-1 w-full max-h-52 overflow-auto bg-white border rounded shadow">
              {ortPredictions.map((p) => (
                <li
                  key={p.place_id}
                  className="px-2 py-1 hover:bg-gray-100 cursor-pointer text-sm"
                  onClick={() => pickOrtPrediction(p)}
                  title={p.description}
                >
                  {p.description}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Buttons */}
        <button
          className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
          disabled={loadingAddCard}
          onClick={addCard}
        >
          {loadingAddCard ? "Wird angelegt…" : "Einsatz anlegen"}
        </button>
      </section>

      <DndContext
        sensors={sensors}
        collisionDetection={(args) =>
          args?.active?.data?.current?.type === "vehicle" ? rectIntersection(args) : closestCorners(args)
        }
        onDragStart={(e) =>
          setActiveDrag({ type: e?.active?.data?.current?.type, id: e.active.id, data: e?.active?.data?.current })
        }
        onDragEnd={onDragEnd}
      >
        <main className="grid grid-cols-1 md:[grid-template-columns:minmax(180px,220px)_repeat(3,minmax(0,1fr))] gap-2 min-h-0 flex-1 overflow-hidden">

          {/* Einheiten (frei) */}
          <section className="bg-white rounded-xl shadow p-3 h-full flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Einheiten (frei)</h3>
              <button onClick={() => setShowVehModal(true)} className="px-2 py-1 text-sm rounded bg-emerald-600 text-white">
                + Einheit
              </button>
            </div>
            <div className="overflow-auto pr-1 flex-1 min-h-0 space-y-3">
              {freeByOrt.length === 0 && (
                <div className="text-[0.85rem] text-gray-500 italic">— alle Einheiten sind zugewiesen —</div>
              )}
              {freeByOrt.map(([ort, list]) => {
                const collapsed = isCollapsed(ort);
                return (
                  <div key={ort} className="border border-blue-400 rounded-md">
                    {/* Gruppen-Header → klick toggelt */}
                    <button
                      type="button"
                      onClick={() => setCollapsed(ort, !collapsed)}
                      className="w-full flex items-center justify-between px-2 py-2 text-left"
                      title={collapsed ? "aufklappen" : "zuklappen"}
                    >
                      <span className="text-xs font-semibold text-gray-700">{ort}</span>
                      <span className="text-xs text-gray-600">{collapsed ? "▸" : "▾"} {list.length}</span>
                    </button>

                    {/* Inhalt nur wenn aufgeklappt */}
                    {!collapsed && (
                      <div className="px-2 pb-2 grid grid-cols-1 gap-1.5">
                        {list.map((v) => (
                          <DraggableVehicle
                            key={v.id}
                            vehicle={v}
                            pillWidthPx={160}
                            near={nearBySet.has(String(v.id)) && Date.now() < pulseUntilMs}
							distKm={nearbyDistById.get(String(v.id))}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Spalten */}
          {[
            { id: "neu", title: "Neu", bg: "bg-red-100",    totals: totalsNeu  },
            { id: "in-bearbeitung", title: "In Bearbeitung", bg: "bg-yellow-100", totals: totalsWip  },
            { id: "erledigt", title: "Erledigt", bg: "bg-green-100", totals: totalsDone },
          ].map(({ id, title, bg, totals }) => (
            <DroppableColumn
              key={id}
              colId={id}
              bg={bg}
              title={
                <span className="flex items-center gap-3">
                  {title}
                  <span className="text-gray-700 text-[12px]">
                    🚒 {totals.units} • 👥 {totals.persons} • ⬛ {totals.cards}
                  </span>
                </span>
              }
            >
              <ul className="space-y-2 overflow-auto pr-1 flex-1 min-h-0">
                <SortableContext
                  items={(safeBoard.columns[id].items || []).map((c) => CID(c.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {(safeBoard.columns[id].items || []).map((c) => (
                    <SortableCard
                      key={c.id}
                      card={c}
                      colId={id}
                      vehiclesById={vehiclesById}
					  distById={nearbyDistById} 
                      pillWidthPx={160}
                      onUnassign={async (cardId, vehicleId) => {
                        await unassignVehicle(cardId, vehicleId);
                        setBoard(await fetchBoard());
                      }}
                         onOpenMap={(_) =>
     setMapCtx({
       address: c.ort,
       card: c,
       board: safeBoard,
       vehiclesById: vehiclesByIdObj,
       // optional: radiusKm: 10,
     })
   }
                      onAdvance={async (card) => {
                        if (id === "neu") {
                          await transitionCard({ cardId: card.id, from: "neu", to: "in-bearbeitung", toIndex: 0 });
                          setBoard(await fetchBoard());
                        } else if (id === "in-bearbeitung") {
                          await transitionCard({ cardId: card.id, from: "in-bearbeitung", to: "erledigt", toIndex: 0 });
                          setBoard(await fetchBoard());
                        }
                      }}
                      onEditPersonnelStart={(card, disp) => {
                        setEditing({ cardId: card.id });
                        setEditingValue(disp);
                      }}
                      editing={editing}
                      editingValue={editingValue}
                      setEditingValue={setEditingValue}
                      onEditPersonnelSave={async (cardToSave) => {
                        try {
                          await setCardPersonnel(
                            cardToSave.id,
                            editingValue === "" ? null : Number(editingValue)
                          );
                          setBoard(await fetchBoard());
                        } finally {
                          setEditing(null);
                          setEditingValue("");
                        }
                      }}
                      onEditPersonnelCancel={() => {
                        setEditing(null);
                        setEditingValue("");
                      }}
                      onClone={cloneVehicleById}
                      // ⬇️ WICHTIG: Klick auf das kleine Fahrzeug-Icon in der Karte (nur „Neu“)
                      onVehiclesIconClick={onVehiclesIconClick}
                      nearIds={nearBySet}
                      nearUntilMs={pulseUntilMs}
                      onShowInfo={onShowInfo}
                    />
                  ))}
                </SortableContext>
              </ul>
            </DroppableColumn>
          ))}
        </main>

        <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
          {activeDrag?.type === "vehicle" && (() => {
            const v = vehiclesById.get(activeDrag?.data?.vehicleId);
            if (!v) return null;
            return (
              <div className="pointer-events-none">
                <div
                  style={{ width: 160 }}
                  className="max-w-full select-none border-2 border-red-300 rounded-2xl bg-white px-2 py-1 shadow-lg"
                >
                  <div className="text-[13px] font-semibold leading-5 truncate">
                    {v.label || v.id}
                  </div>
                  <div className="text-[12px] text-gray-600 leading-4 truncate">
                    {(v.ort || "—")} · 👥 {v.mannschaft ?? 0}
                  </div>
                </div>
              </div>
            );
          })()}

          {activeDrag?.type === "card" && (() => {
            const cardId = String(activeDrag?.id || "").replace(/^card:/, "");
            const c = getCardById(safeBoard, cardId);
            if (!c) return null;
            return (
              <div className="pointer-events-none w-[280px]">
                <div className="rounded-lg bg-white shadow-xl border p-3">
                  <div className="font-semibold text-sm mb-1 truncate">{c.content}</div>
                  <div className="text-xs text-gray-600">
                    {(c.assignedVehicles?.length || 0)} Einheiten •{" "}
                    👥 {Number.isFinite(c?.manualPersonnel)
                      ? c.manualPersonnel
                      : (c.assignedVehicles || []).reduce((p, id) => p + (vehiclesById.get(id)?.mannschaft ?? 0), 0)}
                  </div>
                </div>
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>

      <a
        href="/Hilfe.pdf"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-4 right-4 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg"
      >
        Hilfe
      </a>

      {showVehModal && (
        <NewVehicleModal
          onClose={() => setShowVehModal(false)}
          onCreate={async (payload) => {
            const res = await fetch("/api/vehicles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              const txt = await res.text().catch(() => String(res.status));
              throw new Error(`HTTP ${res.status} ${txt}`);
            }
            setVehicles(await fetchVehicles());
          }}
        />
      )}

      {showAddModal && <AddIncidentModal onClose={() => setShowAddModal(false)} onCreate={createIncident} types={types} />}

      {mapCtx && <MapModal context={mapCtx} onClose={() => setMapCtx(null)} />}
      <IncidentInfoModal open={infoOpen} info={infoCard || {}} onClose={() => { setInfoOpen(false); setInfoCard(null); }} />
    </div>
  );
}
