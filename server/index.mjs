// server/index.mjs
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

// ---------- Konfiguration ----------
const BASE = "https://feuerwehr.einsatz.or.at";

const OUT_FILE = process.env.FF_OUT_FILE || path.resolve("./data/list_filtered.json");
const GPS_OUT_FILE = process.env.FF_GPS_OUT_FILE || path.resolve("./data/vehicles_gps.json");
const POLL_MS  = Number(process.env.FF_POLL_INTERVAL_MS || 60000);
const DEBUG    = String(process.env.FF_DEBUG || "0") === "1";

const LIST_PATH   = process.env.FF_LIST_PATH || "/list";
const LIST_EXTRA  = process.env.FF_LIST_EXTRA || "";
const TIMEOUT_MIN = Number(process.env.FF_LIST_TIMEOUT_MIN || 1440); // Minuten
const GPS_PATH    = process.env.FF_GPS_PATH || "/status/gps";
const RUN_ONCE    = String(process.env.FF_ONCE || "0") === "1";

// Exitcodes
const EXIT_OK            = 0;
const EXIT_BAD_CONFIG    = 1;
const EXIT_LOGIN_FAILED  = 2;
const EXIT_SESSION_LOST  = 3;
const EXIT_NETWORK_ERROR = 4;

// ---------- Credentials sicher von stdin lesen (Fallback: ENV nur falls vorhanden) ----------
async function readBootCredsFromStdin() {
  return new Promise((resolve) => {
    try {
      let buf = "";
      process.stdin.setEncoding("utf8");
      const to = setTimeout(() => resolve(null), 200); // kurz warten
      process.stdin.once("data", (chunk) => {
        clearTimeout(to);
        buf += chunk;
        try { resolve(JSON.parse(buf.trim())); } catch { resolve(null); }
      });
      process.stdin.on("error", () => { clearTimeout(to); resolve(null); });
    } catch { resolve(null); }
  });
}
const BOOT_CREDS = await readBootCredsFromStdin();
const USERNAME = (BOOT_CREDS?.username) || process.env.FF_USERNAME || "";
const PASSWORD = (BOOT_CREDS?.password) || process.env.FF_PASSWORD || "";
if (!USERNAME || !PASSWORD) {
  console.error(`[FATAL] FF_USERNAME/FF_PASSWORD fehlen.`);
  process.exit(EXIT_BAD_CONFIG);
}

// ---------- Helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

async function ensureDir(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
}
async function writeFileAtomic(file, data, enc = "utf8") {
  await ensureDir(file);
  const tmp = `${file}.tmp-${Math.random().toString(36).slice(2)}`;
  await fsp.writeFile(tmp, data, enc);
  await fsp.rename(tmp, file);
  if (DEBUG) console.error(`[DEBUG] wrote ${file} (${Buffer.byteLength(data, enc)} bytes)`);
}

async function cookieDebug(jar) {
  const cookies = await jar.getCookies(BASE);
  return cookies.map(c => `${c.key}=${c.value}; domain=${c.domain}; path=${c.path}; secure=${c.secure}; samesite=${c.sameSite || ""}`).join(" | ");
}

// ---------- HTTP Client (vertraut auf System-/NODE_EXTRA_CA_CERTS) ----------
const jar = new CookieJar();
const http = wrapper(axios.create({
  baseURL: BASE,
  jar,
  withCredentials: true,
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KanbanFF/1.0",
    "Accept": "application/json, text/plain, */*",
  },
}));

// ---------- Login & Session ----------
async function touchRoot() {
  if (DEBUG) console.error("[REQ] GET /");
  const r = await http.get("/", { headers: { Referer: `${BASE}/` } });
  if (DEBUG) console.error(`[RES] ${r.status} /`);
}
async function touchApp() {
  if (DEBUG) console.error("[REQ] GET /app/");
  const r = await http.get("/app/", { headers: { Referer: `${BASE}/` } });
  if (DEBUG) console.error(`[RES] ${r.status} /app/`);
}
async function checkLogin() {
  const ts = Date.now();
  if (DEBUG) console.error(`[REQ] GET /checkLogin?rand=${ts}&_=${ts}`);
  const r = await http.get("/checkLogin", {
    params: { rand: ts, _: ts },
    headers: { Referer: `${BASE}/app/` },
  });
  if (DEBUG) console.error(`[RES] ${r.status} /checkLogin`);
  const v = Number(String(r?.data ?? "").toString().trim());
  const logged = v === 1;
  if (DEBUG) console.error(`[DEBUG] checkLogin: ${v} → loggedIn=${logged}`);
  return logged;
}

async function loginOnce() {
  await touchRoot();
  await touchApp();
  await checkLogin().catch(() => false);

  const form = new URLSearchParams();
  form.set("username", USERNAME);
  form.set("password", PASSWORD);
  form.set("remember", "1");

  if (DEBUG) console.error("[REQ] POST /login");
  const res = await http.post("/login", form, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": `${BASE}/app/`,
      "X-Requested-With": "XMLHttpRequest",
    },
    maxRedirects: 0,
    validateStatus: s => s === 200 || s === 302,
  });
  if (DEBUG) console.error(`[RES] ${res.status} /login`);

  await touchApp();
  await sleep(150);

  let ok = await checkLogin();
  if (!ok) {
    await touchApp();
    await sleep(200);
    ok = await checkLogin();
  }
  if (!ok) {
    console.error("[ERROR] Login failed (checkLogin != 1)");
    if (DEBUG) console.error("[DEBUG] cookies:", await cookieDebug(jar));
    return false;
  }
  if (DEBUG) console.error("[DEBUG] login OK; cookies:", await cookieDebug(jar));
  return true;
}

async function ensureLoggedIn() {
  const already = await checkLogin().catch(() => false);
  if (already) return true;

  console.error(`[WARN] ${nowIso()} – Session/Login ungültig. Versuche Neu-Anmeldung…`);

  const MAX_RETRIES = Number(process.env.FF_LOGIN_MAX_RETRIES || 3);
  const RETRY_DELAY_MS = Number(process.env.FF_LOGIN_RETRY_DELAY_MS || 5000);

  for (let attempt = 1; attempt <= MAX_RETRIES || MAX_RETRIES === 0; attempt += 1) {
    const ok = await loginOnce().catch(e => {
      console.error(`[ERROR] ${nowIso()} – Login-Ausnahme (Versuch ${attempt}): ${e?.message || String(e)}`);
      return false;
    });
    if (ok) {
      console.error(`[INFO] ${nowIso()} – Neu-Anmeldung erfolgreich (Versuch ${attempt}).`);
      return true;
    }

    if (MAX_RETRIES !== 0 && attempt >= MAX_RETRIES) break;

    console.error(`[WARN] ${nowIso()} – Neu-Anmeldung fehlgeschlagen (Versuch ${attempt}). Wiederhole in ${RETRY_DELAY_MS} ms…`);
    await sleep(RETRY_DELAY_MS);
  }

  console.error(`[ERROR] ${nowIso()} – Neu-Anmeldung dauerhaft fehlgeschlagen.`);
  return false;
}

// ---------- Daten holen ----------
async function fetchListOnce() {
  const url = `${LIST_PATH}${LIST_EXTRA || ""}`;
  if (DEBUG) console.error(`[REQ] GET ${url}`);

  // Zeitrahmen-Parameter (Standard 1440 Minuten, via FF_LIST_TIMEOUT_MIN konfigurierbar)
  const params = { timeout: TIMEOUT_MIN, _: Date.now() };

  const r = await http.get(url, {
    headers: { Referer: `${BASE}/app/` },
    params
  });
  if (DEBUG) console.error(`[RES] ${r.status} ${url}`);

  const data = r.data;
  if (!Array.isArray(data)) {
    throw new Error(`Unerwartetes Format (erwarte Array), typeof=${typeof data}`);
  }
  return data;
}

// NEU: GPS holen
async function fetchGpsOnce() {
  const url = `${GPS_PATH}`;
  if (DEBUG) console.error(`[REQ] GET ${url}`);
  const r = await http.get(url, { headers: { Referer: `${BASE}/app/` } });
  if (DEBUG) console.error(`[RES] ${r.status} ${url}`);
  if (!Array.isArray(r.data)) throw new Error(`GPS: unerwartetes Format (Array erwartet)`);
  return r.data;
}


// ---------- Main Loop ----------
let stopRequested = false;

async function loop() {
  while (!stopRequested) {
    try {
      const stillOk = await ensureLoggedIn();
      if (!stillOk) {
        await sleep(POLL_MS);
        continue;
      }


      // 1) /list → Einsätze (unverändert)
      const data = await fetchListOnce();
      await writeFileAtomic(OUT_FILE, JSON.stringify(data, null, 2), "utf8");

      // 2) /status/gps → Live-Fahrzeugpositionen (NEU)
      try {
        const gps = await fetchGpsOnce();
        await writeFileAtomic(GPS_OUT_FILE, JSON.stringify(gps, null, 2), "utf8");
      } catch (e) {
        console.error(`[ERROR] ${nowIso()} – GPS-Fehler: ${e.message}`);
      }
      if (DEBUG) console.error(`[DEBUG] ${nowIso()} – fetch+write OK; next in ${POLL_MS} ms`);
    } catch (e) {
      console.error(`[ERROR] ${nowIso()} – Polling-Fehler: ${e.message}`);
      if (DEBUG && e?.response) {
        console.error("[DEBUG] response status:", e.response.status);
        const snip = typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data);
        console.error("[DEBUG] response data:", String(snip).slice(0, 300));
      }
    }

    if (RUN_ONCE) {
      if (DEBUG) console.error("[DEBUG] RUN_ONCE aktiv → beende nach erstem Durchlauf");
      break;
    }

    const step = 100;
    let waited = 0;
    while (!stopRequested && waited < POLL_MS) {
      await sleep(step);
      waited += step;
    }
  }
}

// ---------- Shutdown ----------
async function shutdown(reason = "SIGTERM") {
  if (stopRequested) return;
  stopRequested = true;
  if (DEBUG) console.error(`[DEBUG] Shutdown requested via ${reason}`);
  await sleep(50);
  if (DEBUG) console.error("[DEBUG] cleanup done, exiting.");
  process.exit(EXIT_OK);
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err?.stack || err?.message || String(err));
  process.exit(EXIT_NETWORK_ERROR);
});
process.on("unhandledRejection", (err) => {
  console.error("[FATAL] unhandledRejection:", err?.stack || err?.message || String(err));
  process.exit(EXIT_NETWORK_ERROR);
});

// ---------- Boot ----------
(async function main() {
  console.error(`[BOOT] ${nowIso()} – starting fetcher`);
  console.error(`[BOOT] OUT_FILE=${OUT_FILE} POLL_MS=${POLL_MS} DEBUG=${DEBUG ? "1" : "0"} TIMEOUT_MIN=${TIMEOUT_MIN}`);

  const ok = await ensureLoggedIn().catch(e => {
    console.error("[ERROR] Login exception:", e?.message || String(e));
    return false;
  });
  if (!ok) process.exit(EXIT_LOGIN_FAILED);

  await loop();
  process.exit(EXIT_OK);
})();
