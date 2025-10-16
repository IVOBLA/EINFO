// client/src/pages/AufgApp.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

// (deine vorhandenen Komponenten bitte beibehalten)
import AufgSortableCard from "../components/AufgSortableCard";
import AufgAddModal from "../components/AufgAddModal";

import { initRolePolicy, canEditApp } from "../auth/roleUtils";

// -----------------------------------------------------
// Hilfsfunktionen: User & Rolle robust ermitteln
// -----------------------------------------------------
function getCurrentUser() {
  try {
    const w = typeof window !== "undefined" ? window : {};
    const ls = w.localStorage;
    const ss = w.sessionStorage;
    const candidates = [
      () => w.__APP_AUTH__?.user,
      () => w.__USER__,
      () => (ls && JSON.parse(ls.getItem("auth.user") || "null")) || null,
      () => (ls && JSON.parse(ls.getItem("user") || "null")) || null,
      () => (ss && JSON.parse(ss.getItem("auth.user") || "null")) || null,
      () => (ss && JSON.parse(ss.getItem("user") || "null")) || null,
    ];
    for (const f of candidates) {
      const u = f?.();
      if (u) return u;
    }
  } catch {}
  return null;
}
function getPrimaryRoleId(user) {
  if (!user) return null;
  // akzeptiere String oder Objekt
  if (typeof user.role === "string") return user.role.trim().toUpperCase();
  if (user.role && typeof user.role.id === "string")
    return user.role.id.trim().toUpperCase();
  // optional: falls Mehrfachrollen existieren
  if (Array.isArray(user.roles) && user.roles.length) {
    const first = user.roles[0];
    if (typeof first === "string") return first.trim().toUpperCase();
    if (first && typeof first.id === "string")
      return first.id.trim().toUpperCase();
  }
  return null;
}

// -----------------------------------------------------
// Datenformate & Konstanten
// -----------------------------------------------------
const COLS = ["neu", "in-bearbeitung", "erledigt"];

function emptyLists() {
  return {
    "neu": [],
    "in-bearbeitung": [],
    "erledigt": [],
  };
}

// Lokaler Storage-Key pro Rolle, falls API/Fallback nicht verfügbar
const lsKeyForRole = (roleId) => `aufg:board:${roleId}`;

// Kandidaten-URLs zum Laden/Speichern pro Rolle
const urlCandidates = (roleId) => ({
  load: [
    // bevorzugte API-Routen
    `/api/aufgaben/board/${encodeURIComponent(roleId)}`,
    `/api/aufgaben/board?role=${encodeURIComponent(roleId)}`,
    // statische Fallback-Datei (wenn gewünscht bereitgestellt)
    `/Aufg_board_${encodeURIComponent(roleId)}.json`,
  ],
  save: [
    // bevorzugt PUT mit Role-Pfad/Query
    { url: `/api/aufgaben/board/${encodeURIComponent(roleId)}`, method: "PUT" },
    { url: `/api/aufgaben/board?role=${encodeURIComponent(roleId)}`, method: "PUT" },
  ],
});

// -----------------------------------------------------
// API-Hilfen (mit Fallbacks)
// -----------------------------------------------------
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return await r.json();
}
async function postJSON(url, body, method = "PUT") {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return await r.json().catch(() => ({}));
}

async function loadBoardForRole(roleId) {
  const { load } = urlCandidates(roleId);
  for (const url of load) {
    try {
      const data = await fetchJSON(url);
      // akzeptiere { lists } oder direkt ein Objekt mit Spalten
      const lists = data?.lists && typeof data.lists === "object" ? data.lists : data;
      if (lists && typeof lists === "object") return normalizeLists(lists);
    } catch {
      // nächste Option probieren
    }
  }
  // Fallback: localStorage
  try {
    const raw = localStorage.getItem(lsKeyForRole(roleId));
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.lists) return normalizeLists(obj.lists);
      return normalizeLists(obj);
    }
  } catch {}
  // leer zurück
  return emptyLists();
}

async function saveBoardForRole(roleId, lists) {
  const body = { v: 1, role: roleId, lists };
  const { save } = urlCandidates(roleId);
  for (const { url, method } of save) {
    try {
      await postJSON(url, body, method);
      return true;
    } catch {
      // nächste Option probieren
    }
  }
  // Fallback: localStorage
  try {
    localStorage.setItem(lsKeyForRole(roleId), JSON.stringify(body));
    return true;
  } catch {}
  return false;
}

function normalizeLists(listsIn) {
  const out = emptyLists();
  for (const col of COLS) {
    const arr = Array.isArray(listsIn[col]) ? listsIn[col] : [];
    // defensive Kopie + Pflichtfelder
    out[col] = arr.map((it) => ({
      id: it.id ?? crypto.randomUUID?.() ?? String(Math.random()).slice(2),
      title: String(it.title ?? it.content ?? "Aufgabe"),
      content: it.content ?? it.title ?? "",
      col: col,
      // weitere optionale Felder bleiben erhalten
      ...it,
    }));
  }
  return out;
}

// =====================================================
//  AUFGABEN-BOARD (pro Rolle)
// =====================================================
export default function AufgApp() {
  // 1) Rollen-Policy laden (für edit/view)
  const [policyReady, setPolicyReady] = useState(false);
  useEffect(() => {
    initRolePolicy().then(() => setPolicyReady(true));
  }, []);

  // 2) User & Rolle bestimmen
  const user = getCurrentUser();
  const roleId = useMemo(() => getPrimaryRoleId(user), [user]);

  // 3) Edit-Recht (nur für diese App) – erst nach Policy-Load sinnvoll
  const canEdit = policyReady && canEditApp("aufgabenboard");
  const readOnly = !canEdit;

  // 4) Board-State
  const [lists, setLists] = useState(emptyLists());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // UI-State
  const [addOpen, setAddOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(null);

  // DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [draggingItem, setDraggingItem] = useState(null);
  const [overColId, setOverColId] = useState(null);
  const originColRef = useRef(null);
  const lastOverRef = useRef(null);

  // Map für Lookup
  const itemsById = useMemo(() => {
    const m = new Map();
    for (const col of COLS) {
      for (const it of lists[col]) m.set(it.id, it);
    }
    return m;
  }, [lists]);

  const getColByItemId = useCallback(
    (id) => {
      for (const c of COLS) {
        if (lists[c].some((x) => x.id === id)) return c;
      }
      return null;
    },
    [lists]
  );

  // 5) Laden des rollen-spezifischen Boards
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!roleId) {
        setLists(emptyLists());
        setLoading(false);
        return;
      }
      setLoading(true);
      const loaded = await loadBoardForRole(roleId).catch(() => emptyLists());
      if (!gone) {
        setLists(loaded);
        setLoading(false);
      }
    })();
    return () => {
      gone = true;
    };
  }, [roleId]);

  // 6) Speichern – nur bei canEdit
  const persist = useCallback(
    async (nextLists) => {
      setLists(nextLists);
      if (!canEdit || !roleId) return;
      setSaving(true);
      try {
        await saveBoardForRole(roleId, nextLists);
      } finally {
        setSaving(false);
      }
    },
    [canEdit, roleId]
  );

  // 7) „Neu“ hinzufügen
  const addItem = useCallback(
    (data) => {
      const base = {
        id: crypto.randomUUID?.() ?? String(Date.now()),
        title: data?.title || "Neue Aufgabe",
        content: data?.content || "",
      };
      const next = {
        ...lists,
        neu: [{ ...base, col: "neu" }, ...lists.neu],
      };
      persist(next);
    },
    [lists, persist]
  );

  // 8) „Weiter“ (Status vorziehen)
  const advance = useCallback(
    (item) => {
      const col = getColByItemId(item.id);
      if (!col) return;
      const idx = COLS.indexOf(col);
      const toCol = COLS[Math.min(idx + 1, COLS.length - 1)];
      if (toCol === col) return;
      const fromList = lists[col].filter((x) => x.id !== item.id);
      const toList = [{ ...item, col: toCol }, ...lists[toCol]];
      persist({ ...lists, [col]: fromList, [toCol]: toList });
    },
    [lists, getColByItemId, persist]
  );

  // 9) DnD-Handler — im View-Modus blockieren
  const onDragStart = useCallback(
    ({ active }) => {
      if (!canEdit) return;
      const id = active?.id;
      originColRef.current = getColByItemId(id);
      setDraggingItem(itemsById.get(id) || null);
    },
    [canEdit, getColByItemId, itemsById]
  );

  const onDragOver = useCallback(
    ({ over }) => {
      if (!canEdit) {
        setOverColId(null);
        return;
      }
      if (!over) {
        setOverColId(null);
        return;
      }
      lastOverRef.current = over.id;
      const oid = over.id;
      const toCol = COLS.includes(oid) ? oid : getColByItemId(oid);
      setOverColId(toCol || null);
    },
    [canEdit, getColByItemId]
  );

  const onDragEnd = useCallback(
    ({ active, over }) => {
      if (!canEdit) {
        setDraggingItem(null);
        setOverColId(null);
        return;
      }
      setDraggingItem(null);
      setOverColId(null);
      const id = active?.id;
      const fromCol = originColRef.current || getColByItemId(id);
      const overId = over?.id ?? lastOverRef.current;
      const toCol = COLS.includes(overId) ? overId : getColByItemId(overId);
      if (!fromCol || !toCol) return;

      if (fromCol === toCol) {
        // gleiche Spalte: Reihenfolge ändern
        const idxOld = lists[fromCol].findIndex((x) => x.id === id);
        const idxNew =
          COLS.includes(overId)
            ? lists[fromCol].length - 1
            : lists[fromCol].findIndex((x) => x.id === overId);
        if (idxOld < 0 || idxNew < 0 || idxOld === idxNew) return;
        const reordered = arrayMove(lists[fromCol], idxOld, idxNew);
        persist({ ...lists, [fromCol]: reordered });
      } else {
        // Spalte wechseln
        const item = itemsById.get(id);
        if (!item) return;
        const fromList = lists[fromCol].filter((x) => x.id !== id);
        const toList = [{ ...item, col: toCol }, ...lists[toCol]];
        persist({ ...lists, [fromCol]: fromList, [toCol]: toList });
      }
    },
    [canEdit, lists, getColByItemId, itemsById, persist]
  );

  // 10) UI
  const roleBadge = roleId ? roleId : "—";

  return (
    <div className="h-full flex flex-col">
      {/* Kopfzeile */}
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Aufgaben-Board</h1>
          <span
            className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-gray-100 border"
            title="Rollen-ID dieses Boards"
          >
            Rolle: {roleBadge}
          </span>
          {saving && (
            <span className="text-xs text-gray-500" title="Speichern …">
              (speichert …)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => canEdit && setAddOpen(true)}
            disabled={!canEdit}
            className="text-sm px-3 py-2 rounded-xl bg-sky-600 text-white disabled:opacity-60"
          >
            Neu
          </button>
        </div>
      </div>

      {/* Hinweis, falls Rolle fehlt */}
      {!roleId && (
        <div className="p-4 text-sm text-red-700 bg-red-50 border-b">
          Kein Role-Kontext gefunden. Bitte einloggen bzw. sicherstellen, dass eine Rolle
          vorhanden ist.
        </div>
      )}

      {/* Spalten */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="p-4 text-sm text-gray-600">Lade Board …</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <div className="grid grid-cols-3 gap-3 p-3">
              {COLS.map((col) => (
                <div
                  key={col}
                  id={col}
                  className={`rounded-lg border bg-gray-50/60 flex flex-col min-h-[200px]`}
                >
                  <div className="px-3 py-2 border-b font-medium capitalize">
                    {col.replace("-", " ")}
                  </div>

                  <div className="p-2 flex-1 min-h-0 overflow-auto space-y-2">
                    {lists[col].map((it) => (
                      <AufgSortableCard
                        key={it.id}
                        item={it}
                        // "weiter" nur im Edit-Modus
                        onAdvance={canEdit ? advance : undefined}
                        onShowInfo={setActiveItem}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </DndContext>
        )}
      </div>

      {/* Modals */}
      <AufgAddModal
        open={addOpen && canEdit}
        onClose={() => setAddOpen(false)}
        onAdded={(created) => addItem(created)}
      />
    </div>
  );
}
