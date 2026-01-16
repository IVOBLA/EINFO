#!/usr/bin/env node
import "./utils/loadEnv.mjs";
import { wmsLogMiddleware } from "./utils/wmsLogger.mjs";

/**
 * wms-board.mjs
 * WMS 1.3.0, der die Positionslogik aus MapModal.jsx nachbildet.
 *
 * Daten-QUELLEN (nur lesen, keine Änderungen):
 *  - DATA_DIR/board.json                 (Einsätze, nur "neu" & "in-bearbeitung")
 *  - DATA_DIR/vehicles.json              (Stammdaten)
 *  - DATA_DIR/vehicles-extra.json        (Stammdaten, Zusatz)
 *  - DATA_DIR/vehicles_gps.json          (Live-GPS: { realname, lat, lng })
 *  - DATA_DIR/vehicles-overrides.json    (manuelle Fahrzeugpositionen)
 *  - DATA_DIR/group_locations.json       (Koords der Feuerwehrhäuser)
 *
 * Layer:
 *  - lage:all
 *  - lage:incidents
 *  - lage:vehicles
 *
 * Zeichnung:
 *  - Incidents: rote Punkte
 *  - Fahrzeuge: blau; Labels "Label (Ort)"
 *  - Zugeordnete & ohne GPS/Override: ringförmig 10 m um Einsatz (50°-Schritt)
 *
 * ENV:
 *  WMS_PORT=8090
 *  DATA_DIR=./data
 *  WMS_TITLE="Lagekarte WMS (MapModal-Logik)"
 *  WMS_ABSTRACT="Einsätze & Fahrzeuge wie MapModal"
 *  WMS_LABELS=1
 *  WMS_LABEL_FONT="12px Sans-Serif"
 *  WMS_LABEL_COLOR="#000"
 *  WMS_LABEL_OUTLINE="#fff"
 *  WMS_LABEL_OUTLINE_W=3
 *  WMS_LABEL_TRIM=28
 */
import express from "express";
import fsp from "fs/promises";
import path from "path";
import url from "url";
import proj4 from "proj4";
import { createCanvas } from "@napi-rs/canvas";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/* ---------- Konfiguration ---------- */
const PORT       = Number(process.env.WMS_PORT || 8090);
const DATA_DIR   = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, "data");
const CAPS_TITLE = process.env.WMS_TITLE || "Lagekarte WMS (MapModal-Logik)";
const CAPS_ABS   = process.env.WMS_ABSTRACT || "Einsätze & Fahrzeuge (Positionen wie MapModal)";

/* Dateien */
const BOARD_FILE   = path.join(DATA_DIR, "board.json");
const VEH_BASE     = path.join(DATA_DIR, "vehicles.json");
const VEH_CONF     = path.join(DATA_DIR, "conf", "vehicles.json");
const VEH_EXTRA    = path.join(DATA_DIR, "vehicles-extra.json");
const GPS_FILE     = path.join(DATA_DIR, "vehicles_gps.json");
const OVERRIDES    = path.join(DATA_DIR, "vehicles-overrides.json");
const GROUPS_FILE  = path.join(DATA_DIR, "group_locations.json");

/* Styles & Labels */
const LABELS_ENABLED   = (process.env.WMS_LABELS || "1") === "1";
const LABEL_FONT       = process.env.WMS_LABEL_FONT || "12px Sans-Serif";
const LABEL_COLOR      = process.env.WMS_LABEL_COLOR || "#000000";
const LABEL_OUTLINE    = process.env.WMS_LABEL_OUTLINE || "#ffffff";
const LABEL_OUTLINE_W  = Math.max(0, Number(process.env.WMS_LABEL_OUTLINE_W || 3));
const LABEL_TRIM       = Math.max(6, Number(process.env.WMS_LABEL_TRIM || 28));

const S_INC_FILL   = "#e53935";
const S_INC_STROKE = "#b71c1c";
const S_INC_R      = 6;

const S_VEH_FILL   = "#1e88e5";
const S_VEH_STROKE = "#0d47a1";
const S_VEH_R      = 5;

/* Orbit (wie MapModal live-Update: deterministisch) */
const ORBIT_RADIUS_M = 10;   // 10 m um Incident
const ORBIT_STEP_DEG = 50;   // 50° Schritt

/* Projektionen */
const EPSG4326 = "+proj=longlat +datum=WGS84 +no_defs";
const EPSG3857 = "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const WORLD3857 = [-20037508.34, -20037508.34, 20037508.34, 20037508.34];

/* ---------- Utils wie im MapModal ---------- */
const norm = (s) => String(s || "").trim().toLowerCase();
const normFF = (s) => String(s || "").replace(/^\s*FF\s+/i, "").trim().toLowerCase(); // App.jsx nutzt das an manchen Stellen

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

// Offset (Meter/Bearing) -> Lat/Lng (wie MapModal)
function offsetLatLng(origin, meters, bearingDeg) {
  const R = 6371000; // m
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const dr = meters / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) +
      Math.cos(lat1) * Math.sin(dr) * Math.cos(br)
  ) * 180 / Math.PI;

  const lng2 = (lng1 + Math.atan2(
    Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
    Math.cos(dr) - Math.sin(lat1) * Math.sin((lat2 * Math.PI) / 180)
  )) * 180 / Math.PI;

  return { lat: lat2, lng: lng2 };
}

/* ---------- IO ---------- */
async function readJson(file, fallback) {
  try {
    const txt = await fsp.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

/* ---------- Datenaufbereitung (MapModal-kompatibel) ---------- */
async function loadData() {
  const board = await readJson(BOARD_FILE, { columns: { "neu": { items: [] }, "in-bearbeitung": { items: [] }, "erledigt": { items: [] } } });
  let vehiclesA = await readJson(VEH_BASE, null);
  if (!Array.isArray(vehiclesA) || vehiclesA.length === 0) {
    const confVehicles = await readJson(VEH_CONF, null);
    if (Array.isArray(confVehicles) && confVehicles.length > 0) {
      vehiclesA = confVehicles;
    }
  }
  if (!Array.isArray(vehiclesA)) vehiclesA = [];
  const vehiclesB = await readJson(VEH_EXTRA, []);
  const vehicles = [...vehiclesA, ...vehiclesB];

  const gpsList = await readJson(GPS_FILE, []); // [{ realname, lat, lng }, ...]
  const overrides = await readJson(OVERRIDES, {}); // { [id]: {lat,lng,source,incidentId?,ts} }
  const groups = await readJson(GROUPS_FILE, {}); // { "Ort": {lat, lon} }

  // Einsätze wie im Modal: nur "neu" + "in-bearbeitung"
  const incidents = [
    ...(board?.columns?.["neu"]?.items || []),
    ...(board?.columns?.["in-bearbeitung"]?.items || []),
  ].filter(c => Number.isFinite(c?.latitude) && Number.isFinite(c?.longitude));

  const incidentPos = new Map(incidents.map(c => [String(c.id), { lat: Number(c.latitude), lng: Number(c.longitude) }]));

  // Zuordnung vehicleId -> incidentId
  const assignedById = new Map();
  for (const c of incidents) {
    for (const vid of (c.assignedVehicles || [])) assignedById.set(String(vid), String(c.id));
  }

  // GPS-Index wie im Modal: key = norm(`${label} ${ort}`) ⇄ realname
  const gpsByKey = new Map(
    gpsList
      .filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lng) && g?.realname)
      .map(g => [norm(g.realname), { lat: Number(g.lat), lng: Number(g.lng) }])
  );

  // Gruppenkoords
  const groupPos = new Map(
    Object.entries(groups || {})
      .map(([name, g]) => [name, { lat: Number(g?.lat), lng: Number(g?.lon ?? g?.lng) }])
      .filter(([_, p]) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  );

  return { incidents, incidentPos, vehicles, assignedById, gpsByKey, overrides, groupPos };
}

// Position eines Fahrzeugs nach Modal-Regeln
function vehiclePosition(v, { assignedById, incidentPos, gpsByKey, overrides, groupPos }, ringAngleIndexMap) {
  const vid = String(v.id);
  const assignedIncident = assignedById.get(vid);
  const assignedIncidentKey = assignedIncident ? String(assignedIncident) : null;
  const key = norm(`${v?.label || ""} ${v?.ort || ""}`);

  // 1) GPS
  const gps = gpsByKey.get(key);
  if (gps) return { pos: gps, source: "gps", assignedIncident: assignedIncidentKey };

  // 2) Override
  const ov = overrides[vid];
  if (ov && Number.isFinite(ov.lat) && Number.isFinite(ov.lng)) {
    return { pos: { lat: Number(ov.lat), lng: Number(ov.lng) }, source: ov.source || "manual", assignedIncident: assignedIncidentKey };
  }

  // 3) Zugeordnet + keine GPS/Override => Ring um Incident (10 m, 50° Schritt, deterministisch)
  if (assignedIncidentKey && incidentPos.has(assignedIncidentKey)) {
    const arr = ringAngleIndexMap.get(assignedIncidentKey) || [];
    // deterministische Sortierreihenfolge außerhalb: wird beim Aufrufer aufgebaut
    const idx = arr.indexOf(vid);
    const angle = ((idx + 1) * ORBIT_STEP_DEG) % 360;
    const center = incidentPos.get(assignedIncidentKey);
    return { pos: offsetLatLng(center, ORBIT_RADIUS_M, angle), source: "orbit", assignedIncident: assignedIncidentKey };
  }

  // 4) Unzugeordnet: Gruppen-Standort (falls vorhanden)
  const gp = groupPos.get(v?.ort || "");
  if (gp) return { pos: gp, source: "group", assignedIncident: assignedIncidentKey };

  // 5) keine Position
  return { pos: null, source: "none", assignedIncident: assignedIncidentKey };
}

/* ---------- Projektion & Zeichnen ---------- */
function projPixel(CRS, BBOX, WIDTH, HEIGHT) {
  return (lonlat) => {
    if (CRS.toUpperCase() === "EPSG:3857") {
      const m = proj4(EPSG4326, EPSG3857, lonlat);
      const [minx,miny,maxx,maxy] = BBOX;
      const x = ( (m[0] - minx) / (maxx - minx) ) * WIDTH;
      const y = HEIGHT - ( (m[1] - miny) / (maxy - miny) ) * HEIGHT;
      return [x,y];
    }
    if (CRS.toUpperCase() === "EPSG:4326") {
      const [minx,miny,maxx,maxy] = BBOX;
      const x = ( (lonlat[0] - minx) / (maxx - minx) ) * WIDTH;
      const y = HEIGHT - ( (lonlat[1] - miny) / (maxy - miny) ) * HEIGHT;
      return [x,y];
    }
    throw new Error("CRS not supported");
  };
}

function drawPoint(ctx, x, y, style) {
  const r = style.radius ?? 5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(); }
  if (style.stroke) { ctx.lineWidth = style.lineWidth ?? 1; ctx.strokeStyle = style.stroke; ctx.stroke(); }
}

function trimLabel(s) {
  if (!s) return "";
  const t = String(s);
  return t.length <= LABEL_TRIM ? t : t.slice(0, Math.max(0, LABEL_TRIM - 1)) + "…";
}

function drawText(ctx, text, x, y, align="left", baseline="middle") {
  ctx.font = LABEL_FONT;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (LABEL_OUTLINE_W > 0) {
    ctx.lineWidth = LABEL_OUTLINE_W;
    ctx.strokeStyle = LABEL_OUTLINE;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(text, x, y);
}

function parseParams(q) {
  const p = {};
  for (const [k,v] of Object.entries(q)) p[k.toUpperCase()] = Array.isArray(v)? v[0] : (v ?? "");
  return p;
}

function capabilities(baseUrl) {
  const layersXml = `
    <Layer queryable="1"><Name>lage:all</Name><Title>Alle</Title><CRS>EPSG:3857</CRS><CRS>EPSG:4326</CRS>
      <EX_GeographicBoundingBox><westBoundLongitude>-180</westBoundLongitude><eastBoundLongitude>180</eastBoundLongitude><southBoundLatitude>-85</southBoundLatitude><northBoundLatitude>85</northBoundLatitude></EX_GeographicBoundingBox>
      <BoundingBox CRS="EPSG:3857" minx="${WORLD3857[0]}" miny="${WORLD3857[1]}" maxx="${WORLD3857[2]}" maxy="${WORLD3857[3]}"/>
    </Layer>
    <Layer queryable="1"><Name>lage:incidents</Name><Title>Einsätze</Title><CRS>EPSG:3857</CRS><CRS>EPSG:4326</CRS>
      <EX_GeographicBoundingBox><westBoundLongitude>-180</westBoundLongitude><eastBoundLongitude>180</eastBoundLongitude><southBoundLatitude>-85</southBoundLatitude><northBoundLatitude>85</northBoundLatitude></EX_GeographicBoundingBox>
      <BoundingBox CRS="EPSG:3857" minx="${WORLD3857[0]}" miny="${WORLD3857[1]}" maxx="${WORLD3857[2]}" maxy="${WORLD3857[3]}"/>
    </Layer>
    <Layer queryable="1"><Name>lage:vehicles</Name><Title>Fahrzeuge</Title><CRS>EPSG:3857</CRS><CRS>EPSG:4326</CRS>
      <EX_GeographicBoundingBox><westBoundLongitude>-180</westBoundLongitude><eastBoundLongitude>180</eastBoundLongitude><southBoundLatitude>-85</southBoundLatitude><northBoundLatitude>85</northBoundLatitude></EX_GeographicBoundingBox>
      <BoundingBox CRS="EPSG:3857" minx="${WORLD3857[0]}" miny="${WORLD3857[1]}" maxx="${WORLD3857[2]}" maxy="${WORLD3857[3]}"/>
    </Layer>
  `;
  return `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0"
  xmlns="http://www.opengis.net/wms"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/wms http://schemas.opengis.net/wms/1.3.0/capabilities_1_3_0.xsd">
  <Service>
    <Name>WMS</Name>
    <Title>${CAPS_TITLE}</Title>
    <Abstract>${CAPS_ABS}</Abstract>
    <OnlineResource xlink:href="${baseUrl}"/>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <Format>text/xml</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="${baseUrl}"/></Get></HTTP></DCPType>
      </GetCapabilities>
      <GetMap>
        <Format>image/png</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="${baseUrl}"/></Get></HTTP></DCPType>
      </GetMap>
    </Request>
    <Exception><Format>XML</Format></Exception>
    <Layer>
      <Title>${CAPS_TITLE}</Title>
      <CRS>EPSG:3857</CRS><CRS>EPSG:4326</CRS>
      <EX_GeographicBoundingBox>
        <westBoundLongitude>-180</westBoundLongitude>
        <eastBoundLongitude>180</eastBoundLongitude>
        <southBoundLatitude>-85</southBoundLatitude>
        <northBoundLatitude>85</northBoundLatitude>
      </EX_GeographicBoundingBox>
      <BoundingBox CRS="EPSG:3857" minx="${WORLD3857[0]}" miny="${WORLD3857[1]}" maxx="${WORLD3857[2]}" maxy="${WORLD3857[3]}"/>
      ${layersXml}
    </Layer>
  </Capability>
</WMS_Capabilities>`;
}

/* ---------- Server ---------- */
const app = express();
app.disable("x-powered-by");
app.use((_,res,next)=>{ res.setHeader("Access-Control-Allow-Origin","*"); next(); });
app.use(wmsLogMiddleware);

app.get("/wms", async (req, res) => {
  try {
    const P = parseParams(req.query);
    const SERVICE = (P.SERVICE || "WMS").toUpperCase();
    const REQUEST = (P.REQUEST || "").toUpperCase();
    if (SERVICE !== "WMS") return res.status(400).send("Invalid SERVICE");

    const baseUrl = `${req.protocol}://${req.get("host")}${req.path}`;

    if (!REQUEST || REQUEST === "GETCAPABILITIES") {
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(capabilities(baseUrl));
    }
    if (REQUEST !== "GETMAP") return res.status(400).send("Unsupported REQUEST");

    const LAYER  = (P.LAYERS || "lage:all").split(",")[0];
    const WIDTH  = Math.max(1, parseInt(P.WIDTH || "1024", 10));
    const HEIGHT = Math.max(1, parseInt(P.HEIGHT || "768", 10));
    const CRS    = P.CRS || P.SRS || "EPSG:3857";
    const BBOX   = (P.BBOX || "").split(",").map(Number);
    const FORMAT = (P.FORMAT || "image/png").toLowerCase();
    const TRANSPARENT = (P.TRANSPARENT || "TRUE").toUpperCase() === "TRUE";
    if (!(BBOX.length === 4 && BBOX.every(Number.isFinite))) return res.status(400).send("Invalid BBOX");
    if (FORMAT !== "image/png") return res.status(400).send("FORMAT not supported (image/png)");

    // Canvas
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");
    if (!TRANSPARENT) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,WIDTH,HEIGHT); }

    const proj = projPixel(CRS, BBOX, WIDTH, HEIGHT);

    // Daten laden
    const data = await loadData();
    const { incidents, incidentPos, vehicles, assignedById } = data;

    // Für Orbit: pro Incident deterministic ordering (wie MapModal: sort by vehicle id)
    const nonGpsByIncident = new Map(); // incidentId -> [vehicleId...]
    for (const v of vehicles) {
      const vid = String(v.id);
      const ass = assignedById.get(vid);
      if (!ass) continue;
      const assKey = String(ass);
      // Prüfen ob GPS/Override existiert – wenn nein, gehört es in den Orbit-Pool
      const { pos, source } = vehiclePosition(v, data, new Map());
      if (!pos || source === "orbit") {
        const arr = nonGpsByIncident.get(assKey) || [];
        arr.push(vid);
        nonGpsByIncident.set(assKey, arr);
      }
    }
    for (const [incId, arr] of nonGpsByIncident.entries()) {
      arr.sort(); // deterministisch
    }

    // 1) Incidents
    if (LAYER === "lage:incidents" || LAYER === "lage:all") {
      for (const c of incidents) {
        const p = incidentPos.get(String(c.id));
        if (!p) continue;
        const [x,y] = proj([p.lng, p.lat]);
        drawPoint(ctx, x, y, { fill: S_INC_FILL, stroke: S_INC_STROKE, radius: S_INC_R, lineWidth: 2 });
      }
    }

    // 2) Vehicles
    if (LAYER === "lage:vehicles" || LAYER === "lage:all") {
      for (const v of vehicles) {
        const vid = String(v.id);

        // Ring-Indexliste an vehiclePosition übergeben
        const ringIndexMap = new Map();
        for (const [incId, arr] of nonGpsByIncident.entries()) ringIndexMap.set(incId, arr);

        const resPos = vehiclePosition(v, data, ringIndexMap);
        if (!resPos.pos) continue;

        const [x,y] = proj([resPos.pos.lng, resPos.pos.lat]);
        drawPoint(ctx, x, y, { fill: S_VEH_FILL, stroke: S_VEH_STROKE, radius: S_VEH_R, lineWidth: 2 });

        if (LABELS_ENABLED) {
          const label = v?.label || v?.id || "Fahrzeug";
          const unit  = v?.ort || "";
          const txt   = trimLabel(unit ? `${label} (${unit})` : label);
          drawText(ctx, txt, x + 10, y - 6, "left", "middle");
        }
      }
    }

    const buffer = canvas.toBuffer("image/png");
    res.set("Content-Type", "image/png");
    return res.send(buffer);

  } catch (e) {
    console.error("[WMS ERROR]", e.stack || e.message);
    res.status(500).send("WMS error");
  }
});

const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`[WMS] http://${HOST}:${PORT}/wms?service=WMS&request=GetCapabilities`);
  console.log(`[WMS] DATA_DIR = ${DATA_DIR}`);
});
