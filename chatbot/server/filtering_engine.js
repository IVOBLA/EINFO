// chatbot/server/filtering_engine.js
//
// Regel-basierte Filterung für LLM-Kontext
// Wendet JSON-Regeln auf EINFO-Daten an

import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError, logInfo } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RULES_FILE = path.resolve(__dirname, CONFIG.dataDir, "conf", "filtering_rules.json");
const VEHICLES_FILE = path.resolve(__dirname, CONFIG.dataDir, "conf", "vehicles.json");
const VEHICLES_EXTRA_FILE = path.resolve(__dirname, CONFIG.dataDir, "vehicles-extra.json");

let cachedRules = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 60000; // 1 Minute

// Fahrzeug-Cache
let cachedVehicles = null;
let vehiclesCacheTimestamp = null;

// Leere Fallback-Regeln (nur wenn Datei nicht lesbar)
const EMPTY_RULES = {
  version: "1.0.0",
  limits: { max_total_tokens: 2500 },
  rules: {}
};

/**
 * Lädt Filterregeln aus JSON-Datei (filtering_rules.json)
 * Die Datei wird vom Admin-Panel verwaltet und enthält alle Regeln.
 */
export async function loadFilteringRules() {
  try {
    // Cache-Check
    if (cachedRules && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
      return cachedRules;
    }

    const raw = await fsPromises.readFile(RULES_FILE, "utf8");
    const rules = JSON.parse(raw);

    cachedRules = rules;
    cacheTimestamp = Date.now();

    logDebug("Filterregeln geladen", {
      version: rules.version,
      ruleCount: Object.keys(rules.rules || {}).length
    });

    return rules;
  } catch (err) {
    logError("Fehler beim Laden der Filterregeln - Datei nicht gefunden oder ungültig", {
      error: String(err),
      file: RULES_FILE,
      hint: "Bitte Admin-Panel öffnen um Standard-Regeln zu initialisieren"
    });
    // Fallback: Leere Regeln (keine Filterung)
    return EMPTY_RULES;
  }
}

/**
 * Invalidiert Cache (z.B. nach Regel-Änderung)
 */
export function invalidateRulesCache() {
  cachedRules = null;
  cacheTimestamp = null;
  logInfo("Filterregeln-Cache invalidiert");
}

/**
 * Lädt Fahrzeugdaten aus vehicles.json und vehicles-extra.json
 * Gibt ein Map von Fahrzeug-ID zu Mannschaftsstärke zurück
 */
async function loadVehicles() {
  // Cache-Check
  if (cachedVehicles && vehiclesCacheTimestamp && (Date.now() - vehiclesCacheTimestamp) < CACHE_TTL_MS) {
    return cachedVehicles;
  }

  const vehicleMap = new Map();
  let totalMannschaft = 0;

  // Lade vehicles.json
  try {
    const raw = await fsPromises.readFile(VEHICLES_FILE, "utf8");
    const vehicles = JSON.parse(raw);
    if (Array.isArray(vehicles)) {
      for (const v of vehicles) {
        if (v.id && typeof v.mannschaft === "number") {
          vehicleMap.set(v.id, v.mannschaft);
          vehicleMap.set(v.label, v.mannschaft); // Auch nach Label matchen
          totalMannschaft += v.mannschaft;
        }
      }
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      logError("Fehler beim Laden von vehicles.json", { error: String(err) });
    }
  }

  // Lade vehicles-extra.json
  try {
    const raw = await fsPromises.readFile(VEHICLES_EXTRA_FILE, "utf8");
    const vehicles = JSON.parse(raw);
    if (Array.isArray(vehicles)) {
      for (const v of vehicles) {
        if (v.id && typeof v.mannschaft === "number") {
          vehicleMap.set(v.id, v.mannschaft);
          vehicleMap.set(v.label, v.mannschaft);
          totalMannschaft += v.mannschaft;
        }
      }
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      logError("Fehler beim Laden von vehicles-extra.json", { error: String(err) });
    }
  }

  cachedVehicles = { vehicleMap, totalMannschaft };
  vehiclesCacheTimestamp = Date.now();

  logDebug("Fahrzeugdaten geladen", {
    vehicleCount: vehicleMap.size / 2, // Geteilt durch 2 wegen ID+Label
    totalMannschaft
  });

  return cachedVehicles;
}

/**
 * Wendet alle aktivierten Regeln an
 * @returns {object} - { filtered, rules, debug } mit Debug-Informationen
 */
export async function applyAllFilteringRules(rawData, learnedWeights = {}) {
  const rules = await loadFilteringRules();

  const filtered = {
    abschnitte: [],
    protocol: [],
    trends: {},
    resources: {},
    incidents: []
  };

  // Debug-Tracking für jede Regel
  const debug = {
    rules: {},
    filtering: {}
  };

  // Zähle Rohdaten
  const rawAbschnitteCount = countAreas(rawData.board);
  const rawProtocolCount = Array.isArray(rawData.protocol) ? rawData.protocol.length : 0;
  const rawIncidentsCount = countIncidents(rawData.board);

  // Regel R1: Abschnitte-Priorität
  const r1Enabled = rules.rules.R1_ABSCHNITTE_PRIORITAET?.enabled;
  debug.rules.R1_ABSCHNITTE_PRIORITAET = {
    enabled: r1Enabled,
    details: r1Enabled
      ? `max_items=${rules.rules.R1_ABSCHNITTE_PRIORITAET.output?.max_items || 5}`
      : null
  };
  if (r1Enabled) {
    filtered.abschnitte = applyRule_R1(rawData.board, rules.rules.R1_ABSCHNITTE_PRIORITAET);
    debug.filtering.abschnitte = {
      before: rawAbschnitteCount,
      after: filtered.abschnitte.length,
      reason: `Top ${rules.rules.R1_ABSCHNITTE_PRIORITAET.output?.max_items || 5} nach Priority-Score`
    };
  }

  // Regel R2: Protokoll-Relevanz
  const r2Enabled = rules.rules.R2_PROTOKOLL_RELEVANZ?.enabled;
  const r2Config = rules.rules.R2_PROTOKOLL_RELEVANZ;
  debug.rules.R2_PROTOKOLL_RELEVANZ = {
    enabled: r2Enabled,
    details: r2Enabled
      ? `min_score=${r2Config.output?.min_score || 0.6}, max_entries=${r2Config.output?.max_entries || 10}`
      : null
  };
  if (r2Enabled) {
    filtered.protocol = applyRule_R2(rawData.protocol, r2Config, learnedWeights);
    debug.filtering.protocol = {
      before: rawProtocolCount,
      after: filtered.protocol.length,
      reason: `Score >= ${r2Config.output?.min_score || 0.6}, max ${r2Config.output?.max_entries || 10} Einträge`
    };
  }

  // Regel R3: Trends-Erkennung
  const r3Enabled = rules.rules.R3_TRENDS_ERKENNUNG?.enabled;
  debug.rules.R3_TRENDS_ERKENNUNG = {
    enabled: r3Enabled,
    details: r3Enabled
      ? `time_windows=${JSON.stringify(rules.rules.R3_TRENDS_ERKENNUNG.time_windows || [60])}`
      : null
  };
  if (r3Enabled) {
    filtered.trends = applyRule_R3(rawData.board, rules.rules.R3_TRENDS_ERKENNUNG);
    debug.filtering.trends = {
      before: "n/a",
      after: Object.keys(filtered.trends).length > 0 ? 1 : 0,
      reason: `Trend: ${filtered.trends.direction || "stable"} (${filtered.trends.strength || "weak"})`
    };
  }

  // Regel R4: Ressourcen-Status
  const r4Enabled = rules.rules.R4_RESSOURCEN_STATUS?.enabled;
  debug.rules.R4_RESSOURCEN_STATUS = {
    enabled: r4Enabled,
    details: r4Enabled
      ? `threshold=${rules.rules.R4_RESSOURCEN_STATUS.aggregation?.highlight_threshold?.utilization_percent || 80}%`
      : null
  };
  if (r4Enabled) {
    // Lade Fahrzeugdaten für Personal-Berechnung
    const vehicleData = await loadVehicles();
    filtered.resources = applyRule_R4(rawData.board, rules.rules.R4_RESSOURCEN_STATUS, vehicleData);
    debug.filtering.resources = {
      before: rawIncidentsCount,
      after: filtered.resources.per_area?.length || 0,
      reason: `Auslastung: ${filtered.resources.utilization || 0}%, Engpass: ${filtered.resources.resource_shortage ? "JA" : "NEIN"}`,
      deployed_personnel: filtered.resources.deployed_personnel,
      total_personnel: filtered.resources.total_personnel
    };
  }

  // Regel R5: Stabs-Fokus (modifiziert andere Regeln)
  // WICHTIG: R5 NICHT anwenden wenn keine aktiven Rollen vorhanden sind
  // Sonst werden alle Einsätze herausgefiltert und das LLM bekommt keinen Context!
  const r5Config = rules.rules.R5_STABS_FOKUS;
  const r5Enabled = r5Config?.enabled;
  const hasActiveRoles = Array.isArray(rawData.activeRoles) && rawData.activeRoles.length > 0;
  const r5Active = Boolean(r5Enabled && hasActiveRoles);
  debug.rules.R5_STABS_FOKUS = {
    enabled: r5Enabled,
    active: r5Active,
    skipped: r5Enabled && !hasActiveRoles ? "Keine aktiven Rollen - R5 übersprungen" : null,
    details: r5Enabled && hasActiveRoles
      ? `aggregate=${r5Config.stab_mode?.aggregate_to_sections}, max_individual=${r5Config.output?.max_individual_incidents || r5Config.stab_mode?.max_individual_incidents || 3}, min_score=${r5Config.output?.min_score ?? r5Config.critical_scoring?.min_score ?? 0.6}`
      : null
  };
  if (r5Active) {
    const r5Meta = applyRule_R5(filtered, rawData, r5Config);
    debug.filtering.incidents = {
      before: rawIncidentsCount,
      after: filtered.incidents.length,
      reason: `Stabs-Fokus (max ${r5Meta.max_individual_incidents}, kritisch ${r5Meta.critical_selected}, fallback ${r5Meta.fallback_selected})${r5Meta.fallback_used ? ", Fallback aktiv" : ""}`,
      ...r5Meta
    };
  } else if (r5Enabled && !hasActiveRoles) {
    logDebug("R5_STABS_FOKUS übersprungen: Keine aktiven Rollen");
  }

  logDebug("Filterregeln angewendet", {
    rulesApplied: Object.entries(debug.rules).filter(([_, v]) => v.enabled).map(([k]) => k),
    filtering: debug.filtering
  });

  return { filtered, rules, debug };
}

/**
 * Hilfsfunktion: Zählt Abschnitte im Board
 */
function countAreas(board) {
  if (!board?.columns) return 0;
  let count = 0;
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    if (!column?.items) continue;
    count += column.items.filter(card => card?.isArea).length;
  }
  return count;
}

/**
 * Hilfsfunktion: Zählt Incidents (nicht-Abschnitte) im Board
 */
function countIncidents(board) {
  if (!board?.columns) return 0;
  let count = 0;
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    if (!column?.items) continue;
    count += column.items.filter(card => card && !card.isArea).length;
  }
  return count;
}

/**
 * R1: Abschnitte-Priorität
 */
function applyRule_R1(board, rule) {
  if (!board || !board.columns) return [];

  const areas = getAreas(board);
  const areasWithStats = areas.map(area => calculateAreaStats(board, area, rule));

  // Sortiere nach Priority Score
  areasWithStats.sort((a, b) => b.priority_score - a.priority_score);

  // Nehme Top N
  const maxItems = rule.output.max_items || 5;
  return areasWithStats.slice(0, maxItems);
}

/**
 * R2: Protokoll-Relevanz
 */
function applyRule_R2(protocol, rule, learnedWeights = {}) {
  if (!protocol || !Array.isArray(protocol)) return [];

  const scored = protocol.map(entry => {
    const score = scoreProtocolEntry(entry, rule, learnedWeights);
    return { ...entry, _score: score };
  });

  // Filtere nach Min-Score
  const minScore = rule.output.min_score || 0.6;
  const filtered = scored.filter(e => e._score >= minScore);

  // Sortiere nach Score
  filtered.sort((a, b) => b._score - a._score);

  // Nehme Top N
  const maxEntries = rule.output.max_entries || 10;
  const result = filtered.slice(0, maxEntries);

  // Entferne Score-Feld wenn nicht angezeigt werden soll
  if (!rule.output.show_score) {
    result.forEach(e => delete e._score);
  }

  return result;
}

/**
 * R3: Trends-Erkennung
 */
function applyRule_R3(board, rule) {
  if (!board || !board.columns) return {};

  const incidents = getAllIncidents(board);
  const now = Date.now();

  const trends = {};

  // Für jedes Zeitfenster
  for (const windowMinutes of rule.time_windows || [60]) {
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;

    const recentIncidents = incidents.filter(i => {
      const timestamp = i.timestamp ? new Date(i.timestamp).getTime() : now;
      return timestamp >= windowStart;
    });

    const newIncidents = recentIncidents.filter(i => i.column === "neu" || !i.column);
    const closedIncidents = incidents.filter(i => {
      const updated = i.updated ? new Date(i.updated).getTime() : null;
      return i.column === "erledigt" && updated && updated >= windowStart;
    });

    // Trend-Richtung
    let direction = "stable";
    let strength = "weak";

    if (newIncidents.length > closedIncidents.length * 1.5) {
      direction = "escalating";
      if (newIncidents.length > closedIncidents.length * 2) {
        strength = "strong";
      } else {
        strength = "moderate";
      }
    } else if (closedIncidents.length > newIncidents.length * 1.5) {
      direction = "de-escalating";
      if (closedIncidents.length > newIncidents.length * 2) {
        strength = "strong";
      } else {
        strength = "moderate";
      }
    }

    // Durchschnittliche Dauer
    const activeIncidents = incidents.filter(i => i.column !== "erledigt");
    const avgDuration = calculateAvgDuration(activeIncidents);

    // Forecast
    const incidentsPerHour = (newIncidents.length / windowMinutes) * 60;
    const forecastHorizon = rule.output.forecast_horizon_minutes || 120;
    const forecast = Math.round(incidentsPerHour * (forecastHorizon / 60));

    trends[`window_${windowMinutes}min`] = {
      new_incidents: newIncidents.length,
      closed_incidents: closedIncidents.length,
      direction,
      strength,
      avg_duration_minutes: avgDuration,
      forecast_2h: forecast
    };
  }

  // Verwende größtes Zeitfenster als primär
  const primaryWindow = Math.max(...(rule.time_windows || [60]));
  return trends[`window_${primaryWindow}min`] || {};
}

/**
 * R4: Ressourcen-Status
 * Berechnet Personal aus:
 * - Gesamt-Personal: Summe der "mannschaft" aus vehicles.json + vehicles-extra.json
 * - Eingesetztes Personal: Aus assignedVehicles der aktiven Einsätze (neu + in-bearbeitung)
 */
function applyRule_R4(board, rule, vehicleData = null) {
  if (!board || !board.columns) return {};

  const areas = getAreas(board);
  const incidents = getAllIncidents(board);

  // Aktive Einsätze (nur "neu" und "in-bearbeitung")
  const activeIncidents = incidents.filter(i => i.column === "neu" || i.column === "in-bearbeitung");

  // Fahrzeug-Map für Mannschaftsstärke
  const vehicleMap = vehicleData?.vehicleMap || new Map();
  const totalMannschaft = vehicleData?.totalMannschaft || 0;

  // Berechne eingesetztes Personal aus assignedVehicles
  let deployedPersonnel = 0;
  const deployedVehicleIds = new Set();

  for (const incident of activeIncidents) {
    const assignedVehicles = incident.assignedVehicles || [];
    for (const vehicleId of assignedVehicles) {
      if (!deployedVehicleIds.has(vehicleId)) {
        deployedVehicleIds.add(vehicleId);
        // Suche Mannschaft für dieses Fahrzeug
        const mannschaft = vehicleMap.get(vehicleId) || 0;
        deployedPersonnel += mannschaft;
      }
    }
  }

  // Anzahl Einheiten (Fahrzeuge)
  const deployedUnits = deployedVehicleIds.size;
  const totalUnits = vehicleMap.size / 2; // Geteilt durch 2 wegen ID+Label Mapping
  const availableUnits = Math.max(0, totalUnits - deployedUnits);

  // Auslastung basierend auf Personal
  const utilization = totalMannschaft > 0 ? (deployedPersonnel / totalMannschaft) * 100 : 0;

  const resources = {
    total_units: Math.round(totalUnits),
    deployed_units: deployedUnits,
    available_units: Math.round(availableUnits),
    utilization: Math.round(utilization),
    resource_shortage: utilization > (rule.aggregation?.highlight_threshold?.utilization_percent || 80),

    total_personnel: totalMannschaft,
    deployed_personnel: deployedPersonnel,
    available_personnel: Math.max(0, totalMannschaft - deployedPersonnel),

    per_area: areas.map(area => {
      const areaIncidents = getIncidentsInArea(board, area.id).filter(
        i => i.column === "neu" || i.column === "in-bearbeitung"
      );
      let areaPersonnel = 0;
      let areaUnits = 0;
      const areaVehicles = new Set();

      for (const incident of areaIncidents) {
        for (const vehicleId of incident.assignedVehicles || []) {
          if (!areaVehicles.has(vehicleId)) {
            areaVehicles.add(vehicleId);
            areaPersonnel += vehicleMap.get(vehicleId) || 0;
            areaUnits++;
          }
        }
      }

      return {
        area_id: area.id,
        area_name: area.content,
        personnel: areaPersonnel,
        units: areaUnits
      };
    })
  };

  return resources;
}

/**
 * R5: Stabs-Fokus (modifiziert andere Filter-Ergebnisse)
 */
function applyRule_R5(filtered, rawData, rule) {
  const aggregateToSections = rule.stab_mode?.aggregate_to_sections !== false;
  const outputConfig = rule.output || {};
  const maxIndividual = outputConfig.max_individual_incidents
    ?? rule.stab_mode?.max_individual_incidents
    ?? rule.max_individual_incidents
    ?? 3;
  const minScore = outputConfig.min_score ?? rule.critical_scoring?.min_score ?? 0.6;
  const fallbackTopN = outputConfig.fallback_top_n_incidents ?? rule.fallback_top_n ?? 0;
  const showScore = outputConfig.show_score === true;

  if (!aggregateToSections) {
    return {
      max_individual_incidents: maxIndividual,
      min_required: rule.min_required ?? 1,
      fallback_top_n: fallbackTopN,
      min_score: minScore,
      critical_candidates: 0,
      selected_count: 0,
      fallback_used: false,
      critical_selected: 0,
      fallback_selected: 0,
      top_scores: []
    };
  }

  const board = rawData.board;
  if (!board || !board.columns) {
    filtered.incidents = [];
    return {
      max_individual_incidents: maxIndividual,
      min_required: rule.min_required ?? 1,
      fallback_top_n: fallbackTopN,
      min_score: minScore,
      critical_candidates: 0,
      selected_count: 0,
      fallback_used: false,
      critical_selected: 0,
      fallback_selected: 0,
      top_scores: []
    };
  }

  const scoringConfig = rule.scoring || rule.critical_scoring || { base_score: 0.5, factors: [] };
  const legacyConditions = rule.stab_mode?.show_individual_incidents_only_if || [];
  const activeIncidents = getAllIncidents(board).filter(
    incident => incident.column === "neu" || incident.column === "in-bearbeitung"
  );

  const candidates = activeIncidents.map(incident => {
    const text = buildIncidentScoreText(incident);
    const score = scoreIncidentEntry(incident, scoringConfig);
    const hasOpenQuestions = text.includes("?");
    const matchesLegacy = matchesLegacyConditions(incident, hasOpenQuestions, legacyConditions);
    return {
      incident,
      score,
      hasOpenQuestions,
      matchesLegacy,
      isCritical: score >= minScore || matchesLegacy,
      column: incident.column,
      timestamp: getIncidentTimestamp(incident),
      alerted: Boolean(incident.alerted),
      assignedCount: Array.isArray(incident.assignedVehicles) ? incident.assignedVehicles.length : 0
    };
  });

  const criticalCandidates = candidates.filter(item => item.isCritical);
  criticalCandidates.sort(compareCriticalCandidates);
  let selected = criticalCandidates.slice(0, maxIndividual);
  let fallbackUsed = false;

  if (selected.length === 0 && fallbackTopN > 0) {
    fallbackUsed = true;
    const fallbackCandidates = [...candidates].sort(compareFallbackCandidates);
    selected = fallbackCandidates.slice(0, fallbackTopN);
  }

  filtered.incidents = selected.map(item => {
    const entry = { ...item.incident };
    if (showScore) {
      entry._r5_score = item.score;
    }
    return entry;
  });

  return {
    max_individual_incidents: maxIndividual,
    min_required: rule.min_required ?? 1,
    fallback_top_n: fallbackTopN,
    min_score: minScore,
    critical_candidates: criticalCandidates.length,
    selected_count: selected.length,
    fallback_used: fallbackUsed,
    critical_selected: fallbackUsed ? 0 : selected.length,
    fallback_selected: fallbackUsed ? selected.length : 0,
    top_scores: criticalCandidates.slice(0, 3).map(item => item.score)
  };
}

// ============================================
// Hilfsfunktionen
// ============================================

/**
 * Findet alle Abschnitte (isArea: true)
 */
function getAreas(board) {
  const areas = [];
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    if (!column || !column.items) continue;

    for (const card of column.items) {
      if (card?.isArea) {
        areas.push(card);
      }
    }
  }
  return areas;
}

/**
 * Findet alle Incidents (nicht Abschnitte)
 */
function getAllIncidents(board) {
  const incidents = [];
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    if (!column || !column.items) continue;

    for (const card of column.items) {
      if (card && !card.isArea) {
        incidents.push({ ...card, column: columnKey });
      }
    }
  }
  return incidents;
}

/**
 * Findet Incidents in einem Abschnitt
 */
function getIncidentsInArea(board, areaId) {
  const incidents = [];
  for (const columnKey of ["neu", "in-bearbeitung", "erledigt"]) {
    const column = board.columns[columnKey];
    if (!column || !column.items) continue;

    for (const card of column.items) {
      if (card && !card.isArea && String(card.areaCardId) === String(areaId)) {
        incidents.push({ ...card, column: columnKey });
      }
    }
  }
  return incidents;
}

function getIncidentTimestamp(incident) {
  const raw = incident.timestamp || incident.createdAt || incident.updated || incident.statusSince || null;
  if (!raw) return 0;
  const parsed = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildIncidentScoreText(incident) {
  const assignedVehiclesText = Array.isArray(incident.assignedVehicles)
    ? incident.assignedVehicles.join(" ")
    : "";
  return [
    incident.content,
    incident.description,
    incident.typ,
    incident.ort,
    incident.location,
    incident.humanId,
    assignedVehiclesText
  ]
    .filter(Boolean)
    .map(value => String(value))
    .join(" ")
    .toLowerCase();
}

function matchesLegacyConditions(incident, hasOpenQuestions, legacyConditions = []) {
  for (const condition of legacyConditions) {
    if (condition?.field === "priority" && condition.value != null) {
      if (incident.priority === condition.value) return true;
    }
    if (condition?.field === "has_open_questions") {
      if (hasOpenQuestions === condition.value) return true;
    }
  }
  return false;
}

function compareCriticalCandidates(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.column !== b.column) {
    if (a.column === "neu") return -1;
    if (b.column === "neu") return 1;
  }
  return b.timestamp - a.timestamp;
}

function compareFallbackCandidates(a, b) {
  if (a.alerted !== b.alerted) {
    return a.alerted ? -1 : 1;
  }
  if (b.assignedCount !== a.assignedCount) {
    return b.assignedCount - a.assignedCount;
  }
  if (a.column !== b.column) {
    if (a.column === "neu") return -1;
    if (b.column === "neu") return 1;
  }
  return b.timestamp - a.timestamp;
}

/**
 * Berechnet Statistiken für einen Abschnitt
 */
function calculateAreaStats(board, area, rule) {
  const incidents = getIncidentsInArea(board, area.id);
  const activeIncidents = incidents.filter(i => i.column !== "erledigt");
  const criticalIncidents = incidents.filter(i => i.priority === "critical");

  const totalPersonnel = incidents.reduce((sum, i) => sum + (i.personnel || 0), 0);
  const avgPersonnelPerIncident = activeIncidents.length > 0
    ? totalPersonnel / activeIncidents.length
    : 0;

  // Berechne Priority Score basierend auf Regel-Faktoren
  let priorityScore = 0;

  for (const factor of rule.priority_factors || []) {
    let value = 0;

    switch (factor.field) {
      case "critical_incidents":
        value = criticalIncidents.length;
        break;
      case "total_incidents":
        value = incidents.length;
        break;
      case "total_personnel":
        value = totalPersonnel;
        break;
      case "avg_personnel_per_incident":
        value = avgPersonnelPerIncident;
        break;
    }

    // Evaluiere Operator
    let matches = false;
    switch (factor.operator) {
      case ">":
        matches = value > factor.value;
        break;
      case ">=":
        matches = value >= factor.value;
        break;
      case "<":
        matches = value < factor.value;
        break;
      case "<=":
        matches = value <= factor.value;
        break;
      case "==":
        matches = value === factor.value;
        break;
    }

    if (matches) {
      priorityScore += factor.score || 0;
    }
  }

  // Bestimme Priorität
  let priority = "medium";
  if (criticalIncidents.length > 0) {
    priority = "critical";
  } else if (activeIncidents.length >= 5) {
    priority = "high";
  }

  return {
    id: area.id,
    humanId: area.humanId,
    name: area.content,
    location: area.location || "",
    color: area.areaColor,

    total_incidents: incidents.length,
    active_incidents: activeIncidents.length,
    critical_incidents: criticalIncidents.length,

    total_personnel: totalPersonnel,
    avg_personnel_per_incident: Math.round(avgPersonnelPerIncident * 10) / 10,

    priority,
    priority_score: priorityScore,

    column: area.column
  };
}

/**
 * Bewertet Protokoll-Eintrag
 */
function scoreProtocolEntry(entry, rule, learnedWeights = {}) {
  const text = [
    entry.information,  // Hauptfeld für Protokoll-Inhalt
    entry.info,         // Alternativfeld
    entry.infoTyp,      // Typ der Information
    entry.infoType,     // Alternativfeld für Typ
    entry.anvon,        // Von wem
    entry.subject,
    entry.title,
    ...(Array.isArray(entry?.massnahmen)
      ? entry.massnahmen.map((item) => item?.massnahme).filter(Boolean)
      : [])
  ]
    .filter(Boolean)
    .map((value) => String(value))
    .join(" ")
    .toLowerCase();
  const { score } = scoreText(text, rule.scoring || {}, learnedWeights);
  return score;
}

function scoreIncidentEntry(incident, scoringRule) {
  const text = buildIncidentScoreText(incident);
  const baseScore = scoringRule?.base_score ?? 0.5;
  let score = baseScore;

  for (const factor of scoringRule?.factors || []) {
    let matches = false;

    if (factor.pattern) {
      const regex = new RegExp(factor.pattern, "i");
      matches = regex.test(text);
    }

    if (!matches && factor.keywords && Array.isArray(factor.keywords)) {
      for (const keyword of factor.keywords) {
        if (text.includes(String(keyword).toLowerCase())) {
          matches = true;
          break;
        }
      }
    }

    if (matches) {
      score += factor.weight || 0;
    }
  }

  return score;
}

function scoreText(textInput, scoringConfig = {}, learnedWeights = {}) {
  const baseScore = scoringConfig.base_score ?? 0;
  let score = baseScore;
  const matched = [];

  const text = String(textInput || "").toLowerCase();

  for (const factor of scoringConfig.factors || []) {
    let matches = false;

    if (factor.pattern) {
      const regex = new RegExp(factor.pattern, "i");
      matches = regex.test(text);
    }

    if (!matches && factor.keywords && Array.isArray(factor.keywords)) {
      for (const keyword of factor.keywords) {
        if (text.includes(String(keyword).toLowerCase())) {
          matches = true;
          break;
        }
      }
    }

    if (matches) {
      const weight = factor.learnable && learnedWeights[factor.name] != null
        ? learnedWeights[factor.name]
        : factor.weight || 0;

      score += weight;
      if (factor.name) {
        matched.push(factor.name);
      }
    }
  }

  return {
    score,
    matched
  };
}

/**
 * Berechnet durchschnittliche Einsatzdauer
 */
function calculateAvgDuration(incidents) {
  if (incidents.length === 0) return 0;

  const now = Date.now();
  const durations = incidents.map(i => {
    const start = i.timestamp ? new Date(i.timestamp).getTime() : now;
    const end = i.updated ? new Date(i.updated).getTime() : now;
    return (end - start) / (1000 * 60); // Minuten
  });

  const sum = durations.reduce((a, b) => a + b, 0);
  return Math.round(sum / durations.length);
}

export default {
  loadFilteringRules,
  invalidateRulesCache,
  applyAllFilteringRules
};
