// chatbot/server/context_fingerprint.js
//
// Context-Fingerprint Extraktion
// Erstellt strukturierte "Signatur" der aktuellen Lage für Matching

import { logDebug } from "./logger.js";

/**
 * Extrahiert Context-Fingerprint aus gefilterten Daten
 */
export function extractContextFingerprint(filteredData, rawData, previousFingerprint = null) {
  const fingerprint = {
    version: "1.0",
    timestamp: Date.now(),

    // BASIS
    disaster_type: rawData.disaster?.type || "unknown",
    phase: rawData.disaster?.phase || "initial",
    hours_running: calculateHoursRunning(rawData.disaster?.start_time),

    // ABSCHNITTE (aus Regel R1)
    total_sections: filteredData.abschnitte?.length || 0,
    critical_sections: filteredData.abschnitte?.filter(a => a.priority === "critical").length || 0,
    critical_section_names: filteredData.abschnitte
      ?.filter(a => a.priority === "critical")
      .map(a => a.name)
      .slice(0, 3) || [],

    // EINSATZSTELLEN
    total_incidents: countAllIncidents(rawData.board),
    active_incidents: countActiveIncidents(rawData.board),
    critical_incidents: countCriticalIncidents(rawData.board),
    new_incidents_last_hour: filteredData.trends?.new_incidents || 0,
    closed_incidents_last_hour: filteredData.trends?.closed_incidents || 0,

    // GEOGRAFISCH (aus Regel R1)
    ...analyzeGeographicDistribution(filteredData.abschnitte, rawData.board),

    // TRENDS (aus Regel R3)
    trend_direction: filteredData.trends?.direction || "stable",
    trend_strength: filteredData.trends?.strength || "weak",
    forecast_2h_incidents: filteredData.trends?.forecast_2h || 0,

    // RESSOURCEN (aus Regel R4)
    total_units: filteredData.resources?.total_units || 0,
    available_units: filteredData.resources?.available_units || 0,
    deployed_units: filteredData.resources?.deployed_units || 0,
    utilization_percent: filteredData.resources?.utilization || 0,
    resource_shortage: filteredData.resources?.resource_shortage || false,

    total_personnel: filteredData.resources?.total_personnel || 0,
    deployed_personnel: filteredData.resources?.deployed_personnel || 0,
    available_personnel: filteredData.resources?.available_personnel || 0,

    // DAUER
    avg_incident_duration_minutes: filteredData.trends?.avg_duration_minutes || 0,

    // PROTOKOLL (aus Regel R2)
    dominant_protocol_types: getTopProtocolTypes(filteredData.protocol, 3),
    open_questions_count: countProtocolType(filteredData.protocol, "Offene Fragen"),
    resource_requests_count: countProtocolType(filteredData.protocol, "Ressourcen-Anfrage"),
    safety_critical_count: countProtocolType(filteredData.protocol, "Sicherheitskritisch"),
    protocol_entries_total: rawData.protocol?.length || 0,

    // VERÄNDERUNGEN (Delta)
    ...calculateDelta(rawData, previousFingerprint),

    // KRITISCHE INDIKATOREN
    external_deadlines: hasKeywords(filteredData.protocol, ["deadline", "lagebericht", "meldung bis"]),
    media_interest: hasKeywords(filteredData.protocol, ["presse", "medien", "orf", "zeitung"]),
    infrastructure_threatened: hasKeywords(filteredData.protocol, ["wasserwerk", "kraftwerk", "infrastruktur"]),
    communication_problems: hasKeywords(filteredData.protocol, ["funk", "kommunikation", "erreichbar"])
  };

  logDebug("Context-Fingerprint erstellt", {
    disaster_type: fingerprint.disaster_type,
    phase: fingerprint.phase,
    total_incidents: fingerprint.total_incidents,
    utilization: fingerprint.utilization_percent
  });

  return fingerprint;
}

/**
 * Matching-Algorithmus: Vergleicht zwei Fingerprints
 */
export function matchFingerprints(current, learned) {
  if (!current || !learned) return 0;

  let score = 0;

  // 1. DISASTER-TYPE (wichtigster Faktor)
  if (current.disaster_type === learned.disaster_type) {
    score += 20;
  }

  // 2. PHASE
  if (current.phase === learned.phase) {
    score += 10;
  }

  // 3. GEOGRAFISCHES MUSTER
  if (current.geographic_pattern === learned.geographic_pattern) {
    score += 8;
  }

  // 4. TREND-RICHTUNG
  if (current.trend_direction === learned.trend_direction) {
    score += 7;
  }

  // 5. RESSOURCEN-ENGPASS
  if (current.resource_shortage === learned.resource_shortage) {
    score += 6;
  }

  // 6. GRÖSSENORDNUNGen (ähnliche Anzahl Einsatzstellen)
  const incidentDiff = Math.abs(current.total_incidents - learned.total_incidents);
  if (incidentDiff < 10) score += 5;
  else if (incidentDiff < 20) score += 3;
  else if (incidentDiff < 30) score += 1;

  // 7. PROTOKOLL-TYPEN (Overlap)
  if (current.dominant_protocol_types && learned.dominant_protocol_types) {
    const typeOverlap = current.dominant_protocol_types.filter(t =>
      learned.dominant_protocol_types.includes(t)
    ).length;
    score += typeOverlap * 3;
  }

  // 8. AUSLASTUNG (ähnliche Prozentzahl)
  const utilizationDiff = Math.abs(current.utilization_percent - learned.utilization_percent);
  if (utilizationDiff < 10) score += 4;
  else if (utilizationDiff < 20) score += 2;

  // 9. TREND-STÄRKE
  if (current.trend_strength === learned.trend_strength) {
    score += 3;
  }

  // 10. KRITISCHE INDIKATOREN (Bonus für Übereinstimmungen)
  if (current.external_deadlines === learned.external_deadlines) score += 2;
  if (current.media_interest === learned.media_interest) score += 2;
  if (current.infrastructure_threatened === learned.infrastructure_threatened) score += 2;

  return score;
}

// ============================================
// Hilfsfunktionen
// ============================================

function calculateHoursRunning(startTime) {
  if (!startTime) return 0;
  const start = new Date(startTime).getTime();
  const now = Date.now();
  return Math.round((now - start) / (1000 * 60 * 60) * 10) / 10;
}

function countAllIncidents(board) {
  if (!board?.columns) return 0;
  let count = 0;
  for (const col of Object.values(board.columns)) {
    if (col.items) {
      count += col.items.filter(item => item && !item.isArea).length;
    }
  }
  return count;
}

function countActiveIncidents(board) {
  if (!board?.columns) return 0;
  let count = 0;
  for (const colKey of ["neu", "in-bearbeitung"]) {
    const col = board.columns[colKey];
    if (col?.items) {
      count += col.items.filter(item => item && !item.isArea).length;
    }
  }
  return count;
}

function countCriticalIncidents(board) {
  if (!board?.columns) return 0;
  let count = 0;
  for (const col of Object.values(board.columns)) {
    if (col?.items) {
      count += col.items.filter(item => item && !item.isArea && item.priority === "critical").length;
    }
  }
  return count;
}

function analyzeGeographicDistribution(abschnitte, board) {
  if (!abschnitte || abschnitte.length === 0) {
    return {
      geographic_pattern: "unknown",
      hotspot_count: 0,
      hotspot_locations: [],
      incidents_in_hotspots: 0,
      incidents_scattered: countAllIncidents(board)
    };
  }

  const totalIncidents = countAllIncidents(board);
  const hotspots = abschnitte.filter(a => a.total_incidents >= 5);
  const incidentsInHotspots = hotspots.reduce((sum, h) => sum + h.total_incidents, 0);

  let pattern;
  if (abschnitte.length === 1 || incidentsInHotspots > totalIncidents * 0.8) {
    pattern = "concentrated";
  } else if (abschnitte.length >= 4) {
    pattern = "distributed";
  } else {
    pattern = "clustered";
  }

  return {
    geographic_pattern: pattern,
    hotspot_count: hotspots.length,
    hotspot_locations: hotspots.map(h => h.name).slice(0, 3),
    incidents_in_hotspots: incidentsInHotspots,
    incidents_scattered: totalIncidents - incidentsInHotspots
  };
}

function getTopProtocolTypes(protocol, topN = 3) {
  if (!protocol || !Array.isArray(protocol)) return [];

  // Zähle Protokoll-Typen (basierend auf _score-Klassifikation aus R2)
  const typeCounts = {};

  for (const entry of protocol) {
    // Klassifiziere basierend auf Inhalt
    const text = String(entry.content || entry.text || "").toLowerCase();
    let type = "Statusmeldung";

    if (text.includes("?")) type = "Offene Fragen";
    else if (text.match(/evakuierung|gefahr|notfall|dringend/i)) type = "Sicherheitskritisch";
    else if (text.match(/benötigt|anforderung|fahrzeug|personal/i)) type = "Ressourcen-Anfrage";
    else if (text.match(/erledigt|fertig|abgeschlossen/i)) type = "Abgeschlossene Aufgabe";

    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  return Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([type]) => type);
}

function countProtocolType(protocol, typeName) {
  if (!protocol || !Array.isArray(protocol)) return 0;

  const keywords = {
    "Offene Fragen": ["?"],
    "Ressourcen-Anfrage": ["benötigt", "anforderung", "fahrzeug", "personal"],
    "Sicherheitskritisch": ["evakuierung", "gefahr", "notfall", "dringend"]
  };

  const typeKeywords = keywords[typeName] || [];

  return protocol.filter(entry => {
    const text = String(entry.content || entry.text || "").toLowerCase();
    return typeKeywords.some(kw => text.includes(kw));
  }).length;
}

function calculateDelta(rawData, previousFingerprint) {
  if (!previousFingerprint) {
    return {
      incidents_added_since_last: 0,
      incidents_closed_since_last: 0,
      utilization_change_percent: 0,
      protocol_entries_since_last: 0
    };
  }

  const currentIncidents = countAllIncidents(rawData.board);
  const currentProtocol = rawData.protocol?.length || 0;

  return {
    incidents_added_since_last: Math.max(0, currentIncidents - previousFingerprint.total_incidents),
    incidents_closed_since_last: 0, // TODO: Tracken
    utilization_change_percent: 0, // TODO: Berechnen
    protocol_entries_since_last: Math.max(0, currentProtocol - previousFingerprint.protocol_entries_total)
  };
}

function hasKeywords(protocol, keywords) {
  if (!protocol || !Array.isArray(protocol)) return false;

  return protocol.some(entry => {
    const text = String(entry.content || entry.text || "").toLowerCase();
    return keywords.some(kw => text.includes(kw.toLowerCase()));
  });
}

export default {
  extractContextFingerprint,
  matchFingerprints
};
