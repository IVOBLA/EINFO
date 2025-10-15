import React from "react";
import { useDraggable } from "@dnd-kit/core";

export function DraggableVehicle({ vehicle, pillWidthPx = 160, near = false, distKm = null }) {
  const id = `veh:${vehicle.id}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { type: "vehicle", vehicleId: vehicle.id },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: pillWidthPx,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      {...attributes}
      {...listeners}
      className={`relative max-w-full select-none border-2 ${near ? "border-emerald-500" : "border-red-300"} rounded-2xl bg-white
                 px-2 py-1 shadow-sm cursor-grab active:cursor-grabbing
                 ${isDragging ? "opacity-50" : ""}`}
    >
      {/* Proximity-Pulse */}
      {near && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-0.5 rounded-2xl border-2 border-emerald-400/50 animate-ping"
        />
      )}
      <div className="text-[13px] font-semibold leading-5 truncate">
        {vehicle.label || vehicle.id}
      </div>
 <div className="text-[12px] text-gray-600 leading-4 truncate flex justify-between items-center">
   <span>{vehicle.ort || "—"} · 👥 {vehicle.mannschaft ?? 0}</span>
   {near && Number.isFinite(Number(distKm)) && (
     <span className="absolute top-1 right-1 text-[11px] tabular-nums text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap">
       {Number(distKm)} Km
     </span>
   )}
 </div>
    </div>
  );
}
