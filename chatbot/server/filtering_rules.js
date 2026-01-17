/**
 * Filtering Rules für LLM Context Optimization
 *
 * Dieses Modul enthält alle Regeln zur intelligenten Filterung von EINFO-Daten
 * bevor sie an die LLM gesendet werden.
 *
 * Struktur:
 * - Jede Regel ist eine Funktion die konfigurierbar ist
 * - Regeln können ein-/ausgeschaltet werden
 * - Regeln können priorisiert werden (order)
 * - Regeln sind unabhängig voneinander testbar
 */

// ============================================================================
// KONFIGURATIONS-SCHEMA
// ============================================================================

/**
 * Zentrale Konfiguration für alle Filter-Regeln
 * Kann zur Laufzeit angepasst werden
 */
export const FILTERING_CONFIG = {
  incidents: {
    enabled: true,
    maxCount: 10,
    alwaysShowPriorities: ['critical', 'high'],
    preferLargeOps: true, // Bevorzuge Einsätze mit vielen Einheiten
    includeAlertedUnits: false // Alarmierte Einheiten zeigen (verbose)
  },

  protocol: {
    enabled: true,
    maxCount: 10,
    scoring: {
      openQuestion: 10,
      safetyCritical: 10,
      urgent: 8,
      resourceRequest: 5,
      staffSender: 3, // S1, S2, LTSTB wichtiger
      infoOnly: -2
    },
    maxPerCategory: 3, // Verhindert nur Fragen oder nur Infos
    keywords: {
      safetyCritical: ['evakuierung', 'evakuieren', 'gefahr', 'verletzt', 'verletzte'],
      urgent: ['dringend', 'sofort', 'kritisch', 'eilig', 'asap'],
      resourceRequest: ['anfrage', 'benötige', 'brauche', 'bitte um', 'nachforderung'],
      infoOnly: ['information', 'zur kenntnis', 'info:', 'fyi']
    }
  },

  tasks: {
    enabled: true,
    showDetails: 'critical_only', // 'all', 'critical_only', 'aggregated'
    overloadThreshold: 5, // Ab wann Rolle als "überlastet" markiert
    maxTasksPerRole: 2 // Max Details pro Rolle
  },

  resources: {
    enabled: true,
    calculateDeployment: true,
    calculateAvailability: false, // Benötigt externe Daten (Gesamt-Einheiten)
    highLoadThresholds: {
      FF: 10,
      RK: 5,
      POL: 5
    }
  },

  trends: {
    enabled: true,
    timeWindowHours: 1,
    thresholds: {
      rapidEscalation: 10, // Einsätze pro Stunde
      escalation: 5,
      resolution: 2
    }
  }
};

// ============================================================================
// REGEL-FUNKTIONEN
// ============================================================================

/**
 * REGEL 1: Incidents Filtering
 * Filtert Einsatzstellen nach Relevanz und Priorität
 */
export function filterIncidents(activeIncidents, config = FILTERING_CONFIG.incidents) {
  if (!config.enabled) return activeIncidents;

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  // Sub-Regel 1.1: Alle high-priority IMMER zeigen
  const highPriority = activeIncidents.filter(i =>
    config.alwaysShowPriorities.includes(i.priority)
  );

  // Sub-Regel 1.2: Von anderen nach Wichtigkeit sortieren
  const remaining = activeIncidents.filter(i =>
    !config.alwaysShowPriorities.includes(i.priority)
  );

  const sorted = remaining.sort((a, b) => {
    // 1.2.1: Sortiere primär nach Priorität
    const priorityDiff = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;

    // 1.2.2: Bei gleicher Prio: Bevorzuge große Operationen (mehr Einheiten)
    if (config.preferLargeOps) {
      const unitsA = (a.alerted || '').split(',').filter(u => u.trim()).length;
      const unitsB = (b.alerted || '').split(',').filter(u => u.trim()).length;
      if (unitsA !== unitsB) return unitsB - unitsA;
    }

    // 1.2.3: Sonst nach Zeit (neuere zuerst)
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });

  // Sub-Regel 1.3: Kombiniere und limitiere
  const fillSlots = Math.max(0, config.maxCount - highPriority.length);
  return [...highPriority, ...sorted.slice(0, fillSlots)];
}

/**
 * REGEL 2: Protocol Scoring & Filtering
 * Bewertet Protokoll-Einträge nach Relevanz
 */
export function scoreProtocolEntry(entry, config = FILTERING_CONFIG.protocol) {
  if (!config.enabled) return { ...entry, relevance: 0, category: 'routine' };

  const info = String(entry.information || '').toLowerCase();
  const sender = String(entry.anvon || '').toLowerCase();

  let relevance = 0;
  let category = 'routine';

  // Sub-Regel 2.1: Offene Fragen (höchste Priorität)
  if (info.includes('?')) {
    relevance += config.scoring.openQuestion;
    category = 'open_question';
  }

  // Sub-Regel 2.2: Safety-Critical Keywords
  const hasSafetyCritical = config.keywords.safetyCritical.some(kw => info.includes(kw));
  if (hasSafetyCritical) {
    relevance += config.scoring.safetyCritical;
    category = 'safety_critical';
  }

  // Sub-Regel 2.3: Dringende Anfragen
  const hasUrgent = config.keywords.urgent.some(kw => info.includes(kw));
  if (hasUrgent) {
    relevance += config.scoring.urgent;
    if (category === 'routine') category = 'urgent';
  }

  // Sub-Regel 2.4: Ressourcen-Anfragen
  const hasResourceRequest = config.keywords.resourceRequest.some(kw => info.includes(kw));
  if (hasResourceRequest) {
    relevance += config.scoring.resourceRequest;
    if (category === 'routine') category = 'resource_request';
  }

  // Sub-Regel 2.5: Stabs-Kommunikation wichtiger
  const isStaffSender = ['s1', 's2', 's3', 's4', 's5', 's6', 'ltstb'].some(role =>
    sender.includes(role)
  );
  if (isStaffSender) {
    relevance += config.scoring.staffSender;
  }

  // Sub-Regel 2.6: Reine Info-Meldungen abwerten
  const isInfoOnly = config.keywords.infoOnly.some(kw => info.includes(kw));
  if (isInfoOnly) {
    relevance += config.scoring.infoOnly;
    if (category === 'routine') category = 'info_only';
  }

  return { ...entry, relevance, category };
}

export function filterProtocol(protokoll, config = FILTERING_CONFIG.protocol) {
  if (!config.enabled) return protokoll.slice(0, config.maxCount);

  // Regel 2: Bewerte alle Einträge
  const scored = protokoll.map(entry => scoreProtocolEntry(entry, config));

  // Sub-Regel 2.7: Sortiere nach Relevanz, dann Zeit
  const sorted = scored.sort((a, b) => {
    if (a.relevance !== b.relevance) {
      return b.relevance - a.relevance;
    }
    return (b._timestamp ?? 0) - (a._timestamp ?? 0);
  });

  // Sub-Regel 2.8: Garantiere Diversität (nicht nur eine Kategorie)
  const result = [];
  const categoryCounts = {};

  for (const entry of sorted) {
    if (result.length >= config.maxCount) break;

    categoryCounts[entry.category] = (categoryCounts[entry.category] || 0);

    // Überspringe wenn Kategorie-Limit erreicht
    if (categoryCounts[entry.category] >= config.maxPerCategory) {
      continue;
    }

    result.push(entry);
    categoryCounts[entry.category]++;
  }

  return result;
}

/**
 * REGEL 3: Task Aggregation
 * Fasst Aufgaben zusammen, zeigt nur kritische Details
 */
export function aggregateTasks(openTasks, config = FILTERING_CONFIG.tasks) {
  if (!config.enabled) return openTasks;

  // Gruppiere nach Rolle
  const byRole = {};
  openTasks.forEach(task => {
    const role = task._role || task.responsible || 'Unbekannt';
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(task);
  });

  const result = {};

  for (const [role, tasks] of Object.entries(byRole)) {
    const roleData = {
      count: tasks.length,
      overloaded: tasks.length > config.overloadThreshold,
      critical: []
    };

    // Sub-Regel 3.1: Identifiziere kritische Aufgaben
    if (config.showDetails !== 'aggregated') {
      const critical = tasks.filter(t => {
        const isOverdue = t.dueAt && new Date(t.dueAt) < Date.now();
        const isUrgent = String(t.title || '').toLowerCase().includes('dringend');
        return isOverdue || isUrgent;
      });

      // Sub-Regel 3.2: Limitiere Details
      if (config.showDetails === 'critical_only') {
        roleData.critical = critical.slice(0, config.maxTasksPerRole);
      } else if (config.showDetails === 'all') {
        roleData.critical = tasks.slice(0, config.maxTasksPerRole);
      }
    }

    result[role] = roleData;
  }

  return result;
}

/**
 * REGEL 4: Resource Status Calculation
 * Berechnet Ressourcen-Auslastung aus Einsatzstellen
 */
export function calculateResourceStatus(activeIncidents, config = FILTERING_CONFIG.resources) {
  if (!config.enabled) {
    return {
      totalIncidents: activeIncidents.length,
      totalUnitsDeployed: 0,
      byType: {},
      warnings: []
    };
  }

  let totalUnitsDeployed = 0;
  const unitsByType = {};

  // Sub-Regel 4.1: Zähle alarmierte Einheiten
  if (config.calculateDeployment) {
    for (const incident of activeIncidents) {
      if (incident.alerted) {
        const units = incident.alerted.split(',')
          .map(u => u.trim())
          .filter(u => u.length > 0);

        totalUnitsDeployed += units.length;

        units.forEach(unit => {
          const type = detectUnitType(unit);
          unitsByType[type] = (unitsByType[type] || 0) + 1;
        });
      }
    }
  }

  // Sub-Regel 4.2: Prüfe Auslastung
  const warnings = [];
  for (const [type, count] of Object.entries(unitsByType)) {
    const threshold = config.highLoadThresholds[type];
    if (threshold && count > threshold) {
      warnings.push(`${getUnitTypeName(type)} stark ausgelastet (${count} Einheiten)`);
    }
  }

  return {
    totalIncidents: activeIncidents.length,
    totalUnitsDeployed,
    byType: unitsByType,
    warnings
  };
}

/**
 * REGEL 5: Trend Detection
 * Erkennt Eskalation/Entspannung aus Timeline
 */
export function calculateTrends(timeline, currentBoard, config = FILTERING_CONFIG.trends) {
  if (!config.enabled) {
    return {
      trend: 'unknown',
      incidentsPerHour: 0,
      resolvedPerHour: 0,
      netChange: 0,
      interpretation: 'Trend-Analyse deaktiviert'
    };
  }

  const now = Date.now();
  const windowMs = config.timeWindowHours * 60 * 60 * 1000;
  const windowStart = now - windowMs;

  // Sub-Regel 5.1: Zähle neue Einsätze im Zeitfenster
  const newIncidents = timeline.filter(event => {
    if (!event.timestamp || event.timestamp < windowStart) return false;
    const eventText = String(event.event || '').toLowerCase();
    return eventText.includes('neuer einsatz') || eventText.includes('einsatz erstellt');
  });

  const incidentsPerHour = newIncidents.length / config.timeWindowHours;

  // Sub-Regel 5.2: Zähle erledigte Einsätze
  const resolved = timeline.filter(event => {
    if (!event.timestamp || event.timestamp < windowStart) return false;
    const eventText = String(event.event || '').toLowerCase();
    return eventText.includes('erledigt') || eventText.includes('abgeschlossen');
  });

  const resolvedPerHour = resolved.length / config.timeWindowHours;
  const netChange = incidentsPerHour - resolvedPerHour;

  // Sub-Regel 5.3: Bestimme Trend
  let trend = 'stable';
  if (incidentsPerHour >= config.thresholds.rapidEscalation) {
    trend = 'rapidly_escalating';
  } else if (incidentsPerHour >= config.thresholds.escalation) {
    trend = 'escalating';
  } else if (incidentsPerHour < config.thresholds.resolution) {
    trend = 'resolving';
  }

  return {
    trend,
    incidentsPerHour: Math.round(incidentsPerHour * 10) / 10,
    resolvedPerHour: Math.round(resolvedPerHour * 10) / 10,
    netChange: Math.round(netChange * 10) / 10,
    interpretation: interpretTrend(trend, netChange, incidentsPerHour, resolvedPerHour)
  };
}

// ============================================================================
// HELPER-FUNKTIONEN
// ============================================================================

/**
 * Erkennt Einheitstyp aus Alarmierungs-String
 */
function detectUnitType(unitString) {
  const unit = unitString.toLowerCase();
  if (unit.includes('ff') || unit.includes('feuerwehr')) return 'FF';
  if (unit.includes('rk') || unit.includes('rettung')) return 'RK';
  if (unit.includes('pol') || unit.includes('polizei')) return 'POL';
  if (unit.includes('thw')) return 'THW';
  if (unit.includes('bg') || unit.includes('bundesheer')) return 'BG';
  return 'Sonstige';
}

/**
 * Gibt lesbaren Namen für Einheitstyp zurück
 */
function getUnitTypeName(type) {
  const names = {
    FF: 'Feuerwehr',
    RK: 'Rettungsdienst',
    POL: 'Polizei',
    THW: 'THW',
    BG: 'Bundesheer'
  };
  return names[type] || type;
}

/**
 * Interpretiert Trend für Ausgabe
 */
function interpretTrend(trend, netChange, newRate, resolvedRate) {
  const netSign = netChange > 0 ? '+' : '';

  if (trend === 'rapidly_escalating') {
    return `⚠️ KRITISCH: ${netSign}${netChange} Einsätze/h - Lage eskaliert rapide`;
  }
  if (trend === 'escalating') {
    return `⚠️ Lage verschärft sich (${netSign}${netChange} Einsätze/h)`;
  }
  if (trend === 'resolving') {
    return `✓ Lage entspannt sich (${resolvedRate} erledigt/h, ${newRate} neu/h)`;
  }
  return `Lage stabil (${newRate} neu/h, ${resolvedRate} erledigt/h)`;
}

// ============================================================================
// EXPORT CONVENIENCE-FUNKTION
// ============================================================================

/**
 * Wendet alle Regeln auf EINFO-Daten an
 * Zentrale Funktion die von disaster_context.js aufgerufen wird
 */
export function applyAllFilteringRules(einfoData, customConfig = {}) {
  // Merge custom config mit defaults
  const config = {
    incidents: { ...FILTERING_CONFIG.incidents, ...customConfig.incidents },
    protocol: { ...FILTERING_CONFIG.protocol, ...customConfig.protocol },
    tasks: { ...FILTERING_CONFIG.tasks, ...customConfig.tasks },
    resources: { ...FILTERING_CONFIG.resources, ...customConfig.resources },
    trends: { ...FILTERING_CONFIG.trends, ...customConfig.trends }
  };

  // Wende alle Regeln an
  return {
    incidents: filterIncidents(einfoData.activeIncidents, config.incidents),
    protocol: filterProtocol(einfoData.protokoll, config.protocol),
    tasks: aggregateTasks(einfoData.openTasks, config.tasks),
    resources: calculateResourceStatus(einfoData.activeIncidents, config.resources),
    trends: calculateTrends(einfoData.timeline, einfoData.board, config.trends)
  };
}
