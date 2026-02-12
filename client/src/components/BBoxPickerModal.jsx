import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { DRAW_STYLES } from "./mapDrawStyles.js";

const DEFAULT_CENTER = [13.85, 46.72];
const DEFAULT_ZOOM = 12;

const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

function formatBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return "—";
  return bbox.map((value) => Number(value).toFixed(5)).join(", ");
}

function polygonFromBbox(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    },
  };
}

function bboxFromPolygon(feature) {
  if (!feature || feature.geometry?.type !== "Polygon") return null;
  const coords = feature.geometry.coordinates?.[0];
  if (!Array.isArray(coords) || coords.length < 4) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  if (!(minLon < maxLon && minLat < maxLat)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

async function geocodeAddress(query) {
  if (!query) return [];
  if (window.google?.maps?.Geocoder) {
    const geocoder = new window.google.maps.Geocoder();
    return new Promise((resolve) => {
      geocoder.geocode({ address: query, region: "AT" }, (results, status) => {
        if (status !== "OK" || !Array.isArray(results)) {
          resolve([]);
          return;
        }
        resolve(
          results.slice(0, 5).map((result) => ({
            label: result.formatted_address || query,
            lat: result.geometry?.location?.lat?.(),
            lon: result.geometry?.location?.lng?.(),
          }))
        );
      });
    });
  }
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "at");
  url.searchParams.set("limit", "5");
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error("Adresssuche fehlgeschlagen");
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((entry) => ({
    label: entry.display_name || query,
    lat: Number(entry.lat),
    lon: Number(entry.lon),
  }));
}

export default function BBoxPickerModal({ open, initialBbox, onCancel, onSave }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const [bbox, setBbox] = useState(initialBbox ?? null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const formattedBbox = useMemo(() => formatBbox(bbox), [bbox]);

  useEffect(() => {
    if (!open) {
      setSearchTerm("");
      setSearchResults([]);
      setSearchError("");
      setSaveError("");
      setSearching(false);
      setSaving(false);
      return;
    }
    setBbox(initialBbox ?? null);
  }, [open, initialBbox]);

  useEffect(() => {
    if (!open || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OSM_RASTER_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 19,
    });
    mapRef.current = map;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      styles: DRAW_STYLES,
    });
    drawRef.current = draw;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    try {
      map.addControl(draw, "top-left");
    } catch (err) {
      console.error("[BBoxPickerModal] Failed to add draw control:", err);
    }

    const syncFromDraw = (event) => {
      const features =
        event?.features?.length > 0 ? event.features : draw.getAll().features;
      if (!features.length) {
        setBbox(null);
        return;
      }
      const nextBbox = bboxFromPolygon(features[features.length - 1]);
      setBbox(nextBbox);
    };

    map.on("draw.create", syncFromDraw);
    map.on("draw.update", syncFromDraw);
    map.on("draw.delete", () => setBbox(null));

    map.once("load", () => {
      if (Array.isArray(initialBbox) && initialBbox.length === 4) {
        draw.add(polygonFromBbox(initialBbox));
        map.fitBounds(
          [
            [initialBbox[0], initialBbox[1]],
            [initialBbox[2], initialBbox[3]],
          ],
          { padding: 40, duration: 0, maxZoom: 19 }
        );
      }
    });

    return () => {
      try {
        map.remove();
      } catch (err) {
        console.error("[BBoxPickerModal] Error during map cleanup:", err);
      }
      mapRef.current = null;
      drawRef.current = null;
    };
  }, [open, initialBbox]);

  const handleSearchSubmit = async (event) => {
    event.preventDefault();
    const query = searchTerm.trim();
    if (!query) return;
    setSearching(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const results = await geocodeAddress(query);
      setSearchResults(
        results.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
      );
      if (!results.length) {
        setSearchError("Keine Treffer gefunden.");
      }
    } catch (err) {
      setSearchError(err?.message || "Adresssuche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  };

  const handleResultClick = (result) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: [result.lon, result.lat],
      zoom: 18,
      essential: true,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await onSave?.(bbox);
    } catch (err) {
      setSaveError(err?.message || "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white w-full max-w-4xl rounded-xl shadow-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Bereich wählen (BBox)</h2>

        <form className="space-y-2" onSubmit={handleSearchSubmit}>
          <label className="block text-sm font-medium">
            Adresse
            <div className="flex gap-2 mt-1">
              <input
                className="flex-1 border rounded px-2 py-1 text-sm"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Adresse suchen…"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-sm rounded bg-gray-200 hover:bg-gray-300"
                disabled={searching}
              >
                {searching ? "Suche…" : "Suchen"}
              </button>
            </div>
          </label>
          {searchError && <div className="text-sm text-red-600">{searchError}</div>}
          {!!searchResults.length && (
            <div className="border rounded bg-white shadow-sm max-h-40 overflow-y-auto">
              {searchResults.map((result, index) => (
                <button
                  key={`${result.label}-${index}`}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                  onClick={() => handleResultClick(result)}
                >
                  {result.label}
                </button>
              ))}
            </div>
          )}
        </form>

        <div className="mt-3 h-[360px] border rounded overflow-hidden" ref={mapContainerRef} />

        <div className="mt-3 text-sm text-gray-700">
          Aktuelle BBox: <span className="font-mono">{formattedBbox}</span>
        </div>

        {saveError && <div className="text-sm text-red-600 mt-2">{saveError}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            className="px-3 py-2 rounded border"
            type="button"
            onClick={onCancel}
            disabled={saving}
          >
            Abbrechen
          </button>
          <button
            className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
            type="button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
