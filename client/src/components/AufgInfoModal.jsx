import React, { useEffect, useMemo, useState } from "react";
import DatePicker, { registerLocale } from "react-datepicker";
import de from "date-fns/locale/de";
import "react-datepicker/dist/react-datepicker.css";

registerLocale("de", de);

const formatDueAt = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("de-AT", {
    timeZone: "Europe/Vienna",
    hour12: false,
  });
};

export default function AufgInfoModal({
  open,
  item,
  onClose,
  onSave,
  canEdit,
  incidentOptions = [],
  incidentLookup,
  onCreateProtocol,
}) {
  const it = item || null;
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: "",
    responsible: "",
    desc: "",
    dueAt: null,
    relatedIncidentId: "",
  });

  const incidentMap = useMemo(() => {
    if (incidentLookup && typeof incidentLookup.get === "function") return incidentLookup;
    const map = new Map();
    if (incidentLookup && typeof incidentLookup === "object") {
      Object.entries(incidentLookup).forEach(([key, value]) => {
        map.set(String(key), value);
      });
    }
    return map;
  }, [incidentLookup]);

  useEffect(() => {
    if (!open) return;
    setEdit(false);
    setForm({
      title: it?.title || "",
      type: it?.type || "",
      responsible: it?.responsible || "",
      desc: it?.desc || "",
      dueAt: it?.dueAt ? new Date(it.dueAt) : null,
      relatedIncidentId: it?.relatedIncidentId ? String(it.relatedIncidentId) : "",
    });
  }, [open, it?.id]);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (ev) => {
      if (ev.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const changed = useMemo(() => {
    if (!it) return false;
    const currentIncidentId = form.relatedIncidentId ? String(form.relatedIncidentId) : "";
    const originalIncidentId = it?.relatedIncidentId ? String(it.relatedIncidentId) : "";

    return (
      (form.title ?? "") !== (it.title ?? "") ||
      (form.type ?? "") !== (it.type ?? "") ||
      (form.responsible ?? "") !== (it.responsible ?? "") ||
      (form.desc ?? "") !== (it.desc ?? "") ||
      currentIncidentId !== originalIncidentId ||
      ((form.dueAt ? form.dueAt.toISOString() : null) ?? null) !==
        ((it.dueAt ? new Date(it.dueAt).toISOString() : null) ?? null)
    );
  }, [form, it]);

  const handleSave = async () => {
    if (!canEdit || !it) return;
    if (!changed) {
      setEdit(false);
      return;
    }
    const payload = {
      id: it.id,
      title: form.title?.trim() || "",
      type: form.type?.trim() || "",
      responsible: form.responsible?.trim() || "",
desc: form.desc?.trim() || "",
      dueAt: form.dueAt ? form.dueAt.toISOString() : null,
    };
    const incidentId = form.relatedIncidentId ? String(form.relatedIncidentId) : "";
    if (incidentId) {
      const info = incidentMap.get(incidentId);
      payload.relatedIncidentId = incidentId;
      payload.incidentTitle = info?.label || info?.content || it.incidentTitle || `#${incidentId}`;
    } else {
      payload.relatedIncidentId = null;
      payload.incidentTitle = null;
    }
    await onSave?.(payload);
    setEdit(false);
  };

  const currentIncident = useMemo(() => {
    if (!it?.relatedIncidentId) return null;
    const id = String(it.relatedIncidentId);
    const info = incidentMap.get(id);
    if (info) return { ...info, id, fromBoard: true };
    return {
      id,
      label: it.incidentTitle || `#${id}`,
      statusName: "",
      fromBoard: false,
    };
  }, [incidentMap, it?.relatedIncidentId, it?.incidentTitle]);

  const selectOptions = useMemo(() => {
    const base = Array.isArray(incidentOptions) ? incidentOptions : [];
    if (!currentIncident || currentIncident.fromBoard) return base;
    if (base.some((opt) => String(opt.id) === String(currentIncident.id))) return base;
    return [
      ...base,
      {
        id: currentIncident.id,
        label: `${currentIncident.label} (nicht mehr am Einsatzboard)`,
        statusName: currentIncident.statusName,
        fromBoard: false,
      },
    ];
  }, [incidentOptions, currentIncident]);

  if (!open || !it) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40"
      onClick={() => onClose?.()}
    >
      <div
        className="w-[840px] max-w-[90vw] rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Aufgabe</h2>
          <div className="flex items-center gap-2">
            {onCreateProtocol ? (
              <button
                type="button"
                onClick={() => {
                  onCreateProtocol(it);
                  onClose?.();
                }}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                title="Meldung aus Aufgabe erstellen"
              >
                Meldung
              </button>
            ) : null}
            {canEdit ? (
              !edit ? (
                <button
                  onClick={() => setEdit(true)}
                  className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50"
                >
                  Bearbeiten
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setEdit(false)}
                    className="px-3 py-1.5 rounded border bg-white"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                    disabled={!changed}
                  >
                    Speichern
                  </button>
                </>
              )
            ) : null}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
                title="Schließen"
              >
                ✕
              </button>
            </div>
          </div>

        {!edit ? (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="text-xs text-gray-600">Titel</div>
              <div className="font-medium break-words">{it.title || "—"}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-600">Typ</div>
                <div>{it.type || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Verantwortlich</div>
                <div>{it.responsible || "—"}</div>
              </div>
            </div>
            {it.originProtocolNr ? (
              <div className="text-xs">
                Ursprung:{" "}
                <button
                  className="text-blue-700 hover:underline"
                  onClick={() =>
                    window.location.assign(`/protokoll#/protokoll/edit/${it.originProtocolNr}`)
                  }
                  title={`Meldung #${it.originProtocolNr} öffnen`}
                >
                  Meldung: {it.originProtocolNr}
                </button>
              </div>
            ) : null}
            {it.relatedIncidentId ? (
              <div className="text-xs">
                Einsatz:{" "}
                <span className="font-medium">
                  {currentIncident?.label || it.incidentTitle || `#${it.relatedIncidentId}`}
                </span>
                {currentIncident?.statusName ? (
                  <span className="text-gray-500 ml-1">({currentIncident.statusName})</span>
                ) : null}
                {currentIncident && !incidentMap.has(String(currentIncident.id)) ? (
                  <span className="ml-1 text-[11px] text-amber-600">(nicht mehr am Einsatzboard)</span>
                ) : null}
              </div>
            ) : null}
            <div>
              <div className="text-xs text-gray-600">Notizen</div>
              <div className="whitespace-pre-wrap break-words">{it.desc || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Frist/Kontrollzeitpunkt</div>
              <div className="font-medium">{formatDueAt(it.dueAt)}</div>
            </div>
          </div>
		  ) : (
          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Titel</span>
              <input
                className="w-full border rounded px-2 py-1 h-9"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-600">Typ</span>
                <input
                  className="w-full border rounded px-2 py-1 h-9"
                  value={form.type}
                  onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Verantwortlich (Rolle)</span>
                <input
                  className="w-full border rounded px-2 py-1 h-9"
                  value={form.responsible}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, responsible: e.target.value }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Einsatzverknüpfung</span>
                <select
                  className="w-full border rounded px-2 py-1 h-9"
                  value={form.relatedIncidentId}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, relatedIncidentId: e.target.value }))
                  }
                >
                  <option value="">Kein Einsatz</option>
                  {selectOptions.map((opt) => {
                    const value = String(opt.id);
                    const status = opt.statusName || opt.statusLabel || "";
                    const label = status ? `${status}: ${opt.label}` : opt.label;
                    return (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-gray-600">Notizen</span>
              <textarea
                className="w-full border rounded px-2 py-2 min-h-[160px]"
                value={form.desc}
                onChange={(e) => setForm((prev) => ({ ...prev, desc: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Frist/Kontrollzeitpunkt</span>
              <DatePicker
                selected={form.dueAt}
                onChange={(date) => setForm((prev) => ({ ...prev, dueAt: date }))}
                showTimeSelect
                dateFormat="dd.MM.yyyy HH:mm"
                timeIntervals={5}
                timeFormat="HH:mm"
                timeCaption="Zeit"
                locale="de"
                isClearable
                placeholderText="Kein Termin"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}