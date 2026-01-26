import { useEffect, useState } from "react";
import { buildChatbotApiUrl } from "../utils/http.js";

const DEFAULT_STATE = {
  running: false,
  paused: false,
  loaded: false,
};

export default function useSimulationStatus({ pollIntervalMs = 15000 } = {}) {
  const [status, setStatus] = useState(DEFAULT_STATE);

  useEffect(() => {
    let mounted = true;
    let intervalId;

    const loadStatus = async () => {
      try {
        const res = await fetch(buildChatbotApiUrl("/api/sim/status"), {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const sim = data?.simulation || {};
        if (mounted) {
          setStatus({
            running: Boolean(sim.running),
            paused: Boolean(sim.paused),
            loaded: true,
          });
        }
      } catch (error) {
        if (mounted) {
          setStatus((prev) => ({ ...prev, loaded: true }));
        }
      }
    };

    void loadStatus();
    intervalId = window.setInterval(loadStatus, pollIntervalMs);

    return () => {
      mounted = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [pollIntervalMs]);

  return status;
}
