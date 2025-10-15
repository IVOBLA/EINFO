import React, { useEffect, useRef, useState } from "react";
import { usePlacesAutocomplete } from "../hooks/usePlacesAutocomplete";

export default function AddIncidentModal({ onClose, onCreate, types }) {
  const [title, setTitle] = useState("");
  const [typ, setTyp] = useState("");
  const [busy, setBusy] = useState(false);

  // ⬇️ Fokus auf Typ-Dropdown
  const typRef = useRef(null);

  const {
    query: ortQuery,
    setQuery: setOrtQuery,
    predictions,
    getDetailsByPlaceId,
    resetSession,
    loading,
    error,
  } = usePlacesAutocomplete({ country: "at", debounceMs: 300, minLength: 3 });

  useEffect(() => {
    // zuerst Typ fokussieren
    setTimeout(() => typRef.current?.focus(), 0);
  }, []);

  // Titel automatisch aus Typ (nur wenn Titel leer)
  useEffect(() => {
    const clean = (typ || "").replace(/^T\d+\s*,?\s*/i, "").trim();
    if (!title.trim() && clean) setTitle(clean);
  }, [typ]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e?.preventDefault?.();
    const cleanType = (typ || "").replace(/^T\d+\s*,?\s*/i, "").trim();
    const finalTitle = (title || cleanType).trim();
    if (!finalTitle) return;

    setBusy(true);
    try {
      await onCreate({ title: finalTitle, ort: (ortQuery || "").trim(), typ: (typ || "").trim() });
      setTitle("");
      setOrtQuery("");
      setTyp("");
      resetSession();
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  const pickOrtPrediction = async (p) => {
    try {
      const details = await getDetailsByPlaceId(p.place_id, [
        "formatted_address",
        "geometry",
        "address_components",
        "place_id",
      ]);
      const addr = details?.formatted_address || p.description;
      setOrtQuery(addr);
    } catch {
      setOrtQuery(p.description);
    } finally {
      resetSession();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-lg w-[520px] max-w-full p-4 space-y-3">
        <h3 className="text-lg font-semibold">Einsatz anlegen</h3>

        {/* ⬇️ Reihenfolge: Typ → Titel → Ort */}
        <div className="grid grid-cols-1 gap-2">
          {/* Typ */}
          <select
            ref={typRef}
            className="border rounded px-2 py-1"
            value={typ}
            onChange={(e) => setTyp(e.target.value)}
          >
            <option value="">— Typ auswählen —</option>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Titel */}
          <input
            className="border rounded px-2 py-1"
            placeholder="Titel (wird aus Typ übernommen)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Ort (nur Österreich) */}
          <div className="relative">
            <input
              className="border rounded px-2 py-1 w-full"
              placeholder="Ort (nur Österreich)"
              autoComplete="off"
              value={ortQuery}
              onChange={(e) => setOrtQuery(e.target.value)}
            />
            {loading && (
              <div className="absolute z-10 mt-1 text-xs text-gray-500 bg-white border rounded px-2 py-1">Suche…</div>
            )}
            {error && (
              <div className="absolute z-10 mt-1 text-xs text-red-600 bg-white border rounded px-2 py-1">
                Fehler: {String(error)}
              </div>
            )}
            {!!predictions.length && (
              <ul className="absolute z-10 mt-1 w-full max-h-52 overflow-auto bg-white border rounded shadow">
                {predictions.map((p) => (
                  <li
                    key={p.place_id}
                    className="px-2 py-1 hover:bg-gray-100 cursor-pointer text-sm"
                    onClick={() => pickOrtPrediction(p)}
                    title={p.description}
                  >
                    {p.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border" disabled={busy}>
            Abbrechen
          </button>
          <button className="px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-60" disabled={busy}>
            {busy ? "Anlegen…" : "Anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}
