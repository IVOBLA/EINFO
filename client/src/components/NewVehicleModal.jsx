import React, { useState } from "react";

export default function NewVehicleModal({ onClose, onCreate }) {
  const [ort, setOrt] = useState("");
  const [label, setLabel] = useState("");
  const [mannschaft, setM] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!ort.trim() || !label.trim()) {
      setErr("Ort und Name sind erforderlich.");
      return;
    }
    try {
      setBusy(true);
      await onCreate({ ort: ort.trim(), label: label.trim(), mannschaft: Number(mannschaft) || 0 });
      onClose(); // nur bei Erfolg schließen
    } catch (e2) {
      setErr(e2?.message || "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-lg p-4 w-[360px] space-y-3">
        <h3 className="font-semibold text-lg">Einheit anlegen</h3>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="space-y-1">
          <label className="text-sm">Ort</label>
          <input className="border rounded px-2 py-1 w-full" value={ort} onChange={e=>setOrt(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Name</label>
          <input className="border rounded px-2 py-1 w-full" value={label} onChange={e=>setLabel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Mannschaft</label>
          <input type="number" min="0" className="border rounded px-2 py-1 w-24" value={mannschaft} onChange={e=>setM(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border" disabled={busy}>Abbrechen</button>
          <button type="submit" className="px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-60" disabled={busy}>
            {busy ? "Anlegen…" : "Anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}
