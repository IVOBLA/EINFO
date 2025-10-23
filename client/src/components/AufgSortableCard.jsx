import React, { useEffect, useState } from "react";
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






  const [overdueClass, setOverdueClass] = useState(""); // Zustand für das Verfärben
 
  // Berechnung für Überfälligkeit
  const isOverdue = it.dueAt && new Date(it.dueAt) < new Date();

  // Überprüfung alle 5 Sekunden, ob die Kachel weiterhin überfällig ist
  useEffect(() => {
    const interval = setInterval(() => {
      setOverdueClass(isOverdue ? "bg-red-500" : "");
    }, 5000); // Alle 5 Sekunden aktualisieren

    return () => clearInterval(interval); // Bereinige den Intervall bei Komponentenschließung
  }, [it.dueAt, isOverdue]); // Reagiere auf Änderungen von dueAt

  useEffect(() => {
    setOverdueClass(isOverdue ? "bg-red-500" : "");
  }, [isOverdue]);

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-white p-3 shadow-sm hover:shadow cursor-pointer ${overdueClass}`}
      {...attributes}
      {...listeners}
      onClick={() => (onClick ? onClick(it) : onShowInfo?.(it))}
      role="button"
      tabIndex={0}
    >
      {/* Kopfzeile mit Zeitstempeln */}
      <div className="flex items-center justify-between text-[10px] text-gray-500 leading-4 mb-1">
        <div>
          erstellt: {it.createdAt ? new Date(it.createdAt).toLocaleString() : "–"}
        </div>
        <div>
          aktual.: {it.updatedAt ? new Date(it.updatedAt).toLocaleString() : "–"}
        </div>
      </div>

      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-tight">{it.title || "Ohne Titel"}</h3>
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

      {/* Typ + Verantwortlich */}
      <div className="mt-1 text-xs text-gray-600">
        {it.type ? <span className="mr-2">Typ: {it.type}</span> : null}
        {it.responsible ? <span>Verantwortlich: {it.responsible}</span> : null}
      </div>

      {/* Notiz */}
      {it.desc ? (
        <p className="mt-2 text-sm whitespace-pre-wrap text-gray-800">{it.desc}</p>
      ) : null}

      {/* Ursprung / Bezug */}
      {it.originProtocolNr || it.relatedIncidentId ? (
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          {it.originProtocolNr && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.location.assign(`/protokoll#/protokoll/edit/${it.originProtocolNr}`);
              }}
              className="text-blue-700 hover:underline"
              title={`Meldung #${it.originProtocolNr} öffnen`}
            >
              Meldung: {it.originProtocolNr}
            </button>
          )}

          {it.relatedIncidentId && (
            <span
              className="text-gray-700"
              title={`Einsatz: #${it.relatedIncidentId}`}
            >
              {it.incidentTitle || `#${it.relatedIncidentId}`}
            </span>
          )}
        </div>
      ) : null}

      {/* Überfällig anzeigen */}
      {isOverdue && (
        <span className="text-red-600 text-sm">Überfällig!</span>
      )}

      {/* Frist anzeigen */}
      <div className="text-sm text-gray-500 mt-2">
        {formatDueAt(it.dueAt)}
      </div>
    </div>
  );
}
