import { SimulationNode, StoryEpisode, WorldStateSnapshot } from "../types";
import { AcceptedNodeOutcome, PressureArcTransitionDecision } from "./arcLifecycle";

export interface SimulationTransactionInput {
  transactionId: string;
  node: SimulationNode;
  storyEpisode: StoryEpisode;
  acceptedOutcome: AcceptedNodeOutcome;
  pressureArcTransition: PressureArcTransitionDecision;
  currentWorldStateSnapshot: WorldStateSnapshot;
}

export interface CommittedSimulationState {
  node: SimulationNode;
  worldStateSnapshot: WorldStateSnapshot;
  alreadyCommitted: boolean;
}

export function emptyWorldState(): WorldStateSnapshot {
  return { people: [], directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 1 };
}

function applySummaries(snapshot: WorldStateSnapshot, outcome: AcceptedNodeOutcome): WorldStateSnapshot {
  const next = { ...snapshot };
  for (const delta of outcome.worldDeltas) {
    if (delta.type === "career_state") {
      next.careerSummary = delta.summary;
      if (delta.employmentTransition) next.currentEmploymentStatus = delta.employmentTransition.toStatus;
    }
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

  let nextSnapshot: WorldStateSnapshot = {
    ...input.currentWorldStateSnapshot,
    people: input.currentWorldStateSnapshot.people.map((person) => ({ ...person })),
    directionArcs: input.currentWorldStateSnapshot.directionArcs.map((arc) => ({ ...arc })),
    pressureArcs: input.currentWorldStateSnapshot.pressureArcs.map((arc) => ({ ...arc })),
    committedTransactionIds: [...committedIds, input.transactionId],
    version: 1
  };
  nextSnapshot = applySummaries(nextSnapshot, input.acceptedOutcome);

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
