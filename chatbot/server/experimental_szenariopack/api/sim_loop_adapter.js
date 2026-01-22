import * as base from "../../sim_loop.js";
import * as experimental from "./sim_loop_szenariopack.js";

const useExperimental = process.env.EINFO_EXPERIMENTAL_SCENARIOPACK === "1";
const source = useExperimental ? experimental : base;

export const identifyMessagesNeedingResponse = source.identifyMessagesNeedingResponse;
export const identifyOpenQuestions = source.identifyOpenQuestions;
export const buildMemoryQueryFromState = source.buildMemoryQueryFromState;
export const compressBoard = source.compressBoard;
export const compressAufgaben = source.compressAufgaben;
export const compressProtokoll = source.compressProtokoll;
export const toComparableProtokoll = source.toComparableProtokoll;
export const buildDelta = source.buildDelta;
export const isSimulationRunning = source.isSimulationRunning;
export const startSimulation = source.startSimulation;
export const pauseSimulation = source.pauseSimulation;
export const stepSimulation = source.stepSimulation;
export const getActiveScenario = source.getActiveScenario;

export const handleUserFreitext = useExperimental
  ? experimental.handleUserFreitext
  : async () => ({ replyText: "", operationsDelta: { operations: { board: { createIncidentSites: [], updateIncidentSites: [], transitionIncidentSites: [] }, aufgaben: { create: [], update: [] }, protokoll: { create: [] } } } });
