import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import DatePicker, { registerLocale } from "react-datepicker";
import de from "date-fns/locale/de";
import "react-datepicker/dist/react-datepicker.css"; // Importiere Styles für den DatePicker
import { ensureValidDueOffset, getFallbackDueOffsetMinutes } from "../utils/defaultDueOffset.js";

registerLocale("de", de);

const TIME_STEP_MINUTES = 1;

function createDefaultDueAt(offsetMinutes) {
  const offset = ensureValidDueOffset(offsetMinutes);
  const base = new Date(Date.now() + offset * 60 * 1000);
  base.setSeconds(0, 0);
  return base;
}

export default function AufgAddModal({
  open,
  onClose,
  onAdded,
  incidentOptions = [],
  defaultDueOffsetMinutes = getFallbackDueOffsetMinutes(),
  initialTitle = "",
  initialDesc = "",
  initialResponsible = "",
  initialType = "",
}) {
  const safeOffset = useMemo(
    () => ensureValidDueOffset(defaultDueOffsetMinutes),
    [defaultDueOffsetMinutes],
  );

  const [dueAt, setDueAt] = useState(() => createDefaultDueAt(safeOffset));  // Initialisierung von dueAt
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [responsible, setResponsible] = useState("");
  const [desc, setDesc] = useState("");
  const [relatedIncidentId, setRelatedIncidentId] = useState("");

  useEffect(() => {
    if (!open) return;

    setDueAt(createDefaultDueAt(safeOffset));
    setTitle(initialTitle || "");
    setType(initialType || "");
    setResponsible(initialResponsible || "");
    setDesc(initialDesc || "");
    setRelatedIncidentId("");
  }, [open, safeOffset, initialTitle, initialDesc, initialResponsible, initialType]);

  const selectedIncident = useMemo(() => {
    if (!relatedIncidentId) return null;
    return incidentOptions.find((opt) => String(opt?.id ?? "") === String(relatedIncidentId)) || null;
  }, [incidentOptions, relatedIncidentId]);

  const submit = (e) => {
    e.preventDefault();
    const ensuredDueAt = dueAt ?? createDefaultDueAt(safeOffset);
    const incidentId = relatedIncidentId ? String(relatedIncidentId).trim() : "";
    onAdded?.({
      title: title?.trim(),
      type: type?.trim(),
      responsible: responsible?.trim(),
      desc: desc?.trim(),
      dueAt: ensuredDueAt ? ensuredDueAt.toISOString() : null,  // Speichere dueAt im ISO-Format
      relatedIncidentId: incidentId || null,
      incidentTitle: selectedIncident?.label || null,
    });
    onClose?.();
  };


  if (!open) return null;

  const portalTarget = typeof document !== "undefined" ? document.body : null;
  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex min-h-screen items-center justify-center bg-black/40 p-3 overflow-y-auto">
      <div className="w-[840px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Aufgabe anlegen</h2>
          <button className="text-gray-500 hover:text-gray-700" onClick={onClose} title="Schließen">✕</button>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 gap-3">
          <label className="block">
            <span className="text-xs text-gray-600">Frist/Kontrollzeitpunkt</span>
            <DatePicker
              selected={dueAt}
              onChange={(date) => setDueAt(date)} // Ändere das Datum
              showTimeSelect
              dateFormat="dd.MM.yyyy HH:mm"
               timeIntervals={TIME_STEP_MINUTES} // Optionen für Zeitintervall (alle 5 Minuten)
              timeFormat="HH:mm"
              timeCaption="Zeit"
              locale="de"
              popperPlacement="bottom-start"
              isClearable
              placeholderText="Datum auswählen"
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

          {incidentOptions.length > 0 && (
            <label className="block">
              <span className="text-xs text-gray-600">Einsatz verknüpfen</span>
              <select
                className="w-full border rounded px-2 py-2 h-10 text-sm"
                value={relatedIncidentId}
                onChange={(e) => setRelatedIncidentId(e.target.value)}
              >
                <option value="">Kein Einsatz</option>
                {incidentOptions.map((opt) => {
                  const value = String(opt?.id ?? "");
                  const rawStatus = opt?.statusName || opt?.statusLabel || "";
                  const normalizedStatus = rawStatus.replace(/:$/, "").trim();
                  const showStatus = normalizedStatus && normalizedStatus.toLowerCase() !== "neu";
                  const baseLabel = opt?.label ?? value;
                  const label = showStatus ? `${normalizedStatus}: ${baseLabel}` : baseLabel;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          <label className="block">
            <span className="text-xs text-gray-600">Notizen</span>
            <textarea
              className="w-full border rounded px-2 py-2 min-h-[120px] max-h-[320px] overflow-y-auto resize-y"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
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
