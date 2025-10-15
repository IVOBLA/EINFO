import React from "react";

export default function IncidentInfoModal({ open, onClose, info = {} }) {
  if (!open) return null;

  const Row = ({ label, value }) => (
    <div className="flex items-start gap-3 py-1">
      <div className="w-32 shrink-0 text-gray-600">{label}</div>
      <div className="flex-1 font-medium break-words">{value ?? "—"}</div>
    </div>
  );

  const alarmzeit = info.timestamp
    ? new Date(info.timestamp).toLocaleString("de-AT", { hour12: false })
    : "—";

  // Location kann als Klartext kommen; Koordinaten zeigen wir ergänzend in Klammern an, wenn vorhanden.
  const locParts = [];
  if (info.location) locParts.push(String(info.location));
  if (Number.isFinite(info.latitude) && Number.isFinite(info.longitude)) {
    locParts.push(`(${info.latitude}, ${info.longitude})`);
  }
  const locationCombined = locParts.length ? locParts.join(" ") : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-[101] w-[min(92vw,640px)] rounded-xl bg-white shadow-xl p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg md:text-xl font-bold">Einsatz-Info</h2>
          <button
            className="h-8 w-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center"
            onClick={onClose}
            aria-label="Schließen"
            title="Schließen"
          >
            <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
              <path d="M1 1 L11 11 M11 1 L1 11" stroke="black" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="space-y-1">
          <Row label="Typ" value={info.type || info.typ} />
          <Row label="Alarmzeit" value={alarmzeit} />
          <Row label="Alarmiert" value={info.alerted} />
          <Row label="Beschreibung" value={info.description} />
          <Row label="Adresse" value={info.additionalAddressInfo || info.ort} />
          <Row label="Location" value={locationCombined} />
        </div>

        <div className="mt-4 flex justify-end">
          <button
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
