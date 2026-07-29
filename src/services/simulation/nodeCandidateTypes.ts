import type {
  ArcSignalProposal,
  EmploymentTransitionProposal,
  LifeIntensity,
  SimulationChoice,
  SimulationNode,
  StoryEpisode,
  WorldDelta,
  WorldStateSnapshot
} from "../../types";
import type { FinancialEventProposal } from "../../domain/finance/types";

export type CandidateRevision = 0 | 1;

export interface LockedCandidateSkeleton {
  simulationSeed: string;
  branchFingerprint: string;
  nodeIndex: number;
  transactionId: string;
  sourceSelectedDecision: string;
  selectedOutcomeId?: string;
  currentAgeInMonths: number;
  targetAgeInMonths: number;
  elapsedMonths: number;
  lifeIntensity: LifeIntensity;
  eventId?: string;
  eventIntentType?: string;
  allowedOutcomeIds: string[];
  foregroundPressureArcId?: string;
  pressureArcPhasePolicyId?: string;
  pressureArcPhaseId?: string;
  worldStateFingerprint: string;
  worldStateVersion: WorldStateSnapshot["version"];
  careerRevision: number;
  relationshipRevision: number;
  familyRelationshipRevision: number;
  ledgerRevision?: number;
  authoritativeCharacterIds: string[];
  relationshipCheckpointKey?: string;
}

export type SimulationNodeCandidate = Omit<SimulationNode,
  | "financialLedger"
  | "financialLedgerMode"
  | "financialState"
  | "debtHealthState"
  | "financialPeriodSummary"
  | "financialSignals"
  | "financialChange"
  | "financialProcessingMeta"
  | "worldStateSnapshot"
  | "committedArcMeta"
  | "reportInvitation"
> & {
  financialEventProposals?: FinancialEventProposal[];
};

export type CandidateRepairIssueCode = string;

export interface NodeCandidateEnvelope {
  candidateRevision: CandidateRevision;
  skeleton: LockedCandidateSkeleton;
  candidate: SimulationNodeCandidate;
  baseCandidateHash: string;
  patchApplied: boolean;
  patchIssueCodes: CandidateRepairIssueCode[];
  requestedIssueCodes: CandidateRepairIssueCode[];
  allowedPatchSurfaces: string[];
}

export interface DescriptionParagraphPatch {
  paragraphId: string;
  expectedTextHash: string;
  replacementText: string;
}

export interface CandidateProposalPatch {
  financialEventProposals?: FinancialEventProposal[];
  employmentTransition?: EmploymentTransitionProposal | null;
  worldDeltas?: WorldDelta[];
}

export interface CandidateNarrativeMetaPatch {
  storyEpisode?: StoryEpisode;
  arcSignals?: ArcSignalProposal[];
}

export interface NodeCandidatePatch {
  contractVersion: "node_candidate_patch_v1";
  baseCandidateHash: string;
  targetCandidateRevision: CandidateRevision;
  addressedIssueCodes: CandidateRepairIssueCode[];
  titleReplacement?: string;
  descriptionParagraphPatches?: DescriptionParagraphPatch[];
  replacementChoices?: SimulationChoice[];
  proposalPatch?: CandidateProposalPatch;
  narrativeMetaPatch?: CandidateNarrativeMetaPatch;
}

export type CandidateRepairStrategy = "deterministic" | "model_patch" | "full_regeneration" | "fatal";
export type CandidateRepairPhase = "parse" | "normalize" | "pre_settlement" | "post_settlement";

export interface CandidateRepairIssue {
  code: CandidateRepairIssueCode;
  phase: CandidateRepairPhase;
  strategy: CandidateRepairStrategy;
  surfaces: string[];
  message: string;
  authorityContext: Record<string, unknown>;
}
