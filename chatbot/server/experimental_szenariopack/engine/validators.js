import { validateOperationsJson } from "../../json_sanitizer.js";
import { isAllowedOperation } from "../../simulation_helpers.js";
import { addProtocol, addTask, buildProtocolEntry, buildTask, pickRole } from "./ops_builder.js";

function filterOpsArray(list, activeRoles, options) {
  return list.filter((op) => isAllowedOperation(op, activeRoles, options));
}

export function filterOperationsByRoles(operations, activeRoles) {
  const filtered = structuredClone(operations);
  const ops = filtered.operations;

  ops.board.createIncidentSites = filterOpsArray(ops.board.createIncidentSites, activeRoles, {
    operationType: "board.create"
  });
  ops.board.updateIncidentSites = filterOpsArray(ops.board.updateIncidentSites, activeRoles, {
    operationType: "board.update"
  });

  ops.aufgaben.create = filterOpsArray(ops.aufgaben.create, activeRoles, {
    operationType: "aufgaben.create",
    allowExternal: true
  });
  ops.aufgaben.update = filterOpsArray(ops.aufgaben.update, activeRoles, {
    operationType: "aufgaben.update"
  });

  ops.protokoll.create = filterOpsArray(ops.protokoll.create, activeRoles, {
    operationType: "protokoll.create",
    allowExternal: true
  });

  return filtered;
}

export function ensureMinimumOperations(operations, activeRoles) {
  const ops = operations.operations;
  if (ops.protokoll.create.length === 0) {
    addProtocol(
      operations,
      buildProtocolEntry({
        information: "Fallback: Keine Lageänderung festgestellt.",
        infoTyp: "Info",
        anvon: pickRole(activeRoles, ["S2"], "POL"),
        ergehtAn: ["LTSTB"],
        richtung: "aus",
        activeRoles
      })
    );
  }
  if (ops.aufgaben.create.length === 0) {
    addTask(
      operations,
      buildTask({
        title: "Fallback-Lagecheck",
        desc: "Kurzlage prüfen und Rückmeldung geben.",
        priority: "low",
        responsible: pickRole(activeRoles, ["S2"], "POL"),
        assignedBy: pickRole(activeRoles, ["LTSTB"], "POL"),
        key: `fallback-${Date.now()}`
      })
    );
  }
}

export function validateOperations(operations) {
  const result = validateOperationsJson(operations);
  if (!result.valid) {
    throw new Error(`Ungültiges Operations-JSON: ${result.error}`);
  }
}
