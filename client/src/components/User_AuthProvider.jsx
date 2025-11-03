import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { User_me, User_login, User_logout } from "../utils/User_auth";

const Ctx = createContext(null);
export const useUserAuth = () => useContext(Ctx);

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000;
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "wheel",
];

function normalizeSessionInfo(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      idleTimeoutSeconds: Math.round(DEFAULT_IDLE_TIMEOUT_MS / 1000),
      lastSeenIso: null,
      expiresAtIso: null,
    };
  }
  const rawMs = Number(raw.idleTimeoutMs);
  const rawSeconds = Number(raw.idleTimeoutSeconds);
  let idleTimeoutMs = Number.isFinite(rawMs) && rawMs > 0 ? rawMs : undefined;
  if (!idleTimeoutMs && Number.isFinite(rawSeconds) && rawSeconds > 0) {
    idleTimeoutMs = rawSeconds * 1000;
  }
  if (!idleTimeoutMs || !Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
  }
  const idleTimeoutSeconds = Number.isFinite(rawSeconds) && rawSeconds > 0
    ? rawSeconds
    : Math.round(idleTimeoutMs / 1000);
  const lastSeenIso = typeof raw.lastSeenIso === "string" ? raw.lastSeenIso : null;
  const expiresAtIsoRaw = typeof raw.expiresAtIso === "string"
    ? raw.expiresAtIso
    : (typeof raw.expiresAt === "string" ? raw.expiresAt : null);
  return {
    idleTimeoutMs,
    idleTimeoutSeconds,
    lastSeenIso,
    expiresAtIso: expiresAtIsoRaw,
  };
}

export default function User_AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [ready, setReady] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const idleLogoutRef = useRef(false);

  const applyAuthPayload = useCallback((payload) => {
    if (payload && typeof payload === "object") {
      const { session, ...userData } = payload;
      setUser(userData);
      const normalized = normalizeSessionInfo(session);
      setSessionInfo(normalized);
      lastActivityRef.current = Date.now();
      return { user: userData, session: normalized };
    }
    setUser(null);
    setSessionInfo(null);
    lastActivityRef.current = Date.now();
    return { user: null, session: null };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await User_me();
        if (!cancelled) applyAuthPayload(me);
      } catch {
        if (!cancelled) applyAuthPayload(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAuthPayload]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__APP_AUTH__ = window.__APP_AUTH__ || {};
      window.__APP_AUTH__.user = user || null;
      window.__APP_AUTH__.session = sessionInfo || null;
      if (user) {
        window.__USER__ = user;
        try {
          localStorage.setItem("auth.user", JSON.stringify(user));
        } catch {
          /* ignore */
        }
      } else {
        delete window.__USER__;
        try {
          localStorage.removeItem("auth.user");
        } catch {
          /* ignore */
        }
      }
    }
  }, [user, sessionInfo]);

  const login = useCallback(async (username, password) => {
    const payload = await User_login(username, password);
    applyAuthPayload(payload);
    return payload;
  }, [applyAuthPayload]);

  const logout = useCallback(async (options = {}) => {
    const opts = typeof options === "object" && options ? options : {};
    const silent = opts.silent === true;
    let error = null;
    try {
      await User_logout();
    } catch (err) {
      error = err;
      if (!silent) {
        console.error(err);
      }
    }
    applyAuthPayload(null);
    if (error && !silent) {
      throw error;
    }
    return true;
  }, [applyAuthPayload]);

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!user) {
      idleLogoutRef.current = false;
      return () => {};
    }

    markActivity();

    const onActivity = (event) => {
      if (event?.type === "visibilitychange") {
        if (!document.hidden) markActivity();
        return;
      }
      markActivity();
    };

    ACTIVITY_EVENTS.forEach((ev) => document.addEventListener(ev, onActivity, true));
    window.addEventListener("focus", onActivity, true);
    document.addEventListener("visibilitychange", onActivity, true);

    let timer = null;
    const limit = sessionInfo?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (Number.isFinite(limit) && limit > 0) {
      const interval = Math.min(60_000, Math.max(5_000, Math.floor(limit / 3)));
      timer = setInterval(() => {
        const threshold = sessionInfo?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        if (!Number.isFinite(threshold) || threshold <= 0) {
          return;
        }
        const idleFor = Date.now() - lastActivityRef.current;
        if (idleFor >= threshold && !idleLogoutRef.current) {
          idleLogoutRef.current = true;
          logout({ silent: true }).finally(() => {
            idleLogoutRef.current = false;
          });
        }
      }, interval);
    }

    return () => {
      ACTIVITY_EVENTS.forEach((ev) =>
        document.removeEventListener(ev, onActivity, true),
      );
      window.removeEventListener("focus", onActivity, true);
      document.removeEventListener("visibilitychange", onActivity, true);
      if (timer) clearInterval(timer);
    };
  }, [user, sessionInfo, markActivity, logout]);

  return (
    <Ctx.Provider value={{ user, ready, login, logout, session: sessionInfo }}>
      {children}
    </Ctx.Provider>
  );
}

export function User_SessionGate({ children, fallback }) {
  const { user, ready } = useUserAuth();
  if (!ready) return null;
  if (!user) return fallback ?? <div style={{ padding: 16 }}>Bitte einloggen…</div>;
  return children;
}
