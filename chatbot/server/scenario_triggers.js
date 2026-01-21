// chatbot/server/scenario_triggers.js
// Trigger-System für Szenarien

import { logInfo, logError, logDebug } from "./logger.js";

/**
 * Verwaltet und führt Szenario-Triggers aus
 */
export class TriggerManager {
  constructor(scenario) {
    this.scenario = scenario;
    this.triggers = scenario?.triggers || [];
    this.executedTriggers = new Set();
  }

  /**
   * Evaluiert alle Triggers und gibt auszuführende Operationen zurück
   * @param {Object} context - Aktueller Kontext
   * @returns {Promise<Object>} - Operations-Objekt
   */
  async evaluateTriggers(context) {
    const {
      elapsedMinutes,
      boardState,
      protokollState,
      aufgabenState
    } = context;

    const triggersToExecute = [];

    for (const [index, trigger] of this.triggers.entries()) {
      const triggerId = `${index}_${JSON.stringify(trigger.condition)}`;

      // Skip bereits ausgeführte Triggers
      if (this.executedTriggers.has(triggerId)) continue;

      // Bedingung prüfen
      const conditionMet = this.evaluateCondition(trigger.condition, context);

      if (conditionMet) {
        triggersToExecute.push({ ...trigger, triggerId });
        this.executedTriggers.add(triggerId);
      }
    }

    // Actions ausführen
    const operations = {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    for (const trigger of triggersToExecute) {
      try {
        const action = await this.executeAction(trigger.action, context);
        this.mergeOperations(operations, action);

        logInfo("Szenario-Trigger ausgeführt", {
          condition: trigger.condition,
          action: trigger.action.type,
          triggerId: trigger.triggerId
        });
      } catch (err) {
        logError("Fehler bei Trigger-Ausführung", {
          error: err.message,
          trigger
        });
      }
    }

    return operations;
  }

  /**
   * Evaluiert eine Trigger-Bedingung
   * @param {Object} condition - Bedingung
   * @param {Object} context - Kontext
   * @returns {boolean}
   */
  evaluateCondition(condition, context) {
    try {
      switch (condition.type) {
        case 'time_elapsed':
          return context.elapsedMinutes >= condition.minutes;

        case 'incident_count': {
          const column = condition.column || 'neu';
          const items = context.boardState?.columns?.[column]?.items || [];
          const count = items.length;

          switch (condition.operator) {
            case 'gte': return count >= condition.value;
            case 'lte': return count <= condition.value;
            case 'eq': return count === condition.value;
            case 'gt': return count > condition.value;
            case 'lt': return count < condition.value;
            default:
              logError("Unbekannter Operator", { operator: condition.operator });
              return false;
          }
        }

        case 'task_completed': {
          const task = context.aufgabenState?.find(t => t.id === condition.taskId);
          return task?.status === 'Erledigt';
        }

        case 'protocol_count': {
          const count = context.protokollState?.length || 0;
          switch (condition.operator) {
            case 'gte': return count >= condition.value;
            case 'lte': return count <= condition.value;
            case 'eq': return count === condition.value;
            default: return false;
          }
        }

        case 'phase': {
          // Prüfe ob bestimmte Phase erreicht wurde
          const scenario = this.scenario;
          if (!scenario?.simulation?.behavior_phases) return false;

          let elapsedInPhase = 0;
          for (const phase of scenario.simulation.behavior_phases) {
            elapsedInPhase += phase.duration_minutes;
            if (context.elapsedMinutes <= elapsedInPhase) {
              return phase.label === condition.phaseName;
            }
          }
          return false;
        }

        default:
          logError("Unbekannter Trigger-Typ", { type: condition.type });
          return false;
      }
    } catch (err) {
      logError("Fehler bei Trigger-Evaluierung", {
        error: err.message,
        condition
      });
      return false;
    }
  }

  /**
   * Führt eine Trigger-Action aus
   * @param {Object} action - Action
   * @param {Object} context - Kontext
   * @returns {Promise<Object>} - Operations
   */
  async executeAction(action, context) {
    const operations = {
      board: { createIncidentSites: [], updateIncidentSites: [] },
      aufgaben: { create: [], update: [] },
      protokoll: { create: [] }
    };

    try {
      switch (action.type) {
        case 'add_incident': {
          const incident = {
            ...action.data,
            createdBy: 'scenario-trigger',
            createdAt: new Date().toISOString()
          };
          operations.board.createIncidentSites.push(incident);
          break;
        }

        case 'external_message': {
          const message = {
            ...action.data,
            createdBy: 'scenario-trigger',
            uebermittlungsart: { ein: true },
            datum: new Date().toLocaleDateString('de-DE'),
            zeit: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          };
          operations.protokoll.create.push(message);
          break;
        }

        case 'create_protocol': {
          const protocol = {
            ...action.data,
            createdBy: 'scenario-trigger',
            datum: new Date().toLocaleDateString('de-DE'),
            zeit: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          };
          operations.protokoll.create.push(protocol);
          break;
        }

        case 'create_task': {
          const task = {
            ...action.data,
            createdBy: 'scenario-trigger',
            status: 'Neu',
            datum: new Date().toLocaleDateString('de-DE'),
            zeit: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          };
          operations.aufgaben.create.push(task);
          break;
        }

        case 'update_incident': {
          operations.board.updateIncidentSites.push(action.data);
          break;
        }

        default:
          logError("Unbekannter Action-Typ", { type: action.type });
      }
    } catch (err) {
      logError("Fehler bei Action-Ausführung", {
        error: err.message,
        action
      });
    }

    return operations;
  }

  /**
   * Merged Operations zusammen
   * @param {Object} target - Ziel-Operations
   * @param {Object} source - Quell-Operations
   */
  mergeOperations(target, source) {
    if (source.board?.createIncidentSites) {
      target.board.createIncidentSites.push(...source.board.createIncidentSites);
    }
    if (source.board?.updateIncidentSites) {
      target.board.updateIncidentSites.push(...source.board.updateIncidentSites);
    }
    if (source.protokoll?.create) {
      target.protokoll.create.push(...source.protokoll.create);
    }
    if (source.aufgaben?.create) {
      target.aufgaben.create.push(...source.aufgaben.create);
    }
    if (source.aufgaben?.update) {
      target.aufgaben.update.push(...source.aufgaben.update);
    }
  }

  /**
   * Gibt Status zurück
   * @returns {Object}
   */
  getStatus() {
    return {
      totalTriggers: this.triggers.length,
      executedTriggers: this.executedTriggers.size,
      pendingTriggers: this.triggers.length - this.executedTriggers.size
    };
  }

  /**
   * Setzt Trigger-Status zurück
   */
  reset() {
    this.executedTriggers.clear();
    logDebug("Trigger-Manager zurückgesetzt");
  }
}

/**
 * Erstellt einen TriggerManager für ein Szenario
 * @param {Object} scenario - Szenario
 * @returns {TriggerManager}
 */
export function createTriggerManager(scenario) {
  return new TriggerManager(scenario);
}
