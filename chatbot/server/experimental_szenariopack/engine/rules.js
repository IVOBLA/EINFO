import { getZeitstempel } from "./timeline.js";
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

function createSummaryText({ scenario, state, tick, pegel }) {
  const zoneInfo = Object.entries(state.zone_schweregrade)
    .map(([zone, level]) => `${zone}:${level}`)
    .join(", ");
  return `Kurzlage T${tick}: Pegel ${pegel}${scenario.umwelt?.messwerte?.einheit || "cm"}, Damm ${state.damm_status}, Zonen ${zoneInfo}. Offene Fragen: ${state.offene_fragen.filter((q) => q.status === "offen").length}.`;
}

function applyThresholds({ scenario, state, pegel, operations, activeRoles }) {
  if (pegel >= 420 && !state.flags.vorwarnung) {
    state.flags.vorwarnung = true;
    addProtocol(
      operations,
      buildProtocolEntry({
        information: "Vorwarnung: Pegel überschreitet 420cm. Sandsacklogistik anfahren.",
        infoTyp: "Lagemeldung",
        anvon: "S2",
        ergehtAn: ["S3", "S4"],
        richtung: "aus",
        activeRoles
      })
    );
    addTask(
      operations,
      buildTask({
        title: "Führungsgruppe Hochwasser einberufen",
        desc: "Lagebesprechung durchführen und Kräfte koordinieren.",
        priority: "high",
        responsible: pickRole(activeRoles, ["S3", "S2"], "POL"),
        assignedBy: pickRole(activeRoles, ["LTSTB", "S2"], "POL"),
        key: "vorwarnung-fuehrungsgruppe"
      })
    );
    addTask(
      operations,
      buildTask({
        title: "Sandsacklinie vorbereiten",
        desc: "Sandsack-Füllstation aktivieren und Materialanforderung anstoßen.",
        priority: "high",
        responsible: pickRole(activeRoles, ["S4"], "POL"),
        assignedBy: pickRole(activeRoles, ["S2"], "POL"),
        key: "vorwarnung-sandsack"
      })
    );
  }

  if (pegel >= 460 && !state.flags.alarm1) {
    state.flags.alarm1 = true;
    addIncident(
      operations,
      buildIncident({
        humanId: "E-KATS",
        content: "Alarmstufe 1 - Hochwasserlage verschärft",
        typ: "Hochwasser",
        ort: "Bezirk Feldkirchen",
        description: "Alarmstufe 1 ausgelöst, Einsatzbereitschaft erhöhen."
      })
    );
    addTask(
      operations,
      buildTask({
        title: "Alarmierung Einsatzkräfte Stufe 1",
        desc: "Alarmplan Hochwasser Stufe 1 aktivieren.",
        priority: "critical",
        responsible: pickRole(activeRoles, ["S2"], "POL"),
        assignedBy: pickRole(activeRoles, ["LTSTB"], "POL"),
        key: "alarm1-alarmierung"
      })
    );
  }

  if (pegel >= 500 && !state.flags.alarm2) {
    state.flags.alarm2 = true;
    addIncident(
      operations,
      buildIncident({
        humanId: "E-EVAK-Z3",
        content: "Alarmstufe 2 - Evakuierung Z3 vorbereiten",
        typ: "Hochwasser",
        ort: "Zone Z3",
        description: "Evakuierungsplanung für Zone Z3 starten."
      })
    );
    ensureOpenQuestion(state, {
      id: "Q-002",
      text: "Evakuierung Z3 freigeben?",
      erwartet: "JA_NEIN"
    });
    addProtocol(
      operations,
      buildProtocolEntry({
        information: "Rückfrage: Evakuierung Z3 freigeben?",
        infoTyp: "Rueckfrage",
        anvon: "S2",
        ergehtAn: ["LTSTB"],
        richtung: "aus",
        activeRoles
      })
    );
  }

  let newDammStatus = state.damm_status;
  if (pegel >= 495) {
    newDammStatus = "BRUCHGEFAHR";
  } else if (pegel >= 470) {
    newDammStatus = "SICKER";
  } else {
    newDammStatus = "OK";
  }

  if (newDammStatus !== state.damm_status) {
    state.damm_status = newDammStatus;
    addIncident(
      operations,
      buildIncident({
        humanId: "E-DAMM-A",
        content: `Dammstatus ${newDammStatus} - Sicherungsmaßnahmen`,
        typ: "Hochwasser",
        ort: "Dammabschnitt Z2",
        description: "Dammüberwachung und Sicherung verstärken."
      })
    );
    addTask(
      operations,
      buildTask({
        title: "Sandsacklinie am Damm aufbauen",
        desc: "Dammabschnitt Z2 sichern und Sandsäcke verstärken.",
        priority: "high",
        responsible: pickRole(activeRoles, ["S3"], "POL"),
        assignedBy: pickRole(activeRoles, ["S2"], "POL"),
        key: `damm-${newDammStatus.toLowerCase()}-sandsack`
      })
    );
    ensureOpenQuestion(state, {
      id: "Q-003",
      text: "Bagger verfügbar für Dammarbeiten?",
      erwartet: "JA_NEIN"
    });
  }

  if (pegel >= 490 && !state.flags.stromausfall) {
    state.flags.stromausfall = true;
    addIncident(
      operations,
      buildIncident({
        humanId: "E-INFRA-STROM",
        content: "Stromausfall droht in Z2",
        typ: "Hochwasser",
        ort: "Zone Z2",
        description: "EVU koordinieren, Aggregate prüfen."
      })
    );
    addTask(
      operations,
      buildTask({
        title: "EVU koordinieren & Aggregate prüfen",
        desc: "Kontakt EVU halten, mobile Aggregate bereitstellen.",
        priority: "high",
        responsible: pickRole(activeRoles, ["S6"], "POL"),
        assignedBy: pickRole(activeRoles, ["S2"], "POL"),
        key: "stromausfall-aggregate"
      })
    );
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

  addProtocol(
    operations,
    buildProtocolEntry({
      information: createSummaryText({ scenario, state, tick, pegel }),
      infoTyp: "Lagemeldung",
      anvon: "S2",
      ergehtAn: ["LTSTB"],
      richtung: "aus",
      activeRoles
    })
  );

  const lagecheckKey = `lagecheck-${tick}`;
  if (!state.dedupe_keys.has(lagecheckKey)) {
    addTask(
      operations,
      buildTask({
        title: "Lagecheck Hochwasser",
        desc: `Pegel ${pegel}cm prüfen, aktuelle Lage zusammenfassen.`,
        priority: "medium",
        responsible: pickRole(activeRoles, ["S2"], "POL"),
        assignedBy: pickRole(activeRoles, ["LTSTB"], "POL"),
        key: lagecheckKey
      })
    );
    state.dedupe_keys.add(lagecheckKey);
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

  if (absicht === "WETTER_ABFRAGE") {
    replyText = `Wetterlage: ${scenario.umwelt?.wetter?.lage || "unbekannt"}. Warnung: ${scenario.umwelt?.wetter?.warnung || "keine"}.`;
    addProtocol(
      operations,
      buildProtocolEntry({
        information: `Wetterauskunft erteilt: ${replyText}`,
        infoTyp: "Info",
        anvon: "S5",
        ergehtAn: ["LTSTB"],
        richtung: "aus",
        activeRoles
      })
    );
  }

  if (absicht === "RESSOURCE_ABFRAGE") {
    const ressource = felder.ressource || "Ressourcen";
    const status = state.geraete_status?.[ressource?.toLowerCase()] || null;
    replyText = status
      ? `${ressource}: verfügbar ${status.verfuegbar}, reserviert ${status.reserviert}.`
      : `Aktueller Stand für ${ressource}: siehe Ressourcenübersicht.`;
    addTask(
      operations,
      buildTask({
        title: `Ressourcenlage ${ressource} prüfen`,
        desc: "Verfügbarkeit bestätigen und ggf. disponieren.",
        priority: "medium",
        responsible: pickRole(activeRoles, ["S4"], "POL"),
        assignedBy: pickRole(activeRoles, ["S2"], "POL"),
        key: `ressource-${ressource}`
      })
    );
  }

  if (absicht === "LOGISTIK_ANFRAGE") {
    replyText = "Logistik-Anfrage aufgenommen. Bitte Anzahl der zu versorgenden Kräfte nennen.";
    addIncident(
      operations,
      buildIncident({
        humanId: "E-LOGISTIK",
        content: "Verpflegung/Logistik anfordern",
        typ: "Sonstig",
        ort: "Bereitstellungsraum",
        description: "Versorgungslogistik koordinieren."
      })
    );
    ensureOpenQuestion(state, {
      id: "Q-004",
      text: "Für wie viele Personen wird Verpflegung benötigt?",
      erwartet: "ZAHL"
    });
  }

  if (absicht === "PLAN_WENN_DANN") {
    const pegel = Number(felder.pegel);
    if (Number.isFinite(pegel)) {
      state.standing_orders.push({
        id: `plan-${Date.now()}`,
        bedingung: { typ: "pegel_min", wert: pegel },
        aktion: {
          typ: "task",
          title: felder.aktion || "Evakuierung vorbereiten",
          desc: "Standing Order ausgelöst.",
          priority: "high"
        },
        fired: false
      });
      replyText = `Standing Order gesetzt: Wenn Pegel >= ${pegel}cm, dann ${felder.aktion || "Evakuierung vorbereiten"}.`;
    } else {
      replyText = "Bitte einen Pegelwert angeben (z.B. 460cm).";
    }
  }

  if (absicht === "PLAN_ZEIT") {
    const minuten = Number(felder.minuten);
    if (Number.isFinite(minuten)) {
      const schritt = scenario.zeit?.schritt_minuten || 5;
      const takte = Math.max(1, Math.round(minuten / schritt));
      state.standing_orders.push({
        id: `plan-${Date.now()}`,
        bedingung: { typ: "takt", wert: currentTick + takte },
        aktion: {
          typ: "task",
          title: felder.aktion || "Maßnahme nach Zeit",
          desc: "Zeitplan ausgelöst.",
          priority: "medium"
        },
        fired: false
      });
      replyText = `Zeitplan gesetzt: In ${minuten} Minuten ${felder.aktion || "Maßnahme nach Zeit"}.`;
    } else {
      replyText = "Bitte eine Zeitangabe in Minuten angeben.";
    }
  }

  if (absicht === "BEFEHL") {
    replyText = "Befehl aufgenommen und als Aufgabe angelegt.";
    addTask(
      operations,
      buildTask({
        title: felder.aktion || "Befehl ausführen",
        desc: felder.detail || "User-Befehl",
        priority: "high",
        responsible: pickRole(activeRoles, ["S3"], "POL"),
        assignedBy: pickRole(activeRoles, ["LTSTB", "S2"], "POL"),
        key: `befehl-${Date.now()}`
      })
    );
  }

  if (absicht === "ANTWORT") {
    const antwort = felder.antwort;
    const offene = state.offene_fragen.find((q) => q.status === "offen");
    if (offene) {
      offene.status = "beantwortet";
      offene.antwort = antwort;
      replyText = `Antwort zu ${offene.id} registriert.`;
      if (offene.id === "Q-002" && String(antwort).toLowerCase().startsWith("j")) {
        addTask(
          operations,
          buildTask({
            title: "Evakuierung Z3 vorbereiten",
            desc: "Evakuierungsmaßnahmen einleiten.",
            priority: "critical",
            responsible: pickRole(activeRoles, ["S3"], "POL"),
            assignedBy: pickRole(activeRoles, ["LTSTB"], "POL"),
            key: "evakuierung-z3-vorbereiten"
          })
        );
      }
      addProtocol(
        operations,
        buildProtocolEntry({
          information: `Antwort erhalten (${offene.id}): ${antwort}`,
          infoTyp: "Rueckmeldung",
          anvon: "LTSTB",
          ergehtAn: ["S2"],
          richtung: "ein",
          activeRoles
        })
      );
    } else {
      replyText = "Aktuell keine offene Frage gefunden.";
    }
  }

  if (!replyText) {
    replyText = nluResult.rueckfrage || "Ich konnte keine passende Aktion ableiten.";
  }

  return { replyText, operations };
}
