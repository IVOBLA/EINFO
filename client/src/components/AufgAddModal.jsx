// client/src/components/AufgAddModal.jsx
import React, { useEffect, useState } from "react";

export default function AufgAddModal({ open, onClose, onAdded }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [responsible, setResponsible] = useState("");
  const [desc, setDesc] = useState("");

  // Vorschläge aus User_roles.json (Labels)
  const [roleLabels, setRoleLabels] = useState([]);

  useEffect(() => {
    if (open) {
      setTitle("");
      setType("");
      setResponsible("");
      setDesc("");
    }
  }, [open]);

  // Vorschläge beim Öffnen laden (einmalig pro Session)
  useEffect(() => {
    if (!open || roleLabels.length) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/user/roles", {
          credentials: "include",
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const rolesArr = Array.isArray(data?.roles) ? data.roles
          : (Array.isArray(data) ? data : []);
        const labels = rolesArr
          .map(r => (typeof r === "string" ? r : (r.label ?? r.id)))
          .filter(Boolean);
        setRoleLabels(Array.from(new Set(labels)));
      } catch (_) {
        // still & silent – Vorschläge sind optional
      }
    })();
    return () => ac.abort();
  }, [open, roleLabels.length]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    onAdded?.({ title, type, responsible, desc }); // nur Daten nach oben
    onClose?.();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-xl p-4 w-[840px] space-y-3">
        <h2 className="font-semibold text-lg">Neue Aufgabe</h2>

        <label className="block">
          <span className="text-xs text-gray-600">Titel</span>
          <input
            value={title}
            onChange={(e)=>setTitle(e.target.value)}
            className="w-full border rounded px-2 py-1"
            required
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-600">Typ</span>
          <input
            value={type}
            onChange={(e)=>setType(e.target.value)}
            className="w-full border rounded px-2 py-1"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-600">Verantwortlich</span>
          <input
            value={responsible}
            onChange={(e)=>setResponsible(e.target.value)}
            className="w-full border rounded px-2 py-1"
            placeholder={roleLabels.length ? "z. B. Leiter Stab, S2 …" : undefined}
            list="responsible-suggestions"
          />
          {/* HTML5-Datalist für Vorschläge aus Rollen-Labels */}
          <datalist id="responsible-suggestions">
            {roleLabels.map(lbl => (
              <option key={lbl} value={lbl} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="text-xs text-gray-600">Notiz</span>
          <textarea
            value={desc}
            onChange={(e)=>setDesc(e.target.value)}
            className="w-full border rounded px-2 py-1 min-h-[120px]"
          />
        </label>

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded">Abbrechen</button>
          <button type="submit" className="px-3 py-2 bg-sky-600 text-white rounded">Speichern</button>
        </div>
      </form>
    </div>
  );
}
