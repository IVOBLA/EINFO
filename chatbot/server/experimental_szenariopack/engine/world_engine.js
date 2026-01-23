import { getPegelAtTick, getZeitstempel } from "./timeline.js";

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cloneResourceStatus(geraete = {}) {
  return Object.fromEntries(
    Object.entries(geraete).map(([key, value]) => [
      key,
      {
        verfuegbar: value?.verfuegbar ?? 0,
        reserviert: value?.reserviert ?? 0
      }
    ])
  );
}

export function computeWorldNow({ scenario, state, tick }) {
  const pegel = getPegelAtTick(scenario, tick);
  const zeitstempel = getZeitstempel(scenario, tick);
  return {
    tick,
    zeitstempel,
    pegel_cm: pegel,
    pegel_einheit: scenario?.umwelt?.messwerte?.einheit || "cm",
    damm_status: state.damm_status,
    strom_status: state.strom_status,
    zone_schweregrade: { ...(state.zone_schweregrade || {}) },
    geraete_status: cloneResourceStatus(state.geraete_status),
    umwelt: {
      wetter: scenario?.umwelt?.wetter || {},
      warnungen: scenario?.umwelt?.warnungen || scenario?.umwelt?.wetter?.warnung || null
    },
    constraints: scenario?.constraints || []
  };
}

export function applyActiveEffectsToWorldNow(now, activeEffects = []) {
  const next = structuredClone(now);
  const resourceDelta = {};
  const riskDelta = {};
  const infoGain = [];

  for (const effect of activeEffects) {
    if (effect.typ === "resource_reservation") {
      const res = effect.ressource;
      if (!res || !next.geraete_status?.[res]) continue;
      const delta = clampNumber(effect.deltaReserviert, -5, 5);
      const status = next.geraete_status[res];
      status.reserviert = Math.max(0, (status.reserviert || 0) + delta);
      status.verfuegbar = Math.max(0, (status.verfuegbar || 0) - delta);
      resourceDelta[res] = (resourceDelta[res] || 0) + delta;
    }
    if (effect.typ === "risk_modifier") {
      const domain = effect.domain;
      const delta = clampNumber(effect.delta, -0.1, 0.1);
      riskDelta[domain] = clampNumber((riskDelta[domain] || 0) + delta, -0.5, 0.5);
    }
    if (effect.typ === "info_gain") {
      infoGain.push({
        thema: effect.thema,
        reliability: effect.reliability,
        begruendung: effect.begruendung
      });
    }
  }

  next.effects = {
    resourceDelta,
    riskDelta,
    infoGain
  };

  return next;
}

export function computeWorldDelta(prev, now) {
  if (!prev) {
    return { initial: true, pegel_cm: now.pegel_cm };
  }
  const delta = {};
  if (prev.pegel_cm !== now.pegel_cm) {
    delta.pegelDiff = now.pegel_cm - prev.pegel_cm;
  }
  if (prev.damm_status !== now.damm_status) {
    delta.damm_status = { from: prev.damm_status, to: now.damm_status };
  }
  if (prev.strom_status !== now.strom_status) {
    delta.strom_status = { from: prev.strom_status, to: now.strom_status };
  }
  const zoneChanges = {};
  for (const [zone, level] of Object.entries(now.zone_schweregrade || {})) {
    if (prev.zone_schweregrade?.[zone] !== level) {
      zoneChanges[zone] = { from: prev.zone_schweregrade?.[zone] ?? null, to: level };
    }
  }
  if (Object.keys(zoneChanges).length > 0) {
    delta.zone_schweregrade = zoneChanges;
  }
  const resourceChanges = {};
  for (const [res, status] of Object.entries(now.geraete_status || {})) {
    const prevStatus = prev.geraete_status?.[res] || {};
    const changes = {};
    if (prevStatus.verfuegbar !== status.verfuegbar) {
      changes.verfuegbar = { from: prevStatus.verfuegbar ?? 0, to: status.verfuegbar };
    }
    if (prevStatus.reserviert !== status.reserviert) {
      changes.reserviert = { from: prevStatus.reserviert ?? 0, to: status.reserviert };
    }
    if (Object.keys(changes).length > 0) {
      resourceChanges[res] = changes;
    }
  }
  if (Object.keys(resourceChanges).length > 0) {
    delta.geraete_status = resourceChanges;
  }
  if (JSON.stringify(prev.effects || {}) !== JSON.stringify(now.effects || {})) {
    delta.effects = now.effects;
  }
  return delta;
}

export function computeForecast({ scenario, state, tick, horizons = [30, 60] }) {
  const stepMin = scenario?.zeit?.schritt_minuten || 5;
  const forecast = [];
  for (const horizon of horizons) {
    const offsetTicks = Math.max(1, Math.round(horizon / stepMin));
    const targetTick = tick + offsetTicks;
    forecast.push({
      horizon_min: horizon,
      tick: targetTick,
      zeitstempel: getZeitstempel(scenario, targetTick),
      pegel_cm: getPegelAtTick(scenario, targetTick),
      pegel_einheit: scenario?.umwelt?.messwerte?.einheit || "cm"
    });
  }
  return forecast;
}

export function computeWorld({ scenario, state, tick, horizons }) {
  const baseNow = computeWorldNow({ scenario, state, tick });
  const now = applyActiveEffectsToWorldNow(baseNow, state.activeEffects || []);
  const delta = computeWorldDelta(state.worldLast, now);
  const forecast = computeForecast({ scenario, state, tick, horizons });
  return { now, delta, forecast };
}
