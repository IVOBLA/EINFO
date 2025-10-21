import React, { useEffect, useState } from "react";

export default function AufgAddModal({ open, onClose, onAdded }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [responsible, setResponsible] = useState("");
  const [desc, setDesc] = useState("");
  const [roleLabels, setRoleLabels] = useState([]);

  const [incidentId, setIncidentId] = useState("");
  const [openIncidents, setOpenIncidents] = useState([]);

  useEffect(() => {
    if (!open) return;
    setTitle(""); setType(""); setResponsible(""); setDesc("");
    setIncidentId("");
    (async () => {
      try {
        const r = await fetch("/api/board", { credentials: "include", cache: "no-store" }).then(res => res.json());
        const neu = (r?.columns?.["neu"]?.items || []);
        const wip = (r?.columns?.["in-bearbeitung"]?.items || []);
        const list = [...neu, ...wip].map(c => ({
          id: c.id,
          label: `${c.content || "Ohne Titel"}${c.ort ? " • " + c.ort : ""}`,
        }));
        setOpenIncidents(list);
      } catch { setOpenIncidents([]); }
    })();
	    // Rollen-Vorschläge (einmalig beim Öffnen)
    (async () => {
      try {
        const res = await fetch("/api/user/roles", { credentials: "include" });
        const data = await res.json();
        const arr = Array.isArray(data?.roles) ? data.roles : (Array.isArray(data) ? data : []);
        const labels = arr.map(r => (typeof r === "string" ? r : (r.label ?? r.id))).filter(Boolean);
        setRoleLabels([...new Set(labels)]);
      } catch {}
    })();
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    onAdded?.({
      title: title?.trim(),
      type: type?.trim(),
      responsible: responsible?.trim(),
      desc: desc?.trim(),
      relatedIncidentId: incidentId || null,
    });
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[840px] max-w-[90vw] rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Aufgabe anlegen</h2>
          <button className="text-gray-500 hover:text-gray-700" onClick={onClose} title="Schließen">✕</button>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 gap-3">
          <label className="block">
            <span className="text-xs text-gray-600">Titel</span>
            <input className="w-full border rounded px-2 py-1 h-9" value={title} onChange={e=>setTitle(e.target.value)} required />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Typ</span>
              <input className="w-full border rounded px-2 py-1 h-9" value={type} onChange={e=>setType(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Verantwortlich (Rolle)</span>
              <input list="responsible-suggestions" className="w-full border rounded px-2 py-1 h-9"
                     value={responsible} onChange={e=>setResponsible(e.target.value)} placeholder="z. B. S4" />
              <datalist id="responsible-suggestions">
               {roleLabels.map(lbl => <option key={lbl} value={lbl} />)}
              </datalist>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-gray-600">Einsatzbezug</span>
            <select className="w-full border rounded px-2 py-1 h-9" value={incidentId} onChange={e=>setIncidentId(e.target.value)}>
              <option value="">— keiner —</option>
              {openIncidents.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-gray-600">Notizen</span>
            <textarea className="w-full border rounded px-2 py-2 min-h-[120px]" value={desc} onChange={e=>setDesc(e.target.value)} />
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded border bg-white">Abbrechen</button>
            <button type="submit" className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white">Anlegen</button>
          </div>
        </form>
      </div>
    </div>
  );
}
