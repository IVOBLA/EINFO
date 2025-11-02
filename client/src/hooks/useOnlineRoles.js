import { useEffect, useMemo, useRef, useState } from "react";
import { fetchOnlineRoles } from "../api.js";

const DEFAULT_POLL_INTERVAL_MS = 15000;

function normalizeRoles(value) {
  const list = Array.isArray(value) ? value : [];
  const set = new Set();
  for (const entry of list) {
    const id = typeof entry === "string"
      ? entry.trim().toUpperCase()
      : typeof entry?.id === "string"
        ? entry.id.trim().toUpperCase()
        : "";
    if (id) set.add(id);
  }
  return [...set];
}

export default function useOnlineRoles({ pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    const load = async () => {
      try {
        const result = await fetchOnlineRoles();
        if (!activeRef.current) return;
        setRoles(normalizeRoles(result));
        setError(null);
      } catch (err) {
        if (!activeRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!activeRef.current) return;
        if (Number.isFinite(pollIntervalMs) && pollIntervalMs > 0) {
          timerRef.current = setTimeout(load, pollIntervalMs);
        }
      }
    };

    load();

    return () => {
      activeRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [pollIntervalMs]);

  const roleSet = useMemo(() => new Set(roles), [roles]);

  return { roles, roleSet, error };
}
