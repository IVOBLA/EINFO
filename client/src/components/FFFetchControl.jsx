import React, { useEffect, useRef, useState } from "react";

export default function FFFetchControl() {
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
  });

  // Importinfos
  const [importInfo, setImportInfo] = useState({
    lastLoadedIso: null,
    file: "list_filtered.json",
  });

  // Auto-Import Config (Countdown)
  const [enabled, setEnabled] = useState(false);
  const [intervalSec, setIntervalSec] = useState(30);
  const [secondsLeft, setSecondsLeft] = useState(null);

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

      if (!didCheckOnce.current) {
        didCheckOnce.current = true;
        if (!c.has) {
          setHint("Keine globalen Fetcher-Zugangsdaten. Bitte als Admin unter /user-admin setzen.");
        }
      }
    } catch {}
  };

  useEffect(() => {
    readStatusAndCreds();
    const t = setInterval(readStatusAndCreds, 3000);
    return () => clearInterval(t);
  }, []);

  // --- Aktivität/Auto-Stop + letzte Importzeit sekündlich -----------
  useEffect(() => {
    let t;
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
    poll();
    t = setInterval(poll, 1000);
    return () => clearInterval(t);
  }, []);

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

  return (
    <div className="flex items-center h-9 gap-2" style={{ alignItems: "center" }}>
      {/* Countdown-Chip (wie alt) */}
      <span
        className={`sync-chip ${enabled ? "active" : ""}`}
        title={enabled ? "Auto-Import Countdown" : "Auto-Import ist deaktiviert"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "110px",
          minWidth: "110px",
          textAlign: "center",
        }}
      >
        {enabled ? `⟳ in ${secondsLeft != null ? secondsLeft : "–"}s` : "⏸ manuell"}
      </span>

      {/* Hinweis (z. B. keine globalen Creds) */}
      {hint && <span style={{ color: "#dc2626", fontSize: 12, marginLeft: 8 }}>{hint}</span>}

      {/* Auto-Stop Countdown (Farbskala) */}
      {running && autoInfo.remainingMin != null && autoInfo.remainingMin <= 15 && (
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
    </div>
  );
}
