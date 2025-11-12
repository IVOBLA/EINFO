import React, { useEffect, useRef, useState } from "react";
import { usePlacesAutocomplete } from "../hooks/usePlacesAutocomplete";
import { geocodeAddress, normalizeLatLng, openIncidentPrintWindow } from "../utils/incidentPrint";

export default function AddIncidentModal({ onClose, onCreate, types, areaOptions = [] }) {
  const DEFAULT_AREA_COLOR = "#2563eb";
  const [title, setTitle] = useState("");
  const [typ, setTyp] = useState("");
  const [busy, setBusy] = useState(false);
  const [isArea, setIsArea] = useState(false);
  const [areaCardId, setAreaCardId] = useState("");
  const [areaColor, setAreaColor] = useState(DEFAULT_AREA_COLOR);
  const [notes, setNotes] = useState("");
  const [printing, setPrinting] = useState(false);

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
    clearPredictions,
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

  const placeDetailsRef = useRef(null);

  useEffect(() => {
    if (isArea) {
      setAreaCardId("");
      setAreaColor((prev) => prev || DEFAULT_AREA_COLOR);
    }
  }, [isArea]);

  const submit = async (e) => {
    e?.preventDefault?.();
    const cleanType = (typ || "").replace(/^T\d+\s*,?\s*/i, "").trim();
    const finalTitle = (title || cleanType).trim();
    if (!finalTitle) return;

    setBusy(true);
    try {
      let coords = null;
      let locationLabel = (ortQuery || "").trim();

      const stored = placeDetailsRef.current;
      if (stored) {
        const extracted = normalizeLatLng(stored.geometry?.location);
        if (extracted) coords = extracted;
        const formatted = stored.formatted_address || stored.name || "";
        if (formatted) locationLabel = formatted;
      }

      if (!coords && locationLabel) {
        const geo = await geocodeAddress(locationLabel);
        if (geo) {
          coords = { lat: geo.lat, lng: geo.lng };
          if (geo.formatted) locationLabel = geo.formatted;
        }
      }

      const cleanNotes = (notes || "").trim();

      await onCreate({
        title: finalTitle,
        ort: (ortQuery || "").trim(),
        typ: (typ || "").trim(),
        isArea,
        areaCardId: isArea ? null : areaCardId || null,
        areaColor: isArea ? areaColor : undefined,
        coordinates: coords,
        location: locationLabel,
        description: cleanNotes,
      });
      setTitle("");
      setOrtQuery("");
      setTyp("");
      setIsArea(false);
      setAreaCardId("");
      setAreaColor(DEFAULT_AREA_COLOR);
      setNotes("");
      placeDetailsRef.current = null;
      resetSession();
      clearPredictions();
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
      placeDetailsRef.current = details || null;
    } catch {
      placeDetailsRef.current = null;
      setOrtQuery(p.description);
    } finally {
      resetSession();
      clearPredictions();
    }
  };

  const handlePrint = async () => {
    if (printing) return;

    const cleanType = (typ || "").replace(/^T\d+\s*,?\s*/i, "").trim();
    const finalTitle = (title || cleanType).trim();
    const enteredOrt = (ortQuery || "").trim();
    const cleanNotes = (notes || "").trim();
    const selectedArea = areaOptions.find((opt) => String(opt.id) === String(areaCardId));

    try {
      setPrinting(true);

      let locationLabel = enteredOrt;
      let coords = null;

      const stored = placeDetailsRef.current;
      if (stored) {
        const extracted = normalizeLatLng(stored.geometry?.location);
        if (extracted) coords = extracted;
        const formatted = stored.formatted_address || stored.name || "";
        if (formatted) locationLabel = formatted;
      }

      await openIncidentPrintWindow({
        title: finalTitle,
        type: cleanType,
        locationLabel,
        notes: cleanNotes,
        isArea,
        areaColor: isArea ? areaColor : undefined,
        areaLabel: !isArea && selectedArea ? selectedArea.label : undefined,
        coordinates: coords,
        incidentId: finalTitle || cleanType || undefined,
      });
    } catch (e) {
      const message = e?.message || e || "Unbekannter Fehler";
      alert(`Drucken fehlgeschlagen: ${message}`);
    } finally {
      setPrinting(false);
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
            {(types || []).map((t) => (
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
              onChange={(e) => {
                placeDetailsRef.current = null;
                setOrtQuery(e.target.value);
              }}
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

          {/* Notiz */}
          <label className="text-sm font-medium text-gray-700">
            Notiz
            <textarea
              className="mt-1 w-full border rounded px-2 py-1 resize-y min-h-[90px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </label>

          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isArea}
                onChange={(e) => setIsArea(e.target.checked)}
                disabled={busy}
              />
              Abschnitt
            </label>
            {!isArea && (
              <select
                className="border rounded px-2 py-1 text-sm"
                value={areaCardId}
                onChange={(e) => setAreaCardId(e.target.value)}
                disabled={busy || areaOptions.length === 0}
              >
                <option value="">— Abschnitt auswählen —</option>
                {areaOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>
          {isArea && (
            <div className="flex items-center justify-between gap-3 text-sm text-gray-700">
              <span>Abschnittsfarbe</span>
              <input
                type="color"
                className="h-9 w-16 border rounded cursor-pointer"
                value={areaColor}
                onChange={(e) => setAreaColor(e.target.value)}
                disabled={busy}
              />
            </div>
          )}
          {!isArea && areaOptions.length === 0 && (
            <p className="text-xs text-gray-500">Noch keine Abschnitte vorhanden.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-gray-500">Informationen und Karte auf A4 drucken</span>
          <button
            type="button"
            onClick={handlePrint}
            className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            disabled={busy || printing}
          >
            {printing ? "Drucken…" : "Drucken"}
          </button>
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
