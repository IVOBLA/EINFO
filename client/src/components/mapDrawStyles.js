// MapboxDraw styles compatible with MapLibre GL.
// All line-dasharray values are wrapped in ["literal", ...] to prevent
// MapLibre from misinterpreting plain arrays as expressions.

export const DRAW_STYLES = [
  // inactive polygon fill
  {
    id: "gl-draw-polygon-fill",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
    paint: { "fill-color": "#3bb2d0", "fill-opacity": 0.1 },
  },
  // active polygon fill
  {
    id: "gl-draw-polygon-fill-active",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
    paint: { "fill-color": "#fbb03b", "fill-opacity": 0.1 },
  },

  // polygon outline (cold)
  {
    id: "gl-draw-polygon-stroke",
    type: "line",
    filter: [
      "all",
      ["==", "$type", "Polygon"],
      ["!=", "active", "true"],
      ["!=", "mode", "static"],
    ],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#3bb2d0", "line-width": 2 },
  },
  // polygon outline (hot)
  {
    id: "gl-draw-polygon-stroke-active",
    type: "line",
    filter: [
      "all",
      ["==", "$type", "Polygon"],
      ["==", "active", "true"],
      ["!=", "mode", "static"],
    ],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fbb03b", "line-width": 2 },
  },

  // lines (cold) – dasharray wrapped in literal
  {
    id: "gl-draw-lines-cold",
    type: "line",
    filter: [
      "all",
      ["==", "$type", "LineString"],
      ["!=", "active", "true"],
      ["!=", "mode", "static"],
    ],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#3bb2d0",
      "line-width": 2,
      "line-dasharray": ["literal", [0.2, 2]],
    },
  },
  // lines (hot)
  {
    id: "gl-draw-lines-hot",
    type: "line",
    filter: [
      "all",
      ["==", "$type", "LineString"],
      ["==", "active", "true"],
      ["!=", "mode", "static"],
    ],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#fbb03b",
      "line-width": 2,
      "line-dasharray": ["literal", [0.2, 2]],
    },
  },

  // vertex points
  {
    id: "gl-draw-points",
    type: "circle",
    filter: [
      "all",
      ["==", "$type", "Point"],
      ["!=", "meta", "midpoint"],
      ["!=", "mode", "static"],
    ],
    paint: {
      "circle-radius": 5,
      "circle-color": "#fbb03b",
    },
  },

  // midpoints
  {
    id: "gl-draw-midpoints",
    type: "circle",
    filter: [
      "all",
      ["==", "$type", "Point"],
      ["==", "meta", "midpoint"],
      ["!=", "mode", "static"],
    ],
    paint: { "circle-radius": 4, "circle-color": "#fbb03b" },
  },
];
