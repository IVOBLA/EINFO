// client/src/components/AufgInfoModal.jsx
import React from "react";

export default function AufgInfoModal({ open, item, onClose }) {
  if (!open) return null;
  const it = item || {};
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-base font-semibold">Details</div>
          <button onClick={onClose} className="text-sm px-2 py-1 rounded-lg border">Schließen</button>
        </div>
        <div className="text-sm">
          <div className="mb-1"><span className="font-semibold">Titel:</span> {it.title || "–"}</div>
          <div className="mb-1"><span className="font-semibold">Typ:</span> {it.type || "–"}</div>
          <div className="mb-1"><span className="font-semibold">Verantwortlich:</span> {it.responsible || "–"}</div>
          {it.desc && <div className="mb-1"><span className="font-semibold">Notizen:</span> <span className="whitespace-pre-wrap">{it.desc}</span></div>}
          {it.createdAt && <div className="mb-1 text-xs text-slate-500">erstellt: {new Date(it.createdAt).toLocaleString()}</div>}
          {it.updatedAt && <div className="mb-1 text-xs text-slate-500">aktual.: {new Date(it.updatedAt).toLocaleString()}</div>}
        </div>
      </div>
    </div>
  );
}
