/* global google */
import React, { useEffect, useRef, useState } from "react";
import { usePlacesAutocomplete } from "../hooks/usePlacesAutocomplete";

function normalizeLatLng(location) {
  if (!location) return null;
  try {
    const lat = typeof location.lat === "function" ? location.lat() : Number(location.lat);
    const lng = typeof location.lng === "function" ? location.lng() : Number(location.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch {
    // ignore
  }
  return null;
}

async function geocodeAddress(address) {
  const clean = (address || "").trim();
  if (!clean) return null;
  if (!window.google?.maps?.Geocoder) return null;
  const geocoder = new google.maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address: clean, region: "AT" }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const first = results[0];
        const coords = normalizeLatLng(first.geometry?.location);
        if (coords) {
          resolve({
            ...coords,
            formatted: first.formatted_address || clean,
            placeId: first.place_id || null,
          });
          return;
        }
      }
      resolve(null);
    });
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMultiline(str) {
  return escapeHtml(str).replace(/\r?\n/g, "<br />");
}

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

    let printWindow = null;
    try {
      setPrinting(true);

      let coords = null;
      let locationLabel = enteredOrt;

      const stored = placeDetailsRef.current;
      if (stored) {
        const extracted = normalizeLatLng(stored.geometry?.location);
        if (extracted) coords = extracted;
        const formatted = stored.formatted_address || stored.name || "";
        if (formatted) locationLabel = formatted;
      }

      printWindow = window.open("", "_blank", "noopener=yes,noreferrer=yes");
      if (!printWindow) {
        alert("Pop-up zum Drucken konnte nicht geöffnet werden. Bitte Pop-up-Blocker prüfen.");
        return;
      }

      try {
        printWindow.document.open();
        printWindow.document.write(`<!DOCTYPE html><html lang="de"><head><title>Druck wird vorbereitet…</title></head><body><p style="font-family: sans-serif; padding: 16px;">Druck wird vorbereitet…</p></body></html>`);
        printWindow.document.close();
      } catch {}

      if (!coords && locationLabel) {
        const geo = await geocodeAddress(locationLabel);
        if (geo) {
          coords = { lat: geo.lat, lng: geo.lng };
          if (geo.formatted) locationLabel = geo.formatted;
        }
      }

      const mapQuery = coords
        ? `${coords.lat},${coords.lng}`
        : locationLabel || finalTitle || cleanType || "Österreich";
      const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed&hl=de&z=15`;
      const mapLink = coords
        ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;

      const now = new Date();
      const timestamp = now.toLocaleString("de-DE");

      const infoRows = [
        { label: "Titel", value: finalTitle || cleanType || "—" },
        { label: "Typ", value: cleanType || "—" },
        { label: "Ort", value: locationLabel || "—" },
        { label: "Stand", value: timestamp },
      ];

      if (isArea) {
        infoRows.push({ label: "Abschnitt", value: "Ja" });
        infoRows.push({
          label: "Abschnittsfarbe",
          value: `<span class="color-chip" style="background:${escapeHtml(areaColor || "#2563eb")}"></span>${escapeHtml(
            areaColor || "#2563eb"
          )}`,
          raw: true,
        });
      } else if (selectedArea) {
        infoRows.push({ label: "Abschnitt", value: selectedArea.label });
      }

      if (mapLink) {
        const safeLink = escapeHtml(mapLink);
        infoRows.push({
          label: "Google Maps",
          value: `<a href="${safeLink}" target="_blank" rel="noreferrer">${safeLink}</a>`,
          raw: true,
        });
      }

      const infoRowsHtml = infoRows
        .map(
          (row) => `
            <div class="row">
              <div class="label">${escapeHtml(row.label)}</div>
              <div class="value">${row.raw ? row.value : escapeHtml(row.value)}</div>
            </div>
          `
        )
        .join("");

      const notesSection = cleanNotes
        ? `
            <section class="notes">
              <h2>Notizen</h2>
              <div>${formatMultiline(cleanNotes)}</div>
            </section>
          `
        : "";

      const html = `<!DOCTYPE html>
        <html lang="de">
          <head>
            <meta charSet="utf-8" />
            <title>Einsatzdruck – ${escapeHtml(finalTitle || cleanType || "Neuer Einsatz")}</title>
            <style>
              * { box-sizing: border-box; font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color: #0f172a; }
              body { margin: 0; padding: 0; background: #e2e8f0; }
              .sheet { max-width: 190mm; margin: 18px auto; background: white; border-radius: 16px; padding: 22px 26px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18); }
              header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
              header h1 { margin: 0; font-size: 20px; }
              header span { font-size: 12px; color: #475569; }
              section { margin-top: 20px; }
              .info { display: flex; flex-direction: column; gap: 10px; }
              .row { display: flex; gap: 14px; }
              .label { width: 120px; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
              .value { flex: 1; font-size: 14px; line-height: 1.4; }
              .color-chip { display: inline-block; width: 14px; height: 14px; border-radius: 4px; margin-right: 6px; vertical-align: middle; border: 1px solid rgba(15, 23, 42, 0.2); }
              .map-section h2, .notes h2 { font-size: 16px; margin: 0 0 10px; }
              .map-frame { width: 100%; aspect-ratio: 4 / 3; border-radius: 14px; overflow: hidden; border: 1px solid #cbd5f5; background: #f8fafc; }
              .map-frame iframe { width: 100%; height: 100%; border: 0; }
              .notes div { font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
              footer { margin-top: 24px; font-size: 11px; color: #64748b; text-align: right; }
              @media print {
                body { background: white; }
                .sheet { box-shadow: none; margin: 0; max-width: unset; width: 100%; border-radius: 0; }
                @page { size: A4; margin: 12mm; }
              }
            </style>
            <script>
              window.addEventListener('load', () => {
                setTimeout(() => { try { window.print(); } catch (e) {} }, 600);
              });
              window.addEventListener('afterprint', () => { try { window.close(); } catch (e) {} });
            </script>
          </head>
          <body>
            <div class="sheet">
              <header>
                <h1>Einsatzinformation</h1>
                <span>Druck erstellt am ${escapeHtml(timestamp)}</span>
              </header>
              <section class="info">
                ${infoRowsHtml}
              </section>
              <section class="map-section">
                <h2>Einsatzkarte</h2>
                <div class="map-frame">
                  <iframe src="${mapSrc}" title="Einsatzkarte" loading="lazy"></iframe>
                </div>
              </section>
              ${notesSection}
              <footer>Einsatzstellen-Übersicht</footer>
            </div>
          </body>
        </html>`;

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (e) {
      if (printWindow && !printWindow.closed) {
        try { printWindow.close(); } catch {}
      }
      alert(`Drucken fehlgeschlagen: ${e?.message || e || "Unbekannter Fehler"}`);
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
