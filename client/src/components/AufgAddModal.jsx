import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";  // Importiere Styles für den DatePicker

export default function AufgAddModal({ open, onClose, onAdded }) {
  const [dueAt, setDueAt] = useState(null);  // Initialisierung von dueAt
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [responsible, setResponsible] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (!open) return;

    // Berechne die Zeit 10 Minuten in der Zukunft
    const tenMinutesLater = new Date(new Date().getTime() + 10 * 60000);
    setDueAt(tenMinutesLater);  // Setze den initialen Wert von dueAt
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    onAdded?.({
      title: title?.trim(),
      type: type?.trim(),
      responsible: responsible?.trim(),
      desc: desc?.trim(),
      dueAt: dueAt ? dueAt.toISOString() : null,  // Speichere dueAt im ISO-Format
    });
    onClose?.();
  };

  if (!open) return null;

  const portalTarget = typeof document !== "undefined" ? document.body : null;
  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40">
      <div className="w-[840px] max-w-[90vw] rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Aufgabe anlegen</h2>
          <button className="text-gray-500 hover:text-gray-700" onClick={onClose} title="Schließen">✕</button>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 gap-3">
          <label className="block">
            <span className="text-xs text-gray-600">Frist/Kontrollzeitpunkt</span>
            <DatePicker
              selected={dueAt}
              onChange={(date) => setDueAt(date)}  // Ändere das Datum
              showTimeSelect
              dateFormat="Pp"  // Das Format für Datum und Uhrzeit
              timeIntervals={5}  // Optionen für Zeitintervall (alle 5 Minuten)
              timeFormat="HH:mm"  // 24-Stunden Format
              timeCaption="Zeit"
              locale="de"  // Lokalisierung auf Deutsch
              hour12={false}  // Stellt sicher, dass keine AM/PM-Anzeige erfolgt
            />
          </label>

          <label className="block">
            <span className="text-xs text-gray-600">Titel</span>
            <input className="w-full border rounded px-2 py-1 h-9" value={title} onChange={e => setTitle(e.target.value)} required />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Typ</span>
              <input className="w-full border rounded px-2 py-1 h-9" value={type} onChange={e => setType(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Verantwortlich (Rolle)</span>
              <input className="w-full border rounded px-2 py-1 h-9" value={responsible} onChange={e => setResponsible(e.target.value)} />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-gray-600">Notizen</span>
            <textarea className="w-full border rounded px-2 py-2 min-h-[120px]" value={desc} onChange={e => setDesc(e.target.value)} />
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded border bg-white">Abbrechen</button>
            <button type="submit" className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white">Anlegen</button>
          </div>
        </form>
      </div>
    </div>,
    portalTarget
  );
}
