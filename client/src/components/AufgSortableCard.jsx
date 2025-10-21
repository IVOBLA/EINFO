import React, { useEffect, useMemo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function AufgSortableCard({
  item,
  onClick,
  onShowInfo,
  onAdvance,
  disableAdvance,
  isNew,
}) {
  // Karte bei dnd-kit registrieren
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  
// Index: Einsatzkarten (id -> content/title) aus /api/board
const [boardIndex, setBoardIndex] = useState({});

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

// Einsatztitel aus Item/Meta/Board ableiten
const incidentTitle = useMemo(() => {
  return (
    item?.incidentTitle ??
    item?.meta?.incidentTitle ??
    (item?.relatedIncidentId ? boardIndex[String(item.relatedIncidentId)] : "") ??
    ""
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [item?.incidentTitle, item?.meta?.incidentTitle, item?.relatedIncidentId, boardIndex]);


  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    cursor: "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        "rounded-lg border bg-white p-3 shadow-sm hover:shadow cursor-pointer " +
        (isNew ? "ring-2 ring-rose-400 animate-pulse " : "")
      }
      {...attributes}
      {...listeners}
      onClick={() => (onClick ? onClick(item) : onShowInfo?.(item))}
      role="button"
      tabIndex={0}
    >
      {/* Kopfzeile mit Zeitstempeln */}
      <div className="flex items-center justify-between text-[10px] text-gray-500 leading-4 mb-1">
        <div>
          erstellt: {item.createdAt ? new Date(item.createdAt).toLocaleString() : "–"}
        </div>
        <div>
          aktual.: {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "–"}
        </div>
      </div>

      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-tight">{item.title || "Ohne Titel"}</h3>
        <button
          className={`text-xs px-2 py-1 rounded ${
            disableAdvance ? "bg-gray-200 text-gray-500" : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (!disableAdvance) onAdvance?.(item);
          }}
          disabled={disableAdvance}
          title="Status weiter"
        >
          ➜
        </button>
      </div>

      {/* Typ + Verantwortlich */}
      <div className="mt-1 text-xs text-gray-600">
        {item.type ? <span className="mr-2">Typ: {item.type}</span> : null}
        {item.responsible ? <span>Verantwortlich: {item.responsible}</span> : null}
      </div>

      {/* Notiz */}
      {item.desc ? (
        <p className="mt-2 text-sm whitespace-pre-wrap text-gray-800">{item.desc}</p>
      ) : null}

{/* Ursprung / Bezug */}
{(item?.originProtocolNr || item?.relatedIncidentId) && (
  <div className="mt-2 flex items-center gap-3 text-[11px]">
    {item.originProtocolNr ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          window.location.assign(`/protokoll#/protokoll/edit/${item.originProtocolNr}`);
        }}
        className="text-blue-700 hover:underline"
        title={`Protokoll #${item.originProtocolNr} öffnen`}
      >
        Prot. #{item.originProtocolNr}
      </button>
    ) : null}

    {item.relatedIncidentId ? (
      <span
        className="text-gray-700"
        title={`Bezug: #${item.relatedIncidentId}`}
      >
        {incidentTitle || `#${item.relatedIncidentId}`}
      </span>
    ) : null}
  </div>
)}

    </div>
  );
}
