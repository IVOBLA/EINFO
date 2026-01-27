// chatbot/server/scenario_controls.js

const DEFAULT_MINUTES_PER_STEP = 5;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBehaviorPhase(phase = {}) {
  const durationMinutes = toNumber(phase.duration_minutes ?? phase.durationMinutes);
  if (!durationMinutes || durationMinutes <= 0) {
    return null;
  }

  // Entity Requirements normalisieren
  const rawReqs = phase.entity_requirements || phase.entityRequirements || {};
  const entityRequirements = {
    einsatzstellen: {
      min: toNumber(rawReqs.einsatzstellen?.min) || 0,
      max: toNumber(rawReqs.einsatzstellen?.max) || null
    },
    meldungen: {
      min: toNumber(rawReqs.meldungen?.min) || 0,
      max: toNumber(rawReqs.meldungen?.max) || null
    },
    aufgaben: {
      min: toNumber(rawReqs.aufgaben?.min) || 0,
      max: toNumber(rawReqs.aufgaben?.max) || null
    }
  };

  return {
    durationMinutes,
    label: phase.label || phase.name || "Phase",
    intensity: phase.intensity || phase.behavior || "",
    guidance: phase.guidance || phase.description || "",
    entityRequirements
  };
}

export function normalizeScenarioSimulation(scenario = null) {
  const simulation = scenario?.simulation || {};

  const llmIntervalMinutes = toNumber(simulation.llm_interval_minutes);
  const llmIntervalSeconds = toNumber(simulation.llm_interval_seconds);

  const minutesPerStep =
    toNumber(simulation.minutes_per_step) ||
    (llmIntervalMinutes ? llmIntervalMinutes : null) ||
    (llmIntervalSeconds ? llmIntervalSeconds / 60 : null) ||
    DEFAULT_MINUTES_PER_STEP;

  const incidentLimits = {
    maxNewPerStep: toNumber(simulation.incident_limits?.max_new_per_step),
    maxTotal: toNumber(simulation.incident_limits?.max_total)
  };

  const behaviorPhases = Array.isArray(simulation.behavior_phases)
    ? simulation.behavior_phases
        .map((phase) => normalizeBehaviorPhase(phase))
        .filter(Boolean)
    : [];

  return {
    llmIntervalMinutes,
    llmIntervalSeconds,
    minutesPerStep,
    incidentLimits,
    behaviorPhases
  };
}

export function getScenarioIntervalMs(scenario, fallbackMs) {
  const { llmIntervalMinutes, llmIntervalSeconds } = normalizeScenarioSimulation(
    scenario
  );

  if (llmIntervalMinutes) {
    return Math.round(llmIntervalMinutes * 60 * 1000);
  }

  if (llmIntervalSeconds) {
    return Math.round(llmIntervalSeconds * 1000);
  }

  return fallbackMs;
}

export function getScenarioMinutesPerStep(scenario, fallbackMinutes) {
  const { minutesPerStep } = normalizeScenarioSimulation(scenario);
  return minutesPerStep || fallbackMinutes || DEFAULT_MINUTES_PER_STEP;
}

/**
 * Gibt die Gesamtdauer der Simulation in Minuten zurück.
 * Liest duration_minutes aus dem Szenario.
 * @param {Object} scenario - Das aktive Szenario
 * @returns {number|null} - Dauer in Minuten oder null wenn nicht definiert
 */
export function getScenarioDurationMinutes(scenario) {
  if (!scenario) return null;
  const duration = toNumber(scenario.duration_minutes);
  return duration && duration > 0 ? duration : null;
}

/**
 * Prüft ob die Simulationszeit das Limit überschritten hat.
 * @param {Object} scenario - Das aktive Szenario
 * @param {number} elapsedMinutes - Bisher vergangene Simulationsminuten
 * @returns {boolean} - true wenn Zeit abgelaufen
 */
export function isSimulationTimeExceeded(scenario, elapsedMinutes) {
  const durationMinutes = getScenarioDurationMinutes(scenario);
  if (durationMinutes === null) return false;
  return elapsedMinutes >= durationMinutes;
}

export function getScenarioPhase(behaviorPhases = [], elapsedMinutes = 0) {
  if (!behaviorPhases.length) {
    return null;
  }

  let remaining = elapsedMinutes;

  for (let i = 0; i < behaviorPhases.length; i += 1) {
    const phase = behaviorPhases[i];
    if (remaining < phase.durationMinutes) {
      return {
        ...phase,
        index: i,
        elapsedInPhase: Math.max(0, remaining),
        remainingMinutes: phase.durationMinutes - remaining
      };
    }
    remaining -= phase.durationMinutes;
  }

  const lastPhase = behaviorPhases[behaviorPhases.length - 1];
  return {
    ...lastPhase,
    index: behaviorPhases.length - 1,
    elapsedInPhase: lastPhase.durationMinutes,
    remainingMinutes: 0
  };
}

export function buildPhaseRequirementsSummary({ scenario, elapsedMinutes = 0 } = {}) {
  if (!scenario?.simulation) {
    return "(keine Phasen-Requirements definiert)";
  }

  const { behaviorPhases } = normalizeScenarioSimulation(scenario);
  if (behaviorPhases.length === 0) {
    return "(keine Phasen-Requirements definiert)";
  }

  const phase = getScenarioPhase(behaviorPhases, elapsedMinutes);
  if (!phase) {
    return "(keine Phasen-Requirements definiert)";
  }

  const reqs = phase.entityRequirements;
  const lines = [];

  // Einsatzstellen
  if (reqs.einsatzstellen.min > 0 || reqs.einsatzstellen.max) {
    const min = reqs.einsatzstellen.min || 0;
    const max = reqs.einsatzstellen.max;
    if (max) {
      lines.push(`📍 EINSATZSTELLEN: ${min}-${max} neue Einsatzstellen`);
    } else {
      lines.push(`📍 EINSATZSTELLEN: mindestens ${min} neue Einsatzstellen`);
    }
  }

  // Meldungen
  if (reqs.meldungen.min > 0 || reqs.meldungen.max) {
    const min = reqs.meldungen.min || 0;
    const max = reqs.meldungen.max;
    if (max) {
      lines.push(`📨 MELDUNGEN: ${min}-${max} eingehende Meldungen (von POL, LST, RK, BH, Gemeinden)`);
    } else {
      lines.push(`📨 MELDUNGEN: mindestens ${min} eingehende Meldungen (von POL, LST, RK, BH, Gemeinden)`);
    }
  }

  // Aufgaben
  if (reqs.aufgaben.min > 0 || reqs.aufgaben.max) {
    const min = reqs.aufgaben.min || 0;
    const max = reqs.aufgaben.max;
    if (max) {
      lines.push(`📋 AUFGABEN: ${min}-${max} neue Aufgaben für Stabsstellen`);
    } else {
      lines.push(`📋 AUFGABEN: mindestens ${min} neue Aufgaben für Stabsstellen`);
    }
  }

  if (lines.length === 0) {
    return "(keine Entity-Requirements für diese Phase)";
  }

  return lines.join("\n");
}

export function buildScenarioControlSummary({ scenario, elapsedMinutes = 0 } = {}) {
  if (!scenario?.simulation) {
    return "(keine Szenario-Steuerung definiert)";
  }

  const {
    minutesPerStep,
    incidentLimits,
    behaviorPhases
  } = normalizeScenarioSimulation(scenario);

  const lines = [
    `Simulationszeit pro Schritt: ${minutesPerStep} Minuten`,
    `Bisher simuliert: ${Math.max(0, Math.round(elapsedMinutes))} Minuten`
  ];

  if (incidentLimits.maxNewPerStep || incidentLimits.maxTotal) {
    const limits = [];
    if (incidentLimits.maxNewPerStep) {
      limits.push(`max. ${incidentLimits.maxNewPerStep} neue Einsätze je Schritt`);
    }
    if (incidentLimits.maxTotal) {
      limits.push(`max. ${incidentLimits.maxTotal} Einsätze gesamt`);
    }
    lines.push(`Einsatz-Limits: ${limits.join(", ")}`);
  }

  if (behaviorPhases.length > 0) {
    const phase = getScenarioPhase(behaviorPhases, elapsedMinutes);
    if (phase) {
      const intensityInfo = phase.intensity ? ` (${phase.intensity})` : "";
      lines.push(
        `Aktuelle Phase: ${phase.label}${intensityInfo} (seit ${Math.round(
          phase.elapsedInPhase
        )} Min, noch ${Math.round(phase.remainingMinutes)} Min)`
      );
      if (phase.guidance) {
        lines.push(`Phasen-Hinweis: ${phase.guidance}`);
      }
    }

    let offset = 0;
    const phaseLines = behaviorPhases.map((entry) => {
      const start = offset;
      offset += entry.durationMinutes;
      const range = `${start}-${offset} Min`;
      const intensityInfo = entry.intensity ? ` (${entry.intensity})` : "";
      const guidance = entry.guidance ? ` – ${entry.guidance}` : "";
      return `  - ${range}: ${entry.label}${intensityInfo}${guidance}`;
    });
    lines.push("Phasenplan:");
    lines.push(...phaseLines);
  }

  return lines.join("\n");
}

function describeTriggerCondition(condition = {}) {
  if (!condition || typeof condition !== "object") {
    return "wenn eine unbekannte Bedingung erfüllt ist";
  }

  switch (condition.type) {
    case "time_elapsed": {
      const minutes = toNumber(condition.minutes);
      return minutes ? `nach ${minutes} Minuten` : "nach einer gewissen Zeit";
    }
    case "incident_count": {
      const column = condition.column || "unbekannt";
      const operator = condition.operator || "?";
      const value = condition.value ?? "?";
      return `wenn Einsatzstellen in "${column}" ${operator} ${value}`;
    }
    default:
      return condition.description || `wenn Bedingung "${condition.type || "unbekannt"}" erfüllt ist`;
  }
}

function describeTriggerAction(action = {}) {
  if (!action || typeof action !== "object") {
    return "tritt ein unbekanntes Ereignis auf";
  }

  switch (action.type) {
    case "add_incident": {
      const data = action.data || {};
      const title = data.content || "neue Einsatzstelle";
      const humanId = data.humanId ? ` (${data.humanId})` : "";
      const ort = data.ort ? ` in ${data.ort}` : "";
      const typ = data.typ ? `, Typ ${data.typ}` : "";
      const priority = data.priority ? `, Priorität ${data.priority}` : "";
      return `neue Einsatzstelle: ${title}${humanId}${ort}${typ}${priority}`;
    }
    case "external_message": {
      const data = action.data || {};
      const from = data.from ? `von ${data.from}` : "von externer Stelle";
      const info = data.information ? `: "${data.information}"` : "";
      return `externe Meldung ${from}${info}`;
    }
    default:
      return action.description || `tritt Aktion "${action.type || "unbekannt"}" ein`;
  }
}

export function buildScenarioTimelineSummary(scenario = null) {
  const triggers = Array.isArray(scenario?.triggers) ? scenario.triggers : [];
  if (!triggers.length) {
    return "(kein Szenario-Verlauf definiert)";
  }

  const lines = triggers.map((trigger, index) => {
    const condition = describeTriggerCondition(trigger.condition);
    const action = describeTriggerAction(trigger.action);
    return `${index + 1}. ${condition} → ${action}`;
  });

  return lines.join("\n");
}

/**
 * Optimierte Version: Nur Trigger für den aktuellen Step-Zeitraum
 * @param {Object} scenario - Das Szenario-Objekt
 * @param {number} elapsedMinutes - Bereits vergangene Simulationsminuten
 * @param {number} minutesPerStep - Minuten pro Simulationsschritt
 * @returns {string} - Nur die Trigger die in diesem Step relevant sind
 */
export function buildCurrentStepTriggersSummary(scenario = null, elapsedMinutes = 0, minutesPerStep = 5) {
  const triggers = Array.isArray(scenario?.triggers) ? scenario.triggers : [];
  if (!triggers.length) {
    return "";
  }

  // Zeitfenster für aktuellen Step
  const stepStart = elapsedMinutes;
  const stepEnd = elapsedMinutes + minutesPerStep;

  // Nur time_elapsed Trigger im aktuellen Zeitfenster filtern
  const relevantTriggers = triggers.filter((trigger) => {
    const condition = trigger.condition;
    if (!condition) return false;

    if (condition.type === "time_elapsed") {
      const triggerMinutes = toNumber(condition.minutes);
      if (triggerMinutes === null) return false;
      // Trigger ist relevant wenn er in diesem Step-Zeitfenster liegt
      return triggerMinutes >= stepStart && triggerMinutes < stepEnd;
    }

    // Andere Trigger-Typen (z.B. incident_count) behalten wir erstmal
    // da sie nicht zeitbasiert sind
    return false;
  });

  if (!relevantTriggers.length) {
    return "";
  }

  const lines = relevantTriggers.map((trigger) => {
    const condition = describeTriggerCondition(trigger.condition);
    const action = describeTriggerAction(trigger.action);
    return `${condition} → ${action}`;
  });

  return lines.join("\n");
}

/**
 * Optimierte kompakte Szenario-Steuerung (ohne vollständigen Phasenplan)
 * Enthält nur die aktuell relevanten Informationen für den LLM
 */
export function buildCompactScenarioControl({ scenario, elapsedMinutes = 0, minutesPerStep = 5 } = {}) {
  if (!scenario?.simulation) {
    return "(keine Szenario-Steuerung definiert)";
  }

  const {
    minutesPerStep: scenarioMinutesPerStep,
    incidentLimits,
    behaviorPhases
  } = normalizeScenarioSimulation(scenario);

  const effectiveMinutesPerStep = scenarioMinutesPerStep || minutesPerStep;

  const lines = [
    `Simulationszeit pro Schritt: ${effectiveMinutesPerStep} Minuten`,
    `Bisher simuliert: ${Math.max(0, Math.round(elapsedMinutes))} Minuten`
  ];

  if (incidentLimits.maxNewPerStep || incidentLimits.maxTotal) {
    const limits = [];
    if (incidentLimits.maxNewPerStep) {
      limits.push(`max. ${incidentLimits.maxNewPerStep} neue Einsätze je Schritt`);
    }
    if (incidentLimits.maxTotal) {
      limits.push(`max. ${incidentLimits.maxTotal} Einsätze gesamt`);
    }
    lines.push(`Einsatz-Limits: ${limits.join(", ")}`);
  }

  if (behaviorPhases.length > 0) {
    const phase = getScenarioPhase(behaviorPhases, elapsedMinutes);
    if (phase) {
      const intensityInfo = phase.intensity ? ` (${phase.intensity})` : "";
      lines.push(
        `Aktuelle Phase: ${phase.label}${intensityInfo} (seit ${Math.round(
          phase.elapsedInPhase
        )} Min, noch ${Math.round(phase.remainingMinutes)} Min)`
      );
      if (phase.guidance) {
        lines.push(`Phasen-Hinweis: ${phase.guidance}`);
      }
    }

    // Kompakter Phasenplan: nur Zeitfenster und Name, ohne Guidance
    let offset = 0;
    const phaseLines = behaviorPhases.map((entry) => {
      const start = offset;
      offset += entry.durationMinutes;
      const range = `${start}-${offset} Min`;
      const intensityInfo = entry.intensity ? ` (${entry.intensity})` : "";
      return `${range}: ${entry.label}${intensityInfo}`;
    });
    lines.push(`Phasenplan: ${phaseLines.join(" | ")}`);
  }

  // Aktuelle Step-Trigger hinzufügen
  const currentTriggers = buildCurrentStepTriggersSummary(scenario, elapsedMinutes, effectiveMinutesPerStep);
  if (currentTriggers) {
    lines.push("");
    lines.push("AKTIONEN IN DIESEM SCHRITT:");
    lines.push(currentTriggers);
  }

  return lines.join("\n");
}
