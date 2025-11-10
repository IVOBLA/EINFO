import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import AufgDroppableColumn from "../components/AufgDroppableColumn.jsx";
import AufgAddModal from "../components/AufgAddModal.jsx";
import AufgInfoModal from "../components/AufgInfoModal.jsx";
import AufgSortableCard from "../components/AufgSortableCard.jsx";
import { initRolePolicy, canEditApp, getAllRoles, hasRole } from "../auth/roleUtils.js";
import { playGong } from "../sound"; // gleicher Sound wie im Einsatz-Kanban
import { fetchBoard } from "../api.js";
import { forbiddenError, notifyForbidden } from "../../forbidden.js";
import { ensureValidDueOffset, getFallbackDueOffsetMinutes } from "../utils/defaultDueOffset.js";
import CornerHelpLogout from "../components/CornerHelpLogout.jsx";
import useOnlineRoles from "../hooks/useOnlineRoles.js";

const STATUS = { NEW: "Neu", IN_PROGRESS: "In Bearbeitung", DONE: "Erledigt" };
const COLS = [STATUS.NEW, STATUS.IN_PROGRESS, STATUS.DONE];
const INCIDENT_STATUS_KEYS = ["neu", "in-bearbeitung", "erledigt"];
const FALLBACK_DUE_OFFSET_MINUTES = getFallbackDueOffsetMinutes();
const PRIMARY_ROLE_SWITCH_IDS = ["LTSTB", "LTSTBSTV"];
const FALLBACK_SWITCH_ROLE_ID = "S3";
const PROTOCOL_PREFILL_STORAGE_KEY = "prot_prefill_from_task";
const PROTOCOL_PREFILL_SOURCE = "task-card";

const normalizeDefaultDueOffset = (value) => ensureValidDueOffset(value);

const normalizeProtocolId = (value) => {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) {
    const normalized = String(Number(raw));
    return normalized === "0" ? "0" : normalized;
  }
  return raw;
};

const normalizeProtocolIds = (values) => {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = normalizeProtocolId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const sanitizeProtocolEntry = (entry) => {
  if (!entry) return null;
  const nr = normalizeProtocolId(entry.nr ?? entry.id ?? entry.value);
  if (!nr) return null;
  const detail = { nr };
  const assign = (key, sourceKey) => {
    const val = entry[key] ?? (sourceKey ? entry[sourceKey] : undefined);
    if (val == null) return;
    const text = String(val).trim();
    if (text) detail[key] = text;
  };
  assign("title");
  assign("information");
  assign("infoTyp");
  assign("datum");
  assign("zeit");
  assign("anvon");
  return detail;
};

const sanitizeProtocolEntries = (entries) => {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const detail = sanitizeProtocolEntry(entry);
    if (!detail || seen.has(detail.nr)) continue;
    seen.add(detail.nr);
    out.push(detail);
  }
  return out;
};

const createEmptyIncidentIndex = () => ({ options: [], map: new Map() });

function buildIncidentIndex(board) {
  const options = [];
  const map = new Map();
  if (board?.columns && typeof board.columns === "object") {
    const handled = new Set();
    const orderedKeys = [
      ...INCIDENT_STATUS_KEYS,
      ...Object.keys(board.columns).filter((key) => !INCIDENT_STATUS_KEYS.includes(key)),
    ];
    for (const key of orderedKeys) {
      if (!board.columns[key] || handled.has(key)) continue;
      handled.add(key);
      const col = board.columns[key];
      const statusName = col?.name || key;
      const items = Array.isArray(col?.items) ? col.items : [];
      for (const card of items) {
        const id = String(card?.id ?? "").trim();
        if (!id) continue;
        const labelParts = [];
        if (card?.content) labelParts.push(String(card.content));
        if (card?.ort) labelParts.push(String(card.ort));
        const label = labelParts.length ? labelParts.join(" — ") : `#${id}`;
        const info = {
          id,
          label,
          statusKey: key,
          statusName,
          content: card?.content ?? "",
          ort: card?.ort ?? "",
        };
        map.set(id, info);
        options.push(info);
      }
    }
  }
  return { options, map };
}


const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const buildProtocolDescription = (item) => {
  if (!item) return "";
  const parts = [];
  const title = String(item.title ?? "").trim();
  const desc = String(item.desc ?? "").trim();
  const responsible = String(item.responsible ?? "").trim();
  if (title) parts.push(title);
  if (desc) parts.push(desc);
  if (responsible) parts.push(`Verantwortlich: ${responsible}`);
  return parts.join("\n\n").trim();
};

function getCurrentUser() {
  try {
    const w = typeof window !== "undefined" ? window : {};
    const ls = w.localStorage;
    const cands = [
      () => w.__APP_AUTH__?.user,
      () => w.__USER__,
      () => (ls && JSON.parse(ls.getItem("auth.user") || "null")) || null,
      () => (ls && JSON.parse(ls.getItem("user") || "null")) || null,
    ];
    for (const f of cands) { const u = f?.(); if (u) return u; }
  } catch {}
  return null;
}

function getPrimaryRoleId(user) {
  if (!user) return null;
  if (typeof user.role === "string") return user.role.trim().toUpperCase();
  if (user.role && typeof user.role.id === "string") return user.role.id.trim().toUpperCase();
  if (Array.isArray(user.roles) && user.roles.length) {
    const r = user.roles[0];
    if (typeof r === "string") return r.trim().toUpperCase();
    if (r && typeof r.id === "string") return r.id.trim().toUpperCase();
  }
  return null;
}

const uuid = () => (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const roleQuery = (roleId) => (roleId ? `?role=${encodeURIComponent(roleId)}` : "");
const roleHeaders = (roleId) => (roleId ? { "X-Role-Id": roleId } : {});

function nextStatus(s) {
  if (s === STATUS.NEW) return STATUS.IN_PROGRESS;
  if (s === STATUS.IN_PROGRESS) return STATUS.DONE;
  return STATUS.DONE;
}

export default function AufgApp() {
  const [items, setItems] = useState([]);
  const [incidentIndex, setIncidentIndex] = useState(() => createEmptyIncidentIndex());
  const [protocolOptions, setProtocolOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [filterEinsatz, setFilterEinsatz] = useState("");
  const [addOpen, setAddOpen] = useState(false);  // Popup initial auf false setzen
  const [activeItem, setActiveItem] = useState(null);
  const [allowEdit, setAllowEdit] = useState(false);
  const [aufgabenConfig, setAufgabenConfig] = useState(() => ({
    defaultDueOffsetMinutes: FALLBACK_DUE_OFFSET_MINUTES,
  }));


  const user = getCurrentUser();
  const primaryRoleId = useMemo(() => getPrimaryRoleId(user), [user]);
  const [roleId, setRoleId] = useState(() => primaryRoleId || "");
  const roleSelectionManualRef = useRef(false);
  const prevPrimaryRoleRef = useRef(primaryRoleId);
  const [roleOptions, setRoleOptions] = useState([]);
  const { roles: onlineRoles } = useOnlineRoles();
  const ltStbOnline = useMemo(
    () => onlineRoles.some((roleId) => roleId === "LTSTB" || roleId === "LTSTBSTV"),
    [onlineRoles]
  );
  const canSwitchRoles = useMemo(() => {
    if (PRIMARY_ROLE_SWITCH_IDS.some((id) => hasRole(id, user))) return true;
    if (!ltStbOnline && hasRole(FALLBACK_SWITCH_ROLE_ID, user)) return true;
    return false;
  }, [user, ltStbOnline]);
  const roleSelectOptions = useMemo(() => {
    if (!roleId) return roleOptions;
    const exists = roleOptions.some((opt) => opt.id === roleId);
    return exists ? roleOptions : [...roleOptions, { id: roleId, label: roleId }];
  }, [roleId, roleOptions]);
  const [freshIds, setFreshIds] = useState(new Set());
  const prevIdsRef = useRef(new Set());
  const myCreatedIdsRef = useRef(new Set());

  const mapTaskItem = useCallback((src) => {
    if (!src) return null;
    const statusInput = src.status;
    const status = [STATUS.NEW, STATUS.IN_PROGRESS, STATUS.DONE].includes(statusInput)
      ? statusInput
      : (() => {
          const str = typeof statusInput === "string" ? statusInput.toLowerCase() : "";
          if (str.startsWith("in")) return STATUS.IN_PROGRESS;
          if (str.startsWith("erled")) return STATUS.DONE;
          return STATUS.NEW;
        })();
    const linkedProtocols = sanitizeProtocolEntries(src.linkedProtocols ?? src.meta?.linkedProtocols ?? []);
    const linkedProtocolNrs = normalizeProtocolIds(
      src.linkedProtocolNrs ?? src.meta?.linkedProtocolNrs ?? linkedProtocols.map((entry) => entry.nr)
    );
    const incidentId = src.relatedIncidentId != null && src.relatedIncidentId !== ""
      ? String(src.relatedIncidentId)
      : null;
    return {
      id: src.id ?? src._id ?? src.key ?? uuid(),
      clientId: src.clientId ?? null,
      title: src.title ?? src.name ?? "Aufgabe",
      type: src.type ?? src.category ?? "",
      status,
      responsible: src.responsible ?? src.verantwortlich ?? "",
      desc: src.desc ?? src.beschreibung ?? "",
      dueAt: src.dueAt ?? src.due_at ?? src.deadline ?? src.frist ?? null,
      createdAt: src.createdAt ?? null,
      updatedAt: src.updatedAt ?? null,
      meta: src.meta ?? {},
      originProtocolNr: src.originProtocolNr ?? null,
      relatedIncidentId: incidentId,
      incidentTitle: src.incidentTitle ?? null,
      linkedProtocolNrs,
      linkedProtocols,
    };
  }, []);

  const loadIncidents = useCallback(async (signal = null) => {
    if (signal?.aborted) return;
    try {
      const data = await fetchBoard();
      if (signal?.aborted) return;
      setIncidentIndex(buildIncidentIndex(data));
    } catch (_e) {
      if (signal?.aborted) return;
      // Bei Fehler Index beibehalten – Board ist optional für Aufgabenverwaltung
    }
  }, []);

  const loadProtocols = useCallback(async (signal = null) => {
    if (!roleId) {
      setProtocolOptions([]);
      return;
    }
    try {
      const res = await fetch(`/api/aufgaben/protocols${roleQuery(roleId)}`, {
        cache: "no-store",
        headers: { ...roleHeaders(roleId) },
        signal,
      });
      if (!res.ok) {
        if (res.status === 403) {
          notifyForbidden();
          setProtocolOptions([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (signal?.aborted) return;
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const seen = new Set();
      const normalized = [];
      for (const entry of rawItems) {
        const detail = sanitizeProtocolEntry(entry) || {};
        const nr = detail.nr || normalizeProtocolId(entry?.nr ?? entry?.id ?? entry?.value);
        if (!nr || seen.has(nr)) continue;
        seen.add(nr);
        normalized.push({
          nr,
          title: detail.title ?? entry?.title ?? null,
          infoTyp: detail.infoTyp ?? entry?.infoTyp ?? null,
          datum: detail.datum ?? entry?.datum ?? null,
          zeit: detail.zeit ?? entry?.zeit ?? null,
          anvon: detail.anvon ?? entry?.anvon ?? null,
          information: detail.information ?? entry?.information ?? null,
        });
      }
      normalized.sort((a, b) => {
        const aNum = Number(a.nr);
        const bNum = Number(b.nr);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
        return String(b.nr).localeCompare(String(a.nr), "de", { numeric: true });
      });
      setProtocolOptions(normalized);
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") return;
      setProtocolOptions([]);
    }
  }, [roleId]);

  // Rollen-Policy einmal laden und Edit-Flag setzen
  useEffect(() => {
    let alive = true;
    (async () => {
      await initRolePolicy();
      if (!alive) return;
      setAllowEdit(canEditApp("aufgabenboard", user));
      const opts = getAllRoles();
      const sorted = [...opts].sort((a, b) =>
        String(a?.label || a?.id || "").localeCompare(String(b?.label || b?.id || ""), "de", {
          sensitivity: "base",
        })
      );
      setRoleOptions(sorted);
    })();
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    if (prevPrimaryRoleRef.current !== primaryRoleId) {
      prevPrimaryRoleRef.current = primaryRoleId;
      roleSelectionManualRef.current = false;
    }
    if (!roleSelectionManualRef.current) {
      setRoleId(primaryRoleId || "");
    }
  }, [primaryRoleId]);

  useEffect(() => {
    if (!roleId && roleOptions.length) {
      setRoleId(roleOptions[0].id);
    }
  }, [roleId, roleOptions]);

  const handleRoleChange = useCallback((event) => {
    if (!canSwitchRoles) {
      event?.preventDefault?.();
      return;
    }
    const value = String(event.target.value || "").trim().toUpperCase();
    roleSelectionManualRef.current = true;
    setRoleId(value);
  }, [canSwitchRoles]);

  useEffect(() => {
    if (!roleId) return undefined;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/aufgaben/config${roleQuery(roleId)}`, {
          cache: "no-store",
          headers: roleHeaders(roleId),
        });
        if (!res.ok) {
          if (res.status === 403) throw forbiddenError();
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!active) return;
        setAufgabenConfig({
          defaultDueOffsetMinutes: normalizeDefaultDueOffset(data?.defaultDueOffsetMinutes),
        });
      } catch {
        if (!active) return;
        setAufgabenConfig((prev) => ({
          defaultDueOffsetMinutes: normalizeDefaultDueOffset(prev?.defaultDueOffsetMinutes),
        }));
      }
    })();
    return () => {
      active = false;
    };
  }, [roleId]);



 useEffect(() => {
    const controller = new AbortController();
    void loadIncidents(controller.signal);
    const timer = setInterval(() => { void loadIncidents(controller.signal); }, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadIncidents]);

  useEffect(() => {
    if (!roleId) {
      setProtocolOptions([]);
      return;
    }
    const controller = new AbortController();
    void loadProtocols(controller.signal);
    return () => controller.abort();
  }, [roleId, loadProtocols]);

  useEffect(() => {
    if (!activeItem) return;
    const controller = new AbortController();
    void loadProtocols(controller.signal);
    return () => controller.abort();
  }, [activeItem?.id, loadProtocols]);

  // DnD
  const [draggingItem, setDraggingItem] = useState(null);
  const [overColId, setOverColId] = useState(null);
  const originColRef = useRef(null);
  const lastOverRef = useRef(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } })
  );

  // ---- Laden (rollen-spezifisch)
  const initialLoadRef = useRef(true);

  async function load() {
    if (!roleId) { setError("Keine Rolle gefunden – bitte anmelden."); setItems([]); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/aufgaben${roleQuery(roleId)}`, { cache: "no-store", headers: roleHeaders(roleId) });
      if (!res.ok) {
        if (res.status === 403) throw forbiddenError();
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const arr = Array.isArray(data?.items) ? data.items : [];
      const mapped = arr
        .map((x) => mapTaskItem(x))
        .filter((item) => item);
      setItems(mapped);

      try {
        const ids = new Set(mapped.map((x) => String(x.id)));
        const prev = prevIdsRef.current;
        const added = [...ids].filter((id) => !prev.has(id));
        const toPulse = initialLoadRef.current
          ? []
          : added.filter((id) => !myCreatedIdsRef.current.has(id));

        if (toPulse.length) {
          setFreshIds(new Set(toPulse));
          try { await playGong(); } catch {}
          setTimeout(() => setFreshIds(new Set()), 9000);
        }

        prevIdsRef.current = ids;
        initialLoadRef.current = false;
      } catch {}
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    prevIdsRef.current = new Set();
    initialLoadRef.current = true;
    setFreshIds(new Set());
    void load();
  }, [roleId]);
  
   // Auto-Reload alle 30s (nur wenn eine Rolle vorhanden ist)
 useEffect(() => {
   if (!roleId) return;
   const t = setInterval(() => {
     if (!loading) void load();
   }, 30_000);
   return () => clearInterval(t);
 }, [roleId, loading]);

  const updateItemOnServer = useCallback(async (patch) => {
    const res = await fetch(`/api/aufgaben/${encodeURIComponent(patch.id)}/edit${roleQuery(roleId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...roleHeaders(roleId) },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      if (res.status === 403) throw forbiddenError();
      throw new Error(`HTTP ${res.status}`);
    }
    const j = await res.json();
    if (j?.item) return mapTaskItem(j.item);
    return null;
  }, [roleId, mapTaskItem]);

  const saveItemDetails = useCallback(async (patch) => {
    try {
      const updated = await updateItemOnServer(patch);
      let normalizedResult = updated;
      setItems((prev) => {
        const existing = prev.find((x) => x.id === patch.id);
        const nextItem = normalizedResult || mapTaskItem({ ...(existing || {}), ...patch });
        if (!nextItem) return prev;
        normalizedResult = nextItem;
        return prev.map((x) => (x.id === nextItem.id ? nextItem : x));
      });
      setActiveItem((prev) => {
        if (!prev || prev.id !== patch.id) return prev;
        return normalizedResult || prev;
      });
    } catch (e) {
      setError(String(e?.message || e));
      throw e;
    }
  }, [updateItemOnServer, mapTaskItem]);

  // ---- Persist-Helper: Reorder (DnD) & Status (Pfeil)
  async function persistReorder({ id, toStatus, beforeId }) {
    try {
      const r = await fetch(`/api/aufgaben/reorder${roleQuery(roleId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...roleHeaders(roleId) },
        body: JSON.stringify({ id, toStatus, beforeId, role: roleId }),
      });
      if (r.status === 403) { notifyForbidden(); return false; }
      return r.ok;
    } catch { return false; }
  }
  async function persistStatus({ id, toStatus }) {
    try {
      const r = await fetch(`/api/aufgaben/${encodeURIComponent(id)}/status${roleQuery(roleId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...roleHeaders(roleId) },
        body: JSON.stringify({ toStatus, role: roleId }),
      });
      if (r.status === 403) { notifyForbidden(); return false; }
      return r.ok;
    } catch { return false; }
  }

  // ---- EINZIGER Create-POST (Modal postet nicht selbst)
  async function createItemOnServer(payload) {
    const clientId = uuid();
    const incidentIdRaw = payload?.relatedIncidentId != null ? String(payload.relatedIncidentId).trim() : "";
    const incidentId = incidentIdRaw || null;
    const incidentInfo = incidentId ? incidentIndex.map.get?.(String(incidentId)) : null;
    const incidentTitle = (() => {
      const fromPayload = payload?.incidentTitle != null ? String(payload.incidentTitle).trim() : "";
      if (fromPayload) return fromPayload;
      if (incidentInfo?.label) return incidentInfo.label;
      return null;
    })();
    const body = {
      title: payload?.title ?? "Aufgabe",
      type: payload?.type ?? "",
      responsible: payload?.responsible ?? "",
      desc: payload?.desc ?? "",
      dueAt: payload?.dueAt ?? null,
      relatedIncidentId: incidentId,
      incidentTitle,
      status: STATUS.NEW,
      role: roleId,
      clientId,
    };
    const res = await fetch(`/api/aufgaben${roleQuery(roleId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...roleHeaders(roleId) },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 403) throw forbiddenError();
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const rawItem = json?.item || body;
    const normalized = mapTaskItem(rawItem);
    if (normalized?.id) myCreatedIdsRef.current.add(String(normalized.id));
    return normalized;
  }

  // ---- Filter + Spalten (wie _old)
  const protocolLookup = useMemo(() => {
    const map = new Map();
    for (const entry of protocolOptions) {
      const nr = normalizeProtocolId(entry?.nr ?? entry?.id ?? entry?.value);
      if (!nr) continue;
      map.set(nr, { ...entry, nr });
    }
    return map;
  }, [protocolOptions]);

  const filtered = useMemo(() => {
    const q = norm(filter);
    const incidentFilter = filterEinsatz ? String(filterEinsatz) : "";
    return items.filter((x) => {
      if (incidentFilter && String(x?.relatedIncidentId ?? "") !== incidentFilter) return false;
      if (!q) return true;
      const haystack = [x.title, x.type, x.responsible, x.desc, x.incidentTitle]
        .filter(Boolean)
        .map((s) => norm(s));
      return haystack.some((s) => s.includes(q));
    });
  }, [items, filter, filterEinsatz]);

  const lists = useMemo(() => ({
    [STATUS.NEW]:         filtered.filter(x => (x.status || STATUS.NEW) === STATUS.NEW),
    [STATUS.IN_PROGRESS]: filtered.filter(x => x.status === STATUS.IN_PROGRESS),
    [STATUS.DONE]:        filtered.filter(x => x.status === STATUS.DONE),
  }), [filtered]);

  const incidentFilterOptions = useMemo(() => {
    const base = (incidentIndex.options || []).map((opt) => ({
      id: String(opt.id),
      label: opt.label || `#${opt.id}`,
      statusName: opt.statusName || opt.statusLabel || "",
    }));
    const seen = new Set(base.map((opt) => opt.id));
    const extras = [];
    for (const it of items) {
      const id = it?.relatedIncidentId ? String(it.relatedIncidentId) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      extras.push({
        id,
        label: it.incidentTitle || `#${id}`,
        statusName: "",
      });
    }
    return [...base, ...extras].sort((a, b) =>
      a.label.localeCompare(b.label, "de", { sensitivity: "base" })
    );
  }, [incidentIndex.options, items]);

  useEffect(() => {
    if (!activeItem) return;
    const updated = items.find((x) => x.id === activeItem.id);
    if (updated && updated !== activeItem) {
      setActiveItem(updated);
    }
  }, [items, activeItem]);

  const listIds = useMemo(() => ({
    [STATUS.NEW]:         lists[STATUS.NEW].map(x => x.id),
    [STATUS.IN_PROGRESS]: lists[STATUS.IN_PROGRESS].map(x => x.id),
    [STATUS.DONE]:        lists[STATUS.DONE].map(x => x.id),
  }), [lists]);

  const getColByItemId = useCallback((id) => {
    if (!id) return null;
    if (listIds[STATUS.NEW].includes(id)) return STATUS.NEW;
    if (listIds[STATUS.IN_PROGRESS].includes(id)) return STATUS.IN_PROGRESS;
    if (listIds[STATUS.DONE].includes(id)) return STATUS.DONE;
    return null;
  }, [listIds]);

  const confirmDoneTransition = useCallback(() => window.confirm("Sind sie sicher?"), []);

  const handleAddOpen = () => {
    if (!allowEdit) return;
    setAddOpen(true); // Öffnet das "Neu"-Modal
  };
  const handleModalClose = () => {
    setAddOpen(false); // Schließt das „Neu“-Modal
  };
  useEffect(() => {
    if (!allowEdit && addOpen) {
      setAddOpen(false);
    }
  }, [allowEdit, addOpen]);
  const handleShowInfo = useCallback((item) => {
    if (!item) return;
    const found = items.find((x) => x.id === item.id);
    setActiveItem(found || item);
  }, [items]);
  const handleCreateProtocol = useCallback((item) => {
    if (!item) return;
    const normalizedOriginNr = normalizeProtocolId(item?.originProtocolNr);
    const payload = {
      source: PROTOCOL_PREFILL_SOURCE,
      description: buildProtocolDescription(item),
      title: String(item?.title ?? "").trim() || null,
      taskId: item?.id ?? null,
      createdAt: item?.createdAt ?? null,
      originProtocolNr: normalizedOriginNr || null,
    };

    const openInNewTab = () => {
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const storageKey = `${PROTOCOL_PREFILL_STORAGE_KEY}:${token}`;
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {}
      const targetUrl = `/protokoll#/protokoll/neu?prefillToken=${encodeURIComponent(token)}`;
      const win = window.open(targetUrl, "_blank", "noopener,noreferrer");
      if (win) return true;
      try { localStorage.removeItem(storageKey); } catch {}
      return false;
    };

    if (!openInNewTab()) {
      try {
        sessionStorage.setItem(PROTOCOL_PREFILL_STORAGE_KEY, JSON.stringify(payload));
      } catch {}
      const basePath = typeof window?.location?.pathname === "string" ? window.location.pathname : "";
      if (basePath.startsWith("/protokoll")) {
        window.location.hash = "/protokoll/neu";
      } else {
        window.location.assign("/protokoll#/protokoll/neu");
      }
    }
  }, []);
  // ---- Pfeil „Weiter→“ → jetzt dedizierter Status-Endpunkt
  const advance = useCallback((item) => {
     if (!allowEdit) return;     // read-only blocken
        const to = nextStatus(item?.status || STATUS.NEW);
    if (to === item?.status) return;
    if (to === STATUS.DONE && item?.status !== STATUS.DONE && !confirmDoneTransition()) {
      return;
    }
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, status: to } : x));
    void persistStatus({ id: item.id, toStatus: to }); // <<— HIER die Änderung
   }, [allowEdit, confirmDoneTransition]);

  // ---- DnD (wie _old)
  const onDragStart = useCallback(({ active }) => {
	if (!allowEdit) return;
    const id = active?.id;
    originColRef.current = getColByItemId(id);
    setDraggingItem(items.find(x => x.id === id) || null);
  }, [items, getColByItemId, allowEdit]);

  const onDragOver = useCallback(({ over }) => {
    if (!over) { setOverColId(null); return; }
    lastOverRef.current = over.id;
    const oid = over.id;
    const toCol = COLS.includes(oid) ? oid : getColByItemId(oid);
    setOverColId(toCol || null);
  }, [getColByItemId]);

  const onDragEnd = useCallback(({ active, over }) => {
    if (!allowEdit) return;
        setDraggingItem(null); setOverColId(null);
    const dropId = over?.id ?? lastOverRef.current; if (!dropId) return;

    const activeId = active.id;
    const fromCol = originColRef.current || getColByItemId(activeId);
    let toCol = COLS.includes(dropId) ? dropId : getColByItemId(dropId) || fromCol;
    if (!fromCol || !toCol) return;

    if (fromCol !== toCol) {
      if (toCol === STATUS.DONE && fromCol !== STATUS.DONE && !confirmDoneTransition()) {
        originColRef.current = null; lastOverRef.current = null; return;
      }
      const beforeId = COLS.includes(dropId) ? null : dropId;
      setItems(prev => prev.map(x => x.id === activeId ? { ...x, status: toCol } : x));
      void persistReorder({ id: activeId, toStatus: toCol, beforeId });
      originColRef.current = null; lastOverRef.current = null; return;
    }

    const curList = lists[toCol];
    const oldIndex = curList.findIndex(x => x.id === activeId);
    let newIndex, beforeId = null;
    if (COLS.includes(dropId)) newIndex = curList.length - 1;
    else {
      const overIndex = curList.findIndex(x => x.id === dropId);
      newIndex = overIndex < 0 ? curList.length - 1 : overIndex;
      beforeId = curList[newIndex]?.id ?? null;
    }

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const reordered = arrayMove(curList, oldIndex, newIndex);
      setItems(prev => {
        const others = prev.filter(x => x.status !== toCol);
        return [...others, ...reordered];
      });
      void persistReorder({ id: activeId, toStatus: toCol, beforeId });
    }
    originColRef.current = null; lastOverRef.current = null;
  }, [getColByItemId, lists, allowEdit, confirmDoneTransition]);

  return (
    <div className="p-4">
      <CornerHelpLogout />
      <header className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 w-full">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold">Aufgaben</h1>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-600">Rolle:</span>
              <select
                value={roleId}
                onChange={handleRoleChange}
                className="px-2 py-1 rounded-full border bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
                disabled={!roleSelectOptions.length || !canSwitchRoles}
                aria-label="Rolle auswählen"
                title={
                  !canSwitchRoles
                    ? ltStbOnline
                      ? "Nur LtStb oder LtStbStv dürfen Rollen wechseln"
                      : "Nur LtStb oder LtStbStv dürfen Rollen wechseln – S3 nur, wenn LtStb abgemeldet"
                    : roleId
                      ? `Rolle ${roleId}`
                      : "Rolle auswählen"
                }
              >
                {roleSelectOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label || opt.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto md:ml-auto md:justify-end">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Suche Titel / Typ / Verantwortlich…"
              className="w-full sm:w-64 md:w-72 lg:w-80 max-w-full px-3 py-2 text-sm rounded-xl border"
            />
            <button
              onClick={handleAddOpen}
              className="text-sm px-3 py-2 rounded-xl bg-sky-600 text-white disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!allowEdit}
              title={allowEdit ? undefined : "Keine Berechtigung (Aufgabenboard)"}
            >
              Neu
            </button>
            {/* Modal zur Erstellung neuer Einträge */}
            {allowEdit && (
              <AufgAddModal
                open={addOpen} // Der Zustand `addOpen` steuert, ob das Modal sichtbar ist
                onClose={handleModalClose} // Schließt das Modal
                incidentOptions={incidentIndex.options}
                defaultDueOffsetMinutes={aufgabenConfig.defaultDueOffsetMinutes}
                onAdded={async (created) => {
                  try {
                    const saved = await createItemOnServer(created); // Speichert das neue Element
                    if (saved) setItems((prev) => [saved, ...prev]); // Fügt das neue Element zur Liste hinzu
                  } catch (e) {
                    setError(String(e?.message || e)); // Fehlerbehandlung
                  }
                }}
              />
            )}
            <button
              onClick={() => { void load(); void loadIncidents(); }}
              className="text-sm px-3 py-2 rounded-xl border"
              disabled={loading}
            >
              {loading ? "Lädt…" : "Neu laden"}
            </button>
          </div>
        </div>
      </header>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          <div className={overColId === STATUS.NEW ? "drag-over" : ""}>
            <AufgDroppableColumn
              id={STATUS.NEW}
              title="Neu"
              bg="bg-red-100"
              count={lists[STATUS.NEW].length}
              itemIds={lists[STATUS.NEW].map(x=>x.id)}
            >
              {lists[STATUS.NEW].map((it) => (
                <AufgSortableCard
                  key={it.id}
                  item={it}
                  onAdvance={advance}
                  onShowInfo={handleShowInfo}
                  isNew={freshIds.has(String(it.id))}
                  incidentLookup={incidentIndex.map}
                  onCreateProtocol={handleCreateProtocol}
                />
              ))}
            </AufgDroppableColumn>
          </div>

          <div className={overColId === STATUS.IN_PROGRESS ? "drag-over" : ""}>
            <AufgDroppableColumn
              id={STATUS.IN_PROGRESS}
              title="In Bearbeitung"
              bg="bg-yellow-100"
              count={lists[STATUS.IN_PROGRESS].length}
              itemIds={lists[STATUS.IN_PROGRESS].map(x=>x.id)}
            >
              {lists[STATUS.IN_PROGRESS].map((it) => (
                <AufgSortableCard
                  key={it.id}
                  item={it}
                  onAdvance={advance}
                  onShowInfo={handleShowInfo}
                  isNew={freshIds.has(String(it.id))}
                  incidentLookup={incidentIndex.map}
                  onCreateProtocol={handleCreateProtocol}
                />
              ))}
            </AufgDroppableColumn>
          </div>

          <div className={overColId === STATUS.DONE ? "drag-over" : ""}>
            <AufgDroppableColumn
              id={STATUS.DONE}
              title="Erledigt"
              bg="bg-green-100"
              count={lists[STATUS.DONE].length}
              itemIds={lists[STATUS.DONE].map(x=>x.id)}
            >
              {lists[STATUS.DONE].map((it) => (
                <AufgSortableCard
                  key={it.id}
                  item={it}
                  onAdvance={advance}
                  onShowInfo={handleShowInfo}
                  isNew={freshIds.has(String(it.id))}
                  incidentLookup={incidentIndex.map}
                  onCreateProtocol={handleCreateProtocol}
                />
              ))}
            </AufgDroppableColumn>
          </div>
</div>
        <DragOverlay>
          {draggingItem ? (
            <div className="rounded-lg bg-white shadow-xl border p-3 w-[280px]">
              <div className="text-[10px] text-gray-500 leading-4">
                erstellt: {draggingItem.createdAt ? new Date(draggingItem.createdAt).toLocaleString() : "–"}
              </div>
              <div className="font-semibold text-sm mb-1 truncate">{draggingItem.title}</div>
              <div className="text-xs text-gray-600">{draggingItem.type}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {activeItem ? (
        <AufgInfoModal
          open={!!activeItem}
          item={activeItem}
          onClose={() => setActiveItem(null)}
          onSave={saveItemDetails}
          canEdit={allowEdit}
          incidentOptions={incidentIndex.options}
          incidentLookup={incidentIndex.map}
          protocolOptions={protocolOptions}
          protocolLookup={protocolLookup}
          onCreateProtocol={handleCreateProtocol}
        />
      ) : null}
    </div>
  );
}