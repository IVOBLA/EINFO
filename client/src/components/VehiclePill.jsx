import React from "react";

export function VehiclePill({ vehicle, pillWidthPx = 160 }) {
  const line = `${vehicle.ort || "—"}  •  👥 ${vehicle.mannschaft ?? 0}`;
  return (
    <div
      className="select-none border-2 border-red-300 rounded-2xl px-2 py-1 bg-white shadow-sm"
      style={{ width: pillWidthPx }}
      title={`${vehicle.label || vehicle.id} — ${line}`}
    >
      <div className="text-[13px] font-semibold leading-5 truncate">
        {vehicle.label || vehicle.id}
      </div>
      <div className="text-[12px] text-gray-600 leading-4 truncate">{line}</div>
    </div>
  );
}
