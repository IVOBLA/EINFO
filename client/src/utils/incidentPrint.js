/* global google */

export function normalizeLatLng(location) {
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

export async function geocodeAddress(address) {
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

let incidentPrintFrame = null;

function ensureIncidentPrintFrame() {
  if (typeof document === "undefined") return null;
  if (incidentPrintFrame && incidentPrintFrame.isConnected) return incidentPrintFrame;
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);
  incidentPrintFrame = iframe;
  return iframe;
}

async function printHtmlViaFrame(html) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Drucken ist im aktuellen Kontext nicht verfügbar.");
  }

  const iframe = ensureIncidentPrintFrame();
  if (!iframe) {
    throw new Error("Druckfenster konnte nicht erstellt werden.");
  }

  const blob = new Blob([html], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      iframe.onload = null;
      iframe.onerror = null;
      URL.revokeObjectURL(blobUrl);
    };

    const fail = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) throw new Error("Druckfenster konnte nicht geladen werden.");

        const handleAfterPrint = () => {
          win.removeEventListener("afterprint", handleAfterPrint);
          finish();
        };
        win.addEventListener("afterprint", handleAfterPrint, { once: true });

        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch (err) {
            win.removeEventListener("afterprint", handleAfterPrint);
            fail(err);
          }
        }, 120);

        // Fallback: auch ohne afterprint nach einigen Sekunden aufräumen
        setTimeout(() => {
          if (!settled) finish();
        }, 4000);
      } catch (err) {
        fail(err);
      }
    };

    iframe.onerror = () => {
      fail(new Error("Druckinhalt konnte nicht geladen werden."));
    };

    iframe.src = blobUrl;
  });
}

function openIncidentPrintPopup(html) {
  const printWindow = window.open("", "_blank", "noopener=yes,noreferrer=yes");
  if (!printWindow) {
    return false;
  }
  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    return true;
  } catch (err) {
    try {
      printWindow.close();
    } catch {
      // ignore
    }
    return false;
  }
}

function buildIncidentPrintHtml({
  title,
  type,
  location,
  timestamp,
  infoRowsHtml,
  mapSrc,
  notesSection,
  autoPrint,
}) {
  const scriptBlock = autoPrint
    ? `
            <script>
              window.addEventListener('load', () => {
                setTimeout(() => { try { window.print(); } catch (e) {} }, 600);
              });
              window.addEventListener('afterprint', () => { try { window.close(); } catch (e) {} });
            </script>
          `
    : "";

  return `<!DOCTYPE html>
        <html lang="de">
          <head>
            <meta charSet="utf-8" />
            <title>Einsatzdruck – ${escapeHtml(title || type || "Neuer Einsatz")}</title>
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
            ${scriptBlock}
          </body>
        </html>`;
}

export async function openIncidentPrintWindow({
  title = "",
  type = "",
  locationLabel = "",
  notes = "",
  isArea = false,
  areaColor,
  areaLabel,
  coordinates = null,
}) {
  const cleanTitle = (title || "").trim();
  const cleanType = (type || "").trim();
  let location = (locationLabel || "").trim();
  const cleanNotes = (notes || "").trim();
  let coords = normalizeLatLng(coordinates);

  try {
    if (!coords && location) {
      const geo = await geocodeAddress(location);
      if (geo) {
        coords = { lat: geo.lat, lng: geo.lng };
        if (geo.formatted) location = geo.formatted;
      }
    }

    const mapQuery = coords ? `${coords.lat},${coords.lng}` : location || cleanTitle || cleanType || "Österreich";
    const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed&hl=de&z=15`;
    const mapLink = coords
      ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`
      : location
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
        : "";

    const timestamp = new Date().toLocaleString("de-DE");

    const infoRows = [
      { label: "Titel", value: cleanTitle || cleanType || "—" },
      { label: "Typ", value: cleanType || "—" },
      { label: "Ort", value: location || "—" },
      { label: "Stand", value: timestamp },
    ];

    if (isArea) {
      const colorValue = areaColor || "#2563eb";
      infoRows.push({ label: "Abschnitt", value: "Ja" });
      infoRows.push({
        label: "Abschnittsfarbe",
        value: `<span class="color-chip" style="background:${escapeHtml(colorValue)}"></span>${escapeHtml(colorValue)}`,
        raw: true,
      });
    } else if (areaLabel) {
      infoRows.push({ label: "Abschnitt", value: areaLabel });
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

    const htmlBase = buildIncidentPrintHtml({
      title: cleanTitle,
      type: cleanType,
      location,
      timestamp,
      infoRowsHtml,
      mapSrc,
      notesSection,
      autoPrint: false,
    });

    try {
      await printHtmlViaFrame(htmlBase);
    } catch (err) {
      const fallbackHtml = buildIncidentPrintHtml({
        title: cleanTitle,
        type: cleanType,
        location,
        timestamp,
        infoRowsHtml,
        mapSrc,
        notesSection,
        autoPrint: true,
      });
      const popupOk = typeof window !== "undefined" && openIncidentPrintPopup(fallbackHtml);
      if (!popupOk) {
        throw err;
      }
    }
  } catch (err) {
    throw err;
  }
}
