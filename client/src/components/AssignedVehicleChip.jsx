import React from "react";
import { useDraggable } from "@dnd-kit/core";

/**
 * Chip einer bereits zugeordneten Einheit.
 * - ist selbst draggable (id: "ass:<cardId>:<vehicleId>")
 * - Doppelklick klont die Einheit (onClone)
 * - rotes X entfernt die Einheit von der Karte (onUnassign)
 * - NEU: near => Proximity-Pulse/Highlight
 */
export default function AssignedVehicleChip({
  cardId,
  vehicle,
  pillWidthPx = 160,
  onUnassign,
  onClone,
  near = false, 
  distKm = null,
  readonly = false,
}) {
  const id = `ass:${cardId}:${vehicle.id}`;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { type: "assigned", vehicleId: vehicle.id, fromCardId: cardId },
    disabled: readonly,
  });

  const style = {
    width: pillWidthPx,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative self-start border-2 rounded-2xl bg-white px-2 pr-9 py-1 shadow-sm
                  select-none ${readonly ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}
                  ${near ? "border-emerald-500 ring-2 ring-emerald-300" : "border-red-300"}
                  ${isDragging ? "opacity-50" : ""}`}
      title={readonly
        ? "Einheit kann derzeit nicht verschoben werden"
        : "Ziehen: auf andere Karte verschieben · Doppelklick: klonen"}
      onDoubleClick={() => { if (!readonly) onClone?.(vehicle.id, cardId); }}
      aria-disabled={readonly}
    >
      {/* Proximity-Pulse (dezent) */}
      {near && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-0.5 rounded-2xl border-2 border-emerald-400/50 animate-ping"
        />
      )}

      {/* Zeile 1: Name */}
      <div className="text-[13px] font-semibold leading-5 truncate">
        {vehicle.label || vehicle.id}
      </div>
      {/* Zeile 2: Ort + 👥 */}
 <div className="text-[12px] text-gray-600 leading-4 truncate flex justify-between items-center">
   <span>{vehicle.ort || "—"} · 👥 {vehicle.mannschaft ?? 0}</span>
   {near && Number.isFinite(Number(distKm)) && (
     <span className="absolute top-1 right-8 text-[11px] tabular-nums text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap">
       {Number(distKm)} Km
     </span>
   )}
 </div>

      {/* X-Button – stoppt Drag-Events */}
      {!readonly && (
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onUnassign?.(cardId, vehicle.id);
        }}
        title="Einheit entfernen"
        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-red-600 text-white shadow flex items-center justify-center"
        aria-label="Einheit entfernen"
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M1 1 L11 11 M11 1 L1 11" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      )}
    </div>
  );
}
