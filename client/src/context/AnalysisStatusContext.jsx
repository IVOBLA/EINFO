import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { buildChatbotApiUrl } from "../utils/http.js";

const AnalysisStatusContext = createContext({
  analysisInProgress: false,
  timerStatus: null,
  connected: false,
});

export function useAnalysisStatus() {
  return useContext(AnalysisStatusContext);
}

/**
 * Globaler Provider fuer den Analyse-Status.
 * Verbindet sich per SSE zu /api/situation/analysis/status/stream und haelt
 * analysisInProgress + timerStatus immer aktuell – unabhaengig davon, ob das
 * SituationAnalysisPanel geoeffnet ist.
 *
 * Fallback: Bei SSE-Fehler wird auf leichtgewichtiges Polling (alle 5 Sekunden) umgestellt.
 */
export default function AnalysisStatusProvider({ role, enabled = true, children }) {
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [timerStatus, setTimerStatus] = useState(null);
  const [connected, setConnected] = useState(false);

  const eventSourceRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const roleRef = useRef(role);
  roleRef.current = role;

  // ---- Fallback: polling-only status fetch ----
  const fetchStatusOnly = useCallback(async () => {
    if (!roleRef.current) return;
    try {
      const url = buildChatbotApiUrl(
        `/api/situation/analysis?role=${encodeURIComponent(roleRef.current)}&cacheOnly=true`
      );
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return;
      const data = await res.json().catch(() => null);
      if (!data) return;

      if (data.timer) {
        setTimerStatus((prev) => {
          const next = data.timer;
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }

      const nextInProgress = !!(data.analysisInProgress || data.timer?.analysisInProgress);
      setAnalysisInProgress((prev) => (prev === nextInProgress ? prev : nextInProgress));
    } catch {
      // silent
    }
  }, []);

  const startPollingFallback = useCallback(() => {
    if (pollIntervalRef.current) return; // already polling
    // immediate fetch
    fetchStatusOnly();
    pollIntervalRef.current = setInterval(fetchStatusOnly, 5000);
  }, [fetchStatusOnly]);

  const stopPollingFallback = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // ---- SSE connection management ----
  useEffect(() => {
    if (!enabled || !role) {
      // cleanup
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPollingFallback();
      setConnected(false);
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      // Close previous
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      try {
        const url = buildChatbotApiUrl(
          `/api/situation/analysis/status/stream?role=${encodeURIComponent(role)}`
        );
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.addEventListener("status", (event) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(event.data);

            if (data.timer) {
              setTimerStatus((prev) => {
                const next = data.timer;
                return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
              });
            }

            const nextInProgress = !!(data.analysisInProgress || data.timer?.analysisInProgress);
            setAnalysisInProgress((prev) => (prev === nextInProgress ? prev : nextInProgress));
          } catch {
            // ignore parse errors
          }
        });

        es.onopen = () => {
          if (cancelled) return;
          setConnected(true);
          // SSE working -> stop polling fallback
          stopPollingFallback();
        };

        es.onerror = () => {
          if (cancelled) return;
          setConnected(false);
          // SSE broke -> start polling fallback
          startPollingFallback();
        };
      } catch {
        // EventSource not available -> fallback
        startPollingFallback();
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPollingFallback();
      setConnected(false);
    };
  }, [role, enabled, stopPollingFallback, startPollingFallback]);

  const value = { analysisInProgress, timerStatus, connected };

  return (
    <AnalysisStatusContext.Provider value={value}>
      {children}
    </AnalysisStatusContext.Provider>
  );
}
