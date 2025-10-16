#!/usr/bin/env node
/**
 * wms-board-lite.mjs — Canvas-freier „WMS“-Lite:
 *  - GET /wms?service=WMS&request=GetCapabilities  -> WMS 1.3.0 Capabilities (XML)
 *  - GET /geojson?layers=lage:all|lage:incidents|lage:vehicles[&crs=EPSG:4326|3857&bbox=minx,miny,maxx,maxy]
 *    -> FeatureCollection mit MapModal-Positionslogik (GPS > Override > Orbit > Group)
 *
 * ENV:
 *  - WMS_PORT (default 8090)
 *  - DATA_DIR (default ./data)
 *
 * Abhängigkeiten: express, proj4
 */
import express from "express";
import fsp from "fs/promises";
import path from "path";
import url from "url";
import proj4 from "proj4";

// --- Setup ---
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PORT     = Number(process.env.WMS_PORT || 8090);
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

// Daten-Dateien
const f = (p) => path.join(DATA_DIR, p);
const BOARD_FILE   = f("board.json");
const VEH_BASE     = f("vehicles.json");
const VEH_EXTRA    = f("vehicles-extra.json");
const GPS_FILE     = f("vehicles_gps.json");
const OVERRIDES    = f("vehicles-overrides.json");
const GROUPS_FILE  = f("group_locations.json");

// Proj-Defs
const EPSG4326 = "+proj=longlat +datum=WGS84 +no_defs";
const EPSG3857 = "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

// Utils
const norm = (s) => String(s || "").trim().toLowerCase();

function offsetLatLng(origin, meters, bearingDeg) {
  const R = 6371000;
  const br = bearingDeg * Math.PI / 180;
  const lat1 = origin.lat * Math.PI / 180;
  const lng1 = origin.lng * Math.PI / 180;
  const dr = meters / R;
  const lat2 = Math.asin(Math.sin(lat1)*Math.cos(dr) + Math.cos(lat1)*Math.sin(dr)*Math.cos(br)) * 180/Math.PI;
  const lng2 = (lng1 + Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(lat1), Math.cos(dr) - Math.sin(lat1)*Math.sin(lat2*Math.PI/180))) * 180/Math.PI;
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

  const incidentPos = new Map(incidents.map(i => [String(i.id), { lat: +i.latitude, lng: +i.longitude }]));

  // vehicleId -> incidentId
  const assignedById = new Map();
  for (const i of incidents) for (const vid of (i.assignedVehicles || [])) assignedById.set(String(vid), i.id);

  // GPS nach "realname" (label+ort)
  const gpsByKey = new Map(
    gpsList.filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lng) && g?.realname)
           .map(g => [norm(g.realname), { lat: +g.lat, lng: +g.lng }])
  );

  // Gruppenkoords (Ort)
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
  const key = norm(`${v?.label || ""} ${v?.ort || ""}`);

  // 1) GPS
  const gps = gpsByKey.get(key);
  if (gps) return { pos: gps, source: "gps", assignedIncident };

  // 2) Override
  const ov = overrides[vid];
  if (ov && Number.isFinite(ov.lat) && Number.isFinite(ov.lng)) {
    return { pos: { lat: +ov.lat, lng: +ov.lng }, source: ov.source || "manual", assignedIncident };
  }

  // 3) Zugeordnet -> Orbit
  if (assignedIncident && incidentPos.has(assignedIncident)) {
    const pool = ringOrder.get(assignedIncident) || [];
    const idx = pool.indexOf(vid);
    const angle = ((idx + 1) * ORBIT_STEP_DEG) % 360;
    const center = incidentPos.get(assignedIncident);
    return { pos: offsetLatLng(center, ORBIT_RADIUS_M, angle), source: "orbit", assignedIncident };
  }

  // 4) Unzugeordnet -> Gruppenstandort
  const gp = groups.get(v?.ort || "");
  if (gp) return { pos: gp, source: "group", assignedIncident: null };

  return { pos: null, source: "none", assignedIncident: null };
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

// --- Server ---
const app = express();
app.disable("x-powered-by");

// ----- /wms (GetCapabilities, GetMap->501) -----
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
    <Title>Lagekarte WMS-lite (GeoJSON)</Title>
    <Abstract>GetMap nicht verfügbar; bitte /geojson nutzen.</Abstract>
    <OnlineResource xlink:type="simple" xlink:href="${baseUrl}"/>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <Format>application/vnd.ogc.wms_xml</Format>
        <Format>text/xml</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${baseUrl}"/></Get></HTTP></DCPType>
      </GetCapabilities>
      <GetMap>
        <Format>image/png</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${baseUrl}"/></Get></HTTP></DCPType>
      </GetMap>
      <GetFeatureInfo>
        <Format>text/xml</Format>
        <Format>text/plain</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${baseUrl}"/></Get></HTTP></DCPType>
      </GetFeatureInfo>
    </Request>
    <Exception>
      <Format>application/vnd.ogc.se_xml</Format>
      <Format>text/xml</Format>
      <Format>XML</Format>
    </Exception>
    <Layer>
      <Title>Lagekarte</Title>
      <CRS>EPSG:3857</CRS>
      <CRS>EPSG:4326</CRS>
      <EX_GeographicBoundingBox>
        <westBoundLongitude>-180</westBoundLongitude>
        <eastBoundLongitude>180</eastBoundLongitude>
        <southBoundLatitude>-85</southBoundLatitude>
        <northBoundLatitude>85</northBoundLatitude>
      </EX_GeographicBoundingBox>
      <BoundingBox CRS="EPSG:3857" minx="${WORLD3857[0]}" miny="${WORLD3857[1]}" maxx="${WORLD3857[2]}" maxy="${WORLD3857[3]}"/>
      <Layer queryable="1"><Name>lage:all</Name><Title>Alle</Title></Layer>
      <Layer queryable="1"><Name>lage:incidents</Name><Title>Einsätze</Title></Layer>
      <Layer queryable="1"><Name>lage:vehicles</Name><Title>Fahrzeuge</Title></Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;
}

app.get("/wms", (req, res) => {
  const Q = {};
  for (const [k, v] of Object.entries(req.query)) Q[k.toUpperCase()] = Array.isArray(v) ? v[0] : v;
  const SERVICE = (Q.SERVICE || "WMS").toUpperCase();
  const REQUEST = (Q.REQUEST || "").toUpperCase();
  if (SERVICE !== "WMS") return res.status(400).send("Invalid SERVICE");

  const baseUrl = `${req.protocol}://${req.get("host")}${req.path}?service=WMS&request=GetCapabilities`;
  if (!REQUEST || REQUEST === "GETCAPABILITIES") {
    const xml = wmsCapabilitiesXML(baseUrl);
    res.setHeader("Content-Type", "application/vnd.ogc.wms_xml; charset=utf-8");
    return res.send(xml);
  }
  if (REQUEST === "GETMAP") {
    return res.status(501).send("GetMap not implemented in WMS-lite. Use /geojson.");
  }
  return res.status(400).send("Unsupported REQUEST");
});

// ----- /geojson -----
app.get("/geojson", async (req, res) => {
  try {
    const layers = String(req.query.layers || "lage:all").split(",")[0];
    const crs    = String(req.query.crs || "EPSG:4326").toUpperCase();
    const bbox   = req.query.bbox ? String(req.query.bbox).split(",").map(Number) : null;

    const data = await loadData();
    const { incidents, incidentPos, vehicles, assignedById } = data;

    // deterministische Ring-Order pro Einsatz
    const nonGpsByIncident = new Map();
    for (const v of vehicles) {
      const vid = String(v.id);
      const ass = assignedById.get(vid);
      if (!ass) continue;
      const key = norm(`${v?.label || ""} ${v?.ort || ""}`);
      const hasGps = data.gpsByKey.has(key);
      const hasOv  = !!data.overrides[vid];
      if (!hasGps && !hasOv) {
        const arr = nonGpsByIncident.get(ass) || [];
        arr.push(vid);
        nonGpsByIncident.set(ass, arr);
      }
    }
    for (const [id, arr] of nonGpsByIncident.entries()) arr.sort();

    const filter = bboxFilter(crs, bbox);
    const features = [];

    // Einsätze
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
            typ: i.typ || i.content || null,
            title: i.content || i.typ || "",
            ort: i.ort || "",
            alerted: i.alerted ?? null,
            assignedVehicles: i.assignedVehicles || []
          },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] }
        });
      }
    }

    // Fahrzeuge
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
            label: v.label || v.id,
            unit: v.ort || null,
            status: pos.assignedIncident ? "assigned" : "free",
            positionSource: pos.source,
            assignedIncident: pos.assignedIncident || null
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

// ----- Start -----
app.listen(PORT, () => {
  console.log(`[WMS-lite] GetCapabilities: http://localhost:${PORT}/wms?service=WMS&request=GetCapabilities`);
  console.log(`[WMS-lite] GeoJSON:        http://localhost:${PORT}/geojson?layers=lage:all`);
});
