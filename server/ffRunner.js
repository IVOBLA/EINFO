// server/ffRunner.js
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

let child = null;
let starting = false;
let stopping = false;
let lastStart = null;

const LOCK_CANDIDATES = [
  path.resolve(__dirname, "data/.ffetch.lock"),
  path.resolve(__dirname, "data/.ffetch.pid"),
  process.env.FF_LOCK_FILE ? path.resolve(__dirname, process.env.FF_LOCK_FILE) : ""
].filter(Boolean);

async function cleanupStaleLocks() {
  for (const p of LOCK_CANDIDATES) {
    try { await fsp.unlink(p); } catch {}
  }
}

function childIsAlive() {
  if (!child) return false;
  try { process.kill(child.pid, 0); return true; } catch { return false; }
}

export function ffStatus() {
  return {
    running: childIsAlive(),
    starting,
    stopping,
    pid: child?.pid || null,
    lastStart,
  };
}

export async function ffStart(opts = {}) {
  if (starting) throw new Error("Start läuft bereits…");
  if (stopping) throw new Error("Stop läuft noch – bitte kurz warten.");
  if (childIsAlive()) throw new Error("Fetcher läuft bereits.");

  const { username, password, pollIntervalMs } = opts || {};
  if (!username || !password) throw new Error("Zugangsdaten fehlen – Start abgebrochen.");

  starting = true;
  try {
    await cleanupStaleLocks();

    const script = path.resolve(__dirname, "index.mjs");
    const childEnv = { ...process.env };

    // Optionales CA für den Kindprozess (systemweit via NODE_EXTRA_CA_CERTS)
    if (process.env.FF_CA_FILE) {
      const caAbs = path.resolve(__dirname, process.env.FF_CA_FILE);
      if (fs.existsSync(caAbs)) {
        childEnv.NODE_EXTRA_CA_CERTS = caAbs;
        console.log(`[FF] using NODE_EXTRA_CA_CERTS=${caAbs}`);
      } else {
        console.warn(`[FF] WARN: FF_CA_FILE gesetzt, aber nicht gefunden: ${caAbs}`);
      }
    }

    // Outfile/Debug Defaults
    childEnv.FF_OUT_FILE = process.env.FF_OUT_FILE || path.resolve(__dirname, "data", "list_filtered.json");
    childEnv.FF_DEBUG    = process.env.FF_DEBUG || "0";
    childEnv.FF_LIST_TIMEOUT_MIN  = process.env.FF_LIST_TIMEOUT_MIN || "1440";
        childEnv.FF_POLL_INTERVAL_MS  = String(
      Number.isFinite(pollIntervalMs) ? pollIntervalMs : (process.env.FF_POLL_INTERVAL_MS || 60000)
    );
    childEnv.FF_LIST_PATH         = process.env.FF_LIST_PATH || "/list";
    childEnv.FF_LIST_EXTRA        = process.env.FF_LIST_EXTRA || "";
	
	    // NEU: GPS Defaults
    childEnv.FF_GPS_PATH     = process.env.FF_GPS_PATH || "/status/gps";
    childEnv.FF_GPS_OUT_FILE = process.env.FF_GPS_OUT_FILE
      || path.resolve(__dirname, "data", "vehicles_gps.json");

    // ⚠️ KEINE Credentials in ENV! Wir geben sie über stdin (Pipe) weiter.
    child = spawn(process.execPath, [script], {
      env: childEnv,
      cwd: __dirname,
      stdio: ["pipe", "inherit", "inherit"], // stdin-Pipe
      detached: false,
      windowsHide: true,
    });

    // Zugangsdaten sicher über stdin schicken (eine Zeile JSON) und schließen
    try {
      child.stdin.write(JSON.stringify({ username: String(username), password: String(password) }) + "\n");
    } catch {}
    try { child.stdin.end(); } catch {}

    lastStart = new Date().toISOString();

    child.once("exit", (code, signal) => {
      child = null;
      starting = false;
      stopping = false;
      console.log(`[FF] beendet (code=${code}, sig=${signal})`);
    });

    return ffStatus();
  } finally {
    starting = false; // falls spawn synchron fehlschlägt
  }
}

export async function ffStop() {
  if (!childIsAlive()) { child = null; return { ok: true, note: "Fetcher läuft nicht." }; }
  if (stopping) return { ok: true, note: "Stop läuft bereits…" };

  stopping = true;
  const pid = child.pid;

  const waitForExit = (ms) => new Promise((resolve) => {
    const done = () => resolve(true);
    const to = setTimeout(() => resolve(false), ms);
    child.once("exit", () => { clearTimeout(to); done(); });
  });

  try {
    try { child.kill("SIGTERM"); } catch {}
    const soft = await waitForExit(1500);
    if (soft) {
      await cleanupStaleLocks();
      child = null; stopping = false;
      return { ok: true, mode: "soft" };
    }

    // Hard kill (Windows: Prozessbaum)
    if (process.platform === "win32") {
      await new Promise((res) => {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true, stdio: "ignore"
        });
        killer.on("close", () => res());
        killer.on("error", () => res());
      });
    } else {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }

    await waitForExit(400);
    await cleanupStaleLocks();
    return { ok: true, mode: "hard" };
  } finally {
    child = null;
    stopping = false;
  }
}
