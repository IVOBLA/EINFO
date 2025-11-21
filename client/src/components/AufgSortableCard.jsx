import React, { useCallback, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import CollapsibleNote from "./CollapsibleNote";

export default function AufgSortableCard({
  item,
  onClick,
  onShowInfo,
  onAdvance,
  disableAdvance,
  isNew,
  incidentLookup,
  onCreateProtocol,
  onOpenProtocol,
}) {
  const it = item || {}; // Falls item nicht vorhanden ist, wird es als leeres Objekt gesetzt.
  if (!it) return null; 

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: it.id });






const [dueState, setDueState] = useState("none"); // none | soon | overdue

  const isDone = String(it.status || "") === "Erledigt";

  const recomputeDueState = useCallback(() => {
    if (!it?.dueAt || isDone) {
      setDueState("none");
      return;
    }
    const dueDate = new Date(it.dueAt);
    if (Number.isNaN(dueDate.getTime())) {
      setDueState("none");
      return;
    }
    const diffMs = dueDate.getTime() - Date.now();
    if (diffMs <= 0) {
      setDueState("overdue");
    } else if (diffMs <= 10 * 60 * 1000) {
      setDueState("soon");
    } else {
      setDueState("none");
    }
  }, [it?.dueAt, isDone]);

  useEffect(() => {
    recomputeDueState();
    const interval = setInterval(recomputeDueState, 5000);
    return () => clearInterval(interval);
  }, [recomputeDueState]);

  const isOverdue = dueState === "overdue";
  const highlightClass = isDone
    ? "bg-white"
    : isOverdue
      ? "bg-yellow-100 border-amber-300"
      : "bg-white";

  const showPulse = Boolean(isNew && !isDone);

  const incidentId = it?.relatedIncidentId ? String(it.relatedIncidentId) : "";
  const incidentInfo = incidentId && incidentLookup?.get ? incidentLookup.get(incidentId) : null;
  const incidentLabel = incidentInfo?.label || it?.incidentTitle || (incidentId ? `#${incidentId}` : "");
  const incidentStatusLabel = incidentInfo?.statusName || incidentInfo?.statusLabel || "";


  // Formatierung des dueAt-Werts im 24-Stunden-Format und mit der richtigen Zeitzone
  const formatDueAt = (dueAt) => {
    if (!dueAt) return "—";
    const d = new Date(dueAt);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("de-AT", {
      timeZone: "Europe/Vienna", // Berücksichtige die österreichische Zeitzone
      hour12: false, // 24-Stunden-Format (keine AM/PM)
    });
  };

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.7 : 1,
      cursor: "grab",
    };



    const formatTimestamp = (value) => {
    if (!value) return "–";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "–";
    return d.toLocaleString("de-AT", {
      timeZone: "Europe/Vienna",
      hour12: false,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-lg border p-3 shadow-sm hover:shadow cursor-pointer ${highlightClass} ${showPulse ? "pulse-incoming" : ""}`}
      {...attributes}
      {...attributes}
      {...listeners}
      onClick={() => (onClick ? onClick(it) : onShowInfo?.(it))}
      role="button"
      tabIndex={0}
      aria-live={showPulse ? "polite" : undefined}
    >
      {showPulse && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg bg-red-500/10 animate-pulse-inner"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg animate-ping-safe"
          />
        </>
      )}
      <div className="relative z-10">
        {/* Kopfzeile mit Zeitstempeln */}
        <div className="flex items-center justify-between text-[10px] text-gray-500 leading-4 mb-1">
          <div>erstellt: {formatTimestamp(it.createdAt)}</div>
          <div>aktual.: {formatTimestamp(it.updatedAt)}</div>
        </div>

        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight">{it.title || "Ohne Titel"}</h3>
          <div className="flex items-center gap-1">
            <button
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
              onClick={(e) => {
                e.stopPropagation();
                onCreateProtocol?.(it);
              }}
              title="Meldung aus Aufgabe erstellen"
              aria-label="Meldung aus Aufgabe erstellen"
            >
              ✎
            </button>
            <button
              className={`text-xs px-2 py-1 rounded ${disableAdvance ? "bg-gray-200 text-gray-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!disableAdvance) onAdvance?.(it);
              }}
              disabled={disableAdvance}
              title="Status weiter"
            >
              ➜
            </button>
          </div>
        </div>

        {/* Typ + Verantwortlich */}
        <div className="mt-1 text-xs text-gray-600">
          {it.type ? <span className="mr-2">Typ: {it.type}</span> : null}
        </div>

        {/* Notiz */}
        {it.desc ? (
          <CollapsibleNote
            text={it.desc}
            className="mt-2"
            textClassName="text-sm text-gray-800"
          />
        ) : null}

        {/* Ursprung / Bezug */}
        {it.originProtocolNr || it.relatedIncidentId ? (
          <div className="mt-2 flex items-center gap-3 text-[11px]">
            {it.originProtocolNr && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProtocol?.(it.originProtocolNr);
                }}
                className="text-blue-700 hover:underline"
                title={`Meldung #${it.originProtocolNr} öffnen`}
              >
                Meldung: {it.originProtocolNr}
              </button>
            )}

       {incidentLabel && (
            <span
              className="text-gray-700"
              title={
                incidentStatusLabel
                  ? `Einsatz: ${incidentLabel}\nStatus: ${incidentStatusLabel}`
                  : `Einsatz: ${incidentLabel}`
              }
            >
              Einsatz: {incidentLabel}
              {incidentStatusLabel ? ` (${incidentStatusLabel})` : ""}
            </span>
          )}
          </div>
        ) : null}

        {/* Überfällig anzeigen */}
      {!isDone && isOverdue && (
        <span className="text-red-600 text-sm">Überfällig!</span>
      )}

        {/* Frist anzeigen */}
        <div className="text-sm text-gray-500 mt-2">
          {formatDueAt(it.dueAt)}
        </div>
      </div>
    </div>
  );
}

