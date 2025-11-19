import React, { useEffect, useMemo, useRef, useState } from "react";
import { setVehiclePosition, updateCard } from "../api";

 const getAssignedVehicles = (card) => {
   if (Array.isArray(card?.assignedVehicles)) return card.assignedVehicles;
   if (Array.isArray(card?.assigned_vehicle_ids)) return card.assigned_vehicle_ids;
   return [];
 };

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
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadBoardData() {
  try {
    const res = await fetch("/api/board", { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data === "object") return data;
  } catch (error) {
    console.error("Board fetch failed:", error);
  }
  return null;
}

function mergeVehiclesForMap(contextVehiclesById, mergedVehicles) {
  const result = new Map();

  if (Array.isArray(mergedVehicles)) {
    for (const entry of mergedVehicles) {
      if (!entry || entry.id == null) continue;
      result.set(String(entry.id), { ...entry });
    }
  }

  if (contextVehiclesById && typeof contextVehiclesById === "object") {
    for (const value of Object.values(contextVehiclesById)) {
      if (!value || value.id == null) continue;
      const key = String(value.id);
      const merged = result.get(key) || {};
      result.set(key, { ...merged, ...value });
    }
  }

  return [...result.values()];
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
  const alarmzeitSource = card?.createdAt || card?.timestamp;
  const alarmzeit = alarmzeitSource
    ? new Date(alarmzeitSource).toLocaleString("de-AT", { hour12: false })
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
  const persistedGeocodeRef = useRef(false);
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

    persistedGeocodeRef.current = false;

    let cancelled = false;
    let map, iw;
    const vehicleMarkers = new Map(); // key: vid -> marker/advancedMarker
    let gpsPollTimer = null;

    const contextCardId = context?.card?.id != null ? String(context.card.id) : null;
    let boardSnapshot = context?.board;

    const persistGeocodeResult = async (coords, formattedAddress) => {
      if (!contextCardId || persistedGeocodeRef.current) return;
      if (!Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lng)) return;
      try {
        const payload = { latitude: coords.lat, longitude: coords.lng };
        if (formattedAddress && !context?.card?.location) {
          payload.location = formattedAddress;
        }
        await updateCard(contextCardId, payload);
        persistedGeocodeRef.current = true;
      } catch (e) {
        // Bei Fehler erneut versuchen, sobald MapModal neu geöffnet wird
        console.error("Geocoding-Persistierung fehlgeschlagen:", e);
      }
    };

    const run = async () => {
      try {
        setBusy(true);
        setError("");

        if (!boardSnapshot || typeof boardSnapshot !== "object" || !boardSnapshot.columns) {
          const fetchedBoard = await loadBoardData();
          if (cancelled) return;
          if (fetchedBoard && typeof fetchedBoard === "object") {
            boardSnapshot = fetchedBoard;
          }
        }

        // 1) Zentrum (Koords oder Geocode)
        let center = centerFromCard;
        if (!center) {
          const geo = await geocode(context.card.ort);
          if (cancelled) return;
          if (geo) {
            center = { lat: geo.lat, lng: geo.lng };
            persistGeocodeResult(center, geo.formatted);
          }
        }
        if (!center) {
          // Fallback: neutrales Zentrum, damit Marker + Ring-Layout funktionieren
          center = { lat: 46.7227, lng: 14.0952 };
          setError("Einsatz-Position unbekannt – zeige Karte mit Default-Zentrum.");
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
        const incidents = [];
        const incidentSeen = new Set();

        const pushIncident = (inc) => {
          if (!inc || inc.id == null) return;
          const key = String(inc.id);
          if (incidentSeen.has(key)) return;
          incidentSeen.add(key);
          incidents.push(inc);
        };

        const boardSource = boardSnapshot || context?.board;
        const boardColumns = boardSource?.columns || {};

        for (const inc of boardColumns?.["neu"]?.items || []) {
          pushIncident(inc);
        }
        for (const inc of boardColumns?.["in-bearbeitung"]?.items || []) {
          pushIncident(inc);
        }
        if (contextCardId) pushIncident(context?.card);

        // Positionen der Einsätze (Koords / Geocode)
        const incidentPositions = new Map();
        for (const inc of incidents) {
          const incKey = String(inc.id);
          if (Number.isFinite(inc.latitude) && Number.isFinite(inc.longitude)) {
            incidentPositions.set(incKey, { lat: Number(inc.latitude), lng: Number(inc.longitude) });
          } else if (inc.ort) {
            const geo = await geocode(inc.ort);
            if (geo) incidentPositions.set(incKey, { lat: geo.lat, lng: geo.lng });
          }
        }
		        // Fallback: aktueller Einsatz hat immer einen Mittelpunkt (z. B. wenn Geocode fehlt)
        if (contextCardId && center) {
          incidentPositions.set(contextCardId, center);
        }

        // 6) Weitere Einsätze (blau)
        for (const inc of incidents) {
          const incKey = String(inc.id);
          if (contextCardId && incKey === contextCardId) continue;
          const pos = incidentPositions.get(incKey);
          if (!pos) continue;
          addPin(pos, "#1e63d1", inc.content || "Einsatz", buildIncidentHtml(inc), { hover: true });
        }

        // 7) Zuweisungen ermitteln (Neu & In Bearbeitung)
        const assignedById = new Map(); // vehicleId -> incidentId
 for (const c of incidents) {
   for (const vid of getAssignedVehicles(c)) {
     assignedById.set(String(vid), String(c.id));
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

        // 9b) Fahrzeuge: nur anzeigen wenn assigned, im GPS oder mit manueller Position
        const vehiclesArray = mergeVehiclesForMap(context.vehiclesById, mergedVehicles);
        const baseRadiusM = 10; // Ring-Abstand (fix)
        const stepDeg = 50; // Winkel-Schritt
        const angleByIncident = new Map(); // incidentId -> angle

        // AdvancedMarkerElement?
        const AdvancedCtor = window.google?.maps?.marker?.AdvancedMarkerElement;
        const Advanced =
          typeof AdvancedCtor === "function" &&
          typeof AdvancedCtor?.prototype?.addListener === "function"
            ? AdvancedCtor
            : null;

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
              try {
                marker.draggable = true;
              } catch {}
              if (typeof marker.addListener === "function") {
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
 const k1 = norm(`${v?.label || ""} ${v?.ort || ""}`);
 const k2 = norm(v?.label || "");
 const k3 = norm(v?.ort || "");
 const gps = gpsByName.get(k1) || gpsByName.get(k2) || gpsByName.get(k3);
          const assignedIncident = assignedById.get(vid);

          // Sichtbarkeitsregel:
          // - Zeige, wenn assigned (egal ob GPS vorhanden)
          // - Zeige, wenn nicht assigned, aber im GPS (grau)
          // - Zeige, wenn manuelle Koordinaten existieren
          const hasManualOverride = manualPosById.has(vid);
          if (!assignedIncident && !gps && !hasManualOverride) continue;

          let pos = null;
          let gpsPos = null;

          if (gps) {
            gpsPos = { lat: Number(gps.lat), lng: Number(gps.lng) };
            pos = gpsPos;
          } else if (hasManualOverride) {
            pos = manualPosById.get(vid); // ← manuelle Override-Position
 } else if (assignedIncident) {
            // Ring um den zugeordneten Einsatz (mit Fallback auf "center" für aktuellen Einsatz)
            const centerPos =
              incidentPositions.get(assignedIncident) ||
             (contextCardId === assignedIncident ? center : null);
            const old = angleByIncident.get(assignedIncident) || 0;
            const next = (old + stepDeg) % 360;
            angleByIncident.set(assignedIncident, next);
            if (centerPos) pos = offsetLatLng(centerPos, baseRadiusM, next);
          }
          if (!pos) continue;

          const isAssigned = !!assignedIncident;
          const marker = placeVehicleMarker(pos, isAssigned, v.label || v.id, gpsPos, assignedIncident, vid);

          // Hover: Name + Ort + optional „zugeordnet: <Einsatz>“
          const assignedCard =
            assignedIncident && incidents.find((c) => String(c.id) === assignedIncident);
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

          if (!boardSnapshot || typeof boardSnapshot !== "object" || !boardSnapshot.columns) {
            const refreshedBoard = await loadBoardData();
            if (cancelled) return;
            if (refreshedBoard && typeof refreshedBoard === "object") {
              boardSnapshot = refreshedBoard;
            }
          }

          const boardSourceNow = boardSnapshot || context?.board;

          const manualPosById = new Map(
            merged
              .filter(
                (v) =>
                  v &&
                  v.source !== "gps" &&
                  Number.isFinite(v.latitude) &&
                  Number.isFinite(v.longitude)
              )
              .map((v) => [String(v.id), { lat: Number(v.latitude), lng: Number(v.longitude) }])
          );
          const idx = new Map(
            list
              .filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lng) && g?.realname)
              .map((g) => [norm(g.realname), g])
          );

          // Zuweisungen neu lesen
          const assignedNow = new Map();
          const assignedCards = [
            ...(boardSourceNow?.columns?.["neu"]?.items || []),
            ...(boardSourceNow?.columns?.["in-bearbeitung"]?.items || []),
          ];
          for (const card of assignedCards) {
            const cardIdStr = card?.id != null ? String(card.id) : null;
            if (!cardIdStr) continue;
            for (const vid of getAssignedVehicles(card)) {
              assignedNow.set(String(vid), cardIdStr);
            }
          }
          if (contextCardId) {
            for (const vid of getAssignedVehicles(context.card)) {
              assignedNow.set(String(vid), contextCardId);
            }
          }

          const vehiclesNow = mergeVehiclesForMap(context.vehiclesById, merged);

          // Neu verteilen: Nicht-GPS Fahrzeuge pro Incident deterministisch anwinkeln
          const nonGpsByIncident = new Map(); // incidentId -> vehicleIds[]
          for (const v of vehiclesNow) {
            const vid = String(v.id);
            const assignedIncident = assignedNow.get(vid);
            const key = norm(`${v?.label || ""} ${v?.ort || ""}`);
            if (assignedIncident && !idx.get(key) && !manualPosById.has(vid)) {
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


 const k1 = norm(`${v?.label || ""} ${v?.ort || ""}`);
 const k2 = norm(v?.label || "");
 const k3 = norm(v?.ort || "");
 const gps = idx.get(k1) || idx.get(k2) || idx.get(k3);
            const assignedIncident = assignedNow.get(vid);
            let gpsPos = null;
			
			            const hasManual = manualPosById.has(vid);

            // Sichtbarkeitsregel analog initial:
            const shouldBeVisible = !!assignedIncident || !!gps || !!hasManual;

            // Falls sichtbar, aber noch kein Marker existiert → jetzt anlegen
            let marker = vehicleMarkers.get(vid);
            if (!marker && shouldBeVisible) {
              let pos = null;
              if (gps) {
                gpsPos = { lat: Number(gps.lat), lng: Number(gps.lng) };
                pos = gpsPos;
              } else if (hasManual) {
                pos = manualPosById.get(vid);
              } else if (assignedIncident) {
                const centerPos =
                  incidentPositions.get(assignedIncident) ||
                  (contextCardId === assignedIncident ? center : null);
                if (centerPos) {
                  const arr = nonGpsByIncident.get(assignedIncident) || [];
                  const idxIn = arr.indexOf(vid);
                  const angle = ((idxIn + 1) * stepDeg) % 360;
                  pos = offsetLatLng(centerPos, baseRadiusM, angle);
                }
              }
              if (pos) {
                marker = placeVehicleMarker(
                  pos,
                  !!assignedIncident,
                  v.label || v.id,
                  gpsPos,
                 assignedIncident,
                  vid
                );
                vehicleMarkers.set(vid, marker);
              }
            }

            // Wenn weiterhin kein Marker → überspringen
            if (!marker) continue;

            // Position
            if (gps) {
              gpsPos = { lat: Number(gps.lat), lng: Number(gps.lng) };
              marker.__setPosition(gpsPos);
            } else if (manualPosById.has(vid)) {
              marker.__setPosition(manualPosById.get(vid));   // ← Override beibehalten
            } else if (assignedIncident) {
              const centerPos =
                incidentPositions.get(assignedIncident) ||
                (contextCardId === assignedIncident ? center : null);
              if (centerPos) {
                const arr = nonGpsByIncident.get(assignedIncident) || [];
                const idxIn = arr.indexOf(vid);
                const angle = ((idxIn + 1) * stepDeg) % 360;
                marker.__setPosition(offsetLatLng(centerPos, baseRadiusM, angle));
              } else {
                // kein brauchbarer Mittelpunkt → Marker entfernen
                const m = vehicleMarkers.get(vid);
                if (m) {
                  if (m.setMap) m.setMap(null);
                  else if (m.map) m.map = null;
                  vehicleMarkers.delete(vid);
                }
                continue;
              }
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
for (const m of vehicleMarkers.values()) {
   if (m?.setMap) m.setMap(null);
   else if (m) m.map = null;
 }
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
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded-md bg-gray-200 hover:bg-gray-300 text-sm"
              onClick={onClose}
            >
              Schließen
            </button>
          </div>
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
