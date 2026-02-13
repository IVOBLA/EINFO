import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserAuth } from "./User_AuthProvider.jsx";
import {
  getLastChangeInfo,
  loadSeenEntries,
  resolveSeenStorageKey,
} from "../utils/protokollSeen.js";
import { playGong } from "../sound";

/**
 * Unread protocol badge for the Aufgabenboard header.
 *
 * Shows a clickable icon with a count badge when there are unread
 * protocol entries whose `ergehtAn` array contains the given roleId.
 *
 * Props:
 *  - roleId  : current role id string (e.g. "S2")
 *  - className: optional extra CSS classes
 */
export default function UnreadProtocolIndicator({ roleId, className, openInNewTab = true, scope = "role" }) {
  const { user } = useUserAuth() || {};
  const seenStorageKey = useMemo(() => resolveSeenStorageKey(user), [user]);
  const [seenEntries, setSeenEntries] = useState({});
  const [protocolData, setProtocolData] = useState([]);
  const prevUnreadRef = useRef(0);
  const initialLoadRef = useRef(true);
  const savedTitleRef = useRef(null);
  const socketRef = useRef(null);

  // Load seen entries from localStorage
  useEffect(() => {
    if (!seenStorageKey) {
      setSeenEntries({});
      return;
    }
    setSeenEntries(loadSeenEntries(seenStorageKey));
  }, [seenStorageKey]);

  // Listen for storage events (cross-tab + same-tab seen updates)
  useEffect(() => {
    if (!seenStorageKey || typeof window === "undefined") return;
    const handleStorage = (event) => {
      if (event?.key === seenStorageKey) {
        setSeenEntries(loadSeenEntries(seenStorageKey));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [seenStorageKey]);

  // Fetch protocol data
  const fetchProtocol = useCallback(async (signal) => {
    try {
      const res = await fetch("/api/protocol", {
        credentials: "include",
        signal,
      });
      if (!res.ok) return;
      const payload = await res.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setProtocolData(items);
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }, []);

  // Initial load + periodic refresh
  useEffect(() => {
    const controller = new AbortController();
    fetchProtocol(controller.signal);
    const timer = setInterval(() => fetchProtocol(controller.signal), 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [fetchProtocol]);

  // Socket.IO live updates
  useEffect(() => {
    let socket = null;
    let destroyed = false;

    async function connectSocket() {
      try {
        const { io } = await import("socket.io-client");
        if (destroyed) return;
        socket = io({
          path: "/socket.io",
          transports: ["websocket", "polling"],
          withCredentials: true,
        });
        socketRef.current = socket;
        socket.on("protocol:changed", () => {
          const controller = new AbortController();
          fetchProtocol(controller.signal);
        });
      } catch {
        // socket.io-client not available – degrade gracefully
      }
    }

    connectSocket();

    return () => {
      destroyed = true;
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
    };
  }, [fetchProtocol]);

  // Compute unread count
  const unreadCount = useMemo(() => {
    if (!roleId || !protocolData.length) return 0;
    const roleUpper = roleId.toUpperCase();
    let count = 0;
    for (const item of protocolData) {
      if (!Array.isArray(item?.ergehtAn)) continue;
      const match = item.ergehtAn.some(
        (r) => String(r).toUpperCase() === roleUpper
      );
      if (!match) continue;
      const changeInfo = getLastChangeInfo(item);
      const token = changeInfo.token;
      const entryKey = String(item.nr ?? "");
      if (!entryKey) continue;
      const seenToken = seenEntries[entryKey];
      if (seenToken !== token) count++;
    }
    return count;
  }, [roleId, protocolData, seenEntries]);

  // Sound + title effects
  useEffect(() => {
    const prev = prevUnreadRef.current;
    const isInitial = initialLoadRef.current;

    if (!isInitial && unreadCount > prev && unreadCount > 0) {
      playGong().catch(() => {});
    }

    prevUnreadRef.current = unreadCount;
    initialLoadRef.current = false;
  }, [unreadCount]);

  // Update browser tab title
  useEffect(() => {
    if (savedTitleRef.current === null) {
      savedTitleRef.current = document.title;
    }
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) Aufgaben`;
    } else {
      document.title = savedTitleRef.current || "Aufgaben";
    }
    return () => {
      if (savedTitleRef.current !== null) {
        document.title = savedTitleRef.current;
      }
    };
  }, [unreadCount]);

  // Don't render if nothing to show
  if (!unreadCount) return null;

  const tooltipText = `${unreadCount} ungelesene Meldung${unreadCount === 1 ? "" : "en"} für ${roleId} – klicken zum Öffnen (neuer Tab)`;

  const handleClick = () => {
    const targetHash = `/protokoll?role=${encodeURIComponent(roleId)}&scope=${encodeURIComponent(scope)}`;
    if (openInNewTab) {
      const url = `${window.location.pathname}${window.location.search}#${targetHash}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.hash = targetHash;
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={tooltipText}
      aria-label={tooltipText}
      className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg
        bg-amber-100 hover:bg-amber-200 text-amber-700 border border-amber-300
        transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 ${className || ""}`}
    >
      {/* Bell icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {/* Badge */}
      <span
        className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center
          min-w-[20px] h-5 px-1 text-xs font-bold text-white bg-red-500 rounded-full
          ring-2 ring-white"
      >
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    </button>
  );
}
