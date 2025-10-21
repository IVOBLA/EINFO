// client/src/pages/AufgApp.jsx
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
import { initRolePolicy, canEditApp } from "../auth/roleUtils.js";
import { playGong } from "../sound"; // gleicher Sound wie im Einsatz-Kanban

const STATUS = { NEW: "Neu", IN_PROGRESS: "In Bearbeitung", DONE: "Erledigt" };
const COLS = [STATUS.NEW, STATUS.IN_PROGRESS, STATUS.DONE];




// ---- Rolle aus vorhandenem Auth (keine UI-Änderung)
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
  const [boardIndex, setBoardIndex] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [filterEinsatz, setFilterEinsatz] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [allowEdit, setAllowEdit] = useState(false);

  const user = getCurrentUser();
  const roleId = useMemo(() => getPrimaryRoleId(user), [user]);
  const [freshIds, setFreshIds] = useState(new Set());
const prevIdsRef = useRef(new Set());
const myCreatedIdsRef = useRef(new Set());
  
    // Rollen-Policy einmal laden und Edit-Flag setzen
  useEffect(() => {
    let alive = true;
    (async () => {
      await initRolePolicy();
      if (!alive) return;
      setAllowEdit(canEditApp("aufgabenboard", user));
    })();
    return () => { alive = false; };
  }, [user]);
  

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
  async function load() {
    if (!roleId) { setError("Keine Rolle gefunden – bitte anmelden."); setItems([]); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/aufgaben${roleQuery(roleId)}`, { cache: "no-store", headers: roleHeaders(roleId) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const arr = Array.isArray(data?.items) ? data.items : [];
      const mapped = arr.map(x => ({
        id: x.id ?? x._id ?? x.key ?? uuid(),
        title: x.title ?? x.name ?? "",
        type: x.type ?? x.category ?? "",
        status: [STATUS.NEW, STATUS.IN_PROGRESS, STATUS.DONE].includes(x.status) ? x.status : STATUS.NEW,
        responsible: x.responsible ?? x.verantwortlich ?? "",
        desc: x.desc ?? x.beschreibung ?? "",
        createdAt: x.createdAt ?? null,
        updatedAt: x.updatedAt ?? null,
		meta: x.meta ?? {},
originProtocolNr: x.originProtocolNr ?? x.originNr ?? x.meta?.originProtocolNr ?? null,
originType:       x.originType       ?? x.meta?.source ?? null,
relatedIncidentId: x.relatedIncidentId ?? x.meta?.relatedIncidentId ?? null,
  
      }));
      setItems(mapped);
	  
	  try{
  const ids = new Set(mapped.map(x => String(x.id)));
  const prev = prevIdsRef.current;
  const added = [...ids].filter(id => !prev.has(id));
  const toPulse = added.filter(id => !myCreatedIdsRef.current.has(id));
  if (toPulse.length) {
    setFreshIds(new Set(toPulse));
	try { await playGong(); } catch {}
    setTimeout(() => setFreshIds(new Set()), 9000);
  }
  prevIdsRef.current = ids;
}catch{}
	  
	  
	  
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [roleId]);
  
  useEffect(() => {
  let abort = false;
  (async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      if (!res.ok) return;
      const board = await res.json();
      if (abort) return;

      const idx = {};
      const cols = board?.columns || {};
      for (const col of Object.values(cols)) {
        const arr = Array.isArray(col?.items) ? col.items : [];
        for (const it of arr) {
          if (it?.id) idx[String(it.id)] = String(it?.content ?? it?.title ?? "");
        }
      }
      setBoardIndex(idx);
    } catch {}
  })();
  return () => { abort = true; };
}, []);
  
   // Auto-Reload alle 30s (nur wenn eine Rolle vorhanden ist)
 useEffect(() => {
   if (!roleId) return;
   const t = setInterval(() => {
     if (!loading) void load();
   }, 30_000);
   return () => clearInterval(t);
 }, [roleId, loading]);

async function updateItemOnServer(patch) {
  const res = await fetch(`/api/aufgaben/${encodeURIComponent(patch.id)}/edit${roleQuery(roleId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roleHeaders(roleId) },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return j.item || patch;
}


  // ---- Persist-Helper: Reorder (DnD) & Status (Pfeil)
  async function persistReorder({ id, toStatus, beforeId }) {
    try {
const r = await fetch(`/api/aufgaben/reorder${roleQuery(roleId)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...roleHeaders(roleId) },
  body: JSON.stringify({ id, toStatus, beforeId, role: roleId }),
});
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
      return r.ok;
    } catch { return false; }
  }

  // ---- EINZIGER Create-POST (Modal postet nicht selbst)
  async function createItemOnServer(payload) {
const clientId = uuid();
const body = { title: payload?.title ?? "Aufgabe", type: payload?.type ?? "", responsible: payload?.responsible ?? "",
               desc: payload?.desc ?? "", status: STATUS.NEW, role: roleId, clientId,
  originProtocolNr: payload?.originProtocolNr ?? null,
  originType: payload?.originType ?? null,            // z.B. "protokoll"
  relatedIncidentId: payload?.relatedIncidentId ?? null,
  meta: payload?.meta ?? undefined			   };
			   
const res = await fetch(`/api/aufgaben${roleQuery(roleId)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...roleHeaders(roleId) },
  body: JSON.stringify(body),
  
});

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
	const saved = json?.item || body;
	if (saved?.id) myCreatedIdsRef.current.add(String(saved.id));
    return json?.item || body;
  }

const deriveIncidentTitle = (task) => {
  return (
    task?.incidentTitle ??
    task?.meta?.incidentTitle ??
    (task?.relatedIncidentId ? boardIndex[String(task.relatedIncidentId)] : "") ??
    ""
  );
};

  // ---- Filter + Spalten (wie _old)
const filtered = useMemo(() => {
  let arr = items;

  // Freitext (Titel/Typ/Verantwortlich/Beschreibung)
  const q = filter.trim().toLowerCase();
  if (q) {
    arr = arr.filter(x =>
      [x.title, x.type, x.responsible, x.desc]
        .filter(Boolean)
        .some(s => String(s).toLowerCase().includes(q))
    );
  }

// Einsatzbezug (nach Einsatztitel; Teilstring, case-insensitive) 
const fE = String(filterEinsatz ?? "").trim().toLowerCase();
  if (fE) {
    arr = arr.filter(x => deriveIncidentTitle(x).toLowerCase().includes(fE));
  }

  return arr;
}, [items, filter, filterEinsatz, boardIndex]);
  const lists = useMemo(() => ({
    [STATUS.NEW]:         filtered.filter(x => (x.status || STATUS.NEW) === STATUS.NEW),
    [STATUS.IN_PROGRESS]: filtered.filter(x => x.status === STATUS.IN_PROGRESS),
    [STATUS.DONE]:        filtered.filter(x => x.status === STATUS.DONE),
  }), [filtered]);

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

  // ---- Pfeil „Weiter→“ → jetzt dedizierter Status-Endpunkt
  const advance = useCallback((item) => {
     if (!allowEdit) return;     // read-only blocken
	const to = nextStatus(item?.status || STATUS.NEW);
    if (to === item?.status) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, status: to } : x));
    void persistStatus({ id: item.id, toStatus: to }); // <<— HIER die Änderung
   }, [allowEdit]);

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
  }, [getColByItemId, lists, allowEdit]);

  return (
    <div className="p-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">Aufgaben</h1>
        <span className="text-xs px-2 py-1 rounded-full border bg-gray-50">Rolle: {roleId || "—"}</span>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Suche Titel / Typ / Verantwortlich…"
            className="px-3 py-2 text-sm rounded-xl border"
          />
		  <div className="flex items-center gap-2">
  <label className="text-sm text-gray-600">Einsatzbezug</label>
  <input
    value={filterEinsatz}
    onChange={(e) => setFilterEinsatz(e.target.value)}
    placeholder="z.B. 4711"
    className="border rounded px-2 py-1 text-sm"
    inputMode="numeric"
  />
</div>
 {allowEdit && (
   <button onClick={() => setAddOpen(true)} className="text-sm px-3 py-2 rounded-xl bg-sky-600 text-white">
     Neu
   </button>
 )}
          <button onClick={load} className="text-sm px-3 py-2 rounded-xl border" disabled={loading}>
            {loading ? "Lädt…" : "Neu laden"}
          </button>
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
                <AufgSortableCard key={it.id} item={it} onAdvance={advance} onClick={() => setActiveItem(it)} isNew={freshIds.has(String(it.id))} />
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
                <AufgSortableCard key={it.id} item={it} onAdvance={advance} onClick={() => setActiveItem(it)} isNew={freshIds.has(String(it.id))} />
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
               <AufgSortableCard key={it.id} item={it} onAdvance={advance} onClick={() => setActiveItem(it)} isNew={freshIds.has(String(it.id))} />
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

         {/* Modals */}
      <AufgAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={async (created) => {
          try {
            const saved = await createItemOnServer(created);
            setItems((prev) => [saved, ...prev]);
          } catch (e) { setError(String(e?.message || e)); }
        }}
      />

      <AufgInfoModal
        open={!!activeItem}
        item={activeItem}
        onClose={() => setActiveItem(null)}
        canEdit={allowEdit}
        onSave={async (patch) => {
          const saved = await updateItemOnServer(patch);
          setItems(prev => prev.map(it => it.id === saved.id ? { ...it, ...saved } : it));
        }}
      />

      {/* Hilfe-Button */}
      <a
        href="/Hilfe_Aufgabenboard.pdf"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-4 right-4 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg"
        title="Hilfe – Aufgabenboard"
      >
        Hilfe
      </a>
    </div>
);

}
