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

  return {
    durationMinutes,
    label: phase.label || phase.name || "Phase",
    intensity: phase.intensity || phase.behavior || "",
    guidance: phase.guidance || phase.description || ""
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
