import React, { useEffect, useMemo, useRef, useState } from "react";
import { setVehiclePosition, resetVehiclePosition } from "../api";

/* ---------------- Geo Utils ---------------- */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1));
}

// Offset (Meter/Bearing) -> Lat/Lng
function offsetLatLng(origin, meters, bearingDeg) {
  const R = 6371000; // m
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const dr = meters / R;

  const lat2 =
    (Math.asin(
      Math.sin(lat1) * Math.cos(dr) +
        Math.cos(lat1) * Math.sin(dr) * Math.cos(br)
    ) *
      180) /
    Math.PI;

  const lng2 =
    ((lng1 +
      Math.atan2(
        Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
        Math.cos(dr) - Math.sin(lat1) * Math.sin((lat2 * Math.PI) / 180)
      )) *
      180) /
    Math.PI;

  return { lat: lat2, lng: lng2 };
}

/* ---------------- Helpers ---------------- */
async function geocode(address) {
  if (!address || !window.google?.maps?.Geocoder) return null;
  const geocoder = new window.google.maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address, region: "AT" }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        resolve({
          lat: results[0].geometry.location.lat(),
          lng: results[0].geometry.location.lng(),
          formatted: results[0].formatted_address || address,
        });
      } else resolve(null);
    });
  });
}

const norm = (s) => String(s || "").trim().toLowerCase();


async function loadMergedVehicles() {
  try {
    const r = await fetch("/api/vehicles", { cache: "no-store", credentials: "include" });
    if (!r.ok) return [];
    return r.json();
  } catch {
    return [];
  }
}

async function loadGpsList() {
  try {
    const res = await fetch("/api/gps", { cache: "no-store", credentials: "include" });
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("GPS fetch failed:", e);
  }
  return [];
}

function buildIncidentHtml(card) {
  const typ = card?.typ || card?.type || "—";
  const alarmzeit = card?.timestamp
    ? new Date(card.timestamp).toLocaleString("de-AT", { hour12: false })
    : "—";
  const alerted = card?.alerted ?? "—";
  const desc = card?.description ?? "—";
  const addr = card?.additionalAddressInfo || card?.ort || "—";
  const locParts = [];
  if (card?.location) locParts.push(String(card.location));
  const latOk = Number.isFinite(card?.latitude);
  const lngOk = Number.isFinite(card?.longitude);
  if (latOk && lngOk) locParts.push(`(${card.latitude}, ${card.longitude})`);
  const loc = locParts.length ? locParts.join(" ") : "—";

  return `
    <div style="min-width:280px">
      <div style="font-weight:700;margin-bottom:4px">${card?.content || "Einsatz"}</div>
      <div><b>Typ:</b> ${typ}</div>
      <div><b>Alarmzeit:</b> ${alarmzeit}</div>
      <div><b>Alarmiert:</b> ${alerted}</div>
      <div><b>Beschreibung:</b> ${desc}</div>
      <div><b>Adresse:</b> ${addr}</div>
      <div><b>Location:</b> ${loc}</div>
    </div>
  `;
}

/* ----- Lokale Fahrzeug-Icons (doppelte Größe) ----- */
const ICON_SIZE = 44; // 2x
const ICON_RED_URL = "/vehicle-red.gif";
const ICON_GRAY_URL = "/vehicle-gray.png";
const ICON_DRIVE_URL = "/vehicle-drive.gif"; // Fahr-Icon, wenn >100 m vom Einsatz weg

/* ---------------- Component ---------------- */
export function MapModal({ context, address, onClose }) {
  const fallbackAddr = address || context?.card?.ort || context?.address || "";
  const mapsAvailable = !!window.google?.maps;

  const mapRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const centerFromCard = useMemo(() => {
    const c = context?.card;
    if (!c) return null;
    if (Number.isFinite(c?.latitude) && Number.isFinite(c?.longitude)) {
      return { lat: Number(c.latitude), lng: Number(c.longitude) };
    }
    return null;
  }, [context]);

  useEffect(() => {
    if (!mapsAvailable || !context?.card || !mapRef.current) return;

    let cancelled = false;
    let map, iw;
    const vehicleMarkers = new Map(); // key: vid -> marker/advancedMarker
    let gpsPollTimer = null;

    const run = async () => {
      try {
        setBusy(true);
        setError("");

        // 1) Zentrum (Koords oder Geocode)
        let center = centerFromCard;
        if (!center) {
          const geo = await geocode(context.card.ort);
          if (cancelled) return;
          if (geo) center = { lat: geo.lat, lng: geo.lng };
        }
        if (!center) {
          setError("Konnte Einsatz-Position nicht bestimmen.");
          return;
        }

        // 2) Map & InfoWindow
        map = new window.google.maps.Map(mapRef.current, {
          center,
          zoom: 18, // direkt auf den aktuellen Einsatz hineinzoomen
          mapTypeId: "roadmap",
        });
        iw = new window.google.maps.InfoWindow();

        // 3) Marker-Helfer (Pins für Einsätze)
        const addPin = (pos, color, title, html, { hover = false } = {}) => {
          const icon = {
            path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#333",
            strokeWeight: 1,
            scale: 1.2,
          };
          const m = new window.google.maps.Marker({
            position: pos,
            map,
            title,
            icon,
          });
          if (html) {
            const open = () => {
              iw.setContent(html);
              iw.open(map, m);
            };
            if (hover) {
              m.addListener("mouseover", open);
              m.addListener("mouseout", () => iw.close());
            } else {
              m.addListener("click", open);
            }
          }
          return m;
        };

        // 4) Aktueller Einsatz (rot) – Hover: kompletter Info-Block
        addPin(
          center,
          "#d11a1a",
          context.card.content || "Einsatz",
          buildIncidentHtml(context.card),
          { hover: true }
        );

        // 5) Einsätze (Nur Neu & In Bearbeitung)
        const incidents = [
          ...(context?.board?.columns?.["neu"]?.items || []),
          ...(context?.board?.columns?.["in-bearbeitung"]?.items || []),
        ];

        // Positionen der Einsätze (Koords / Geocode)
        const incidentPositions = new Map();
        for (const inc of incidents) {
          if (Number.isFinite(inc.latitude) && Number.isFinite(inc.longitude)) {
            incidentPositions.set(inc.id, { lat: Number(inc.latitude), lng: Number(inc.longitude) });
          } else if (inc.ort) {
            const geo = await geocode(inc.ort);
            if (geo) incidentPositions.set(inc.id, { lat: geo.lat, lng: geo.lng });
          }
        }

        // 6) Weitere Einsätze (blau)
        for (const inc of incidents) {
          if (inc.id === context.card.id) continue;
          const pos = incidentPositions.get(inc.id);
          if (!pos) continue;
          addPin(pos, "#1e63d1", inc.content || "Einsatz", buildIncidentHtml(inc), { hover: true });
        }

        // 7) Zuweisungen ermitteln (Neu & In Bearbeitung)
        const assignedById = new Map(); // vehicleId -> incidentId
        for (const c of incidents) {
          for (const vid of c.assignedVehicles || []) {
            assignedById.set(String(vid), c.id);
          }
        }

        // 8) GPS laden & indizieren
        const gpsList = await loadGpsList(); // /api/gps → [{ realname, lat, lng }, ...]
        const gpsByName = new Map(
          gpsList
            .filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lng) && g?.realname)
            .map((g) => [norm(g.realname), g])
        );


        // 9a) Gemergte Fahrzeuge laden (liefert source: "gps"|"manual")
        const mergedVehicles = await loadMergedVehicles();
        const manualPosById = new Map(
          mergedVehicles
            .filter(v =>
              v &&
              v.source !== "gps" &&
              Number.isFinite(v.latitude) &&
              Number.isFinite(v.longitude)
            )
            .map(v => [String(v.id), { lat: Number(v.latitude), lng: Number(v.longitude) }])
        );

        // 9b) Fahrzeuge: nur anzeigen wenn assigned ODER im GPS
        const vehiclesArray = Object.values(context.vehiclesById || {});
        const baseRadiusM = 10;  // Ring-Abstand (fix)
        const stepDeg = 50;      // Winkel-Schritt
        const angleByIncident = new Map(); // incidentId -> angle

        // AdvancedMarkerElement?
        const Advanced = window.google?.maps?.marker?.AdvancedMarkerElement;

        // Hilfsfunktion: Icon-URL je Status bestimmen
        const resolveIconUrl = (isAssigned, gpsPos, assignedIncidentId) => {
          if (!isAssigned) return ICON_GRAY_URL; // unzugeordnet → grau
          if (!gpsPos || !assignedIncidentId || !incidentPositions.has(assignedIncidentId)) {
            return ICON_RED_URL; // kein GPS/keine Inc-Koords → rot
          }
          const incCenter = incidentPositions.get(assignedIncidentId);
          const distKm = haversineKm(gpsPos, incCenter);
          return distKm > 0.1 ? ICON_DRIVE_URL : ICON_RED_URL; // >100 m → drive.gif
        };

        // Hilfsfunktion: Fahrzeug-Marker erzeugen (AdvancedMarker oder klassisch)
        const placeVehicleMarker = (position, isAssigned, title, gpsPos, assignedIncidentId, vid) => {
          const iconUrl = resolveIconUrl(isAssigned, gpsPos, assignedIncidentId);
		   const canDrag = !gpsPos; // ohne GPS darf manuell verschoben werden (manuelle Pos zählt als "kein GPS")
          if (Advanced) {
            const img = document.createElement("img");
            img.src = iconUrl;
            img.width = ICON_SIZE;
            img.height = ICON_SIZE;
            img.alt = title || "";
            img.decoding = "async";
            const marker = new Advanced({
              map,
              position,
              content: img,
              title,
            });
	    if (canDrag) {
      try { marker.draggable = true; } catch {}
      // Persistiert via /api/vehicles/:id/position → server/data/vehicles-overrides.json
      marker.addListener("dragend", async (ev) => {
        const p = ev?.latLng || marker.position;
        const lat = typeof p.lat === "function" ? p.lat() : p.lat;
        const lng = typeof p.lng === "function" ? p.lng() : p.lng;
        try {
          await setVehiclePosition(vid, lat, lng, assignedIncidentId, "manual");
        } catch (e) {
          // bei Fehler zurückspringen
          marker.__setPosition(position);
          console.error("setVehiclePosition failed:", e);
          alert("Position konnte nicht gespeichert werden.");
        }
      });
    }		
            // Kompatibles Interface für späteres Update:
            marker.__setPosition = (pos) => { marker.position = pos; };
            marker.__setIcon = (assigned, gps, incId) => {
              img.src = resolveIconUrl(assigned, gps, incId);
            };
            marker.__onOver = (open) => {
              img.addEventListener("mouseover", open);
              img.addEventListener("mouseout", () => iw.close());
            };
            return marker;
          } else {
            const marker = new window.google.maps.Marker({
              position,
              map,
              title,
			  draggable: canDrag,
              icon: {
                url: iconUrl,
                scaledSize: new window.google.maps.Size(ICON_SIZE, ICON_SIZE),
                anchor: new window.google.maps.Point(ICON_SIZE / 2, ICON_SIZE / 2),
              },
            });
			    if (canDrag) {
      // Persistiert via /api/vehicles/:id/position → server/data/vehicles-overrides.json
      marker.addListener("dragend", async (ev) => {
        const p = ev?.latLng || marker.getPosition();
        const lat = typeof p.lat === "function" ? p.lat() : p.lat;
        const lng = typeof p.lng === "function" ? p.lng() : p.lng;
        try {
          await setVehiclePosition(vid, lat, lng, assignedIncidentId, "manual");
        } catch (e) {
         marker.__setPosition(position); // revert
          console.error("setVehiclePosition failed:", e);
          alert("Position konnte nicht gespeichert werden.");
        }
     });
    }
            marker.__setPosition = (pos) => marker.setPosition(pos);
            marker.__setIcon = (assigned, gps, incId) =>
              marker.setIcon({
                url: resolveIconUrl(assigned, gps, incId),
                scaledSize: new window.google.maps.Size(ICON_SIZE, ICON_SIZE),
                anchor: new window.google.maps.Point(ICON_SIZE / 2, ICON_SIZE / 2),
              });
            marker.__onOver = (open) => {
              marker.addListener("mouseover", open);
              marker.addListener("mouseout", () => iw.close());
            };
            return marker;
          }
        };

        for (const v of vehiclesArray) {
          const vid = String(v.id);
          const key = norm(`${v?.label || ""} ${v?.ort || ""}`);
          const gps = gpsByName.get(key);
          const assignedIncident = assignedById.get(vid);

          // Sichtbarkeitsregel:
          // - Zeige, wenn assigned (egal ob GPS vorhanden)
          // - Zeige, wenn nicht assigned, aber im GPS (grau)
          if (!assignedIncident && !gps) continue;

          let pos = null;
          let gpsPos = null;

          if (gps) {
            gpsPos = { lat: Number(gps.lat), lng: Number(gps.lng) };
            pos = gpsPos;
         } else if (manualPosById.has(vid)) {
           pos = manualPosById.get(vid);     // ← manuelle Override-Position
          } else if (assignedIncident && incidentPositions.has(assignedIncident)) {
            // Ring um den zugeordneten Einsatz
            const centerPos = incidentPositions.get(assignedIncident);
            const old = angleByIncident.get(assignedIncident) || 0;
            const next = (old + stepDeg) % 360;
            angleByIncident.set(assignedIncident, next);
            pos = offsetLatLng(centerPos, baseRadiusM, next);
          }
          if (!pos) continue;

          const isAssigned = !!assignedIncident;
          const marker = placeVehicleMarker(pos, isAssigned, v.label || v.id, gpsPos, assignedIncident, vid);

          // Hover: Name + Ort + optional „zugeordnet: <Einsatz>“
          const assignedCard =
            assignedIncident && incidents.find((c) => c.id === assignedIncident);
          const assignedInfo = assignedCard ? `<br/><i>zugeordnet: ${assignedCard.content}</i>` : "";

          marker.__onOver(() => {
            const ort = v?.ort || "";
            iw.setContent(
              `<div style="min-width:220px"><b>${v.label || v.id}</b>${ort ? `<br/>${ort}` : ""}${assignedInfo}</div>`
            );
            // AdvancedMarkerElement öffnet InfoWindow an position:
            const anchor = Advanced ? undefined : marker;
            iw.open({ map, anchor, position: pos, shouldFocus: false });
          });

          vehicleMarkers.set(vid, marker);
        }

        // 10) Initial auf aktuellen Einsatz fokussieren
        map.setCenter(center);
        map.setZoom(18);

        // 11) Live-Update: alle 5 s GPS + Zuweisungen + Nicht-GPS-Layout neu berechnen
        gpsPollTimer = setInterval(async () => {
          const list = await loadGpsList();
          const merged = await loadMergedVehicles();
          const manualPosById = new Map(
           merged
              .filter(v =>
                v && v.source !== "gps" &&
                Number.isFinite(v.latitude) &&
                Number.isFinite(v.longitude)
              )
              .map(v => [String(v.id), { lat: Number(v.latitude), lng: Number(v.longitude) }])
          );
          const idx = new Map(
            list
              .filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lng) && g?.realname)
              .map((g) => [norm(g.realname), g])
          );

          // Zuweisungen neu lesen
          const assignedNow = new Map();
          for (const col of [
            ...(context?.board?.columns?.["neu"]?.items || []),
            ...(context?.board?.columns?.["in-bearbeitung"]?.items || []),
          ]) {
            for (const vid of col.assignedVehicles || []) {
              assignedNow.set(String(vid), col.id);
            }
          }

          const vehiclesNow = Object.values(context.vehiclesById || {});

          // Neu verteilen: Nicht-GPS Fahrzeuge pro Incident deterministisch anwinkeln
          const nonGpsByIncident = new Map(); // incidentId -> vehicleIds[]
          for (const v of vehiclesNow) {
            const vid = String(v.id);
            const assignedIncident = assignedNow.get(vid);
            const key = norm(`${v?.label || ""} ${v?.ort || ""}`);
            if (assignedIncident && !idx.get(key)) {
              const arr = nonGpsByIncident.get(assignedIncident) || [];
              arr.push(vid);
              nonGpsByIncident.set(assignedIncident, arr);
            }
          }
          // Sortieren für stabile Winkel (nach vid)
          for (const [incId, arr] of nonGpsByIncident.entries()) {
            arr.sort();
          }

          const baseRadiusM = 10;
          const stepDeg = 50;

          for (const v of vehiclesNow) {
            const vid = String(v.id);
            const marker = vehicleMarkers.get(vid);
            if (!marker) continue;

            const key = norm(`${v?.label || ""} ${v?.ort || ""}`);
            const gps = idx.get(key);
            const assignedIncident = assignedNow.get(vid);
            let gpsPos = null;

            // Position
            if (gps) {
              gpsPos = { lat: Number(gps.lat), lng: Number(gps.lng) };
              marker.__setPosition(gpsPos);
            } else if (manualPosById.has(vid)) {
              marker.__setPosition(manualPosById.get(vid));   // ← Override beibehalten
            } else if (assignedIncident && incidentPositions.has(assignedIncident)) {
              const arr = nonGpsByIncident.get(assignedIncident) || [];
              const idxIn = arr.indexOf(vid);
              const angle = ((idxIn + 1) * stepDeg) % 360;
              const centerPos = incidentPositions.get(assignedIncident);
              marker.__setPosition(offsetLatLng(centerPos, baseRadiusM, angle));
            } else {
              // weder GPS noch zugeordnet → nicht zeigen
              const m = vehicleMarkers.get(vid);
              if (m) {
                if (m.setMap) m.setMap(null);
                else if (m.map) m.map = null;
                vehicleMarkers.delete(vid);
              }
              continue;
            }

            // Icon (rot, grau, drive.gif wenn >100 m)
            const isAssigned = !!assignedIncident;
            marker.__setIcon(isAssigned, gpsPos, assignedIncident);
          }
        }, 5000);
      } catch (e) {
        setError(e?.message || "Kartenaufbau fehlgeschlagen.");
      } finally {
        setBusy(false);
      }
    };

    run();

    return () => {
      cancelled = true;
      if (gpsPollTimer) clearInterval(gpsPollTimer);
      vehicleMarkers.clear();
      // map/iw → GC
    };
  }, [mapsAvailable, context, centerFromCard]);

  /* --------- Fallback (kein Maps JS) --------- */
  if (!mapsAvailable || !context?.card) {
    const src = `https://www.google.com/maps?q=${encodeURIComponent(
      fallbackAddr
    )}&output=embed`;
    return (
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[70vh] p-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold text-sm">Karte: {fallbackAddr}</h4>
            <button
              className="px-2 py-1 rounded-md bg-gray-200 hover:bg-gray-300 text-sm"
              onClick={onClose}
            >
              Schließen
            </button>
          </div>
          <iframe
            title="maps"
            className="w-full h-full rounded-lg border"
            src={src}
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  /* --------------- Vollwertige Map --------------- */
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[75vh] p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-2">
          <h4 className="font-semibold text-sm">
            Karte: {context?.card?.content || "Einsatz"} · weitere Einsätze (Neu & In Bearbeitung)
          </h4>
          <button
            className="px-2 py-1 rounded-md bg-gray-200 hover:bg-gray-300 text-sm"
            onClick={onClose}
          >
            Schließen
          </button>
        </div>
        <div ref={mapRef} className="w-full h-full rounded-lg border" />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-3 py-1.5 rounded bg-white shadow text-sm">
              Lade…
            </div>
          </div>
        )}
        {!!error && (
          <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-red-600 text-white text-xs shadow">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
