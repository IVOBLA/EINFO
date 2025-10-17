import React, { useEffect, useMemo, useState } from "react";

export default function AufgInfoModal({ open, item, onClose, onSave, canEdit = false }) {
  const it = item || {};
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    title: it.title || "",
    type: it.type || "",
    responsible: it.responsible || "",
    desc: it.desc || "",
  });

  useEffect(() => {
    if (open) {
      setEdit(false);
      setForm({
        title: it.title || "",
        type: it.type || "",
        responsible: it.responsible || "",
        desc: it.desc || "",
      });
    }
  }, [open, it?.id]);

 

  const changed = useMemo(() => {
    return (
      (form.title ?? "") !== (it.title ?? "") ||
      (form.type ?? "") !== (it.type ?? "") ||
      (form.responsible ?? "") !== (it.responsible ?? "") ||
      (form.desc ?? "") !== (it.desc ?? "")
    );
  }, [form, it]);
  
   if (!open) return null;

  const handleSave = async () => {
    if (!canEdit) return; // safety
    if (!changed) {
      setEdit(false);
      return;
    }
    const patch = {
      id: it.id,
      title: form.title,
      type: form.type,
      responsible: form.responsible,
      desc: form.desc,
      updatedAt: Date.now(),
    };
    await onSave?.(patch); // Parent persistiert (und CSV-Log am Server)
    setEdit(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl p-4 w-[840px] space-y-3 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-base font-semibold">Details</div>
          <div className="flex items-center gap-2">
            {!edit ? (
              canEdit ? (
                <button
                  onClick={() => setEdit(true)}
                  className="text-sm px-2 py-1 rounded-lg border"
                  title="Bearbeiten"
                >
                  Bearbeiten
                </button>
              ) : null
            ) : (
              <>
                <button
                  onClick={() => setEdit(false)}
                  className="text-sm px-2 py-1 rounded-lg border"
                  title="Abbrechen"
                >
                  Abbrechen
                </button>
                <button
                  onClick={handleSave}
                  disabled={!changed || !canEdit}
                  className="text-sm px-2 py-1 rounded-lg border border-emerald-400 text-emerald-700 disabled:opacity-50"
                  title={canEdit ? "Änderungen speichern" : "Keine Berechtigung"}
                >
                  Speichern
                </button>
              </>
            )}
            <button onClick={onClose} className="text-sm px-2 py-1 rounded-lg border">
              Schließen
            </button>
          </div>
        </div>

        {!edit ? (
          <div className="text-sm">
            <div className="mb-1">
              <span className="font-semibold">Titel:</span> {it.title || "–"}
            </div>
            <div className="mb-1">
              <span className="font-semibold">Typ:</span> {it.type || "–"}
            </div>
            <div className="mb-1">
              <span className="font-semibold">Verantwortlich:</span> {it.responsible || "–"}
            </div>
            {it.desc ? (
              <div className="mb-1">
                <span className="font-semibold">Notizen:</span>{" "}
                <span className="whitespace-pre-wrap">{it.desc}</span>
              </div>
            ) : null}
            {it.createdAt ? (
              <div className="mb-1 text-xs text-slate-500">
                erstellt: {new Date(it.createdAt).toLocaleString()}
              </div>
            ) : null}
            {it.updatedAt ? (
              <div className="mb-1 text-xs text-slate-500">
                aktual.: {new Date(it.updatedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm space-y-2">
            <label className="block">
              <span className="text-xs text-gray-500">Titel</span>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full mt-0.5 border rounded px-2 py-1"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Typ</span>
              <input
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full mt-0.5 border rounded px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Verantwortlich</span>
              <input
                value={form.responsible}
                onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))}
                className="w-full mt-0.5 border rounded px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Notizen</span>
              <textarea
                value={form.desc}
                onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
                rows={4}
                className="w-full mt-0.5 border rounded px-2 py-1"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
