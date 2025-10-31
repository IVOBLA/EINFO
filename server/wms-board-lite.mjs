#!/usr/bin/env node
import "./utils/loadEnv.mjs";
import { wmsLogMiddleware } from "./utils/wmsLogger.mjs";
/**
 * wms-board-lite.mjs — WMS/GeoJSON/XYZ-Lite
 *  - GET /wms?service=WMS&request=GetCapabilities
 *  - GET /geojson?layers=lage:all|lage:incidents|lage:vehicles[&crs=EPSG:4326|3857&bbox=minx,miny,maxx,maxy]
 *  - GET /tiles/:layer/:z/:x/:y.png  (layer = Einsatz | FZG)
 *
 * ENV:
 *  - WMS_PORT (default 8090)
 *  - DATA_DIR (default ./data)
 *
 * Abhängigkeiten: express, proj4, @napi-rs/canvas
 */
import express from "express";
import fsp from "fs/promises";
import path from "path";
import url from "url";
import proj4 from "proj4";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/* ---------- Setup ---------- */
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PORT       = Number(process.env.WMS_PORT || 8090);
const DATA_DIR   = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, "data");
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.resolve(__dirname, "public"); // Icons bevorzugt hier

// Daten-Dateien
const f = (p) => path.join(DATA_DIR, p);
const BOARD_FILE   = f("board.json");
const VEH_BASE     = f("vehicles.json");
const VEH_EXTRA    = f("vehicles-extra.json");
const GPS_FILE     = f("vehicles_gps.json");
const OVERRIDES    = f("vehicles-overrides.json");
const GROUPS_FILE  = f("group_locations.json");

/* ---------- Proj ---------- */
const EPSG4326 = "+proj=longlat +datum=WGS84 +no_defs";
const EPSG3857 = "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

/* ---------- Utils ---------- */
const norm = (s) => String(s || "").trim().toLowerCase();

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

function offsetLatLng(origin, meters, bearingDeg) {
  const R = 6371000;
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

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch { return fallback; }
}

async function loadData() {
  const board     = await readJson(BOARD_FILE, { columns: { "neu": { items: [] }, "in-bearbeitung": { items: [] } } });
  const vehiclesA = await readJson(VEH_BASE, []);
  const vehiclesB = await readJson(VEH_EXTRA, []);
  const vehicles  = [...vehiclesA, ...vehiclesB];
  const gpsList   = await readJson(GPS_FILE, []);
  const overrides = await readJson(OVERRIDES, {});
  const groupsObj = await readJson(GROUPS_FILE, {});

  const incidents = [
    ...(board?.columns?.["neu"]?.items || []),
    ...(board?.columns?.["in-bearbeitung"]?.items || []),
  ].filter(i => Number.isFinite(i?.latitude) && Number.isFinite(i?.longitude));

  const incidentPos = new Map(
    incidents.map(i => [String(i.id), { lat: +i.latitude, lng: +i.longitude }])
  );

  // Zuweisung vehicleId -> incidentId
  const assignedById = new Map();
  for (const i of incidents) for (const vid of (i.assignedVehicles || [])) {
    assignedById.set(String(vid), String(i.id));
  }

  // GPS Index (realname = label + ort normalisiert)
  const gpsByKey = new Map(
    gpsList
      .filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lng) && g?.realname)
      .map(g => [norm(g.realname), { lat: +g.lat, lng: +g.lng }])
  );

  // Gruppenkoordinaten nach Ort
  const groups = new Map(
    Object.entries(groupsObj)
      .map(([name, g]) => [name, { lat: +g.lat, lng: +(g.lon ?? g.lng) }])
      .filter(([_, p]) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  );

  return { incidents, incidentPos, vehicles, assignedById, gpsByKey, overrides, groups };
}

// Orbit-Parameter
const ORBIT_RADIUS_M = 10;
const ORBIT_STEP_DEG = 50;

function resolveVehiclePosition(v, ctx, ringOrder) {
  const { assignedById, incidentPos, gpsByKey, overrides, groups } = ctx;
  const vid = String(v.id);
  const assignedIncident = assignedById.get(vid);
  const assignedIncidentKey = assignedIncident ? String(assignedIncident) : null;
  const key = norm(`${v?.label || ""} ${v?.ort || ""}`);

  // 1) GPS
  const gps = gpsByKey.get(key);
  if (gps) return { pos: gps, source: "gps", assignedIncident: assignedIncidentKey };

  // 2) Manuelle Overrides
  const ov = overrides[vid];
  if (ov && Number.isFinite(ov.lat) && Number.isFinite(ov.lng)) {
    return { pos: { lat: +ov.lat, lng: +ov.lng }, source: ov.source || "manual", assignedIncident: assignedIncidentKey };
  }

  // 3) Orbit um Einsatz, wenn zugeordnet
  if (assignedIncidentKey && incidentPos.has(assignedIncidentKey)) {
    const pool = ringOrder.get(assignedIncidentKey) || [];
    const idx = pool.indexOf(vid);
    const angle = ((idx + 1) * ORBIT_STEP_DEG) % 360;
    const center = incidentPos.get(assignedIncidentKey);
    return { pos: offsetLatLng(center, ORBIT_RADIUS_M, angle), source: "orbit", assignedIncident: assignedIncidentKey };
  }

  // 4) Gruppenstandort (Orts-Depot)
  const gp = groups.get(v?.ort || "");
  if (gp) return { pos: gp, source: "group", assignedIncident: assignedIncidentKey };

  return { pos: null, source: "none", assignedIncident: assignedIncidentKey };
}

function bboxFilter(crs, bbox) {
  if (!bbox || bbox.length !== 4) return () => true;
  const [minx, miny, maxx, maxy] = bbox.map(Number);
  if (crs === "EPSG:3857") {
    return (lon, lat) => {
      const [x, y] = proj4(EPSG4326, EPSG3857, [lon, lat]);
      return x >= minx && x <= maxx && y >= miny && y <= maxy;
    };
  }
  // EPSG:4326
  return (lon, lat) => lon >= minx && lon <= maxx && lat >= miny && lat <= maxy;
}

/* ---------- Server ---------- */
const app = express();
app.disable("x-powered-by");

app.use(wmsLogMiddleware);
// (optional) statische Auslieferung der Icons
app.use(express.static(PUBLIC_DIR));

/* ----- /wms (Capabilities mit "Einsatz" & "FZG") ----- */
function wmsCapabilitiesXML(baseUrl) {
  const WORLD3857 = [-20037508.34, -20037508.34, 20037508.34, 20037508.34];
  return `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0"
  xmlns="http://www.opengis.net/wms"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/wms http://schemas.opengis.net/wms/1.3.0/capabilities_1_3_0.xsd">
  <Service>
    <Name>WMS</Name>
    <Title>Lagekarte WMS-lite (GeoJSON/XYZ)</Title>
    <Abstract>Hinweis: GetMap via /tiles, Features via /geojson.</Abstract>
    <OnlineResource xlink:type="simple" xlink:href="${baseUrl}"/>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <Format>application/vnd.ogc.wms_xml</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${baseUrl}"/></Get></HTTP></DCPType>
      </GetCapabilities>
      <GetMap>
        <Format>image/png</Format>
      </GetMap>
    </Request>
    <Layer>
      <Title>Lagekarte</Title>
      <CRS>EPSG:3857</CRS>
      <CRS>EPSG:4326</CRS>
      <BoundingBox CRS="EPSG:3857"
        minx="${WORLD3857[0]}" miny="${WORLD3857[1]}"
        maxx="${WORLD3857[2]}" maxy="${WORLD3857[3]}"/>
      <Layer><Name>Einsatz</Name><Title>Einsätze</Title></Layer>
      <Layer><Name>FZG</Name><Title>Fahrzeuge (zugeordnet)</Title></Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;
}

app.get("/wms", (req, res) => {
  const q = {};
  for (const [k, v] of Object.entries(req.query))
    q[k.toUpperCase()] = Array.isArray(v) ? v[0] : v;

  const baseUrl = `${req.protocol}://${req.get("host")}${req.path}?service=WMS&request=GetCapabilities`;
  if (!q.REQUEST || q.REQUEST.toUpperCase() === "GETCAPABILITIES") {
    res.setHeader("Content-Type", "application/vnd.ogc.wms_xml; charset=utf-8");
    return res.send(wmsCapabilitiesXML(baseUrl));
  }
  return res.status(400).send("Use /tiles/Einsatz or /tiles/FZG for map images.");
});

/* ----- /geojson (unverändert nutzbar) ----- */
app.get("/geojson", async (req, res) => {
  try {
    const layers = String(req.query.layers || "lage:all").split(",")[0];
    const crs    = String(req.query.crs || "EPSG:4326").toUpperCase();
    const bbox   = req.query.bbox ? String(req.query.bbox).split(",").map(Number) : null;

    const data = await loadData();
    const { incidents, incidentPos, vehicles, assignedById } = data;

    // deterministische Ring-Order
    const nonGpsByIncident = new Map();
    for (const v of vehicles) {
      const vid = String(v.id);
      const ass = assignedById.get(vid);
      if (!ass) continue;
      const assKey = String(ass);
      const key = norm(`${v?.label || ""} ${v?.ort || ""}`);
      const hasGps = data.gpsByKey.has(key);
      const hasOv  = !!data.overrides[vid];
      if (!hasGps && !hasOv) {
        const arr = nonGpsByIncident.get(assKey) || [];
        arr.push(vid);
        nonGpsByIncident.set(assKey, arr);
      }
    }
    for (const [id, arr] of nonGpsByIncident.entries()) arr.sort();

    const filter = bboxFilter(crs, bbox);
    const features = [];

    if (layers === "lage:all" || layers === "lage:incidents") {
      for (const i of incidents) {
        const p = incidentPos.get(String(i.id));
        if (!p) continue;
        if (bbox && !filter(p.lng, p.lat)) continue;
        features.push({
          type: "Feature",
          properties: {
            layer: "incident",
            id: String(i.id),
            title: i.content || "",
            typ: i.typ || null,
            ort: i.ort || null,
          },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] }
        });
      }
    }

    if (layers === "lage:all" || layers === "lage:vehicles") {
      for (const v of vehicles) {
        const pos = resolveVehiclePosition(v, data, nonGpsByIncident);
        if (!pos.pos) continue;
        if (bbox && !filter(pos.pos.lng, pos.pos.lat)) continue;
        features.push({
          type: "Feature",
          properties: {
            layer: "vehicle",
            id: String(v.id),
            label: v.label || "",
            unit: v.ort || null,
            status: pos.assignedIncident ? "assigned" : "free",
            positionSource: pos.source,
            assignedIncident: pos.assignedIncident || null,
          },
          geometry: { type: "Point", coordinates: [pos.pos.lng, pos.pos.lat] }
        });
      }
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({ type: "FeatureCollection", features });
  } catch (e) {
    console.error("[geojson]", e);
    res.status(500).json({ error: "geojson error" });
  }
});

/* ----- /tiles/:layer/:z/:x/:y.png ----- */
const ICON_SIZE = 30; // wie in MapModal
const ICONS = {
  // Einsätze & zugeordnete Fahrzeuge: vehicle-red.gif
  // Fahrzeuge in Bewegung (Distanz > 100 m): vehicle-drive.gif
  // (grau wird hier nicht genutzt, da FZG nur zugeordnete rendert)
  incident: path.join(PUBLIC_DIR, "incident.png"),
  vehicleRed: path.join(PUBLIC_DIR, "vehicle-red.gif"),
  vehicleDrive: path.join(PUBLIC_DIR, "vehicle-drive.gif"),
  vehicleGray: path.join(PUBLIC_DIR, "vehicle-gray.png"), // nur falls du mal frei rendern willst
};

const iconCache = {};
// zusätzlicher Fallback-Pfad auf client/public
const ALT_PUBLIC_DIR = path.resolve(__dirname, "../client/public");

async function resolveIconPath(filename) {
  const p1 = path.join(PUBLIC_DIR, filename);
  try { await fsp.access(p1); return p1; } catch {}
  const p2 = path.join(ALT_PUBLIC_DIR, filename);
  try { await fsp.access(p2); return p2; } catch {}
  return null;
}

async function getIcon(name) {
  try {
    if (!iconCache[name]) {
      const filePath = await resolveIconPath(path.basename(ICONS[name]));
      if (!filePath) {
        console.warn("[tiles] icon not found:", ICONS[name]);
        iconCache[name] = null;
      } else {
        const buf = await fsp.readFile(filePath);
        iconCache[name] = await loadImage(buf);   // Buffer → robust unter Windows
      }
    }
    return iconCache[name];
  } catch (e) {
    console.warn("[tiles] icon load failed:", ICONS[name], e.message);
    return null;
  }
}

function tileBBox(z, x, y) {
  const n = Math.pow(2, z);
  const lon1 = (x / n) * 360 - 180;
  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180) / Math.PI;
  const lon2 = ((x + 1) / n) * 360 - 180;
  const lat2 = (Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180) / Math.PI;
  return [lon1, lat2, lon2, lat1]; // minLon, minLat, maxLon, maxLat
}

app.get("/tiles/:layer/:z/:x/:y.png", async (req, res) => {
  try {
    const { layer, z, x, y } = req.params;
    const Z = Number(z), X = Number(x), Y = Number(y);
    const [minLon, minLat, maxLon, maxLat] = tileBBox(Z, X, Y);

    const data = await loadData();
    const { incidents, incidentPos, vehicles, assignedById, gpsByKey, overrides } = data;

    // Für Fahrzeuge ohne GPS/Override eine deterministische Orbit-Reihenfolge aufbauen,
    // damit mehrere Fahrzeuge am selben Einsatz nicht übereinander landen.
    const ringOrder = new Map();
    for (const v of vehicles) {
      const vid = String(v.id);
      const assignedIncident = assignedById.get(vid);
      if (!assignedIncident) continue;
      const assignedKey = String(assignedIncident);

      const key = norm(`${v?.label || ""} ${v?.ort || ""}`);
      const hasGps = gpsByKey.has(key);
      const override = overrides?.[vid];
      const hasOverride =
        override && Number.isFinite(override.lat) && Number.isFinite(override.lng);

      if (hasGps || hasOverride) continue; // diese erhalten echte Koordinaten

      const pool = ringOrder.get(assignedKey) || [];
      pool.push(vid);
      ringOrder.set(assignedKey, pool);
    }
    for (const arr of ringOrder.values()) arr.sort();

    const size = 256;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);

    // Projektion 4326 -> 3857 -> Pixel
    const [minXYx, minXYy] = proj4(EPSG4326, EPSG3857, [minLon, minLat]);
    const [maxXYx, maxXYy] = proj4(EPSG4326, EPSG3857, [maxLon, maxLat]);
    const spanX = maxXYx - minXYx;
    const spanY = maxXYy - minXYy;
    const toPx = (lon, lat) => {
      const [wx, wy] = proj4(EPSG4326, EPSG3857, [lon, lat]);
      const px = ((wx - minXYx) / spanX) * size;
      const py = ((maxXYy - wy) / spanY) * size;
      return [px, py];
    };

    // --- Layer: Einsätze ---
    if (layer === "Einsatz") {
      const incidentIcon = await getIcon("incident");
      for (const i of incidents) {
        const p = incidentPos.get(String(i.id));
        if (!p) continue;
        if (p.lng < minLon || p.lng > maxLon || p.lat < minLat || p.lat > maxLat) continue;
        const [px, py] = toPx(p.lng, p.lat);
        if (incidentIcon) {
          ctx.drawImage(incidentIcon, px - ICON_SIZE / 2, py - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
        } else {
          ctx.fillStyle = "#d11a1a";
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // --- Layer: Fahrzeuge (nur zugeordnete) ---
    if (layer === "FZG") {
      for (const v of vehicles) {
        const pos = resolveVehiclePosition(v, data, ringOrder);
        if (!pos.pos || !pos.assignedIncident) continue; // nur zugeordnete!
        if (
          pos.pos.lng < minLon || pos.pos.lng > maxLon ||
          pos.pos.lat < minLat || pos.pos.lat > maxLat
        ) continue;

        // Icon-Typ: rot (nah) oder drive (wenn >100m vom Einsatz)
        let iconName = "vehicleRed";
        const incCenter = data.incidentPos.get(pos.assignedIncident);
        if (incCenter) {
          const distKm = haversineKm(pos.pos, incCenter);
          if (distKm > 0.1) iconName = "vehicleDrive";
        }

        const icon = await getIcon(iconName);
        const [px, py] = toPx(pos.pos.lng, pos.pos.lat);
        if (icon) {
          ctx.drawImage(icon, px - ICON_SIZE / 2, py - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
        } else {
          ctx.fillStyle = iconName === "vehicleDrive" ? "#0066ff" : "#d11a1a";
          ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
        }

        // Label nur bei Fahrzeugen (ab Zoom >= 12)
        if (Z >= 12) {
          const label = v.label || String(v.id);
          ctx.font = Z >= 14 ? "bold 14px Arial" : "12px Arial";
          ctx.textAlign = "center";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(0,0,0,0.8)";
          ctx.fillStyle = "white";
          const ty = py + ICON_SIZE / 2 + 12;
          ctx.strokeText(label, px, ty);
          ctx.fillText(label, px, ty);
        }
      }
    }

    res.setHeader("Cache-Control", "public, max-age=5");
    res.setHeader("Content-Type", "image/png");
    res.send(canvas.toBuffer("image/png"));
  } catch (e) {
    console.error("[tiles]", e);
    res.status(500).send("tile error");
  }
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`[WMS-lite] Capabilities: http://localhost:${PORT}/wms?service=WMS&request=GetCapabilities`);
  console.log(`[WMS-lite] Tiles Einsatz: http://localhost:${PORT}/tiles/Einsatz/{z}/{x}/{y}.png`);
  console.log(`[WMS-lite] Tiles FZG    : http://localhost:${PORT}/tiles/FZG/{z}/{x}/{y}.png`);
});
