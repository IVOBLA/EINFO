// chatbot/server/roles_sync.js
// ============================================================
// Synchronisiert roles.json mit dem Online-Status vom Haupt-Server
// 
// Die roles.json Datei enthält:
// - active: Rollen die von echten Benutzern besetzt sind (NICHT simuliert)
// - missing: Rollen die vom LLM simuliert werden müssen
// 
// Diese Datei wird bei jedem Simulationsschritt aktualisiert.
// ============================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Konfiguration
// ============================================================

// URL zum EINFO Haupt-Server
const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || "http://localhost:4000";
const ONLINE_ROLES_ENDPOINT = "/api/user/online-roles";

// Pfad zur roles.json - muss zum server/data Verzeichnis zeigen (wie CONFIG.dataDir)
const DATA_DIR = process.env.EINFO_DATA_DIR || path.resolve(__dirname, "../../server/data");
const ROLES_FILE = path.join(DATA_DIR, "roles.json");

// Stabsstellen die simuliert werden können (aus Anforderung)
const SIMULATABLE_ROLES = new Set([
  "LTSTB", "LTSTBSTV", "S1", "S2", "S3", "S4", "S5", "S6"
]);

// Einfacher Logger (falls kein externer Logger verfügbar)
const log = (level, msg, data) => {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${timestamp}] [${level}] [roles_sync] ${msg}${dataStr}`);
};

// ============================================================
// Online-Rollen vom Haupt-Server abrufen
// ============================================================

/**
 * Holt die aktuell eingeloggten Rollen vom EINFO Haupt-Server.
 * 
 * Der Haupt-Server verwaltet alle User-Sessions und weiß welche
 * Benutzer mit welchen Rollen gerade aktiv sind.
 * 
 * @returns {Promise<string[]>} Array von Rollen-IDs die online sind
 * 
 * Beispiel-Rückgabe: ["S2", "LTSTB"]
 */
export async function fetchOnlineRoles() {
  const url = `${MAIN_SERVER_URL}${ONLINE_ROLES_ENDPOINT}`;

  log("debug", "Rufe Online-Rollen ab", { url });

  try {
    // HTTP-Anfrage mit Timeout (5 Sekunden)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Requested-By": "chatbot-worker"
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Fehlerbehandlung
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Verschiedene Antwortformate unterstützen
    // Format 1: Array direkt: ["S2", "LtStb"]
    // Format 2: Objekt mit roles: { roles: ["S2", "LtStb"] }
    // Format 3: Objekt mit role-Objekten: { roles: [{ id: "S2" }, ...] }
    let roles = [];

    if (Array.isArray(data)) {
      roles = data;
    } else if (Array.isArray(data?.roles)) {
      roles = data.roles;
    }

    // Normalisiere Rollen-IDs (Großbuchstaben, keine Leerzeichen)
    const normalized = roles
      .map(r => {
        if (typeof r === "string") {
          return r.trim().toUpperCase();
        }
        if (typeof r?.id === "string") {
          return r.id.trim().toUpperCase();
        }
        if (typeof r?.role === "string") {
          return r.role.trim().toUpperCase();
        }
        return null;
      })
      .filter(Boolean);

    log("debug", "Online-Rollen erfolgreich abgerufen", {
      count: normalized.length,
      roles: normalized
    });

    return normalized;

  } catch (err) {
    // Bei Fehler: Leeres Array zurückgeben
    // Das bedeutet: ALLE Stabsstellen werden simuliert
    const isNetworkError = err.name === "AbortError" ||
                           err.message?.includes("fetch failed") ||
                           err.message?.includes("ECONNREFUSED") ||
                           err.message?.includes("ENOTFOUND");

    log("error", "Fehler beim Abrufen der Online-Rollen", {
      url,
      error: err.message,
      errorType: isNetworkError ? "NETWORK_ERROR" : "UNKNOWN_ERROR",
      hint: isNetworkError
        ? `Haupt-Server nicht erreichbar unter ${url}. Prüfen Sie ob der Server läuft.`
        : "Alle Stabsstellen werden simuliert"
    });

    return [];
  }
}

// ============================================================
// Rollen berechnen
// ============================================================

/**
 * Berechnet welche Stabsstellen aktiv (besetzt) und welche 
 * missing (zu simulieren) sind.
 * 
 * @param {string[]} onlineRoles - Array von Rollen-IDs die online sind
 * @returns {{ active: string[], missing: string[] }}
 * 
 * Beispiel:
 *   onlineRoles = ["S2", "LTSTB"]
 *   → { 
 *       active: ["LTSTB", "S2"], 
 *       missing: ["LTSTBSTV", "S1", "S3", "S4", "S5", "S6"] 
 *     }
 */
export function calculateRoles(onlineRoles) {
  // Online-Rollen als Set für schnellen Lookup
  const onlineSet = new Set(
    onlineRoles.map(r => String(r).toUpperCase())
  );

  const active = [];
  const missing = [];

  // Jede simulierbare Rolle prüfen
  for (const role of SIMULATABLE_ROLES) {
    if (onlineSet.has(role)) {
      // Rolle ist online → aktiv (wird NICHT simuliert)
      active.push(role);
    } else {
      // Rolle ist offline → missing (wird simuliert)
      missing.push(role);
    }
  }

  // Alphabetisch sortieren für konsistente Ausgabe
  active.sort();
  missing.sort();

  return { active, missing };
}

// ============================================================
// roles.json synchronisieren
// ============================================================

/**
 * Hauptfunktion: Synchronisiert roles.json mit dem aktuellen Online-Status.
 * 
 * Ablauf:
 * 1. Online-Rollen vom Haupt-Server abrufen
 * 2. Active/Missing berechnen
 * 3. roles.json schreiben
 * 
 * @returns {Promise<{ active: string[], missing: string[] }>}
 */
export async function syncRolesFile() {
  try {
    // 1. Online-Rollen vom Haupt-Server holen
    const onlineRoles = await fetchOnlineRoles();

    // 2. Active/Missing berechnen
    const { active, missing } = calculateRoles(onlineRoles);

    // 3. roles.json Struktur erstellen
    const rolesData = {
      roles: {
        active,
        missing
      },
      // Metadaten für Debugging
      lastSync: new Date().toISOString(),
      source: "chatbot-worker-sync",
      onlineRolesReceived: onlineRoles
    };

    // 4. Verzeichnis sicherstellen
    const dir = path.dirname(ROLES_FILE);
    await fs.mkdir(dir, { recursive: true });

    // 5. Atomar schreiben (erst temp, dann rename)
    const tempFile = ROLES_FILE + ".tmp-" + Date.now();
    await fs.writeFile(tempFile, JSON.stringify(rolesData, null, 2), "utf8");

    try {
      await fs.rename(tempFile, ROLES_FILE);
    } catch (renameErr) {
      // Fallback: Direkt überschreiben (Windows-Kompatibilität)
      await fs.writeFile(ROLES_FILE, JSON.stringify(rolesData, null, 2), "utf8");
      try { await fs.unlink(tempFile); } catch { /* ignore */ }
    }

    log("info", "roles.json synchronisiert", {
      activeCount: active.length,
      missingCount: missing.length,
      active,
      missing
    });

    return { active, missing };

  } catch (err) {
    log("error", "Fehler beim Synchronisieren der roles.json", {
      error: err.message,
      stack: err.stack
    });

    // Fallback: Bestehende roles.json lesen
    return readRolesFile();
  }
}

// ============================================================
// roles.json lesen
// ============================================================

/**
 * Liest die aktuelle roles.json Datei.
 * 
 * @returns {Promise<{ active: string[], missing: string[] }>}
 */
export async function readRolesFile() {
  try {
    const content = await fs.readFile(ROLES_FILE, "utf8");
    const data = JSON.parse(content);

    return {
      active: data?.roles?.active || [],
      missing: data?.roles?.missing || [...SIMULATABLE_ROLES]
    };

  } catch (err) {
    // Datei existiert nicht oder ist ungültig
    // → Alle Rollen werden simuliert
    log("debug", "roles.json nicht lesbar, verwende Defaults", {
      error: err.message
    });

    return {
      active: [],
      missing: [...SIMULATABLE_ROLES]
    };
  }
}

// ============================================================
// Initialisierung
// ============================================================

/**
 * Initialisiert roles.json mit allen Rollen als "missing".
 * Wird beim Server-Start aufgerufen.
 * 
 * @returns {Promise<void>}
 */
export async function initializeRolesFile() {
  const dir = path.dirname(ROLES_FILE);
  await fs.mkdir(dir, { recursive: true });

  const initialData = {
    roles: {
      active: [],
      missing: [...SIMULATABLE_ROLES]
    },
    lastSync: new Date().toISOString(),
    source: "initialization",
    onlineRolesReceived: []
  };

  await fs.writeFile(ROLES_FILE, JSON.stringify(initialData, null, 2), "utf8");
  log("info", "roles.json initialisiert", { missingCount: SIMULATABLE_ROLES.size });
}

// ============================================================
// Export für Tests
// ============================================================

export const __test__ = {
  ROLES_FILE,
  SIMULATABLE_ROLES,
  MAIN_SERVER_URL,
  ONLINE_ROLES_ENDPOINT
};
