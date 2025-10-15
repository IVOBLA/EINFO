// client/src/hooks/usePlacesAutocomplete.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGmapsPlacesIfNeeded, getPlacesKey } from "../utils/places";

/**
 * Google Places Autocomplete (nur Österreich) mit:
 *  - automatischem Laden des Google-Places-Skripts
 *  - Debounce
 *  - Session-Token (Autocomplete + Details teilen sich ein Token)
 *  - Länder-Restriktion (AT)
 */
export function usePlacesAutocomplete({
  debounceMs = 300,
  country = "at",
  minLength = 3, // erst ab 3 Zeichen suchen (empfohlen)
} = {}) {
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const serviceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const inputElRef = useRef(null);

  // Script laden + Services initialisieren
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Google Places laden (nur einmal pro Seite)
      const ok = await loadGmapsPlacesIfNeeded(getPlacesKey());
      if (cancelled || !ok || !window.google?.maps?.places) return;

      // Services/Token initialisieren
      serviceRef.current = new google.maps.places.AutocompleteService();
      placesServiceRef.current = new google.maps.places.PlacesService(
        document.createElement("div")
      );
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Session-Token resetten (z. B. bei neuem Einsatz)
  const resetSession = useCallback(() => {
    if (window.google?.maps?.places) {
      sessionTokenRef.current =
        new google.maps.places.AutocompleteSessionToken();
    }
  }, []);

  // Debounce-Helfer
  const debounced = useRef();
  useEffect(() => {
    if (!debounced.current) {
      debounced.current = (fn, delay) => {
        let t;
        return (...args) => {
          clearTimeout(t);
          t = setTimeout(() => fn(...args), delay);
        };
      };
    }
  }, []);

  const doFetch = useCallback(
    async (text) => {
      if (!ready || !serviceRef.current) return;
      const q = (text || "").trim();
      if (!q || q.length < minLength) {
        setPredictions([]);
        return;
      }

      setLoading(true);
      setError(null);

      serviceRef.current.getPlacePredictions(
        {
          input: q,
          sessionToken: sessionTokenRef.current,
          componentRestrictions: { country },
          // "address" liefert übliche Adressvorschläge, "geocode" wäre eine Alternative
          types: ["address"],
        },
        (res, status) => {
          setLoading(false);
          if (status !== google.maps.places.PlacesServiceStatus.OK || !res) {
            setPredictions([]);
            if (status && status !== "ZERO_RESULTS") setError(status);
            return;
          }
          setPredictions(res);
        }
      );
    },
    [country, minLength, ready]
  );

  const fetchDebounced = useMemo(() => {
    if (!debounced.current) return () => {};
    return debounced.current(doFetch, debounceMs);
  }, [doFetch, debounceMs]);

  // Query-Änderungen -> Debounced-Fetch
  useEffect(() => {
    fetchDebounced(query);
  }, [query, fetchDebounced]);

  // Place Details mit gleichem Session-Token abfragen
  const getDetailsByPlaceId = useCallback(
    (placeId, fields = ["formatted_address", "geometry", "address_components"]) => {
      return new Promise((resolve, reject) => {
        if (!ready || !placesServiceRef.current) {
          reject(new Error("Google Places nicht bereit"));
          return;
        }
        placesServiceRef.current.getDetails(
          {
            placeId,
            fields,
            sessionToken: sessionTokenRef.current,
          },
          (place, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
              return reject(new Error(status || "DETAILS_FAILED"));
            }
            resolve(place);
          }
        );
      });
    },
    [ready]
  );

  return {
    // state
    ready,
    query,
    setQuery,
    predictions,
    loading,
    error,

    // actions
    resetSession,
    getDetailsByPlaceId,

    // optional
    inputElRef,
  };
}
