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

const STATUS = { NEW: "Neu", IN_PROGRESS: "In Bearbeitung", DONE: "Erledigt" };
const COLS = [STATUS.NEW, STATUS.IN_PROGRESS, STATUS.DONE];

function nextStatus(s) {
  if (s === STATUS.NEW) return STATUS.IN_PROGRESS;
  if (s === STATUS.IN_PROGRESS) return STATUS.DONE;
  return STATUS.DONE; // bleibt in Erledigt
}

export default function AufgApp() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(null);

  // DnD
  const [draggingItem, setDraggingItem] = useState(null);
  const [overColId, setOverColId] = useState(null);
  const originColRef = useRef(null);
  const lastOverRef = useRef(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } })
  );

  // ---- Daten laden ----
  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/aufgaben", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const arr = Array.isArray(data?.items) ? data.items : (data?.incidents || []);
      const mapped = arr
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: x.id ?? x._id ?? x.key ?? String(Math.random()).slice(2),
          title: x.title ?? x.name ?? "",
          type: x.type ?? x.category ?? "",
          status: ["Neu", "In Bearbeitung", "Erledigt"].includes(x.status) ? x.status : STATUS.NEW,
          responsible: x.responsible ?? x.verantwortlich ?? "",
          desc: x.desc ?? x.beschreibung ?? "",
          createdAt: x.createdAt ?? x.created_at ?? null,
          updatedAt: x.updatedAt ?? x.updated_at ?? null,
        }));
      setItems(mapped);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ---- Persistierung DnD / Statuswechsel ----
  async function persistReorder({ id, toStatus, beforeId }) {
    try {
      const r = await fetch("/api/aufgaben/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, toStatus, beforeId }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  // ---- Filter + Spaltenlisten ----
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) =>
      [x.title, x.type, x.responsible, x.desc]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    );
  }, [items, filter]);

  const lists = useMemo(
    () => ({
      [STATUS.NEW]: filtered.filter((x) => (x.status || STATUS.NEW) === STATUS.NEW),
      [STATUS.IN_PROGRESS]: filtered.filter((x) => x.status === STATUS.IN_PROGRESS),
      [STATUS.DONE]: filtered.filter((x) => x.status === STATUS.DONE),
    }),
    [filtered]
  );

  const listIds = useMemo(
    () => ({
      [STATUS.NEW]: lists[STATUS.NEW].map((x) => x.id),
      [STATUS.IN_PROGRESS]: lists[STATUS.IN_PROGRESS].map((x) => x.id),
      [STATUS.DONE]: lists[STATUS.DONE].map((x) => x.id),
    }),
    [lists]
  );

  const getColByItemId = useCallback(
    (id) => {
      if (!id) return null;
      if (listIds[STATUS.NEW].includes(id)) return STATUS.NEW;
      if (listIds[STATUS.IN_PROGRESS].includes(id)) return STATUS.IN_PROGRESS;
      if (listIds[STATUS.DONE].includes(id)) return STATUS.DONE;
      return null;
    },
    [listIds]
  );

  // ---- Status per Pfeil vorwärts schalten ----
  const advance = useCallback(
    (item) => {
      const to = nextStatus(item?.status || STATUS.NEW);
      if (to === item?.status) return;
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: to } : x)));
      void persistReorder({ id: item.id, toStatus: to, beforeId: null }); // ans Ende der Zielspalte
    },
    []
  );

  // ---- DnD ----
  const onDragStart = useCallback(({ active }) => {
    const id = active?.id;
    originColRef.current = getColByItemId(id);
    setDraggingItem(items.find((x) => x.id === id) || null);
  }, [items, getColByItemId]);

  const onDragOver = useCallback(({ over }) => {
    if (!over) { setOverColId(null); return; }
    lastOverRef.current = over.id;
    const oid = over.id;
    const toCol = COLS.includes(oid) ? oid : getColByItemId(oid);
    setOverColId(toCol || null);
  }, [getColByItemId]);

  const onDragEnd = useCallback(({ active, over }) => {
    setDraggingItem(null);
    setOverColId(null);

    const dropId = over?.id ?? lastOverRef.current;
    if (!dropId) return;

    const activeId = active.id;
    const fromCol = originColRef.current || getColByItemId(activeId);
    let toCol = COLS.includes(dropId) ? dropId : getColByItemId(dropId) || fromCol;
    if (!fromCol || !toCol) return;

    if (fromCol !== toCol) {
      const beforeId = COLS.includes(dropId) ? null : dropId;
      setItems((prev) => prev.map((x) => (x.id === activeId ? { ...x, status: toCol } : x)));
      void persistReorder({ id: activeId, toStatus: toCol, beforeId });
      originColRef.current = null; lastOverRef.current = null;
      return;
    }

    // Reorder innerhalb der Spalte
    const curList = lists[toCol];
    const oldIndex = curList.findIndex((x) => x.id === activeId);

    let newIndex, beforeId = null;
    if (COLS.includes(dropId)) {
      newIndex = curList.length - 1;
    } else {
      const overIndex = curList.findIndex((x) => x.id === dropId);
      newIndex = overIndex < 0 ? curList.length - 1 : overIndex;
      beforeId = curList[newIndex]?.id ?? null;
    }

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const reordered = arrayMove(curList, oldIndex, newIndex);
      setItems((prev) => {
        const others = prev.filter((x) => x.status !== toCol);
        return [...others, ...reordered];
      });
      void persistReorder({ id: activeId, toStatus: toCol, beforeId });
    }
    originColRef.current = null; lastOverRef.current = null;
  }, [getColByItemId, lists]);

  return (
    <div className="p-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">Aufgaben</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Suche Titel / Typ / Verantwortlich…"
            className="px-3 py-2 text-sm rounded-xl border"
          />
          <button onClick={() => setAddOpen(true)} className="text-sm px-3 py-2 rounded-xl bg-sky-600 text-white">
            Neu
          </button>
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
              itemIds={listIds[STATUS.NEW]}
            >
              {lists[STATUS.NEW].map((it) => (
                <AufgSortableCard
                  key={it.id}
                  item={it}
                  onAdvance={advance}
                  onShowInfo={setActiveItem}
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
              itemIds={listIds[STATUS.IN_PROGRESS]}
            >
              {lists[STATUS.IN_PROGRESS].map((it) => (
                <AufgSortableCard
                  key={it.id}
                  item={it}
                  onAdvance={advance}
                  onShowInfo={setActiveItem}
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
              itemIds={listIds[STATUS.DONE]}
            >
              {lists[STATUS.DONE].map((it) => (
                <AufgSortableCard
                  key={it.id}
                  item={it}
                  onAdvance={advance}
                  onShowInfo={setActiveItem}
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

      {/* Modals */}
      <AufgAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(created) => setItems((prev) => [created, ...prev])}
      />
      <AufgInfoModal
        open={!!activeItem}
        item={activeItem}
        onClose={() => setActiveItem(null)}
      />
    </div>
  );
}
