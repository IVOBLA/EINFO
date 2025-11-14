/* incidentPrint.js
 * Druck-HTML für Einsatzinformationen erzeugen (Screen/Print)
 * - On-Screen: Live-Karte via Google-Maps-iFrame
 * - Print/PDF: Statische Karte als <img> (Google Static Maps)
 * - Robust: Warten auf iFrame ODER Bild, bevor gedruckt wird
 */

// ------------------------------
// Hilfsfunktionen
// ------------------------------

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


 // Gleiche Key-Quelle wie usePlacesAutocomplete/places.js
 function getGmapsKeyFromDom() {
   const meta = document.querySelector('meta[name="google-places-key"]');
   const k = (window.GMAPS_API_KEY || meta?.content || "").trim();
   return k || undefined;
 }

export function normalizeLatLng(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const m = v.trim().match(/^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (typeof v === "object" && v) {
    if (typeof v.lat === "function" && typeof v.lng === "function") {
      const lat = Number(v.lat());
      const lng = Number(v.lng());
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    if (typeof v.toJSON === "function") {
      const json = v.toJSON();
      if (json && json !== v) {
        const normalized = normalizeLatLng(json);
        if (normalized) return normalized;
      }
    }
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

/**
 * Sehr einfacher Geocoder: nutzt (falls vorhanden) einen lokalen Endpoint /api/geocode?q=
 * Gibt { lat, lng, formatted } oder null zurück.
 */
export async function geocodeAddress(query) {
  try {
    const q = String(query || "").trim();
    if (!q) return null;
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = await r.json();
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, formatted: data?.formatted || q };
  } catch {
    return null;
  }
}

/**
 * Static-Map-URL (Google Static Maps). Funktioniert auch ohne API-Key (ggf. limitiert).
 */
function buildStaticMapUrl({ lat, lng, address, apiKey, zoom = 16, size = "800x400", scale = 2 }) {
   const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
   if (hasCoords) {
     // 1) Bevorzugt: Google Static Maps mit API-Key
     if (apiKey) {
       const base = "https://maps.googleapis.com/maps/api/staticmap";
       const q = `center=${lat},${lng}&zoom=${zoom}&size=${size}&scale=${scale}&markers=color:red|label:E|${lat},${lng}&maptype=roadmap`;
       return `${base}?${q}&key=${apiKey}`;
     }
    // 2) Fallback ohne Key: OSM Static (key-frei)
     //    docs: https://staticmap.openstreetmap.de/
     const osmSize = size.toLowerCase().replace("x", "x"); // "800x400"
     return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${osmSize}&markers=${lat},${lng},red-pushpin`;
   }
  // 3) Keine Koordinaten: wenn ein Google-Key vorhanden ist, per Adresse rendern
  if (apiKey && address) {
    const base = "https://maps.googleapis.com/maps/api/staticmap";
    const addr = encodeURIComponent(address);
    const q = `center=${addr}&zoom=${zoom}&size=${size}&scale=${scale}&markers=color:red|label:E|${addr}&maptype=roadmap`;
    return `${base}?${q}&key=${apiKey}`;
  }
  // 4) Sonst leer => ruft später Platzhalter auf
  return "";
 }

// ------------------------------
// HTML-Builder für Druckseite
// ------------------------------

/**
 * Erzeugt vollständiges HTML für den Einsatzdruck.
 * Zeigt iFrame am Bildschirm, <img> im Print/PDF (via @media print).
 */
function buildIncidentPrintHtml({
  title,
  type,
  location,
  timestamp,
  infoRowsHtml,
  mapSrc,
  staticMapUrl,
  notesSection,
  autoPrint,
}) {
  const scriptBlock = `
    <script>
      // Markiert, wenn Karte (iFrame ODER Bild) bereit ist – z.B. für automatischen Druck
      (function(){
        window.__incidentMapReady = false;

        function markReady(){
          if (window.__incidentMapReady) return;
          window.__incidentMapReady = true;
          try { document.body.setAttribute('data-map-ready', '1'); } catch(e){}
      if (${autoPrint ? "true" : "false"}) {
            // Nur EINMAL drucken
            if (!window.__alreadyPrinted) {
              window.__alreadyPrinted = true;
             setTimeout(() => { try { window.print(); } catch(e){} }, 100);
            }
          }
        }

        function watchIframeOrImage(){
          const frame = document.querySelector('.map-frame iframe');
          const img = document.querySelector('.map-frame img.map-static');

          // Wenn Bild vorhanden → auf Bild warten (für Print wichtig)
          if (img) {
            if (img.complete) {
              markReady();
            } else {
              img.addEventListener('load', markReady, { once: true });
              img.addEventListener('error', markReady, { once: true });
              setTimeout(markReady, 3000); // Fallback
            }
          }

          // Wenn iFrame vorhanden → auch auf iFrame warten (für Screen)
          if (frame) {
            const safeFinish = () => { markReady(); };
            try {
              frame.addEventListener('load', safeFinish, { once: true });
              frame.addEventListener('error', safeFinish, { once: true });
            } catch { /* ignore */ }

            // Cross-Origin iFrame? Dann lieber Timeout
            setTimeout(safeFinish, 3000);
          }

          // Wenn weder Bild noch iFrame: sofort ready
          if (!img && !frame) markReady();
        }

        if (document.readyState === 'complete') watchIframeOrImage();
        else window.addEventListener('load', watchIframeOrImage, { once: true });
      })();
    </script>
  `;

  return `<!DOCTYPE html>
  <html lang="de">
    <head>
      <meta charSet="utf-8" />
      <title>Einsatzdruck – ${escapeHtml(title || type || "Neuer Einsatz")}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        * { box-sizing: border-box; font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color:#0f172a; }
        body { margin:0; padding:0; background:#e2e8f0; }
        .sheet { max-width: 190mm; margin: 18px auto; background:#fff; border-radius:16px; padding:22px 26px;
                 box-shadow: 0 12px 32px rgba(15,23,42,0.18); }
        header { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
        header h1 { margin:0; font-size:20px; }
        header span { font-size:12px; color:#475569; }
        section { margin-top:20px; }
        .info { display:flex; flex-direction:column; gap:10px; }
        .row { display:flex; gap:14px; }
        .label { width:120px; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:#475569; }
        .value { flex:1; font-size:14px; line-height:1.4; }
        .map-section h2, .notes h2 { font-size:16px; margin:0 0 10px; }
        .map-frame { width:100%; aspect-ratio: 4 / 3; border-radius:14px; overflow:hidden; border:1px solid #cbd5e1; background:#f8fafc; }
        .map-frame iframe { width:100%; height:100%; border:0; display:block; }
        .map-frame img.map-static { width:100%; height:100%; object-fit:cover; display:none; }
        .notes div { font-size:14px; line-height:1.5; white-space:pre-wrap; }
        footer { margin-top:24px; font-size:11px; color:#64748b; text-align:right; }

        @media print {
          body { background:#fff; }
          .sheet { box-shadow:none; margin:0; max-width:unset; width:100%; border-radius:0; }
          @page { size: A4; margin: 12mm; }
          .map-frame iframe { display:none !important; }
          .map-frame img.map-static { display:block !important; }
        }
      </style>
    </head>
    <body>
      <div class="sheet">
        <header>
          <h1>Einsatzinformation</h1>
          <span>Druck erstellt am ${escapeHtml(timestamp || "")}</span>
        </header>

        <section class="info">
          ${infoRowsHtml || ""}
        </section>

        <section class="map-section">
          <h2>Einsatzkarte</h2>
          <div class="map-frame">
            <iframe src="${mapSrc}" title="Einsatzkarte" loading="lazy"></iframe>
            <img class="map-static" alt="Einsatzkarte" src="${staticMapUrl}" referrerpolicy="no-referrer" />
          </div>
        </section>

        ${notesSection || ""}

        <footer>Einsatzstellen-Übersicht</footer>
      </div>
      ${scriptBlock}
    </body>
  </html>`;
}

// ------------------------------
// Öffentliche API
// ------------------------------

export async function prepareIncidentPrintDocument({
  title = "",
  type = "",
  locationLabel = "",
  notes = "",
  isArea = false,
  areaColor,
  areaLabel,
  coordinates = null,
}) {
  const now = new Date();
  const timestamp = now.toLocaleString("de-AT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const cleanTitle = (title || "").trim();
  const cleanType = (type || "").trim();
  let location = (locationLabel || "").trim();

  let coords = normalizeLatLng(coordinates);
  try {
    if (!coords && location) {
      const geo = await geocodeAddress(location);
      if (geo) {
        coords = { lat: geo.lat, lng: geo.lng };
        if (geo.formatted) location = geo.formatted;
      }
    }
  } catch {
    // Geocode-Fehler ignorieren, wir verwenden dann die Adresse im iFrame/StaticMap
  }

  const mapQuery = coords
    ? `${coords.lat},${coords.lng}`
    : location || cleanTitle || cleanType || "Österreich";
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed&hl=de&z=15`;

  let staticMapUrl = buildStaticMapUrl({
    lat: coords?.lat,
    lng: coords?.lng,
    address: location || cleanTitle || cleanType || "Österreich",
    // Wichtig: denselben Key verwenden wie Places (App.jsx/usePlacesAutocomplete)
    apiKey: getGmapsKeyFromDom(),
  });
  if (!staticMapUrl) {
    const txt = encodeURIComponent("Keine Karte verfügbar");
    staticMapUrl = `https://placehold.co/800x400?text=${txt}`;
  }

  const infoRowsHtml = [
    ["Einsatz", cleanTitle || cleanType || "—"],
    ["Art", cleanType || "—"],
    ["Ort", location || "—"],
    ...(isArea
      ? [[
          "Bereich",
          `${escapeHtml(areaLabel || "Bereich")} ${
            areaColor ? `<span class="color-chip" style="background:${escapeHtml(areaColor)}"></span>` : ""
          }`,
        ]]
      : []),
  ]
    .map(
      ([label, value]) => `
      <div class="row">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${typeof value === "string" ? value : value ?? "—"}</div>
      </div>`
    )
    .join("");

  const notesSection = notes
    ? `<section class="notes"><h2>Hinweise</h2><div>${escapeHtml(notes)}</div></section>`
    : "";

  const html = buildIncidentPrintHtml({
    title: cleanTitle,
    type: cleanType,
    location,
    timestamp,
    infoRowsHtml,
    mapSrc,
    staticMapUrl,
    notesSection,
    autoPrint: false,
  });

  return {
    html,
    title: cleanTitle,
    type: cleanType,
    location,
    timestamp,
    mapSrc,
    staticMapUrl,
    notes,
    isArea: !!isArea,
    infoRowsHtml,
    notesSection,
  };
}

/**
 * Öffnet/Erzeugt die Druckansicht. Optional: automatischer Druck im Popup-Fallback.
 * Erwartet Felder:
 *  - title, type, locationLabel, notes
 *  - coordinates (z. B. "46.7,14.1" oder {lat,lng})
 *  - incidentId (nur relevant, wenn du separat einen Server-PDF-Export triggern willst)
 */
export async function openIncidentPrintWindow({
  title = "",
  type = "",
  locationLabel = "",
  notes = "",
  isArea = false,
  areaColor,
  areaLabel,
  coordinates = null,
  incidentId,
}) {
  const payload = await prepareIncidentPrintDocument({
    title,
    type,
    locationLabel,
    notes,
    isArea,
    areaColor,
    areaLabel,
    coordinates,
  });
  const {
    html: htmlBase,
    title: cleanTitle,
    type: cleanType,
    location,
    timestamp,
    mapSrc,
    staticMapUrl,
    infoRowsHtml,
    notesSection,
  } = payload;

  // 7) Versuch: In verstecktem iFrame anzeigen (für „Speichern“/„Drucken“ im selben Tab)
  try {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) throw new Error("Kein iFrame-Dokument verfügbar.");
    doc.open();
    doc.write(htmlBase);
    doc.close();
	
	
// Einmal-Sperre: nur EIN Druck
    const w = iframe.contentWindow;
    let printed = false;
    const startPrint = () => {
      if (printed) return;
      printed = true;
      try { w.focus(); } catch {}
      try { w.print(); } catch {}
    };
    const checkReady = () => {
      if (printed) return;
      try {
        if (!w || !w.document) return void setTimeout(checkReady, 150);
        const ready =
          w.__incidentMapReady === true ||
          (w.document.body && w.document.body.getAttribute("data-map-ready") === "1");
        if (ready) return startPrint();
      } catch {}
      setTimeout(checkReady, 150);
    };
    try { iframe.addEventListener("load", () => setTimeout(checkReady, 50), { once: true }); } catch {}
    setTimeout(checkReady, 200);
	
    return;
  } catch (err) {
    // 8) Fallback: Popup-Fenster mit Auto-Print
    const w = window.open("", "_blank", "noopener,noreferrer,width=980,height=1200");
    const fallbackHtml = buildIncidentPrintHtml({
      title: cleanTitle,
      type: cleanType,
      location,
      timestamp,
      infoRowsHtml,
      mapSrc,
      staticMapUrl,
      notesSection,
      autoPrint: true,
    });
    try {
      if (w && w.document) {
        w.document.open();
        w.document.write(fallbackHtml);
        w.document.close();
      } else {
        // Wenn Popup blockiert: letzte Eskalation – neues Tab mit data:URL
        const blob = new Blob([fallbackHtml], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.location.href = url;
      }
    } catch {
      // Ignorieren – der Benutzer kann trotzdem speichern/drucken
    }
  }
}

// Optional: Default-Export für bequemen Import
export default {
  prepareIncidentPrintDocument,
  openIncidentPrintWindow,
  buildIncidentPrintHtml,
  buildStaticMapUrl,
  geocodeAddress,
  normalizeLatLng,
  escapeHtml,
};
