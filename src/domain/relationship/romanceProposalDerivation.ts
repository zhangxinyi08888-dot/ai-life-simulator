import type { NarrativeMeta, RelationshipProposal, SimulationNode, WorldStateSnapshot } from "../../types";
import { stableHash } from "../../utils/stableRandom";

export type DeterministicRomanceIntent =
  | "romance_new_connection"
  | "romance_connection_clarification"
  | "romance_exploration_resolution"
  | "relationship_material_commitment_test"
  | "relationship_commitment_resolution"
  | "relationship_release_and_reorientation";

type ActiveCharacter = NarrativeMeta["activeCharacters"][number];

const ROMANCE_OUTCOMES: Record<DeterministicRomanceIntent, string[]> = {
  romance_new_connection: ["continue_getting_to_know"],
  romance_connection_clarification: [
    "begin_mutual_dating",
    "continue_slow_exploration",
    "end_romantic_exploration"
  ],
  romance_exploration_resolution: [
    "begin_mutual_dating",
    "return_to_acquaintance",
    "end_romantic_exploration"
  ],
  relationship_material_commitment_test: [
    "make_shared_commitment_plan",
    "delay_with_clear_conditions",
    "reassess_relationship_fit"
  ],
  relationship_commitment_resolution: [
    "make_shared_commitment_plan",
    "maintain_committed_partnership_without_marriage",
    "reassess_relationship_fit"
  ],
  relationship_release_and_reorientation: [
    "end_relationship_with_clarity",
    "reduce_contact_and_redefine_role",
    "attempt_one_bounded_repair"
  ]
};

export function isDeterministicRomanceIntent(value?: string): value is DeterministicRomanceIntent {
  return Boolean(value && value in ROMANCE_OUTCOMES);
}

function proposalId(node: SimulationNode, type: RelationshipProposal["type"], outcomeId: string): string {
  return `relationship_proposal_${stableHash({
    episodeId: node.narrativeMeta?.storyEpisode.id,
    eventId: node.eventMeta?.eventId,
    type,
    outcomeId
  })}`;
}

function exactEvidence(node: SimulationNode, displayName?: string): string {
  return (displayName
    ? node.descriptionParagraphs.find((paragraph) => paragraph.includes(displayName))?.trim()
    : undefined)
    || node.descriptionParagraphs.find((paragraph) => paragraph.trim())?.trim()
    || node.description.trim()
    || node.title.trim();
}

export function romanceCandidate(node: SimulationNode): ActiveCharacter | undefined {
  const characters = node.narrativeMeta?.activeCharacters || [];
  const explicit = characters.find((character) => character.candidateOrdinal === 0);
  if (explicit) return explicit;
  const unboundNamed = characters.filter((character) => !character.personId && Boolean(character.displayName?.trim()));
  return unboundNamed.length === 1 ? { ...unboundNamed[0], candidateOrdinal: 0 } : undefined;
}

export function withRomanceCandidate(node: SimulationNode, candidate?: ActiveCharacter): SimulationNode {
  if (!node.narrativeMeta) return node;
  const resolved = candidate || romanceCandidate(node) || {
    candidateOrdinal: 0,
    relation: "other" as const,
    presenceMode: "active_scene" as const,
    currentRole: "新认识的人"
  };
  const retained = node.narrativeMeta.activeCharacters.filter((character) => (
    character.candidateOrdinal !== 0
    && !(
      !character.personId
      && Boolean(resolved.displayName?.trim())
      && character.displayName?.trim() === resolved.displayName?.trim()
    )
  ));
  return {
    ...node,
    narrativeMeta: {
      ...node.narrativeMeta,
      activeCharacters: [...retained, { ...resolved, candidateOrdinal: 0 }]
    }
  };
}

export function withAuthoritativeRomanceCharacter(
  node: SimulationNode,
  snapshot: WorldStateSnapshot
): SimulationNode {
  if (!node.narrativeMeta) return node;
  const relationship = snapshot.relationships?.find((candidate) => (
    candidate.type === "romantic"
    && ["active", "strained"].includes(candidate.status)
  ));
  const personId = relationship?.participantPersonIds[0];
  const person = personId ? snapshot.people.find((candidate) => candidate.id === personId) : undefined;
  if (!relationship || !personId || !person) return node;
  const retained = node.narrativeMeta.activeCharacters.filter((character) => character.personId !== personId);
  return {
    ...node,
    narrativeMeta: {
      ...node.narrativeMeta,
      activeCharacters: [...retained, {
        personId,
        displayName: person.displayName,
        relation: "partner",
        presenceMode: "active_scene",
        currentRole: person.relationshipSummary || "当前关系中的同一人物",
        encounterType: "existing_connection",
        encounterContext: "personal"
      }]
    }
  };
}

function transitionEffect(outcomeId: string): Partial<Extract<RelationshipProposal, { type: "romantic_transition" }>> {
  if (outcomeId === "continue_getting_to_know" || outcomeId === "continue_slow_exploration") {
    return { toStage: "exploring", toStatus: "active" };
  }
  if (outcomeId === "begin_mutual_dating") return { toStage: "dating", toStatus: "active" };
  if (outcomeId === "return_to_acquaintance") return { toStage: "acquaintance", toStatus: "ended" };
  if (outcomeId === "make_shared_commitment_plan" || outcomeId === "delay_with_clear_conditions") {
    return { toStage: "dating", toStatus: "active" };
  }
  if (outcomeId === "maintain_committed_partnership_without_marriage") {
    return { toStage: "dating", toStatus: "active" };
  }
  if (outcomeId === "reassess_relationship_fit") return { toStage: "dating", toStatus: "strained" };
  if (outcomeId === "end_romantic_exploration" || outcomeId === "end_relationship_with_clarity") {
    return { toStatus: "ended" };
  }
  if (outcomeId === "reduce_contact_and_redefine_role") return { toStatus: "distant" };
  if (outcomeId === "attempt_one_bounded_repair") return { toStatus: "strained" };
  return {};
}

export function deriveDeterministicRomanceProposals(
  node: SimulationNode,
  intent: DeterministicRomanceIntent
): SimulationNode {
  if (!node.narrativeMeta) return node;
  const prepared = intent === "romance_new_connection" ? withRomanceCandidate(node) : node;
  const candidate = intent === "romance_new_connection" ? romanceCandidate(prepared) : undefined;
  const evidence = exactEvidence(prepared, candidate?.displayName?.trim());
  const retained = (prepared.narrativeMeta?.relationshipProposals || []).filter((proposal) => (
    proposal.type !== "person_introduction" && proposal.type !== "romantic_transition"
  ));
  const proposals: RelationshipProposal[] = [...retained];

  if (intent === "romance_new_connection" && candidate) {
    proposals.push({
      id: proposalId(prepared, "person_introduction", "continue_getting_to_know"),
      type: "person_introduction",
      sourceOutcomeId: "continue_getting_to_know",
      evidence,
      displayName: candidate.displayName?.trim() || undefined,
      candidateOrdinal: 0
    });
  }

  for (const outcomeId of ROMANCE_OUTCOMES[intent]) {
    proposals.push({
      id: proposalId(prepared, "romantic_transition", outcomeId),
      type: "romantic_transition",
      sourceOutcomeId: outcomeId,
      evidence,
      ...transitionEffect(outcomeId)
    });
  }

  return {
    ...prepared,
    narrativeMeta: { ...prepared.narrativeMeta!, relationshipProposals: proposals }
  };
}
