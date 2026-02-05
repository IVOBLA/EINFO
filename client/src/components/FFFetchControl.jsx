import React, { useEffect, useRef, useState } from "react";

const DEFAULT_STATUS_POLL_INTERVAL_MS = 3_000;
const DEFAULT_ACTIVITY_POLL_INTERVAL_MS = 1_000;

function sanitizeInterval(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    const rounded = Math.floor(num);
    return rounded > 0 ? rounded : fallback;
  }
  return fallback;
}

const ENV_STATUS_POLL_INTERVAL_MS = sanitizeInterval(
  import.meta.env?.VITE_STATUS_POLL_INTERVAL_MS,
  DEFAULT_STATUS_POLL_INTERVAL_MS,
);

const ENV_ACTIVITY_POLL_INTERVAL_MS = sanitizeInterval(
  import.meta.env?.VITE_ACTIVITY_POLL_INTERVAL_MS,
  DEFAULT_ACTIVITY_POLL_INTERVAL_MS,
);

export default function FFFetchControl({
  autoEnabled,
  remaining,
  disabled = false,
  showTimer = true,
  showLastLoaded = true,
  onImportInfo,
}) {
  // Laufzustand + globale Creds
  const [running, setRunning] = useState(false);
  const [hasCreds, setHasCreds] = useState(false);
  const [hint, setHint] = useState("");

  // Auto-Stop / Aktivitätsinfos
  const [autoInfo, setAutoInfo] = useState({
    remainingMin: null, // Minuten bis Auto-Stop
    idleMinutes: null,
    lastActivityIso: null,
    autoStopMin: null,
    autoStopEnabled: false,
  });

  // Importinfos
  const [importInfo, setImportInfo] = useState({
    lastLoadedIso: null,
    file: "list_filtered.json",
  });

  useEffect(() => {
    if (typeof onImportInfo === "function") {
      onImportInfo(importInfo);
    }
  }, [importInfo, onImportInfo]);

  // Auto-Import Config (Countdown)
  const [enabled, setEnabled] = useState(false);
  const [intervalSec, setIntervalSec] = useState(30);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [statusPollIntervalMs, setStatusPollIntervalMs] = useState(ENV_STATUS_POLL_INTERVAL_MS);
  const [activityPollIntervalMs, setActivityPollIntervalMs] = useState(ENV_ACTIVITY_POLL_INTERVAL_MS);

  // Einmaliges Prompting-Merkmal (nur noch als Logik-Überbleibsel)
  const didCheckOnce = useRef(false);

  // --- Status & Creds alle 3s ---------------------------------------
  const readStatusAndCreds = async () => {
    try {
      const [s, c, cfg] = await Promise.all([
        fetch("/api/ff/status", { credentials: "include", cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ running: false })),
        fetch("/api/ff/creds", { credentials: "include", cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ has: false })),
        fetch("/api/import/auto-config", { credentials: "include", cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ enabled: false, intervalSec: 30 })),
      ]);
      setRunning(!!s.running);
      setHasCreds(!!c.has);
      setEnabled(!!cfg.enabled);
      setIntervalSec(Number(cfg.intervalSec || 30));
      setStatusPollIntervalMs((prev) => sanitizeInterval(cfg.statusPollIntervalMs, prev));
      setActivityPollIntervalMs((prev) => sanitizeInterval(cfg.activityPollIntervalMs, prev));

      if (!didCheckOnce.current) {
        didCheckOnce.current = true;
        if (!c.has) {
          setHint("Keine globalen Fetcher-Zugangsdaten. Bitte als Admin unter /user-admin setzen.");
        }
      }
    } catch {}
  };

  useEffect(() => {
    void readStatusAndCreds();
    const interval = setInterval(() => {
      void readStatusAndCreds();
    }, statusPollIntervalMs);
    return () => clearInterval(interval);
  }, [statusPollIntervalMs]);

  // --- Aktivität/Auto-Stop + letzte Importzeit sekündlich -----------
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch("/api/activity/status", { credentials: "include", cache: "no-store" });
        if (r.ok) {
          const js = await r.json();

          // Auto-Stop
          const idle = Number(js.idleMinutes);
          const limit = Number(js.autoStopMin);
          const remaining = Math.max(0, Math.ceil(limit - idle));
          setAutoInfo({
            remainingMin: remaining,
            idleMinutes: idle,
            lastActivityIso: js.lastActivityIso,
            autoStopMin: limit,
            autoStopEnabled: !!js?.auto?.enabled,
          });

          // Fetcher-Run + Importinfos
          setRunning(!!js.fetcher?.running);
          setImportInfo({
            lastLoadedIso: js.import?.lastLoadedIso ?? null,
            file: js.import?.file || "list_filtered.json",
          });
        }
      } catch {}
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, activityPollIntervalMs);
    return () => clearInterval(timer);
  }, [activityPollIntervalMs]);

  // --- Countdown "in Xs" --------------------------------------------
  useEffect(() => {
    let timer;
    const tick = () => {
      if (!enabled || !importInfo.lastLoadedIso) {
        setSecondsLeft(null);
        return;
      }
      const last = new Date(importInfo.lastLoadedIso).getTime();
      const next = last + intervalSec * 1000;
      const left = Math.max(0, Math.ceil((next - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [enabled, intervalSec, importInfo.lastLoadedIso]);

  const effectiveEnabled = typeof autoEnabled === "boolean" ? autoEnabled : enabled;
  const displaySecondsLeft =
    typeof remaining === "number" ? remaining : secondsLeft;

  return (
    <div className={`flex items-center h-9 gap-2 ${disabled ? "opacity-60 pointer-events-none" : ""}`} style={{ alignItems: "center" }}>
      {/* Countdown-Chip (wie alt) */}
      {showTimer && (
        <span
          className={`sync-chip ${effectiveEnabled ? "active" : ""}`}
          title={effectiveEnabled ? "Auto-Import Countdown" : "Auto-Import ist deaktiviert"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "110px",
            minWidth: "110px",
            textAlign: "center",
          }}
        >
          {effectiveEnabled ? `⟳ in ${displaySecondsLeft != null ? displaySecondsLeft : "–"}s` : "⏸ manuell"}
        </span>
      )}

      {/* Hinweis (z. B. keine globalen Creds) */}
      {hint && <span style={{ color: "#dc2626", fontSize: 12, marginLeft: 8 }}>{hint}</span>}

      {/* Auto-Stop Countdown (Farbskala) - nur wenn Auto-Stop aktiv */}
      {running && autoInfo.autoStopEnabled && Number.isFinite(autoInfo.autoStopMin) && autoInfo.autoStopMin > 0 && autoInfo.remainingMin != null && autoInfo.remainingMin <= 15 && (
        <div
          title={
            `Letzte Aktivität: ${
              autoInfo.lastActivityIso ? new Date(autoInfo.lastActivityIso).toLocaleString() : "–"
            } • Inaktiv: ${autoInfo.idleMinutes?.toFixed?.(1)} min • Limit: ${autoInfo.autoStopMin} min`
          }
          className={
            "ml-2 inline-flex items-center h-9 rounded-full px-3 py-1.5 text-sm border " +
            (autoInfo.remainingMin <= 5
              ? "bg-red-50 text-red-700 border-red-300"
              : autoInfo.remainingMin <= 15
              ? "bg-amber-50 text-amber-700 border-amber-300"
              : "bg-blue-50 text-blue-700 border-blue-300")
          }
        >
          <span
            className="mr-2 h-2 w-2 rounded-full bg-current"
            style={{ animation: "pulse 1.5s ease-in-out infinite" }}
          />
          <span>
            Auto-Import stoppt in <b>{autoInfo.remainingMin} min</b>
          </span>
        </div>
      )}

      {/* Zuletzt geladen */}
      {showLastLoaded && (
        <div
          title={`Quelle: ${importInfo.file}`}
          className="ml-2 inline-flex items-center h-9 rounded-full px-3 py-1.5 text-sm border bg-white text-gray-700"
          style={{ borderColor: "#cbd5e1" }}
        >
          <span>
            Zuletzt geladen:{" "}
            <b>
              {importInfo.lastLoadedIso
                ? new Date(importInfo.lastLoadedIso).toLocaleTimeString("de-AT", { hour12: false })
                : "–"}
            </b>
          </span>
        </div>
      )}
    </div>
  );
}
