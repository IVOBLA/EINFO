import { createHash } from "crypto";

const ALLOWED_RESOURCES = ["pumpen", "bagger", "sandsack_fueller"];
const ALLOWED_RELIABILITY = ["low", "med", "high"];
const MAX_EFFECT_DURATION = 24;

function hashKey(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeDomain(domain, state) {
  if (!domain || typeof domain !== "string") return null;
  if (domain === "damm" || domain === "strom") return domain;
  if (domain.startsWith("zone:")) {
    const zone = domain.split(":")[1];
    if (zone && state.zone_schweregrade?.[zone] !== undefined) {
      return `zone:${zone}`;
    }
  }
  return null;
}

function validateEffect(effect, state) {
  if (!effect || typeof effect !== "object") return null;
  const dauerTicks = clamp(Number(effect.dauerTicks || 0), 1, MAX_EFFECT_DURATION);
  if (effect.typ === "resource_reservation") {
    const ressource = String(effect.ressource || "").toLowerCase();
    if (!ALLOWED_RESOURCES.includes(ressource)) return null;
    const deltaReserviert = clamp(Number(effect.deltaReserviert || 0), -5, 5);
    return {
      typ: "resource_reservation",
      ressource,
      deltaReserviert,
      dauerTicks,
      begruendung: String(effect.begruendung || "").slice(0, 120),
      sourceTaskId: effect.sourceTaskId || null
    };
  }
  if (effect.typ === "risk_modifier") {
    const domain = normalizeDomain(effect.domain, state);
    if (!domain) return null;
    const delta = clamp(Number(effect.delta || 0), -0.1, 0.1);
    return {
      typ: "risk_modifier",
      domain,
      delta,
      dauerTicks,
      begruendung: String(effect.begruendung || "").slice(0, 120),
      sourceTaskId: effect.sourceTaskId || null
    };
  }
  if (effect.typ === "info_gain") {
    const reliability = ALLOWED_RELIABILITY.includes(effect.reliability)
      ? effect.reliability
      : "low";
    return {
      typ: "info_gain",
      thema: String(effect.thema || "").slice(0, 80),
      reliability,
      dauerTicks,
      begruendung: String(effect.begruendung || "").slice(0, 120),
      sourceTaskId: effect.sourceTaskId || null
    };
  }
  return null;
}

export function applyEffects({ state, effects, currentTick }) {
  if (!Array.isArray(effects)) return [];
  const applied = [];
  for (const effect of effects) {
    const valid = validateEffect(effect, state);
    if (!valid) continue;
    const keySource = `${valid.typ}|${valid.ressource || ""}|${valid.domain || ""}|${valid.sourceTaskId || ""}|${currentTick}`;
    const effectId = hashKey(keySource);
    applied.push({
      id: effectId,
      ...valid,
      appliedTick: currentTick,
      expireTick: currentTick + valid.dauerTicks
    });
  }
  if (applied.length > 0) {
    state.activeEffects.push(...applied);
  }
  return applied;
}

export function decayEffects({ state, currentTick }) {
  if (!Array.isArray(state.activeEffects)) {
    state.activeEffects = [];
    return;
  }
  state.activeEffects = state.activeEffects.filter((effect) => {
    const expireTick = Number(effect.expireTick ?? effect.appliedTick ?? 0);
    return currentTick < expireTick;
  });
}
