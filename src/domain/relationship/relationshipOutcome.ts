import type {
  HistoryItem,
  ParentRole,
  PersonIntroductionProposal,
  RelationshipProposal,
  RelationshipState,
  RomanticRelationshipStage,
  WorldStateSnapshot
} from "../../types";
import { mergeAcceptedPeople, reduceFamilyRelationshipState, reduceRelationshipState } from "./relationshipState";
import {
  advanceExplorationProgression,
  createCommitmentProgression,
  createExplorationProgression,
  delayCommitmentProgression,
  ROMANCE_COMMITMENT_POLICY
} from "./relationshipLifecycle";
import { isValidRomanceDisplayName } from "../../utils/romanceCandidateName";
import { stableHash } from "../../utils/stableRandom";

export const ROMANCE_OUTCOME_TRANSITIONS = {
  continue_getting_to_know: { toStage: "exploring", confidence: 0.9 },
  begin_mutual_dating: { toStage: "dating", confidence: 0.95 },
  continue_slow_exploration: { toStage: "exploring", confidence: 0.9 },
  end_romantic_exploration: { toStatus: "ended", confidence: 0.95 }
} as const;

export const END_EXISTING_ROMANTIC_RELATIONSHIP_OUTCOME = "end_existing_romantic_relationship";

export function deriveOpeningRomanticOutcomeId(choiceText: string): string | undefined {
  const normalized = choiceText.replace(/\s+/g, "");
  const explicitlyEndsRelationship = /(结束|终止|离开|分手|离婚).{0,18}(关系|恋爱|婚姻|伴侣)/.test(normalized)
    || /(关系|恋爱|婚姻|伴侣).{0,18}(结束|终止|分手|离婚)/.test(normalized);
  return explicitlyEndsRelationship ? END_EXISTING_ROMANTIC_RELATIONSHIP_OUTCOME : undefined;
}

export interface RelationshipOutcomeCommitInput {
  current: WorldStateSnapshot;
  selectedHistoryItem: HistoryItem;
  simulationSeed: string;
  branchFingerprint: string;
  nodeIndex: number;
  effectiveAtAgeInMonths: number;
  romanceEnabled?: boolean;
  trustedFamilyActivationEnabled?: boolean;
}

export interface RelationshipOutcomeCommitResult {
  worldStateSnapshot: WorldStateSnapshot;
  committed: boolean;
  reason?: string;
}

function selectedOutcome(item: HistoryItem): string | undefined {
  if (item.selectedEventOutcomeId) return item.selectedEventOutcomeId;
  const selected = item.choices.find((choice) => choice.id === item.selectedChoiceId)
    || item.choices.find((choice) => choice.text === item.selectedChoice || item.selectedChoice.includes(choice.text));
  return selected?.eventOutcomeId;
}

function containsNormalizedEvidence(surface: string, evidence: string): boolean {
  const normalizedEvidence = evidence.trim().replace(/\s+/gu, "");
  return normalizedEvidence.length > 0
    && surface.replace(/\s+/gu, "").includes(normalizedEvidence);
}

function validProposal<T extends RelationshipProposal["type"]>(
  item: HistoryItem,
  outcomeId: string,
  type: T
): Extract<RelationshipProposal, { type: T }> | undefined {
  return item.narrativeMeta?.relationshipProposals?.find((proposal): proposal is Extract<RelationshipProposal, { type: T }> => (
    proposal.type === type
    && proposal.sourceOutcomeId === outcomeId
    && Boolean(proposal.evidence.trim())
    // Financial narrative grounding can insert paragraph boundaries after the
    // relationship proposal is derived. Whitespace-only presentation changes
    // must not invalidate otherwise verbatim authority evidence.
    && containsNormalizedEvidence(item.description, proposal.evidence)
  ));
}

function validFamilyProposal<T extends "family_activation" | "parent_topic_stance">(
  item: HistoryItem,
  outcomeId: string,
  type: T
): Extract<RelationshipProposal, { type: T }> | undefined {
  return item.narrativeMeta?.relationshipProposals?.find((proposal): proposal is Extract<RelationshipProposal, { type: T }> => (
    proposal.type === type
    && proposal.sourceOutcomeId === outcomeId
    && Boolean(proposal.evidence.trim())
    && (
      containsNormalizedEvidence(item.description, proposal.evidence)
      || containsNormalizedEvidence(item.selectedChoice, proposal.evidence)
    )
  ));
}

function activeRomanticRelationship(snapshot: WorldStateSnapshot): RelationshipState | undefined {
  return snapshot.relationships?.find((relationship) => (
    relationship.type === "romantic"
    && ["active", "strained"].includes(relationship.status)
    && ["exploring", "dating", "cohabiting", "married"].includes(relationship.stage || "")
  ));
}

function stableCandidateKey(input: RelationshipOutcomeCommitInput, proposal: PersonIntroductionProposal): string {
  return `romance_${stableHash({
    simulationSeed: input.simulationSeed,
    branchFingerprint: input.branchFingerprint,
    eventId: input.selectedHistoryItem.eventMeta?.eventId,
    nodeIndex: input.nodeIndex,
    ordinal: proposal.candidateOrdinal
  })}`;
}

function withCommittedId(snapshot: WorldStateSnapshot, transactionId: string): WorldStateSnapshot {
  return {
    ...snapshot,
    committedTransactionIds: [...(snapshot.committedTransactionIds || []), transactionId]
  };
}

function withRomancePreference(
  snapshot: WorldStateSnapshot,
  input: { openness: "open" | "neutral" | "closed"; refusalCount: number; cooldownUntilAgeInMonths?: number }
): WorldStateSnapshot {
  const preferences = (snapshot.routePreferences || []).filter((preference) => preference.routeLine !== "romance");
  return {
    ...snapshot,
    routePreferences: [...preferences, { routeLine: "romance", source: "accepted_history", ...input }]
  };
}

function parentIdentity(role: ParentRole) {
  const key = role === "father" ? "parent:father" : role === "mother" ? "parent:mother" : "parent:unspecified";
  const displayName = role === "father" ? "父亲" : role === "mother" ? "母亲" : "父母";
  return { key, displayName };
}

function applyFamilyOutcome(
  input: RelationshipOutcomeCommitInput,
  outcomeId: string,
  transactionId: string
): RelationshipOutcomeCommitResult | undefined {
  if (input.trustedFamilyActivationEnabled === false) return undefined;
  const activation = validFamilyProposal(input.selectedHistoryItem, outcomeId, "family_activation");
  const stance = validFamilyProposal(input.selectedHistoryItem, outcomeId, "parent_topic_stance");
  if (!activation && !stance) return undefined;
  const role = activation?.parentRole || stance?.parentRole;
  if (!role) return { worldStateSnapshot: input.current, committed: false, reason: "missing_parent_role" };
  try {
    let next = structuredClone(input.current);
    const identity = parentIdentity(role);
    let person = next.people.find((candidate) => candidate.identityKey?.namespace === "user_role" && candidate.identityKey.key === identity.key);
    if (!person) {
      person = {
        id: `person_${identity.key.replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")}`,
        identityKey: { namespace: "user_role", key: identity.key },
        displayName: identity.displayName,
        relation: "parent",
        lifeStatus: "active",
        source: "accepted_history",
        confidence: 0.9
      };
      next.people = mergeAcceptedPeople({ currentPeople: next.people, acceptedPeople: [person] });
    }
    const currentFamily = next.familyRelationships?.find((relationship) => relationship.role === role);
    const nextTopicStances = currentFamily?.topicStances ? [...currentFamily.topicStances] : [];
    if (stance) {
      const nextStance = {
        id: `parent_stance_${stableHash({ role, topic: stance.topic, outcomeId, index: input.nodeIndex })}`,
        topic: stance.topic,
        stance: stance.stance,
        reasons: [...stance.reasons],
        effectiveFromAgeInMonths: input.effectiveAtAgeInMonths,
        evidence: [{ nodeIndex: input.nodeIndex, sourceOutcomeId: outcomeId, evidence: stance.evidence }],
        source: "accepted_history" as const,
        confidence: 0.9
      };
      const existingIndex = nextTopicStances.findIndex((item) => item.topic === stance.topic);
      if (existingIndex >= 0) nextTopicStances[existingIndex] = nextStance;
      else nextTopicStances.push(nextStance);
    }
    next = reduceFamilyRelationshipState({
      current: next,
      expectedRevision: next.familyRelationshipRevision || 0,
      nextState: {
        id: currentFamily?.id || `family_${identity.key.replace(":", "_")}`,
        participantPersonId: person.id,
        role,
        activation: currentFamily?.activation || "active",
        contact: currentFamily?.contact || "unknown",
        emotionalSupport: currentFamily?.emotionalSupport || "unknown",
        practicalSupport: currentFamily?.practicalSupport || "unknown",
        autonomyRespect: currentFamily?.autonomyRespect || "unknown",
        conflictIntensity: currentFamily?.conflictIntensity || "unknown",
        topicStances: nextTopicStances,
        revision: currentFamily?.revision || 0
      }
    });
    return { worldStateSnapshot: withCommittedId(next, transactionId), committed: true };
  } catch {
    return { worldStateSnapshot: input.current, committed: false, reason: "family_commit_rejected" };
  }
}

export function applySelectedRelationshipOutcome(input: RelationshipOutcomeCommitInput): RelationshipOutcomeCommitResult {
  const outcomeId = selectedOutcome(input.selectedHistoryItem);
  if (!outcomeId) return { worldStateSnapshot: input.current, committed: false, reason: "missing_selected_outcome" };
  const eventId = input.selectedHistoryItem.eventMeta?.eventId;
  const transactionId = `relationship_choice_${stableHash({ eventId, outcomeId, index: input.nodeIndex, branch: input.branchFingerprint })}`;
  if (input.current.committedTransactionIds?.includes(transactionId)) {
    return { worldStateSnapshot: input.current, committed: false, reason: "already_committed" };
  }

  if (outcomeId === END_EXISTING_ROMANTIC_RELATIONSHIP_OUTCOME) {
    const currentRelationship = activeRomanticRelationship(input.current);
    if (!currentRelationship) {
      return { worldStateSnapshot: input.current, committed: false, reason: "missing_active_romantic_relationship" };
    }
    try {
      const participantIds = new Set(currentRelationship.participantPersonIds);
      const withFormerPartner = {
        ...input.current,
        people: input.current.people.map((person) => participantIds.has(person.id)
          ? {
              ...person,
              relation: "other" as const,
              relationshipSummary: "前伴侣，关系已结束"
            }
          : person)
      };
      const next = reduceRelationshipState({
        current: withFormerPartner,
        expectedRevision: withFormerPartner.relationshipRevision || 0,
        nextState: {
          ...currentRelationship,
          stage: "separated",
          status: "ended",
          statusEffectiveFromAgeInMonths: input.effectiveAtAgeInMonths,
          progression: undefined,
          source: "accepted_history",
          confidence: 0.95
        }
      });
      return { worldStateSnapshot: withCommittedId(next, transactionId), committed: true };
    } catch {
      return { worldStateSnapshot: input.current, committed: false, reason: "transition_rejected" };
    }
  }

  if (eventId === "romance_new_connection") {
    if (["keep_as_acquaintance", "decline_romantic_direction"].includes(outcomeId)) {
      const currentPreference = input.current.routePreferences?.find((preference) => preference.routeLine === "romance");
      const refusalCount = (currentPreference?.refusalCount || 0) + (outcomeId === "decline_romantic_direction" ? 1 : 0);
      const cooldownMonths = outcomeId === "keep_as_acquaintance"
        ? 12
        : refusalCount >= 2
          ? 240
          : 120;
      const preference = withRomancePreference(input.current, {
        openness: refusalCount >= 2 ? "closed" : "neutral",
        refusalCount,
        cooldownUntilAgeInMonths: input.effectiveAtAgeInMonths + cooldownMonths
      });
      return { worldStateSnapshot: withCommittedId(preference, transactionId), committed: true };
    }
    if (outcomeId !== "continue_getting_to_know" || input.romanceEnabled === false) {
      return { worldStateSnapshot: input.current, committed: false, reason: "outcome_not_authorized" };
    }
    if (activeRomanticRelationship(input.current)) {
      return { worldStateSnapshot: input.current, committed: false, reason: "active_romantic_relationship_exists" };
    }
    const personProposal = validProposal(input.selectedHistoryItem, outcomeId, "person_introduction");
    const transitionProposal = validProposal(input.selectedHistoryItem, outcomeId, "romantic_transition");
    if (
      !personProposal
      || !isValidRomanceDisplayName(personProposal.displayName)
      || !Number.isInteger(personProposal.candidateOrdinal)
      || personProposal.candidateOrdinal < 0
      || !transitionProposal
    ) {
      return { worldStateSnapshot: input.current, committed: false, reason: "invalid_or_missing_proposal" };
    }
    const candidateKey = stableCandidateKey(input, personProposal);
    const personId = `person_${candidateKey}`;
    const relationshipId = `relationship_${candidateKey}`;
    try {
      const people = mergeAcceptedPeople({
        currentPeople: input.current.people,
        acceptedPeople: [{
          id: personId,
          identityKey: { namespace: "accepted_character", key: candidateKey },
          displayName: personProposal.displayName,
          relation: "partner",
          lifeStatus: "active",
          source: "accepted_history",
          confidence: 0.9
        }]
      });
      const withPerson = { ...input.current, people };
      const withRelationship = reduceRelationshipState({
        current: withPerson,
        expectedRevision: withPerson.relationshipRevision || 0,
        nextState: {
          id: relationshipId,
          participantPersonIds: [personId],
          type: "romantic",
          stage: "exploring",
          status: "active",
          statusEffectiveFromAgeInMonths: input.effectiveAtAgeInMonths,
          effectiveFromAgeInMonths: input.effectiveAtAgeInMonths,
          progression: createExplorationProgression(input.effectiveAtAgeInMonths),
          source: "accepted_history",
          confidence: ROMANCE_OUTCOME_TRANSITIONS.continue_getting_to_know.confidence
        }
      });
      return {
        worldStateSnapshot: withCommittedId(withRomancePreference(withRelationship, { openness: "open", refusalCount: 0 }), transactionId),
        committed: true
      };
    } catch {
      return { worldStateSnapshot: input.current, committed: false, reason: "atomic_commit_rejected" };
    }
  }

  if (eventId === "romance_connection_clarification" || eventId === "romance_exploration_resolution") {
    const currentRelationship = activeRomanticRelationship(input.current);
    if (!currentRelationship || currentRelationship.stage !== "exploring") {
      return { worldStateSnapshot: input.current, committed: false, reason: "missing_exploring_relationship" };
    }
    const transitionProposal = validProposal(input.selectedHistoryItem, outcomeId, "romantic_transition");
    if (!transitionProposal) {
      return { worldStateSnapshot: input.current, committed: false, reason: "invalid_or_missing_proposal" };
    }
    const transition = ROMANCE_OUTCOME_TRANSITIONS[outcomeId as keyof typeof ROMANCE_OUTCOME_TRANSITIONS];
    if ((!transition && outcomeId !== "return_to_acquaintance") || outcomeId === "continue_getting_to_know") {
      return { worldStateSnapshot: input.current, committed: false, reason: "outcome_not_authorized" };
    }
    const toStage = outcomeId === "return_to_acquaintance"
      ? "acquaintance"
      : transition && "toStage" in transition
        ? transition.toStage as RomanticRelationshipStage
        : currentRelationship.stage;
    const toStatus = outcomeId === "return_to_acquaintance"
      ? "ended"
      : transition && "toStatus" in transition
        ? transition.toStatus
        : currentRelationship.status;
    const progression = outcomeId === "continue_slow_exploration"
      ? advanceExplorationProgression(
          currentRelationship.progression || createExplorationProgression(currentRelationship.effectiveFromAgeInMonths),
          input.effectiveAtAgeInMonths
        )
      : outcomeId === "begin_mutual_dating"
        ? createCommitmentProgression(input.effectiveAtAgeInMonths)
        : undefined;
    try {
      const next = reduceRelationshipState({
        current: input.current,
        expectedRevision: input.current.relationshipRevision || 0,
        nextState: {
          ...currentRelationship,
          stage: toStage,
          status: toStatus,
          statusEffectiveFromAgeInMonths: toStatus === currentRelationship.status
            ? currentRelationship.statusEffectiveFromAgeInMonths
            : input.effectiveAtAgeInMonths,
          progression,
          confidence: transition?.confidence || 0.9
        }
      });
      return { worldStateSnapshot: withCommittedId(next, transactionId), committed: true };
    } catch {
      return { worldStateSnapshot: input.current, committed: false, reason: "transition_rejected" };
    }
  }

  if (eventId === "relationship_material_commitment_test" || eventId === "relationship_commitment_resolution") {
    const currentRelationship = activeRomanticRelationship(input.current);
    if (!currentRelationship || currentRelationship.stage !== "dating" || currentRelationship.progression?.checkpointKind !== "commitment_review") {
      return { worldStateSnapshot: input.current, committed: false, reason: "missing_commitment_checkpoint" };
    }
    if (![
      "make_shared_commitment_plan",
      "delay_with_clear_conditions",
      "maintain_committed_partnership_without_marriage",
      "reassess_relationship_fit"
    ].includes(outcomeId)) {
      return { worldStateSnapshot: input.current, committed: false, reason: "outcome_not_authorized" };
    }
    const transitionProposal = validProposal(input.selectedHistoryItem, outcomeId, "romantic_transition");
    if (!transitionProposal) {
      return { worldStateSnapshot: input.current, committed: false, reason: "invalid_or_missing_proposal" };
    }
    const currentProgression = currentRelationship.progression;
    const canDelay = eventId === "relationship_material_commitment_test"
      && (currentProgression.delayCount || 0) < ROMANCE_COMMITMENT_POLICY.maximumDelayCount;
    if (outcomeId === "delay_with_clear_conditions" && !canDelay) {
      return { worldStateSnapshot: input.current, committed: false, reason: "commitment_delay_limit_reached" };
    }
    const progression = outcomeId === "delay_with_clear_conditions" && canDelay
      ? delayCommitmentProgression(currentProgression, input.effectiveAtAgeInMonths)
      : undefined;
    const status = outcomeId === "reassess_relationship_fit" ? "strained" as const : currentRelationship.status;
    try {
      const next = reduceRelationshipState({
        current: input.current,
        expectedRevision: input.current.relationshipRevision || 0,
        nextState: {
          ...currentRelationship,
          status,
          statusEffectiveFromAgeInMonths: status === currentRelationship.status
            ? currentRelationship.statusEffectiveFromAgeInMonths
            : input.effectiveAtAgeInMonths,
          progression
        }
      });
      return { worldStateSnapshot: withCommittedId(next, transactionId), committed: true };
    } catch {
      return { worldStateSnapshot: input.current, committed: false, reason: "transition_rejected" };
    }
  }

  if (eventId === "relationship_release_and_reorientation") {
    const currentRelationship = activeRomanticRelationship(input.current);
    const transitionProposal = validProposal(input.selectedHistoryItem, outcomeId, "romantic_transition");
    if (!currentRelationship || !transitionProposal) {
      return { worldStateSnapshot: input.current, committed: false, reason: "invalid_or_missing_proposal" };
    }
    const statusByOutcome = {
      end_relationship_with_clarity: "ended",
      reduce_contact_and_redefine_role: "distant",
      attempt_one_bounded_repair: "strained"
    } as const;
    const status = statusByOutcome[outcomeId as keyof typeof statusByOutcome];
    if (!status) return { worldStateSnapshot: input.current, committed: false, reason: "outcome_not_authorized" };
    try {
      const next = reduceRelationshipState({
        current: input.current,
        expectedRevision: input.current.relationshipRevision || 0,
        nextState: {
          ...currentRelationship,
          status,
          statusEffectiveFromAgeInMonths: status === currentRelationship.status
            ? currentRelationship.statusEffectiveFromAgeInMonths
            : input.effectiveAtAgeInMonths
        }
      });
      return { worldStateSnapshot: withCommittedId(next, transactionId), committed: true };
    } catch {
      return { worldStateSnapshot: input.current, committed: false, reason: "transition_rejected" };
    }
  }

  return applyFamilyOutcome(input, outcomeId, transactionId)
    || { worldStateSnapshot: input.current, committed: false, reason: "unhandled_event" };
}
