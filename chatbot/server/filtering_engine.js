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

let cachedRules = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 60000; // 1 Minute

// Vordefinierte Standard-Regeln (R1-R5)
const DEFAULT_RULES = {
  version: "1.0.0",
  limits: {
    max_total_tokens: 2500,
    max_context_size_kb: 50
  },
  rules: {
    R1_ABSCHNITTE_PRIORITAET: {
      enabled: true,
      description: "Filtert Abschnitte nach Priorität und zeigt die wichtigsten",
      applies_to: "board",
      priority_factors: [
        { field: "critical_incidents", operator: ">", value: 0, score: 100 },
        { field: "total_incidents", operator: ">=", value: 5, score: 50 },
        { field: "total_personnel", operator: ">=", value: 20, score: 30 },
        { field: "avg_personnel_per_incident", operator: ">=", value: 5, score: 20 }
      ],
      output: {
        max_items: 5
      }
    },
    R2_PROTOKOLL_RELEVANZ: {
      enabled: true,
      description: "Filtert Protokoll-Einträge nach Relevanz",
      applies_to: "protocol",
      scoring: {
        base_score: 0.5,
        factors: [
          { name: "Offene Fragen", pattern: "\\?", weight: 0.3, learnable: true },
          { name: "Ressourcen-Anfrage", keywords: ["anfordern", "anforderung", "benötigt", "brauchen", "verstärkung"], weight: 0.25, learnable: true },
          { name: "Statusmeldung", keywords: ["status", "lage", "situation", "aktuell"], weight: 0.15, learnable: true },
          { name: "Dringend", keywords: ["dringend", "sofort", "kritisch", "notfall", "alarm"], weight: 0.4, learnable: false },
          { name: "Warnung", keywords: ["warnung", "achtung", "gefahr", "vorsicht"], weight: 0.35, learnable: false }
        ]
      },
      output: {
        max_entries: 10,
        min_score: 0.6,
        show_score: false
      }
    },
    R3_TRENDS_ERKENNUNG: {
      enabled: true,
      description: "Erkennt Trends in der Einsatzentwicklung",
      applies_to: "board",
      time_windows: [60, 120],
      output: {
        forecast_horizon_minutes: 120
      }
    },
    R4_RESSOURCEN_STATUS: {
      enabled: true,
      description: "Analysiert den Ressourcen-Status und erkennt Engpässe",
      applies_to: "board",
      aggregation: {
        highlight_threshold: {
          utilization_percent: 80
        }
      }
    },
    R5_STABS_FOKUS: {
      enabled: false,
      description: "Aggregiert Daten für Stabs-Ansicht (nur kritische Einzeleinsätze)",
      applies_to: "all",
      stab_mode: {
        aggregate_to_sections: true,
        max_individual_incidents: 3,
        show_individual_incidents_only_if: [
          { field: "priority", value: "critical" },
          { field: "has_open_questions", value: true }
        ]
      }
    }
  }
};

/**
 * Lädt Filterregeln aus JSON-Datei
 */
export async function loadFilteringRules() {
  try {
    // Cache-Check
    if (cachedRules && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
      return cachedRules;
    }

    let rules;
    try {
      const raw = await fsPromises.readFile(RULES_FILE, "utf8");
      rules = JSON.parse(raw);
    } catch (readErr) {
      // Datei existiert nicht - Default verwenden
      logInfo("Keine filtering_rules.json gefunden, verwende vordefinierte Regeln");
      rules = DEFAULT_RULES;
    }

    cachedRules = rules;
    cacheTimestamp = Date.now();

    logDebug("Filterregeln geladen", {
      version: rules.version,
      ruleCount: Object.keys(rules.rules || {}).length
    });

    return rules;
  } catch (err) {
    logError("Fehler beim Laden der Filterregeln", {
      error: String(err),
      file: RULES_FILE
    });
    // Fallback: Default-Regeln
    return DEFAULT_RULES;
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
 * Wendet alle aktivierten Regeln an
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

  // Regel R1: Abschnitte-Priorität
  if (rules.rules.R1_ABSCHNITTE_PRIORITAET?.enabled) {
    filtered.abschnitte = applyRule_R1(rawData.board, rules.rules.R1_ABSCHNITTE_PRIORITAET);
  }

  // Regel R2: Protokoll-Relevanz
  if (rules.rules.R2_PROTOKOLL_RELEVANZ?.enabled) {
    filtered.protocol = applyRule_R2(rawData.protocol, rules.rules.R2_PROTOKOLL_RELEVANZ, learnedWeights);
  }

  // Regel R3: Trends-Erkennung
  if (rules.rules.R3_TRENDS_ERKENNUNG?.enabled) {
    filtered.trends = applyRule_R3(rawData.board, rules.rules.R3_TRENDS_ERKENNUNG);
  }

  // Regel R4: Ressourcen-Status
  if (rules.rules.R4_RESSOURCEN_STATUS?.enabled) {
    filtered.resources = applyRule_R4(rawData.board, rules.rules.R4_RESSOURCEN_STATUS);
  }

  // Regel R5: Stabs-Fokus (modifiziert andere Regeln)
  if (rules.rules.R5_STABS_FOKUS?.enabled) {
    applyRule_R5(filtered, rawData, rules.rules.R5_STABS_FOKUS);
  }

  return { filtered, rules };
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
 */
function applyRule_R4(board, rule) {
  if (!board || !board.columns) return {};

  const areas = getAreas(board);
  const incidents = getAllIncidents(board);

  // Gesamt-Ressourcen
  const totalPersonnel = incidents.reduce((sum, i) => sum + (i.personnel || 0), 0);
  const totalIncidents = incidents.filter(i => i.column !== "erledigt").length;

  // Schätze verfügbare Einheiten (Heuristik: 1 Einheit = ~5 Personen)
  const deployedUnits = Math.ceil(totalPersonnel / 5);
  const totalUnits = 50; // TODO: Aus Konfiguration
  const availableUnits = Math.max(0, totalUnits - deployedUnits);
  const utilization = totalUnits > 0 ? (deployedUnits / totalUnits) * 100 : 0;

  const resources = {
    total_units: totalUnits,
    deployed_units: deployedUnits,
    available_units: availableUnits,
    utilization: Math.round(utilization),
    resource_shortage: utilization > (rule.aggregation?.highlight_threshold?.utilization_percent || 80),

    total_personnel: totalPersonnel,
    deployed_personnel: totalPersonnel,
    available_personnel: 0, // TODO: Berechnen

    per_area: areas.map(area => {
      const areaIncidents = getIncidentsInArea(board, area.id);
      const areaPersonnel = areaIncidents.reduce((sum, i) => sum + (i.personnel || 0), 0);
      const areaUnits = Math.ceil(areaPersonnel / 5);

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
  if (!rule.stab_mode?.aggregate_to_sections) return;

  // Zeige nur kritische Einzeleinsätze
  const maxIndividual = rule.stab_mode.max_individual_incidents || 3;
  const board = rawData.board;

  if (board && board.columns) {
    const criticalIncidents = getAllIncidents(board).filter(incident => {
      // Prüfe Bedingungen
      for (const condition of rule.stab_mode.show_individual_incidents_only_if || []) {
        if (condition.field === "priority" && incident.priority === condition.value) {
          return true;
        }
        if (condition.field === "has_open_questions") {
          // TODO: Implementieren
          return false;
        }
      }
      return false;
    });

    filtered.incidents = criticalIncidents.slice(0, maxIndividual);
  }
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
  let score = rule.scoring?.base_score || 0.5;

  const text = String(entry.content || entry.text || "").toLowerCase();

  for (const factor of rule.scoring?.factors || []) {
    let matches = false;

    // Pattern-Matching (Regex)
    if (factor.pattern) {
      const regex = new RegExp(factor.pattern, "i");
      matches = regex.test(text);
    }

    // Keyword-Matching
    if (factor.keywords && Array.isArray(factor.keywords)) {
      for (const keyword of factor.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          matches = true;
          break;
        }
      }
    }

    if (matches) {
      // Verwende gelerntes Gewicht falls vorhanden
      const weight = factor.learnable && learnedWeights[factor.name]
        ? learnedWeights[factor.name]
        : factor.weight;

      score += weight;
    }
  }

  return score;
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
