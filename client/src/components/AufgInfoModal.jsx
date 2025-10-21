import React, { useEffect, useMemo, useState } from "react";

export default function AufgInfoModal({ open, item, onClose, onSave, canEdit }) {
  const it = item || {};
  const [edit, setEdit] = useState(false);

  const [title, setTitle] = useState(it.title || "");
  const [type, setType] = useState(it.type || "");
  const [responsible, setResponsible] = useState(it.responsible || "");
  const [desc, setDesc] = useState(it.desc || "");

  const [incidentId, setIncidentId] = useState(it.relatedIncidentId || "");
  const [openIncidents, setOpenIncidents] = useState([]);

  useEffect(() => {
    if (!open) return;
    setEdit(false);
    setTitle(it.title || "");
    setType(it.type || "");
    setResponsible(it.responsible || "");
    setDesc(it.desc || "");
    setIncidentId(it.relatedIncidentId || "");

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
  }, [open, it?.id]);

  const save = async () => {
    await onSave?.({
      id: it.id,
      title: title?.trim(),
      type: type?.trim(),
      responsible: responsible?.trim(),
      desc: desc?.trim(),
      relatedIncidentId: incidentId || null,
    });
    setEdit(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[840px] max-w-[90vw] rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Aufgabe</h2>
          <div className="flex items-center gap-2">
            {!edit ? (
              canEdit && <button onClick={() => setEdit(true)} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50">Bearbeiten</button>
            ) : (
              <>
                <button onClick={() => setEdit(false)} className="px-3 py-1.5 rounded border bg-white">Abbrechen</button>
                <button onClick={save} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white">Speichern</button>
              </>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700" title="Schließen">✕</button>
          </div>
        </div>

        {/* Anzeige-Modus */}
        {!edit ? (
          <div className="grid grid-cols-1 gap-3">
            <div><div className="text-xs text-gray-600">Titel</div><div className="font-medium">{it.title || "—"}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-gray-600">Typ</div><div>{it.type || "—"}</div></div>
              <div><div className="text-xs text-gray-600">Verantwortlich</div><div>{it.responsible || "—"}</div></div>
            </div>

            {/* Ursprung / Bezug */}
            {it.originProtocolNr ? (
              <div className="text-xs">
                Ursprung:{" "}
<button
  className="text-blue-700 hover:underline"
  onClick={() => { window.location.assign(`/protokoll#/protokoll/edit/${it.originProtocolNr}`); }}
  title={`Protokoll #${it.originProtocolNr} öffnen`}
>
  Prot. #{it.originProtocolNr}
</button>
              </div>
            ) : null}
            {it.relatedIncidentId ? (
              <div className="text-xs">
                Bezug:{" "}
                <a href="/" className="text-blue-700 hover:underline" title="Einsatz im Board öffnen">Einsatz öffnen</a>
              </div>
            ) : null}

            <div>
              <div className="text-xs text-gray-600">Notizen</div>
              <div className="whitespace-pre-wrap">{it.desc || "—"}</div>
            </div>
          </div>
        ) : (
          // Bearbeiten
          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Titel</span>
              <input className="w-full border rounded px-2 py-1 h-9" value={title} onChange={e=>setTitle(e.target.value)} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-600">Typ</span>
                <input className="w-full border rounded px-2 py-1 h-9" value={type} onChange={e=>setType(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Verantwortlich (Rolle)</span>
                <input className="w-full border rounded px-2 py-1 h-9" value={responsible} onChange={e=>setResponsible(e.target.value)} />
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
              <textarea className="w-full border rounded px-2 py-2 min-h-[160px]" value={desc} onChange={e=>setDesc(e.target.value)} />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
