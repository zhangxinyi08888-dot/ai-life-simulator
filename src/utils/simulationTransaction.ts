import { SimulationNode, StoryEpisode, WorldStateSnapshot } from "../types";
import { commitTransitionalEmploymentTransition, currentCareerState } from "../domain/career/careerState";
import { AcceptedNodeOutcome, PressureArcTransitionDecision } from "./arcLifecycle";

type MultiArcTransitionDecision = PressureArcTransitionDecision & {
  additionalArcStateUpdates?: NonNullable<PressureArcTransitionDecision["nextArcState"]>[];
};

export interface SimulationTransactionInput {
  transactionId: string;
  node: SimulationNode;
  storyEpisode: StoryEpisode;
  acceptedOutcome: AcceptedNodeOutcome;
  pressureArcTransition: PressureArcTransitionDecision;
  currentWorldStateSnapshot: WorldStateSnapshot;
  domainTransactionAlreadyCommitted?: boolean;
}

export interface CommittedSimulationState {
  node: SimulationNode;
  worldStateSnapshot: WorldStateSnapshot;
  alreadyCommitted: boolean;
}

export function emptyWorldState(): WorldStateSnapshot {
  return { people: [], directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 1 };
}

function applySummaries(
  snapshot: WorldStateSnapshot,
  outcome: AcceptedNodeOutcome,
  transactionId: string,
  skipEmploymentTransition = false
): WorldStateSnapshot {
  const next = { ...snapshot };
  for (const [deltaIndex, delta] of outcome.worldDeltas.entries()) {
    if (delta.type === "career_state") {
      next.careerSummary = delta.summary;
      if (delta.employmentTransition && !skipEmploymentTransition) {
        const careerState = commitTransitionalEmploymentTransition({
          currentCareerState: currentCareerState(next),
          proposal: delta.employmentTransition,
          nextCareerStateId: `career_${transactionId}_${deltaIndex}`
        });
        next.careerStates = [...(next.careerStates || []), careerState];
        next.currentCareerStateId = careerState.id;
        next.currentEmploymentStatus = careerState.employmentStatus;
        next.careerRevision = (next.careerRevision || 0) + 1;
        next.version = 2;
      }
    }
    if (delta.type === "relationship_change") next.relationshipSummary = delta.summary;
    if (delta.type === "health_state") next.healthSummary = delta.summary;
    if (delta.type === "location_change") next.locationSummary = delta.summary;
  }
  return next;
}

function validateArcStateUpdates(transition: MultiArcTransitionDecision): void {
  const arcIds = [
    transition.nextArcState?.id,
    ...(transition.additionalArcStateUpdates || []).map((arc) => arc.id)
  ].filter((id): id is string => Boolean(id));
  const seenArcIds = new Set<string>();
  for (const arcId of arcIds) {
    if (seenArcIds.has(arcId)) {
      throw new Error(`Simulation transaction contains duplicate updates for the same Arc: ${arcId}`);
    }
    seenArcIds.add(arcId);
  }
}

function upsertPressureArc(snapshot: WorldStateSnapshot, arc: NonNullable<PressureArcTransitionDecision["nextArcState"]>): void {
  const index = snapshot.pressureArcs.findIndex((item) => item.id === arc.id);
  if (index >= 0) snapshot.pressureArcs[index] = { ...arc };
  else snapshot.pressureArcs.push({ ...arc });
}

export function commitSimulationTransaction(input: SimulationTransactionInput): CommittedSimulationState {
  const committedIds = input.currentWorldStateSnapshot.committedTransactionIds || [];
  if (committedIds.includes(input.transactionId) && !input.domainTransactionAlreadyCommitted) {
    return {
      node: { ...input.node, worldStateSnapshot: input.currentWorldStateSnapshot },
      worldStateSnapshot: input.currentWorldStateSnapshot,
      alreadyCommitted: true
    };
  }

  // Validate the complete write set before cloning or applying any part of the
  // transaction. A primary/background collision is a caller error and must not
  // result in a partially committed WorldState.
  const pressureArcTransition = input.pressureArcTransition as MultiArcTransitionDecision;
  validateArcStateUpdates(pressureArcTransition);

  let nextSnapshot: WorldStateSnapshot = {
    ...input.currentWorldStateSnapshot,
    people: input.currentWorldStateSnapshot.people.map((person) => ({ ...person })),
    directionArcs: input.currentWorldStateSnapshot.directionArcs.map((arc) => ({ ...arc })),
    pressureArcs: input.currentWorldStateSnapshot.pressureArcs.map((arc) => ({ ...arc })),
    committedTransactionIds: input.domainTransactionAlreadyCommitted
      ? [...committedIds]
      : [...committedIds, input.transactionId],
    careerStates: input.currentWorldStateSnapshot.careerStates?.map((state) => ({ ...state, activeProjectIds: [...state.activeProjectIds] })),
    version: input.currentWorldStateSnapshot.version
  };
  nextSnapshot = applySummaries(
    nextSnapshot,
    input.acceptedOutcome,
    input.transactionId,
    input.domainTransactionAlreadyCommitted
  );

  const nextArc = pressureArcTransition.nextArcState;
  if (nextArc) upsertPressureArc(nextSnapshot, nextArc);
  for (const additionalArcState of pressureArcTransition.additionalArcStateUpdates || []) {
    upsertPressureArc(nextSnapshot, additionalArcState);
  }

  if (Object.prototype.hasOwnProperty.call(pressureArcTransition, "foregroundPressureArcId")) {
    nextSnapshot.foregroundPressureArcId = pressureArcTransition.foregroundPressureArcId;
  } else if (nextArc) {
    // Preserve the original single-Arc contract for callers that have not yet
    // adopted an explicit foreground decision.
    nextSnapshot.foregroundPressureArcId = nextArc.status === "resolved" ? undefined : nextArc.id;
  }

  const node: SimulationNode = {
    ...input.node,
    narrativeMeta: input.node.narrativeMeta ? { ...input.node.narrativeMeta, storyEpisode: input.storyEpisode } : input.node.narrativeMeta,
    committedArcMeta: {
      pressureArcId: nextArc?.id,
      phaseId: nextArc?.phaseId,
      transitionAction: pressureArcTransition.action
    },
    worldStateSnapshot: nextSnapshot
  };
  return { node, worldStateSnapshot: nextSnapshot, alreadyCommitted: false };
}
