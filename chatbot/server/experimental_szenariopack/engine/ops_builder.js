import { isMeldestelle, normalizeRole } from "../../field_mapper.js";

export function createEmptyOperations() {
  return {
    operations: {
      board: { createIncidentSites: [], updateIncidentSites: [], transitionIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    }
  };
}

export function pickRole(activeRoles = [], candidates = [], fallbackExternal = "POL") {
  const normalizedActive = new Set(activeRoles.map((role) => normalizeRole(role)));
  const list = candidates.length ? candidates : ["LTSTB", "S2", "S3", "S4", "S5", "S6"];
  for (const role of list) {
    const normalized = normalizeRole(role);
    if (!normalized) continue;
    if (normalizedActive.has(normalized)) continue;
    if (isMeldestelle(normalized)) continue;
    return role;
  }
  if (fallbackExternal) {
    const normalized = normalizeRole(fallbackExternal);
    if (!normalizedActive.has(normalized) && !isMeldestelle(normalized)) {
      return fallbackExternal;
    }
  }
  return null;
}

export function buildIncident({ humanId, content, ort, typ, description }) {
  return {
    humanId,
    content,
    ort,
    typ,
    description,
    status: "open"
  };
}

export function buildTask({ title, desc, priority, responsible, assignedBy, status = "open", key }) {
  return {
    title,
    desc,
    priority,
    responsible,
    assignedBy,
    status,
    eindeutiger_schluessel: key
  };
}

export function buildProtocolEntry({ information, infoTyp, anvon, ergehtAn, richtung, activeRoles }) {
  const sender = anvon || pickRole(activeRoles, ["S2", "S3", "S4", "S5"], "POL");
  return {
    information,
    infoTyp,
    anvon: sender,
    ergehtAn: Array.isArray(ergehtAn) ? ergehtAn : [ergehtAn].filter(Boolean),
    richtung
  };
}

export function addIncident(operations, incident) {
  operations.operations.board.createIncidentSites.push(incident);
}

export function addTask(operations, task) {
  operations.operations.aufgaben.create.push(task);
}

export function addProtocol(operations, entry) {
  operations.operations.protokoll.create.push(entry);
}
