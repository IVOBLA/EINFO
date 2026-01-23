export function createInitialState(scenario) {
  const { startzustand, ressourcen, fragen_init } = scenario;
  const taskKeys = new Set();
  return {
    running: false,
    tick: 0,
    flags: {
      vorwarnung: false,
      alarm1: false,
      alarm2: false,
      damm_warnung: false,
      stromausfall: false
    },
    zone_schweregrade: { ...(startzustand?.zone_schweregrade || {}) },
    damm_status: startzustand?.damm_status || "OK",
    strom_status: startzustand?.strom_status || "OK",
    geraete_status: {
      bagger: {
        verfuegbar: ressourcen?.geraete?.bagger?.verfuegbar || 0,
        reserviert: 0
      },
      pumpen: {
        verfuegbar: ressourcen?.geraete?.pumpen?.verfuegbar || 0,
        reserviert: 0
      },
      sandsack_fueller: {
        verfuegbar: ressourcen?.geraete?.sandsack_fueller?.verfuegbar || 0,
        reserviert: 0
      }
    },
    offene_fragen: Array.isArray(fragen_init) ? [...fragen_init] : [],
    standing_orders: [],
    reservierungen: [],
    history: [],
    incidents: new Set(),
    dedupe: {
      taskKeys,
      protokollKeys: [],
      protokollWindow: 20
    },
    lastSnapshot: { board: [], aufgaben: [], protokoll: [] },
    lastCompressedBoard: null,
    worldLast: null,
    activeEffects: [],
    auditTrail: [],
    fallback: {
      lastProtocolTick: -Infinity,
      lastTaskTick: -Infinity
    },
    pending_user_events: [],
    pending_ops: []
  };
}

export function resetStateForScenario(state, scenario) {
  const fresh = createInitialState(scenario);
  Object.assign(state, fresh);
}
