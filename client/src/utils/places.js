// Einheitlicher Loader für Google Places – einmal pro Seite
let loadingPromise = null;

export function getPlacesKey() {
  const meta = document.querySelector('meta[name="google-places-key"]');
  const key = (window.GMAPS_API_KEY || meta?.content || "").trim();
  return key || "";
}

export async function loadGmapsPlacesIfNeeded(apiKey = getPlacesKey()) {
  if (window.google?.maps?.places) return true;
  if (!apiKey) return false;

  if (loadingPromise) {
    await loadingPromise;
    return !!window.google?.maps?.places;
  }

  loadingPromise = new Promise((resolve, reject) => {
    // Script bereits vorhanden?
    if (document.getElementById("gmap-places")) {
      const wait = () => {
        if (window.google?.maps?.places) resolve(true);
        else setTimeout(wait, 150);
      };
      wait();
      return;
    }
    const s = document.createElement("script");
    s.id = "gmap-places";
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places&language=de`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(!!window.google?.maps?.places);
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });

  try {
    await loadingPromise;
  } catch {
    // noop
  }
  return !!window.google?.maps?.places;
}
