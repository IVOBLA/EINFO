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

import { initSound, playGong } from "./sound";
import ProtokollOverview from "./pages/ProtokollOverview.jsx";
import ProtokollPage from "./pages/ProtokollPage.jsx";

// Nur-AT-Autocomplete
import { usePlacesAutocomplete } from "./hooks/usePlacesAutocomplete";

// Start/Stop + Import (Icon & Button)
import FFFetchControl from "./components/FFFetchControl.jsx";
import { initRolePolicy, canEditApp, isReadOnlyApp } from "./auth/roleUtils";

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
  resetVehiclePosition,
} from "./api";

/** Skaliert die UI kompakt – unverändert */
function useCompactScale() {
  const [scale] = useState(0.9);
  return scale;
}
const CID = (id) => `card:${id}`;
const unlocked = true;

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

  // role gating
  const user = (typeof window !== "undefined" && window.__USER__) || null;
const [policyReady, setPolicyReady] = useState(false);
useEffect(() => { initRolePolicy().then(() => setPolicyReady(true)); }, []);
const canEdit  = policyReady && canEditApp("einsatzboard");
const readOnly = !canEdit;
  // === State =================================================
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
  
  // --- Mini-Routing über Hash (stabil) ---
const [hash, setHash] = useState(window.location.hash);
useEffect(() => {
  const onHashChange = () => setHash(window.location.hash);
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}, []);
const route = hash.replace(/^#/, "");

  // Proximity
  const [nearBySet, setNearBySet] = useState(() => new Set());
  const [pulseUntilMs, setPulseUntilMs] = useState(0);
 const suppressSoundUntilRef = useRef(0);      // bis wann kein Ton
 const suppressPulseIdsRef  = useRef(new Set()); // IDs, für die kein Pulse erlaubt ist




const [sec, setSec] = useState(0);
useEffect(() => {
  document.title = "Einsatzstellen-Übersicht-Feuerwehr";
  initSound();       // einmalig Tonfreischaltung aktivieren
}, []);


// (6) Countdown für Auto-Import / Sync-Chip – läuft nur, wenn Auto-Import aktiv ist

useEffect(() => {
  if (!unlocked || !canEdit) return;        // kein Timer, wenn gesperrt oder read-only
  if (!autoEnabled) {           // kein Auto-Import -> Timer stoppen + zurücksetzen
    setSec(0);
    return;
  }
  const t = setInterval(() => setSec((s) => s + 1), 1000);
  return () => clearInterval(t);
}, [unlocked, autoEnabled]);

const remaining = autoEnabled
  ? Math.max(0, autoInterval - (sec % Math.max(1, autoInterval)))
  : 0;

  // Places-Autocomplete (AT)
  const {
    query: ortQuery, setQuery: setOrtQuery,
    predictions: ortPredictions, getDetailsByPlaceId, resetSession,
    loading: ortLoading, error: ortError,
  } = usePlacesAutocomplete({ country: "at", debounceMs: 300, minLength: 3 });

  const lastPlaceDetailsRef = useRef(null);
  useEffect(() => { document.title = "Einsatzstellen-Übersicht-Feuerwehr"; }, []);

  // Initial data
  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      const [b, v, t] = await Promise.all([fetchBoard(), fetchVehicles(), fetchTypes()]);
      setBoard(b); setVehicles(v); setTypes(Array.isArray(t) ? t : []);
      try {
        const cfg = await getAutoImportConfig();
        setAutoEnabled(!!cfg.enabled);
        setAutoInterval(Number(cfg.intervalSec) || 30);
		prevIdsRef.current = getAllCardIds(b);
      } catch {}
      setSec(0); // (6) Countdown reset nach frischem Fetch
    })();
  }, [unlocked]);

  // Fetcher nur bei aktivem Auto-Import automatisch (re)starten

useEffect(() => {
  if (!unlocked) return;
  if (!autoEnabled) return; // <== unbedingt separat!
  (async () => {
    try {
      const st = await fetch("/api/ff/status", { credentials: "include", cache: "no-store" })
        .then(r => r.json())
        .catch(() => ({ running: false }));
      if (!st.running) {
        await fetch("/api/ff/start", { method: "POST", credentials: "include" });
      }
    } catch {}
  })();
}, [unlocked, autoEnabled, autoInterval]);

  // Hook-Query -> newOrt
  useEffect(() => { setNewOrt(ortQuery || ""); }, [ortQuery]);

  // Polling (Board-Refresh unabhängig vom Countdown)
  useEffect(() => {
    if (!unlocked) return;
    let timer;
    const period = Math.max(5, Math.min(60, autoEnabled ? 8 : 15));
const tick = async () => {
  try {
    const oldIds = new Set(prevIdsRef.current);
    const nb = await fetchBoard();
    setBoard(nb);
    updatePulseForNewBoard({ oldIds, newBoard: nb, pulseMs: 8000 });
  } catch {}
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
        e.preventDefault(); setShowAddModal(true); resetSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, resetSession]);

  const safeBoard = board ?? {
    columns: { neu: { items: [] }, "in-bearbeitung": { items: [] }, erledigt: { items: [] } },
  };
  
// --- Auto-Density -------------------------------------------------------
const DENSE_THRESHOLD = 10;
function needsDense(boardLike) {
  try {
    const cols = boardLike?.columns || {};
    const counts = [
      (cols["neu"]?.items || []).length,
      (cols["in-bearbeitung"]?.items || []).length,
      (cols["erledigt"]?.items || []).length,
    ];
    return counts.some(n => n >= DENSE_THRESHOLD);
  } catch { return false; }
}

// Aktiviere/Deaktiviere die kompakte Ansicht automatisch je nach Kartenanzahl
useEffect(() => {
  const wantDense = needsDense(safeBoard);
  document.documentElement.classList.toggle("ui-dense", wantDense);
}, [safeBoard]);

// Neu-import-Puls
const [newlyImportedIds, setNewlyImportedIds] = useState(new Set());
const prevIdsRef = useRef(new Set());  // Merker der zuletzt bekannten Karten-IDs (alle Spalten)

// Nach X Sekunden die Markierungen automatisch löschen (optional)
useEffect(() => {
  if (!newlyImportedIds.size) return;
  const t = setTimeout(() => setNewlyImportedIds(new Set()), 9000);
  return () => clearTimeout(t);
}, [newlyImportedIds]);

function getAllCardIds(b) {
  const out = new Set();
  if (!b?.columns) return out;
  for (const k of Object.keys(b.columns)) {
    for (const c of (b.columns[k].items || [])) out.add(String(c.id));
  }
  return out;
}

function updatePulseForNewBoard({ oldIds, newBoard, pulseMs = 8000 }) {
  const now = Date.now();
  const newIds = getAllCardIds(newBoard);
  const added = new Set();
  for (const id of newIds) if (!oldIds.has(id)) added.add(id);

  // Eigene, gerade angelegte Karten rausfiltern (keine Pulse, kein Ton)
  const filtered = new Set(
    [...added].filter(id => !suppressPulseIdsRef.current.has(String(id)))
  );

  // einmalige Nutzung, danach wieder freigeben
  for (const id of added) suppressPulseIdsRef.current.delete(String(id));

  // Nur wenn es tatsächlich fremde neue Karten gibt (=> Pulse)
  if (filtered.size > 0) {
    setNewlyImportedIds(filtered);
    setPulseUntilMs(now + pulseMs);

    // 🔊 Ton nur, wenn Pulse aktiv ist UND kein eigenes Sperrfenster
    if (now >= suppressSoundUntilRef.current) {
      try { playGong(); } catch {}
    }
  }

  prevIdsRef.current = newIds;
}

  // Sofort-Import
  const [importBusy, setImportBusy] = useState(false);
  const doManualImport = async () => {
    if (importBusy) return;
    setImportBusy(true);
try {
  const oldIds = new Set(prevIdsRef.current);

  const res = await fetch("/api/import/trigger", { method: "POST" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Import fehlgeschlagen (HTTP ${res.status}) ${txt}`);
  }

  const newBoard = await fetchBoard();
  setBoard(newBoard);
  updatePulseForNewBoard({ oldIds, newBoard, pulseMs: 8000 });
  setSec(0); // (6) Countdown reset
} catch (e) {
  alert(e.message || "Import fehlgeschlagen.");
} finally { setImportBusy(false); }

  };

  // Clone-Funktionen Fahrzeuge
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ort: v.ort || "", label: newLabel, mannschaft: 0 }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Clone fehlgeschlagen");

      const vRes = await fetch("/api/vehicles");
      const vList = await vRes.json();
      setVehicles(vList);

      let newId = js?.vehicle?.id;
      if (!newId) {
        const hit = vList.find((x) => x.label === newLabel && x.ort === (v.ort || "") && Number(x.mannschaft) === 0);
        newId = hit?.id;
      }
      if (assignToCardId && newId) { await assignVehicle(assignToCardId, newId); }
      setBoard(await fetchBoard());
    } catch (e) {
      alert(e.message || "Clone fehlgeschlagen");
    } finally { setCloneBusy(false); }
  }

  const vehiclesById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  const [nearbyDistById, setNearbyDistById] = useState(new Map()); // unitId -> distanceKm|null
  const vehiclesByIdObj = useMemo(() => {
    const o = {}; for (const [k, v] of vehiclesById.entries()) o[k] = v; return o;
  }, [vehiclesById]);

  const assignedIds = useMemo(() => {
    const s = new Set(); const cols = safeBoard?.columns || {};
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
    for (const k of Object.keys(map))
      map[k].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [freeVehicles]);

  // Gruppen Collapse-Init
  useEffect(() => {
    if (!unlocked) return;
    const raw = localStorage.getItem("ff_collapsed_groups");
    if (raw) return;
    if (!freeByOrt.length) return;
    const all = freeByOrt.map(([ort]) => ort);
    setCollapsedGroups(new Set(all));
    localStorage.setItem("ff_collapsed_groups", JSON.stringify(all));
  }, [unlocked, freeByOrt]);

useEffect(() => {
  if (!unlocked) return;
  let t = setInterval(async () => {
    try {
      const s = await fetch("/api/activity/status", { cache: "no-store" }).then(r => r.json());
      if (typeof s?.auto?.enabled === "boolean" && s.auto.enabled !== autoEnabled) {
        setAutoEnabled(!!s.auto.enabled);
      }
    } catch {}
  }, 3000);
  return () => clearInterval(t);
}, [unlocked, autoEnabled]);

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
      const units   = cards.reduce((s, c) => s + (c.everVehicles?.length || 0), 0);
      const persons = cards.reduce((s, c) => s + (Number.isFinite(c?.everPersonnel) ? c.everPersonnel : 0), 0);
      return { cards: cards.length, units, persons };
    }
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

  // === MANUELLER EINSATZ ===
  const addCard = async () => {
    const cleanTyp = newTyp.replace(/^T\d+\s*,?\s*/i, "").trim();
    const title = (newTitle || cleanTyp).trim();
    if (!title) { alert("Bitte Typ oder Titel angeben."); return; }

    const temp = {
      id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
      content: title,
      createdAt: new Date().toISOString(),
      statusSince: new Date().toISOString(),
      assignedVehicles: [], everVehicles: [], everPersonnel: 0,
      ort: (newOrt || "").trim(), typ: newTyp.trim(),
    };

    setLoadingAddCard(true);
    setBoard((p) => {
      if (!p) return p;
      const b = structuredClone(p);
      b.columns["neu"].items.unshift(temp);
      return b;
    });

    try {
      let coords = null;
      const d = lastPlaceDetailsRef.current;
      if (d?.geometry?.location?.lat && d?.geometry?.location?.lng) {
        coords = { lat: d.geometry.location.lat(), lng: d.geometry.location.lng() };
      } else if (temp.ort) {
        const gc = await geocodeAddressClient(temp.ort);
        if (gc) coords = { lat: gc.lat, lng: gc.lng };
      }
      const r = await createCard(title, "neu", 0, temp.ort, temp.typ, coords ?? undefined);
     // eigene Erstellung: Ton/Pulse unterdrücken
     suppressSoundUntilRef.current = Date.now()// + 15000; // 15s Ruhe
     if (r?.card?.id != null) suppressPulseIdsRef.current.add(String(r.card.id));	  
      setBoard((p) => {
        if (!p) return p;
        const b = structuredClone(p);
        const arr = b.columns["neu"].items;
        const i = arr.findIndex((c) => c?.id === temp.id);
        if (i >= 0) arr[i] = r.card; else arr.unshift(r.card);
        return b;
      });

      setNewTitle(""); setOrtQuery(""); setNewOrt(""); setNewTyp("");
      lastPlaceDetailsRef.current = null; resetSession();
    } catch {
      setBoard((p) => {
        if (!p) return p;
        const b = structuredClone(p);
        b.columns["neu"].items = b.columns["neu"].items.filter((c) => c?.id !== temp.id);
        return b;
      });
      alert("Einsatz konnte nicht angelegt werden.");
    } finally { setLoadingAddCard(false); }
  };

  const pickOrtPrediction = async (p) => {
    try {
      const details = await getDetailsByPlaceId(p.place_id, [
        "formatted_address", "geometry", "address_components", "place_id",
      ]);
      lastPlaceDetailsRef.current = details || null;
      const addr = details?.formatted_address || p.description;
      setOrtQuery(addr); setNewOrt(addr);
    } catch (e) {
      console.error("Place details failed:", e);
      lastPlaceDetailsRef.current = null;
      setOrtQuery(p.description); setNewOrt(p.description);
    } finally { resetSession(); }
  };

  const parseAlertedTokens = (s) =>
    String(s || "").split(/[;,\n]/).map(x => x.trim()).filter(Boolean);
  const norm = (s) => String(s || "")
    .normalize?.("NFD").replace?.(/\p{Diacritic}/gu, "")
    .replace(/^\s*FF\s+/i, "").replace(/[._\-\/]+/g, " ")
    .replace(/\s+/g, " ").toLowerCase().trim();

  function addAllAlertedMatches(card, vehicles, idsSet, distMap) {
    const toks = parseAlertedTokens(card?.alerted).map(norm);
    if (!toks.length) return;
    for (const v of vehicles) {
      const ortOk   = toks.some(t => norm(v?.ort)   === t);
      const labelOk = toks.some(t => norm(v?.label) === t);
      if (ortOk || labelOk) {
        const vid = String(v.id);
        idsSet.add(vid);
        if (!distMap.has(vid)) distMap.set(vid, null);
      }
    }
  }

  // === PROXIMITY: Klick auf 🚒 in Karte (nur „Neu“) ===
  async function onVehiclesIconClick(card, colId) {
    if (colId !== "neu" || !card?.id) return;
    try {
      const r = await fetchNearby(card.id);
      const ids = new Set((r?.units || []).map(u => String(u.unitId)));
      if (card?.alerted) {
        const alertedTokens = parseAlertedTokens(card.alerted).map(norm);
        for (const v of freeVehicles) {
          const matchOrt   = alertedTokens.some(t => norm(v.ort)   === norm(t));
          const matchLabel = alertedTokens.some(t => norm(v.label) === norm(t));
          if (matchOrt || matchLabel) ids.add(String(v.id));
        }
      }
      setNearBySet(ids);
      setPulseUntilMs(Date.now() + 3000);

      const m = new Map();
      for (const u of (r?.units || [])) {
        const val = Number(u?.distanceKm);
        m.set(String(u.unitId), Number.isFinite(val) ? val : null);
      }
      if (ids.size === 0 && card?.alerted) addAllAlertedMatches(card, freeVehicles, ids, m);
      setNearbyDistById(m);

      const freeIds = new Set((r?.units || []).filter(u => !u.assigned).map(u => String(u.unitId)));
      const freeUniverse = new Set(freeVehicles.map(v => String(v.id)));
      const expandIds = new Set([...freeIds, ...[...ids].filter(id => freeUniverse.has(id))]);

      const alertedTokens = parseAlertedTokens(card?.alerted).map(norm);
      const alertedOrte = new Set();
      if (alertedTokens.length && freeVehicles.length > 0) {
        for (const [ort, list] of freeByOrt) {
          if (list.length === 0) continue;
          const match = alertedTokens.some(t => norm(ort) === norm(t));
          if (match) alertedOrte.add(ort);
        }
      }

      const openOrte = [];
      for (const [ort, list] of freeByOrt) {
        const hasNearby = list.some(v => expandIds.has(String(v.id)));
        if (hasNearby || alertedOrte.has(ort)) openOrte.push(ort);
      }
      setCollapsedOnly(openOrte);

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
    } catch { return new Set(); }
  });
  const isCollapsed = (ort) => collapsedGroups.has(ort);
  const setCollapsed = (ort, collapsed) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (collapsed) next.add(ort); else next.delete(ort);
      localStorage.setItem("ff_collapsed_groups", JSON.stringify([...next]));
      return next;
    });
  };

  const setCollapsedOnly = (openOrte = []) => {
    setCollapsedGroups(() => {
      const allOrte = freeByOrt.map(([o]) => o);
      const next = new Set(allOrte);
      for (const o of openOrte) next.delete(o);
      localStorage.setItem("ff_collapsed_groups", JSON.stringify([...next]));
      return next;
    });
  };
  const setCollapsedAll = (collapse = true) => {
    setCollapsedGroups(() => {
      const allOrte = freeByOrt.map(([o]) => o);
      const next = collapse ? new Set(allOrte) : new Set();
      localStorage.setItem("ff_collapsed_groups", JSON.stringify([...next]));
      return next;
    });
  };
  const toggleAllFreeGroups = () => {
    const allOrte = freeByOrt.map(([o]) => o);
    const areAllCollapsed = allOrte.length > 0 && allOrte.every(o => collapsedGroups.has(o));
    setCollapsedAll(!areAllCollapsed);
  };

  // === DND ===
  const [activeDrag, setActiveDrag] = useState(null);
  const [overColId, setOverColId] = useState(null); // (7) Hover-Spalte
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 80, tolerance: 6 } })
  );

  const onDragOver = (e) => {
    const over = e?.over; if (!over) { setOverColId(null); return; }
    const oid = String(over.id || "");
    if (oid.startsWith("col:")) setOverColId(oid.slice(4));
    else if (oid.startsWith("card:")) {
      const col = getCardCol(safeBoard, oid.slice(5));
      setOverColId(col);
    } else setOverColId(null);
  };

  const onDragEnd = async (e) => {
    if (readOnly) { setOverColId(null); setActiveDrag(null); return; }
    setOverColId(null);
    const { active, over } = e;
    setActiveDrag(null);
    if (!active || !over) return;
    const aid = String(active.id || "");
    const oid = String(over.id || "");

    // Chip von Karte A -> Karte B
    if (aid.startsWith("ass:") && oid.startsWith("card:")) {
      const [, fromCardId, vehicleId] = aid.split(":");
      const toCardId = oid.slice(5);
      if (fromCardId && vehicleId && toCardId && fromCardId !== toCardId) {
        try {
          await unassignVehicle(fromCardId, vehicleId);
          try { await resetVehiclePosition(vehicleId); } catch {}
          await assignVehicle(toCardId, vehicleId);
          setBoard(await fetchBoard());
        } catch { alert("Einheit konnte nicht umgehängt werden."); }
      }
      return;
    }

    // Freie Einheit -> Karte
    if (aid.startsWith("veh:") && oid.startsWith("card:")) {
      try {
        await assignVehicle(oid.slice(5), aid.slice(4));
        setBoard(await fetchBoard());
      } catch { alert("Einheit konnte nicht zugewiesen werden."); }
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
          } catch { alert("Statuswechsel konnte nicht gespeichert werden."); }
        }
        return;
      }

      if (oid.startsWith("card:")) {
        const to = getCardCol(safeBoard, oid.slice(5));
        if (to) {
          try {
            await transitionCard({ cardId, from, to, toIndex: 0 });
            setBoard(await fetchBoard());
          } catch { alert("Statuswechsel konnte nicht gespeichert werden."); }
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
    } catch { alert("Reset fehlgeschlagen."); }
    finally { setLoadingReset(false); }
  };
  const onPdf = () => window.open(pdfExportUrl(), "_blank", "noopener,noreferrer");


  const toggleAuto = async () => {
    try {
      const next = await setAutoImportConfig({ enabled: !autoEnabled, intervalSec: autoInterval });
      setAutoEnabled(!!next.enabled);
      setAutoInterval(Number(next.intervalSec) || 30);
      setSec(0);
    } catch { alert("Konnte Auto-Import nicht ändern."); }
  };
  const changeInterval = async (v) => {
    const n = Math.max(5, Math.min(3600, Number(v) || 30));
    setAutoInterval(n);
    try { await setAutoImportConfig({ enabled: autoEnabled, intervalSec: n }); setSec(0); } catch {}
  };

  const createIncident = async ({ title, ort, typ }) => {
    const r = await createCard(title, "neu", 0, ort, typ);
	suppressSoundUntilRef.current = Date.now()// + 15000;
   if (r?.card?.id != null) suppressPulseIdsRef.current.add(String(r.card.id));
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




// Edit: #/protokoll/edit/:nr
if (route.startsWith("/protokoll/edit/")) {
  const nrStr = route.split("/")[3];
  const editNr = Number(nrStr);
  return (
    <div className="h-screen w-screen bg-gray-100 flex flex-col">
      <header className="flex items-center justify-between p-3 border-b bg-white shadow">
        <h1 className="text-xl font-bold">Protokoll – Bearbeiten</h1>
        <button
          onClick={() => { window.location.hash = "/protokoll"; }}
          className="px-3 py-1.5 rounded-md bg-gray-600 hover:bg-gray-700 text-white"
        >
          Zur Übersicht
        </button>
      </header>
      <div className="flex-1 overflow-auto p-3">
        <ProtokollPage mode="edit" editNr={editNr} />
      </div>
    </div>
  );
}

// Neu: #/protokoll/neu
if (route.startsWith("/protokoll/neu")) {
  return (
    <div className="h-screen w-screen bg-gray-100 flex flex-col">
      <header className="flex items-center justify-between p-3 border-b bg-white shadow">
        <h1 className="text-xl font-bold">Protokoll – Eintrag anlegen</h1>
        <button
          onClick={() => { window.location.hash = "/protokoll"; }}
          className="px-3 py-1.5 rounded-md bg-gray-600 hover:bg-gray-700 text-white"
        >
          Zur Übersicht
        </button>
      </header>
      <div className="flex-1 overflow-auto p-3">
        <ProtokollPage mode="create" />
      </div>
    </div>
  );
}

// Übersicht: #/protokoll
if (route.startsWith("/protokoll")) {
  return (
    <div className="h-screen w-screen bg-gray-100 flex flex-col">
      <header className="flex items-center justify-between p-3 border-b bg-white shadow">
        <h1 className="text-xl font-bold">Protokoll</h1>
        <button
          onClick={() => { window.location.hash = "/"; }}
          className="px-3 py-1.5 rounded-md bg-gray-600 hover:bg-gray-700 text-white"
        >
          ← Zurück
        </button>
      </header>
      <div className="flex-1 overflow-auto p-3">
        <ProtokollOverview />
      </div>
    </div>
  );
}


  return (
    <div
  className="h-screen w-screen bg-gray-100 p-2 md:p-3 overflow-hidden flex flex-col"
  style={{ fontSize: "var(--ui-scale)" }}
>
      {!board && (
        <div className="fixed inset-0 z-10 bg-black/10 backdrop-blur-sm flex items-center justify-center">
          <div className="px-4 py-2 rounded-lg bg-white shadow">Lade…</div>
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h1 className="text-xl md:text-2xl font-bold">Einsatzstellen-Übersicht-Feuerwehr</h1>

       <div className="toolbar flex flex-wrap items-center gap-2">
          {/* (6) Countdown / Sync-Chip */}


          <button onClick={onPdf} className="px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white">
            PDF
          </button>
<button
  onClick={() => window.open("/api/log.csv", "_blank")}
  className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white"
  title="log.csv herunterladen"
>
  Log&nbsp;(CSV)
</button>

          <button
  onClick={() => { window.location.hash = "/protokoll"; }}
  className="px-3 py-1.5 rounded-md bg-gray-500 hover:bg-gray-600 text-white"
>
  Protokoll
</button>
		  <button
            onClick={doManualImport}
            disabled={readOnly || importBusy}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
            title="Import sofort ausführen"
          >
            {importBusy ? "Import…" : "Import"}
          </button>

          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white border">
            <input type="checkbox" checked={autoEnabled} onChange={toggleAuto} disabled={readOnly} /> Auto-Import
          </label>

<label className="interval-capsule flex items-center text-sm text-gray-700 bg-gray-50 border border-gray-300 rounded-md overflow-hidden">
  <span className="pl-3 pr-2 select-none">Intervall&nbsp;(s):</span>
  <input
    type="number"
    min="5"
    max="3600"
    value={autoInterval}
    onChange={(e) => changeInterval(e.target.value)} disabled={readOnly}
    className="h-9 w-20 bg-white border-0 rounded-none text-center text-gray-800 
               focus:outline-none focus:ring-0 focus:border-0"
  />
</label>

          {/* Feuerwehr-Fetcher Control */}
          <FFFetchControl autoEnabled={autoEnabled} remaining={remaining} disabled={readOnly} />



          <button
            onClick={onReset}
            disabled={readOnly || loadingReset}
            className={`px-3 py-1.5 rounded-md text-white ${loadingReset ? "bg-gray-400" : "bg-gray-700 hover:bg-gray-800"}`}
          >
            {loadingReset ? "Reset…" : "Reset"}
          </button>
        </div>
      </header>

      {/* Quick-Add */}
      <section className="mb-2 grid grid-cols-1 md:grid-cols-7 gap-2">
        <select
          className="border rounded px-2 py-1 md:col-span-2"
          value={newTyp} onChange={(e) => onTypeSelectChange(e.target.value)}
        >
          <option value="">— Typ auswählen —</option>
          {types.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>

        <input
          className="border rounded px-2 py-1 md:col-span-2"
          placeholder="Titel (wird aus Typ übernommen)"
          value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
        />

        <div className="relative md:col-span-2">
          <input
            className="border rounded px-2 py-1 w-full"
            placeholder="Ort (nur Österreich)"
            autoComplete="off"
            value={ortQuery} onChange={(e) => setOrtQuery(e.target.value)}
          />
          {ortLoading && (<div className="absolute z-10 mt-1 text-xs text-gray-500 bg-white border rounded px-2 py-1">Suche…</div>)}
          {ortError && (<div className="absolute z-10 mt-1 text-xs text-red-600 bg-white border rounded px-2 py-1">Fehler: {String(ortError)}</div>)}
          {!!ortPredictions.length && (
            <ul className="absolute z-10 mt-1 w-full max-h-52 overflow-auto bg-white border rounded shadow">
              {ortPredictions.map((p) => (
                <li key={p.place_id} className="px-2 py-1 hover:bg-gray-100 cursor-pointer text-sm" onClick={() => pickOrtPrediction(p)} title={p.description}>
                  {p.description}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" disabled={readOnly || loadingAddCard} onClick={addCard}>
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
  onDragOver={onDragOver}
  onDragEnd={onDragEnd}
>
        <main className="grid grid-cols-1 md:[grid-template-columns:minmax(180px,220px)_repeat(3,minmax(0,1fr))] gap-2 min-h-0 flex-1 overflow-hidden">

          {/* Einheiten (frei) */}
          <section className="bg-white rounded-xl shadow p-3 h-full flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">
                <button type="button" onClick={toggleAllFreeGroups} title="Alle Gruppen auf/zu klappen"
                        className="underline decoration-dotted hover:opacity-80 focus:outline-none">
                  Einheiten (frei)
                </button>
              </h3>
              {canEdit && (
              <button onClick={() => setShowVehModal(true)} className="px-2 py-1 text-sm rounded bg-emerald-600 text-white">
                + Einheit
              </button>
            )}
            </div>

            <div className="overflow-auto pr-1 flex-1 min-h-0 space-y-3">
              {freeByOrt.length === 0 && (<div className="text-[0.85rem] text-gray-500 italic">— alle Einheiten sind zugewiesen —</div>)}
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
                      <span className="group-chip">{list.length}</span>
                    </button>

                    {/* Inhalt nur wenn aufgeklappt */}
                    {!collapsed && (
                      <div className="px-2 pb-2 grid grid-cols-1 gap-1.5">
                        {list.map((v) => (
                          <DraggableVehicle editable={canEdit}
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
            { id: "neu", title: "Neu", bg: "bg-red-100",          totals: totalsNeu  },
            { id: "in-bearbeitung", title: "In Bearbeitung", bg: "bg-yellow-100", totals: totalsWip  },
            { id: "erledigt", title: "Erledigt", bg: "bg-green-100",   totals: totalsDone },
          ].map(({ id, title, bg, totals }) => (
            <div key={id} className={overColId === id ? "drag-over" : ""}>
              <DroppableColumn editable={canEdit}
                colId={id}
                bg={bg}
                title={
                  /* (1) Sticky Header + KPI-Badges */
                  <span className="column-header flex items-center justify-between">
                    <span className="font-semibold">{title}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="kpi-badge" data-variant="units">🚒 {totals.units}</span>
                      <span className="kpi-badge" data-variant="persons">👥 {totals.persons}</span>
                      <span className="kpi-badge" data-variant="cards">⬛ {totals.cards}</span>
                    </span>
                  </span>
                }
              >
<ul className="space-y-2 overflow-y-auto overflow-x-hidden pl-1 pr-2 py-2"
     style={{ maxHeight: "calc(100vh - 260px)" }}>
                  <SortableContext
                    items={(safeBoard.columns[id].items || []).map((c) => CID(c.id))}
                    strategy={verticalListSortingStrategy}
                  >
                    {(safeBoard.columns[id].items || []).map((c) => (
                      <SortableCard editable={canEdit}
                        key={c.id}
                        card={c}
                        colId={id}
                        vehiclesById={vehiclesById}
                        distById={nearbyDistById}
                        pillWidthPx={160}
						pulse={newlyImportedIds.has(String(c.id)) && Date.now() < pulseUntilMs}
                        onUnassign={async (cardId, vehicleId) => {
                          await unassignVehicle(cardId, vehicleId);
                          try { await resetVehiclePosition(vehicleId); } catch {}
                          setBoard(await fetchBoard());
                        }}
                        onOpenMap={(_) => setMapCtx({
                          address: c.ort, card: c, board: safeBoard, vehiclesById: vehiclesByIdObj,
                        })}
                        onAdvance={canEdit ? async (card) => {
                          if (id === "neu") {
                            await transitionCard({ cardId: card.id, from: "neu", to: "in-bearbeitung", toIndex: 0 });
                            setBoard(await fetchBoard());
                          } else if (id === "in-bearbeitung") {
                            await transitionCard({ cardId: card.id, from: "in-bearbeitung", to: "erledigt", toIndex: 0 });
                            setBoard(await fetchBoard());
                          }
                        } : undefined}
                        onEditPersonnelStart={canEdit ? (card, disp) => { setEditing({ cardId: card.id }); setEditingValue(disp); } : undefined}
                        editing={editing}
                        editingValue={editingValue}
                        setEditingValue={setEditingValue}
                        onEditPersonnelSave={canEdit ? async (cardToSave) => {
                          try {
                            await setCardPersonnel(cardToSave.id, editingValue === "" ? null : Number(editingValue));
                            setBoard(await fetchBoard());
                          } finally { setEditing(null); setEditingValue(""); }
                        } : undefined}
                        onEditPersonnelCancel={canEdit ? () => { setEditing(null); setEditingValue(""); } : undefined}
                        onClone={cloneVehicleById}
                        onVehiclesIconClick={onVehiclesIconClick}
                        nearIds={nearBySet}
                        nearUntilMs={pulseUntilMs}
                        onShowInfo={onShowInfo}
                      />
                    ))}
                  </SortableContext>
                </ul>
              </DroppableColumn>
            </div>
          ))}
        </main>

        <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
          {activeDrag?.type === "vehicle" && (() => {
            const v = vehiclesById.get(activeDrag?.data?.vehicleId);
            if (!v) return null;
            return (
              <div className="pointer-events-none">
                <div style={{ width: 160 }} className="max-w-full select-none border-2 border-red-300 rounded-2xl bg-white px-2 py-1 shadow-lg">
                  <div className="text-[13px] font-semibold leading-5 truncate">{v.label || v.id}</div>
                  <div className="text-[12px] text-gray-600 leading-4 truncate">{(v.ort || "—")} · 👥 {v.mannschaft ?? 0}</div>
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

      {/* (9) FAB */}
      {canEdit && (<button className="fab" title="Einsatz anlegen" onClick={() => setShowAddModal(true)}>＋</button>)}

      <a href="/Hilfe.pdf" target="_blank" rel="noopener noreferrer"
         className="fixed bottom-4 right-4 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg">
        Hilfe
      </a>

      {showVehModal && (
        <NewVehicleModal
          onClose={() => setShowVehModal(false)}
          onCreate={async (payload) => {
            const res = await fetch("/api/vehicles", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
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
