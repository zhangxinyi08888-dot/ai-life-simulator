import type { WorldStateSnapshot } from "../../types";
import { splitNarrativeParagraphs } from "../../utils/narrativePresentation";
import { stableHash } from "../../utils/stableRandom";
import type {
  CandidateRevision,
  LockedCandidateSkeleton,
  NodeCandidateEnvelope,
  SimulationNodeCandidate
} from "./nodeCandidateTypes";

function definedRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export function fingerprintWorldState(worldState: WorldStateSnapshot): string {
  return stableHash({
    version: worldState.version,
    people: worldState.people,
    directionArcs: worldState.directionArcs,
    pressureArcs: worldState.pressureArcs,
    foregroundPressureArcId: worldState.foregroundPressureArcId,
    currentEmploymentStatus: worldState.currentEmploymentStatus,
    careerStates: worldState.careerStates,
    currentCareerStateId: worldState.currentCareerStateId,
    careerRevision: worldState.careerRevision ?? 0,
    relationships: worldState.relationships,
    relationshipRevision: worldState.relationshipRevision ?? 0,
    familyRelationships: worldState.familyRelationships,
    familyRelationshipRevision: worldState.familyRelationshipRevision ?? 0,
    routePreferences: worldState.routePreferences,
    committedTransactionIds: worldState.committedTransactionIds
  });
}

export function normalizePatchableCandidate(candidate: SimulationNodeCandidate): Record<string, unknown> {
  const paragraphs = candidate.descriptionParagraphs?.filter(Boolean)
    ?? splitNarrativeParagraphs(candidate.description);
  return definedRecord({
    age: candidate.age,
    ageInMonths: candidate.ageInMonths,
    lifeStage: candidate.lifeStage,
    stage: candidate.stage,
    title: candidate.title,
    descriptionParagraphs: paragraphs,
    choices: candidate.choices,
    attributes: candidate.attributes,
    isEndingNode: candidate.isEndingNode,
    eventMeta: candidate.eventMeta,
    narrativeMeta: candidate.narrativeMeta,
    financialEventProposals: candidate.financialEventProposals
  });
}

export function hashNodeCandidate(
  skeleton: LockedCandidateSkeleton,
  candidate: SimulationNodeCandidate
): string {
  return stableHash({
    version: "node_candidate_v1",
    skeleton,
    candidate: normalizePatchableCandidate(candidate)
  });
}

export function createNodeCandidateEnvelope(input: {
  candidateRevision: CandidateRevision;
  skeleton: LockedCandidateSkeleton;
  candidate: SimulationNodeCandidate;
  requestedIssueCodes?: string[];
  allowedPatchSurfaces?: string[];
}): NodeCandidateEnvelope {
  const candidate = structuredClone(input.candidate);
  return {
    candidateRevision: input.candidateRevision,
    skeleton: structuredClone(input.skeleton),
    candidate,
    baseCandidateHash: hashNodeCandidate(input.skeleton, candidate),
    patchApplied: false,
    patchIssueCodes: [],
    requestedIssueCodes: [...(input.requestedIssueCodes ?? [])],
    allowedPatchSurfaces: [...(input.allowedPatchSurfaces ?? [
      "titleReplacement",
      "descriptionParagraphPatches",
      "replacementChoices",
      "proposalPatch",
      "narrativeMetaPatch"
    ])]
  };
}
