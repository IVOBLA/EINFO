// client/src/utils/uiTheme.js
//
// Zentrale UI-Theme-Verwaltung: Laden, Anwenden, Defaults

const DEFAULT_THEME = {
  colors: {
    col_new: "#dc2626",
    col_progress: "#d97706",
    col_done: "#059669",
    col_accent: "#1e40af",
    col_surface: "rgba(255,255,255,.92)",
    col_surface_hover: "rgba(255,255,255,.98)",
  },
  watermark: {
    image: "/Logo.png",
    opacity: 0.18,
    sizeVw: 90,
    maxPx: 900,
    posX: 50,
    posY: 50,
    grayscale: true,
  },
};

/**
 * Setzt CSS Custom Properties auf document.documentElement basierend auf Theme-Daten
 */
export function applyUiTheme(theme) {
  if (!theme || typeof theme !== "object") return;
  const root = document.documentElement.style;

  // Farben
  const colors = theme.colors || {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === "string" && value.trim()) {
      root.setProperty(`--${key.replace(/_/g, "-")}`, value);
    }
  }

  // Watermark
  const wm = theme.watermark || {};
  if (wm.image) root.setProperty("--wm-image", `url("${wm.image}")`);
  if (wm.opacity != null) root.setProperty("--wm-opacity", String(wm.opacity));
  if (wm.sizeVw != null) root.setProperty("--wm-size-vw", `${wm.sizeVw}vw`);
  if (wm.maxPx != null) root.setProperty("--wm-size-max", `${wm.maxPx}px`);
  if (wm.posX != null) root.setProperty("--wm-pos-x", `${wm.posX}%`);
  if (wm.posY != null) root.setProperty("--wm-pos-y", `${wm.posY}%`);
  root.setProperty("--wm-filter", wm.grayscale ? "grayscale(100%)" : "none");
}

/**
 * Entfernt Theme-Overrides (zurueck zu CSS-Defaults)
 */
export function resetUiThemeToDefaults() {
  const root = document.documentElement.style;
  const props = [
    "--col-new", "--col-progress", "--col-done", "--col-accent",
    "--col-surface", "--col-surface-hover",
    "--wm-image", "--wm-opacity", "--wm-size-vw", "--wm-size-max",
    "--wm-pos-x", "--wm-pos-y", "--wm-filter",
  ];
  props.forEach((p) => root.removeProperty(p));
}

/**
 * Laedt Theme vom Server
 */
export async function fetchUiTheme() {
  const res = await fetch("/api/ui-theme", { credentials: "include" });
  if (!res.ok) throw new Error(`UI-Theme laden fehlgeschlagen: ${res.status}`);
  return res.json();
}

/**
 * Speichert Theme auf Server (nur Admin)
 */
export async function saveUiTheme(theme) {
  const res = await fetch("/api/ui-theme", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(theme),
  });
  if (!res.ok) throw new Error(`UI-Theme speichern fehlgeschlagen: ${res.status}`);
  return res.json();
}

export { DEFAULT_THEME };
