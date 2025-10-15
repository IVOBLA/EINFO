// client/src/components/AufgAddModal.jsx
import React, { useState, useEffect } from "react";

const RESPONSIBLES = ["EL", "LtStb", "S1", "S2", "S3", "S4", "S5", "MS"];

export default function AufgAddModal({ open, onClose, onAdded }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [responsible, setResponsible] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setTitle(""); setType(""); setResponsible(""); setDesc(""); setError(""); }
  }, [open]);

  if (!open) return null;

  async function createItem() {
    if (!title.trim()) return;
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/aufgaben", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type, responsible, desc }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { item: created } = await res.json();
      onAdded?.({
        id: created?.id || `${Date.now()}`,
        title, type, responsible, desc, status: "Neu", createdAt: Date.now(),
      });
      onClose?.();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="text-base font-semibold mb-3">Neue Aufgabe</div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1">Titel</label>
            <input className="w-full px-3 py-2 rounded-xl border" value={title} onChange={e=>setTitle(e.target.value)} autoFocus />
          </div>

          <div>
            <label className="block text-xs mb-1">Typ</label>
            <input className="w-full px-3 py-2 rounded-xl border" value={type} onChange={e=>setType(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs mb-1">Verantwortlich</label>
            <select className="w-full px-3 py-2 rounded-xl border bg-white" value={responsible} onChange={e=>setResponsible(e.target.value)}>
              <option value="">— auswählen —</option>
              {RESPONSIBLES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs mb-1">Notizen</label>
            <textarea className="w-full min-h-[90px] px-3 py-2 rounded-xl border resize-y" value={desc} onChange={e=>setDesc(e.target.value)} />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="mt-3 flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-2 text-sm rounded-xl border">Abbrechen</button>
            <button onClick={createItem} disabled={saving || !title.trim()} className="px-3 py-2 text-sm rounded-xl bg-sky-600 text-white disabled:opacity-60">
              {saving ? "Speichere…" : "Speichern"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
