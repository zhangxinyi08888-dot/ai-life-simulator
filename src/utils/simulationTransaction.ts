import { SimulationNode, StoryEpisode, WorldStateSnapshot } from "../types";
import { AcceptedNodeOutcome, PressureArcTransitionDecision } from "./arcLifecycle";
import { applyProcessWorldDeltas, ProcessAdvanceResult, unresolvedProcessRequirements } from "./ongoingProcess";

export interface SimulationTransactionInput {
  transactionId: string;
  node: SimulationNode;
  storyEpisode: StoryEpisode;
  acceptedOutcome: AcceptedNodeOutcome;
  pressureArcTransition: PressureArcTransitionDecision;
  currentWorldStateSnapshot: WorldStateSnapshot;
  processAdvance?: ProcessAdvanceResult;
}

export interface CommittedSimulationState {
  node: SimulationNode;
  worldStateSnapshot: WorldStateSnapshot;
  alreadyCommitted: boolean;
}

export function emptyWorldState(): WorldStateSnapshot {
  return { people: [], ongoingProcesses: [], directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 1 };
}

function applySummaries(snapshot: WorldStateSnapshot, outcome: AcceptedNodeOutcome): WorldStateSnapshot {
  const next = { ...snapshot };
  for (const delta of outcome.worldDeltas) {
    if (delta.type === "career_state") next.careerSummary = delta.summary;
    if (delta.type === "relationship_change") next.relationshipSummary = delta.summary;
    if (delta.type === "health_state") next.healthSummary = delta.summary;
    if (delta.type === "location_change") next.locationSummary = delta.summary;
  }
  return next;
}

export function commitSimulationTransaction(input: SimulationTransactionInput): CommittedSimulationState {
  const committedIds = input.currentWorldStateSnapshot.committedTransactionIds || [];
  if (committedIds.includes(input.transactionId)) {
    return {
      node: { ...input.node, worldStateSnapshot: input.currentWorldStateSnapshot },
      worldStateSnapshot: input.currentWorldStateSnapshot,
      alreadyCommitted: true
    };
  }

  const unresolvedRequirements = unresolvedProcessRequirements(
    input.processAdvance?.requiredTransitions || [],
    input.acceptedOutcome.worldDeltas
  );
  if (unresolvedRequirements.length > 0) {
    throw new Error(`PROCESS_TRANSITION_REQUIRED:${unresolvedRequirements.map((item) => item.processId).join(",")}`);
  }

  let nextSnapshot: WorldStateSnapshot = {
    ...input.currentWorldStateSnapshot,
    people: input.currentWorldStateSnapshot.people.map((person) => ({ ...person })),
    ongoingProcesses: (input.processAdvance?.nextProcesses || input.currentWorldStateSnapshot.ongoingProcesses || []).map((process) => ({
      ...process,
      subjectPersonIds: [...process.subjectPersonIds],
      exceptionalBasis: process.exceptionalBasis ? [...process.exceptionalBasis] : undefined
    })),
    directionArcs: input.currentWorldStateSnapshot.directionArcs.map((arc) => ({ ...arc })),
    pressureArcs: input.currentWorldStateSnapshot.pressureArcs.map((arc) => ({ ...arc })),
    committedTransactionIds: [...committedIds, input.transactionId],
    version: 1
  };
  nextSnapshot = applySummaries(nextSnapshot, input.acceptedOutcome);
  nextSnapshot.ongoingProcesses = applyProcessWorldDeltas(
    nextSnapshot.ongoingProcesses || [],
    input.acceptedOutcome.worldDeltas,
    input.node.ageInMonths ?? input.node.age * 12
  );

  const nextArc = input.pressureArcTransition.nextArcState;
  if (nextArc) {
    const index = nextSnapshot.pressureArcs.findIndex((arc) => arc.id === nextArc.id);
    if (index >= 0) nextSnapshot.pressureArcs[index] = { ...nextArc };
    else nextSnapshot.pressureArcs.push({ ...nextArc });
    nextSnapshot.foregroundPressureArcId = nextArc.status === "resolved" ? undefined : nextArc.id;
  }

  const node: SimulationNode = {
    ...input.node,
    narrativeMeta: input.node.narrativeMeta ? { ...input.node.narrativeMeta, storyEpisode: input.storyEpisode } : input.node.narrativeMeta,
    committedArcMeta: {
      pressureArcId: nextArc?.id,
      phaseId: nextArc?.phaseId,
      transitionAction: input.pressureArcTransition.action
    },
    worldStateSnapshot: nextSnapshot
  };
  return { node, worldStateSnapshot: nextSnapshot, alreadyCommitted: false };
}
