import React, { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import CollapsibleNote from "./CollapsibleNote";

const STATUS_ACCENT = {
  "Neu": "card-accent-new",
  "In Bearbeitung": "card-accent-progress",
  "Erledigt": "card-accent-done",
};

function AufgSortableCard({
  item,
  onClick,
  onShowInfo,
  onAdvance,
  disableAdvance,
  isNew,
  incidentLookup,
  onCreateProtocol,
  onOpenProtocol,
  tick, // zentraler Timer-Tick vom Parent (statt eigenem setInterval)
}) {
  const it = item || {};

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: it.id });

  if (!it.id) return null;

  const isDone = String(it.status || "") === "Erledigt";

  // Zentrale DueState-Berechnung via useMemo statt useState + setInterval
  const dueState = useMemo(() => {
    void tick; // Dependency: bei jedem Tick neu berechnen
    if (!it?.dueAt || isDone) return "none";
    const dueDate = new Date(it.dueAt);
    if (Number.isNaN(dueDate.getTime())) return "none";
    const diffMs = dueDate.getTime() - Date.now();
    if (diffMs <= 0) return "overdue";
    if (diffMs <= 10 * 60 * 1000) return "soon";
    return "none";
  }, [it?.dueAt, isDone, tick]);

  const isOverdue = dueState === "overdue";
  const isSoon = dueState === "soon";
  const accentClass = STATUS_ACCENT[it.status] || "card-accent-new";

  const showPulse = Boolean(isNew && !isDone);

  const incidentId = it?.relatedIncidentId ? String(it.relatedIncidentId) : "";
  const incidentInfo = incidentId && incidentLookup?.get ? incidentLookup.get(incidentId) : null;
  const incidentLabel = incidentInfo?.label || it?.incidentTitle || (incidentId ? `#${incidentId}` : "");
  const incidentStatusLabel = incidentInfo?.statusName || incidentInfo?.statusLabel || "";

  const formatDueAt = (dueAt) => {
    if (!dueAt) return "\u2014";
    const d = new Date(dueAt);
    if (Number.isNaN(d.getTime())) return "\u2014";
    return d.toLocaleString("de-AT", {
      timeZone: "Europe/Vienna",
      hour12: false,
    });
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: "grab",
  };

  const formatTimestamp = (value) => {
    if (!value) return "\u2013";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "\u2013";
    return d.toLocaleString("de-AT", {
      timeZone: "Europe/Vienna",
      hour12: false,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "sortable-card relative rounded-xl border p-3.5 cursor-pointer",
        accentClass,
        isDone ? "opacity-75" : "",
        isOverdue && !isDone ? "bg-red-50 border-red-200" : "bg-slate-50",
        showPulse ? "pulse-incoming" : "",
      ].filter(Boolean).join(" ")}
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
            className="pointer-events-none absolute inset-0 rounded-xl bg-red-500/8 animate-pulse-inner"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl animate-ping-safe"
          />
        </>
      )}
      <div className="relative z-10">
        {/* Zeitstempel-Zeile */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 leading-4 mb-1.5 font-medium">
          <span>{formatTimestamp(it.createdAt)}</span>
          {it.updatedAt && it.updatedAt !== it.createdAt && (
            <span>akt. {formatTimestamp(it.updatedAt)}</span>
          )}
        </div>

        {/* Titel + Action Buttons */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-sm leading-snug text-slate-900 line-clamp-2">
            {it.title || "Ohne Titel"}
          </h3>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              className="card-action-btn bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700"
              onClick={(e) => {
                e.stopPropagation();
                onCreateProtocol?.(it);
              }}
              title="Meldung aus Aufgabe erstellen"
              aria-label="Meldung aus Aufgabe erstellen"
            >
                <img
    src="/report-form.png"
    alt=""
    className="w-4 h-4"
    draggable={false}
  />
            </button>
            <button
              className={`card-action-btn ${disableAdvance ? "bg-slate-100 text-slate-300" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!disableAdvance) onAdvance?.(it);
              }}
              disabled={disableAdvance}
              title="Status weiter"
            >
              &#x279C;
            </button>
          </div>
        </div>

        {/* Typ-Badge */}
        {it.type && (
          <div className="mt-1.5">
            <span className="card-type-badge">{it.type}</span>
          </div>
        )}

        {/* Notiz */}
        {it.desc ? (
          <CollapsibleNote
            text={it.desc}
            className="mt-2"
            textClassName="text-sm text-slate-700 leading-relaxed"
          />
        ) : null}

        {/* Ursprung / Bezug */}
        {(it.originProtocolNr || it.relatedIncidentId) && (
          <div className="mt-2.5 flex items-center gap-3 text-[11px]">
            {it.originProtocolNr && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProtocol?.(it.originProtocolNr);
                }}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                title={`Meldung #${it.originProtocolNr} oeffnen`}
              >
                Meldung #{it.originProtocolNr}
              </button>
            )}
            {incidentLabel && (
              <span
                className="text-slate-600"
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
        )}

        {/* Frist + Ueberfaellig */}
        {it.dueAt && (
          <div className={`card-due ${isOverdue && !isDone ? "card-due-overdue" : ""} ${isSoon && !isDone ? "text-amber-600 font-medium" : ""}`}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{formatDueAt(it.dueAt)}</span>
            {isOverdue && !isDone && (
              <span className="card-overdue-badge ml-1">Ueberfaellig</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(AufgSortableCard);

