import {
  addIncident,
  addProtocol,
  addTask,
  buildIncident,
  buildProtocolEntry,
  buildTask,
  createEmptyOperations,
  pickRole
} from "./ops_builder.js";
import { generateNpcEvents } from "./npc.js";

function ensureOpenQuestion(state, question) {
  const exists = state.offene_fragen.some((q) => q.id === question.id && q.status === "offen");
  if (!exists) {
    state.offene_fragen.push({ ...question, status: "offen" });
  }
}

function getRuleSet(scenario) {
  return scenario?.regeln || {};
}

function formatTemplate(value, context) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (context[key] === undefined || context[key] === null) return "";
    return String(context[key]);
  });
}

function resolveTemplate(value, context, fallback) {
  const rendered = formatTemplate(value || "", context).trim();
  return rendered || fallback;
}

function formatDeep(value, context) {
  if (Array.isArray(value)) {
    return value.map((item) => formatDeep(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, formatDeep(val, context)])
    );
  }
  return formatTemplate(value, context);
}

function buildProtocolFromConfig(config, { activeRoles, context }) {
  const payload = formatDeep(config, context);
  return buildProtocolEntry({
    information: payload.information,
    infoTyp: payload.infoTyp,
    anvon: payload.anvon,
    ergehtAn: payload.ergehtAn,
    richtung: payload.richtung,
    activeRoles
  });
}

function buildTaskFromConfig(config, { activeRoles, context }) {
  const payload = formatDeep(config, context);
  return buildTask({
    title: payload.title,
    desc: payload.desc,
    priority: payload.priority || "medium",
    responsible: pickRole(activeRoles, payload.responsibleRoles || ["S3", "S2"], payload.fallback || "POL"),
    assignedBy: pickRole(activeRoles, payload.assignedByRoles || ["LTSTB", "S2"], payload.fallback || "POL"),
    key: payload.key
  });
}

function buildIncidentFromConfig(config, { context }) {
  const payload = formatDeep(config, context);
  return buildIncident({
    humanId: payload.humanId,
    content: payload.content,
    typ: payload.typ,
    ort: payload.ort,
    description: payload.description
  });
}

function applyConfiguredActions({ actions, operations, state, activeRoles, context }) {
  if (!actions) return;
  if (actions.protocols) {
    for (const entry of actions.protocols) {
      addProtocol(operations, buildProtocolFromConfig(entry, { activeRoles, context }));
    }
  }
  if (actions.tasks) {
    for (const entry of actions.tasks) {
      const task = buildTaskFromConfig(entry, { activeRoles, context });
      if (task.key) {
        if (state.dedupe_keys.has(task.key)) continue;
        state.dedupe_keys.add(task.key);
      }
      addTask(operations, task);
    }
  }
  if (actions.incidents) {
    for (const entry of actions.incidents) {
      const incident = buildIncidentFromConfig(entry, { context });
      if (incident.humanId && state.incidents.has(incident.humanId)) continue;
      addIncident(operations, incident);
      if (incident.humanId) {
        state.incidents.add(incident.humanId);
      }
    }
  }
  if (actions.questions) {
    for (const entry of actions.questions) {
      const question = formatDeep(entry, context);
      ensureOpenQuestion(state, question);
    }
  }
}

function evaluateCondition(condition, { pegel, tick }) {
  if (!condition) return false;
  if (condition.typ === "pegel_min") {
    return pegel >= Number(condition.wert);
  }
  if (condition.typ === "takt_min") {
    return tick >= Number(condition.wert);
  }
  return false;
}

function buildContext({ scenario, state, tick, pegel }) {
  const zoneInfo = Object.entries(state.zone_schweregrade)
    .map(([zone, level]) => `${zone}:${level}`)
    .join(", ");
  return {
    tick,
    pegel,
    pegel_unit: scenario.umwelt?.messwerte?.einheit || "cm",
    damm_status: state.damm_status,
    offene_fragen: state.offene_fragen.filter((q) => q.status === "offen").length,
    zone_info: zoneInfo
  };
}

function applyThresholds({ scenario, state, tick, pegel, operations, activeRoles }) {
  const rules = getRuleSet(scenario);
  const zustandsRegeln = Array.isArray(rules.zustands_regeln) ? rules.zustands_regeln : [];
  const context = buildContext({ scenario, state, tick, pegel });

  for (const regel of zustandsRegeln) {
    if (regel.typ === "damm_status") {
      const levels = Array.isArray(regel.levels) ? regel.levels : [];
      const sorted = [...levels].sort((a, b) => Number(b.min) - Number(a.min));
      const next = sorted.find((level) => pegel >= Number(level.min));
      const nextStatus = next?.status || state.damm_status;
      if (nextStatus !== state.damm_status) {
        state.damm_status = nextStatus;
        context.damm_status = nextStatus;
        applyConfiguredActions({
          actions: regel.on_change,
          operations,
          state,
          activeRoles,
          context: { ...context, damm_status: nextStatus }
        });
      }
      continue;
    }

    if (!evaluateCondition(regel.bedingung, { pegel, tick })) {
      continue;
    }

    if (regel.once_flag) {
      if (state.flags[regel.once_flag]) continue;
      state.flags[regel.once_flag] = true;
    }

    applyConfiguredActions({
      actions: regel.aktionen,
      operations,
      state,
      activeRoles,
      context
    });
  }
}

function applyStandingOrders({ state, pegel, tick, operations, activeRoles }) {
  for (const order of state.standing_orders) {
    if (order.fired) continue;
    const condition = order.bedingung || {};
    const shouldTrigger =
      (condition.typ === "pegel_min" && pegel >= condition.wert) ||
      (condition.typ === "takt" && tick >= condition.wert);
    if (!shouldTrigger) continue;

    order.fired = true;
    if (order.aktion?.typ === "task") {
      addTask(
        operations,
        buildTask({
          title: order.aktion.title,
          desc: order.aktion.desc,
          priority: order.aktion.priority || "high",
          responsible: pickRole(activeRoles, ["S3", "S2"], "POL"),
          assignedBy: pickRole(activeRoles, ["LTSTB", "S2"], "POL"),
          key: `standing-${order.id}`
        })
      );
    }
    if (order.aktion?.typ === "incident") {
      addIncident(
        operations,
        buildIncident({
          humanId: order.aktion.humanId,
          content: order.aktion.content,
          typ: order.aktion.typ,
          ort: order.aktion.ort,
          description: order.aktion.description
        })
      );
    }
  }
}

export function applyTickRules({ scenario, state, tick, pegel, activeRoles }) {
  const operations = createEmptyOperations();
  const basis = scenario.standard?.basis_einsatz;
  if (basis && !state.incidents.has(basis.humanId)) {
    addIncident(
      operations,
      buildIncident({
        humanId: basis.humanId,
        content: basis.content,
        typ: basis.typ,
        ort: basis.ort,
        description: basis.description
      })
    );
    state.incidents.add(basis.humanId);
  }

  const rules = getRuleSet(scenario);
  const tickRegeln = Array.isArray(rules.tick_regeln) ? rules.tick_regeln : [];
  const context = buildContext({ scenario, state, tick, pegel });

  for (const regel of tickRegeln) {
    const regelContext = { ...context, regel_id: regel.id };
    if (regel.typ === "protocol") {
      const protocol = buildProtocolFromConfig(regel.protocol, { activeRoles, context: regelContext });
      addProtocol(operations, protocol);
      continue;
    }
    if (regel.typ === "task") {
      const task = buildTaskFromConfig(regel.task, { activeRoles, context: regelContext });
      if (task.key) {
        if (state.dedupe_keys.has(task.key)) continue;
        state.dedupe_keys.add(task.key);
      }
      addTask(operations, task);
      continue;
    }
  }

  applyThresholds({ scenario, state, pegel, operations, activeRoles });
  applyStandingOrders({ state, pegel, tick, operations, activeRoles });

  const npcEvents = generateNpcEvents({ scenario, state, tick, pegel, activeRoles });
  for (const entry of npcEvents) {
    addProtocol(operations, entry);
  }

  return operations;
}

export function applyUserEvent({ scenario, state, nluResult, activeRoles, currentTick }) {
  const operations = createEmptyOperations();
  let replyText = "";

  if (!nluResult || !nluResult.absicht) {
    return { replyText: "Ich konnte die Eingabe nicht zuordnen.", operations };
  }

  const absicht = nluResult.absicht;
  const felder = nluResult.felder || {};
  const rules = getRuleSet(scenario);
  const userRules = rules.user_event_regeln || {};

  if (absicht === "WETTER_ABFRAGE") {
    const regel = userRules[absicht];
    const context = {
      wetter_lage: scenario.umwelt?.wetter?.lage || "unbekannt",
      wetter_warnung: scenario.umwelt?.wetter?.warnung || "keine"
    };
    replyText = formatTemplate(regel?.reply || "", context) || `Wetterlage: ${context.wetter_lage}. Warnung: ${context.wetter_warnung}.`;
    applyConfiguredActions({
      actions: regel?.aktionen,
      operations,
      state,
      activeRoles,
      context: { ...context, reply: replyText }
    });
  }

  if (absicht === "RESSOURCE_ABFRAGE") {
    const ressource = felder.ressource || "Ressourcen";
    const status = state.geraete_status?.[ressource?.toLowerCase()] || null;
    const regel = userRules[absicht];
    const context = {
      ressource,
      verfuegbar: status?.verfuegbar ?? "",
      reserviert: status?.reserviert ?? ""
    };
    replyText =
      formatTemplate(regel?.reply || "", context) ||
      (status
        ? `${ressource}: verfügbar ${status.verfuegbar}, reserviert ${status.reserviert}.`
        : `Aktueller Stand für ${ressource}: siehe Ressourcenübersicht.`);
    applyConfiguredActions({
      actions: regel?.aktionen,
      operations,
      state,
      activeRoles,
      context: { ...context, reply: replyText }
    });
  }

  if (absicht === "LOGISTIK_ANFRAGE") {
    const regel = userRules[absicht];
    replyText = regel?.reply || "Logistik-Anfrage aufgenommen. Bitte Anzahl der zu versorgenden Kräfte nennen.";
    applyConfiguredActions({
      actions: regel?.aktionen,
      operations,
      state,
      activeRoles,
      context: { reply: replyText }
    });
  }

  if (absicht === "PLAN_WENN_DANN") {
    const regel = userRules[absicht];
    const pegel = Number(felder.pegel);
    if (Number.isFinite(pegel)) {
      const actionTitle = resolveTemplate(regel?.aktion?.title, { pegel, aktion: felder.aktion }, "Evakuierung vorbereiten");
      const actionDesc = resolveTemplate(regel?.aktion?.desc, { pegel, aktion: felder.aktion }, "Standing Order ausgelöst.");
      state.standing_orders.push({
        id: `plan-${Date.now()}`,
        bedingung: { typ: "pegel_min", wert: pegel },
        aktion: {
          typ: "task",
          title: actionTitle,
          desc: actionDesc,
          priority: regel?.aktion?.priority || "high"
        },
        fired: false
      });
      replyText = resolveTemplate(regel?.reply, {
        pegel,
        aktion: felder.aktion || actionTitle
      }, `Standing Order gesetzt: Wenn Pegel >= ${pegel}cm, dann ${felder.aktion || actionTitle}.`);
    } else {
      replyText = "Bitte einen Pegelwert angeben (z.B. 460cm).";
    }
  }

  if (absicht === "PLAN_ZEIT") {
    const regel = userRules[absicht];
    const minuten = Number(felder.minuten);
    if (Number.isFinite(minuten)) {
      const schritt = scenario.zeit?.schritt_minuten || 5;
      const takte = Math.max(1, Math.round(minuten / schritt));
      const actionTitle = resolveTemplate(regel?.aktion?.title, { minuten, aktion: felder.aktion }, "Maßnahme nach Zeit");
      const actionDesc = resolveTemplate(regel?.aktion?.desc, { minuten, aktion: felder.aktion }, "Zeitplan ausgelöst.");
      state.standing_orders.push({
        id: `plan-${Date.now()}`,
        bedingung: { typ: "takt", wert: currentTick + takte },
        aktion: {
          typ: "task",
          title: actionTitle,
          desc: actionDesc,
          priority: regel?.aktion?.priority || "medium"
        },
        fired: false
      });
      replyText = resolveTemplate(regel?.reply, {
        minuten,
        aktion: felder.aktion || actionTitle
      }, `Zeitplan gesetzt: In ${minuten} Minuten ${felder.aktion || actionTitle}.`);
    } else {
      replyText = "Bitte eine Zeitangabe in Minuten angeben.";
    }
  }

  if (absicht === "BEFEHL") {
    const regel = userRules[absicht];
    replyText = regel?.reply || "Befehl aufgenommen und als Aufgabe angelegt.";
    const actionTitle = resolveTemplate(regel?.task?.title, { aktion: felder.aktion }, "Befehl ausführen");
    const detailDesc = resolveTemplate(regel?.task?.desc, { detail: felder.detail }, "User-Befehl");
    const context = { aktion: felder.aktion || actionTitle, detail: felder.detail || detailDesc };
    const task = buildTaskFromConfig(
      {
        ...regel?.task,
        title: actionTitle,
        desc: detailDesc,
        key: regel?.task?.key || `befehl-${Date.now()}`
      },
      { activeRoles, context }
    );
    addTask(operations, task);
  }

  if (absicht === "ANTWORT") {
    const antwort = felder.antwort;
    const offene = state.offene_fragen.find((q) => q.status === "offen");
    if (offene) {
      offene.status = "beantwortet";
      offene.antwort = antwort;
      const regel = userRules[absicht];
      replyText = formatTemplate(regel?.reply || "Antwort zu {{frage_id}} registriert.", {
        frage_id: offene.id
      });
      const context = { frage_id: offene.id, antwort };
      const specials = Array.isArray(regel?.folgeaktionen) ? regel.folgeaktionen : [];
      for (const special of specials) {
        const matchId = !special.frage_id || special.frage_id === offene.id;
        const matchPrefix = !special.antwort_prefix || String(antwort).toLowerCase().startsWith(special.antwort_prefix);
        if (matchId && matchPrefix) {
          applyConfiguredActions({
            actions: special.aktionen,
            operations,
            state,
            activeRoles,
            context
          });
        }
      }
      applyConfiguredActions({
        actions: regel?.aktionen,
        operations,
        state,
        activeRoles,
        context
      });
    } else {
      replyText = "Aktuell keine offene Frage gefunden.";
    }
  }

  if (!replyText) {
    replyText = nluResult.rueckfrage || "Ich konnte keine passende Aktion ableiten.";
  }

  return { replyText, operations };
}
