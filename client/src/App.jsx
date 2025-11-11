import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Start/Stop + Import (Icon & Button)
import FFFetchControl from "./components/FFFetchControl.jsx";
import { initRolePolicy, canEditApp, hasRole } from "./auth/roleUtils";
import StatusPage from "./StatusPage.jsx";
import CornerHelpLogout from "./components/CornerHelpLogout.jsx";

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
  fetchAufgabenBoard,
  resetVehiclePosition,
  updateCard,
  fetchGroupAvailability,
  fetchGroupAlerted,
  updateVehicleAvailability,
  updateGroupAvailability,
} from "./api";

const TICKER_ROLE_ID = "S2";
const TICKER_REFRESH_INTERVAL_MS = 30_000;
const TICKER_PREFIX = " - *** - NEUE LAGEMELDUNG: ";
const TICKER_SUFFIX = " - *** -";
const TICKER_SEPARATOR = "\u00a0".repeat(30);

/** Skaliert die UI kompakt – unverändert */
function useCompactScale() {
  const [scale] = useState(0.9);
  return scale;
}
const CID = (id) => `card:${id}`;
const unlocked = true;
const DEFAULT_AREA_COLOR = "#2563eb";
const INITIAL_PULSE_SUPPRESS_MS = 20_000;

function parseDurationToMs(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2]);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return (hours * 60 + minutes) * 60_000;
    }
  }
  const normalized = trimmed.replace(",", ".").toLowerCase();
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([a-zäöü]*)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  if (!unit || unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minuten") {
    return amount * 60_000;
  }
  if (unit === "h" || unit === "st" || unit === "std" || unit === "stunde" || unit === "stunden") {
    return amount * 3_600_000;
  }
  if (unit === "s" || unit === "sek" || unit === "sekunde" || unit === "sekunden") {
    return amount * 1_000;
  }
  if (unit === "d" || unit === "tag" || unit === "tage" || unit === "day" || unit === "days") {
    return amount * 86_400_000;
  }
  return null;
}

function getGroupVisualClasses({ available, alerted, assigned }) {
  if (!available) {
    return {
      container: "border-gray-300 bg-gray-50",
      label: "text-gray-400",
    };
  }
  if (assigned) {
    return {
      container: "border-red-400 bg-white",
      label: "text-gray-700",
    };
  }
  if (alerted) {
    return {
      container: "border-blue-500 bg-blue-50",
      label: "text-blue-900",
    };
  }
  return {
    container: "border-green-400 bg-white",
    label: "text-gray-700",
  };
}

export default function App() {
  const scale = useCompactScale();
  if (typeof window !== "undefined" && window.location.pathname === "/status") {
  return <StatusPage />;
}

  // role gating
const [policyReady, setPolicyReady] = useState(false);
useEffect(() => { initRolePolicy().then(() => setPolicyReady(true)); }, []);
const canEdit  = policyReady && canEditApp("einsatzboard");
const canManageFreeUnits = canEdit || (policyReady && hasRole("S1"));
const readOnly = !canEdit;
  // === State =================================================
  const [board, setBoard] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [types, setTypes] = useState([]);
  const [groupAvailability, setGroupAvailability] = useState(new Map());
  const [groupAlerted, setGroupAlerted] = useState(new Map());
  const vehicleAvailabilityTimersRef = useRef(new Map());
  const vehicleUnavailableUntilRef = useRef(new Map());
  const groupAvailabilityTimersRef = useRef(new Map());
  const groupUnavailableUntilRef = useRef(new Map());

  const askDuration = useCallback((label) => {
    if (typeof window === "undefined") {
      return { cancelled: true };
    }
    const message = `Bitte Dauer der Nicht-Verfügbarkeit für ${label} angeben (z.\u202fB. 30, 2h oder 1:30). Leer lassen für unbegrenzt.`;
    const input = window.prompt(message, "");
    if (input === null) {
      return { cancelled: true };
    }
    const trimmed = input.trim();
    if (!trimmed) {
      return { cancelled: false, untilMs: null, untilIso: null };
    }
    const durationMs = parseDurationToMs(trimmed);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      window.alert("Ungültige Dauer. Bitte z.\u202fB. 30, 2h oder 1:30 eingeben.");
      return { cancelled: true };
    }
    const untilMs = Date.now() + durationMs;
    return { cancelled: false, untilMs, untilIso: new Date(untilMs).toISOString() };
  }, []);

  const refreshVehicles = useCallback(async () => {
    try {
      const next = await fetchVehicles();
      setVehicles(next);
    } catch (error) {
      console.error(error);
    }
  }, [setVehicles]);

  const scheduleVehicleAutoEnable = useCallback(
    (idStr, untilIso) => {
      if (!idStr || !untilIso) return;
      const untilMs = Date.parse(untilIso);
      if (!Number.isFinite(untilMs)) return;
      const timers = vehicleAvailabilityTimersRef.current;
      const existing = timers.get(idStr);
      if (existing && existing.untilIso === untilIso) {
        return;
      }
      if (existing) {
        clearTimeout(existing.timeout);
        timers.delete(idStr);
      }
      const delay = untilMs - Date.now();
      const run = async () => {
        vehicleAvailabilityTimersRef.current.delete(idStr);
        vehicleUnavailableUntilRef.current.delete(idStr);
        try {
          await updateVehicleAvailability(idStr, true);
        } catch (error) {
          console.error(error);
        }
        await refreshVehicles();
      };
      if (delay <= 0) {
        run();
        return;
      }
      const timeout = setTimeout(run, delay);
      timers.set(idStr, { timeout, untilIso });
    },
    [refreshVehicles]
  );

  const scheduleGroupAutoEnable = useCallback(
    (groupName, untilIso) => {
      if (!groupName || !untilIso) return;
      const untilMs = Date.parse(untilIso);
      if (!Number.isFinite(untilMs)) return;
      const timers = groupAvailabilityTimersRef.current;
      const existing = timers.get(groupName);
      if (existing && existing.untilIso === untilIso) {
        return;
      }
      if (existing) {
        clearTimeout(existing.timeout);
        timers.delete(groupName);
      }
      const delay = untilMs - Date.now();
      const run = async () => {
        groupAvailabilityTimersRef.current.delete(groupName);
        groupUnavailableUntilRef.current.delete(groupName);
        try {
          await updateGroupAvailability(groupName, true);
        } catch (error) {
          console.error(error);
        }
        await refreshVehicles();
        setGroupAvailability((prev) => {
          const next = new Map(prev);
          next.set(groupName, true);
          return next;
        });
      };
      if (delay <= 0) {
        run();
        return;
      }
      const timeout = setTimeout(run, delay);
      timers.set(groupName, { timeout, untilIso });
    },
    [refreshVehicles, setGroupAvailability]
  );

  useEffect(() => {
    const timers = vehicleAvailabilityTimersRef.current;
    const seen = new Set();
    for (const vehicle of vehicles) {
      if (!vehicle) continue;
      const idStr = String(vehicle.id ?? "").trim();
      if (!idStr) continue;
      seen.add(idStr);
      const effectiveAvailable = (vehicle.available !== false) && (vehicle.groupAvailable !== false);
      const rawUntil = vehicle.unavailableUntil || vehicleUnavailableUntilRef.current.get(idStr) || null;
      const parsed = rawUntil ? Date.parse(rawUntil) : NaN;
      const normalized = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
      const groupName = String(vehicle.ort ?? "").trim();
      const groupAvailable = groupAvailability.has(groupName)
        ? groupAvailability.get(groupName)
        : true;
      if (groupAvailable === false) {
        if (normalized) {
          vehicleUnavailableUntilRef.current.set(idStr, normalized);
        } else {
          vehicleUnavailableUntilRef.current.delete(idStr);
        }
        const entry = timers.get(idStr);
        if (entry) {
          clearTimeout(entry.timeout);
          timers.delete(idStr);
        }
        continue;
      }
      if (effectiveAvailable || !normalized) {
        const entry = timers.get(idStr);
        if (entry) {
          clearTimeout(entry.timeout);
          timers.delete(idStr);
        }
        vehicleUnavailableUntilRef.current.delete(idStr);
        continue;
      }
      vehicleUnavailableUntilRef.current.set(idStr, normalized);
      scheduleVehicleAutoEnable(idStr, normalized);
    }
    for (const [id, entry] of Array.from(timers.entries())) {
      if (!seen.has(id)) {
        clearTimeout(entry.timeout);
        timers.delete(id);
        vehicleUnavailableUntilRef.current.delete(id);
      }
    }
  }, [vehicles, groupAvailability, scheduleVehicleAutoEnable]);

  useEffect(() => {
    const timers = groupAvailabilityTimersRef.current;
    const seen = new Set();
    for (const [name, available] of groupAvailability.entries()) {
      const groupName = String(name || "").trim();
      if (!groupName) continue;
      seen.add(groupName);
      if (available !== false) {
        const entry = timers.get(groupName);
        if (entry) {
          clearTimeout(entry.timeout);
          timers.delete(groupName);
        }
        groupUnavailableUntilRef.current.delete(groupName);
        continue;
      }
      const rawUntil = groupUnavailableUntilRef.current.get(groupName) || null;
      const parsed = rawUntil ? Date.parse(rawUntil) : NaN;
      if (!Number.isFinite(parsed)) {
        const entry = timers.get(groupName);
        if (entry) {
          clearTimeout(entry.timeout);
          timers.delete(groupName);
        }
        groupUnavailableUntilRef.current.delete(groupName);
        continue;
      }
      const normalized = new Date(parsed).toISOString();
      groupUnavailableUntilRef.current.set(groupName, normalized);
      scheduleGroupAutoEnable(groupName, normalized);
    }
    for (const [name, entry] of Array.from(timers.entries())) {
      if (!seen.has(name)) {
        clearTimeout(entry.timeout);
        timers.delete(name);
        groupUnavailableUntilRef.current.delete(name);
      }
    }
  }, [groupAvailability, scheduleGroupAutoEnable]);

  useEffect(() => () => {
    for (const { timeout } of vehicleAvailabilityTimersRef.current.values()) {
      clearTimeout(timeout);
    }
    vehicleAvailabilityTimersRef.current.clear();
    vehicleUnavailableUntilRef.current.clear();
    for (const { timeout } of groupAvailabilityTimersRef.current.values()) {
      clearTimeout(timeout);
    }
    groupAvailabilityTimersRef.current.clear();
    groupUnavailableUntilRef.current.clear();
  }, []);

  const syncGroupAvailabilityFromVehicles = useCallback((list) => {
    if (!Array.isArray(list)) return;
    setGroupAvailability((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const veh of list) {
        if (!veh || !veh.ort) continue;
        const ort = String(veh.ort);
        const available = veh.groupAvailable !== false;
        if (!next.has(ort) || next.get(ort) !== available) {
          next.set(ort, available);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    syncGroupAvailabilityFromVehicles(vehicles);
  }, [vehicles, syncGroupAvailabilityFromVehicles]);

  const applyGroupAvailabilityResponse = useCallback((payload) => {
    const entries = Object.entries(payload?.availability || {});
    const availabilityPairs = [];
    const untilMap = new Map();
    for (const [name, value] of entries) {
      const isUnavailable =
        value === false ||
        (value && typeof value === "object" && value.available === false);
      const available = !isUnavailable;
      let untilIso = null;
      if (!available) {
        const rawUntil = value && typeof value === "object" ? value.until : null;
        if (typeof rawUntil === "string" && rawUntil.trim()) {
          const parsed = Date.parse(rawUntil);
          if (!Number.isNaN(parsed) && parsed > Date.now()) {
            untilIso = new Date(parsed).toISOString();
          }
        }
      }
      availabilityPairs.push([name, available]);
      if (!available && untilIso) {
        untilMap.set(name, untilIso);
      }
    }
    groupUnavailableUntilRef.current = untilMap;
    setGroupAvailability(new Map(availabilityPairs));
  }, []);
  const applyGroupAlertedResponse = useCallback((payload) => {
    const entries = Object.entries(payload?.alerted || {});
    setGroupAlerted(new Map(entries.map(([name, value]) => [name, value === true])));
  }, []);
  const [areaFilter, setAreaFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPulseActive, setFilterPulseActive] = useState(false);
  const [mapCtx, setMapCtx] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [loadingReset, setLoadingReset] = useState(false);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoInterval, setAutoInterval] = useState(30);

  const [showVehModal, setShowVehModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoCard, setInfoCard] = useState(null);
  const [infoForceEdit, setInfoForceEdit] = useState(false);
  const onShowInfo = (card) => { setInfoCard(card); setInfoForceEdit(false); setInfoOpen(true); };
  const tickerRequestRef = useRef(null);
  const [tickerMessages, setTickerMessages] = useState([]);
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
  const pulseTimerRef = useRef(null);
  const filterPulseTimerRef = useRef(null);
  const suppressSoundUntilRef = useRef(0);      // bis wann kein Ton
  const suppressPulseIdsRef  = useRef(new Set()); // IDs, für die kein Pulse erlaubt ist
  const initialPulseSuppressUntilRef = useRef(0); // Start-Sperre nach Laden



const [sec, setSec] = useState(0);
useEffect(() => {
  document.title = "Einsatzstellen-Übersicht-Feuerwehr";
  initSound();       // einmalig Tonfreischaltung aktivieren
}, []);

  useEffect(() => () => {
    if (filterPulseTimerRef.current) {
      clearTimeout(filterPulseTimerRef.current);
      filterPulseTimerRef.current = null;
    }
    if (pulseTimerRef.current) {
      clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (areaFilter) return;
    if (filterPulseTimerRef.current) {
      clearTimeout(filterPulseTimerRef.current);
      filterPulseTimerRef.current = null;
    }
    if (filterPulseActive) setFilterPulseActive(false);
 }, [areaFilter, filterPulseActive]);
  // --- Logout ---

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
  useEffect(() => { document.title = "Einsatzstellen-Übersicht-Feuerwehr"; }, []);

  // Initial data
  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      const [b, v, t, g, ga] = await Promise.all([
        fetchBoard(),
        fetchVehicles(),
        fetchTypes(),
        fetchGroupAvailability().catch(() => ({ availability: {} })),
        fetchGroupAlerted().catch(() => ({ alerted: {} })),
      ]);
      setBoard(b); setVehicles(v); setTypes(Array.isArray(t) ? t : []);
      applyGroupAvailabilityResponse(g);
      applyGroupAlertedResponse(ga);
      prevIdsRef.current = getAllCardIds(b);
      initialPulseSuppressUntilRef.current = Date.now() + INITIAL_PULSE_SUPPRESS_MS;
      try {
        const cfg = await getAutoImportConfig();
        setAutoEnabled(!!cfg.enabled);
        setAutoInterval(Number(cfg.intervalSec) || 30);
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

  useEffect(() => {
    if (!unlocked) return undefined;
    let cancelled = false;
    let timer = null;
    const period = Math.max(5, Math.min(60, autoEnabled ? 8 : 15));

    const tick = async () => {
      try {
        const data = await fetchGroupAlerted();
        if (!cancelled) {
          applyGroupAlertedResponse(data);
        }
      } catch {}
      if (!cancelled) {
        timer = setTimeout(tick, period * 1000);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [unlocked, autoEnabled, applyGroupAlertedResponse]);

  // Hotkey Alt+E
  useEffect(() => {
    if (!unlocked) return;
    const onKey = (e) => {
      if (e.altKey && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        setShowAddModal(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked]);

  const searchNeedle = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const hasSearch = searchNeedle.length > 0;

  const safeBoard = board ?? {
    columns: { neu: { items: [] }, "in-bearbeitung": { items: [] }, erledigt: { items: [] } },
  };

  const tickerText = useMemo(() => {
    if (!tickerMessages.length) return "";
    const entries = tickerMessages.map((message) => `${TICKER_PREFIX}${message}${TICKER_SUFFIX}`);
    return `${entries.join(TICKER_SEPARATOR)}${TICKER_SEPARATOR}`;
  }, [tickerMessages]);

  const loadTickerMessages = useCallback(async () => {
    if (tickerRequestRef.current) {
      tickerRequestRef.current.abort();
    }
    const controller = new AbortController();
    tickerRequestRef.current = controller;

    try {
      const data = await fetchAufgabenBoard(TICKER_ROLE_ID, { signal: controller.signal });
      const items = Array.isArray(data?.items) ? data.items : [];

      const nextMessages = items
        .filter((item) => String(item?.status ?? "").trim().toLowerCase() === "neu")
        .filter((item) => String(item?.type ?? "").trim().toLowerCase() === "lagemeldung")
        .map((item) => (typeof item?.desc === "string" ? item.desc : ""))
        .map((desc) => desc.replace(/\s+/g, " ").trim())
        .filter(Boolean);

      if (!controller.signal.aborted) {
        setTickerMessages(nextMessages);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setTickerMessages([]);
      }
    } finally {
      if (tickerRequestRef.current === controller) {
        tickerRequestRef.current = null;
      }
    }
  }, [setTickerMessages]);

  useEffect(() => {
    if (!policyReady) return undefined;

    const run = () => {
      loadTickerMessages().catch(() => {});
    };

    run();
    const interval = setInterval(run, TICKER_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (tickerRequestRef.current) {
        tickerRequestRef.current.abort();
      }
    };
  }, [loadTickerMessages, policyReady]);

  const visibleBoard = useMemo(() => {
    const hasArea = !!areaFilter;
    if (!hasArea && !hasSearch) return safeBoard;
    const areaId = String(areaFilter);
    const nextColumns = {};
    for (const [key, col] of Object.entries(safeBoard?.columns || {})) {
      let items = col?.items || [];
      if (hasArea) {
        items = items.filter((card) => cardMatchesAreaFilter(card, areaId));
      }
      if (hasSearch) {
        items = items.filter((card) => cardMatchesSearch(card, searchNeedle));
      }
      nextColumns[key] = {
        ...col,
        items,
      };
    }
    return { ...safeBoard, columns: nextColumns };
  }, [safeBoard, areaFilter, hasSearch, searchNeedle]);


const ensureAreaHumanId = (value, isArea = false) => {
  const raw = String(value || "");
  if (!isArea || !raw) return raw;
  if (/^B/i.test(raw)) return `B${raw.slice(1)}`;
  if (/^[A-Za-z]/.test(raw)) return `B${raw.slice(1)}`;
  return `B${raw}`;
};


const toAreaLabel = (c) => {
   if (!c) return "";
  const idPartRaw = c.humanId ? String(c.humanId) : "";
  const idPart = ensureAreaHumanId(idPartRaw, !!c.isArea);
  const titlePart = c.content ? String(c.content) : "";
  const joined = [idPart, titlePart].filter(Boolean).join(" – ");
  return joined || idPart || titlePart || "";
};

  const areaCards = useMemo(() => {
    const cols = safeBoard?.columns || {};
    const result = [];
    for (const key of Object.keys(cols)) {
      for (const card of cols[key]?.items || []) {
        if (card?.isArea) result.push(card);
      }
    }
    return result;
  }, [safeBoard]);

  const areaLabelById = useMemo(() => {
    const map = new Map();
    areaCards.forEach((c) => {
      if (!c?.id) return;
     const key = String(c.id);
      map.set(key, toAreaLabel(c));
    });
    return map;
  }, [areaCards]);

const areaColorById = useMemo(() => {
    const map = new Map();
    areaCards.forEach((c) => {
      if (!c?.id) return;
      map.set(String(c.id), c.areaColor || null);
    });
    return map;
  }, [areaCards]);


  const areaOptions = useMemo(
    () =>
      areaCards.map((c) => ({
id: String(c.id),
        label: areaLabelById.get(String(c.id)) || toAreaLabel(c),
        color: areaColorById.get(String(c.id)) || null,
      })),
    [areaCards, areaLabelById, areaColorById]
  );

useEffect(() => {
    if (!areaFilter) return;
    const exists = areaOptions.some((opt) => String(opt.id) === areaFilter);
    if (!exists) setAreaFilter("");
  }, [areaFilter, areaOptions]);

 const areaFilterLabel = useMemo(() => {
    if (!areaFilter) return "";
    const key = String(areaFilter);
    return areaLabelById.get(key) || areaOptions.find((opt) => String(opt.id) === key)?.label || "";
  }, [areaFilter, areaLabelById, areaOptions]);

  const syncBoardAndInfo = (updatedCard, nextBoard) => {
    if (nextBoard) {
      setBoard(nextBoard);
      if (updatedCard?.id && infoCard?.id === updatedCard.id) {
        const fresh = getCardById(nextBoard, updatedCard.id);
        setInfoCard(fresh || updatedCard);
      }
      return;
    }
    if (updatedCard) {
      setBoard((prev) => {
        if (!prev) return prev;
        const b = structuredClone(prev);
        for (const key of Object.keys(b.columns || {})) {
          const arr = b.columns[key]?.items || [];
          const idx = arr.findIndex((c) => c?.id === updatedCard.id);
          if (idx >= 0) {
            arr[idx] = { ...arr[idx], ...updatedCard };
            break;
          }
        }
        return b;
      });
      if (infoCard?.id === updatedCard.id) {
        setInfoCard((prev) => (prev ? { ...prev, ...updatedCard } : updatedCard));
      }
    }
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

function cardMatchesAreaFilter(card, targetAreaId) {
  if (!card) return false;
  if (!targetAreaId) return true;
  if (card.isArea) return String(card.id) === targetAreaId;
  if (!card.areaCardId) return false;
  return String(card.areaCardId) === targetAreaId;
}

function cardMatchesSearch(card, needle) {
  if (!needle) return true;
  if (!card) return false;
  try {
    return JSON.stringify(card).toLowerCase().includes(needle);
  } catch {
    return false;
  }
}

function vehicleMatchesSearch(vehicle, needle) {
  if (!needle) return true;
  if (!vehicle) return false;
  try {
    return JSON.stringify(vehicle).toLowerCase().includes(needle);
  } catch {
    return false;
  }
}

function getCardById(boardData, cardId) {
  if (!boardData?.columns) return null;
  const lookupId = String(cardId);
  for (const col of Object.values(boardData.columns)) {
    for (const entry of col?.items || []) {
      if (String(entry?.id) === lookupId) {
        return entry;
      }
    }
  }
  return null;
}

const triggerFilterPulse = (durationMs = 8000) => {
  setFilterPulseActive(true);
  if (filterPulseTimerRef.current) {
    clearTimeout(filterPulseTimerRef.current);
  }
  filterPulseTimerRef.current = setTimeout(() => {
    setFilterPulseActive(false);
    filterPulseTimerRef.current = null;
  }, durationMs);
};

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

  const neuColumnItems = newBoard?.columns?.["neu"]?.items || [];
  const neuIdSet = new Set(neuColumnItems.map((card) => String(card?.id)));
  const eligible = new Set(
    [...filtered].filter((id) => neuIdSet.has(String(id)))
  );

  // Nur wenn es tatsächlich fremde neue Karten im Status "Neu" gibt (=> Pulse)
  if (eligible.size > 0) {
    if (now < initialPulseSuppressUntilRef.current) {
      prevIdsRef.current = newIds;
      return;
    }

    setNewlyImportedIds(eligible);
    setPulseUntilMs(now + pulseMs);

    if (areaFilter) {
      const filterId = String(areaFilter);
      const hiddenByFilter = [...eligible].some((id) => {
        const card = getCardById(newBoard, id);
        if (!card) return false;
        return !cardMatchesAreaFilter(card, filterId);
      });
      if (hiddenByFilter) {
        triggerFilterPulse(pulseMs);
      }
    }

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

  const res = await fetch("/api/import/trigger", { method: "POST", credentials: "include" });
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
  async function cloneVehicleById(vehicleId, assignToCardId) {
    if (cloneBusy) return;
    const v = vehiclesById.get(vehicleId);
    if (!v) return;
    const baseId = String(v.id || "");
    const previousCloneIds = new Set(
      vehicles
        .filter((x) => String(x?.cloneOf || "").trim() === baseId)
        .map((x) => String(x?.id))
    );
    setCloneBusy(true);
    try {
      const cloneLabel = v.label || v.id;
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ort: v.ort || "", label: cloneLabel, mannschaft: 0, cloneOf: v.id }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Clone fehlgeschlagen");

      const vRes = await fetch("/api/vehicles", { credentials: "include" });
      const vList = await vRes.json();
      setVehicles(vList);

      let newId = js?.vehicle?.id;
      if (!newId) {
        const hit = vList.find((x) => {
          if (!x) return false;
          const idStr = String(x.id || "");
          if (!idStr || previousCloneIds.has(idStr)) return false;
          if (String(x.ort || "") !== String(v.ort || "")) return false;
          const target = String(x.cloneOf || "").trim();
          return target === baseId;
        });
        newId = hit?.id;
      }
      if (assignToCardId && newId) { await assignVehicle(assignToCardId, newId); }
      setBoard(await fetchBoard());
    } catch (e) {
      alert(e.message || "Clone fehlgeschlagen");
    } finally { setCloneBusy(false); }
  }

  const vehiclesById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  async function handleVehicleAvailabilityChange(vehicle, nextAvailable) {
    if (!canManageFreeUnits) return;
    if (!vehicle) return;
    const idStr = String(vehicle.id ?? "").trim();
    if (!idStr) return;
    const target = nextAvailable === true;
    const prevValue = vehicle.available !== false;
    if (prevValue === target) return;

    let untilIso = null;
    if (!target) {
      const label = typeof vehicle.label === "string" && vehicle.label.trim()
        ? `Einheit ${vehicle.label.trim()}`
        : "die Einheit";
      const result = askDuration(label);
      if (result.cancelled) {
        return;
      }
      untilIso = result.untilIso;
    }

    const prevUntilIso = vehicleUnavailableUntilRef.current.get(idStr) || null;
    const existingTimer = vehicleAvailabilityTimersRef.current.get(idStr);
    if (existingTimer) {
      clearTimeout(existingTimer.timeout);
      vehicleAvailabilityTimersRef.current.delete(idStr);
    }

    if (target) {
      vehicleUnavailableUntilRef.current.delete(idStr);
    } else if (untilIso) {
      vehicleUnavailableUntilRef.current.set(idStr, untilIso);
    } else {
      vehicleUnavailableUntilRef.current.delete(idStr);
    }

    setVehicles((prev) =>
      prev.map((item) =>
        String(item?.id ?? "") === idStr
          ? { ...item, available: target, unavailableUntil: untilIso || null }
          : item
      )
    );
    try {
      const response = await updateVehicleAvailability(idStr, target, untilIso);
      if (target) {
        vehicleUnavailableUntilRef.current.delete(idStr);
        setVehicles((prev) =>
          prev.map((item) =>
            String(item?.id ?? "") === idStr ? { ...item, unavailableUntil: null } : item
          )
        );
        return;
      }
      const rawServerUntil = response && typeof response.until === "string" ? response.until : null;
      const parsed = rawServerUntil ? Date.parse(rawServerUntil) : NaN;
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        const normalized = new Date(parsed).toISOString();
        vehicleUnavailableUntilRef.current.set(idStr, normalized);
        setVehicles((prev) =>
          prev.map((item) =>
            String(item?.id ?? "") === idStr ? { ...item, unavailableUntil: normalized } : item
          )
        );
        scheduleVehicleAutoEnable(idStr, normalized);
      } else {
        vehicleUnavailableUntilRef.current.delete(idStr);
        setVehicles((prev) =>
          prev.map((item) =>
            String(item?.id ?? "") === idStr ? { ...item, unavailableUntil: null } : item
          )
        );
      }
    } catch (error) {
      console.error(error);
      if (prevUntilIso) {
        vehicleUnavailableUntilRef.current.set(idStr, prevUntilIso);
        scheduleVehicleAutoEnable(idStr, prevUntilIso);
      } else {
        vehicleUnavailableUntilRef.current.delete(idStr);
      }
      setVehicles((prev) =>
        prev.map((item) =>
          String(item?.id ?? "") === idStr
            ? { ...item, available: prevValue, unavailableUntil: prevUntilIso || null }
            : item
        )
      );
      alert(error?.message || "Verfügbarkeit der Einheit konnte nicht gespeichert werden.");
    }
  }

  async function handleGroupAvailabilityChange(name, nextAvailable) {
    if (!canManageFreeUnits) return;
    const groupName = String(name ?? "").trim();
    if (!groupName) return;
    const target = nextAvailable === true;
    const prevValue = groupAvailability.get(groupName) ?? true;
    const prevVehicleAvailability = new Map();
    for (const item of vehicles) {
      if (String(item?.ort ?? "") === groupName) {
        const idStr = String(item?.id ?? "");
        if (idStr) {
          prevVehicleAvailability.set(idStr, {
            available: item?.available !== false,
            unavailableUntil:
              typeof item?.unavailableUntil === "string" && item.unavailableUntil.trim()
                ? item.unavailableUntil
                : null,
          });
        }
      }
    }
    if (prevValue === target) return;

    let untilIso = null;
    if (!target) {
      const result = askDuration(`Gruppe ${groupName}`);
      if (result.cancelled) {
        return;
      }
      untilIso = result.untilIso;
    }

    const prevGroupUntil = groupUnavailableUntilRef.current.get(groupName) || null;
    const existingTimer = groupAvailabilityTimersRef.current.get(groupName);
    if (existingTimer) {
      clearTimeout(existingTimer.timeout);
      groupAvailabilityTimersRef.current.delete(groupName);
    }

    if (target) {
      groupUnavailableUntilRef.current.delete(groupName);
      for (const [idStr, prevEntry] of prevVehicleAvailability.entries()) {
        const prevUntil = prevEntry?.unavailableUntil || null;
        if (prevUntil) {
          vehicleUnavailableUntilRef.current.set(idStr, prevUntil);
        } else {
          vehicleUnavailableUntilRef.current.delete(idStr);
        }
      }
    } else {
      if (untilIso) {
        groupUnavailableUntilRef.current.set(groupName, untilIso);
      } else {
        groupUnavailableUntilRef.current.delete(groupName);
      }
      for (const idStr of prevVehicleAvailability.keys()) {
        if (untilIso) {
          vehicleUnavailableUntilRef.current.set(idStr, untilIso);
        } else {
          vehicleUnavailableUntilRef.current.delete(idStr);
        }
      }
    }

    setGroupAvailability((prev) => {
      const next = new Map(prev);
      next.set(groupName, target);
      return next;
    });

    setVehicles((prev) =>
      prev.map((item) => {
        if (String(item?.ort ?? "") !== groupName) return item;
        const idStr = String(item?.id ?? "");
        if (!idStr) return item;
        if (target) {
          const prevEntry = prevVehicleAvailability.get(idStr);
          const prevAvailable = prevEntry?.available ?? true;
          const prevUntil = prevEntry?.unavailableUntil || null;
          return {
            ...item,
            groupAvailable: true,
            available: prevAvailable,
            unavailableUntil: prevUntil,
          };
        }
        return {
          ...item,
          groupAvailable: false,
          available: false,
          unavailableUntil: untilIso || null,
        };
      })
    );

    try {
      const response = await updateGroupAvailability(groupName, target, untilIso);
      if (target) {
        groupUnavailableUntilRef.current.delete(groupName);
        return;
      }
      const rawServerUntil = response && typeof response.until === "string" ? response.until : null;
      const parsed = rawServerUntil ? Date.parse(rawServerUntil) : NaN;
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        const normalized = new Date(parsed).toISOString();
        groupUnavailableUntilRef.current.set(groupName, normalized);
        for (const idStr of prevVehicleAvailability.keys()) {
          vehicleUnavailableUntilRef.current.set(idStr, normalized);
        }
        setVehicles((prev) =>
          prev.map((item) =>
            String(item?.ort ?? "") === groupName
              ? { ...item, unavailableUntil: normalized, groupAvailable: false, available: false }
              : item
          )
        );
        scheduleGroupAutoEnable(groupName, normalized);
      } else {
        groupUnavailableUntilRef.current.delete(groupName);
        setVehicles((prev) =>
          prev.map((item) =>
            String(item?.ort ?? "") === groupName
              ? { ...item, unavailableUntil: null, groupAvailable: false, available: false }
              : item
          )
        );
      }
    } catch (error) {
      console.error(error);
      if (prevGroupUntil) {
        groupUnavailableUntilRef.current.set(groupName, prevGroupUntil);
        scheduleGroupAutoEnable(groupName, prevGroupUntil);
      } else {
        groupUnavailableUntilRef.current.delete(groupName);
      }
      setGroupAvailability((prev) => {
        const next = new Map(prev);
        next.set(groupName, prevValue);
        return next;
      });
      setVehicles((prev) =>
        prev.map((item) => {
          if (String(item?.ort ?? "") !== groupName) return item;
          const idStr = String(item?.id ?? "");
          if (!idStr) return item;
          const prevEntry = prevVehicleAvailability.get(idStr);
          const prevAvailable = prevEntry?.available ?? true;
          const prevUntil = prevEntry?.unavailableUntil || null;
          if (prevUntil) {
            vehicleUnavailableUntilRef.current.set(idStr, prevUntil);
          } else {
            vehicleUnavailableUntilRef.current.delete(idStr);
          }
          return {
            ...item,
            groupAvailable: prevValue,
            available: prevValue ? prevAvailable : false,
            unavailableUntil: prevValue ? prevUntil : null,
          };
        })
      );
      alert(error?.message || "Verfügbarkeit der Gruppe konnte nicht gespeichert werden.");
    }
  }

  const cloneIdSet = useMemo(() => {
    const clones = new Set();
    const isCloneMarker = (value) =>
      value === true || (typeof value === "string" && value.trim().toLowerCase() === "clone");
    for (const veh of vehicles) {
      if (!veh || typeof veh.id === "undefined") continue;
      const idStr = String(veh.id);
      if (!idStr) continue;
      const cloneTag = typeof veh.cloneOf === "string" ? veh.cloneOf.trim() : "";
      if (cloneTag) {
        clones.add(idStr);
        continue;
      }
      if (veh.isClone === true || isCloneMarker(veh.clone)) {
        clones.add(idStr);
      }
    }
    return clones;
  }, [vehicles]);
  const isCloneId = (id) => cloneIdSet.has(String(id));

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

  const assignedGroups = useMemo(() => {
    const set = new Set();
    for (const id of assignedIds) {
      const vehicle = vehiclesById.get(id);
      const ort = typeof vehicle?.ort === "string" ? vehicle.ort : "";
      if (ort) set.add(ort);
    }
    return set;
  }, [assignedIds, vehiclesById]);

  const freeVehicles = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          v &&
          typeof v.id !== "undefined" &&
          !assignedIds.has(v.id) &&
          !cloneIdSet.has(String(v.id))
      ),
    [vehicles, assignedIds, cloneIdSet]
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

  const visibleFreeByOrt = useMemo(() => {
    if (!hasSearch) return freeByOrt;
    const result = [];
    for (const [ort, list] of freeByOrt) {
      const filtered = list.filter((vehicle) => vehicleMatchesSearch(vehicle, searchNeedle));
      if (filtered.length > 0) {
        result.push([ort, filtered]);
      }
    }
    return result;
  }, [freeByOrt, hasSearch, searchNeedle]);

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
      const s = await fetch("/api/activity/status", { cache: "no-store", credentials: "include" }).then(r => r.json());
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
  function totalsForColumn(boardLike, colId) {
    const cards = boardLike?.columns?.[colId]?.items || [];

    let areaCount = 0;
    let incidentCount = 0;
    let units = 0;
    let persons = 0;

    for (const card of cards) {
      if (card?.isArea) areaCount += 1;
      else incidentCount += 1;

      if (colId === "erledigt") {
        const everVehicles = Array.isArray(card?.everVehicles) ? card.everVehicles : [];
        units += everVehicles.filter((vid) => !isCloneId(vid)).length;
        persons += Number.isFinite(card?.everPersonnel) ? card.everPersonnel : 0;
      } else {
        const assignedVehicles = Array.isArray(card?.assignedVehicles) ? card.assignedVehicles : [];
        units += assignedVehicles.filter((vid) => !isCloneId(vid)).length;
        if (Number.isFinite(card?.manualPersonnel)) persons += card.manualPersonnel;
        else {
          for (const vid of assignedVehicles) {
            const vehicle = vehiclesById.get(vid);
            if (typeof vehicle?.mannschaft === "number") persons += vehicle.mannschaft;
          }
        }
      }
    }

    return {
      cards: cards.length,
      areas: areaCount,
      incidents: incidentCount,
      units,
      persons,
    };
  }
  const totalsNeu = totalsForColumn(visibleBoard, "neu");
  const totalsWip = totalsForColumn(visibleBoard, "in-bearbeitung");
  const totalsDone = totalsForColumn(visibleBoard, "erledigt");
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
      if (!r?.ok) {
        alert(r?.error || "Für diesen Einsatz sind keine Koordinaten hinterlegt.");
      }
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

  const confirmDoneTransition = () => window.confirm("Sind sie sicher?");

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
          if (to === "erledigt" && from !== "erledigt" && !confirmDoneTransition()) {
            return;
          }
          try {
            await transitionCard({ cardId, from, to, toIndex: 0 });
            if (to === "erledigt") {
              const [nextBoard, nextVehicles] = await Promise.all([
                fetchBoard(),
                fetchVehicles(),
              ]);
              setBoard(nextBoard);
              setVehicles(nextVehicles);
            } else {
              setBoard(await fetchBoard());
            }
          } catch { alert("Statuswechsel konnte nicht gespeichert werden."); }
        }
        return;
      }

      if (oid.startsWith("card:")) {
        const to = getCardCol(safeBoard, oid.slice(5));
        if (to) {
          if (to === "erledigt" && from !== "erledigt" && !confirmDoneTransition()) {
            return;
          }
          try {
            await transitionCard({ cardId, from, to, toIndex: 0 });
            if (to === "erledigt") {
              const [nextBoard, nextVehicles] = await Promise.all([
                fetchBoard(),
                fetchVehicles(),
              ]);
              setBoard(nextBoard);
              setVehicles(nextVehicles);
            } else {
              setBoard(await fetchBoard());
            }
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

const createIncident = async ({
    title,
    ort,
    typ,
    isArea = false,
    areaCardId = null,
    areaColor,
    coordinates = null,
    location = "",
  }) => {
    const finalAreaId = isArea ? null : (areaCardId ? String(areaCardId) : null);
    const payload = {
      isArea: !!isArea,
      areaCardId: finalAreaId,
    };
    if (isArea) {
      payload.areaColor = areaColor || DEFAULT_AREA_COLOR;
    }
    if (coordinates && Number.isFinite(coordinates?.lat) && Number.isFinite(coordinates?.lng)) {
      payload.lat = Number(coordinates.lat);
      payload.lng = Number(coordinates.lng);
    }
    const locationLabel = typeof location === "string" ? location.trim() : "";
    if (locationLabel) {
      payload.location = locationLabel;
    }
    const r = await createCard(title, "neu", 0, ort, typ, payload);
        suppressSoundUntilRef.current = Date.now()// + 15000;
   if (r?.card?.id != null) suppressPulseIdsRef.current.add(String(r.card.id));
    setBoard((prev) => {
      if (!prev) return prev;
      const b = structuredClone(prev);
      b.columns["neu"].items.unshift(r.card);
      return b;
    });
  };

const handleAreaChange = async (card, rawAreaId) => {
    if (!card?.id) return;
    const nextAreaId = rawAreaId ? String(rawAreaId) : null;
    try {
      const res = await updateCard(card.id, { areaCardId: nextAreaId });
      syncBoardAndInfo(res?.card, res?.board);
    } catch (err) {
      alert(err?.message || "Abschnitt konnte nicht geändert werden.");
    }
  };

  const handleSaveIncident = async (cardId, payload) => {
    try {
      const res = await updateCard(cardId, payload);
      syncBoardAndInfo(res?.card, res?.board);
      return res;
    } catch (err) {
      throw err;
    }
  };




// Edit: #/protokoll/edit/:nr
if (route.startsWith("/protokoll/edit/")) {
  const nrStr = route.split("/")[3];
  const editNr = Number(nrStr);
  return (
    <div className="h-screen w-screen bg-gray-100 flex flex-col">
      <CornerHelpLogout
        helpHref="/Hilfe_Meldestelle.pdf"
        helpTitle="Hilfe – Meldestelle/Protokoll"
      />
      <header className="flex items-center justify-between p-3 border-b bg-white shadow">
        <h1 className="text-xl font-bold">Meldung – Bearbeiten</h1>
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
      <CornerHelpLogout
        helpHref="/Hilfe_Meldestelle.pdf"
        helpTitle="Hilfe – Meldestelle/Protokoll"
      />
      <header className="flex items-center justify-between p-3 border-b bg-white shadow">
        <h1 className="text-xl font-bold">Meldung – Eintrag anlegen</h1>
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
      <CornerHelpLogout
        helpHref="/Hilfe_Meldestelle.pdf"
        helpTitle="Hilfe – Meldestelle/Protokoll"
      />
      <header className="flex items-center justify-between p-3 border-b bg-white shadow">
        <h1 className="text-xl font-bold">Meldestelle</h1>
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
      <CornerHelpLogout helpHref="/Hilfe.pdf">
        {canEdit && (
          <button
            type="button"
            className="pointer-events-auto floating-action fab"
            title="Einsatz anlegen"
            aria-label="Einsatz anlegen"
            onClick={() => setShowAddModal(true)}
          >
            <span aria-hidden="true">＋</span>
          </button>
        )}
      </CornerHelpLogout>
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
  Meldestelle
</button>
<button
  type="button"
  onClick={() => { window.location.href = "/aufgaben"; }}
  className="px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white"
  title="Zum Aufgaben-Board"
>
  Aufgaben
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

      {/* Filter */}
      <section className="mb-2 flex flex-wrap items-center gap-2">
        <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700" htmlFor="areaFilter">
          <span className="whitespace-nowrap">Filter Abschnitt</span>
          <select
            id="areaFilter"
            className={`border rounded px-2 py-1 shrink-0 min-w-[150px] transition-colors ${
              areaFilter
                ? `bg-red-800 border-red-900 text-white ${filterPulseActive ? "filter-pulse" : ""}`
                : "bg-white border-gray-300 text-gray-900"
            }`}
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
          >
            <option value="">Alles Anzeigen</option>
            {areaOptions.map((opt) => (
              <option key={opt.id} value={String(opt.id)}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[240px]">
          <label
            className="flex items-center gap-2 text-sm text-gray-700 flex-1 min-w-[240px] sm:flex-none sm:w-auto"
            htmlFor="boardSearch"
          >
            <span className="whitespace-nowrap">Suche</span>
            <input
              id="boardSearch"
              type="search"
              className="border rounded px-3 py-2 w-full sm:w-56 md:w-64 lg:w-72 max-w-full"
              placeholder="Suche…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </label>
          <div className="flex-1 min-w-[200px] min-h-[2.5rem] max-w-full sm:min-w-[260px]">
            {tickerText ? (
              <div className="ticker-container w-full h-full flex items-center" aria-live="polite">
                <marquee
                  className="ticker-content"
                  key={tickerText}
                  behavior="scroll"
                  direction="left"
                  scrollAmount={6}
                  onMouseEnter={(event) => {
                    if (typeof event.target.stop === "function") {
                      event.target.stop();
                    }
                  }}
                  onMouseLeave={(event) => {
                    if (typeof event.target.start === "function") {
                      event.target.start();
                    }
                  }}
                >
                  <span>{tickerText}</span>
                </marquee>
              </div>
            ) : (
              <div className="h-full" aria-hidden="true" />
            )}
          </div>
        </div>
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
              {canManageFreeUnits && (
              <button onClick={() => setShowVehModal(true)} className="px-2 py-1 text-sm rounded bg-emerald-600 text-white">
                + Einheit
              </button>
            )}
            </div>

            <div className="overflow-auto pr-1 flex-1 min-h-0 space-y-3">
              {visibleFreeByOrt.length === 0 && (
                <div className="text-[0.85rem] text-gray-500 italic">
                  {hasSearch ? "Keine Einheiten gefunden." : "— alle Einheiten sind zugewiesen —"}
                </div>
              )}
              {visibleFreeByOrt.map(([ort, list]) => {
                const collapsed = isCollapsed(ort);
                const groupAvailable = groupAvailability.has(ort)
                  ? groupAvailability.get(ort)
                  : true;
                const isAlerted = groupAlerted.get(ort) === true;
                const hasAssigned = assignedGroups.has(ort);
                const groupVisual = getGroupVisualClasses({
                  available: groupAvailable,
                  alerted: isAlerted,
                  assigned: hasAssigned,
                });
                return (
                  <div
                    key={ort}
                    className={`border rounded-md ${groupVisual.container}`}
                  >
                    <div className="flex items-center justify-between px-2 py-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCollapsed(ort, !collapsed)}
                        className="flex-1 flex items-center justify-between gap-2 text-left"
                        title={collapsed ? "aufklappen" : "zuklappen"}
                      >
                        <span
                          className={`text-xs font-semibold ${groupVisual.label}`}
                        >
                          {ort}
                        </span>
                      </button>
                      <div className="flex items-center gap-2">
                        <label
                          className="flex items-center gap-1 text-[11px] text-gray-600"
                          title={groupAvailable ? "Gruppe verfügbar" : "Gruppe deaktiviert"}
                        >
                          <span className="sr-only">Gruppe verfügbar</span>
                          <input
                            type="checkbox"
                            checked={groupAvailable}
                            onChange={(e) => handleGroupAvailabilityChange(ort, e.target.checked)}
                            disabled={!canManageFreeUnits}
                          />
                        </label>
                        <span className="group-chip">{list.length}</span>
                      </div>
                    </div>

                    {!collapsed && (
                      <div className="px-2 pb-2 grid grid-cols-1 gap-1.5">
                        {list.map((v) => {
                          const rawVehicleAvailable = v?.available !== false;
                          const effectiveGroupAvailable = groupAvailability.has(v?.ort || "")
                            ? groupAvailability.get(v?.ort || "")
                            : v?.groupAvailable !== false;
                          const effectiveVehicleAvailable = rawVehicleAvailable && effectiveGroupAvailable;
                          const vehicleForRender =
                            effectiveGroupAvailable === (v?.groupAvailable !== false)
                            && effectiveVehicleAvailable === rawVehicleAvailable
                              ? v
                              : {
                                  ...v,
                                  available: effectiveVehicleAvailable,
                                  groupAvailable: effectiveGroupAvailable,
                                };
                          return (
                            <div key={v.id} className="flex items-center gap-2 justify-between">
                              <DraggableVehicle
                                editable={canEdit && effectiveVehicleAvailable}
                                vehicle={vehicleForRender}
                                pillWidthPx={160}
                                near={nearBySet.has(String(v.id)) && Date.now() < pulseUntilMs}
                                distKm={nearbyDistById.get(String(v.id))}
                              />
                              <label
                                className="flex items-center gap-1 text-[11px] text-gray-600 shrink-0"
                                title={effectiveVehicleAvailable ? "Einheit verfügbar" : "Einheit deaktiviert"}
                              >
                                <span className="sr-only">Einheit verfügbar</span>
                                <input
                                  type="checkbox"
                                  checked={effectiveVehicleAvailable}
                                  onChange={(e) => handleVehicleAvailabilityChange(v, e.target.checked)}
                                  disabled={!canManageFreeUnits || !effectiveGroupAvailable}
                                />
                              </label>
                            </div>
                          );
                        })}
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
].map(({ id, title, bg, totals }) => {
            const displayTitle = areaFilterLabel ? `${title}: ${areaFilterLabel}` : title;
            return (
              <div key={id} className={overColId === id ? "drag-over" : ""}>
              <DroppableColumn editable={canEdit}
                colId={id}
                bg={bg}
                title={
                  /* (1) Sticky Header + KPI-Badges */
                  <span className="column-header flex items-center justify-between">
                     <span className="font-semibold">{displayTitle}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="kpi-badge" data-variant="incidents">⬛ {totals.incidents}</span>
                      <span className="kpi-badge" data-variant="areas">🗺️ {totals.areas}</span>
                      <span className="kpi-badge" data-variant="units">🚒 {totals.units}</span>
                      <span className="kpi-badge" data-variant="persons">👥 {totals.persons}</span>
                    </span>
                  </span>
                }
              >
 <ul
                  className="space-y-2 overflow-y-auto overflow-x-hidden pl-1 pr-2 py-2"
                  style={{ maxHeight: "calc(100vh - 260px)" }}
                >
                  <SortableContext
                    items={(visibleBoard.columns[id].items || []).map((c) => CID(c.id))}
                    strategy={verticalListSortingStrategy}
                  >
                    {(visibleBoard.columns[id].items || []).map((c) => (
                      <SortableCard editable={canEdit}
                        key={c.id}
                        card={c}
                        colId={id}
                        vehiclesById={vehiclesById}
						areaOptions={areaOptions}
                        areaLabelById={areaLabelById}
						areaColorById={areaColorById}
                        onAreaChange={canEdit ? handleAreaChange : undefined}
                        onEditCard={canEdit ? (card) => { setInfoCard(card); setInfoForceEdit(true); setInfoOpen(true); } : undefined}
                        distById={nearbyDistById}
                        pillWidthPx={160}
						pulse={newlyImportedIds.has(String(c.id)) && Date.now() < pulseUntilMs}
                        onUnassign={async (cardId, vehicleId) => {
                          await unassignVehicle(cardId, vehicleId);
                          try { await resetVehiclePosition(vehicleId); } catch {}
                          const [nextBoard, nextVehicles] = await Promise.all([
                            fetchBoard(),
                            fetchVehicles(),
                          ]);
                          setBoard(nextBoard);
                          setVehicles(nextVehicles);
                        }}
                        onOpenMap={(_) => setMapCtx({
                          address: c.ort, card: c, board: safeBoard, vehiclesById: vehiclesByIdObj,
                        })}
                        onAdvance={canEdit ? async (card) => {
                        if (id === "neu") {
                          await transitionCard({ cardId: card.id, from: "neu", to: "in-bearbeitung", toIndex: 0 });
                          setBoard(await fetchBoard());
                        } else if (id === "in-bearbeitung") {
                          if (!confirmDoneTransition()) {
                            return;
                          }
                          await transitionCard({ cardId: card.id, from: "in-bearbeitung", to: "erledigt", toIndex: 0 });
                          const [nextBoard, nextVehicles] = await Promise.all([
                            fetchBoard(),
                            fetchVehicles(),
                          ]);
                          setBoard(nextBoard);
                          setVehicles(nextVehicles);
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
            );
          })}
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

      {showVehModal && (
        <NewVehicleModal
          onClose={() => setShowVehModal(false)}
          onCreate={async (payload) => {
            const res = await fetch("/api/vehicles", {
              method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload),
            });
            if (!res.ok) {
              const txt = await res.text().catch(() => String(res.status));
              throw new Error(`HTTP ${res.status} ${txt}`);
            }
            setVehicles(await fetchVehicles());
          }}
        />
      )}

      {showAddModal && (
        <AddIncidentModal
          onClose={() => setShowAddModal(false)}
          onCreate={createIncident}
          types={types}
          areaOptions={areaOptions}
        />
      )}

      {mapCtx && <MapModal context={mapCtx} onClose={() => setMapCtx(null)} />}
      <IncidentInfoModal
        open={infoOpen}
        info={infoCard || {}}
        onClose={() => { setInfoOpen(false); setInfoCard(null); setInfoForceEdit(false); }}
        canEdit={canEdit}
        onSave={handleSaveIncident}
        areaOptions={areaOptions}
        areaLabelById={areaLabelById}
        forceEdit={infoForceEdit}
        types={types}
      />
    </div>
  );
}
