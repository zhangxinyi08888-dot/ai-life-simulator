import { buildEventMeta, getEventTemporalProfile, getLastEventSelectionTrace, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent, queryHealthEscalationEvent, type LifeEventSeed } from "../../data/lifeEvents";
import { ChoiceTemporalHint, EmploymentTransitionProposal, EventMeta, ExpenseLifecycleCandidateTelemetry, ExpenseLifecycleProjectedCommitmentChange, FinancialState, HistoryItem, LifeAttributes, LifeIntensity, PendingEmployerOfferResolution, PendingEmployerOfferState, PersonalityInsight, PressureArcState, QuestionItem, QuestionTurn, RelationshipProposal, SimulationNode, UserInitialData, WorldDelta, WorldStateSnapshot } from "../../types";
import { DEFAULT_ENDING_POLICY } from "../../config/endingPolicy";
import { DEFAULT_REPORT_INVITATION_POLICY } from "../../config/reportInvitationPolicy";
import {
  DEFAULT_EXPENSE_LIFECYCLE_MODE,
  DEFAULT_EXPENSE_NARRATIVE_BINDING_MODE,
  DEFAULT_FINANCIAL_NODE_GATE_MODE,
  FINANCIAL_GATE_MAX_REGENERATIONS,
  compatibleExpenseNarrativeBindingMode,
  type ExpenseNarrativeBindingMode,
  type ExpenseLifecycleMode,
  type FinancialNodeGateMode
} from "../../config/financialGatePolicy";
import { buildQuestionPrompt } from "../../utils/questionPrompt";
import { normalizePersonalityInsight } from "../../utils/insightResponse";
import { generateCompleteSimulationNode, isRetryableNodeGenerationError } from "../../utils/simulationNodeRetry";
import {
  getInvalidExplicitChoiceTextIndexes,
  getRawSimulationNodeChoices,
  getSimulationNodeValidationIssues,
  canonicalizeGeneratedChoiceIds,
  groundedRomanceCharacter,
  normalizeSimulationNodeChoices,
  normalizeSimulationNode,
  repairDeterministicRomanceChoices
} from "../../utils/simulationResponse";
import { buildStoryContextPack } from "../../utils/storyContext";
import { buildAgeContext } from "../../utils/ageContext";
import { FINANCIAL_DEBT_PHASE_POLICY, HEALTH_CRISIS_PHASE_POLICY, preemptDebtArcForAcuteHealth, reducePressureArc, resolveDebtArcAfterHealth, resolvePhase, resolvePhasePolicy, resolvePressureArcPresentationEvent as resolvePolicyPressureArcPresentationEvent, validateNodeOutcomeProposal, type AcceptedNodeOutcome, type PhaseTransitionPolicy, type PressureArcTransitionDecision } from "../../utils/arcLifecycle";
import { applyDecisionDensityDowngrade, downgradeDensityLimitedNode, evaluateDecisionGate } from "../../utils/decisionGate";
import { evaluateEnding } from "../../utils/endingDecision";
import { rebuildPersonStates } from "../../utils/personTimeline";
import { commitSimulationTransaction, emptyWorldState } from "../../utils/simulationTransaction";
import { acceptedResidenceOccupancyState } from "../../utils/residenceOccupancyState";
import {
  explicitFactsFromAcceptedExpenseResponsibilityDeltas,
  missingDetectedCompletedParentCareResponsibilities,
  missingAcceptedExpenseResponsibilityDeltas
} from "../../utils/expenseResponsibilityOutcome";
import { buildBranchFingerprint, calculateTimelineAdvance, constrainTemporalProfileForDebtDistress, deriveTemporalProfile } from "../../utils/timelineAdvance";
import { stableHash } from "../../utils/stableRandom";
import { isValidRomanceDisplayName } from "../../utils/romanceCandidateName";
import { containsForbiddenArcWrite, stripForbiddenArcWrites, stripUnauthorizedRelationshipChoices, stripUnauthorizedRomanticCharacters, validateStoryConsistency } from "../../utils/storyConsistency";
import { estimateFinancialStateFromWealth, normalizeInitialFinancialState, withCalculatedWealth } from "../../utils/financialState";
import { hasCompletedEmployerStartEvidence, resolveAuthoritativeEmploymentStatus } from "../../utils/employmentState";
import { sanitizeFinancialNarrative, sanitizeOpeningFinancialTitle, sanitizeSimulationNodeFinancialNarrative, sanitizeUnsupportedFinancialCoverageClaims, sanitizeUnsupportedOpeningAccountClaims, stripUnsupportedPersonalIncomeClaim, validateDebtNarrativeConsistency } from "../../utils/financialNarrative";
import { applyDebtNarrativeAuthorityToNode, applyDebtNarrativeFallback, collectDebtNarrativeSurfaceIssues, deriveDebtNarrativeAuthority, repairDebtNarrativeSurfaces } from "../../utils/debtNarrativeAuthority";
import { reconcileHealth } from "../../utils/healthReconciliation";
import { evaluateReportInvitation } from "../../utils/reportInvitationDecision";
import { queryDebtEscalationEvent } from "../../utils/debtEventScheduling";
import { adaptTransitionalEmploymentProposal, currentCareerState, initializeCareerState, validateAndAcceptCareerTransition } from "../../domain/career/careerState";
import type { AcceptedCareerTransition, CareerState } from "../../domain/career/types";
import {
  applySelectedRelationshipOutcome,
  activeRelationshipCheckpoint,
  deriveRelationshipDeferralState,
  deriveRelationshipCheckpointDeferral,
  deriveDeterministicRomanceProposals,
  deriveOpeningRomanticOutcomeId,
  earliestRelationshipCheckpointTimelineBoundary,
  ensureRelationshipWorldState,
  isDeterministicRomanceIntent,
  relationshipLifecycleEventId,
  relationshipCheckpointKey,
  withAuthoritativeRomanceCharacter,
  withRomanceCandidate
} from "../../domain/relationship";
import { createSelectionEntropy, type SelectionEntropy } from "../../config/lineMixPolicy";
import { relationshipDispatchFeatureFlags, type RelationshipDispatchFeatureFlags } from "../../config/relationshipDispatchFlags";
import {
  commitFinancialDomainTransaction,
  previewFinancialDomainTransaction,
  buildRequiredFinancialFactGroups,
  evaluateFinancialNodeAcceptance,
  applyLifeStageExpenseLifecycle,
  reconcileExpenseCommitments,
  deriveDebtHealthState,
  deriveFinancialState,
  deriveConservativeWealthBasis,
  migrateFinancialLedgerV2ToV3,
  preflightFinancialLedgerV3ToV4,
  isFinancialLedgerV4,
  prepareOpeningFinancialAuthority,
  commitPreparedOpeningFinancialAuthority,
  migrateLegacyFinancialState,
  applyOpeningFactsToFinancialState,
  applyAuthoritativeOpeningFactsToFinancialState,
  extractOpeningFinancialFacts,
  normalizeFinancialProposals,
  normalizeRepairedFinancialProposals,
  matchesNormalizedEvidence,
  collectPersonalIncomeNarrativeContractIssues,
  sentenceClaimsNewPersonalIncomeActivity,
  hasExplicitUnpaidPersonalIncomeStatement,
  buildLateLifeEmploymentClosure,
  requiresHardLateLifeCareerIncomeResolution,
  completeCareerIncomeReplacementProposals,
  buildMortalityFinancialClosure,
  reconcileCareerIncomeAtomicity,
  validateFinancialProposals,
  validateExpenseConfirmationAtomicity,
  verifyAcceptedExpenseConfirmationAgainstFinalNarrative,
  isFinancialEventKind,
  isUnacceptedIncomeOpportunityEvidence,
  explicitProtagonistAnnualIncomeWan,
  hasExplicitProtagonistAnnualIncomeFact,
  isNarratedBeforePeriod,
  FinancialLedgerInvariantError,
  type FinancialEventKind,
  type FinancialEventProposal,
  type FinancialNarrativeClaim,
  type AcceptedFinancialEvent,
  type FinancialLedger,
  type FinancialLedgerInput,
  type FinancialLedgerV3,
  type FinancialLedgerIssue,
  type ExpenseResponsibilityCandidate,
  type ExpenseCommitmentReconciliationCandidateDecision
} from "../../domain/finance";
import type { FinancialNodeAcceptanceDecision, FinancialNodeGateRejectionDiagnostic, RequiredFinancialFactGroup } from "../../domain/finance";
import type { ExpenseLivingArrangement, ExpenseResponsibilityEstimateContext } from "../../domain/finance/expenseEstimationPolicyV2";
import { callDeepSeekJsonFromBrowser, callDeepSeekJsonStreamFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import { AiClientError } from "../ai/errors";
import { flattenAiPromptInput, type AiJsonResult, type AiPromptInput, type DeepSeekStreamOptions } from "../../utils/deepseek";
import { getBrowserE2eAiJsonCaller, getBrowserE2eAiJsonStreamCaller, getBrowserE2eEventOverride, shouldForceBrowserE2eEnding } from "../e2e/e2eAiMock";
import { extractStreamedNodePreview, type StreamedNodePreview } from "../../utils/streamingJsonPreview";
import { splitNarrativeParagraphs } from "../../utils/narrativePresentation";
import {
  buildChoiceTextRepairPrompt,
  buildNextNodePromptLayout,
  buildNextNodePromptRequest,
  buildNextNodePromptRequestFromLayout,
  buildEndingNodePrompt,
  buildFinancialProposalRepairPrompt,
  buildNodePromptWithRetryNotice,
  buildPersonalityPrompt,
  buildStartSimulationPrompt,
  buildTimeTravelPrompt
} from "./prompts";
import { createNodeCandidateEnvelope, fingerprintWorldState } from "./nodeCandidateHash";
import { applyNodeCandidatePatch, type ApplyNodeCandidatePatchResult } from "./nodeCandidatePatch";
import { buildNodeCandidatePatchPrompt, parseNodeCandidatePatch } from "./nodeCandidatePatchPrompt";
import { CANDIDATE_ISSUE, repairIssue, uniqueRepairIssues } from "./nodeCandidateIssues";
import type { CandidateRepairIssue, LockedCandidateSkeleton, SimulationNodeCandidate } from "./nodeCandidateTypes";
import {
  canPatch,
  canRegenerate,
  consumeFullGeneration,
  consumeModelPatch,
  createNodeGenerationBudget,
  type NodeGenerationBudget
} from "./nodeGenerationBudget";
import { traceGenerationCall, type GenerationTraceListener } from "./generationTelemetry";

type AiJsonCaller = (prompt: string) => Promise<AiJsonResult>;
type AiJsonStringStreamCaller = (
  prompt: string,
  options?: DeepSeekStreamOptions
) => Promise<AiJsonResult>;
type AiJsonStreamCaller = (
  prompt: AiPromptInput,
  options?: DeepSeekStreamOptions
) => Promise<AiJsonResult>;

export type NextGenerationStage = "preparing" | "generating" | "validating" | "repairing" | "finalizing" | "revealing";

function normalizeRepairedEmploymentTransition(input: {
  raw: unknown;
  fallback?: EmploymentTransitionProposal;
  acceptedOutcomeId: string;
  narrativeText: string;
  periodStartAgeInMonths: number;
}): EmploymentTransitionProposal | undefined {
  if (!input.raw || typeof input.raw !== "object") return undefined;
  const raw = structuredClone(input.raw) as Record<string, unknown>;
  const fallback = input.fallback ? structuredClone(input.fallback) as unknown as Record<string, unknown> : {};
  const merged = { ...fallback, ...Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== null && value !== "")) };
  const rawStatus = String(merged.toStatus || "");
  const statusAliases: Record<string, EmploymentTransitionProposal["toStatus"]> = {
    consultant: "self_employed",
    consulting: "self_employed",
    advisor: "self_employed",
    freelance_consultant: "self_employed",
    part_time_consultant: "self_employed",
    consultant_part_time: "self_employed",
    independent_consultant: "self_employed",
    retirement: "retired",
    fully_retired: "retired"
  };
  // A repair must not let a transport label such as "consultant" override
  // the completed narrative fact.  A named external paid consultant role that
  // the protagonist has actually accepted is employment; independent projects
  // remain excluded by hasCompletedEmployerStartEvidence.
  const toStatus = hasExplicitSelfDirectedVentureEvidence(input.narrativeText, "narrative")
    ? "self_employed"
    : (hasCompletedEmployerStartEvidence(input.narrativeText)
      ? "employed"
      : (statusAliases[rawStatus] || rawStatus as EmploymentTransitionProposal["toStatus"]));
  let evidence = typeof merged.evidence === "string" ? merged.evidence : "";
  if (!evidence || !matchesNormalizedEvidence(input.narrativeText, evidence)) {
    const evidencePattern = toStatus === "retired" || toStatus === "not_working"
      ? /退休|离职|停止工作|结束工资|离开工资序列/
      : (toStatus === "self_employed"
        ? /联合创始人|创始人|共同创办|自己创办|自主创办|独立创办|创业/
        : /顾问|咨询|转为|岗位|工作节奏|工时/);
    evidence = input.narrativeText.split(/(?<=[。！？；])/u).find((sentence) => evidencePattern.test(sentence))?.trim() || evidence;
  }
  const effectiveAtAgeInMonths = Number.isInteger(Number(merged.effectiveAtAgeInMonths))
    ? Number(merged.effectiveAtAgeInMonths)
    : input.periodStartAgeInMonths;
  const confidence = Number.isFinite(Number(merged.confidence))
    ? Number(merged.confidence)
    : evidence && matchesNormalizedEvidence(input.narrativeText, evidence) ? 0.8 : Number.NaN;
  return {
    subject: "protagonist",
    toStatus,
    effectiveAtAgeInMonths,
    sourceOutcomeId: input.acceptedOutcomeId,
    occupation: typeof merged.occupation === "string" ? merged.occupation : statusAliases[rawStatus] ? "顾问" : undefined,
    industry: typeof merged.industry === "string" ? merged.industry : undefined,
    organization: typeof merged.organization === "string" ? merged.organization : undefined,
    careerStage: typeof merged.careerStage === "string" ? merged.careerStage : undefined,
    evidence,
    confidence
  };
}

export interface SimulationServiceDeps {
  callAiJson?: AiJsonCaller;
  /** Test and local callers retain the historical flattened-string contract. */
  callAiJsonStream?: AiJsonStringStreamCaller;
  onGenerationStage?: (stage: NextGenerationStage) => void;
  onNarrativeProgress?: (preview: StreamedNodePreview) => void;
  signal?: AbortSignal;
  generationBudget?: NodeGenerationBudget;
  onGenerationCallTrace?: GenerationTraceListener;
  /** Release flag. Disabled by default until Candidate Patch proves it avoids full regeneration reliably. */
  enableCandidatePatchRepair?: boolean;
  /** Build-time escape hatch for Cache Prefix V1; default is enabled. */
  cacheAwarePromptV1?: boolean;
  /** Opt-in reference-context candidate; default remains the proven V1 layout. */
  cacheAwarePromptV2?: boolean;
  /** Internal reason propagation for a recursive full regeneration. */
  fullRegenerationReasonCodes?: string[];
  relationshipDispatchFeatureFlags?: Partial<RelationshipDispatchFeatureFlags>;
  financialNodeGateMode?: FinancialNodeGateMode;
  /** V4 responsibility reconciliation rollout; independent from legacy gate mode. */
  expenseLifecycleMode?: ExpenseLifecycleMode;
  /** Selects the narrative candidate writer; separate from lifecycle commit mode. */
  expenseNarrativeBindingMode?: ExpenseNarrativeBindingMode;
  onFinancialGateDecision?: (decision: FinancialNodeAcceptanceDecision) => void;
  /** Internal bounded-regeneration counter; callers should not set it. */
  financialGateRegenerationCount?: number;
  /** Internal feedback from the previous rejected financial preview. */
  financialGateRetryReasonCodes?: string[];
  /** Internal recursion guard and evidence for a failed romance event redispatch. */
  romanceFallbackContext?: {
    requestedEventId: string;
    reason: string;
    repairAttempted: boolean;
  };
}

class FinancialNodeGateError extends AiClientError {
  readonly decision: FinancialNodeAcceptanceDecision;
  /**
   * UI recovery must be able to distinguish a rejected, uncommitted Preview
   * from an ordinary malformed model response without depending on this
   * private error class.  The decision itself remains the audit record.
   */
  readonly retryScope = "financial_gate" as const;

  constructor(decision: FinancialNodeAcceptanceDecision) {
    super("AI_RESPONSE_INVALID", `财务节点接受门拒绝候选：${decision.blockingReasonCodes.join(",")}`);
    this.name = "FinancialNodeGateError";
    this.decision = decision;
  }
}

const FINANCIAL_GATE_DIAGNOSTIC_MAX_PROPOSALS = 20;
const FINANCIAL_GATE_DIAGNOSTIC_MAX_ISSUES = 24;
const FINANCIAL_GATE_DIAGNOSTIC_MAX_TEXT = 1400;

function redactFinancialGateDiagnosticText(value: unknown, maxLength = 320): { text: string; truncated: boolean } {
  const redacted = String(value ?? "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, "Bearer [REDACTED_SECRET]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(/\b1\d{10}\b/gu, "[REDACTED_PHONE]");
  return {
    text: redacted.slice(0, maxLength),
    truncated: redacted.length > maxLength
  };
}

function projectFinancialGateDiagnosticValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactFinancialGateDiagnosticText(value, 240).text;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => projectFinancialGateDiagnosticValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 16)
      .map(([key, item]) => [
        key,
        /(?:api[_-]?key|token|secret|password)/iu.test(key)
          ? "[REDACTED_SECRET]"
          : projectFinancialGateDiagnosticValue(item, depth + 1)
      ]));
  }
  return `[UNSUPPORTED_${typeof value}]`;
}

function buildFinancialGateRejectionDiagnostic(input: {
  node: Pick<SimulationNode, "title" | "description">;
  proposals: FinancialEventProposal[];
  acceptedProposalIds: Set<string>;
  rejectedProposalIds: Set<string>;
  issues: FinancialLedgerIssue[];
  requiredFactGroups: RequiredFinancialFactGroup[];
  provisionalCareerTransitions: AcceptedCareerTransition[];
}): FinancialNodeGateRejectionDiagnostic {
  const description = redactFinancialGateDiagnosticText(input.node.description, FINANCIAL_GATE_DIAGNOSTIC_MAX_TEXT);
  const title = redactFinancialGateDiagnosticText(input.node.title, 240);
  const proposals = input.proposals.slice(0, FINANCIAL_GATE_DIAGNOSTIC_MAX_PROPOSALS).map((proposal) => ({
    id: proposal.id,
    kind: String(proposal.kind),
    effectiveAtAgeInMonths: proposal.effectiveAtAgeInMonths,
    ...(proposal.sourceOutcomeId ? { sourceOutcomeId: proposal.sourceOutcomeId } : {}),
    ...(proposal.confidence === undefined ? {} : { confidence: proposal.confidence }),
    ...(proposal.financialScope ? { financialScope: proposal.financialScope } : {}),
    ...(proposal.systemGenerated ? { systemGenerated: proposal.systemGenerated } : {}),
    disposition: input.acceptedProposalIds.has(proposal.id)
      ? "accepted" as const
      : input.rejectedProposalIds.has(proposal.id)
        ? "rejected" as const
        : "unaccepted" as const,
    evidenceExcerpt: redactFinancialGateDiagnosticText(proposal.evidence, 320).text,
    payload: projectFinancialGateDiagnosticValue(proposal.payload)
  }));
  return {
    schemaVersion: 1,
    candidate: {
      titleExcerpt: title.text,
      descriptionExcerpt: description.text,
      descriptionFingerprint: stableHash({ version: "financial-gate-rejection-v1", description: description.text }),
      descriptionTruncated: description.truncated
    },
    proposals,
    normalizedProposalCount: input.proposals.length,
    omittedProposalCount: Math.max(0, input.proposals.length - proposals.length),
    rejectedProposalIds: [...input.rejectedProposalIds].slice(0, FINANCIAL_GATE_DIAGNOSTIC_MAX_PROPOSALS),
    validatorIssues: input.issues.slice(0, FINANCIAL_GATE_DIAGNOSTIC_MAX_ISSUES).map((issue) => ({
      id: issue.id,
      code: issue.code,
      severity: issue.severity,
      ...(issue.status ? { status: issue.status } : {}),
      summaryExcerpt: redactFinancialGateDiagnosticText(issue.summary, 360).text,
      relatedProposalIds: [...(issue.relatedProposalIds || [])].slice(0, 12),
      relatedIncomeSourceIds: [...(issue.relatedIncomeSourceIds || [])].slice(0, 12),
      relatedAccountIds: [...(issue.relatedAccountIds || [])].slice(0, 12)
    })),
    unsatisfiedFactGroups: input.requiredFactGroups
      .filter((group) => !group.satisfied)
      .slice(0, 12)
      .map((group) => ({
        id: group.id,
        kind: group.kind,
        materiality: group.materiality,
        reasonCode: group.reasonCode,
        relatedIssueIds: [...group.relatedIssueIds].slice(0, 12),
        relatedProposalIds: [...group.relatedProposalIds].slice(0, 12)
      })),
    provisionalCareerTransitions: input.provisionalCareerTransitions.slice(0, 4).map((transition) => ({
      ...(transition.proposalId ? { proposalId: transition.proposalId } : {}),
      fromCareerStateId: transition.fromCareerStateId,
      nextCareerStateId: transition.nextCareerState.id,
      employmentStatus: transition.nextCareerState.employmentStatus,
      effectiveAtAgeInMonths: transition.effectiveAtAgeInMonths,
      evidenceExcerpt: redactFinancialGateDiagnosticText(
        transition.evidence.map((item) => item.excerpt).filter(Boolean).join("；"),
        320
      ).text
    }))
  };
}

/**
 * Responsibility deltas are allowed to create a policy-backed cash outflow
 * only when their evidence survives every later narrative writer.  The domain
 * transaction is still local at this point; throwing the ordinary gate error
 * therefore leaves ledger, timeline, WorldState and history untouched and
 * lets the bounded generation loop regenerate the node.
 */
function requireFinalExpenseResponsibilityEvidence(input: {
  initialOutcome: AcceptedNodeOutcome;
  finalOutcome: AcceptedNodeOutcome;
  narrativeText: string;
  expenseLifecycleMode: ExpenseLifecycleMode;
  transactionId: string;
  regenerationCount: number;
  authoritativeAgeBefore: number;
  onFinancialGateDecision?: (decision: FinancialNodeAcceptanceDecision) => void;
}): void {
  if (input.expenseLifecycleMode !== "enforced") return;
  const missingAccepted = missingAcceptedExpenseResponsibilityDeltas({
    acceptedWorldDeltas: input.initialOutcome.worldDeltas,
    finalWorldDeltas: input.finalOutcome.worldDeltas
  });
  // The first branch protects an already-Accepted delta from disappearing
  // during later narrative repair. The second is the inverse: a narrow,
  // high-confidence completed care fact in the final prose must not be
  // silently committed without its corresponding structured responsibility.
  // Both branches are pure Preview checks; throwing here leaves all authority
  // state unchanged and routes the whole node through bounded regeneration.
  const missingNarrative = missingDetectedCompletedParentCareResponsibilities({
    narrativeText: input.narrativeText,
    finalWorldDeltas: input.finalOutcome.worldDeltas
  });
  if (missingAccepted.length === 0 && missingNarrative.length === 0) return;
  // A final-prose detector and the earlier accepted delta can observe the
  // same responsibility through two different paths. Count each underlying
  // responsibility once, while retaining distinct father/mother (or health)
  // requirements as separate critical fact groups for audit telemetry.
  const requiredFactGroupCount = new Set([
    ...missingAccepted.map((delta) => {
      const responsibility = delta.responsibility;
      return [
        responsibility.responsibilityKind,
        responsibility.beneficiary,
        responsibility.owner,
        responsibility.cadence,
        responsibility.evidence.replace(/\s+/gu, "")
      ].join("\u001f");
    }),
    ...missingNarrative.map((responsibility) => [
      responsibility.responsibilityKind,
      responsibility.beneficiary,
      responsibility.owner,
      responsibility.cadence,
      responsibility.evidence.replace(/\s+/gu, "")
    ].join("\u001f"))
  ]).size;
  const reasonCodes = [
    ...(missingAccepted.length > 0 ? ["EXPENSE_RESPONSIBILITY_FINAL_EVIDENCE_MISSING"] : []),
    ...(missingNarrative.length > 0 ? ["EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING"] : [])
  ];
  const decision: FinancialNodeAcceptanceDecision = {
    mode: "enforced",
    disposition: "regenerate",
    allowDomainCommit: false,
    wouldBlock: true,
    blockingReasonCodes: reasonCodes,
    reasonCodes,
    relatedIssueIds: [],
    relatedProposalIds: [],
    requiredFactGroupCount,
    satisfiedFactGroupCount: 0,
    criticalFactGroupCount: requiredFactGroupCount,
    satisfiedCriticalFactGroupCount: 0,
    unsatisfiedCriticalFactGroupCount: requiredFactGroupCount,
    activeCareerIncomeCount: 0,
    previewAgeAligned: true,
    transactionId: input.transactionId,
    regenerationCount: input.regenerationCount,
    authoritativeAgeBefore: input.authoritativeAgeBefore
  };
  input.onFinancialGateDecision?.(decision);
  throw new FinancialNodeGateError(decision);
}

export interface GenerateQuestionsResult {
  questions: QuestionItem[];
}

export interface StartSimulationResult {
  initialAttributes: LifeAttributes;
  startNode: SimulationNode;
}

function rawFinancialEventProposals(rawNode: any): FinancialEventProposal[] {
  return Array.isArray(rawNode?.financialEventProposals)
    ? rawNode.financialEventProposals as FinancialEventProposal[]
    : [];
}

const LEGACY_INCOME_EVIDENCE_NARRATIVE_REPAIR = "LEGACY_INCOME_EVIDENCE_NARRATIVE_REPAIR";

function isMigrationOnlyLegacyIncomeSource(source: FinancialLedger["incomeSources"][number], currentCareerStateId: string): boolean {
  return source.id === "legacy_recurring_income"
    && source.status === "active"
    && source.linkedCareerStateId === currentCareerStateId
    && ["estimated", "needs_review"].includes(source.factStatus)
    && source.evidence.length > 0
    && source.evidence.every((item) => item.source === "legacy_migration");
}

function legacyIncomeReconfirmationIsDue(input: {
  ledger: FinancialLedger;
  source: FinancialLedger["incomeSources"][number];
  targetAgeInMonths: number;
}): boolean {
  if (input.source.accrualReviewStatus === "quarantined") return true;
  const lastConfirmedAt = input.source.lastConfirmedAtAgeInMonths ?? input.source.activeFromAgeInMonths;
  const materialTransactions = input.ledger.recentTransactions.filter((transaction) => (
    transaction.periodEndAgeInMonths > lastConfirmedAt
  )).length;
  // Match addLegacyIncomeReconfirmation: the current Preview is the next
  // material transaction, so candidate text must be reconciled before that
  // Preview quarantines an otherwise exactly re-confirmed source.
  return input.targetAgeInMonths - lastConfirmedAt >= 36 || materialTransactions + 1 >= 3;
}

function amountMatchesLegacyIncomeSource(input: {
  source: FinancialLedger["incomeSources"][number];
  nextSource: Record<string, unknown>;
  evidence: string;
}): boolean {
  const isPersonal = /(?:你|主角|本人|个人账户)/u.test(input.evidence);
  if (!isPersonal) return false;
  // The accrual policy, rather than property presence, owns which amount is
  // rendered as the current salary.  Some legacy records contain both fields;
  // their unused amount still has to remain unchanged by the reconfirmation.
  if (input.source.accrualPolicy === "annual") {
    if (input.source.annualNetAmountWan === undefined) return false;
    const nextAnnual = Number(input.nextSource.annualNetAmountWan);
    const annualEvidence = input.evidence.match(/(?:(?:税后)?(?:年薪|年收入)|年税后收入)[^。！？]{0,20}?(\d+(?:\.\d+)?)\s*万元?/u);
    return Number.isFinite(nextAnnual)
      && nextAnnual === input.source.annualNetAmountWan
      && annualEvidence !== null
      && Number(annualEvidence[1]) === input.source.annualNetAmountWan;
  }
  if (input.source.accrualPolicy === "monthly") {
    if (input.source.monthlyNetAmountWan === undefined) return false;
    const nextMonthly = Number(input.nextSource.monthlyNetAmountWan);
    const monthlyEvidence = input.evidence.match(/(?:税后)?(?:月薪|月收入|工资|薪资)[^。！？]{0,20}?(\d+(?:\.\d+)?)\s*(万(?:元)?|元)/u);
    if (!monthlyEvidence || !Number.isFinite(nextMonthly) || nextMonthly !== input.source.monthlyNetAmountWan) return false;
    const evidenceMonthlyWan = Number(monthlyEvidence[1]) * (monthlyEvidence[2] === "元" ? 0.0001 : 1);
    return Math.abs(evidenceMonthlyWan - input.source.monthlyNetAmountWan) < 0.000001;
  }
  return false;
}

function hasExplicitPersonalCompensationAmount(text: string): boolean {
  return /(?:你|主角|本人|个人账户).{0,80}(?:(?:税后)?(?:月薪|年薪|月收入|年收入|工资|薪资)|年税后收入)[^。！？]{0,20}\d+(?:\.\d+)?\s*(?:万(?:元)?|元)/u.test(text);
}

function hasExplicitIncomeInterruption(text: string): boolean {
  return hasExplicitUnpaidPersonalIncomeStatement(text)
    || /(?:停薪|无薪|不领薪)/u.test(text)
    || /(?:工资|薪资|薪水|收入)[^。！？]{0,20}(?:尚未|还未|未能|延迟|停薪|停发|暂停|中断)|(?:尚未|还未|未能|延迟|停薪|停发|暂停|中断)[^。！？]{0,20}(?:工资|薪资|薪水|收入)/u.test(text);
}

const LEGACY_INCOME_RECONFIRMATION_IMMUTABLE_FIELDS = [
  "id",
  "displayName",
  "monthlyNetAmountWan",
  "annualNetAmountWan",
  "accrualPolicy",
  "activeFromAgeInMonths",
  "activeUntilAgeInMonths",
  "status",
  "linkedCareerStateId",
  "linkedAssetAccountId",
  "linkedBusinessHoldingId",
  "lastConfirmedAtAgeInMonths"
] as const;

function isExactLegacyIncomeReconfirmationSource(input: {
  source: FinancialLedger["incomeSources"][number];
  nextSource: Record<string, unknown>;
  expectedType: "salary" | "self_employment_draw";
}): boolean {
  const allowedFields = new Set([
    ...LEGACY_INCOME_RECONFIRMATION_IMMUTABLE_FIELDS,
    "type",
    "factStatus",
    "accrualReviewStatus",
    "evidence"
  ]);
  if (Object.keys(input.nextSource).some((field) => !allowedFields.has(field))) return false;
  if (input.nextSource.id !== input.source.id
    || input.nextSource.linkedCareerStateId !== input.source.linkedCareerStateId
    || input.nextSource.status !== "active"
    || input.nextSource.type !== input.expectedType
    || input.nextSource.accrualPolicy !== input.source.accrualPolicy
    || input.nextSource.factStatus !== "known") return false;
  if (Object.prototype.hasOwnProperty.call(input.nextSource, "accrualReviewStatus")
    && input.nextSource.accrualReviewStatus !== "normal") return false;
  if (Object.prototype.hasOwnProperty.call(input.nextSource, "evidence")
    && !Array.isArray(input.nextSource.evidence)) return false;
  return LEGACY_INCOME_RECONFIRMATION_IMMUTABLE_FIELDS.every((field) => (
    !Object.prototype.hasOwnProperty.call(input.nextSource, field)
    || Object.is(input.nextSource[field], input.source[field])
  ));
}

function canonicalLegacyIncomeReconfirmationSource(input: {
  source: FinancialLedger["incomeSources"][number];
  expectedType: "salary" | "self_employment_draw";
}) {
  return {
    ...structuredClone(input.source),
    type: input.expectedType,
    factStatus: "known" as const,
    accrualReviewStatus: "normal" as const
  };
}

/**
 * The model sometimes provides a complete, same-source migration-income
 * confirmation in Proposal.evidence but accidentally omits that very sentence
 * from the user-visible candidate body.  The normal validator correctly
 * rejects it because evidence is not visible.  This bounded repair reconciles
 * the two fields only when the model has already supplied every financial fact
 * and it exactly repeats the one migration baseline.  It never creates an
 * amount, source, CareerState change or Accepted Event.
 */
export function reconcileLegacyIncomeProposalEvidenceNarrative(input: {
  node: SimulationNode;
  rawNode: unknown;
  ledger?: FinancialLedger;
  currentCareerState: CareerState;
  targetAgeInMonths: number;
  acceptedOutcomeId?: string;
}): { node: SimulationNode; rawNode: unknown; reasonCodes: string[] } {
  if (!input.ledger || !input.acceptedOutcomeId) return { node: input.node, rawNode: input.rawNode, reasonCodes: [] };
  if (![
    "employed",
    "part_time",
    "self_employed"
  ].includes(input.currentCareerState.employmentStatus)) return { node: input.node, rawNode: input.rawNode, reasonCodes: [] };
  if (narrativeRequiresCareerTransition({
    narrativeText: input.node.description,
    currentStatus: input.currentCareerState.employmentStatus
  }) || hasExplicitIncomeInterruption(input.node.description) || hasExplicitPersonalCompensationAmount(input.node.description)) {
    return { node: input.node, rawNode: input.rawNode, reasonCodes: [] };
  }
  const sources = input.ledger.incomeSources.filter((source) => (
    isMigrationOnlyLegacyIncomeSource(source, input.currentCareerState.id)
    && legacyIncomeReconfirmationIsDue({ ledger: input.ledger!, source, targetAgeInMonths: input.targetAgeInMonths })
  ));
  if (sources.length !== 1) return { node: input.node, rawNode: input.rawNode, reasonCodes: [] };
  const source = sources[0]!;
  const proposals = rawFinancialEventProposals(input.rawNode);
  const careerIncomeMutations = proposals.filter((proposal) => (
    ["income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended"].includes(proposal.kind)
  ));
  if (careerIncomeMutations.length !== 1 || careerIncomeMutations[0]?.kind !== "income_source_adjusted") {
    return { node: input.node, rawNode: input.rawNode, reasonCodes: [] };
  }
  const proposal = careerIncomeMutations[0]!;
  const payload = proposal.payload && typeof proposal.payload === "object"
    ? proposal.payload as Record<string, unknown>
    : undefined;
  const nextSource = payload?.nextSource && typeof payload.nextSource === "object"
    ? payload.nextSource as Record<string, unknown>
    : undefined;
  const evidence = proposal.evidence?.trim() || "";
  const evidenceSentences = evidence.split(/(?<=[。！？])/u).map((sentence) => sentence.trim()).filter(Boolean);
  const expectedType: "salary" | "self_employment_draw" = input.currentCareerState.employmentStatus === "self_employed"
    ? "self_employment_draw"
    : "salary";
  const isExactSameSourceAdjustment = nextSource !== undefined
    && isExactLegacyIncomeReconfirmationSource({ source, nextSource, expectedType })
    && payload?.incomeSourceId === source.id
    && proposal.sourceOutcomeId === input.acceptedOutcomeId
    && proposal.financialScope === "personal"
    && Number(proposal.confidence) >= 0.8
    && evidenceSentences.length === 1
    && amountMatchesLegacyIncomeSource({ source, nextSource: nextSource!, evidence });
  if (!isExactSameSourceAdjustment || input.node.description.includes(evidence)) {
    return { node: input.node, rawNode: input.rawNode, reasonCodes: [] };
  }
  const visibleEvidence = /[。！？]$/u.test(evidence) ? evidence : `${evidence}。`;
  const append = (text: string) => `${text.trim()}\n\n${visibleEvidence}`.trim();
  const raw = input.rawNode && typeof input.rawNode === "object"
    ? structuredClone(input.rawNode) as Record<string, unknown>
    : {};
  const canonicalNextSource = canonicalLegacyIncomeReconfirmationSource({ source, expectedType });
  const canonicalRawProposals = Array.isArray(raw.financialEventProposals)
    ? raw.financialEventProposals.map((candidate) => {
      if (!candidate || typeof candidate !== "object") return candidate;
      const candidateRecord = candidate as Record<string, unknown>;
      if (candidateRecord.id !== proposal.id || candidateRecord.kind !== "income_source_adjusted") return candidate;
      const candidatePayload = candidateRecord.payload && typeof candidateRecord.payload === "object"
        ? candidateRecord.payload as Record<string, unknown>
        : {};
      return {
        ...candidateRecord,
        payload: {
          ...candidatePayload,
          incomeSourceId: source.id,
          nextSource: structuredClone(canonicalNextSource)
        }
      };
    })
    : raw.financialEventProposals;
  const rawDescription = typeof raw.description === "string" && raw.description.trim()
    ? raw.description
    : input.node.description;
  const description = append(input.node.description);
  return {
    node: {
      ...input.node,
      description,
      descriptionParagraphs: splitNarrativeParagraphs(description)
    },
    rawNode: {
      ...raw,
      financialEventProposals: canonicalRawProposals,
      description: append(rawDescription),
      descriptionParagraphs: splitNarrativeParagraphs(append(rawDescription))
    },
    reasonCodes: [LEGACY_INCOME_EVIDENCE_NARRATIVE_REPAIR]
  };
}

function normalizeFinancialNarrativeClaims(input: {
  rawNode: any;
  proposals: FinancialEventProposal[];
  narrativeText: string;
}): { claims: FinancialNarrativeClaim[]; invalidCount: number } {
  const proposalsById = new Map(input.proposals.map((proposal) => [proposal.id, proposal]));
  const claims = new Map<string, FinancialNarrativeClaim>();
  let invalidCount = 0;
  const rawClaims = Array.isArray(input.rawNode?.financialNarrativeClaims)
    ? input.rawNode.financialNarrativeClaims
    : [];
  for (const rawClaim of rawClaims) {
    const proposal = proposalsById.get(String(rawClaim?.proposalId || ""));
    const surfaceText = String(rawClaim?.surfaceText || "").trim();
    const id = String(rawClaim?.id || "").trim();
    if (!proposal || !id || claims.has(id) || rawClaim?.kind !== proposal.kind || !surfaceText || !input.narrativeText.includes(surfaceText)) {
      invalidCount += 1;
      continue;
    }
    claims.set(id, { id, proposalId: proposal.id, kind: proposal.kind, surfaceText });
  }
  // Proposal evidence is already required to be a verbatim narrative excerpt.
  // Always bind it as the minimum claim even when an older model omits the new
  // array, so rollout is safe and repaired Proposals retain their authority.
  for (const proposal of input.proposals) {
    const surfaceText = proposal.evidence?.trim();
    if (!surfaceText || !input.narrativeText.includes(surfaceText)) continue;
    const id = `proposal_evidence_${proposal.id}`;
    if (![...claims.values()].some((claim) => claim.proposalId === proposal.id && claim.surfaceText === surfaceText)) {
      claims.set(id, { id, proposalId: proposal.id, kind: proposal.kind, surfaceText });
    }
  }
  return { claims: [...claims.values()], invalidCount };
}

function acceptedEventCoversRejectedProposal(input: {
  proposal: FinancialEventProposal;
  claims: FinancialNarrativeClaim[];
  acceptedEvents: AcceptedFinancialEvent[];
}): boolean {
  const equityKinds = new Set<FinancialEventKind>([
    "business_holding_started",
    "business_option_granted",
    "business_option_vested"
  ]);
  const compatibleKind = (acceptedKind: FinancialEventKind) => (
    acceptedKind === input.proposal.kind
    || (equityKinds.has(acceptedKind) && equityKinds.has(input.proposal.kind))
  );
  const proposalTexts = [
    input.proposal.evidence,
    ...input.claims
      .filter((claim) => claim.proposalId === input.proposal.id)
      .map((claim) => claim.surfaceText)
  ].map((text) => text.trim()).filter(Boolean);
  return input.acceptedEvents.some((event) => (
    compatibleKind(event.kind)
    && event.evidence.some((item) => proposalTexts.some((text) => (
      matchesNormalizedEvidence(item.excerpt, text)
      && matchesNormalizedEvidence(text, item.excerpt)
    )))
  ));
}

export function extractMisplacedEmploymentTransition(rawNode: any): EmploymentTransitionProposal | undefined {
  const candidate = rawFinancialEventProposals(rawNode).find((proposal) => (
    ["employment_transition", "career_state"].includes(String(proposal.kind))
  )) as unknown as Record<string, any> | undefined;
  if (!candidate) return undefined;
  const payload = candidate.payload && typeof candidate.payload === "object" ? candidate.payload : {};
  const source = payload.employmentTransition && typeof payload.employmentTransition === "object"
    ? payload.employmentTransition
    : payload;
  return {
    ...source,
    subject: source.subject || "protagonist",
    effectiveAtAgeInMonths: source.effectiveAtAgeInMonths ?? candidate.effectiveAtAgeInMonths,
    sourceOutcomeId: source.sourceOutcomeId || candidate.sourceOutcomeId,
    evidence: source.evidence || candidate.evidence,
    confidence: source.confidence ?? candidate.confidence
  } as EmploymentTransitionProposal;
}

/**
 * Career authority treats founding/ownership as self-employment.  The
 * protagonist marker is intentional: a sentence about a company's founder
 * inviting the protagonist to a normal role must remain an employer fact.
 */
type SelfDirectedVentureEvidenceContext = "selected_decision" | "narrative";

function hasExplicitSelfDirectedVentureEvidence(
  value: string,
  context: SelfDirectedVentureEvidenceContext
): boolean {
  return value.split(/(?<=[。！？；])/u).some((sentence) => (
    /(?:你|本人|你们)[^。；]{0,32}(?:作为|成为|担任|是)[^。；]{0,12}(?:联合创始人|创始人)(?=(?:兼|、|，|,|和|与|及|职位|岗位|角色|身份|负责|主导|领导|[。；！？]|$))/u.test(sentence)
    || /(?:你|本人|你们)[^。；]{0,32}(?:作为|成为|担任|是)[^。；]{0,12}合伙人(?=(?:兼|、|，|,|和|与|及|职位|岗位|角色|身份|负责|主导|领导|[。；！？]|$))(?=[^。；]{0,24}(?:股权|持股|共同创办|自己创办|自主创办|独立创办|创业所有权))/u.test(sentence)
    || /(?:你|本人|你们)[^。；]{0,32}(?:共同|自己|自主|独立)(?:创办|成立|创建)[^。；]{0,32}(?:公司|企业|工作室|团队)/u.test(sentence)
    || /(?:你|本人|你们)[^。；]{0,24}(?:加入|进入)[^。；]{0,16}(?:自己|本人)[^。；]{0,16}(?:创办|成立|创建)[^。；]{0,32}(?:公司|企业|工作室|团队)/u.test(sentence)
    || (context === "selected_decision"
      && /(?:接受|选择|决定|同意)[^。；]{0,40}(?:联合创始人|创始人)(?=(?:兼|、|，|,|和|与|及|职位|岗位|角色|身份|$))/u.test(sentence))
    || (context === "selected_decision"
      && /(?:^|(?:选择|决定|接受)[^。；]{0,16})(?:共同|自己|自主|独立)(?:创办|成立|创建)[^。；]{0,32}(?:公司|企业|工作室|团队)/u.test(sentence))
  ));
}

function isAcceptedEmployerRoleInvitation(
  value: string,
  context: SelfDirectedVentureEvidenceContext = "selected_decision"
): boolean {
  return /(?:接受|选择)[^。；]{0,40}(?:offer|职位|岗位|工作|入职|任职|担任|负责人)/iu.test(value)
    && !/(?:外部董事|独立董事|外部顾问|兼职顾问|非执行董事|外部合伙人)/u.test(value)
    && !hasExplicitSelfDirectedVentureEvidence(value, context);
}

/**
 * A selected external role can resolve a bare offer only after the outcome
 * records that the protagonist actually joined its employer.  Keep this
 * coupled to the selected role: “加入公司” alone can also describe founding
 * or joining a project, whereas an accepted product-role invitation plus a
 * completed company join is an employed CareerState fact.
 */
function hasCompletedAcceptedEmployerRoleStart(input: {
  selectedDecision?: string;
  narrativeText: string;
}): boolean {
  if (!isAcceptedEmployerRoleInvitation(input.selectedDecision || "")
    || hasExplicitSelfDirectedVentureEvidence(input.narrativeText, "narrative")) return false;
  return input.narrativeText.split(/(?<=[。！？；])/u).some((sentence) => {
    if (/(?:下(?:个)?月|下周|明天|未来|将于|将在|计划|准备|拟|预计|等待|确认|安排|尚未|还未|若|如果|一旦)[^。；]{0,32}加入[^。；]{0,24}(?:公司|企业|机构|团队)/u.test(sentence)) return false;
    return hasCompletedEmployerStartEvidence(sentence)
      || /(?:你|本人)[^。；]{0,36}(?:正式|已经|已(?:经)?)?加入(?:了)?[^。；]{0,24}(?:公司|企业|机构|团队)/u.test(sentence);
  });
}

/**
 * An accepted offer and an actual first day are distinct facts.  We only
 * switch CareerState once the selected outcome or its narrative says that the
 * protagonist actually started the role.  This deliberately excludes bare
 * “接受 offer” language so it cannot manufacture a salary lifecycle.
 */
function isResolutionBoundToCurrentPendingOffer(input: {
  current?: PendingEmployerOfferState;
  acceptedOutcomeId?: string;
  resolution?: PendingEmployerOfferResolution;
}): boolean {
  return Boolean(
    input.current
    && input.resolution
    && input.resolution.pendingOfferSourceOutcomeId === input.current.sourceOutcomeId
    && input.resolution.sourceOutcomeId === input.acceptedOutcomeId
  );
}

function startsCurrentPendingEmployerOffer(input: {
  current?: PendingEmployerOfferState;
  acceptedOutcomeId?: string;
  resolution?: PendingEmployerOfferResolution;
  acceptedCareerTransitions: Array<Pick<AcceptedCareerTransition, "fromCareerStateId" | "nextCareerState">>;
}): boolean {
  return isResolutionBoundToCurrentPendingOffer(input)
    && input.resolution?.action === "started"
    && input.acceptedCareerTransitions.some((transition) => (
      transition.fromCareerStateId === input.current?.fromCareerStateId
      && transition.nextCareerState.employmentStatus === "employed"
    ));
}

/**
 * A repair may supply the missing CareerTransition after the initial proposal
 * pass. Keep this invariant independent from that pass so a repaired start
 * cannot commit while leaving the original pending offer behind.
 */
function pendingEmployerOfferStartResolutionIssue(input: {
  current?: PendingEmployerOfferState;
  acceptedOutcomeId?: string;
  resolution?: PendingEmployerOfferResolution;
  acceptedCareerTransitions: Array<Pick<AcceptedCareerTransition, "fromCareerStateId" | "nextCareerState">>;
  transactionId: string;
  ageInMonths: number;
}): FinancialLedgerIssue | undefined {
  const startsFromPendingCareer = input.acceptedCareerTransitions.some((transition) => (
    transition.fromCareerStateId === input.current?.fromCareerStateId
    && transition.nextCareerState.employmentStatus === "employed"
  ));
  if (!input.current || !startsFromPendingCareer || startsCurrentPendingEmployerOffer(input)) return undefined;
  return {
    id: `pending_employer_offer_start_resolution_missing_${input.transactionId}`,
    code: "CAREER_INCOME_CONFLICT",
    severity: "blocking",
    status: "open",
    relatedProposalIds: [],
    summary: "已接受的待入职 offer 只有在同一 outcome 以 started resolution 绑定实际入职和职业收入原子提交后才能清除",
    createdAtAgeInMonths: input.ageInMonths
  };
}

export type PendingEmployerOfferUpdate =
  | { action: "preserve" }
  | { action: "clear" }
  | { action: "set"; offer: PendingEmployerOfferState };

/**
 * Persist the user-authorized acceptance of an employer offer without
 * pretending it is an employment or income event.  A later completed
 * transition clears it atomically with the career/income write.
 */
export function resolvePendingEmployerOffer(input: {
  current?: PendingEmployerOfferState;
  selectedDecision?: string;
  acceptedOutcomeId?: string;
  narrativeText: string;
  acceptedAtAgeInMonths: number;
  currentCareerStateId: string;
  pendingEmployerOfferResolution?: PendingEmployerOfferResolution;
  acceptedCareerTransitions: Array<Pick<AcceptedCareerTransition, "fromCareerStateId" | "nextCareerState">>;
}): PendingEmployerOfferUpdate {
  const decision = input.selectedDecision?.trim() || "";
  const evidence = [decision, input.narrativeText].filter(Boolean).join("\n");
  const startsExistingOffer = startsCurrentPendingEmployerOffer({
    current: input.current,
    acceptedOutcomeId: input.acceptedOutcomeId,
    resolution: input.pendingEmployerOfferResolution,
    acceptedCareerTransitions: input.acceptedCareerTransitions
  });
  const withdrawsExistingOffer = isResolutionBoundToCurrentPendingOffer({
    current: input.current,
    acceptedOutcomeId: input.acceptedOutcomeId,
    resolution: input.pendingEmployerOfferResolution
  }) && input.pendingEmployerOfferResolution?.action === "withdrawn";
  if (startsExistingOffer || withdrawsExistingOffer) {
    return input.current ? { action: "clear" } : { action: "preserve" };
  }
  // A singular pending state must never be silently overwritten by another
  // bare offer.  The next accepted outcome must either start a job atomically
  // or submit a source-bound withdrawal before another offer can take its
  // place.
  if (input.current) return { action: "preserve" };
  if (!input.acceptedOutcomeId || !isAcceptedEmployerRoleInvitation(decision) || hasCompletedEmployerStartEvidence(evidence)) {
    return { action: "preserve" };
  }
  return {
    action: "set",
    offer: {
      status: "accepted_pending_start",
      sourceOutcomeId: input.acceptedOutcomeId,
      acceptedAtAgeInMonths: input.acceptedAtAgeInMonths,
      fromCareerStateId: input.currentCareerStateId,
      decision,
      evidence: decision
    }
  };
}

function applyPendingEmployerOfferUpdate(
  worldState: WorldStateSnapshot,
  update: PendingEmployerOfferUpdate
): WorldStateSnapshot {
  if (update.action === "preserve") return worldState;
  if (update.action === "clear") {
    const { pendingEmployerOffer: _ignored, ...withoutPendingOffer } = worldState;
    return withoutPendingOffer;
  }
  return { ...worldState, pendingEmployerOffer: update.offer };
}

function isEmployerSalaryMutationProposal(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
}): boolean {
  const payload = input.proposal.payload as Record<string, any>;
  const activeCareerIncomeIds = new Set(input.ledger.incomeSources
    .filter((source) => source.status === "active"
      && source.linkedCareerStateId
      && (source.type === "salary" || source.type === "other"))
    .map((source) => source.id));
  if (input.proposal.kind === "income_source_started") {
    const source = payload?.incomeSource ?? payload;
    return source?.type === "salary"
      || (Boolean(source?.linkedCareerStateId) && source?.type !== "contract");
  }
  if (input.proposal.kind === "income_source_adjusted") {
    return payload?.nextSource?.type === "salary"
      || (Boolean(payload?.nextSource?.linkedCareerStateId) && payload?.nextSource?.type !== "contract")
      || activeCareerIncomeIds.has(payload?.incomeSourceId);
  }
  if (input.proposal.kind === "income_source_ended" || input.proposal.kind === "income_source_paused") {
    return activeCareerIncomeIds.has(payload?.incomeSourceId);
  }
  return false;
}

/**
 * A retirement plan is not a retirement event.  Selected-decision fallback
 * may close an active career only when the choice says that retirement itself
 * is happening, not when it merely mentions retirement savings or planning.
 */
export function selectedDecisionExplicitlyRetires(decision: string): boolean {
  return /(?:办理退休(?:手续)?|正式退休|已经退休|已退休|(?:选择|决定)(?:了)?(?:正式|提前)?退休|提前退休|退休(?:了)?)(?=[，。；！？\s]|$)/u.test(decision.trim());
}

/**
 * A selected choice can authorize a career transition, but preparatory work
 * toward a possible move cannot.  In particular, updating a resume, speaking
 * with recruiters, or "准备换工作" must preserve the current CareerState and
 * income until the choice or resulting narrative records a completed move.
 */
export function selectedDecisionRequiresCareerTransition(decision: string): boolean {
  const normalized = decision.trim();
  if (!normalized) return false;
  if (selectedDecisionExplicitlyRetires(normalized)) return true;
  const transition = /转为.{0,12}顾问|结束.{0,12}全职|离职|辞职|换工作|跳槽|开始.{0,8}创业|全职.{0,8}创业/iu;
  if (!transition.test(normalized)) return false;
  const preparatory = /(?:考虑|计划|准备|打算|可能|如果|若|接触[^。；]{0,12}(?:机会|猎头|公司)|寻找[^。；]{0,12}(?:机会|岗位|工作)|物色[^。；]{0,12}(?:机会|岗位|工作)|投递[^。；]{0,12}(?:简历|岗位)|更新[^。；]{0,8}简历)[^。；]{0,40}(?:转为.{0,12}顾问|结束.{0,12}全职|离职|辞职|换工作|跳槽|开始.{0,8}创业|全职.{0,8}创业)/iu.test(normalized);
  const explicitlyDefers = /(?:先不|暂不|暂时不|不急着|不打算|没有[^。；]{0,8}打算|不考虑)[^。；]{0,20}(?:转为.{0,12}顾问|结束.{0,12}全职|离职|辞职|换工作|跳槽|开始.{0,8}创业|全职.{0,8}创业)/iu.test(normalized);
  const explicitlyCompleted = /(?:正式|已经|已(?:经)?|最终决定|当场|立即|直接|办理)(?:了)?[^。；]{0,12}(?:转为.{0,12}顾问|结束.{0,12}全职|离职|辞职|换工作|跳槽|开始.{0,8}创业|全职.{0,8}创业)/iu.test(normalized)
    || /^(?:转为.{0,12}顾问|结束.{0,12}全职|离职|辞职|换工作|跳槽|开始.{0,8}创业|全职.{0,8}创业)/iu.test(normalized);
  return explicitlyCompleted || (!preparatory && !explicitlyDefers);
}

export function synthesizeSelectedCareerTransition(input: {
  selectedDecision?: string;
  narrativeText: string;
  acceptedOutcomeId?: string;
  effectiveAtAgeInMonths: number;
  currentStatus?: CareerState["employmentStatus"];
}): EmploymentTransitionProposal | undefined {
  if (!input.acceptedOutcomeId || !input.selectedDecision) return undefined;
  const decision = input.selectedDecision;
  // "创业公司" is an employer, not evidence that the protagonist became a
  // founder.  Keep that distinction explicit: leaving one job to join a
  // startup must create an employed CareerState, while an explicit founder or
  // self-directed venture remains self_employed.
  const selfDirectedVenture = /(?:自己|自主|独立|全职|(?:辞职|辞去|辞掉|离职)[^。；]{0,12})创业(?!公司|企业|团队)|(?:创办|成立).{0,12}(?:自己|个人|独立)?(?:公司|工作室|企业|团队)/u;
  const joinedEmployer = /(?:辞职|辞去|辞掉|离职|离开[^。；]{0,12}(?:岗位|公司|平台))[^。；]{0,48}(?:正式)?加入[^。；]{0,20}(?:公司|企业|机构|团队)|(?:正式)?加入[^。；]{0,20}(?:公司|企业|机构|团队)[^。；]{0,20}(?:担任|任职|负责|岗位|职位|工作)/u;
  const narrativeSentences = input.narrativeText.split(/(?<=[。！？；])/u).map((item) => item.trim());
  const narrativeEvidence = narrativeSentences.find((sentence) => (
    /(?:你|主角|本人).{0,50}(?:辞职|辞去|辞掉|离职|离开.{0,10}(?:岗位|公司|平台)|正式退休|停止工作|开始创业|全职投入.{0,12}创业|回归职场|重返职场|正式入职|接受了?.{0,20}(?:offer|工作|职位|岗位)|获得了?.{0,20}(?:offer|工作|职位|岗位)|转岗|转任|转为.{0,12}顾问|顾问角色|被任命|晋升|提升为|成为.{0,12}(?:负责人|联合创始人|创始人|合伙人)|(?:共同|自己|自主|独立)(?:创办|成立|创建))/iu.test(sentence)
  ));
  const explicitSelfDirectedNarrativeEvidence = narrativeSentences.find((sentence) => (
    hasExplicitSelfDirectedVentureEvidence(sentence, "narrative")
  ));
  const completedEmployerNarrativeEvidence = narrativeSentences.find((sentence) => (
    hasCompletedEmployerStartEvidence(sentence)
  ));
  const completedAcceptedEmployerRoleStart = hasCompletedAcceptedEmployerRoleStart({
    selectedDecision: decision,
    narrativeText: input.narrativeText
  });
  const explicitSelfDirectedVenture = hasExplicitSelfDirectedVentureEvidence(decision, "selected_decision")
    || hasExplicitSelfDirectedVentureEvidence(input.narrativeText, "narrative");
  const joinsEmployer = !explicitSelfDirectedVenture && (
    hasCompletedEmployerStartEvidence(decision)
    || joinedEmployer.test(decision)
    || completedAcceptedEmployerRoleStart
    || Boolean(completedEmployerNarrativeEvidence && (hasCompletedEmployerStartEvidence(completedEmployerNarrativeEvidence) || joinedEmployer.test(completedEmployerNarrativeEvidence)))
  );
  const startsSelfDirectedVenture = explicitSelfDirectedVenture
    || selfDirectedVenture.test(decision)
    || Boolean(narrativeEvidence && selfDirectedVenture.test(narrativeEvidence));
  let toStatus: EmploymentTransitionProposal["toStatus"] | undefined;
  if (joinsEmployer) toStatus = "employed";
  else if (startsSelfDirectedVenture) toStatus = "self_employed";
  else if (selectedDecisionExplicitlyRetires(decision)) toStatus = "retired";
  else if (/停止工作|不再工作/u.test(decision)) toStatus = "not_working";
  else if (narrativeEvidence
    && hasCompletedEmployerStartEvidence(narrativeEvidence)) {
    // The accepted choice may describe the attempt (for example, “争取实习
    // 转正”) while the generated outcome records the completed hire. Once the
    // same accepted outcome says the protagonist formally started work, the
    // CareerState must commit instead of leaving a working adult as student.
    toStatus = "employed";
  }
  else if (narrativeEvidence
    && /转为.{0,12}顾问|顾问角色/u.test(narrativeEvidence)
    && !/保留.{0,16}(?:原工作|大公司工作|全职工作)|继续.{0,16}(?:双线|业余|兼职)/u.test(decision)) {
    toStatus = "self_employed";
  }
  else if (narrativeEvidence
    && /被任命|晋升|提升为|成为.{0,12}负责人/u.test(narrativeEvidence)
    && input.currentStatus
    && ["student", "not_working", "retired", "medical_leave"].includes(input.currentStatus)) {
    // A completed employed role is stronger authority than a stale compatibility
    // status. This closes the student-at-mid-career gap even when the selected
    // choice described skill growth rather than the eventual promotion itself.
    toStatus = "employed";
  }
  if (!toStatus) return undefined;
  // The accepted choice is itself authoritative action evidence. Narrative text
  // may use a synonym such as "递交辞呈", so a prose regex miss must not leave
  // CareerState behind the accepted branch.
  const evidence = toStatus === "self_employed"
    ? explicitSelfDirectedNarrativeEvidence || narrativeEvidence || decision.trim()
    : (completedEmployerNarrativeEvidence
      || (completedAcceptedEmployerRoleStart
        ? narrativeSentences.find((sentence) => /(?:你|本人)[^。；]{0,36}(?:正式|已经|已(?:经)?)?加入(?:了)?[^。；]{0,24}(?:公司|企业|机构|团队)/u.test(sentence))
        : undefined)
      || narrativeEvidence
      || decision.trim());
  return {
    subject: "protagonist",
    toStatus,
    effectiveAtAgeInMonths: input.effectiveAtAgeInMonths,
    sourceOutcomeId: input.acceptedOutcomeId,
    evidence,
    confidence: 1
  } as EmploymentTransitionProposal;
}

function rejectedProposalClaimsCompletedFact(proposal: FinancialEventProposal): boolean {
  const evidence = proposal.evidence?.trim() || "";
  if (!evidence) return false;
  const completed = /已经|已(?:经)?(?:到账|支付|缴纳|买入|买下|卖出|偿还|还清|重组|减免|签署|完成)|到账|放款|获批|拿到|获得|收到|(?:垫付|支付|缴纳)(?:了)?|投入了|购买了|卖掉了|偿还了|结清/u.test(evidence);
  const onlyPending = /计划|打算|考虑|准备|尝试|申请中|审批中|协商中|尚未|还未|未能|没有到账|等待/u.test(evidence)
    && !completed;
  return completed && !onlyPending;
}

export function isCompanyOperatingNarrativeProposal(proposal: FinancialEventProposal): boolean {
  // Some model responses still duplicate an employment transition inside the
  // financial array. The financial validator rejects it, but the separately
  // accepted CareerState transition keeps the prose authoritative.
  if (["career_state", "employment_transition"].includes(proposal.kind as string)) return true;
  if (proposal.financialScope === "business_operating") return true;
  if (!["income_source_started", "income_source_adjusted", "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "one_off_expense_paid"].includes(proposal.kind)) return false;
  const evidence = proposal.evidence?.trim() || "";
  const companyFact = /公司|客户|合同额|营业收入|团队|员工|服务器|办公室|企业账户|预付款/u.test(evidence);
  const personalReceipt = /你的?个人|主角个人|个人账户|你开始领取|你每月提取|你实际领取|你获得分红/u.test(evidence);
  return companyFact && !personalReceipt;
}

export function validateSelectedDecisionConsistency(selectedDecision: string, narrativeText: string): string[] {
  const decision = selectedDecision.trim();
  const narrative = narrativeText.trim();
  if (!decision || !narrative) return [];
  const issues: string[] = [];
  const selectedBorrowing = /贷款|借款|经营贷|授信/u.test(decision) && /申请|借|使用|支用/u.test(decision);
  const protagonistVoluntarilyDeclinedBorrowing = /(?:你|主角).{0,12}(?:拒绝|放弃|没有申请|未申请).{0,10}(?:贷款|借款|经营贷|授信)/u.test(narrative);
  if (selectedBorrowing && protagonistVoluntarilyDeclinedBorrowing) {
    issues.push("用户已选择申请或使用借款，正文却改写成主角主动拒绝或未申请借款");
  }
  const selectedResignation = /辞职|离职|全职.{0,8}创业/u.test(decision);
  const protagonistKeptSameJob = /(?:你|主角).{0,12}(?:保留|继续|没有离开|未离开).{0,10}(?:原工作|全职工作|原岗位|公司工作)/u.test(narrative);
  if (selectedResignation && protagonistKeptSameJob) {
    issues.push("用户已选择辞职或离职，正文却改写成主角保留原工作");
  }
  const selectedKeepsCurrentJob = /保留.{0,16}(?:原工作|大公司工作|全职工作|现有工作)|继续.{0,16}(?:双线|业余时间|兼职)|暂不.{0,12}(?:辞职|离职)|拒绝.{0,16}(?:全职|投资).{0,16}(?:保留|继续)/u.test(decision);
  const protagonistLeftCurrentJob = /(?:你|主角).{0,20}(?:提交了?辞职申请|递交了?辞呈|正式辞职|已经辞职|辞去|离职|离开原岗位|正式成为.{0,16}全职)/u.test(narrative);
  if (selectedKeepsCurrentJob && protagonistLeftCurrentJob) {
    issues.push("用户已选择保留当前工作或继续业余投入，正文却改写成主角辞职或全职转入另一条路线");
  }
  return issues;
}

export function detectNarrativeFinancialCoverageIssues(input: {
  narrativeText: string;
  ledger: FinancialLedger;
  acceptedEvents: Array<{ kind: string; payload?: unknown }>;
  ageInMonths: number;
  /**
   * When prose explicitly opens at this age, a later "上个月" before the
   * next explicit age marker is a late-arriving fact from before this
   * transaction.  A normal current-period one-off event must not be used to
   * rewrite that history at the period end.
   */
  periodStartAgeInMonths?: number;
}): FinancialLedgerIssue[] {
  const issues: FinancialLedgerIssue[] = [];
  const hasKind = (...kinds: string[]) => input.acceptedEvents.some((event) => kinds.includes(event.kind));
  const push = (id: string, summary: string, relatedIncomeSourceIds: string[] = []) => issues.push({
    id: `narrative_coverage_${id}_${input.ageInMonths}`,
    code: "PENDING_FACT",
    severity: "blocking",
    status: "open",
    relatedProposalIds: [],
    relatedIncomeSourceIds,
    summary,
    createdAtAgeInMonths: input.ageInMonths
  });
  const narrativeSentences = input.narrativeText.split(/(?<=[。！？；])/u);
  const protagonistSentences = narrativeSentences
    .filter((sentence) => /你|你的|你们|我|我们|本人|自己|名下/u.test(sentence))
    .filter((sentence) => !/(?:母亲|父亲|妈妈|爸爸|表哥|表姐|堂哥|堂姐|朋友|同事|伴侣|丈夫|妻子)[^，。；]{0,24}(?:房贷|按揭)/u.test(sentence)
      || /(?:你|我)(?:本人)?[^，。；]{0,24}(?:房贷|按揭)|(?:(?:你的|你名下|我的|我名下))[^，。；]{0,24}(?:房产|住房|房子|公寓)/u.test(sentence));
  const protagonistPropertyText = protagonistSentences.join(" ");
  // A completed purchase is sometimes narrated across sentences: the prose
  // first gives a concrete home/first-payment context, then says \"签合同那天\".
  // Require that context in the same or two preceding protagonist sentences,
  // and reject a rental contract explicitly, so a future home plan plus a
  // present lease cannot become a false-positive property purchase.
  const completedHomeContractFact = protagonistSentences.some((sentence, index) => {
    const completedContract = /(?:签(?:了|订了)?(?:购房|房屋买卖|买房)?合同|签订(?:了)?(?:购房|房屋买卖|买房)合同|签合同那天|完成网签|办理(?:了)?房贷)/u.test(sentence);
    if (!completedContract || /(?:租房|租约|租赁)/u.test(sentence)) return false;
    const nearbyHomeContext = protagonistSentences.slice(Math.max(0, index - 2), index + 1).join(" ");
    if (/(?:租房|租约|租赁|续租|房东|房客)/u.test(nearbyHomeContext)) return false;
    return /(?:购房|买房|婚房|首付|房贷|按揭)/u.test(nearbyHomeContext);
  });
  // Real prose commonly says "我们决定把那套小户型买下来。首付用掉积蓄，贷款
  // 发放并开始月供".  The property noun precedes the completed verb and the
  // settlement details land in the next sentence, so the older one-direction
  // regex silently let an unrecorded purchase into history.
  const completedHomePurchaseFact = protagonistSentences.some((sentence) => {
    const hasProtagonist = /你|你们|我|我们|本人|自己|名下/u.test(sentence);
    const hasHome = /(?:房产|住房|房子|公寓|小户型|房屋|婚房)/u.test(sentence);
    const purchase = /(?:买下(?:来)?|购入|购买(?:了)?|成交|交割|取得(?:了)?房本)/u.test(sentence);
    const explicitFuture = /(?:计划|打算|考虑|准备|预计|希望|将来|以后|明年)[^。！？；]{0,24}(?:买下|购入|购买|成交)/u.test(sentence);
    const sentenceIndex = narrativeSentences.indexOf(sentence);
    const settlementWindow = narrativeSentences.slice(Math.max(0, sentenceIndex), sentenceIndex + 3).join(" ");
    const settled = /(?:首付)[^。！？；]{0,24}(?:付了|支付了|交了|用掉|拿出)|(?:贷款|房贷|按揭)[^。！？；]{0,24}(?:发放|放款|开始月供|月供)|搬进(?:了)?新家|入住(?:了)?新家/u.test(settlementWindow);
    return hasProtagonist && hasHome && purchase && (!explicitFuture || settled);
  });
  const hasCompletedPropertyFact = /(?:买下|购入|购买了|名下已有|自有|拥有)(?:[^。；]{0,20})(?:房产|住房|房子|公寓)|(?:你|你们|我|我们)[^。；]{0,48}(?:付了|支付了|交了|拿出)[^。；]{0,16}(?:婚房|住房|房子|公寓)?首付/u.test(protagonistPropertyText)
    || completedHomePurchaseFact
    || completedHomeContractFact;
  const hasCompletedMortgageFact = /(?:还完|偿还|还清|背上|尚有|剩余)[^。；]{0,12}(?:房贷|按揭)|(?:房贷|按揭)[^。；]{0,12}(?:月供|本金|余额)/u.test(protagonistPropertyText)
    || (completedHomePurchaseFact && narrativeSentences.some((sentence) => /(?:贷款|房贷|按揭)[^。！？；]{0,24}(?:发放|放款|开始月供|月供)|开始月供/u.test(sentence)));
  if (hasCompletedPropertyFact
    && !input.ledger.assetAccounts.some((item) => item.status === "active" && item.type === "property")
    && !hasKind("asset_purchased", "asset_balance_discovered")) {
    push("property", "正文包含已发生的主人公房产事实，但没有房产资产 Proposal");
  }
  if (hasCompletedMortgageFact
    && !input.ledger.debtAccounts.some((item) => item.status === "active" && item.type === "mortgage")
    && !hasKind("debt_drawn", "debt_balance_discovered")) {
    push("mortgage", "正文包含已发生的主人公房贷事实，但没有房贷债务 Proposal");
  }
  const hasHolding = input.ledger.businessHoldings.some((item) => item.status === "active" || item.status === "partially_sold");
  const hasProtagonistOptionFact = input.narrativeText.split(/(?<=[。！？；])/u).some((sentence) => {
    const optionReference = /(?:你(?:获得|获授|被授予|持有|拥有|行使|行权)[^。；]{0,24}期权|(?:授予|发放)[^。；]{0,12}(?:给)?你[^。；]{0,12}期权|你的[^。；]{0,16}期权)/u.test(sentence);
    if (!optionReference) return false;
    const conditionalOnly = /尚未|还未|未正式|没有设立|口头承诺|未来|如果|若|计划|考虑|优先考虑|意向|争取|需要[^。；]{0,24}(?:达标|满足)[^。；]{0,12}(?:才|后)|达标后[^。；]{0,12}(?:才|方可)|才能兑现|等待[^。；]{0,16}兑现/u.test(sentence);
    const completedGrant = /你(?:已经|已|正式)?(?:获得|获授|被授予|持有|拥有|行使|行权)(?:了)?[^。；]{0,24}期权|(?:正式)?(?:授予|发放)[^。；]{0,12}(?:给)?你/u.test(sentence);
    return !conditionalOnly || completedGrant;
  });
  const hasProtagonistEquityFact = /(?:你(?:持有|拥有|获得|接受)[^。；]{0,20}(?:股权|股份|持股|干股)|(?:股权|持股)结构[^。；]{0,32}你占\s*\d|你(?:成为|是|作为)[^。；]{0,12}(?:联合创始人|合伙人)|你的(?:创始人股权|干股))/u.test(input.narrativeText);
  if ((hasProtagonistOptionFact || hasProtagonistEquityFact)
    && !hasHolding
    && !hasKind("business_holding_started", "business_option_granted")) {
    push("business_holding", "正文包含已发生的主人公股权或期权事实，但没有企业权益 Proposal");
  }
  if (hasProtagonistOptionFact
    && !input.ledger.businessHoldings.some((item) => item.instrumentType === "stock_option" && (item.status === "active" || item.status === "partially_sold"))
    && !hasKind("business_option_granted")) {
    push("personal_option", "正文包含已发生的主人公期权事实，但没有 stock_option holding Proposal");
  }
  const personalCompensationAnnuals = input.narrativeText.split(/(?<=[。！？；])/u).flatMap((sentence) => {
    if (!/你|你的|本人|自己/u.test(sentence)) return [];
    const candidateCompensation = /猎头|邀请|邀约|推荐|提出|offer|如果|可以给你|考虑|是否|至少|预计|建议|希望/iu.test(sentence);
    const hypotheticalMoveCompensation = /(?:这意味着|如果|若)[^。；]{0,60}(?:辞掉|辞去|离开|去|加入|转到)[^。；]{0,40}(?:月薪|年薪)/u.test(sentence);
    const completedCompensation = /正式(?:加入|入职|受聘)|决定接受|接受了|签下|转为[^。；]{0,20}(?:顾问|兼职|全职)|月薪(?:降至|调整为|维持)|薪资调整为|工资调整为|给自己/u.test(sentence);
    const historicalCompensation = /(?:以前|曾经|当年|过去|原先|原来|上一份|此前)[^。；]{0,24}(?:月薪|年薪|工资|薪资)|(?:辞去|辞掉|离开|放弃|结束)[^。；]{0,24}(?:月薪|年薪|工资|薪资)|(?:月薪|年薪|工资|薪资)[^。；]{0,24}(?:的旧工作|的工作后|已经结束|成为过去)/u.test(sentence);
    if ((candidateCompensation || hypotheticalMoveCompensation) && !completedCompensation) return [];
    if (historicalCompensation && !completedCompensation) return [];
    const personalContext = /(?:你(?:的|本人|个人)?[^。；]{0,45}|给自己[^。；]{0,24})(?:薪资调整为|工资调整为|税后工资|税后月薪|月薪|年薪)|薪资调整为[^。；]{0,18}(?:年薪|月薪)/u.test(sentence);
    if (!personalContext) return [];
    const monthly = [...sentence.matchAll(/(?:税后)?月薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|涨到|约为|为|约)?(?:约)?\s*(\d+(?:\.\d+)?)\s*(万|元)/gu)]
      .filter((match) => !/(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,70}(?:会计|员工|助理|工程师|销售|运营|护工)[^。；]{0,35}$/u.test(sentence.slice(Math.max(0, Number(match.index) - 110), Number(match.index))))
      .map((match) => Math.round(Number(match[1]) * (match[2] === "元" ? 0.0001 : 1) * 12 * 10000) / 10000);
    const annual = [...sentence.matchAll(/(?:税后)?年薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|涨到|约为|为|约)?(?:约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    return [...monthly, ...annual];
  });
  const latestPersonalCompensationAnnual = personalCompensationAnnuals.at(-1);
  if (Number.isFinite(latestPersonalCompensationAnnual)) {
    const activeCareerSources = input.ledger.incomeSources.filter((source) => source.status === "active" && Boolean(source.linkedCareerStateId));
    const eventSources = input.acceptedEvents.flatMap((event) => {
      if (event.kind !== "income_source_started" && event.kind !== "income_source_adjusted") return [];
      const payload = event.payload as Record<string, any> | undefined;
      const source = event.kind === "income_source_adjusted" ? payload?.nextSource : payload;
      return source ? [source] : [];
    });
    const sourceAnnuals = [...activeCareerSources, ...eventSources].map((source) => Number.isFinite(source.annualNetAmountWan)
      ? Number(source.annualNetAmountWan)
      : Number(source.monthlyNetAmountWan || 0) * 12);
    const matches = sourceAnnuals.some((value) => Math.abs(value - Number(latestPersonalCompensationAnnual)) <= Math.max(2, Number(latestPersonalCompensationAnnual) * 0.12));
    if (!matches) push(
      "personal_compensation",
      `正文明确主人公当前个人薪酬约为年化 ${Number(latestPersonalCompensationAnnual).toFixed(2)} 万，但账本没有匹配的职业收入 Proposal`,
      activeCareerSources.map((source) => source.id)
    );
  }

  // A completed, quantified first-person medical/care outlay changes cash. It
  // is not a recurring responsibility and must not be squeezed into
  // `annualCoreExpenseWan`; a current-period fact needs a matching one-off
  // personal cash event. Keep this deliberately narrow so a joint reserve
  // contribution, a property down payment, a company cost, or a plan cannot
  // be mistaken for a medical expense.
  //
  // A special case matters for long nodes: when the narrative itself starts
  // at the period's opening age and says "上个月" before the next age marker,
  // the cash fact predates this transaction. We deliberately cannot repair
  // that by adding a normal current-period `one_off_expense_paid`; the only
  // safe outcomes are a prose rewrite or a future late-cash-correction event.
  const completedPersonalOutlays = narrativeSentences.flatMap((sentence) => {
    const firstPersonPayer = /(?:你(?!们)|我(?!们)|本人|主角)[^。！？；]{0,24}(?:垫付(?:了)?|支付(?:了)?|缴纳(?:了)?|花费(?:了)?|支出(?:了)?|转出(?:了)?|拿出(?:了)?|付了)/u.test(sentence);
    const sharedPayer = /(?:你们|我们|双方|两人)|(?:你|我)[^。！？；]{0,12}(?:和|与|跟)[^。！？；]{0,12}(?:伴侣|配偶|妻子|丈夫|爱人|男友|女友)/u.test(sentence);
    const essentialCare = /(?:住院|急诊|手术|治疗|医疗|医药|护理|照护|父母|母亲|父亲|孩子|子女)/u.test(sentence);
    const excludedScope = /(?:房贷|按揭|首付|购房|买房|房产|公司|企业|客户|团队|员工|工作室|办公室)/u.test(sentence);
    const futureOnly = /(?:计划|打算|准备|考虑|如果|若|将|未来|明年|下月|下个月)[^。！？；]{0,24}(?:垫付|支付|缴纳|花费|支出|转出|拿出|付)/u.test(sentence);
    const amount = [...sentence.matchAll(/(?:垫付(?:了)?|支付(?:了)?|缴纳(?:了)?|花费(?:了)?|支出(?:了)?|转出(?:了)?|拿出(?:了)?|付了)[^。！？；]{0,24}?(\d+(?:\.\d+)?)\s*(万元|万|元)/gu)]
      .find((match) => {
        const start = Number(match.index || 0);
        const localAmountClause = sentence.slice(Math.max(0, start - 16), start + match[0].length);
        return !/(?:每月|每个月|按月)/u.test(localAmountClause);
      });
    if (!firstPersonPayer || sharedPayer || !essentialCare || excludedScope || futureOnly || !amount) return [];
    const numeric = Number(amount[1]);
    if (!Number.isFinite(numeric) || numeric <= 0) return [];
    const amountWan = amount[2].startsWith("万") ? numeric : numeric / 10_000;
    const isLatePrePeriodFact = input.periodStartAgeInMonths !== undefined
      && isNarratedBeforePeriod({
        narrativeText: input.narrativeText,
        evidence: sentence,
        periodStartAgeInMonths: input.periodStartAgeInMonths
      });
    return [{
      sentence,
      amountWan: Math.round(amountWan * 10_000) / 10_000,
      isLatePrePeriodFact
    }];
  });
  const availableAcceptedOutlayAmounts = input.acceptedEvents.flatMap((event) => {
    if (!['one_off_expense_paid', 'family_support_paid'].includes(event.kind)) return [];
    const amountWan = (event.payload as { amountWan?: unknown } | undefined)?.amountWan;
    return typeof amountWan === "number" && Number.isFinite(amountWan) && amountWan > 0 ? [amountWan] : [];
  });
  for (const outlay of completedPersonalOutlays) {
    if (outlay.isLatePrePeriodFact) {
      push(
        "personal_outlay",
        `正文在本期起点前明确主人公已经垫付 ${outlay.amountWan.toFixed(2)} 万元必要个人支出；当前账本没有可追溯的历史现金更正，不能伪造成期末一次性支出`
      );
      continue;
    }
    const matchedIndex = availableAcceptedOutlayAmounts.findIndex((amountWan) => (
      Math.abs(amountWan - outlay.amountWan) <= Math.max(0.01, outlay.amountWan * 0.02)
    ));
    if (matchedIndex >= 0) {
      availableAcceptedOutlayAmounts.splice(matchedIndex, 1);
      continue;
    }
    push(
      "personal_outlay",
      `正文明确主人公已经发生 ${outlay.amountWan.toFixed(2)} 万元必要个人支出，但没有匹配的一次性个人支出 Proposal`
    );
  }
  return issues;
}

const NARRATIVE_FINANCIAL_ISSUE_PREFIXES = [
  "narrative_coverage_",
  "personal_income_claim_without_event_"
] as const;

export function reconcileNarrativeFinancialIssues(input: {
  issues: FinancialLedgerIssue[];
  narrativeText: string;
  ledger: FinancialLedger;
  acceptedEvents: AcceptedFinancialEvent[];
  ageInMonths: number;
  periodStartAgeInMonths?: number;
}): FinancialLedgerIssue[] {
  const authoritativeIssues = [
    ...detectNarrativeFinancialCoverageIssues({
      narrativeText: input.narrativeText,
      ledger: input.ledger,
      acceptedEvents: input.acceptedEvents,
      ageInMonths: input.ageInMonths,
      periodStartAgeInMonths: input.periodStartAgeInMonths
    }),
    ...collectPersonalIncomeNarrativeContractIssues({
      narrativeText: input.narrativeText,
      acceptedFinancialEvents: input.acceptedEvents,
      ageInMonths: input.ageInMonths,
      currentLedger: input.ledger
    })
  ];
  const authoritativeIssueIds = new Set(authoritativeIssues.map((issue) => issue.id));
  const retained = input.issues.flatMap((issue) => {
    const isNarrativeIssue = NARRATIVE_FINANCIAL_ISSUE_PREFIXES.some((prefix) => issue.id.startsWith(prefix));
    if (!isNarrativeIssue) return [issue];
    if (authoritativeIssueIds.has(issue.id)) return [];
    if ((issue.status ?? "open") === "resolved") return [issue];
    return [{
      ...issue,
      status: "resolved" as const,
      resolvedAtAgeInMonths: input.ageInMonths,
      resolvedByEventId: "system:narrative_revalidated"
    }];
  });
  const byId = new Map<string, FinancialLedgerIssue>();
  for (const issue of [...retained, ...authoritativeIssues]) byId.set(issue.id, issue);
  return [...byId.values()];
}

export function stillClaimsRejectedDebtDraw(description: string): boolean {
  return description.split(/(?<=[。！？])/u).some((sentence) => {
    if (/尚未|还未|未能|没有|并未|不再|无需|尚在|仍在(?:申请|审核|审批|协商)/u.test(sentence)) return false;
    return /(?:贷款|借款)[^。！？]{0,36}(?:已(?:经)?(?:获批|放款|到账)|审批通过|完成(?:了)?放款|(?:完成[^。！？]{0,18})?贷款放款|到账|余额|还剩)|(?:拿到|获得|收到)[^。！？]{0,24}(?:贷款|借款)|(?:这笔|该笔|上述)(?:钱|资金|款项)[^。！？]{0,12}(?:到账|到手|入账)(?:后|以后|之后)|(?:资金|款项)[^。！？]{0,12}(?:到账|到手|入账)(?:后|以后|之后)|(?:开始|需要|每月需|每月|正在|扣除)[^。！？]{0,18}(?:月供|还贷|偿还贷款)|(?:本金未还|剩余本金|月供\s*\d)/u.test(sentence);
  });
}

/**
 * A rejected debt-draw narrative must also remove references to the resulting
 * balance or repayment schedule, hence `stillClaimsRejectedDebtDraw` is
 * intentionally broad.  That detector cannot be reused to invent a new draw:
 * "剩余本金" and "月供" are ordinary restatements of an obligation, while
 * missing-event synthesis needs an actual new disbursement instead.
 */
function claimsCompletedNewDebtDisbursement(description: string): boolean {
  return description.split(/(?<=[。！？])/u).some((sentence) => {
    if (/尚未|还未|未能|没有|并未|不再|无需|尚在|仍在(?:申请|审核|审批|协商)|(?:计划|预计|将|会|待|等待)[^。！？]{0,18}(?:放款|到账|入账|到手|借到)/u.test(sentence)) return false;
    // A bare financing receipt belongs to the business domain unless this
    // same sentence assigns it to the protagonist.  Treating "公司融资款到账"
    // as a personal debt draw invents a mortgage and blocks an otherwise
    // valid node.  Explicit protagonist financing remains covered below.
    return /(?:贷款|借款|经营贷|消费贷|房贷|授信)[^。！？]{0,36}(?:已(?:经)?|正式)?(?:放款|到账|入账|到手)|(?:银行|金融机构)[^。！？]{0,24}(?:已(?:经)?|正式)?放款|(?:你|我|主角)[^。！？]{0,24}(?:借到|拿到|获得|收到)[^。！？]{0,20}(?:贷款|借款|融资(?:款)?|经营贷|消费贷|房贷|授信)|(?:你|我|主角)[^。！？]{0,24}借到[^。！？]{0,20}(?:\d|[一二三四五六七八九十百千万])[\d.一二三四五六七八九十百千万]*\s*(?:万|元)/u.test(sentence);
  });
}

export function stillClaimsRejectedDebtRestructure(description: string): boolean {
  return description.split(/(?<=[。！？])/u).some((sentence) => {
    if (/申请|可以申请|待审核|审批中|协商中|尚未|还未|未能|没有通过|被拒/u.test(sentence)
      && !/确认函|正式生效|已经生效|已改为|调整为|月供[^。！？]{0,24}(?:降至|降到|降低到)(?:了)?/u.test(sentence)) return false;
    return /新还款计划确认函|(?:重组|宽限期|补充)协议.{0,10}(?:签署|签订|生效)|签了(?:[^。！？]{0,8})?协议|还款方式(?:已经|已)?改为|期限(?:已经|已)?延长|(?:把)?月供[^。！？]{0,24}(?:降至|降到|降低到)(?:了)?|(?:把)?月供[^。！？]{0,24}归零|月供暂时归零|宽限期内|银行(?:已经|已)?(?:批准|同意).{0,16}(?:展期|重组|先息后本|宽限期)/u.test(sentence);
  });
}

function claimsImmediateReliefFromRejectedFinancialCompletion(sentence: string): boolean {
  if (/(?:并未|没有|尚未|仍未|不曾|并没有)[^。！？]{0,16}(?:缓解|减轻|改善|降低|松一口气|喘息)/u.test(sentence)) return false;
  return /(?:松(?:了)?(?:一)?口气|长舒一口气|终于(?:可以)?(?:喘息|缓口气)|(?:现金流|资金|还款|月供|债务|经济|财务)?压力[^。！？]{0,12}(?:缓解|减轻|下降|小了)|现金流[^。！？]{0,12}(?:缓解|改善)|月供[^。！？]{0,16}(?:降低|减轻|轻松)|燃眉之急[^。！？]{0,8}(?:得到)?缓解|(?:储蓄|存款|现金|余额|积蓄)[^。！？]{0,12}(?:因此|随之)?[^。！？]{0,8}(?:增加|增长|多了|攒下))/u.test(sentence);
}

export function rollbackRejectedFinancialCompletionTitle(
  title: string,
  rejectedProposals: FinancialEventProposal[]
): string {
  if (rejectedProposals.some((proposal) => proposal.kind === "debt_restructured")
    && /(?:债务|贷款|房贷)?重组|重组生效|协商后(?:的)?(?:新平衡|缓冲|转机)|还款(?:方案|安排)(?:落地|生效)/u.test(title)) {
    return "还款协商与现实调整";
  }
  if (rejectedProposals.some((proposal) => proposal.kind === "debt_drawn")
    && /(?:借款|贷款)(?:到账|获批)|资金到账|融资到位/u.test(title)) {
    return "资金安排仍在推进";
  }
  if (rejectedProposals.some((proposal) => proposal.kind === "asset_sold")
    && /(?:卖房|卖车|资产出售|资产处置)(?:落地|完成|成交)/u.test(title)) {
    return "资产处置仍在评估";
  }
  if (rejectedProposals.some((proposal) => proposal.kind === "family_support_received")
    && /(?:援助|支持|家人资金)(?:到账|到位)/u.test(title)) {
    return "外部支持仍待确认";
  }
  if (rejectedProposals.some((proposal) => ["business_holding_started", "business_option_granted", "business_option_vested"].includes(proposal.kind))
    && /股权(?:确认|落地|到手)|期权(?:确认|授予|归属|落地)/u.test(title)) {
    return title.replace(/股权(?:确认|落地|到手)|期权(?:确认|授予|归属|落地)/u, "权益安排待确认");
  }
  return title;
}

function stillClaimsRejectedProposal(proposal: FinancialEventProposal, description: string): boolean {
  if (proposal.kind === "debt_drawn") return stillClaimsRejectedDebtDraw(description);
  if (proposal.kind === "debt_restructured") return stillClaimsRejectedDebtRestructure(description);
  if (proposal.kind === "one_off_income_received") {
    return /补发[^。！？]{0,16}(?:工资|薪资|奖金)|(?:工资|薪资|奖金)[^。！？]{0,16}(?:补发|到账)|(?:你|我|主角)(?:已经|已)?(?:收到|拿到|获得)[^。！？]{0,16}(?:工资|薪资|奖金|分红)/u.test(description);
  }
  if (["income_source_started", "income_source_adjusted"].includes(proposal.kind)) {
    return /(?:你|我|主角)(?:每月|当前|现在|实际)?[^。！？]{0,18}(?:税后)?(?:工资|薪资|月薪|个人收入)[^。！？]{0,16}(?:为|达到|升至|降至|到账)?\s*\d|(?:副业|兼职|驻场|咨询)[^。！？]{0,16}收入[^。！？]{0,20}(?:稳定|到账|带来|填补|覆盖|缓解|攒下)|靠(?:副业|兼职|驻场|咨询)收入[^。！？]{0,20}(?:填补|覆盖|攒下)/u.test(description);
  }
  if (["business_holding_started", "business_option_granted", "business_option_vested"].includes(proposal.kind)) {
    return /(?:签署|签订)[^。！？]{0,20}(?:股权|股份|期权)(?:协议)?|(?:你|我|主角)(?:已经|已)?(?:获得|拿到|确认|持有)[^。！？]{0,20}(?:股权|股份|期权)/u.test(description);
  }
  if (proposal.kind === "family_support_received") {
    return description.split(/(?<=[。！？])/u).some((sentence) => {
      if (/尚未|还未|未能|没有|并未|不再|尚在|仍在(?:申请|等待|确认)/u.test(sentence)) return false;
      return /(?:这笔|该笔|上述)(?:钱|资金|款项)[^。！？]{0,12}(?:到账|到手|入账)(?:后|以后|之后)|(?:支持款|援助款|家人(?:借款|支持))[^。！？]{0,12}(?:到账|到手|入账)(?:后|以后|之后)/u.test(sentence);
    });
  }
  return rejectedProposalClaimsCompletedFact(proposal) && description.includes(proposal.evidence.trim());
}

export type FinancialNarrativeRepairAction = {
  claimType:
    | "unsupported_personal_income"
    | "unsupported_personal_balance"
    | "unsupported_business_holding"
    | "rejected_debt_draw"
    | "rejected_debt_restructure"
    | "rejected_asset_sale"
    | "rejected_family_support"
    | "unsupported_financial_completion"
    | "unsupported_financial_consequence";
  action: "remove_clause" | "remove_sentence" | "render_attempt_outcome";
  sentenceIndex: number;
  proposalId?: string;
  sourceText: string;
  outputText?: string;
};

export function buildDeterministicFinancialNarrativeRollback(input: {
  rejectedProposals: FinancialEventProposal[];
  acceptedEvents: AcceptedFinancialEvent[];
  narrativeText?: string;
  selectedDecision?: string;
  narrativeClaims?: FinancialNarrativeClaim[];
  onRepairActions?: (actions: FinancialNarrativeRepairAction[]) => void;
}): string[] {
  const repairActions: FinancialNarrativeRepairAction[] = [];
  const acceptedEvidence = [...new Set(input.acceptedEvents.flatMap((event) => (
    event.evidence.map((item) => item.excerpt?.trim()).filter((item): item is string => Boolean(item))
  )))];
  const pendingByKind: Partial<Record<FinancialEventProposal["kind"], string>> = {
    income_source_paused: "",
    income_source_ended: "",
    expense_commitment_ended: "",
    debt_drawn: "你尝试申请借款，但这次尚未形成已经到账的结果。",
    debt_restructured: "你已经尝试申请调整还款安排，但尚未形成生效协议。",
    asset_sold: "你开始评估资产处置，但这次尚未形成确定成交。",
    family_support_received: "你尝试寻求外部支持，但这次尚未确认资金到账。",
    one_off_income_received: "",
    business_holding_started: "",
    business_option_granted: "",
    business_option_vested: "",
    income_source_started: "",
    income_source_adjusted: "",
    business_distribution_received: ""
  };
  const fallbackFor = (proposal: FinancialEventProposal) => pendingByKind[proposal.kind]
    ?? "";
  const claimTypeFor = (proposal: FinancialEventProposal): FinancialNarrativeRepairAction["claimType"] => {
    if (["income_source_started", "income_source_adjusted", "one_off_income_received", "business_distribution_received"].includes(proposal.kind)) return "unsupported_personal_income";
    if (["business_holding_started", "business_option_granted", "business_option_vested"].includes(proposal.kind)) return "unsupported_business_holding";
    if (proposal.kind === "debt_drawn") return "rejected_debt_draw";
    if (proposal.kind === "debt_restructured") return "rejected_debt_restructure";
    if (proposal.kind === "asset_sold") return "rejected_asset_sale";
    if (proposal.kind === "family_support_received") return "rejected_family_support";
    return "unsupported_financial_completion";
  };
  const attemptIsGrounded = (proposal: FinancialEventProposal): boolean => {
    const evidence = `${input.selectedDecision || ""}\n${proposal.evidence || ""}`;
    if (proposal.kind === "debt_drawn") return /(?:申请|提交|支用|借入)(?:了)?[^。！？]{0,24}(?:借款|贷款|授信|额度)|(?:借款|贷款|授信)[^。！？]{0,24}(?:申请|提交|支用)(?:了)?/u.test(evidence);
    if (proposal.kind === "debt_restructured") return /(?:申请|协商|沟通|谈判|请求|提交)(?:了)?[^。！？]{0,28}(?:重组|展期|宽限|还款安排|还款计划|月供|还款协商)|(?:重组|展期|宽限|还款安排|还款计划|还款协商)[^。！？]{0,28}(?:申请|协商|沟通|谈判|请求|提交)(?:了)?/u.test(evidence);
    if (proposal.kind === "asset_sold") return /(?:挂牌|联系中介|寻找买家|议价|评估出售|申请出售|处置资产)/u.test(evidence);
    if (proposal.kind === "family_support_received") return /(?:开口|求助|请求|商量|协商|寻求)[^。！？]{0,20}(?:父母|家人|伴侣|支持|帮助|资金)/u.test(evidence);
    return false;
  };
  const stripRejectedHoldingClaim = (sentence: string): string => {
    const terminal = sentence.match(/[。！？]$/u)?.[0] ?? "。";
    const clauses = sentence.replace(/[。！？]$/u, "").split(/[，；]/u)
      .map((clause) => clause.trim())
      .filter((clause) => clause && !/(?:股权|股份|期权|持股|占股|归属)[^，；]{0,24}(?:签署|签订|获得|拿到|确认|持有|协议)|(?:签署|签订|获得|拿到|确认|持有)[^，；]{0,24}(?:股权|股份|期权|持股|占股|归属)/u.test(clause))
      .map((clause) => clause.replace(/^(?:并|但|而|同时)[，、]?/u, "").trim())
      .filter(Boolean);
    return clauses.length > 0 ? `${clauses.join("，")}${terminal}` : "";
  };
  const stripRejectedCompletionClaim = (sentence: string, proposal: FinancialEventProposal): string => {
    const terminal = sentence.match(/[。！？]$/u)?.[0] ?? "。";
    const rejectedClause = proposal.kind === "debt_drawn"
      ? /(?:借款|贷款|授信|放款|月供|还贷|资金到账|款项到账|这笔钱到账)/u
      : proposal.kind === "debt_restructured"
        ? /(?:债务重组|重组协议|展期|宽限|还款计划|还款安排|月供|拖欠|逾期|现金流转正|正余量)/u
        : proposal.kind === "family_support_received"
          ? /(?:支持款|援助款|家人借款|(?:父母|父亲|母亲|爸爸|妈妈)[^，；]{0,16}(?:转来|借给|支持)|资金到账|款项到账|这笔钱到账)/u
          : proposal.kind === "asset_sold"
            ? /(?:出售|售出|卖房|卖车|资产处置|成交|回款)/u
            : proposal.kind === "income_source_ended"
              ? /(?:工资|薪资|收入)[^，；]{0,16}(?:停止|结束|停发)|(?:停止|结束|停发)[^，；]{0,16}(?:工资|薪资|收入)/u
              : proposal.kind === "income_source_paused"
                ? /(?:工资|薪资|收入)[^，；]{0,16}(?:暂停|中断)|(?:暂停|中断)[^，；]{0,16}(?:工资|薪资|收入)/u
                : proposal.kind === "expense_commitment_ended"
                  ? /(?:支出|开支|月供|费用)[^，；]{0,16}(?:停止|结束|取消)|(?:停止|结束|取消)[^，；]{0,16}(?:支出|开支|月供|费用)/u
                  : /$^/u;
    let removed = false;
    let dependsOnRejectedReceipt = false;
    const clauses = sentence.replace(/[。！？]$/u, "").split(/[，；]/u).flatMap((rawClause) => {
      let clause = rawClause.trim();
      if (!clause) return [];
      if (dependsOnRejectedReceipt) return [];
      if (rejectedClause.test(clause)) {
        removed = true;
        dependsOnRejectedReceipt = /(?:这笔|该笔|上述)(?:钱|资金|款项)[^，；]{0,12}(?:到账|到手|入账)(?:后|以后|之后)/u.test(clause);
        return [];
      }
      if (removed) clause = clause.replace(/^(?:但|而|因此|所以|同时)[，、]?/u, "").trim();
      return clause ? [clause] : [];
    });
    return clauses.length > 0 ? `${clauses.join("，")}${terminal}` : "";
  };
  const sourceParagraphs = String(input.narrativeText || "").split(/\n\s*\n+/u).map((item) => item.trim()).filter(Boolean);
  const sourceSentences = sourceParagraphs.flatMap((paragraph) => (
    paragraph.split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean)
  ));
  const rejectedProposalIds = new Set(input.rejectedProposals.map((proposal) => proposal.id));
  const rejectedClaims = (input.narrativeClaims || []).filter((claim) => rejectedProposalIds.has(claim.proposalId));
  const rejectedPersonalIncome = input.rejectedProposals.some((proposal) => [
    "income_source_started",
    "income_source_adjusted",
    "one_off_income_received",
    "business_distribution_received"
  ].includes(proposal.kind));
  const acceptedEvidenceSet = new Set(acceptedEvidence);
  const claimsUnsupportedPersonalBalanceIncrease = (sentence: string) => (
    rejectedPersonalIncome
    && ![...acceptedEvidenceSet].some((excerpt) => sentence.includes(excerpt) || excerpt.includes(sentence))
    && /(?:账户|存款|积蓄|现金|余额)[^。！？]{0,20}(?:多出|增加|增长|攒下|积累|新增)[^。！？]{0,12}(?:\d+(?:\.\d+)?|[零一二三四五六七八九十百千万两]+)\s*(?:万|元)/u.test(sentence)
  );
  let changed = false;
  let sentenceIndexCursor = 0;
  const repairedParagraphs = sourceParagraphs.map((paragraph) => {
    const sentences = paragraph.split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean);
    let rejectedImmediatelyBefore = false;
    let rejectedImmediatelyBeforeKind: FinancialEventProposal["kind"] | undefined;
    const repaired: string[] = [];
    for (const sentence of sentences) {
      const sentenceIndex = sentenceIndexCursor;
      sentenceIndexCursor += 1;
      const linkedClaim = rejectedClaims.find((claim) => sentence.includes(claim.surfaceText));
      const rejected = linkedClaim
        ? input.rejectedProposals.find((proposal) => proposal.id === linkedClaim.proposalId)
        : input.rejectedProposals.find((proposal) => stillClaimsRejectedProposal(proposal, sentence)
          || (proposal.evidence.trim().length > 0 && sentence.includes(proposal.evidence.trim())));
      if (rejected) {
        changed = true;
        rejectedImmediatelyBefore = true;
        rejectedImmediatelyBeforeKind = rejected.kind;
        const fallback = attemptIsGrounded(rejected) ? fallbackFor(rejected) : "";
        if (fallback) {
          repaired.push(fallback);
          const preservedAction = stripRejectedCompletionClaim(sentence, rejected);
          if (preservedAction) repaired.push(preservedAction);
          repairActions.push({ claimType: claimTypeFor(rejected), action: "render_attempt_outcome", sentenceIndex, proposalId: rejected.id, sourceText: sentence, outputText: fallback });
        } else if (["income_source_started", "income_source_adjusted", "one_off_income_received", "business_distribution_received"].includes(rejected.kind)) {
          let preservedAction = stripUnsupportedPersonalIncomeClaim(sentence);
          for (const otherRejected of input.rejectedProposals) {
            if (!preservedAction || otherRejected.id === rejected.id || !stillClaimsRejectedProposal(otherRejected, preservedAction)) continue;
            if (["business_holding_started", "business_option_granted", "business_option_vested"].includes(otherRejected.kind)) {
              preservedAction = stripRejectedHoldingClaim(preservedAction);
            }
          }
          if (preservedAction) repaired.push(preservedAction);
          repairActions.push({
            claimType: claimTypeFor(rejected),
            action: preservedAction ? "remove_clause" : "remove_sentence",
            sentenceIndex,
            proposalId: rejected.id,
            sourceText: sentence,
            outputText: preservedAction || undefined
          });
        } else {
          const preservedAction = ["business_holding_started", "business_option_granted", "business_option_vested"].includes(rejected.kind)
            ? stripRejectedHoldingClaim(sentence)
            : stripRejectedCompletionClaim(sentence, rejected);
          if (preservedAction) repaired.push(preservedAction);
          repairActions.push({
            claimType: claimTypeFor(rejected),
            action: preservedAction ? "remove_clause" : "remove_sentence",
            sentenceIndex,
            proposalId: rejected.id,
            sourceText: sentence,
            outputText: preservedAction || undefined
          });
        }
        continue;
      }
      if (claimsUnsupportedPersonalBalanceIncrease(sentence)) {
        changed = true;
        repairActions.push({ claimType: "unsupported_personal_balance", action: "remove_sentence", sentenceIndex, sourceText: sentence });
        continue;
      }
      if (rejectedPersonalIncome
        && !acceptedEvidence.some((excerpt) => sentence.includes(excerpt) || excerpt.includes(sentence))) {
        const preservedAction = stripUnsupportedPersonalIncomeClaim(sentence);
        if (preservedAction !== sentence) {
          changed = true;
          if (preservedAction) repaired.push(preservedAction);
          repairActions.push({
            claimType: "unsupported_personal_income",
            action: preservedAction ? "remove_clause" : "remove_sentence",
            sentenceIndex,
            sourceText: sentence,
            outputText: preservedAction || undefined
          });
          continue;
        }
      }
      if (rejectedPersonalIncome
        && sentenceClaimsNewPersonalIncomeActivity(sentence)
        && !acceptedEvidence.some((excerpt) => sentence.includes(excerpt) || excerpt.includes(sentence))) {
        changed = true;
        const preservedAction = stripUnsupportedPersonalIncomeClaim(sentence);
        if (preservedAction) repaired.push(preservedAction);
        repairActions.push({
          claimType: "unsupported_personal_income",
          action: preservedAction ? "remove_clause" : "remove_sentence",
          sentenceIndex,
          sourceText: sentence,
          outputText: preservedAction || undefined
        });
        continue;
      }
      if (rejectedImmediatelyBefore && claimsImmediateReliefFromRejectedFinancialCompletion(sentence)) {
        changed = true;
        rejectedImmediatelyBefore = false;
        if (rejectedImmediatelyBeforeKind && ["income_source_started", "income_source_adjusted", "one_off_income_received", "business_distribution_received"].includes(rejectedImmediatelyBeforeKind)) {
          const preservedAction = stripUnsupportedPersonalIncomeClaim(sentence);
          if (preservedAction) repaired.push(preservedAction);
        }
        rejectedImmediatelyBeforeKind = undefined;
        continue;
      }
      rejectedImmediatelyBefore = false;
      rejectedImmediatelyBeforeKind = undefined;
      repaired.push(sentence);
    }
    return [...new Set(repaired)].join("");
  }).filter(Boolean);
  const rejectedRestructure = input.rejectedProposals.find((proposal) => proposal.kind === "debt_restructured");
  const restructurePending = Boolean(rejectedRestructure);
  if (rejectedRestructure && attemptIsGrounded(rejectedRestructure)
    && !repairedParagraphs.some((paragraph) => paragraph.includes("尚未形成生效协议"))) {
    repairedParagraphs.push(fallbackFor(rejectedRestructure));
    changed = true;
  }
  if (restructurePending) {
    for (let index = repairedParagraphs.length - 1; index >= 0; index -= 1) {
      const sentences = repairedParagraphs[index].split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean);
      const sanitized = sentences.filter((sentence) => {
        if (sentence.includes("尚未形成生效协议")) return true;
        if (stillClaimsRejectedDebtRestructure(sentence)) return false;
        return !/(?:每月|月供)[^。！？]{0,20}(?:多出(?:来)?(?:的)?|释放|降低|降到|降至|少还)\s*\d|(?:每月还款|月供)(?:压力)?[^。！？]{0,16}(?:下降|减轻|缓解|降低)|提前还(?:掉|了)?[^。！？]{0,16}(?:房贷|贷款|债务)(?:本金)?|(?:这份|该份|新的?)(?:补充)?协议|用更长的还款周期[^。！？]{0,16}(?:喘息|缓解)|(?:执行|按照|依照)[^。！？]{0,18}(?:新|调整后)(?:的)?(?:还款)?计划|(?:拖欠|逾期)[^。！？]{0,18}(?:止住|停止|归零|减少)|现金流[^。！？]{0,16}(?:转正|正余量|好转|改善)|(?:松(?:了)?(?:一)?口气|喘息空间|终于能喘口气|宽慰)[^。！？]{0,24}(?:月供|还款|利息|现金流)?|(?:利息总额|还款期限)[^。！？]{0,20}(?:增加|延长)[^。！？]{0,20}(?:月供|现金流|喘息|缓解)/u.test(sentence);
      });
      repairedParagraphs[index] = sanitized.join("");
    }
  }
  const rejectedDebtOutcome = input.rejectedProposals.some((proposal) => (
    proposal.kind === "debt_drawn" || proposal.kind === "debt_restructured"
  ));
  if (rejectedDebtOutcome) {
    const unsupportedDebtRelief = /(?:整体|经济|财务|现金流|还款|债务)?压力[^。！？]{0,16}(?:缓解|减轻|下降|小了)|(?:松(?:了)?(?:一)?口气|喘息空间|终于能喘息)/u;
    for (let index = repairedParagraphs.length - 1; index >= 0; index -= 1) {
      const sentences = repairedParagraphs[index].split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean);
      repairedParagraphs[index] = sentences.filter((sentence) => (
        acceptedEvidence.some((excerpt) => sentence.includes(excerpt) || excerpt.includes(sentence))
        || !unsupportedDebtRelief.test(sentence)
      )).join("");
    }
  }
  if (rejectedPersonalIncome) {
    const unsupportedRelief = /(?:(?:父母|家人|伴侣|配偶)[^。！？]{0,24}(?:分担|承担|支付)[^。！？]{0,20}(?:房租|生活费|生活开支|家庭开支)|(?:收入|现金流|存款|积蓄|储蓄|现金|余额|应急金|房租|生活费|开支)[^。！？]{0,36}(?:缓解|减轻|增加|攒下|分担|承担|支付|小了))/u;
    for (let index = repairedParagraphs.length - 1; index >= 0; index -= 1) {
      const sentences = repairedParagraphs[index].split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean);
      repairedParagraphs[index] = sentences.map((sentence) => {
        if (acceptedEvidence.some((excerpt) => sentence.includes(excerpt) || excerpt.includes(sentence))) return sentence;
        return unsupportedRelief.test(sentence) ? stripUnsupportedPersonalIncomeClaim(sentence) : sentence;
      }).filter(Boolean).join("");
    }
  }
  if (!changed) repairedParagraphs.push(...[...new Set(input.rejectedProposals.map(fallbackFor).filter(Boolean))]);
  const normalizedEvidenceText = (value: string) => value.normalize("NFKC").trim().replace(/[。！？；]+$/u, "");
  for (const excerpt of acceptedEvidence) {
    if (/^(?:自定义抉择|用户选择|已接受选择)\s*[:：]/u.test(excerpt)) continue;
    const normalizedExcerpt = normalizedEvidenceText(excerpt);
    const alreadyVisible = repairedParagraphs.some((paragraph) => paragraph
      .split(/(?<=[。！？；])/u)
      .some((sentence) => {
        const normalizedSentence = normalizedEvidenceText(sentence);
        return normalizedSentence.includes(normalizedExcerpt) || normalizedExcerpt.includes(normalizedSentence);
      }));
    if (!alreadyVisible) repairedParagraphs.push(excerpt);
  }
  const finalNarrativeText = repairedParagraphs.join("\n\n");
  const coveredSourceTexts = new Set(repairActions.map((action) => action.sourceText));
  sourceSentences.forEach((sentence, sentenceIndex) => {
    if (coveredSourceTexts.has(sentence) || finalNarrativeText.includes(sentence)) return;
    repairActions.push({
      claimType: "unsupported_financial_consequence",
      action: "remove_sentence",
      sentenceIndex,
      sourceText: sentence
    });
  });
  input.onRepairActions?.(repairActions);
  return repairedParagraphs.length > 0
    ? repairedParagraphs
    : [];
}

export function settleRejectedFinancialProposalIssues(input: {
  issues: FinancialLedgerIssue[];
  acceptedProposalIds: string[];
  rejectedProposalIds: string[];
  ageInMonths: number;
  narrativeRolledBack: boolean;
}): FinancialLedgerIssue[] {
  const acceptedIds = new Set(input.acceptedProposalIds);
  const rejectedIds = new Set(input.rejectedProposalIds);
  return input.issues.map((issue) => {
    const relatedIds = issue.relatedProposalIds || [];
    const rejectedOnly = relatedIds.length > 0
      && relatedIds.every((proposalId) => rejectedIds.has(proposalId) && !acceptedIds.has(proposalId));
    // A prose rollback can remove a claim that a rejected proposal had already
    // happened, but it cannot establish the missing ownership, scope, or
    // allocation evidence required for a recurring personal expense.  Keep
    // EXPENSE_* authority failures open until the final proposal set itself is
    // valid; otherwise an invalid model proposal can be silently downgraded to
    // a review and advance the authoritative period in enforced mode.
    const rejectedExpenseAuthorityIssue = issue.severity === "blocking"
      && (
        issue.code.startsWith("EXPENSE_")
        || issue.id.startsWith("expense_")
        // Lifecycle proposals are validator-owned.  A rejected generated
        // commitment must remain an authoritative blocking fact even when the
        // low-level validator categorizes its failure as UNBALANCED_TRANSACTION
        // (for example, evidence matching), rather than an EXPENSE_* code.
        || relatedIds.some((proposalId) => proposalId.startsWith("system_expense_"))
      );
    // A career transition and its replacement income are one accepted fact
    // group.  If atomicity rejects that group, treating the diagnostic as
    // "resolved because no proposal committed" would let the prose describe a
    // new job while the authoritative CareerState and wage remain unchanged.
    // Leave it open so the enforced gate rejects the entire candidate and
    // retries from the unchanged authority state.
    const rejectedCareerAuthorityIssue = issue.severity === "blocking"
      && issue.code === "CAREER_INCOME_CONFLICT";
    if (!rejectedOnly || rejectedExpenseAuthorityIssue || rejectedCareerAuthorityIssue || (issue.status ?? "open") !== "open") return issue;
    return {
      ...issue,
      status: "resolved",
      resolvedAtAgeInMonths: input.ageInMonths,
      resolvedByEventId: input.narrativeRolledBack
        ? "system:rejected_proposal_narrative_rollback"
        : "system:rejected_proposal_not_committed"
    };
  });
}

export function synthesizeMissingDebtCompletionProposals(input: {
  proposals: FinancialEventProposal[];
  narrativeText: string;
  acceptedOutcomeId?: string;
  effectiveAtAgeInMonths: number;
}): FinancialEventProposal[] {
  if (!input.acceptedOutcomeId) return input.proposals;
  const proposals = [...input.proposals];
  const sentences = input.narrativeText.split(/(?<=[。！？])/u).map((sentence) => sentence.trim()).filter(Boolean);
  const appendMissing = (
    kind: "debt_drawn" | "debt_restructured",
    claimsCompletion: boolean,
    evidenceMatches: (sentence: string) => boolean
  ) => {
    if (!claimsCompletion || proposals.some((proposal) => proposal.kind === kind)) return;
    const evidence = sentences.find(evidenceMatches) || "";
    proposals.push({
      id: `missing_${kind}_${input.effectiveAtAgeInMonths}`,
      kind,
      effectiveAtAgeInMonths: input.effectiveAtAgeInMonths,
      payload: {},
      sourceOutcomeId: input.acceptedOutcomeId,
      evidence,
      confidence: 0
    });
  };
  appendMissing(
    "debt_drawn",
    claimsCompletedNewDebtDisbursement(input.narrativeText),
    claimsCompletedNewDebtDisbursement
  );
  appendMissing("debt_restructured", stillClaimsRejectedDebtRestructure(input.narrativeText), stillClaimsRejectedDebtRestructure);
  return proposals;
}

export function synthesizeMissingBusinessHoldingStartProposal(input: {
  proposals: FinancialEventProposal[];
  narrativeText: string;
  selectedDecision?: string;
  acceptedOutcomeId?: string;
  effectiveAtAgeInMonths: number;
  periodStartAgeInMonths?: number;
  ledger: FinancialLedger;
}): FinancialEventProposal[] {
  if (!input.acceptedOutcomeId) {
    return input.proposals;
  }
  const activeHolding = input.ledger.businessHoldings.find((holding) => holding.status !== "sold" && holding.status !== "written_off");
  const ownershipContext = /股权|股份|持股|占股|合伙协议|分成/u;
  const counterpartOwnership = /(?:合伙人|老张|老赵|老李|小刘|阿杰).{0,8}\d+(?:\.\d+)?\s*%/u;
  const protagonistOwnership = /(?:你|主角|本人)(?:的)?(?:(?:(?:持有|持股|股份|股权)(?:占|为|达到)?|占股|占)\s*|.{0,20}(?:拿|获得)\s*|)(\d+(?:\.\d+)?)\s*%/u;
  const explicitHoldingEvidence = (sentence: string) => {
    if (/(?:考虑|怀疑|是否|想要|计划|打算|准备|可能).{0,16}创业/u.test(sentence)) return false;
    if (/(?:面前|有).{0,12}(?:两|三|几)条路|(?:三条路|选择是).{0,80}(?:或者|还是)/u.test(sentence)) return false;
    return /(?:你|主角|本人).{0,36}(?:(?:成立|创办|注册).{0,28}(?:公司|工作室|企业|科技)|(?:全职投入|开始|投身).{0,20}创业)/u.test(sentence)
      || /(?:辞职|离职).{0,12}创业|全职创业/u.test(sentence)
      || ((ownershipContext.test(sentence) || counterpartOwnership.test(sentence)) && protagonistOwnership.test(sentence))
      || /(?:你|主角|本人|个人).{0,20}(?:投入|出资|垫付|拿出|取出|支取).{0,24}(?:公司|创业|启动资金|运营资金)/u.test(sentence);
  };
  if (activeHolding) {
    if (input.proposals.some((proposal) => proposal.kind === "business_holding_revalued")) return input.proposals;
    const ownershipEvidence = input.narrativeText.split(/(?<=[。！？])/u).map((sentence) => sentence.trim()).find((sentence) => (
      (ownershipContext.test(sentence) || counterpartOwnership.test(sentence)) && protagonistOwnership.test(sentence)
    ));
    const ownershipMatch = ownershipEvidence?.match(protagonistOwnership);
    if (!ownershipEvidence || !ownershipMatch) return input.proposals;
    const ownershipRate = Number(ownershipMatch[1]) / 100;
    if (Math.abs((activeHolding.ownershipRate ?? ownershipRate) - ownershipRate) < 0.0001) return input.proposals;
    return [...input.proposals, {
      id: `business_holding_ownership_adjusted_${input.effectiveAtAgeInMonths}`,
      kind: "business_holding_revalued",
      effectiveAtAgeInMonths: input.effectiveAtAgeInMonths,
      sourceOutcomeId: input.acceptedOutcomeId,
      financialScope: "personal",
      evidence: ownershipEvidence,
      confidence: 0.9,
      payload: {
        businessHoldingId: activeHolding.id,
        previousCarryingValueWan: activeHolding.personalCarryingValueWan,
        newCarryingValueWan: activeHolding.personalCarryingValueWan,
        ownershipRate,
        valuationEvidence: []
      }
    }];
  }
  const supportedHoldingProposals = input.proposals.filter((proposal) => (
    proposal.kind === "business_holding_started"
    && matchesNormalizedEvidence(input.narrativeText, proposal.evidence)
    && explicitHoldingEvidence(proposal.evidence || "")
  ));
  if (supportedHoldingProposals.length > 0) return input.proposals;
  const hasUnsupportedHoldingProposal = input.proposals.some((proposal) => proposal.kind === "business_holding_started");
  const selectedDecisionEvidence = explicitHoldingEvidence(input.selectedDecision || "") ? input.selectedDecision!.trim() : undefined;
  const evidence = selectedDecisionEvidence || input.narrativeText.split(/(?<=[。！？])/u).map((sentence) => sentence.trim()).find((sentence) => (
    explicitHoldingEvidence(sentence)
    || (hasUnsupportedHoldingProposal && /(?:你|主角|本人).{0,60}(?:成立|创办|注册)(?:了)?/u.test(sentence))
  ));
  if (!evidence) return input.proposals;
  const cashAccountId = input.ledger.cashAccounts.find((account) => account.status === "active")?.id;
  if (!cashAccountId) return input.proposals;
  const suffix = input.effectiveAtAgeInMonths;
  const ownershipPercent = evidence.match(protagonistOwnership);
  const ownershipRate = ownershipPercent ? Number(ownershipPercent[1]) / 100 : undefined;
  const explicitStartupContribution = evidence.match(/用\s*(\d+(?:\.\d+)?)\s*万元?(?:家庭)?备用金(?:作为|投入|用作)?启动资金/u)
    || evidence.match(/(?:用|从|拿出|取出|支取).{0,12}?(\d+(?:\.\d+)?)\s*万元?.{0,16}?(?:备用金|存款|个人现金).{0,20}?(?:启动资金|创业|投入|出资)/u)
    || evidence.match(/(?:备用金|存款|个人现金).{0,20}?(?:拿出|取出|支取|投入|出资)(?:了)?\s*(\d+(?:\.\d+)?)\s*万元?/u);
  const personalCashInvestedWan = explicitStartupContribution ? Number(explicitStartupContribution[1]) : 0;
  const proposalsWithoutUnsupportedHolding = input.proposals.filter((proposal) => {
    if (proposal.kind === "business_holding_started") return false;
    if (personalCashInvestedWan > 0
      && proposal.kind === "one_off_expense_paid"
      && /启动资金|创业出资|投入公司|公司注册资金|公司运营资金/u.test(proposal.evidence || "")) return false;
    return true;
  });
  return [...proposalsWithoutUnsupportedHolding, {
    id: `business_holding_started_${suffix}`,
    kind: "business_holding_started",
    effectiveAtAgeInMonths: personalCashInvestedWan > 0
      ? input.periodStartAgeInMonths ?? input.effectiveAtAgeInMonths
      : input.effectiveAtAgeInMonths,
    sourceOutcomeId: input.acceptedOutcomeId,
    financialScope: "personal",
    evidence,
    confidence: 0.9,
    payload: {
      sourceCashAccountId: cashAccountId,
      personalCashInvestedWan,
      businessHolding: {
        id: `founder_holding_${suffix}`,
        business: {
          id: `business_${suffix}`,
          displayName: "创业公司",
          status: "operating",
          factStatus: "known",
          evidence: []
        },
        ...(Number.isFinite(ownershipRate) ? { ownershipRate } : {}),
        personalCarryingValueWan: personalCashInvestedWan,
        status: "active",
        factStatus: "known",
        evidence: []
      }
    }
  }];
}

export function synthesizeMissingBusinessOptionGrantProposal(input: {
  proposals: FinancialEventProposal[];
  narrativeText: string;
  acceptedOutcomeId?: string;
  effectiveAtAgeInMonths: number;
  ledger: FinancialLedger;
}): FinancialEventProposal[] {
  if (!input.acceptedOutcomeId) return input.proposals;
  const optionEvidence = input.narrativeText.split(/(?<=[。！？；])/u)
    .map((sentence) => sentence.trim())
    .find((sentence) => (
      /(?:你|你的|本人|主角).{0,60}(?:获得|获授|被授予|另获|拿到|持有|拥有).{0,24}期权/u.test(sentence)
      && !/(?:计划|考虑|可能|如果|若|将会).{0,40}期权/u.test(sentence)
    ));
  if (!optionEvidence) return input.proposals;
  const alreadyRecorded = input.ledger.businessHoldings.some((holding) => (
    holding.instrumentType === "stock_option"
    && (holding.status === "active" || holding.status === "partially_sold")
    && holding.evidence.some((evidence) => evidence.excerpt === optionEvidence)
  ));
  if (alreadyRecorded) return input.proposals;

  const ownershipPercent = optionEvidence.match(/(\d+(?:\.\d+)?)\s*%\s*期权/u);
  const vestingYears = optionEvidence.match(/(?:分|按)?\s*([一二三四五六七八九十\d]+)\s*年(?:归属|成熟)/u);
  const chineseYears: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10
  };
  const vestingYearCount = vestingYears
    ? (Number(vestingYears[1]) || chineseYears[vestingYears[1]])
    : undefined;
  const businessName = [...input.narrativeText.matchAll(/(?:在|加入|受聘于|为)([\p{Script=Han}A-Za-z0-9]{2,12}(?:科技|公司|工作室|集团))/gu)]
    .map((match) => match[1])
    .at(-1);
  const existingBusiness = businessName
    ? input.ledger.businessHoldings.find((holding) => (
      holding.business.displayName.includes(businessName)
      || businessName.includes(holding.business.displayName)
    ))?.business
    : undefined;
  const optionId = `option_holding_${input.effectiveAtAgeInMonths}`;
  const deterministicOption: FinancialEventProposal = {
    id: `business_option_granted_${input.effectiveAtAgeInMonths}`,
    kind: "business_option_granted",
    effectiveAtAgeInMonths: input.effectiveAtAgeInMonths,
    sourceOutcomeId: input.acceptedOutcomeId,
    financialScope: "personal",
    evidence: optionEvidence,
    confidence: 0.95,
    payload: {
      optionHolding: {
        id: optionId,
        business: existingBusiness ? structuredClone(existingBusiness) : {
          id: `business_${optionId}`,
          displayName: businessName || "期权授予企业（待确认）",
          status: "operating",
          factStatus: businessName ? "known" : "needs_review",
          evidence: []
        },
        instrumentType: "stock_option",
        ...(ownershipPercent ? { ownershipRate: Number(ownershipPercent[1]) / 100 } : {}),
        optionTerms: {
          grantedUnits: 0,
          vestedUnits: 0,
          exercisedUnits: 0,
          strikePriceWanPerUnit: 0,
          grantedAtAgeInMonths: input.effectiveAtAgeInMonths,
          ...(vestingYearCount ? {
            vestingPolicy: {
              totalMonths: vestingYearCount * 12,
              frequencyMonths: 12
            }
          } : {})
        },
        personalCarryingValueWan: 0,
        status: "active",
        factStatus: "needs_review",
        evidence: []
      }
    }
  };
  return [
    ...input.proposals.filter((proposal) => proposal.kind !== "business_option_granted"),
    deterministicOption
  ];
}

export function synthesizeSelectedPersonalIncomeProposal(input: {
  proposals: FinancialEventProposal[];
  selectedDecision?: string;
  narrativeText?: string;
  allowNarrativeEvidence?: boolean;
  acceptedOutcomeId?: string;
  periodStartAgeInMonths: number;
  currentCareerStateId: string;
  currentEmploymentStatus: string;
  migrateToCurrentCareerState?: boolean;
  /** An accepted offer is not yet a salary event until an actual start is established. */
  suppressEmployerSalarySynthesis?: boolean;
  ledger: FinancialLedger;
}): FinancialEventProposal[] {
  const decision = input.selectedDecision?.trim();
  if (!decision || !input.acceptedOutcomeId || input.suppressEmployerSalarySynthesis) return input.proposals;
  const narrativeText = input.narrativeText || "";
  const narrativeSentences = narrativeText.split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean);
  const completedStartSentence = input.migrateToCurrentCareerState
    ? narrativeSentences.find((sentence) => hasCompletedEmployerStartEvidence(sentence))
    : undefined;
  const bindAcceptedSalaryTermsToCompletedStart = (salarySentence: string): string | undefined => {
    if (!isUnacceptedIncomeOpportunityEvidence(salarySentence)) return salarySentence;
    if (!completedStartSentence) return undefined;
    const salaryStart = narrativeText.indexOf(salarySentence);
    const completedStart = narrativeText.indexOf(completedStartSentence);
    // The accepted start must close the preceding offer. Do not let an earlier
    // start sentence retroactively authorize a different future offer later in
    // the node.
    if (salaryStart < 0 || completedStart < salaryStart) return undefined;
    const excerptStart = salaryStart;
    const excerptEnd = completedStart + completedStartSentence.length;
    // An Accepted CareerTransition already proves that these terms and the
    // completed start belong to this node. Preserve the exact contiguous prose
    // so the validator can verify both facts without treating a bare offer as
    // current income or manufacturing a replacement amount.
    return narrativeText.slice(excerptStart, excerptEnd).trim();
  };
  const narrativeEvidence = input.allowNarrativeEvidence
    ? narrativeSentences.map((sentence) => ({
        sentence,
        boundEvidence: bindAcceptedSalaryTermsToCompletedStart(sentence)
      })).find(({ sentence, boundEvidence }) => {
        if (!boundEvidence) return false;
        return (
          /(?:你|主角|本人|你的个人账户).{0,48}(?:(?:税后)?(?:月薪|年薪|年收入|工资|薪资|副业月收入|个人月收入)|年税后收入).{0,16}\d+(?:\.\d+)?\s*(?:万(?:元)?|元)|(?:(?:税后)?(?:月薪|年薪|年收入|副业月收入|个人月收入)|年税后收入)(?:约|为|有|达到|降至|升至|涨到|调整为|维持在|稳定在)?\s*\d+(?:\.\d+)?\s*(?:万(?:元)?|元)|(?:税后)?月薪[^。！？；]{0,12}[一二两三四五六七八九十百千万]+元/u.test(sentence)
          || (/税后到手(?:约|为|有)?\s*\d+(?:\.\d+)?\s*(?:万(?:元)?|元)/u.test(sentence)
            && /(?:按月|每月|月度)结算/u.test(sentence))
        )
        && !/(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,70}(?:员工|助理|工程师|销售|运营|护工)[^。；]{0,35}(?:月薪|年薪)/u.test(sentence)
        && !/(?:如果|若|预计|计划|考虑|希望|目标|可以给你)[^。；]{0,50}(?:月薪|年薪)/iu.test(sentence)
        // A bare annual-income phrase is ambiguous. It can be a company or a
        // partner's income, so allow it only when this exact sentence assigns
        // it explicitly to the protagonist.
        && (!/年收入/u.test(sentence) || hasExplicitProtagonistAnnualIncomeFact(sentence));
      })?.boundEvidence
    : undefined;
  const evidenceText = /个人账户|个人工资|个人薪资|给自己|向我(?:的)?账户|我(?:每月|开始|从本月起).{0,24}(?:工资|薪资|月薪)/u.test(decision)
    ? decision
    : narrativeEvidence;
  // A bare "咨询"/"课程"/"工作坊" is not enough to establish a second
  // income stream: it also appears in ordinary employer names and job titles
  // (for example, "在咨询公司工作").  Treat it as side income only when the
  // prose explicitly marks a side activity or connects the activity to its
  // own income/compensation.  Otherwise a current employee salary must adjust
  // the one linked career source rather than open a duplicate contract source.
  const sideIncomeSignal = /副业|兼职|稿费|版税|(?:课程|咨询|工作坊|顾问|外包)(?:收入|收费|报酬|酬劳|服务|业务|费)|(?:个人|独立|周末|业余|额外|线上|一对一).{0,12}(?:课程|咨询|工作坊|顾问|外包)/u;
  const sideIncomeEvidence = Boolean(evidenceText) && sideIncomeSignal.test(evidenceText!);
  const explicitlyPersonal = Boolean(evidenceText) && /个人账户|个人工资|个人薪资|给自己|向我(?:的)?账户|你|主角|本人|月薪|年薪|税后到手|副业月收入|个人月收入/u.test(evidenceText!);
  // Parse named personal-income phrases before generic monthly wording.  The
  // old permissive `每月…金额` matcher could skip a salary earlier in the
  // same sentence and capture a later rent/medical outlay instead, silently
  // turning a 1.5 万 salary into a 0.35 万 salary.
  const monthlySalaryMatch = evidenceText?.match(/(?:税后)?(?:月薪|副业月收入|个人月收入)(?:\s*(?:从|由)\s*(?:原来(?:的)?|之前(?:的)?)?\s*\d+(?:\.\d+)?\s*(?:万(?:元)?|元))?\s*(?:正式)?(?:约|为|达到|调整为|降至|升至|涨到|维持在|稳定在)?\s*(\d+(?:\.\d+)?)\s*(万(?:元)?|元)/u);
  const monthlySalaryChineseMatch = evidenceText?.match(/(?:税后)?(?:月薪|副业月收入|个人月收入)(?:正式)?(?:约|为|达到|调整为|降至|升至|涨到|维持在|稳定在)?\s*([一二两三四五六七八九十百千万]+)元/u);
  const monthlyTakeHomeMatch = evidenceText && /(?:按月|每月|月度)结算/u.test(evidenceText)
    ? evidenceText.match(/税后到手(?:\s*(?:约|为|有))?\s*(\d+(?:\.\d+)?)\s*(万(?:元)?|元)/u)
    : undefined;
  const monthlyIncomeNamedMatch = evidenceText?.match(/每月[^，。；]{0,18}?(?:工资|薪资|收入|报酬|分红)[^，。；]{0,16}?(?:支付|发放|领取|获得|拿到|为|达到|调整为|降至|升至|涨到|维持在|稳定在)?\s*(\d+(?:\.\d+)?)\s*(万(?:元)?|元)/u);
  const monthlyIncomePaidMatch = evidenceText?.match(/每月[^，。；]{0,16}?(?:支付|发放|领取|获得|拿到)\s*(\d+(?:\.\d+)?)\s*(万(?:元)?|元)(?:税后)?(?:工资|薪资|收入|报酬|分红)/u);
  const monthlyMatch = monthlySalaryMatch || monthlyTakeHomeMatch || monthlyIncomeNamedMatch || monthlyIncomePaidMatch;
  // Real prose frequently combines a change verb with a hedging qualifier
  // (for example, "税后年薪涨到约30万"). The amount is still an explicit
  // personal-income fact and must be allowed to repair a malformed model
  // proposal without lowering the acceptance gate.
  const explicitAnnualIncomeWan = evidenceText
    ? explicitProtagonistAnnualIncomeWan(evidenceText)
    : undefined;
  const annualMatch = evidenceText?.match(/(?:(?:税后)?(?:年薪|年收入)|年税后收入)(?:正式)?(?:约|为|达到|调整为|降至|升至|涨到|维持在|稳定在)?(?:约)?\s*(\d+(?:\.\d+)?)\s*万元?/u);
  if (!explicitlyPersonal || (!monthlyMatch && !monthlySalaryChineseMatch && !annualMatch && explicitAnnualIncomeWan === undefined)) return input.proposals;

  const chineseAmountYuan = (value: string): number | undefined => {
    const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    let total = 0;
    let section = 0;
    let number = 0;
    for (const character of value) {
      if (digits[character] !== undefined) {
        number = digits[character];
        continue;
      }
      const unit = units[character];
      if (!unit) return undefined;
      if (unit === 10000) {
        section += number;
        total += (section || 1) * unit;
        section = 0;
      } else {
        section += (number || 1) * unit;
      }
      number = 0;
    }
    const trailingDigitScale = number > 0 && digits[value.at(-1) || ""] !== undefined
      ? value.includes("万") && !/[十百千]/u.test(value.slice(value.lastIndexOf("万") + 1))
        ? 1000
        : value.includes("千") && !/[十百]/u.test(value.slice(value.lastIndexOf("千") + 1))
          ? 100
          : value.includes("百") && !/十/u.test(value.slice(value.lastIndexOf("百") + 1))
            ? 10
            : 1
      : 1;
    const amount = total + section + number * trailingDigitScale;
    return amount > 0 ? amount : undefined;
  };
  const monthlyNetAmountWan = monthlyMatch
    ? Number(monthlyMatch[1]) * (monthlyMatch[2] === "元" ? 0.0001 : 1)
    : monthlySalaryChineseMatch
      ? (chineseAmountYuan(monthlySalaryChineseMatch[1]) || 0) * 0.0001
      : undefined;
  const annualNetAmountWan = explicitAnnualIncomeWan ?? (annualMatch ? Number(annualMatch[1]) : undefined);
  if (!(Number(monthlyNetAmountWan ?? annualNetAmountWan) > 0)) return input.proposals;
  const careerIncomeTypes = new Set(["salary", "contract", "self_employment_draw"]);
  const allActiveCareerSources = input.ledger.incomeSources.filter((source) => (
    source.status === "active"
    && (careerIncomeTypes.has(source.type)
      || (source.id === "legacy_recurring_income" && Boolean(source.linkedCareerStateId)))
  ));
  const activeCareerSources = allActiveCareerSources.filter((source) => (
    source.status === "active" && source.linkedCareerStateId === input.currentCareerStateId
  ));
  const decisionChangesCareer = /辞职|离职|入职|就职|转岗|转行|回归职场|退休|停止工作/u.test(decision);
  const sideIncomeSources = allActiveCareerSources.filter((source) => (
    source.type === "contract"
    && sideIncomeSignal.test(`${source.displayName} ${source.evidence.map((item) => item.excerpt || "").join(" ")}`)
  ));
  const existingSource = sideIncomeEvidence
    ? (sideIncomeSources.length === 1 ? sideIncomeSources[0] : undefined)
    : (activeCareerSources.length === 1
      ? activeCareerSources[0]
      : (!decisionChangesCareer && allActiveCareerSources.length === 1 ? allActiveCareerSources[0] : undefined));
  // During a completed authoritative transition an adjusted existing source
  // migrates to the accepted next state. Without that authority, keep the
  // existing link so an unsupported candidate CareerState cannot hijack wages.
  const sourceCareerStateId = input.migrateToCurrentCareerState
    ? input.currentCareerStateId
    : existingSource?.linkedCareerStateId || input.currentCareerStateId;
  // A legacy recurring aggregate is deliberately typed as `other` during
  // migration because it has not yet been evidenced as an actual wage. Once
  // the narrator explicitly confirms the protagonist's current income, it
  // must become a real career-income type; otherwise the acceptance gate sees
  // an employed CareerState with no valid active source forever.
  const incomeType = existingSource?.id === "legacy_recurring_income" && existingSource.type === "other"
    ? (input.currentEmploymentStatus === "self_employed" ? "self_employment_draw" : "salary")
    : existingSource?.type
      || (sideIncomeEvidence ? "contract" : undefined)
      || (input.currentEmploymentStatus === "self_employed" ? "self_employment_draw" : "salary");
  const proposalsWithoutCompetingCareerIncome = input.proposals.filter((proposal) => {
    if (proposal.kind === "income_source_started") {
      const type = String((proposal.payload as Record<string, unknown>)?.type);
      return sideIncomeEvidence ? type !== "contract" : !careerIncomeTypes.has(type);
    }
    if (proposal.kind === "income_source_adjusted") {
      if (existingSource
        && (proposal.payload as Record<string, any>)?.incomeSourceId === existingSource.id) return false;
      const type = String((proposal.payload as Record<string, any>)?.nextSource?.type);
      return sideIncomeEvidence ? type !== "contract" : !careerIncomeTypes.has(type);
    }
    return true;
  });
  const source = existingSource ? {
    ...structuredClone(existingSource),
    type: incomeType,
    monthlyNetAmountWan,
    annualNetAmountWan,
    accrualPolicy: monthlyMatch || monthlySalaryChineseMatch ? "monthly" as const : "annual" as const,
    status: "active" as const,
    linkedCareerStateId: sourceCareerStateId,
    factStatus: "known" as const,
    accrualReviewStatus: "normal" as const,
    lastConfirmedAtAgeInMonths: input.periodStartAgeInMonths
  } : {
    id: sideIncomeEvidence
      ? `personal_side_income_${input.currentCareerStateId}`
      : `career_income_${input.currentCareerStateId}`,
    type: incomeType,
    displayName: sideIncomeEvidence
      ? "正文确认的个人副业收入"
      : (input.currentEmploymentStatus === "self_employed" ? "用户确认的创业个人工资" : "用户确认的个人工资"),
    monthlyNetAmountWan,
    annualNetAmountWan,
    accrualPolicy: monthlyMatch || monthlySalaryChineseMatch ? "monthly" as const : "annual" as const,
    activeFromAgeInMonths: input.periodStartAgeInMonths,
    status: "active" as const,
    linkedCareerStateId: sourceCareerStateId,
    factStatus: "known" as const,
    accrualReviewStatus: "normal" as const,
    lastConfirmedAtAgeInMonths: input.periodStartAgeInMonths,
    evidence: []
  };
  return [...proposalsWithoutCompetingCareerIncome, {
    id: `selected_personal_income_${input.periodStartAgeInMonths}`,
    kind: existingSource ? "income_source_adjusted" : "income_source_started",
    effectiveAtAgeInMonths: input.periodStartAgeInMonths,
    sourceOutcomeId: input.acceptedOutcomeId,
    financialScope: "personal",
    evidence: evidenceText!,
    confidence: 1,
    payload: existingSource
      ? { incomeSourceId: existingSource.id, nextSource: source }
      : source
} as FinancialEventProposal];
}

export function resolveAllowedIncomeCareerStateIds(currentCareerStateId: string, nextCareerStateIds: string[]): string[] {
  return nextCareerStateIds.length > 0 ? nextCareerStateIds : [currentCareerStateId];
}

export function narrativeRequiresCareerTransition(input: {
  narrativeText: string;
  currentStatus: CareerState["employmentStatus"];
}): boolean {
  const protagonistSentences = input.narrativeText.split(/(?<=[。！？；])/u)
    .filter((sentence) => /你|你的|你们|本人|自己/u.test(sentence))
    .filter((sentence) => !/(?:母亲|父亲|妈妈|爸爸|伴侣|丈夫|妻子|朋友|同事)[^，。；]{0,20}(?:入职|离职|辞职|退休|换工作|跳槽)/u.test(sentence)
      || /你[^，。；]{0,20}(?:入职|离职|辞职|退休|换工作|跳槽|转岗|转任)/u.test(sentence));
  if (protagonistSentences.length === 0) return false;
  const hypotheticalOnly = (sentence: string) => (
    /(?:如果|若|一旦|是否|考虑|计划|准备|可能|可以|需要|必须|要求|条件|抉择|意向|希望|建议|承诺|未来|三个月内|尚未|还没|未决定|没有决定)/u.test(sentence)
    && !/(?:最终决定|正式|已经|已(?:经)?|于是|随后|当场|递交了?|提交了?|办理了?|签下了?|签署了?|接受了?|入职了?|离职了?|辞职了?|辞去了)/u.test(sentence)
  );
  const negatesExit = (sentence: string) => /(?:不敢|不想|不愿|没有|并未|尚未|还未|不会|暂不)[^。；]{0,16}(?:辞职|离职|退休|停止工作|结束全职)/u.test(sentence);
  const negatesCareerMove = (sentence: string) => /(?:不|没有|并未|尚未|还未|不会|暂不)[^。；]{0,16}(?:换工作|跳槽|转任|转岗|转为[^。；]{0,8}顾问|全职投入创业|再次创业)/u.test(sentence);
  const negatesEmployerRoleInvitation = (sentence: string) => /(?:不|没有|并未|尚未|还未|不会|暂不|拒绝|婉拒)[^。；]{0,16}(?:接受|选择)/u.test(sentence);
  const employmentRelevantText = (sentence: string) => sentence.replace(
    /辞去(?:了)?[^。；]{0,20}(?:外部合伙人|董事|监事|股东)(?:身份|席位|职务)?/gu,
    "退出非雇佣治理角色"
  );
  const switchesEmployer = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && !negatesCareerMove(sentence)
    && /(?:你|本人)[^。；]{0,20}(?:辞职|辞去|辞掉|离职|离开[^。；]{0,12}(?:岗位|公司|平台))[^。；]{0,48}(?:正式)?加入[^。；]{0,20}(?:公司|企业|机构|团队)/u.test(sentence)
  ));
  if (switchesEmployer) return true;
  const startsAcceptedEmployerRole = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && !negatesCareerMove(sentence)
    && !negatesEmployerRoleInvitation(sentence)
    && isAcceptedEmployerRoleInvitation(sentence, "narrative")
    && hasCompletedEmployerStartEvidence(sentence)
 ));
  if (startsAcceptedEmployerRole) return true;
  const startsSelfDirectedVenture = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && !negatesCareerMove(sentence)
    && hasExplicitSelfDirectedVentureEvidence(sentence, "narrative")
  ));
  if (startsSelfDirectedVenture && input.currentStatus !== "self_employed") return true;
  const stopsWorking = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && !negatesExit(sentence)
    && /(?:你|本人)[^。；]{0,24}(?:正式退休|办理退休|已经退休|已退休|最终决定[^。；]{0,8}(?:离职|辞职|辞去|停止工作)|正式离职|正式辞职|已经离职|已经辞职|辞去了|停止了?工作|结束了?全职工作)|(?:正式退休|办理退休)[^。；]{0,16}你/u.test(employmentRelevantText(sentence))
  ));
  if (stopsWorking && !["retired", "not_working"].includes(input.currentStatus)) return true;
  // Handing in a resignation is an auditable change of intent, but the old
  // job can remain active through its handover.  It only proves a replacement
  // CareerState together with a completed start at the new employer below.
  const submittedCurrentJobExit = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && !negatesExit(sentence)
    && /(?:你|本人)[^。；]{0,24}(?:递交了?辞呈|提交了?(?:辞职|离职)(?:申请)?)/u.test(employmentRelevantText(sentence))
  ));
  const startsWorking = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && (hasCompletedEmployerStartEvidence(sentence) || /新公司[^。；]{0,40}你(?:负责|担任|任职)/u.test(sentence))
  ));
  // A completed external employer start also replaces a self-employed status.
  // Without this branch, the prose can declare a stable paid job while the
  // later income synthesizer still sees the obsolete founder state and writes
  // an owner draw instead of salary.
  if (startsWorking && ["student", "not_working", "retired", "medical_leave", "self_employed"].includes(input.currentStatus)) return true;
  // An already-employed protagonist needs a new CareerState too when this
  // period completes both sides of an employer switch.  Do not infer that
  // transition from an isolated resignation or a generic old onboarding
  // memory: require a completed new employer start and a non-negated current
  // job exit in the same candidate.
  if (startsWorking && input.currentStatus === "employed" && (stopsWorking || submittedCurrentJobExit)) return true;
  return protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && !negatesCareerMove(sentence)
    && /你[^。；]{0,24}(?:(?:正式|已经|已)[^。；]{0,8})(?:换工作|跳槽|转任|转岗|转为[^。；]{0,8}顾问|全职投入创业|再次创业)/u.test(sentence)
  ));
}

function attachPendingFinancialContext(input: {
  node: SimulationNode;
  previousState: FinancialState;
}): SimulationNode {
  return {
    ...input.node,
    descriptionParagraphs: input.node.descriptionParagraphs?.length
      ? input.node.descriptionParagraphs
      : splitNarrativeParagraphs(input.node.description),
    financialState: structuredClone(input.previousState),
    financialSignals: undefined,
    financialChange: undefined
  };
}

/**
 * Financial reconciliation reads a candidate WorldState, never a state that
 * has already been committed by a later simulation step. The preview applies
 * only cross-domain facts that have passed their own acceptance path: romantic
 * residence transitions, person status deltas, health deltas and accepted
 * CareerState transitions. It intentionally does not use prose alone as a
 * source of WorldState authority.
 */
export function previewExpenseCandidateWorldState(input: {
  current: WorldStateSnapshot;
  node: SimulationNode;
  acceptedOutcome?: AcceptedNodeOutcome;
  acceptedCareerTransitions?: AcceptedCareerTransition[];
  acceptedOutcomeId?: string;
  ageInMonths: number;
}): WorldStateSnapshot {
  if (!input.acceptedOutcomeId) return input.current;
  const next = structuredClone(input.current);
  next.relationships ||= [];
  const transitions = (input.node.narrativeMeta?.relationshipProposals || []).filter((proposal): proposal is Extract<RelationshipProposal, { type: "romantic_transition" }> => (
    proposal.type === "romantic_transition"
    && proposal.sourceOutcomeId === input.acceptedOutcomeId
    && Boolean(proposal.evidence?.trim())
  ));
  for (const transition of transitions) {
    if (!transition.toStage || !["cohabiting", "married"].includes(transition.toStage)) continue;
    const residenceConfirmed = /同居|共同生活|一起住|搬到.{0,16}(?:住|公寓|家)|搬入.{0,16}(?:住|公寓|家)/u.test(
      `${transition.evidence} ${input.node.description}`
    );
    if (!residenceConfirmed) continue;
    const index = next.relationships.findIndex((relationship) => (
      relationship.id === transition.relationshipId
      || (transition.personId !== undefined && relationship.participantPersonIds.includes(transition.personId))
    ));
    if (index >= 0) {
      next.relationships[index] = {
        ...next.relationships[index],
        stage: transition.toStage,
        livingTogether: true,
        effectiveFromAgeInMonths: input.ageInMonths,
        responsibilitySummary: transition.evidence,
        source: "accepted_history",
        confidence: Math.max(next.relationships[index].confidence, 0.9)
      };
      continue;
    }
    next.relationships.push({
      id: transition.relationshipId || `candidate_relationship_${transition.personId || input.ageInMonths}`,
      participantPersonIds: transition.personId ? [transition.personId] : [],
      type: "romantic",
      stage: transition.toStage,
      status: "active",
      livingTogether: true,
      effectiveFromAgeInMonths: input.ageInMonths,
      responsibilitySummary: transition.evidence,
      source: "accepted_history",
      confidence: 0.9
    });
  }
  for (const delta of input.acceptedOutcome?.worldDeltas || []) {
    if (delta.type === "location_change") {
      // Location is a structured accepted delta. Carry it into the same
      // candidate WorldState used for responsibility and policy evaluation;
      // do not make residence/city decisions from prose alone.
      next.locationSummary = delta.summary;
      const residence = acceptedResidenceOccupancyState({ delta, ageInMonths: input.ageInMonths });
      if (residence) next.residence = residence;
      continue;
    }
    if (delta.type === "health_state") {
      next.healthSummary = delta.summary;
      continue;
    }
    if (delta.type === "person_status") {
      const personIndex = next.people.findIndex((person) => person.id === delta.personId);
      if (personIndex >= 0) {
        next.people[personIndex] = {
          ...next.people[personIndex],
          lifeStatus: delta.status,
          source: "accepted_history",
          confidence: Math.max(next.people[personIndex].confidence, 0.9)
        };
      }
    }
  }
  for (const transition of input.acceptedCareerTransitions || []) {
    const nextCareerState = transition.nextCareerState;
    next.careerStates ||= [];
    const existingIndex = next.careerStates.findIndex((state) => state.id === nextCareerState.id);
    if (existingIndex >= 0) next.careerStates[existingIndex] = structuredClone(nextCareerState);
    else next.careerStates.push(structuredClone(nextCareerState));
    next.currentCareerStateId = nextCareerState.id;
    next.currentEmploymentStatus = nextCareerState.employmentStatus;
    next.careerRevision = Math.max(next.careerRevision || 0, input.current.careerRevision || 0) + 1;
    next.version = 2;
  }
  return next;
}

function cityCostBandFromAcceptedLocation(locationSummary: string | undefined): "low" | "medium" | "high" | "unknown" {
  if (!locationSummary) return "unknown";
  if (/北京|上海|深圳|广州|杭州|一线|核心城区|高房价/u.test(locationSummary)) return "high";
  if (/县城|乡镇|小城|低成本/u.test(locationSummary)) return "low";
  if (/成都|武汉|西安|南京|重庆|天津|苏州|二线|中等成本/u.test(locationSummary)) return "medium";
  return "unknown";
}

/**
 * Policy context is derived solely from the accepted candidate WorldState and
 * the current ledger. It never turns marriage, age or a city name into a new
 * expense by itself; it only calibrates an already-authoritative unknown
 * responsibility that the lifecycle reconciler has chosen to review/start.
 */
export function expenseEstimateContextFromAuthority(input: {
  candidateWorldState: WorldStateSnapshot;
  ledger: FinancialLedger;
  node: SimulationNode;
}): Omit<ExpenseResponsibilityEstimateContext, "responsibilityKind" | "ageInMonths"> {
  const ownerOccupied = input.ledger.assetAccounts.some((account) => (
    account.type === "property" && account.status === "active"
  ));
  const hasConfirmedCohabitation = input.candidateWorldState.relationships?.some((relationship) => (
    relationship.type === "romantic"
    && relationship.status === "active"
    && relationship.livingTogether === true
  ));
  // Do not infer free housing merely from family/relationship state. An
  // accepted third-party/provided residence may calibrate basic living without
  // becoming a personal housing charge; business premises remain excluded.
  const acceptedResidenceContext = input.candidateWorldState.residence
    && input.candidateWorldState.residence.financialScope !== "business_operating"
    ? input.candidateWorldState.residence
    : undefined;
  const livingArrangement: ExpenseLivingArrangement = acceptedResidenceContext?.livingArrangement
    || (ownerOccupied ? "owner_occupied" : hasConfirmedCohabitation ? "unknown" : "unknown");
  const cohabitingPartnerIds = new Set((input.candidateWorldState.relationships || [])
    .filter((relationship) => relationship.type === "romantic" && relationship.status === "active" && relationship.livingTogether)
    .flatMap((relationship) => relationship.participantPersonIds));
  const activeChildren = (input.candidateWorldState.people || []).filter((person) => (
    person.relation === "child" && ["active", "limited"].includes(person.lifeStatus)
  )).length;
  return {
    cityCostBand: cityCostBandFromAcceptedLocation(input.candidateWorldState.locationSummary),
    livingArrangement,
    householdSize: 1 + cohabitingPartnerIds.size + activeChildren,
    lifeStage: input.node.lifeStage || input.node.stage,
    employmentStatus: input.candidateWorldState.careerStates?.find((state) => (
      state.id === input.candidateWorldState.currentCareerStateId
    ))?.employmentStatus || input.candidateWorldState.currentEmploymentStatus
  };
}

function expenseCommitmentIdFromLifecycleEvent(event: AcceptedFinancialEvent): string | undefined {
  switch (event.kind) {
    case "expense_commitment_started":
      return event.payload.id;
    case "expense_commitment_adjusted":
    case "expense_commitment_ended":
      return event.payload.expenseCommitmentId;
    default:
      return undefined;
  }
}

function expenseLifecycleActionFromEvent(
  event: AcceptedFinancialEvent
): ExpenseLifecycleProjectedCommitmentChange["action"] | undefined {
  if (event.kind === "expense_commitment_started") return "start";
  if (event.kind === "expense_commitment_ended") return "end";
  if (event.kind === "expense_commitment_adjusted") {
    return event.acceptedByReasonCodes.includes("SYSTEM_POLICY_REVIEW")
      || event.proposalId?.startsWith("system_expense_review_")
      ? "review"
      : "adjust";
  }
  return undefined;
}

/**
 * Describe only the lifecycle plan events, but look up their state in the
 * result of the complete transaction preview.  This preserves the exact
 * production reducer semantics while making shadow output independently
 * inspectable without touching the authoritative ledger.
 */
function buildProjectedExpenseLifecycleChanges(input: {
  beforeLedger: FinancialLedger;
  projectedLedger: FinancialLedger;
  lifecycleEvents: AcceptedFinancialEvent[];
}): ExpenseLifecycleProjectedCommitmentChange[] {
  const beforeById = new Map(input.beforeLedger.expenseCommitments.map((commitment) => [commitment.id, commitment]));
  const projectedById = new Map(input.projectedLedger.expenseCommitments.map((commitment) => [commitment.id, commitment]));
  const seen = new Set<string>();
  const changes: ExpenseLifecycleProjectedCommitmentChange[] = [];
  for (const event of input.lifecycleEvents) {
    const commitmentId = expenseCommitmentIdFromLifecycleEvent(event);
    const action = expenseLifecycleActionFromEvent(event);
    if (!commitmentId || !action || seen.has(`${action}:${commitmentId}`)) continue;
    seen.add(`${action}:${commitmentId}`);
    const before = beforeById.get(commitmentId);
    const after = projectedById.get(commitmentId);
    const startPayload = event.kind === "expense_commitment_started" ? event.payload : undefined;
    const source = after || before || startPayload;
    if (!source?.responsibilityKey || !source.responsibilityKind) continue;
    const financialScope = source.financialScope === "personal" || source.financialScope === "shared_household"
      ? source.financialScope
      : undefined;
    changes.push({
      action,
      commitmentId,
      responsibilityKey: source.responsibilityKey,
      responsibilityKind: source.responsibilityKind,
      beforeMonthlyAmountWan: before?.monthlyAmountWan,
      afterMonthlyAmountWan: after?.monthlyAmountWan,
      beforeStatus: before?.status,
      afterStatus: after?.status,
      amountBasis: after?.amountBasis || before?.amountBasis || startPayload?.amountBasis,
      financialScope
    });
  }
  return changes;
}

/**
 * Persist a candidate-level trace alongside the aggregate preview.  The
 * amount fields intentionally describe only what the candidate supplied;
 * policy-derived commitment amounts remain in `projectedCommitmentChanges`.
 * This makes an absent amount auditable as unknown instead of looking like a
 * generated zero or an asserted human fact.
 */
function buildExpenseLifecycleCandidateTelemetry(input: {
  candidates: ExpenseResponsibilityCandidate[];
  decisions: ExpenseCommitmentReconciliationCandidateDecision[];
  validationIssues?: FinancialLedgerIssue[];
  mode: ExpenseLifecycleMode;
  acceptedProposalIds: Set<string>;
}): ExpenseLifecycleCandidateTelemetry[] {
  const decisionByCandidateId = new Map(input.decisions.map((decision) => [decision.candidateId, decision]));
  const validationIssuesByProposalId = new Map<string, FinancialLedgerIssue[]>();
  for (const issue of input.validationIssues || []) {
    for (const proposalId of issue.relatedProposalIds || []) {
      const items = validationIssuesByProposalId.get(proposalId) || [];
      items.push(issue);
      validationIssuesByProposalId.set(proposalId, items);
    }
  }
  return input.candidates.map((candidate) => {
    const decision = decisionByCandidateId.get(candidate.id) || {
      candidateId: candidate.id,
      disposition: "ignored" as const,
      reasonCodes: ["MISSING_RECONCILIER_DECISION"],
      relatedProposalIds: [],
      relatedIssueIds: [],
      wouldBlock: false
    };
    const validationIssues = decision.relatedProposalIds.flatMap((proposalId) => (
      validationIssuesByProposalId.get(proposalId) || []
    ));
    const blockingValidationIssue = validationIssues.find((issue) => issue.severity === "blocking");
    const sourceGrossMonthlyAmountWan = Number.isFinite(candidate.explicitMonthlyTotalWan)
      ? candidate.explicitMonthlyTotalWan
      : undefined;
    const sourceMonthlyAmountWan = Number.isFinite(candidate.protagonistShareWan)
      ? candidate.protagonistShareWan
      : sourceGrossMonthlyAmountWan !== undefined && Number.isFinite(candidate.shareRate)
        ? Number((sourceGrossMonthlyAmountWan * candidate.shareRate!).toFixed(4))
        : sourceGrossMonthlyAmountWan;
    const amountBasis = Number.isFinite(candidate.protagonistShareWan)
      ? "explicit_protagonist_share" as const
      : sourceGrossMonthlyAmountWan !== undefined && Number.isFinite(candidate.shareRate)
        ? "explicit_shared_amount" as const
        : sourceGrossMonthlyAmountWan !== undefined
          ? "explicit_monthly_amount" as const
          : "unknown" as const;
    return {
      candidateId: candidate.id,
      responsibilityKey: candidate.responsibilityKey,
      responsibilityKind: candidate.responsibilityKind,
      proposedType: candidate.proposedType,
      financialScope: candidate.financialScope,
      action: candidate.action,
      cadence: candidate.cadence,
      liability: candidate.liability,
      source: candidate.source,
      amountBasis,
      sourceMonthlyAmountWan,
      sourceGrossMonthlyAmountWan,
      shareRate: candidate.shareRate,
      amountSourceId: candidate.amountSourceId,
      sourceFactBindingId: candidate.sourceFactBindingId,
      sourceSpans: candidate.sourceSpans,
      sourceClause: candidate.sourceClause,
      sourceMateriality: candidate.sourceMateriality,
      unresolvedFields: candidate.unresolvedFields,
      sourceBindingReasonCodes: candidate.sourceBindingReasonCodes,
      evidenceReasonCodes: [...new Set(candidate.evidence.map((evidence) => evidence.reasonCode).filter(Boolean))],
      reconcilerDisposition: blockingValidationIssue ? "blocked" : decision.disposition,
      reconcilerReasonCodes: [...new Set([
        ...decision.reasonCodes,
        ...validationIssues.map((issue) => `VALIDATION_${issue.code}`)
      ])],
      relatedProposalIds: decision.relatedProposalIds,
      relatedIssueIds: [...new Set([
        ...decision.relatedIssueIds,
        ...validationIssues.map((issue) => issue.id)
      ])],
      wouldBlock: decision.wouldBlock || Boolean(blockingValidationIssue),
      finalDisposition: input.mode === "shadow"
        ? "prospective_shadow"
        : decision.relatedProposalIds.some((proposalId) => input.acceptedProposalIds.has(proposalId))
          ? "committed"
          : "rejected"
    };
  });
}

function hasNewBaselineDownwardBlock(input: {
  beforeLedger: FinancialLedger;
  projectedLedger: FinancialLedger;
}): boolean {
  const evidenceCount = (ledger: FinancialLedger, commitmentId: string) => ledger.expenseCommitments
    .find((commitment) => commitment.id === commitmentId)
    ?.evidence.filter((evidence) => evidence.reasonCode === "BASIC_LIVING_DOWNWARD_REPLACEMENT_BLOCKED").length || 0;
  return input.projectedLedger.expenseCommitments.some((commitment) => (
    evidenceCount(input.projectedLedger, commitment.id) > evidenceCount(input.beforeLedger, commitment.id)
  ));
}

async function commitAuthoritativeFinancialProgress(input: {
  node: SimulationNode;
  rawNode: any;
  previousState: FinancialState;
  currentLedger?: SimulationNode["financialLedger"];
  previousDebtHealthState?: SimulationNode["debtHealthState"];
  currentWorldState: ReturnType<typeof emptyWorldState>;
  /**
   * State before deterministic person/family reconstruction for this node.
   * It is used only to classify a current→candidate responsibility delta;
   * authoritative WorldState still commits through the normal transaction.
   */
  expenseLifecycleBaselineWorldState?: WorldStateSnapshot;
  acceptedOutcome: AcceptedNodeOutcome;
  acceptedOutcomeId?: string;
  selectedDecision?: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  transactionId: string;
  previousWealth: number;
  callAiJson: AiJsonCaller;
  financialNodeGateMode: FinancialNodeGateMode;
  expenseLifecycleMode: ExpenseLifecycleMode;
  expenseNarrativeBindingMode: ExpenseNarrativeBindingMode;
  onFinancialGateDecision?: (decision: FinancialNodeAcceptanceDecision) => void;
  financialGateRegenerationCount: number;
  nodeIndex?: number;
  onGenerationCallTrace?: GenerationTraceListener;
  generationBudget: NodeGenerationBudget;
}): Promise<{
  node: SimulationNode;
  worldState: ReturnType<typeof emptyWorldState>;
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  rejectedFinancialProposalIds: string[];
}> {
  const processingStartedAt = Date.now();
  let repairTriggered = false;
  let repairLatencyMs = 0;
  let repairedCareerAttempted = false;
  const narrativeFallbackReasonCodes: string[] = [];
  const currentCareer = currentCareerState(input.currentWorldState)!;
  const currentCareerCollection = {
    careerStates: input.currentWorldState.careerStates || [currentCareer],
    currentCareerStateId: currentCareer.id,
    careerRevision: input.currentWorldState.careerRevision || 0
  };
  let rejectedEmploymentTransition: EmploymentTransitionProposal | undefined;
  const careerValidationIssues: FinancialLedgerIssue[] = [];
  const pendingEmployerOfferResolutionDelta = input.acceptedOutcome.worldDeltas.find((delta): delta is Extract<WorldDelta, { type: "career_state" }> => (
    delta.type === "career_state" && Boolean(delta.pendingEmployerOfferResolution)
  ));
  const submittedPendingEmployerOfferResolution = pendingEmployerOfferResolutionDelta?.pendingEmployerOfferResolution;
  let acceptedCareerTransitions = input.acceptedOutcome.worldDeltas.flatMap((delta, index) => {
    if (delta.type !== "career_state" || !delta.employmentTransition || !input.acceptedOutcomeId) return [];
    try {
      const proposal = adaptTransitionalEmploymentProposal({
        proposal: delta.employmentTransition,
        currentCareerState: currentCareer,
        proposalId: `${input.transactionId}_${index}`,
        acceptedOutcomeId: input.acceptedOutcomeId
      });
      return [validateAndAcceptCareerTransition({
        proposal,
        currentCareerState: currentCareer,
        acceptedOutcomeId: input.acceptedOutcomeId,
        narrativeText: input.node.description,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths
      })];
    } catch (error) {
      rejectedEmploymentTransition = delta.employmentTransition;
      careerValidationIssues.push({
        id: `career_transition_issue_${input.transactionId}_${index}`,
        code: "CAREER_INCOME_CONFLICT",
        severity: "blocking",
        status: "open",
        relatedProposalIds: [],
        summary: error instanceof Error ? error.message : "职业转换未通过权威校验",
        createdAtAgeInMonths: input.periodEndAgeInMonths
      });
      return [];
    }
  });
  if (acceptedCareerTransitions.length === 0 && input.acceptedOutcomeId) {
    const misplacedTransition = extractMisplacedEmploymentTransition(input.rawNode);
    if (misplacedTransition) {
      try {
        const proposal = adaptTransitionalEmploymentProposal({
          proposal: misplacedTransition,
          currentCareerState: currentCareer,
          proposalId: `${input.transactionId}_misplaced_career`,
          acceptedOutcomeId: input.acceptedOutcomeId
        });
        acceptedCareerTransitions = [validateAndAcceptCareerTransition({
          proposal,
          currentCareerState: currentCareer,
          acceptedOutcomeId: input.acceptedOutcomeId,
          narrativeText: input.node.description,
          periodStartAgeInMonths: input.periodStartAgeInMonths,
          periodEndAgeInMonths: input.periodEndAgeInMonths
        })];
      } catch (error) {
        rejectedEmploymentTransition = misplacedTransition;
        careerValidationIssues.push({
          id: `career_transition_misplaced_issue_${input.transactionId}`,
          code: "CAREER_INCOME_CONFLICT",
          severity: "blocking",
          status: "open",
          relatedProposalIds: [],
          summary: error instanceof Error ? error.message : "错位的职业转换未通过权威校验",
          createdAtAgeInMonths: input.periodEndAgeInMonths
        });
      }
    }
  }
  if (input.acceptedOutcomeId) {
    const synthesizedTransition = synthesizeSelectedCareerTransition({
      selectedDecision: input.selectedDecision,
      narrativeText: input.node.description,
      acceptedOutcomeId: input.acceptedOutcomeId,
      effectiveAtAgeInMonths: input.periodStartAgeInMonths,
      currentStatus: currentCareer.employmentStatus
    });
    const conflictsWithSelectedChoice = synthesizedTransition
      && acceptedCareerTransitions.some((transition) => (
        transition.nextCareerState.employmentStatus !== synthesizedTransition.toStatus
      ));
    if (synthesizedTransition && (acceptedCareerTransitions.length === 0 || conflictsWithSelectedChoice)) {
      try {
        const proposal = adaptTransitionalEmploymentProposal({
          proposal: synthesizedTransition,
          currentCareerState: currentCareer,
          proposalId: `${input.transactionId}_selected_career`,
          acceptedOutcomeId: input.acceptedOutcomeId
        });
        acceptedCareerTransitions = [validateAndAcceptCareerTransition({
          proposal,
          currentCareerState: currentCareer,
          acceptedOutcomeId: input.acceptedOutcomeId,
          narrativeText: [input.node.description, input.selectedDecision].filter(Boolean).join("\n"),
          periodStartAgeInMonths: input.periodStartAgeInMonths,
          periodEndAgeInMonths: input.periodEndAgeInMonths
        })];
      } catch (error) {
        careerValidationIssues.push({
          id: `career_transition_selected_issue_${input.transactionId}`,
          code: "CAREER_INCOME_CONFLICT",
          severity: "blocking",
          status: "open",
          relatedProposalIds: [],
          summary: error instanceof Error ? error.message : "用户选择要求的职业转换未通过权威校验",
          createdAtAgeInMonths: input.periodEndAgeInMonths
        });
      }
    }
  }
  let nextCareerIds = acceptedCareerTransitions.map((transition) => transition.nextCareerState.id);
  // A bare acceptance of an external offer is represented by the pending
  // offer state above.  It becomes a CareerState transition only after actual
  // entry is established in the accepted outcome and its salary is known.
  const selectedDecision = input.selectedDecision || "";
  const selectedEmployerOfferEvidence = [selectedDecision, input.node.description].filter(Boolean).join("\n");
  const selectedEmployerRoleStarted = hasCompletedAcceptedEmployerRoleStart({
    selectedDecision,
    narrativeText: input.node.description
  });
  const selectedDecisionIsPendingEmployerOffer = isAcceptedEmployerRoleInvitation(selectedDecision)
    && !hasCompletedEmployerStartEvidence(selectedEmployerOfferEvidence)
    && !selectedEmployerRoleStarted;
  const selectedDecisionDemandsCareerTransition = !selectedDecisionIsPendingEmployerOffer && (
    selectedDecisionRequiresCareerTransition(selectedDecision)
    || hasCompletedEmployerStartEvidence(selectedEmployerOfferEvidence)
    || selectedEmployerRoleStarted
  );
  const initialPendingOfferStartResolutionIssue = pendingEmployerOfferStartResolutionIssue({
    current: input.currentWorldState.pendingEmployerOffer,
    acceptedOutcomeId: input.acceptedOutcomeId,
    resolution: submittedPendingEmployerOfferResolution,
    acceptedCareerTransitions,
    transactionId: input.transactionId,
    ageInMonths: input.periodEndAgeInMonths
  });
  if (initialPendingOfferStartResolutionIssue) careerValidationIssues.push(initialPendingOfferStartResolutionIssue);
  const careerTransitionRequired = selectedDecisionDemandsCareerTransition || narrativeRequiresCareerTransition({
    narrativeText: input.node.description,
    currentStatus: currentCareer.employmentStatus
  });
  if (careerTransitionRequired && acceptedCareerTransitions.length === 0 && careerValidationIssues.length === 0) {
    careerValidationIssues.push({
      id: `career_transition_missing_${input.transactionId}`,
      code: "CAREER_INCOME_CONFLICT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      summary: `已接受选择或正文明确要求主人公职业转换，但本轮没有通过校验的 employmentTransition：${input.selectedDecision || "正文事实"}`,
      createdAtAgeInMonths: input.periodEndAgeInMonths
    });
  }
  // Persisted history may still contain a v2 ledger. Upgrade a cloned candidate
  // at the simulation boundary; never rewrite the historical snapshot in place.
  const migratedCurrentLedger = input.currentLedger
    ? isFinancialLedgerV4(input.currentLedger)
      ? structuredClone(input.currentLedger)
      : migrateFinancialLedgerV2ToV3(input.currentLedger as unknown as FinancialLedgerInput)
    : undefined;
  const compatibleInitialLedger = migratedCurrentLedger?.asOfAgeInMonths === input.periodStartAgeInMonths
    ? migratedCurrentLedger
    : migrateLegacyFinancialState({
        id: input.currentLedger?.id || `financial_${input.transactionId}`,
        legacyState: input.previousState,
        linkedCareerStateId: currentCareer.id
      });
  // New transactions never write V3 commitments.  The upgrade is prospective:
  // it clones the historical snapshot and preserves its previous cash rather
  // than replaying or correcting past periods.
  const migrationPreflight = isFinancialLedgerV4(compatibleInitialLedger)
    ? undefined
    : preflightFinancialLedgerV3ToV4(compatibleInitialLedger as FinancialLedgerV3);
  // A migration candidate may be useful for audit, but it is never a legal
  // authority write while it carries a blocking conflict (for example an
  // unmatched mortgage payment).  Stopping here happens before Preview,
  // period accrual, WorldState reduction or History construction.
  if (migrationPreflight && !migrationPreflight.canEnableV4) {
    throw new FinancialLedgerInvariantError(
      "INVALID_LEDGER",
      `FinancialLedger V3→V4 迁移存在阻断冲突：${migrationPreflight.blockingIssues.map((item) => item.code).join("、")}`
    );
  }
  const initialLedger = isFinancialLedgerV4(compatibleInitialLedger)
    ? compatibleInitialLedger
    : migrationPreflight!.ledger;
  const normalizedFinancial = normalizeFinancialProposals({
        proposals: rawFinancialEventProposals(input.rawNode),
        acceptedOutcomeIds: input.acceptedOutcomeId ? [input.acceptedOutcomeId] : [],
        currentLedger: initialLedger,
        currentCareerStateId: currentCareer.id,
    nextCareerStateIds: nextCareerIds
  });
  normalizedFinancial.proposals = synthesizeMissingDebtCompletionProposals({
    proposals: normalizedFinancial.proposals,
    narrativeText: input.node.description,
    acceptedOutcomeId: input.acceptedOutcomeId,
    effectiveAtAgeInMonths: input.periodEndAgeInMonths
  });
  normalizedFinancial.proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: normalizedFinancial.proposals,
    narrativeText: input.node.description,
    selectedDecision: input.selectedDecision,
    acceptedOutcomeId: input.acceptedOutcomeId,
    effectiveAtAgeInMonths: input.periodEndAgeInMonths,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    ledger: initialLedger
  });
  normalizedFinancial.proposals = synthesizeMissingBusinessOptionGrantProposal({
    proposals: normalizedFinancial.proposals,
    narrativeText: input.node.description,
    acceptedOutcomeId: input.acceptedOutcomeId,
    effectiveAtAgeInMonths: input.periodEndAgeInMonths,
    ledger: initialLedger
  });
  normalizedFinancial.proposals = synthesizeSelectedPersonalIncomeProposal({
    proposals: normalizedFinancial.proposals,
    selectedDecision: input.selectedDecision,
    narrativeText: input.node.description,
    allowNarrativeEvidence: true,
    acceptedOutcomeId: input.acceptedOutcomeId,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    currentCareerStateId: nextCareerIds.length === 1 ? nextCareerIds[0] : currentCareer.id,
    currentEmploymentStatus: acceptedCareerTransitions.length === 1
      ? acceptedCareerTransitions[0].nextCareerState.employmentStatus
      : currentCareer.employmentStatus,
    migrateToCurrentCareerState: acceptedCareerTransitions.length === 1,
    suppressEmployerSalarySynthesis: selectedDecisionIsPendingEmployerOffer,
    ledger: initialLedger
  });
  normalizedFinancial.proposals = completeCareerIncomeReplacementProposals({
    proposals: normalizedFinancial.proposals,
    currentLedger: initialLedger,
    currentCareerStateId: currentCareer.id,
    transition: acceptedCareerTransitions[0],
    acceptedOutcomeId: input.acceptedOutcomeId
  });
  const suppressedPendingOfferIncomeProposals: FinancialEventProposal[] = [];
  if (selectedDecisionIsPendingEmployerOffer) {
    normalizedFinancial.proposals = normalizedFinancial.proposals.filter((proposal) => {
      if (proposal.sourceOutcomeId !== input.acceptedOutcomeId
        || !isEmployerSalaryMutationProposal({ proposal, ledger: initialLedger })) return true;
      suppressedPendingOfferIncomeProposals.push(proposal);
      return false;
    });
  }
  let finalCandidateProposals = normalizedFinancial.proposals;
  const validationInput = {
        currentLedger: initialLedger,
        currentCareerState: currentCareer,
        acceptedOutcomeId: input.acceptedOutcomeId,
        narrativeText: [input.node.description, input.selectedDecision].filter(Boolean).join("\n"),
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths,
        simulationTransactionId: input.transactionId,
        allowedCareerStateIds: resolveAllowedIncomeCareerStateIds(currentCareer.id, nextCareerIds),
        // Model proposals always trial with explicit funding. Deterministic
        // recurring obligations retain the production shortfall policy at the
        // final domain commit below.
        liquidityPolicy: "require_explicit" as const,
        enforceExpenseConfirmation: true
      };
  let validated = validateFinancialProposals({
        proposals: normalizedFinancial.proposals,
        ...validationInput
      });
  validated = {
    ...validated,
    issues: [...validated.issues, ...detectNarrativeFinancialCoverageIssues({
      narrativeText: input.node.description,
      ledger: initialLedger,
      acceptedEvents: validated.acceptedEvents,
      ageInMonths: input.periodEndAgeInMonths,
      periodStartAgeInMonths: input.periodStartAgeInMonths
    })]
  };
  const completenessIssues: FinancialLedgerIssue[] = [];
  const acceptedIncomeIds = new Set(validated.acceptedEvents.flatMap((event) => {
    const payload = event.payload as Record<string, any>;
    return [payload.incomeSourceId, payload.nextSource?.id, event.kind === "income_source_started" ? payload.id : undefined]
      .filter((value): value is string => typeof value === "string");
  }));
  if (input.periodEndAgeInMonths >= 55 * 12) {
    for (const source of initialLedger.incomeSources) {
      const lastConfirmedAt = source.lastConfirmedAtAgeInMonths ?? source.activeFromAgeInMonths;
      if (!requiresHardLateLifeCareerIncomeResolution({ source, currentCareerStateId: currentCareer.id })
        || acceptedIncomeIds.has(source.id)
        || input.periodStartAgeInMonths - lastConfirmedAt < 36) continue;
      completenessIssues.push({
        id: `proposal_issue_stale_late_career_${source.id}`,
        code: "CAREER_STATE_STALE",
        severity: "blocking",
        status: "open",
        relatedProposalIds: [],
        relatedIncomeSourceIds: [source.id],
        summary: `55岁后职业收入 ${source.id} 已超过36个月没有主人公工作证据；必须确认继续工作和收入，或提交离职/退休与工资结束事实`,
        createdAtAgeInMonths: input.periodEndAgeInMonths
      });
    }
  }
  completenessIssues.push(...collectPersonalIncomeNarrativeContractIssues({
    narrativeText: input.node.description,
    acceptedFinancialEvents: validated.acceptedEvents,
    ageInMonths: input.periodEndAgeInMonths,
    currentLedger: initialLedger
  }));
  validated = { ...validated, issues: [...validated.issues, ...careerValidationIssues, ...completenessIssues] };
  const blockingIssues = validated.issues.filter((issue) => issue.severity === "blocking");
  const rejectedIds = new Set(blockingIssues.flatMap((issue) => issue.relatedProposalIds));
  const everRejectedProposalIds = new Set(rejectedIds);
  if (input.acceptedOutcomeId && blockingIssues.length > 0 && canPatch(input.generationBudget)) {
    consumeModelPatch(input.generationBudget);
    const rejectedProposals = normalizedFinancial.proposals.filter((proposal) => rejectedIds.has(proposal.id));
    try {
      repairTriggered = true;
      const repairStartedAt = Date.now();
      const repairPrompt = buildFinancialProposalRepairPrompt({
        rejectedProposals,
        rejectedEmploymentTransition,
        issues: blockingIssues,
        ledger: initialLedger,
        acceptedOutcomeId: input.acceptedOutcomeId,
        narrativeText: input.node.description,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths
      });
      const repairedRaw = parseAiJsonResponse(await traceGenerationCall({
        kind: "proposal_repair",
        context: {
          transactionId: input.transactionId,
          nodeIndex: input.nodeIndex,
          promptFamily: "financial_proposal_repair",
          issueCodes: blockingIssues.map((issue) => issue.code)
        },
        listener: input.onGenerationCallTrace,
        operation: async (markFirstToken, recordResponseMetadata) => {
          const response = await input.callAiJson(repairPrompt);
          recordResponseMetadata(response);
          markFirstToken();
          return response;
        }
      }));
      repairLatencyMs = Date.now() - repairStartedAt;
      const repairedEmploymentTransition = acceptedCareerTransitions.length === 0
        ? normalizeRepairedEmploymentTransition({
            raw: repairedRaw?.employmentTransition,
            fallback: rejectedEmploymentTransition,
            acceptedOutcomeId: input.acceptedOutcomeId,
            narrativeText: input.node.description,
            periodStartAgeInMonths: input.periodStartAgeInMonths
          })
        : undefined;
      if (repairedEmploymentTransition) {
        repairedCareerAttempted = true;
        try {
          const proposal = adaptTransitionalEmploymentProposal({
            proposal: repairedEmploymentTransition,
            currentCareerState: currentCareer,
            proposalId: `${input.transactionId}_repair_career`,
            acceptedOutcomeId: input.acceptedOutcomeId
          });
          acceptedCareerTransitions = [validateAndAcceptCareerTransition({
            proposal,
            currentCareerState: currentCareer,
            acceptedOutcomeId: input.acceptedOutcomeId,
            narrativeText: input.node.description,
            periodStartAgeInMonths: input.periodStartAgeInMonths,
            periodEndAgeInMonths: input.periodEndAgeInMonths
          })];
          nextCareerIds = acceptedCareerTransitions.map((transition) => transition.nextCareerState.id);
        } catch {
          acceptedCareerTransitions = [];
          nextCareerIds = [];
        }
      }
      const repairedNormalized = normalizeRepairedFinancialProposals({
        proposals: repairedRaw?.financialEventProposals,
        rejectedProposals,
        acceptedOutcomeIds: [input.acceptedOutcomeId],
        currentLedger: initialLedger,
        currentCareerStateId: currentCareer.id,
        nextCareerStateIds: nextCareerIds,
        narrativeText: input.node.description
      });
      const initiallyAcceptedIds = new Set(validated.acceptedEvents.map((event) => event.proposalId));
      const initiallyAcceptedProposals = normalizedFinancial.proposals.filter((proposal) => initiallyAcceptedIds.has(proposal.id));
      const rebasedInitiallyAccepted = normalizeFinancialProposals({
        proposals: initiallyAcceptedProposals,
        acceptedOutcomeIds: [input.acceptedOutcomeId],
        currentLedger: initialLedger,
        currentCareerStateId: currentCareer.id,
        nextCareerStateIds: nextCareerIds
      }).proposals;
      const combinedProposals = new Map(rebasedInitiallyAccepted.map((proposal) => [proposal.id, proposal]));
      for (const proposal of repairedNormalized.proposals) combinedProposals.set(proposal.id, proposal);
      const completedCombinedProposals = completeCareerIncomeReplacementProposals({
        proposals: [...combinedProposals.values()],
        currentLedger: initialLedger,
        currentCareerStateId: currentCareer.id,
        transition: acceptedCareerTransitions[0],
        acceptedOutcomeId: input.acceptedOutcomeId
      });
      finalCandidateProposals = completedCombinedProposals;
      validated = validateFinancialProposals({
        proposals: completedCombinedProposals,
        ...validationInput,
        allowedCareerStateIds: nextCareerIds
      });
      if (repairedCareerAttempted && acceptedCareerTransitions.length === 0) {
        const careerIncomeIds = new Set(initialLedger.incomeSources
          .filter((source) => source.linkedCareerStateId === currentCareer.id)
          .map((source) => source.id));
        validated = {
          acceptedEvents: validated.acceptedEvents.filter((event) => {
            if (event.kind === "income_source_started") return !event.payload.linkedCareerStateId;
            if (event.kind === "income_source_adjusted" || event.kind === "income_source_ended" || event.kind === "income_source_paused") {
              return !careerIncomeIds.has(event.payload.incomeSourceId);
            }
            return true;
          }),
          issues: [...validated.issues, {
            id: `career_repair_atomicity_${input.transactionId}`,
            code: "CAREER_INCOME_CONFLICT",
            severity: "blocking",
            status: "open",
            relatedProposalIds: repairedNormalized.proposals.map((proposal) => proposal.id),
            relatedIncomeSourceIds: [...careerIncomeIds],
            summary: "职业转换修复未通过，关联的旧工资结束与新职业收入均未提交",
            createdAtAgeInMonths: input.periodEndAgeInMonths
          }]
        };
      }
    } catch {
      repairLatencyMs = repairLatencyMs || 0;
      // Keep the deterministic first-pass result when the single repair call fails.
    }
  }
  if (acceptedCareerTransitions.length === 0 && careerValidationIssues.length > 0) {
    const existingIds = new Set(validated.issues.map((issue) => issue.id));
    validated = {
      ...validated,
      issues: [...validated.issues, ...careerValidationIssues.filter((issue) => !existingIds.has(issue.id))]
    };
  }
  if (careerTransitionRequired && acceptedCareerTransitions.length === 0
    && !validated.issues.some((issue) => issue.id === `career_transition_missing_${input.transactionId}`)) {
    validated = {
      ...validated,
      issues: [...validated.issues, {
        id: `career_transition_missing_${input.transactionId}`,
        code: "CAREER_INCOME_CONFLICT",
        severity: "blocking",
        status: "open",
        relatedProposalIds: [],
        summary: "正文中的主人公职业转换在一次修复后仍未形成 Accepted CareerTransition",
        createdAtAgeInMonths: input.periodEndAgeInMonths
      }]
    };
  }
  const finalAcceptedIncomeIds = new Set(validated.acceptedEvents.flatMap((event) => {
    const payload = event.payload as Record<string, any>;
    return [payload.incomeSourceId, payload.nextSource?.id, event.kind === "income_source_started" ? payload.id : undefined]
      .filter((value): value is string => typeof value === "string");
  }));
  const unresolvedCompletenessIssues = completenessIssues.filter((issue) => {
    if (issue.id === "proposal_issue_missing_adult_expense") {
      return !validated.acceptedEvents.some((event) => event.kind === "expense_commitment_started");
    }
    if (issue.id.startsWith("personal_income_claim_without_event_")) {
      return collectPersonalIncomeNarrativeContractIssues({
        narrativeText: input.node.description,
        acceptedFinancialEvents: validated.acceptedEvents,
        ageInMonths: input.periodEndAgeInMonths,
        currentLedger: initialLedger
      }).length > 0;
    }
    return !(issue.relatedIncomeSourceIds || []).some((sourceId) => finalAcceptedIncomeIds.has(sourceId));
  });
  const existingValidatedIssueIds = new Set(validated.issues.map((issue) => issue.id));
  const remainingCoverageIssues = detectNarrativeFinancialCoverageIssues({
    narrativeText: input.node.description,
    ledger: initialLedger,
    acceptedEvents: validated.acceptedEvents,
    ageInMonths: input.periodEndAgeInMonths,
    periodStartAgeInMonths: input.periodStartAgeInMonths
  });
  validated = {
    ...validated,
    issues: [
      ...validated.issues,
      ...unresolvedCompletenessIssues.filter((issue) => !existingValidatedIssueIds.has(issue.id)),
      ...remainingCoverageIssues.filter((issue) => !existingValidatedIssueIds.has(issue.id))
    ]
  };
  if (!input.node.isEndingNode && input.periodEndAgeInMonths >= 80 * 12
    && currentCareer.employmentStatus === "employed" && acceptedCareerTransitions.length === 0) {
    const lateLifeClosure = buildLateLifeEmploymentClosure({
      currentCareer,
      ledger: initialLedger,
      ageInMonths: input.periodEndAgeInMonths,
      transactionId: input.transactionId
    });
    const closedIncomeIds = new Set(lateLifeClosure.financialEvents.map((event) => event.payload.incomeSourceId));
    acceptedCareerTransitions = lateLifeClosure.careerTransitions;
    validated = {
      acceptedEvents: [
        ...validated.acceptedEvents.filter((event) => {
          if (event.kind === "income_source_started") {
            return event.payload.linkedCareerStateId !== currentCareer.id;
          }
          if (event.kind === "income_source_adjusted" || event.kind === "income_source_paused" || event.kind === "income_source_ended") {
            return !closedIncomeIds.has(event.payload.incomeSourceId);
          }
          return true;
        }),
        ...lateLifeClosure.financialEvents
      ],
      issues: validated.issues.filter((issue) => !(
        (issue.code === "CAREER_INCOME_CONFLICT" || issue.code === "CAREER_STATE_STALE" || issue.code === "PENDING_FACT")
        && (issue.relatedIncomeSourceIds || []).some((id) => closedIncomeIds.has(id))
      ))
    };
  }
  if (input.node.isEndingNode) {
    const mortality = buildMortalityFinancialClosure({
      currentCareer,
      ledger: initialLedger,
      ageInMonths: input.periodEndAgeInMonths,
      transactionId: input.transactionId
    });
    const terminalIncomeIds = new Set(mortality.financialEvents.map((event) => event.payload.incomeSourceId));
    acceptedCareerTransitions = mortality.careerTransitions;
    validated = {
      acceptedEvents: [
        ...validated.acceptedEvents.filter((event) => {
          if (event.kind !== "income_source_adjusted" && event.kind !== "income_source_paused" && event.kind !== "income_source_ended") return true;
          return !terminalIncomeIds.has(event.payload.incomeSourceId);
        }),
        ...mortality.financialEvents
      ],
      issues: validated.issues.filter((issue) => !(
        (issue.code === "CAREER_INCOME_CONFLICT" || issue.code === "PENDING_FACT")
        && (issue.relatedIncomeSourceIds || []).some((id) => terminalIncomeIds.has(id))
      ))
    };
  }
  // Preserve the pre-atomic candidate solely for a rejected Preview
  // diagnostic.  `reconcileCareerIncomeAtomicity` correctly removes an
  // unsupported CareerState transition; without this small snapshot a browser
  // checkpoint cannot explain why an otherwise empty proposal list was
  // blocked.
  const provisionalCareerTransitions = acceptedCareerTransitions.map((transition) => structuredClone(transition));
  const atomicCareerIncome = reconcileCareerIncomeAtomicity({
    currentCareerStateId: currentCareer.id,
    currentLedger: initialLedger,
    careerTransitions: acceptedCareerTransitions,
    financialEvents: validated.acceptedEvents,
    ageInMonths: input.periodEndAgeInMonths,
    explicitUnpaid: hasExplicitUnpaidPersonalIncomeStatement(input.node.description),
    personalIncomeClaimed: collectPersonalIncomeNarrativeContractIssues({
      narrativeText: input.node.description,
      acceptedFinancialEvents: [],
      ageInMonths: input.periodEndAgeInMonths
    }).length > 0
  });
  acceptedCareerTransitions = atomicCareerIncome.acceptedCareerTransitions;
  validated = {
    acceptedEvents: atomicCareerIncome.acceptedFinancialEvents,
    issues: [...validated.issues, ...atomicCareerIncome.issues]
  };
  // The initial validation above is intentionally available to the repair
  // prompt, but a repair can replace both the transition and its validated
  // issue list. Reassert the source-bound pending-offer invariant after every
  // repair and after career/income atomicity, immediately before Preview.
  const finalPendingOfferStartResolutionIssue = pendingEmployerOfferStartResolutionIssue({
    current: input.currentWorldState.pendingEmployerOffer,
    acceptedOutcomeId: input.acceptedOutcomeId,
    resolution: submittedPendingEmployerOfferResolution,
    acceptedCareerTransitions,
    transactionId: input.transactionId,
    ageInMonths: input.periodEndAgeInMonths
  });
  if (finalPendingOfferStartResolutionIssue
    && !validated.issues.some((issue) => issue.id === finalPendingOfferStartResolutionIssue.id)) {
    validated = {
      ...validated,
      issues: [...validated.issues, finalPendingOfferStartResolutionIssue]
    };
  }
  const expenseCandidateWorldState = previewExpenseCandidateWorldState({
    current: input.currentWorldState,
    node: input.node,
    acceptedOutcome: input.acceptedOutcome,
    acceptedCareerTransitions,
    acceptedOutcomeId: input.acceptedOutcomeId,
    ageInMonths: input.periodEndAgeInMonths
  });
  // This is an AcceptedOutcome-only bridge: the model may confirm that a
  // recurring responsibility exists, but it cannot choose an account id or
  // invent an amount. The lifecycle derives the stable account and, when
  // necessary, its existing policy-backed needs-review estimate.
  const acceptedExpenseResponsibilityFacts = explicitFactsFromAcceptedExpenseResponsibilityDeltas({
    worldDeltas: input.acceptedOutcome.worldDeltas,
    currentWorldState: expenseCandidateWorldState
  });
  const expenseLifecycle = input.expenseLifecycleMode === "off"
    ? {
        candidates: [],
        triggers: [],
        issues: [],
        reviewReasonCodes: [],
        coveredTriggerCount: 0,
        narrativeBindingMode: "legacy" as const,
        narrativeBinding: undefined
      }
    : applyLifeStageExpenseLifecycle({
        narrativeText: input.node.description,
        currentWorldState: input.expenseLifecycleBaselineWorldState || input.currentWorldState,
        candidateWorldState: expenseCandidateWorldState,
        existingExpenseCommitments: initialLedger.version === 4 ? initialLedger.expenseCommitments : undefined,
        explicitFacts: acceptedExpenseResponsibilityFacts,
        ageInMonths: input.periodEndAgeInMonths,
        sourceNodeId: input.transactionId,
        sourceOutcomeId: input.acceptedOutcomeId,
        narrativeBindingMode: input.expenseNarrativeBindingMode
      });
  const expenseEstimateContext = expenseEstimateContextFromAuthority({
    candidateWorldState: expenseCandidateWorldState,
    ledger: initialLedger,
    node: input.node
  });
  const expenseReconciliation = input.expenseLifecycleMode === "off"
    ? undefined
    : reconcileExpenseCommitments({
        ledger: initialLedger,
        candidates: expenseLifecycle.candidates,
        // Direct Accepted expense facts are the first writer for a stable
        // responsibility in this node. The lifecycle pass remains useful for
        // detecting other responsibilities, but it must not emit a sibling
        // start/adjust/end (or a stale scheduled review) for the same key.
        acceptedExpenseEvents: validated.acceptedEvents,
        ageInMonths: input.periodEndAgeInMonths,
        sourceOutcomeId: input.acceptedOutcomeId,
        mode: input.expenseLifecycleMode,
        estimateContext: expenseEstimateContext
      });
  // Review plans are deterministic policy proposals, but still pass through
  // the ordinary V4 payload schema, reference checks and reducer preview.
  // They are not allowed to masquerade as a sentence the narrator wrote.
  const expenseReviewProposals: FinancialEventProposal[] = expenseReconciliation
    ? expenseReconciliation.reviewEvents.map((event) => ({
        id: event.proposalId,
        kind: event.kind,
        effectiveAtAgeInMonths: event.effectiveAtAgeInMonths,
        payload: event.payload,
        evidence: event.evidence.map((item) => item.excerpt).filter(Boolean).join("；") || "V4 支出责任到期复核",
        sourceOutcomeId: input.acceptedOutcomeId,
        confidence: 1,
        financialScope: event.evidence[0]?.financialScope || "personal",
        systemGenerated: "expense_lifecycle_review"
      }))
    : [];
  const expenseLifecycleValidation = expenseReconciliation
    ? validateFinancialProposals({
        proposals: [...expenseReconciliation.proposals, ...expenseReviewProposals],
        ...validationInput
      })
    : undefined;
  // Shadow runs the identical classifier/reconciler but intentionally never
  // writes its V4 plan.  In enforced mode every generated proposal first goes
  // through ordinary payload validation before it can join the atomic preview.
  if (input.expenseLifecycleMode === "enforced" && expenseReconciliation && expenseLifecycleValidation) {
    validated = {
      acceptedEvents: [
        ...validated.acceptedEvents,
        ...expenseLifecycleValidation.acceptedEvents
      ],
      issues: [
        ...validated.issues,
        ...expenseLifecycleValidation.issues,
        ...expenseLifecycle.issues,
        ...expenseReconciliation.issues
      ]
    };
  }
  const finalAcceptedProposalIds = new Set(validated.acceptedEvents.map((event) => event.proposalId));
  const finalRejectedFinancialProposalIds = [...new Set([
    ...validated.issues
      .filter((issue) => issue.severity === "blocking")
      .flatMap((issue) => issue.relatedProposalIds),
    ...[...everRejectedProposalIds].filter((proposalId) => !finalAcceptedProposalIds.has(proposalId))
  ])];
  const finalRejectedIdSet = new Set(finalRejectedFinancialProposalIds);
  const allCandidateProposals = new Map(normalizedFinancial.proposals.map((proposal) => [proposal.id, proposal]));
  for (const proposal of finalCandidateProposals) allCandidateProposals.set(proposal.id, proposal);
  for (const proposal of suppressedPendingOfferIncomeProposals) allCandidateProposals.set(proposal.id, proposal);
  const normalizedNarrativeClaims = normalizeFinancialNarrativeClaims({
    rawNode: input.rawNode,
    proposals: [...allCandidateProposals.values()],
    narrativeText: input.node.description
  });
  const rejectedNarrativeClaims = normalizedNarrativeClaims.claims.filter((claim) => finalRejectedIdSet.has(claim.proposalId));
  const rejectedClaimProposalIds = new Set(rejectedNarrativeClaims.map((claim) => claim.proposalId));
  const rejectedCompletedProposals = [...allCandidateProposals.values()].filter((proposal) => (
    finalRejectedIdSet.has(proposal.id)
    && isFinancialEventKind(proposal.kind)
    && !isCompanyOperatingNarrativeProposal(proposal)
    && !acceptedEventCoversRejectedProposal({
      proposal,
      claims: rejectedNarrativeClaims,
      acceptedEvents: validated.acceptedEvents
    })
    && (rejectedClaimProposalIds.has(proposal.id)
      || stillClaimsRejectedProposal(proposal, input.node.description)
      || rollbackRejectedFinancialCompletionTitle(input.node.title, [proposal]) !== input.node.title)
  ));
  let committedNarrativeNode = input.node;
  let rejectedNarrativeWasRolledBack = false;
  if (rejectedCompletedProposals.length > 0) {
    // Closing-ledger facts are already known here. Never spend another model
    // Patch after settlement; the deterministic rollback below changes only
    // rejected completion sentences and preserves the accepted node skeleton.
    let paragraphs: string[] | undefined;
    let repairedDescription = paragraphs?.join("\n\n") ?? "";
    const repairInvalid = !paragraphs
      || rejectedCompletedProposals.some((proposal) => (
        proposal.evidence.trim().length > 0 && repairedDescription.includes(proposal.evidence.trim())
      ))
      || validated.acceptedEvents.some((event) => (
        event.evidence.some((item) => item.excerpt.trim().length > 0 && !repairedDescription.includes(item.excerpt.trim()))
      ))
      || rejectedCompletedProposals.some((proposal) => (
        !validated.acceptedEvents.some((event) => event.proposalId === proposal.id)
        && stillClaimsRejectedProposal(proposal, repairedDescription)
      ));
    if (repairInvalid) {
      paragraphs = [...new Set(buildDeterministicFinancialNarrativeRollback({
        rejectedProposals: rejectedCompletedProposals,
        acceptedEvents: validated.acceptedEvents,
        narrativeText: input.node.description,
        selectedDecision: input.selectedDecision,
        narrativeClaims: rejectedNarrativeClaims
      }))];
      repairedDescription = paragraphs.join("\n\n");
      narrativeFallbackReasonCodes.push("FINANCIAL_COMPLETION_ROLLBACK");
      rejectedNarrativeWasRolledBack = true;
    }
    committedNarrativeNode = {
      ...input.node,
      title: rollbackRejectedFinancialCompletionTitle(input.node.title, rejectedCompletedProposals),
      description: repairedDescription,
      descriptionParagraphs: paragraphs
    };
  }
  const closingNarrativeContractIssues = [
    ...detectNarrativeFinancialCoverageIssues({
      narrativeText: committedNarrativeNode.description,
      ledger: initialLedger,
      acceptedEvents: validated.acceptedEvents,
      ageInMonths: input.periodEndAgeInMonths,
      periodStartAgeInMonths: input.periodStartAgeInMonths
    }),
    ...collectPersonalIncomeNarrativeContractIssues({
      narrativeText: committedNarrativeNode.description,
      acceptedFinancialEvents: validated.acceptedEvents,
      ageInMonths: input.periodEndAgeInMonths,
      currentLedger: initialLedger
    })
  ];
  const closingNarrativeIssueIds = new Set(closingNarrativeContractIssues.map((issue) => issue.id));
  const narrativeIssuePrefixes = ["narrative_coverage_", "personal_income_claim_without_event_"];
  const reconciledNarrativeIssues = validated.issues.map((issue) => {
    if (!narrativeIssuePrefixes.some((prefix) => issue.id.startsWith(prefix))
      || closingNarrativeIssueIds.has(issue.id)
      || (issue.status ?? "open") !== "open") return issue;
    return {
      ...issue,
      status: "resolved" as const,
      resolvedAtAgeInMonths: input.periodEndAgeInMonths,
      resolvedByEventId: "system:closing_narrative_revalidated"
    };
  });
  const reconciledNarrativeIssueIds = new Set(reconciledNarrativeIssues.map((issue) => issue.id));
  const finalizedFinancialIssues = settleRejectedFinancialProposalIssues({
    issues: [
      ...reconciledNarrativeIssues,
      ...closingNarrativeContractIssues.filter((issue) => !reconciledNarrativeIssueIds.has(issue.id))
    ],
    acceptedProposalIds: [...finalAcceptedProposalIds],
    rejectedProposalIds: finalRejectedFinancialProposalIds,
    ageInMonths: input.periodEndAgeInMonths,
    narrativeRolledBack: rejectedNarrativeWasRolledBack
  });
  const pendingEmployerOfferUpdate = resolvePendingEmployerOffer({
    current: input.currentWorldState.pendingEmployerOffer,
    selectedDecision: input.selectedDecision,
    acceptedOutcomeId: input.acceptedOutcomeId,
    narrativeText: input.node.description,
    acceptedAtAgeInMonths: input.periodStartAgeInMonths,
    currentCareerStateId: currentCareer.id,
    pendingEmployerOfferResolution: submittedPendingEmployerOfferResolution,
    acceptedCareerTransitions
  });
  const currentWorldStateForTransaction = applyPendingEmployerOfferUpdate(
    input.currentWorldState,
    pendingEmployerOfferUpdate
  );
  const transactionInput = {
    transactionId: input.transactionId,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    expectedCareerRevision: currentCareerCollection.careerRevision,
    expectedLedgerRevision: initialLedger.revision,
    currentCareer: currentCareerCollection,
    currentFinancialLedger: initialLedger,
    currentWorldState: currentWorldStateForTransaction,
    acceptedCareerTransitions,
    acceptedFinancialEvents: validated.acceptedEvents,
    financialIssues: finalizedFinancialIssues.filter((issue) => (
      issue.id !== "proposal_issue_missing_adult_expense"
      && !issue.id.startsWith("proposal_issue_stale_late_career_")
    )),
    basicLivingEstimateContext: {
      livingArrangement: expenseEstimateContext.livingArrangement,
      cityCostBand: expenseEstimateContext.cityCostBand
    },
    aggregateExpenseEstimateContext: expenseEstimateContext,
    liquidityPolicy: "auto_shortfall_debt"
  } as const;
  // Narrative grounding depends on the closing ledger, while narrative contract
  // issues must describe the text the user actually sees. Trial the otherwise
  // pure transaction first, sanitize against that closing state, then rebuild
  // only the current node's narrative issues before the authoritative commit.
  const previewCommitted = previewFinancialDomainTransaction(transactionInput);
  // Shadow must use the same accepted V4 plan events and the same reducer as
  // enforced mode, but it must never add those events to `validated` or to the
  // authoritative transaction.  Preview operates on a deep-cloned write set,
  // so the result below is an auditable prospective diff only.
  const expenseLifecyclePlanAcceptedEvents = expenseLifecycleValidation?.acceptedEvents || [];
  const transactionEventIdentities = new Set(transactionInput.acceptedFinancialEvents.map((event) => (
    `${event.id}:${event.proposalId || ""}`
  )));
  const lifecycleEventsMissingFromTransaction = expenseLifecyclePlanAcceptedEvents.filter((event) => (
    !transactionEventIdentities.has(`${event.id}:${event.proposalId || ""}`)
  ));
  const expenseLifecyclePlanPreview = input.expenseLifecycleMode === "off"
    ? undefined
    : previewFinancialDomainTransaction({
        ...transactionInput,
        acceptedFinancialEvents: [
          ...transactionInput.acceptedFinancialEvents,
          ...lifecycleEventsMissingFromTransaction
        ]
      });
  const previewFinancialState = previewCommitted.derivedFinancialState.compatibilityState;
  let previewDescription = sanitizeFinancialNarrative(
    committedNarrativeNode.description,
    previewFinancialState,
    previewCommitted.financialLedger,
    validated.acceptedEvents
  );
  let postSanitizationIssues = reconcileNarrativeFinancialIssues({
    issues: transactionInput.financialIssues,
    narrativeText: previewDescription,
    ledger: initialLedger,
    acceptedEvents: validated.acceptedEvents,
    ageInMonths: input.periodEndAgeInMonths,
    periodStartAgeInMonths: input.periodStartAgeInMonths
  });
  const unsupportedCoverageIssueIds = postSanitizationIssues
    .filter((issue) => (issue.status ?? "open") === "open" && issue.severity === "blocking")
    .map((issue) => issue.id)
    .filter((id) => id.startsWith("narrative_coverage_") || id.startsWith("personal_income_claim_without_event_"));
  if (unsupportedCoverageIssueIds.length > 0) {
    previewDescription = sanitizeUnsupportedFinancialCoverageClaims(previewDescription, unsupportedCoverageIssueIds);
    postSanitizationIssues = reconcileNarrativeFinancialIssues({
      issues: postSanitizationIssues,
      narrativeText: previewDescription,
      ledger: initialLedger,
      acceptedEvents: validated.acceptedEvents,
      ageInMonths: input.periodEndAgeInMonths,
      periodStartAgeInMonths: input.periodStartAgeInMonths
    });
  }
  const finalExpenseConfirmationVerifications = input.acceptedOutcomeId
    ? validated.acceptedEvents
      .filter((event) => Boolean(event.expenseConfirmationResolution))
      .map((event) => verifyAcceptedExpenseConfirmationAgainstFinalNarrative({
        event,
        finalNarrativeText: previewDescription,
        sourceNodeId: input.transactionId,
        sourceOutcomeId: input.acceptedOutcomeId!
      }))
    : [];
  const invalidFinalExpenseConfirmationIssues: FinancialLedgerIssue[] = finalExpenseConfirmationVerifications
    .filter((verification) => !verification.valid)
    .map((verification) => {
      const event = validated.acceptedEvents.find((candidate) => candidate.id === verification.eventId)!;
      const resolution = event.expenseConfirmationResolution!;
      return {
        id: `expense_confirmation_post_sanitize_${event.id}`,
        code: "PENDING_FACT" as const,
        severity: "blocking" as const,
        status: "open" as const,
        relatedProposalIds: event.proposalId ? [event.proposalId] : [],
        relatedAccountIds: [resolution.accountId],
        expenseResolutionKind: resolution.resolutionKind,
        expenseResponsibilityKey: resolution.responsibilityKey,
        summary: `最终可见正文无法重新绑定已验证的支出确认：${verification.reasonCodes.join("、")}`,
        createdAtAgeInMonths: input.periodEndAgeInMonths
      };
    });
  if (invalidFinalExpenseConfirmationIssues.length > 0) {
    postSanitizationIssues = [
      ...postSanitizationIssues,
      ...invalidFinalExpenseConfirmationIssues
    ];
  }
  const expenseConfirmationAtomicityIssues: FinancialLedgerIssue[] = validateExpenseConfirmationAtomicity({
    events: validated.acceptedEvents,
    previewIssues: previewCommitted.financialLedger.unresolvedIssues
  }).map((violation) => {
    const event = validated.acceptedEvents.find((candidate) => candidate.id === violation.eventId)!;
    const resolution = event.expenseConfirmationResolution!;
    return {
      id: `expense_confirmation_atomicity_${violation.eventId}_${violation.targetIssueId}`,
      code: "EXPENSE_CONFIRMATION_ATOMICITY_FAILED" as const,
      severity: "blocking" as const,
      status: "open" as const,
      relatedProposalIds: event.proposalId ? [event.proposalId] : [],
      relatedAccountIds: [resolution.accountId],
      expenseResolutionKind: resolution.resolutionKind,
      expenseResponsibilityKey: resolution.responsibilityKey,
      summary: `支出确认未由同一 Accepted Event 原子关闭目标复核 ${violation.targetIssueId}：${violation.reasonCodes.join("、")}`,
      createdAtAgeInMonths: input.periodEndAgeInMonths
    };
  });
  if (expenseConfirmationAtomicityIssues.length > 0) {
    postSanitizationIssues = [...postSanitizationIssues, ...expenseConfirmationAtomicityIssues];
  }
  // Most completed financial facts must remain blocking even if their prose
  // can be softened; the gate is what prevents a fictitious property, debt or
  // asset transaction from becoming a silent narrative-only success.  The
  // personal-income contract is deliberately narrower: its sanitizer removes
  // the unsupported commercial-completion sentence altogether.  Feed that
  // one final, user-visible status into the gate while retaining the original
  // finalized status for every other material fact.
  const postSanitizationIssueById = new Map(postSanitizationIssues.map((issue) => [issue.id, issue]));
  const gateFinancialIssues = [
    ...finalizedFinancialIssues.map((issue) => (
    issue.id.startsWith("personal_income_claim_without_event_")
      ? postSanitizationIssueById.get(issue.id) || issue
      : issue
    )),
    ...invalidFinalExpenseConfirmationIssues,
    ...expenseConfirmationAtomicityIssues
  ];
  const requiredFactGroups = buildRequiredFinancialFactGroups({
    issues: gateFinancialIssues,
    rejectedCompletedProposals,
    reviewReasonCodes: [
      ...expenseLifecycle.reviewReasonCodes,
      ...(expenseReconciliation?.reviewReasonCodes || [])
    ],
    ageInMonths: input.periodEndAgeInMonths
  });
  const expenseLifecycleProposalIds = new Set([
    ...(expenseReconciliation?.proposals || []),
    ...expenseReviewProposals
  ].map((proposal) => proposal.id));
  const hasEnforcedExpenseCritical = input.expenseLifecycleMode === "enforced"
    && [...finalizedFinancialIssues, ...invalidFinalExpenseConfirmationIssues, ...expenseConfirmationAtomicityIssues].some((issue) => (
      issue.severity === "blocking"
      && (
        issue.code.startsWith("EXPENSE_")
        || issue.id.startsWith("expense_")
        || (issue.relatedProposalIds || []).some((proposalId) => expenseLifecycleProposalIds.has(proposalId))
      )
    ));
  const gateDecision = evaluateFinancialNodeAcceptance({
    mode: hasEnforcedExpenseCritical ? "enforced" : input.financialNodeGateMode,
    preview: previewCommitted,
    requiredFactGroups,
    expectedAgeInMonths: input.periodEndAgeInMonths,
    transactionId: input.transactionId,
    regenerationCount: input.financialGateRegenerationCount,
    authoritativeAgeBefore: input.periodStartAgeInMonths
  });
  const reportedGateDecision = !gateDecision.allowDomainCommit
    ? {
        ...gateDecision,
        rejectionDiagnostic: buildFinancialGateRejectionDiagnostic({
          node: input.node,
          proposals: [...allCandidateProposals.values()],
          acceptedProposalIds: finalAcceptedProposalIds,
          rejectedProposalIds: finalRejectedIdSet,
          issues: gateFinancialIssues,
          requiredFactGroups,
          provisionalCareerTransitions
        })
      }
    : gateDecision;
  input.onFinancialGateDecision?.(reportedGateDecision);
  if (!reportedGateDecision.allowDomainCommit) throw new FinancialNodeGateError(reportedGateDecision);
  const committed = commitFinancialDomainTransaction({
    ...transactionInput,
    financialIssues: postSanitizationIssues
  });
  const financialState = committed.derivedFinancialState.compatibilityState;
  const debtHealthState = deriveDebtHealthState({
    ledger: committed.financialLedger,
    derivedFinancialState: committed.derivedFinancialState.state,
    previousDebtHealthState: input.previousDebtHealthState
  });
  const previousDerivedFinancialState = deriveFinancialState({
    ledger: initialLedger,
    employmentStatus: currentCareer.employmentStatus
  }).compatibilityState;
  const expenseLifecycleTelemetryPreview = expenseLifecyclePlanPreview || previewCommitted;
  const expenseLifecycleProjectedState = expenseLifecycleTelemetryPreview.derivedFinancialState.compatibilityState;
  const expenseLifecycleProjectedChanges = buildProjectedExpenseLifecycleChanges({
    beforeLedger: initialLedger,
    projectedLedger: expenseLifecycleTelemetryPreview.financialLedger,
    lifecycleEvents: expenseLifecyclePlanAcceptedEvents
  });
  const lifecycleReviewCommitmentIds = expenseReconciliation?.reviewPlan.reviewedCommitmentIds || [];
  const staleResponsibilityKeys = [...new Set(lifecycleReviewCommitmentIds.flatMap((commitmentId) => {
    const commitment = initialLedger.expenseCommitments.find((item) => item.id === commitmentId);
    return commitment?.responsibilityKey ? [commitment.responsibilityKey] : [];
  }))];
  const lifecycleSchemaRejectedCount = expenseLifecycleValidation?.issues.filter((issue) => (
    issue.code === "EXPENSE_SCHEMA_FIELD_MISMATCH"
  )).length || 0;
  const lifecycleReviewCount = expenseLifecyclePlanAcceptedEvents.filter((event) => (
    expenseLifecycleActionFromEvent(event) === "review"
  )).length;
  const expenseLifecycleCandidateTelemetry = buildExpenseLifecycleCandidateTelemetry({
    candidates: expenseLifecycle.candidates,
    decisions: expenseReconciliation?.candidateDecisions || [],
    validationIssues: expenseLifecycleValidation?.issues,
    mode: input.expenseLifecycleMode,
    acceptedProposalIds: new Set(expenseLifecyclePlanAcceptedEvents.flatMap((event) => (
      event.proposalId ? [event.proposalId] : []
    )))
  });
  const previousConservativeWealthBasis = deriveConservativeWealthBasis({
    ledger: initialLedger,
    financialState: previousDerivedFinancialState
  });
  const conservativeWealthBasis = deriveConservativeWealthBasis({ ledger: committed.financialLedger, financialState });
  // `previewDescription` has already been sanitized against the exact
  // transaction preview and all code-stamped confirmations were rebound to
  // that final text before Gate. The authoritative commit is the same pure
  // write-set, so running another text writer here would invalidate the
  // verified spans after the acceptance decision.
  const description = previewDescription;
  return {
    node: {
      ...committedNarrativeNode,
      description,
      descriptionParagraphs: splitNarrativeParagraphs(description),
      attributes: withCalculatedWealth(
        input.node.attributes,
        conservativeWealthBasis,
        input.previousWealth,
        12,
        previousConservativeWealthBasis
      ),
      financialLedger: committed.financialLedger,
      financialLedgerMode: "authoritative",
      financialState,
      debtHealthState,
      financialPeriodSummary: committed.financialPeriodSummary,
      financialSignals: undefined,
      financialChange: undefined,
      financialNarrativeClaims: normalizedNarrativeClaims.claims.filter((claim) => finalAcceptedProposalIds.has(claim.proposalId)),
      financialProcessingMeta: {
        proposalCount: normalizedFinancial.proposals.length,
        acceptedEventCount: validated.acceptedEvents.length,
        acceptedCareerTransitionCount: acceptedCareerTransitions.length,
        blockingIssueCount: postSanitizationIssues.filter((issue) => (
          issue.severity === "blocking" && (issue.status ?? "open") === "open"
        )).length,
        repairTriggered,
        repairLatencyMs,
        totalProcessingLatencyMs: Date.now() - processingStartedAt,
        debtNarrativeAuthorityVersion: "debt_narrative_v1",
        narrativeFallback: narrativeFallbackReasonCodes.length > 0,
        narrativeFallbackReasonCodes,
        rejectedDebtClaimKinds: narrativeFallbackReasonCodes,
        financialGateMode: gateDecision.mode,
        financialGateDisposition: gateDecision.disposition,
        financialGateWouldBlock: gateDecision.wouldBlock,
        financialGateReasonCodes: gateDecision.reasonCodes,
        financialGateRequiredFactGroupCount: gateDecision.requiredFactGroupCount,
        financialGateSatisfiedFactGroupCount: gateDecision.satisfiedFactGroupCount,
        financialGateCriticalFactGroupCount: gateDecision.criticalFactGroupCount,
        financialGateSatisfiedCriticalFactGroupCount: gateDecision.satisfiedCriticalFactGroupCount,
        financialGateUnsatisfiedCriticalFactGroupCount: gateDecision.unsatisfiedCriticalFactGroupCount,
        financialGateRegenerationCount: input.financialGateRegenerationCount,
        expenseLifecycleTriggerCount: expenseLifecycle.triggers.length,
        // Kept only for legacy readers; detector self-coverage is deliberately
        // no longer a release metric.
        expenseLifecycleCoveredTriggerCount: 0,
        expenseLifecycleEstimatedAccountCount: expenseReconciliation?.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length || 0,
        expenseLifecycleResponsibilityCodes: [...new Set(expenseLifecycle.candidates.flatMap((candidate) => candidate.evidence.map((evidence) => evidence.reasonCode)))],
        expenseLifecycleTelemetry: {
          mode: input.expenseLifecycleMode,
          narrativeBindingMode: expenseLifecycle.narrativeBindingMode,
          narrativeBindingCount: expenseLifecycle.narrativeBinding?.bindings.length || 0,
          narrativeBindingCriticalCount: expenseLifecycle.narrativeBinding?.bindings.filter((binding) => (
            binding.sourceMateriality === "critical"
          )).length || 0,
          narrativeBindingSourceIdentityMissingCount: expenseLifecycle.narrativeBinding?.bindings.filter((binding) => (
            binding.sourceIdentityStatus === "missing"
          )).length || 0,
          expenseConfirmationAcceptedCount: validated.acceptedEvents.filter((event) => (
            event.expenseConfirmationResolution?.disposition === "confirmed_exact"
          )).length,
          expenseConfirmationRejectedAfterSanitizeCount: invalidFinalExpenseConfirmationIssues.length,
          candidateCount: expenseLifecycle.candidates.length,
          candidates: expenseLifecycleCandidateTelemetry,
          acceptedStartCount: expenseLifecyclePlanAcceptedEvents.filter((event) => event.kind === "expense_commitment_started").length,
          acceptedAdjustCount: expenseLifecyclePlanAcceptedEvents.filter((event) => event.kind === "expense_commitment_adjusted").length,
          acceptedEndCount: expenseLifecyclePlanAcceptedEvents.filter((event) => event.kind === "expense_commitment_ended").length,
          reviewCount: lifecycleReviewCount,
          ignoredCount: expenseReconciliation?.ignoredCandidateIds.length || 0,
          reasonCodes: [...new Set([
            ...expenseLifecycle.candidates.flatMap((candidate) => candidate.evidence.map((evidence) => evidence.reasonCode)),
            ...expenseLifecyclePlanAcceptedEvents.flatMap((event) => event.evidence.map((evidence) => evidence.reasonCode)),
            ...(expenseReconciliation?.reviewReasonCodes || [])
          ])],
          beforeAnnualizedExpenseWan: previousDerivedFinancialState.annualCoreExpenseWan,
          afterAnnualizedExpenseWan: expenseLifecycleProjectedState.annualCoreExpenseWan,
          projectedCommitmentChanges: expenseLifecycleProjectedChanges,
          projectedAnnualizedExpenseDeltaWan: Number((
            expenseLifecycleProjectedState.annualCoreExpenseWan - previousDerivedFinancialState.annualCoreExpenseWan
          ).toFixed(4)),
          baselineDownwardBlocked: hasNewBaselineDownwardBlock({
            beforeLedger: initialLedger,
            projectedLedger: expenseLifecycleTelemetryPreview.financialLedger
          }),
          staleResponsibilityKeys,
          businessScopeRejectedKeys: expenseLifecycle.candidates
            .filter((candidate) => candidate.financialScope === "business_operating" || candidate.financialScope === "third_party")
            .map((candidate) => candidate.responsibilityKey),
          duplicateAmountSourceIds: Object.entries(expenseLifecycle.candidates.reduce<Record<string, Set<string>>>((bySource, candidate) => {
            if (!candidate.amountSourceId) return bySource;
            (bySource[candidate.amountSourceId] ||= new Set()).add(candidate.responsibilityKey);
            return bySource;
          }, {})).filter(([, keys]) => keys.size > 1).map(([sourceId]) => sourceId),
          schemaRejectedCount: lifecycleSchemaRejectedCount,
          wouldBlock: Boolean(
            expenseLifecycle.issues.some((issue) => issue.severity === "blocking")
            || expenseReconciliation?.wouldBlock
            || expenseLifecycleValidation?.issues.some((issue) => issue.severity === "blocking")
          )
        },
        rejectedFinancialProposalKinds: [...new Set(rejectedCompletedProposals.map((proposal) => proposal.kind))],
        financialNarrativeAuthorityVersion: "financial_narrative_claims_v1",
        financialNarrativeClaimCount: normalizedNarrativeClaims.claims.length,
        rejectedFinancialNarrativeClaimCount: rejectedNarrativeClaims.length,
        rawInvalidFinancialNarrativeClaimCount: normalizedNarrativeClaims.invalidCount,
        // Invalid model claims are dropped before commit. This field describes
        // the final published contract and therefore remains a hard audit gate.
        invalidFinancialNarrativeClaimCount: 0
      }
    },
    worldState: committed.worldState,
    acceptedFinancialEvents: validated.acceptedEvents,
    rejectedFinancialProposalIds: finalRejectedFinancialProposalIds
  };
}

function getAiJsonCaller(deps: SimulationServiceDeps = {}): AiJsonCaller {
  const caller = deps.callAiJson || getBrowserE2eAiJsonCaller();
  if (caller) {
    return async (prompt) => {
      if (deps.signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      const response = await caller(prompt);
      if (deps.signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      return response;
    };
  }

  return (prompt: string) => callDeepSeekJsonFromBrowser(getBrowserAiEnv(), prompt, fetch, deps.signal);
}

function getAiJsonStreamCaller(deps: SimulationServiceDeps, fallbackCaller: AiJsonCaller): AiJsonStreamCaller {
  if (deps.callAiJsonStream) {
    return (prompt, options = {}) => deps.callAiJsonStream!(flattenAiPromptInput(prompt), options);
  }
  if (deps.callAiJson) {
    return async (prompt, options = {}) => {
      if (options.signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      const response = await fallbackCaller(flattenAiPromptInput(prompt));
      options.onContent?.(response.text);
      if (response.usage) options.onUsage?.(response.usage);
      return response;
    };
  }

  const e2eStreamCaller = getBrowserE2eAiJsonStreamCaller();
  if (e2eStreamCaller) {
    return (prompt, options = {}) => e2eStreamCaller(flattenAiPromptInput(prompt), options);
  }

  return (prompt, options = {}) => callDeepSeekJsonStreamFromBrowser(
    getBrowserAiEnv(),
    prompt,
    options
  );
}

function buildNextNodeRetryPrompt(
  prompt: AiPromptInput,
  previousIssues: string[],
  eventIntentType?: string
): AiPromptInput {
  if (typeof prompt === "string") {
    return buildNodePromptWithRetryNotice(prompt, previousIssues, eventIntentType);
  }

  return {
    ...prompt,
    userPrompt: buildNodePromptWithRetryNotice(prompt.userPrompt, previousIssues, eventIntentType)
  };
}

function parseAiJsonResponse(response: { text?: string }): any {
  try {
    return JSON.parse(response.text || "{}");
  } catch (error) {
    throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回内容不是合法 JSON，请重试。", { cause: error });
  }
}

async function repairGeneratedChoiceTexts(
  node: Record<string, any>,
  invalidChoiceIndexes: number[],
  callAiJson: AiJsonCaller,
  onResponse?: (response: AiJsonResult) => void
): Promise<Record<string, any>> {
  if (invalidChoiceIndexes.length === 0) return node;

  const response = await callAiJson(buildChoiceTextRepairPrompt(node, invalidChoiceIndexes));
  onResponse?.(response);
  const data = parseAiJsonResponse(response);
  const rawRepairs = Array.isArray(data?.choiceTextRepairs) ? data.choiceTextRepairs : [];
  const expectedIndexes = new Set(invalidChoiceIndexes);
  const rawChoices = getRawSimulationNodeChoices(node);
  const repairedTextByIndex = new Map<number, string>();

  if (rawRepairs.length !== expectedIndexes.size) {
    throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回的选项正文修复数量不正确，请重试。");
  }

  for (const rawRepair of rawRepairs) {
    const index = Number(rawRepair?.index);
    const text = typeof rawRepair?.text === "string" ? rawRepair.text.trim() : "";
    const sourceChoice = rawChoices[index] && typeof rawChoices[index] === "object"
      ? rawChoices[index] as Record<string, unknown>
      : {};
    const id = typeof sourceChoice.id === "string" ? sourceChoice.id.trim() : String.fromCharCode(65 + index);
    const impactSummary = typeof sourceChoice.impactSummary === "string" ? sourceChoice.impactSummary.trim() : "";
    const decisionIntent = typeof sourceChoice.decisionIntent === "string" ? sourceChoice.decisionIntent.trim() : "";
    const disallowedText = new Set([id, impactSummary, decisionIntent, `${id}. ${impactSummary}`].filter(Boolean));

    if (!Number.isInteger(index) || !expectedIndexes.has(index) || repairedTextByIndex.has(index) || !text || disallowedText.has(text)) {
      throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回的选项正文修复内容无效，请重试。");
    }
    repairedTextByIndex.set(index, text);
  }

  const repairedNode = {
    ...node,
    choices: rawChoices.map((choice, index) => ({
      ...(choice && typeof choice === "object" ? choice : {}),
      ...(repairedTextByIndex.has(index) ? { text: repairedTextByIndex.get(index) } : {})
    }))
  };
  if (getInvalidExplicitChoiceTextIndexes(repairedNode).length > 0) {
    throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回的选项正文修复仍不完整，请重试。");
  }
  return repairedNode;
}

async function ensureGeneratedChoiceTexts(
  node: Record<string, any>,
  callAiJson: AiJsonCaller
): Promise<Record<string, any>> {
  const invalidChoiceIndexes = getInvalidExplicitChoiceTextIndexes(node);
  return invalidChoiceIndexes.length > 0
    ? repairGeneratedChoiceTexts(node, invalidChoiceIndexes, callAiJson)
    : node;
}

function stringifyQuestionField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSuggestion(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return stringifyQuestionField(record.text ?? record.label ?? record.answer ?? record.value);
  }
  return "";
}

function normalizeQuestionItems(data: any): QuestionItem[] {
  const rawQuestions = Array.isArray(data?.questions)
    ? data.questions
    : Array.isArray(data?.questionList)
      ? data.questionList
      : Array.isArray(data?.items)
        ? data.items
        : [];

  return rawQuestions
    .map((item: unknown) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const question = stringifyQuestionField(
        record.question ?? record.title ?? record.prompt ?? record.text ?? record.content
      );
      const rawSuggestions = Array.isArray(record.suggestions)
        ? record.suggestions
        : Array.isArray(record.options)
          ? record.options
          : Array.isArray(record.choices)
            ? record.choices
            : [];
      const suggestions = rawSuggestions.map(normalizeSuggestion).filter(Boolean);
      return question && suggestions.length > 0 ? { question, suggestions } : null;
    })
    .filter((item): item is QuestionItem => Boolean(item));
}

function hasMalformedQuestionItems(data: any, normalized: QuestionItem[]): boolean {
  const rawQuestions = Array.isArray(data?.questions)
    ? data.questions
    : Array.isArray(data?.questionList)
      ? data.questionList
      : Array.isArray(data?.items)
        ? data.items
        : [];

  return rawQuestions.length === 0 || normalized.length === 0 || normalized.length !== rawQuestions.length;
}

export async function generateQuestions(
  userData: UserInitialData,
  deps: SimulationServiceDeps = {}
): Promise<GenerateQuestionsResult> {
  const callAiJson = getAiJsonCaller(deps);
  const basePrompt = buildQuestionPrompt(userData);
  let prompt = basePrompt;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const data = parseAiJsonResponse(await callAiJson(prompt));
    const questions = normalizeQuestionItems(data);
    if (!hasMalformedQuestionItems(data, questions)) {
      return { questions };
    }

    prompt = `${basePrompt}

【上一次返回不完整，必须重新生成】
问题列表中存在空 question、空 suggestions 或字段名不符合要求。
请严格返回：
{
  "questions": [
    { "question": "具体追问标题", "suggestions": ["第一人称候选回答"] }
  ]
}
每个 question 必须是非空中文问题，每个 suggestions 必须至少包含 4 个非空第一人称候选回答。`;
  }

  throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回的追问问题为空或格式异常，请重新生成。");
}

export async function startSimulation(
  userData: UserInitialData,
  answers: QuestionTurn[],
  deps: SimulationServiceDeps = {}
): Promise<StartSimulationResult> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildStartSimulationPrompt(userData, answers);
  let latestData: any = {};

  const startNode = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
    const response = await callAiJson(buildNodePromptWithRetryNotice(prompt, previousIssues));
    latestData = parseAiJsonResponse(response);
    return latestData.startNode || latestData.node || latestData;
  }, {
    fallbackAge: userData.regressionAge || 20,
    minAge: userData.regressionAge || 20,
    maxAge: userData.regressionAge || 20,
    targetAgeInMonths: (userData.regressionAge || 20) * 12,
    previousAgeInMonths: (userData.regressionAge || 20) * 12,
    elapsedMonths: 0,
    lifeIntensity: "normal",
    repairMissingChoiceText: async (node, invalidChoiceIndexes) => {
      const repairedNode = await repairGeneratedChoiceTexts(node, invalidChoiceIndexes, callAiJson);
      if (latestData.startNode) latestData = { ...latestData, startNode: repairedNode };
      else if (latestData.node) latestData = { ...latestData, node: repairedNode };
      else latestData = repairedNode;
      return repairedNode;
    }
  });
  const startAgeInMonths = startNode.ageInMonths ?? startNode.age * 12;
  const rawFinancialState = latestData.initialFinancialState || latestData.startNode?.financialState || latestData.financialState;
  const modelFinancialState = normalizeInitialFinancialState(rawFinancialState, startAgeInMonths, startNode.attributes.wealth);
  const openingFacts = extractOpeningFinancialFacts(userData, answers);
  const proposedFinancialState = applyOpeningFactsToFinancialState(modelFinancialState, openingFacts);
  let startWorldState = emptyWorldState();
  const openingCareerState = initializeCareerState({
    id: `career_opening_${startAgeInMonths}`,
    employmentStatus: proposedFinancialState.employmentStatus || "not_working",
    effectiveFromAgeInMonths: startAgeInMonths,
    confidence: proposedFinancialState.isEstimated ? 0.6 : 0.9
  });
  startWorldState.careerStates = [openingCareerState];
  startWorldState.currentCareerStateId = openingCareerState.id;
  startWorldState.currentEmploymentStatus = openingCareerState.employmentStatus;
  startWorldState.careerRevision = 0;
  startWorldState.version = 2;
  startWorldState.directionArcs = ensureDirectionArcs(startWorldState, userData, startNode.ageInMonths ?? startNode.age * 12);
  startWorldState.people = rebuildPersonStates(userData, [], startNode.ageInMonths ?? startNode.age * 12, [], answers);
  startWorldState = ensureRelationshipWorldState(startWorldState, startAgeInMonths);
  const hasOpeningRomanticRelationship = startWorldState.relationships.some((relationship) => (
    relationship.type === "romantic" && ["active", "strained"].includes(relationship.status)
  ));
  const authoritativeOpeningChoices = userData.regressionChoices
    .split(/[\n；;]+/u)
    .map((item) => item.trim().replace(/^[A-CＡ-Ｃ][.．、]\s*/u, ""))
    .filter(Boolean);
  const openingChoices = startNode.choices.map((choice, index) => {
    if (choice.eventOutcomeId || !hasOpeningRomanticRelationship) return choice;
    const relationshipOutcomeId = deriveOpeningRomanticOutcomeId(authoritativeOpeningChoices[index] || choice.text);
    return relationshipOutcomeId
      ? { ...choice, eventOutcomeId: relationshipOutcomeId, expectedWorldDeltaTypes: ["relationship_change" as const] }
      : choice;
  });
  const openingPreparation = prepareOpeningFinancialAuthority({
    id: `financial_opening_${startAgeInMonths}`,
    proposedState: proposedFinancialState,
    linkedCareerStateId: openingCareerState.id,
    openingFacts,
    currentCareer: {
      careerStates: startWorldState.careerStates,
      currentCareerStateId: openingCareerState.id,
      careerRevision: startWorldState.careerRevision
    },
    currentWorldState: startWorldState,
    mode: deps.financialNodeGateMode ?? DEFAULT_FINANCIAL_NODE_GATE_MODE
  });
  deps.onFinancialGateDecision?.(openingPreparation.gateDecision);
  if (!openingPreparation.gateDecision.allowDomainCommit) {
    // Start-node construction has not begun.  No ledger, WorldState snapshot,
    // time line or opening accepted event is returned on a rejected candidate.
    throw new FinancialNodeGateError(openingPreparation.gateDecision);
  }
  const openingResult = commitPreparedOpeningFinancialAuthority(openingPreparation);
  const openingFinancialLedger = openingResult.ledger;
  const openingDerivedFinancialState = deriveFinancialState({
    ledger: openingFinancialLedger,
    employmentStatus: openingCareerState.employmentStatus
  });
  const openingDebtHealthState = deriveDebtHealthState({
    ledger: openingFinancialLedger,
    derivedFinancialState: openingDerivedFinancialState.state
  });
  const authoritativeOpeningFinancialState = openingDerivedFinancialState.compatibilityState;
  const startAttributes = withCalculatedWealth(startNode.attributes, authoritativeOpeningFinancialState);
  const startDescription = sanitizeUnsupportedOpeningAccountClaims(
    sanitizeFinancialNarrative(startNode.description, authoritativeOpeningFinancialState, openingFinancialLedger),
    openingFinancialLedger
  );
  const initializedStartNodeWithFinance = {
    ...startNode,
    title: sanitizeOpeningFinancialTitle(startNode.title, openingFinancialLedger),
    choices: openingChoices,
    description: startDescription,
    descriptionParagraphs: splitNarrativeParagraphs(startDescription),
    attributes: startAttributes,
    financialLedger: openingFinancialLedger,
    financialLedgerMode: "authoritative" as const,
    financialState: authoritativeOpeningFinancialState,
    debtHealthState: openingDebtHealthState,
    worldStateSnapshot: startWorldState
  };

  return {
    ...latestData,
    initialAttributes: initializedStartNodeWithFinance.attributes,
    startNode: initializedStartNodeWithFinance
  };
}

export interface GenerateNextNodeInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  selectedDecision: string;
  nodeIndex?: number;
  simulationSeed?: string;
}

function resolveChoiceTemporalHint(history: HistoryItem[], selectedDecision: string): ChoiceTemporalHint | undefined {
  const latest = history[history.length - 1];
  const preset = latest?.choices.find((choice) => choice.text === selectedDecision || selectedDecision.includes(choice.text));
  if (preset?.temporalHint) return preset.temporalHint;
  const text = selectedDecision;
  if (/急|立即|重病|危机/.test(text)) return { lifeIntensity: "critical", durationMonths: [1, 6], requiresFollowUp: true, reason: "自定义选择包含即时危机" };
  if (/创业|融资|辞职|转型|扩张|冲突/.test(text)) return { lifeIntensity: "high_tension", durationMonths: [6, 12], requiresFollowUp: true, reason: "自定义选择开启高张力行动" };
  if (/稳定|维持|长期|退休/.test(text)) return { lifeIntensity: "stable", durationMonths: [36, 60], requiresFollowUp: false, reason: "自定义选择强调长期稳定" };
  return undefined;
}

export function resolveSelectedOutcomeId(history: HistoryItem[], selectedDecision: string): string | undefined {
  const latest = history[history.length - 1];
  if (!latest || !selectedDecision.trim()) return undefined;
  const selectedChoice = latest?.choices.find((choice) => (
    choice.text === selectedDecision
    || selectedDecision.includes(choice.text)
  ));
  if (!selectedChoice) {
    return `custom_choice_${stableHash({
      sourceAgeInMonths: latest.ageInMonths,
      sourceTitle: latest.title,
      selectedDecision: selectedDecision.trim()
    })}`;
  }
  return selectedChoice.eventOutcomeId || `choice_fallback_${stableHash({
    sourceAgeInMonths: latest.ageInMonths,
    sourceTitle: latest.title,
    choiceId: selectedChoice.id,
    choiceText: selectedChoice.text
  })}`;
}

function latestWorldState(history: HistoryItem[]) {
  return history[history.length - 1]?.worldStateSnapshot || emptyWorldState();
}

function ensureDirectionArcs(worldState: ReturnType<typeof emptyWorldState>, userData: UserInitialData, currentAgeInMonths: number) {
  if (worldState.directionArcs.length > 0 || !userData.regressionChoices?.trim()) return worldState.directionArcs;
  return [{
    id: `direction_${stableHash({ focus: userData.coreStoryFocus, direction: userData.regressionChoices })}`,
    directionType: userData.coreStoryFocus || "self_directed",
    summary: userData.regressionChoices.trim(),
    status: "active" as const,
    startedAtAgeInMonths: currentAgeInMonths,
    userReinforcementCount: 1,
    establishedAssets: []
  }];
}

function foregroundPressureArc(history: HistoryItem[]): PressureArcState | undefined {
  const worldState = latestWorldState(history);
  return worldState.pressureArcs.find((arc) => arc.id === worldState.foregroundPressureArcId && arc.status !== "resolved");
}

function activeArcByPolicy(worldState: ReturnType<typeof emptyWorldState>, policyId: string): PressureArcState | undefined {
  return worldState.pressureArcs.find((arc) => (
    arc.phasePolicyId === policyId
    && arc.status !== "resolved"
    && arc.status !== "suspended"
  ));
}

function completeScheduledArcTransition(input: {
  transition: PressureArcTransitionDecision;
  startDecision?: PressureArcTransitionDecision;
  workingArc?: PressureArcState;
  worldState: ReturnType<typeof emptyWorldState>;
  closingDebtHealthState?: SimulationNode["debtHealthState"];
}): PressureArcTransitionDecision {
  const additionalArcStateUpdates = [...(input.startDecision?.additionalArcStateUpdates || [])];
  let foregroundPressureArcId = input.transition.foregroundPressureArcId;

  if (input.workingArc?.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id && input.transition.action === "resolve") {
    const suspendedDebtArc = input.worldState.pressureArcs.find((arc) => (
      arc.phasePolicyId === FINANCIAL_DEBT_PHASE_POLICY.id
      && arc.status === "suspended"
      && arc.suspendedByArcId === input.workingArc?.id
    ));
    if (suspendedDebtArc) {
      const debtAfterHealth = resolveDebtArcAfterHealth({
        debtArc: suspendedDebtArc,
        healthArcId: input.workingArc.id,
        closingDebtHealthState: input.closingDebtHealthState
      });
      additionalArcStateUpdates.push(debtAfterHealth);
      foregroundPressureArcId = debtAfterHealth.status === "active" ? debtAfterHealth.id : undefined;
    }
  }

  if (additionalArcStateUpdates.length === 0) return input.transition;
  return {
    ...input.transition,
    additionalArcStateUpdates,
    foregroundPressureArcId
  };
}

function resolvePressureArcPresentationEvent(arc: PressureArcState): LifeEventSeed | null {
  if (arc.eventId === "health_forced_pause") {
    const usesNewHealthPolicy = arc.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id;
    const isAcutePhase = usesNewHealthPolicy
      ? arc.phaseId === "trigger"
      : arc.phaseId === "trigger" || arc.phaseId === "response";
    const eventId = isAcutePhase ? arc.eventId : "health_recovery_observation";
    const event = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === eventId) || null;
    if (!event && eventId === "health_recovery_observation") {
      console.warn("health-recovery-event-missing");
    }
    return event;
  }

  return LIFE_EVENTS_DATABASE.find((event) => event.id === arc.eventId) || null;
}

function isHealthPressureArc(arc: PressureArcState): boolean {
  return arc.eventId === "health_forced_pause"
    && arc.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id;
}

function isLegacyHealthPressureArc(arc: PressureArcState): boolean {
  return arc.eventId === "health_forced_pause" && !isHealthPressureArc(arc);
}

function isAcutePressureArcPhase(arc: PressureArcState): boolean {
  if (isHealthPressureArc(arc)) return arc.phaseId === "trigger";
  return arc.phaseId === "trigger" || arc.phaseId === "response";
}

function isSafeArcContinuationEvent(event: LifeEventSeed, arc: PressureArcState): boolean {
  if (event.id === arc.eventId || event.id === "health_forced_pause") return false;
  if (event.category === "health" && event.fingerprint?.intensity === "major") return false;

  const profile = getEventTemporalProfile(event);
  return !profile.requiresFollowUp
    && profile.lifeIntensity !== "critical"
    && profile.lifeIntensity !== "high_tension";
}

function selectArcContinuationEvent(input: {
  arc: PressureArcState;
  attributes: LifeAttributes;
  userData: UserInitialData;
  age: number;
  history: HistoryItem[];
  answers: unknown;
  entropy: SelectionEntropy;
}): LifeEventSeed | null {
  if (input.arc.phasePolicyId === FINANCIAL_DEBT_PHASE_POLICY.id) {
    const dynamicEvent = queryDynamicLifeEvent(
      input.attributes,
      input.userData,
      input.age,
      input.history,
      input.answers
    );
    return resolvePolicyPressureArcPresentationEvent({
      arc: input.arc,
      safeDynamicEvent: dynamicEvent && isSafeArcContinuationEvent(dynamicEvent, input.arc)
        ? dynamicEvent
        : undefined
    });
  }

  if (isLegacyHealthPressureArc(input.arc)) {
    return resolvePressureArcPresentationEvent(input.arc);
  }

  if (isAcutePressureArcPhase(input.arc)) {
    return resolvePressureArcPresentationEvent(input.arc);
  }

  const dynamicEvent = queryDynamicLifeEvent(
    input.attributes,
    input.userData,
    input.age,
    input.history,
    input.answers,
    { entropy: input.entropy, allowGuaranteedRomanceFormation: false }
  );
  if (dynamicEvent && isSafeArcContinuationEvent(dynamicEvent, input.arc)) {
    return dynamicEvent;
  }

  // Keep the existing presentation fallback when the single dynamic
  // candidate is unavailable or unsafe. The wrapper deliberately does not
  // re-sample the global event pool, so this change cannot alter selection
  // probabilities outside an active PressureArc.
  return resolvePressureArcPresentationEvent(input.arc);
}

function hasMatchingPressureResolvedSignal(
  node: SimulationNode,
  arc: PressureArcState,
  policy: PhaseTransitionPolicy
): boolean {
  const acceptedOutcome = validateNodeOutcomeProposal({
    worldDeltas: node.narrativeMeta?.worldDeltas,
    arcSignals: node.narrativeMeta?.arcSignals,
    policy,
    narrativeText: node.description
  });
  return acceptedOutcome.arcSignals.some((signal) => (
    signal.type === "pressure_resolved"
    && signal.pressureArcId === arc.id
  ));
}

function repeatsAcuteHealthCrisisAfterTrigger(node: SimulationNode, arc?: PressureArcState): boolean {
  if (arc?.phasePolicyId !== HEALTH_CRISIS_PHASE_POLICY.id || arc.phaseId === "trigger") return false;
  const text = `${node.title}\n${node.description}`;
  return /再次(?:停摆|住院|送医|被送医)|突然.{0,12}(?:倒地|晕倒|失去意识)|(?:叫了|呼叫|送上)急救|救护车再次|(?:拨打|呼叫)\s*120|被送(?:进|到)急诊|要求立即住院|住院期间/.test(text);
}

function fallbackWorldDeltaTypes(node: SimulationNode): WorldDelta["type"][] {
  const category = node.eventMeta?.eventCategory;
  if (category === "health") return ["health_state"];
  if (category === "relationship") return ["relationship_change"];
  if (category === "career" || category === "financial" || category === "opportunity") return ["career_state"];
  return [];
}

const RELATIONSHIP_AUTHORITY_FALLBACK_REASON = "relationship_authority_deterministic_fallback";
const RELATIONSHIP_AUTHORITY_FALLBACK_TELEMETRY_CODE = "RELATIONSHIP_AUTHORITY_DETERMINISTIC_FALLBACK";
const RELATIONSHIP_AUTHORITY_FALLBACK_SURFACE_PATH = "relationship_authority";

function hasOnlyRelationshipAuthorityConflicts(issues: ReturnType<typeof validateStoryConsistency>): boolean {
  const errors = issues.filter((issue) => issue.severity === "error");
  return errors.length > 0 && errors.every((issue) => issue.code === "relationship_authority_conflict");
}

function buildRelationshipAuthorityDeterministicFallback(input: {
  node: SimulationNode;
  nodeEvent?: LifeEventSeed;
  nodeEventMeta?: EventMeta;
  elapsedMonths: number;
}): { node: SimulationNode; eventMeta: EventMeta } {
  const fallbackOutcomes = input.nodeEvent?.intent.allowedOutcomes?.length
    ? input.nodeEvent.intent.allowedOutcomes
    : ["maintain_current_direction", "adjust_execution_rhythm", "reassess_current_direction"];
  const fallbackChoiceTexts = [
    "按当前方向继续推进，同时保留必要的时间和资源缓冲",
    "降低短期投入强度，先验证现实反馈再决定下一步",
    "调整执行路径，把精力转向更可持续的替代方案"
  ];
  const fallbackDescription = `接下来的 ${input.elapsedMonths} 个月里，你继续处理当前选择带来的现实后果。本轮事件关注的是：${input.nodeEvent?.intent.meaning || "如何在现有生活条件下形成新的可执行方向"}。工作、家庭、健康和资源约束仍然存在，你没有把普通社交接触解释成已经成立的亲密关系。\n\n到了新的决策节点，真正需要确认的是执行强度、风险边界和替代路径。你可以继续推进，也可以降低投入或调整方向；任何关系阶段变化仍需等待对应事件和你的明确选择。`;
  const eventMeta: EventMeta = {
    ...(input.nodeEventMeta || { eventTags: [] }),
    fallbackReason: RELATIONSHIP_AUTHORITY_FALLBACK_REASON
  };
  const fallbackExpectedWorldDeltaTypes = input.nodeEvent?.routeLine === "romance"
    ? []
    : fallbackWorldDeltaTypes({ ...input.node, eventMeta });
  return {
    eventMeta,
    node: {
      ...input.node,
      title: input.nodeEvent?.title || "现实路径的重新校准",
      description: fallbackDescription,
      descriptionParagraphs: splitNarrativeParagraphs(fallbackDescription),
      eventMeta,
      choices: fallbackChoiceTexts.map((text, index) => {
        const outcome = fallbackOutcomes[index % fallbackOutcomes.length];
        return {
          id: String.fromCharCode(65 + index),
          text,
          impactSummary: ["继续推进", "控制风险", "调整方向"][index],
          eventOutcomeId: outcome,
          decisionIntent: `fallback:${input.nodeEvent?.intent.type || "ordinary"}:${outcome}`,
          expectedWorldDeltaTypes: fallbackExpectedWorldDeltaTypes
        };
      }),
      narrativeMeta: input.node.narrativeMeta ? {
        ...input.node.narrativeMeta,
        activeCharacters: [],
        relationshipProposals: [],
        worldDeltas: (input.node.narrativeMeta.worldDeltas || []).filter((delta) => delta.type !== "relationship_change"),
        storyEpisode: {
          ...input.node.narrativeMeta.storyEpisode,
          summary: fallbackDescription
        }
      } : input.node.narrativeMeta
    }
  };
}

/**
 * Debt-surface authority deliberately clears financial fallback telemetry when
 * it has repaired a debt claim. A relation-only deterministic fallback occurs
 * earlier and must be re-marked after all later surface writers have finished,
 * otherwise production audit treats a rendered fallback as an ordinary node.
 */
function markRelationshipAuthorityNarrativeFallback(node: SimulationNode): SimulationNode {
  const meta = node.financialProcessingMeta;
  if (!meta) return node;
  return {
    ...node,
    financialProcessingMeta: {
      ...meta,
      narrativeFallback: true,
      narrativeFallbackReasonCodes: [...new Set([
        ...(meta.narrativeFallbackReasonCodes || []),
        RELATIONSHIP_AUTHORITY_FALLBACK_TELEMETRY_CODE
      ])],
      narrativeFallbackSurfacePaths: [...new Set([
        ...(meta.narrativeFallbackSurfacePaths || []),
        RELATIONSHIP_AUTHORITY_FALLBACK_SURFACE_PATH
      ])],
      narrativeRepairAttempts: Math.max(1, meta.narrativeRepairAttempts || 0),
      narrativeRepairSucceeded: false
    }
  };
}

/**
 * This is deliberately a surface repair, not a second financial proposal. It
 * keeps every description sentence and choice that remains valid against the
 * relationship authority, removes only the rejected relationship surface, and
 * therefore cannot erase already accepted financial facts after the ledger has
 * been committed.
 */
export function repairRelationshipAuthorityFinalSurface(input: {
  node: SimulationNode;
  nodeEvent?: LifeEventSeed;
  nodeEventMeta?: EventMeta;
  elapsedMonths: number;
  targetAgeInMonths: number;
  people: WorldStateSnapshot["people"];
  worldState: WorldStateSnapshot;
}): { node: SimulationNode; eventMeta: EventMeta } {
  const fallback = buildRelationshipAuthorityDeterministicFallback(input);
  const eventMeta = fallback.eventMeta;
  const metadataStripped = stripUnauthorizedRomanticCharacters(input.node, input.worldState);
  const withoutRelationshipMetadata: SimulationNode = {
    ...metadataStripped,
    eventMeta,
    narrativeMeta: metadataStripped.narrativeMeta ? {
      ...metadataStripped.narrativeMeta,
      relationshipProposals: [],
      worldDeltas: (metadataStripped.narrativeMeta.worldDeltas || []).filter((delta) => delta.type !== "relationship_change")
    } : metadataStripped.narrativeMeta
  };
  const hasRelationshipConflict = (candidate: SimulationNode) => validateStoryConsistency({
    node: candidate,
    targetAgeInMonths: input.targetAgeInMonths,
    people: input.people,
    worldState: input.worldState
  }).some((issue) => issue.severity === "error" && issue.code === "relationship_authority_conflict");

  // Begin from known-safe choices and an empty description, then add only the
  // original user-visible fragments that remain legal. This is a monotonic
  // cleanup: a retained financial sentence is never rewritten or inferred.
  let repaired: SimulationNode = {
    ...withoutRelationshipMetadata,
    choices: fallback.node.choices,
    description: "",
    descriptionParagraphs: []
  };
  if (hasRelationshipConflict(repaired)) {
    repaired = { ...repaired, title: fallback.node.title };
  }

  // Paragraphs often contain both a ledger-backed sentence and the offending
  // relationship assertion. Split every supplied paragraph into sentences so
  // removing the latter never silently drops the former.
  const originalFragments = (input.node.descriptionParagraphs?.length
    ? input.node.descriptionParagraphs.flatMap((paragraph) => paragraph.split(/(?<=[。！？；\n])/u))
    : input.node.description.split(/(?<=[。！？；\n])/u)
  ).map((fragment) => fragment.trim()).filter(Boolean);
  const retainedFragments: string[] = [];
  for (const fragment of originalFragments) {
    const nextDescription = [...retainedFragments, fragment].join("\n\n");
    const candidate = {
      ...repaired,
      description: nextDescription,
      descriptionParagraphs: splitNarrativeParagraphs(nextDescription)
    };
    if (!hasRelationshipConflict(candidate)) {
      retainedFragments.push(fragment);
      repaired = candidate;
    }
  }
  if (retainedFragments.length === 0) {
    repaired = {
      ...repaired,
      description: fallback.node.description,
      descriptionParagraphs: fallback.node.descriptionParagraphs
    };
  }

  input.node.choices.forEach((choice, index) => {
    const choices = repaired.choices.map((fallbackChoice, choiceIndex) => (
      choiceIndex === index ? choice : fallbackChoice
    ));
    const candidate = { ...repaired, choices };
    if (!hasRelationshipConflict(candidate)) repaired = candidate;
  });

  return {
    eventMeta,
    node: {
      ...repaired,
      narrativeMeta: repaired.narrativeMeta ? {
        ...repaired.narrativeMeta,
        storyEpisode: {
          ...repaired.narrativeMeta.storyEpisode,
          summary: repaired.description
        }
      } : repaired.narrativeMeta
    }
  };
}

function readRomanceCandidateRepair(value: unknown): NonNullable<SimulationNode["narrativeMeta"]>["activeCharacters"][number] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const characters = Array.isArray(record.activeCharacters) ? record.activeCharacters : [record];
  const raw = characters.find((character) => character && typeof character === "object") as Record<string, unknown> | undefined;
  const displayName = typeof raw?.displayName === "string" ? raw.displayName.trim() : "";
  if (!isValidRomanceDisplayName(displayName)) return undefined;
  const encounterContext = ["personal", "mixed", "professional"].includes(String(raw?.encounterContext || ""))
    ? raw?.encounterContext as "personal" | "mixed" | "professional"
    : "professional";
  const groundingEvidence = typeof raw?.groundingEvidence === "string" ? raw.groundingEvidence.trim() : "";
  return {
    candidateOrdinal: 0,
    displayName,
    relation: "other",
    presenceMode: "active_scene",
    currentRole: typeof raw?.currentRole === "string" && raw.currentRole.trim() ? raw.currentRole.trim() : "新认识的人",
    encounterType: "new_connection",
    encounterContext,
    groundingEvidence: groundingEvidence || undefined
  };
}

interface RomanceCandidatePreparation {
  node: SimulationNode;
  repairAttempted: boolean;
  repairSucceeded: boolean;
}

async function prepareDeterministicRomanceCandidate(
  node: SimulationNode,
  eventIntentType: string | undefined,
  callAiJson: AiJsonCaller
): Promise<RomanceCandidatePreparation> {
  if (!isDeterministicRomanceIntent(eventIntentType) || eventIntentType !== "romance_new_connection") {
    return { node, repairAttempted: false, repairSucceeded: false };
  }
  if (groundedRomanceCharacter(node, eventIntentType)) {
    return { node, repairAttempted: false, repairSucceeded: false };
  }
  let prepared = node;
  try {
    const response = await callAiJson(`你只负责从既有正文中提取一个候选人物脚手架，不得改写正文、选项或关系状态。\n\n正文：\n${node.description}\n\n只返回以下 JSON：\n{"activeCharacters":[{"candidateOrdinal":0,"displayName":"正文中的真实姓名或明确昵称","relation":"other","presenceMode":"active_scene","currentRole":"人物当前身份","encounterType":"new_connection","encounterContext":"personal或mixed或professional","groundingEvidence":"正文中逐字出现、能证明交流离开纯业务语境的一句"}]}\n\n规则：displayName 与 groundingEvidence 必须逐字来自正文；displayName 禁止使用“你、我、他、她、对方、朋友、同事、教练”等代词或泛称；正文没有真实姓名或明确昵称时必须返回 {"activeCharacters":[]}；只有正文明确出现个人话题、共同兴趣或私人邀约时 encounterContext 才能是 personal 或 mixed；纯项目、客户、投资、合同或合作交流必须返回 professional；无法识别时返回 {"activeCharacters":[]}。`);
    const repaired = readRomanceCandidateRepair(parseAiJsonResponse(response));
    if (repaired) prepared = withRomanceCandidate(prepared, repaired);
  } catch {
    // A failed local extraction must not mutate relationship state. The caller
    // will redispatch the node instead of repeating the same full event.
  }
  return {
    node: prepared,
    repairAttempted: true,
    repairSucceeded: Boolean(groundedRomanceCharacter(prepared, eventIntentType))
  };
}

interface PendingRomanceReschedule {
  requestedEventId: string;
  fallbackReason?: string;
  nodesSinceFallback: number;
}

function buildDeterministicRomanceRescheduleNode(
  node: SimulationNode,
  requestedEventId: string,
  reason: string,
  repairAttempted: boolean
): SimulationNode {
  const fallbackChoices = [
    "保持当前工作与生活节奏，等待更明确的信息",
    "重新安排时间和责任，为未来选择留出空间",
    "把注意力放回最紧迫的现实任务，暂不推进新的关系"
  ];
  const description = "这次见面停留在工作与日常交流上。你照常处理手边的工作、健康和生活安排，没有急着把一次联系推向更远的关系。";
  return {
    ...node,
    title: "一次尚未展开的联系",
    description,
    descriptionParagraphs: [description],
    choices: fallbackChoices.map((text, index) => ({
      id: String.fromCharCode(65 + index),
      text,
      impactSummary: index === 0 ? "保持节奏" : index === 1 ? "留出空间" : "现实优先",
      decisionIntent: `growth:relationship_reschedule:${index + 1}`,
      expectedWorldDeltaTypes: []
    })),
    narrativeMeta: node.narrativeMeta ? {
      ...node.narrativeMeta,
      activeCharacters: (node.narrativeMeta.activeCharacters || []).filter((character) => character.candidateOrdinal == null),
      relationshipProposals: [],
      worldDeltas: (node.narrativeMeta.worldDeltas || []).filter((delta) => delta.type !== "relationship_change")
    } : node.narrativeMeta,
    eventMeta: {
      eventId: "relationship_authority_fallback",
      eventCategory: "growth",
      eventTags: ["relationship", "authority_fallback"],
      eventIntensity: "minor",
      eventMode: "stability_meaning",
      routeLine: "growth",
      selectionKind: "unmixed",
      requestedEventId,
      fallbackReason: reason,
      romanceRepairAttempted: repairAttempted,
      romanceRepairSucceeded: false,
      romanceRescheduled: true
    }
  };
}

export function eventSpecificFallbackDefinitions(event?: LifeEventSeed): Array<{
  text: string;
  summary: string;
  intent: string;
  delta: WorldDelta["type"];
}> {
  if (!event) {
    return [
      { text: "按当前方向继续推进，并在三个月内核验已经发生的现实结果", summary: "继续核验", intent: "growth:continue_with_review", delta: "career_state" },
      { text: "缩小当前投入，优先稳定现金流、健康和日常责任", summary: "收缩稳定", intent: "growth:stabilize_resources", delta: "health_state" },
      { text: "暂停当前方向，转向另一项可以立即验证的现实机会", summary: "暂停转向", intent: "growth:pivot_to_alternative", delta: "location_change" }
    ];
  }

  const subject = `“${event.title}”`;
  const prefix = `event:${event.id}`;
  switch (event.category) {
    case "career":
      return [
        { text: `围绕${subject}与相关方确认一项可执行的工作安排，并在本周期核验结果`, summary: "确认工作", intent: `${prefix}:confirm_work_plan`, delta: "career_state" },
        { text: `暂缓${subject}中的高风险承诺，先把职责、时间和现实边界谈清楚`, summary: "厘清边界", intent: `${prefix}:bound_commitment`, delta: "health_state" },
        { text: `保留${subject}的关键信息，同时把精力投入一条能尽快验证的职业备选路径`, summary: "验证备选", intent: `${prefix}:test_alternative`, delta: "location_change" }
      ];
    case "financial":
      return [
        { text: `为${subject}列出可承受的资金边界，再决定是否继续投入`, summary: "核定边界", intent: `${prefix}:set_cash_boundary`, delta: "career_state" },
        { text: `缩小${subject}的支出或承诺，优先守住必要生活与现有现金流`, summary: "保留现金", intent: `${prefix}:reduce_exposure`, delta: "health_state" },
        { text: `放弃${subject}中无法核验的部分，改用低成本方案验证下一步`, summary: "低成本试", intent: `${prefix}:test_low_cost`, delta: "location_change" }
      ];
    case "relationship":
      return [
        { text: `围绕${subject}把彼此的边界和下一步安排说清楚，再决定是否继续投入`, summary: "沟通边界", intent: `${prefix}:clarify_boundary`, delta: "relationship_change" },
        { text: `保留${subject}中的必要联系，但暂不作出超出现实条件的承诺`, summary: "保留联系", intent: `${prefix}:maintain_boundary`, delta: "health_state" },
        { text: `退出${subject}中让自己持续消耗的部分，把注意力放回当下责任`, summary: "退出消耗", intent: `${prefix}:step_back`, delta: "career_state" }
      ];
    case "health":
      return [
        { text: `围绕${subject}落实作息、治疗或减负安排，并在短期内复查效果`, summary: "落实修复", intent: `${prefix}:follow_recovery_plan`, delta: "health_state" },
        { text: `保留${subject}相关的必要活动，但把强度降到身体能够承受的范围`, summary: "降低强度", intent: `${prefix}:reduce_load`, delta: "career_state" },
        { text: `暂停${subject}中会继续透支的部分，先重建稳定的生活节奏`, summary: "暂停透支", intent: `${prefix}:pause_overload`, delta: "location_change" }
      ];
    case "opportunity":
      return [
        { text: `为${subject}安排一次小范围试做，用真实结果判断是否继续投入`, summary: "小范围试", intent: `${prefix}:run_small_trial`, delta: "career_state" },
        { text: `保留${subject}的机会窗口，但先核对时间、资金和已有责任是否匹配`, summary: "核对条件", intent: `${prefix}:verify_constraints`, delta: "health_state" },
        { text: `婉拒${subject}中不合适的条件，把资源留给当前更重要的方向`, summary: "保留资源", intent: `${prefix}:decline_terms`, delta: "location_change" }
      ];
    case "community":
      return [
        { text: `把${subject}落实为一次具体参与，先观察它是否能形成持续支持`, summary: "实际参与", intent: `${prefix}:participate_once`, delta: "relationship_change" },
        { text: `保留${subject}中的联系，但控制投入频率以免挤占现有责任`, summary: "控制投入", intent: `${prefix}:limit_commitment`, delta: "health_state" },
        { text: `暂不继续${subject}中无明确回报的安排，重新选择更适合当前阶段的连接`, summary: "调整连接", intent: `${prefix}:redirect_connection`, delta: "career_state" }
      ];
    case "growth":
    default:
      return [
        { text: `围绕${subject}继续推进一个可核验的步骤，并在本周期回看实际影响`, summary: "推进核验", intent: `${prefix}:continue_and_review`, delta: "career_state" },
        { text: `缩小${subject}中的非必要投入，优先稳定健康和日常责任`, summary: "收缩稳定", intent: `${prefix}:stabilize_commitment`, delta: "health_state" },
        { text: `暂停${subject}当前的做法，转向一条可以立即验证的现实路径`, summary: "转向验证", intent: `${prefix}:pivot_to_test`, delta: "location_change" }
      ];
  }
}

function applyDeterministicDecisionGateFallback(
  node: SimulationNode,
  allowedOutcomeIds: string[] = [],
  intentScope = String(node.ageInMonths ?? node.age),
  event?: LifeEventSeed,
  reasonCodes: string[] = []
): SimulationNode {
  const definitions = eventSpecificFallbackDefinitions(event);
  const fallbackReason = `decision_gate_deterministic:${reasonCodes.join("+") || "unspecified"}`;
  return {
    ...node,
    choices: definitions.map((definition, index) => ({
      id: String.fromCharCode(65 + index),
      text: definition.text,
      impactSummary: definition.summary,
      decisionIntent: `${definition.intent}:${intentScope}`,
      eventOutcomeId: allowedOutcomeIds.length ? allowedOutcomeIds[index % allowedOutcomeIds.length] : undefined,
      expectedWorldDeltaTypes: [definition.delta],
      temporalHint: {
        lifeIntensity: "normal",
        durationMonths: [3, 6],
        requiresFollowUp: false,
        reason: `DecisionGate 修复：${reasonCodes.join("、") || "候选选项未形成可验证分岔"}`
      }
    })),
    narrativeMeta: node.narrativeMeta ? {
      ...node.narrativeMeta,
      nodeMateriality: "decision_checkpoint",
      lifeIntensity: "normal"
    } : node.narrativeMeta,
    eventMeta: node.eventMeta ? {
      ...node.eventMeta,
      fallbackReason
    } : node.eventMeta
  };
}

function buildDeterministicCandidateFallback(input: {
  node: SimulationNode;
  selectedDecision: string;
  allowedOutcomeIds?: string[];
  issueCodes: string[];
  intentScope?: string;
  event?: LifeEventSeed;
  decisionGateReasonCodes?: string[];
}): SimulationNode {
  const safeNode = applyDeterministicDecisionGateFallback(
    input.node,
    input.allowedOutcomeIds,
    input.intentScope,
    input.event,
    input.decisionGateReasonCodes ?? input.issueCodes
  );
  const selectedDecision = input.selectedDecision.trim().replace(/[。！？]+$/u, "");
  const description = selectedDecision
    ? `你把“${selectedDecision}”写进接下来三个月的安排里。能立刻动手的部分先做，暂时卡住的部分留到下一次复盘。`
    : "你把眼前的责任重新排了一遍，能立刻动手的部分先做，暂时卡住的部分留到下一次复盘。";
  return {
    ...safeNode,
    title: "选择落地前的现实调整",
    description,
    descriptionParagraphs: [description],
    narrativeMeta: safeNode.narrativeMeta ? {
      ...safeNode.narrativeMeta,
      activeCharacters: [],
      relationshipProposals: [],
      worldDeltas: [],
      arcSignals: [],
      recoveryEvidence: [],
      storyEpisode: {
        ...safeNode.narrativeMeta.storyEpisode,
        internalTransitions: [],
        summary: selectedDecision ? `开始落实“${selectedDecision}”，并设置下一次复盘。` : "重新安排当前责任，并设置下一次复盘。"
      }
    } : safeNode.narrativeMeta,
    eventMeta: {
      eventId: "candidate_authority_fallback",
      eventCategory: "growth",
      eventTags: ["candidate_repair", "authority_fallback", ...input.issueCodes],
      eventIntensity: "minor",
      eventMode: "stability_meaning",
      routeLine: "growth",
      selectionKind: "unmixed",
      fallbackReason: `candidate_budget_exhausted:${input.issueCodes.join("+")}`
    }
  };
}

function buildInvalidInitialGenerationFallback(input: {
  currentAttributes: LifeAttributes;
  selectedDecision: string;
  allowedOutcomeIds?: string[];
  targetAge: number;
  targetAgeInMonths: number;
  previousAgeInMonths: number;
  elapsedMonths: number;
  lifeIntensity: LifeIntensity;
  nodeIndex: number;
}): SimulationNode {
  const baseNode = normalizeSimulationNode({
    title: "选择落地前的现实调整",
    description: "你把眼前的责任重新排了一遍，能立刻动手的部分先做，暂时卡住的部分留到下一次复盘。",
    attributes: input.currentAttributes,
    choices: [],
    narrativeMeta: {
      recoveryState: "neutral",
      lifeIntensity: input.lifeIntensity,
      activeCharacters: [],
      relationshipProposals: [],
      worldDeltas: [],
      arcSignals: [],
      recoveryEvidence: [],
      storyEpisode: {
        summary: "重新安排当前责任，并设置下一次复盘。",
        internalTransitions: []
      }
    }
  }, {
    fallbackAge: input.targetAge,
    minAge: input.targetAge,
    maxAge: input.targetAge,
    targetAgeInMonths: input.targetAgeInMonths,
    previousAgeInMonths: input.previousAgeInMonths,
    elapsedMonths: input.elapsedMonths,
    lifeIntensity: input.lifeIntensity
  });
  return buildDeterministicCandidateFallback({
    node: baseNode,
    selectedDecision: input.selectedDecision,
    allowedOutcomeIds: input.allowedOutcomeIds,
    issueCodes: ["INITIAL_GENERATION_INVALID"],
    intentScope: `node-${input.nodeIndex}`
  });
}

function pendingRomanceReschedule(history: HistoryItem[]): PendingRomanceReschedule | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const marker = history[index]?.eventMeta;
    if (!marker?.romanceRescheduled || !marker.requestedEventId) continue;
    const laterHistory = history.slice(index + 1);
    const fulfilled = laterHistory.some((item) => (
      item.eventMeta?.eventId === marker.requestedEventId
      || item.eventMeta?.romanceRescheduleFulfilled === true
    ));
    if (fulfilled) return undefined;
    return {
      requestedEventId: marker.requestedEventId,
      fallbackReason: marker.fallbackReason,
      nodesSinceFallback: laterHistory.length
    };
  }
  return undefined;
}

function deferredRomanceEventIds(history: HistoryItem[]): string[] {
  const pending = pendingRomanceReschedule(history);
  return pending && pending.nodesSinceFallback < 2 ? [pending.requestedEventId] : [];
}

async function generateNextNodeAttempt(
  input: GenerateNextNodeInput,
  deps: SimulationServiceDeps = {}
): Promise<SimulationNode> {
  deps.onGenerationStage?.("preparing");
  const callAiJson = getAiJsonCaller(deps);
  const callAiJsonStream = getAiJsonStreamCaller(deps, callAiJson);
  const generationBudget = deps.generationBudget ?? createNodeGenerationBudget();
  const lastNode = input.history[input.history.length - 1];
  const lastAge = lastNode ? lastNode.age : (input.userData.regressionAge || 20);
  const currentAgeInMonths = lastNode?.ageInMonths ?? lastAge * 12;
  const currentFinancialState = lastNode?.financialState
    || estimateFinancialStateFromWealth(input.currentAttributes.wealth, currentAgeInMonths);
  // A restored v2 ledger is upgraded only as a working candidate. The HistoryItem
  // remains byte-for-byte unchanged until a new node is committed.
  const currentFinancialLedger = lastNode?.financialLedger
    ? isFinancialLedgerV4(lastNode.financialLedger)
      ? structuredClone(lastNode.financialLedger)
      : migrateFinancialLedgerV2ToV3(lastNode.financialLedger as unknown as FinancialLedgerInput)
    : undefined;
  const nodeIndex = input.nodeIndex ?? input.history.length;
  const dispatchFlags = relationshipDispatchFeatureFlags(deps.relationshipDispatchFeatureFlags);
  const simulationSeed = input.simulationSeed || stableHash({ user: input.userData.birthday, regressionAge: input.userData.regressionAge });
  const branchFingerprint = buildBranchFingerprint(input.history, input.selectedDecision, nodeIndex);
  const selectedOutcomeId = resolveSelectedOutcomeId(input.history, input.selectedDecision);
  const baseWorldState = latestWorldState(input.history);
  const existingCareerState = currentCareerState(baseWorldState);
  const openingEmploymentStatus = resolveAuthoritativeEmploymentStatus({
    currentCareerState: existingCareerState,
    worldState: baseWorldState,
    legacyFinancialState: currentFinancialState,
    isInitialization: !existingCareerState && baseWorldState.currentEmploymentStatus === undefined
  }) || "not_working";
  const migratedCareerState = existingCareerState || initializeCareerState({
    id: `career_migrated_${currentAgeInMonths}`,
    employmentStatus: openingEmploymentStatus,
    effectiveFromAgeInMonths: currentAgeInMonths,
    confidence: currentFinancialState.isEstimated ? 0.6 : 0.8
  });
  const migratedWorldState = ensureRelationshipWorldState({
    ...baseWorldState,
    directionArcs: ensureDirectionArcs(baseWorldState, input.userData, currentAgeInMonths),
    careerStates: existingCareerState ? baseWorldState.careerStates : [migratedCareerState],
    currentCareerStateId: migratedCareerState.id,
    careerRevision: baseWorldState.careerRevision || 0,
    currentEmploymentStatus: migratedCareerState.employmentStatus,
    version: 2 as const
  }, currentAgeInMonths);
  const relationshipOutcome = lastNode && dispatchFlags.enableAuthoritativeRelationshipStages
    ? applySelectedRelationshipOutcome({
        current: migratedWorldState,
        selectedHistoryItem: lastNode,
        simulationSeed,
        branchFingerprint,
        nodeIndex: Math.max(0, nodeIndex - 1),
        effectiveAtAgeInMonths: currentAgeInMonths,
        romanceEnabled: dispatchFlags.enableRomanceFormationEvents,
        trustedFamilyActivationEnabled: dispatchFlags.enableTrustedFamilyActivation
      })
    : { worldStateSnapshot: migratedWorldState, committed: false };
  const currentWorldState = relationshipOutcome.worldStateSnapshot;
  const selectionHistory = lastNode
    ? [...input.history.slice(0, -1), { ...lastNode, worldStateSnapshot: currentWorldState }]
    : input.history;
  const relationshipCheckpoint = dispatchFlags.enableRomanceLifecycleScheduling
    ? activeRelationshipCheckpoint(currentWorldState, currentAgeInMonths)
    : undefined;
  const relationshipDeferralState = relationshipCheckpoint
    ? deriveRelationshipDeferralState(selectionHistory, relationshipCheckpoint)
    : undefined;
  const relationshipFollowUpDue = relationshipCheckpoint
    && !deps.romanceFallbackContext
    && ["due", "overdue"].includes(relationshipCheckpoint.status)
    ? LIFE_EVENTS_DATABASE.find((event) => event.id === relationshipLifecycleEventId(relationshipCheckpoint, currentAgeInMonths)) || null
    : null;
  const relationshipDispatchDeadlineReached = Boolean(
    relationshipCheckpoint
    && currentAgeInMonths >= relationshipCheckpoint.progression.maxAtAgeInMonths
  );
  const relationshipRestorationRequired = Boolean(
    relationshipFollowUpDue
    && (
      relationshipDispatchDeadlineReached
      || relationshipDeferralState?.mustRestore
    )
  );
  // Foreground scheduling remains deterministic. Acute health is the only
  // event allowed to preempt an active debt Arc; relationship dispatch never
  // bypasses an already active foreground Arc.
  const activeHealthArc = activeArcByPolicy(currentWorldState, HEALTH_CRISIS_PHASE_POLICY.id);
  const activeDebtArc = activeArcByPolicy(currentWorldState, FINANCIAL_DEBT_PHASE_POLICY.id);
  const foregroundArc = foregroundPressureArc(selectionHistory);
  const otherActiveArc = currentWorldState.pressureArcs.find((arc) => (
    arc.status !== "resolved"
    && arc.status !== "suspended"
    && arc.phasePolicyId !== HEALTH_CRISIS_PHASE_POLICY.id
    && arc.phasePolicyId !== FINANCIAL_DEBT_PHASE_POLICY.id
  ));
  const blockingGenericArc = foregroundArc?.phasePolicyId !== FINANCIAL_DEBT_PHASE_POLICY.id
    && foregroundArc?.phasePolicyId !== HEALTH_CRISIS_PHASE_POLICY.id
    ? foregroundArc
    : otherActiveArc;
  const healthEscalationEvent = activeHealthArc || blockingGenericArc || relationshipRestorationRequired
    ? null
    : queryHealthEscalationEvent(input.currentAttributes, selectionHistory);
  const scheduledExistingArc = activeHealthArc
    || (!healthEscalationEvent ? activeDebtArc || foregroundArc || otherActiveArc : undefined);
  const existingPressureArc = scheduledExistingArc;
  const debtEscalationEvent = scheduledExistingArc || healthEscalationEvent
    ? undefined
    : queryDebtEscalationEvent({ history: selectionHistory, worldState: currentWorldState });
  const selectionEntropy = createSelectionEntropy({ simulationSeed, branchFingerprint, nodeIndex });
  const e2eEventOverride = scheduledExistingArc || healthEscalationEvent || debtEscalationEvent
    ? undefined
    : getBrowserE2eEventOverride(input.history.length);
  const pendingRomance = pendingRomanceReschedule(selectionHistory);
  const romanceRescheduleDue = Boolean(
    pendingRomance
    && pendingRomance.nodesSinceFallback >= 2
    && dispatchFlags.enableRomanceFormationEvents
    && !deps.romanceFallbackContext
  );
  const rescheduledRomanceEvent = !scheduledExistingArc && e2eEventOverride === undefined && !healthEscalationEvent && !debtEscalationEvent && romanceRescheduleDue
    ? queryDynamicLifeEvent(
        input.currentAttributes,
        input.userData,
        currentAgeInMonths / 12,
        selectionHistory,
        input.answers,
        {
          entropy: selectionEntropy,
          applyCareerLineMix: false,
          enableRomanceFormationEvents: true,
          enableRomanceFormationAgeAffinity: dispatchFlags.enableRomanceFormationAgeAffinity,
          includedEventIds: [pendingRomance!.requestedEventId]
        }
      )
    : null;
  const independentCriticalHealthEvent = healthEscalationEvent?.id === "health_forced_pause"
    ? healthEscalationEvent
    : null;
  const dynamicEvent = !scheduledExistingArc && e2eEventOverride === undefined && !healthEscalationEvent && !debtEscalationEvent
    ? relationshipFollowUpDue || (rescheduledRomanceEvent || queryDynamicLifeEvent(
        input.currentAttributes,
        input.userData,
        currentAgeInMonths / 12,
        selectionHistory,
        input.answers,
        {
          entropy: selectionEntropy,
          applyCareerLineMix: dispatchFlags.enableLineMixPolicy && input.userData.coreStoryFocus === "career",
          enableRomanceFormationEvents: dispatchFlags.enableRomanceFormationEvents && !deps.romanceFallbackContext,
          enableRomanceFormationAgeAffinity: dispatchFlags.enableRomanceFormationAgeAffinity,
          excludedEventIds: [
            ...deferredRomanceEventIds(selectionHistory),
            ...(deps.romanceFallbackContext ? [deps.romanceFallbackContext.requestedEventId] : [])
          ]
        }
      ))
    : null;
  const dynamicSelectionTrace = !relationshipFollowUpDue && (dynamicEvent || (!scheduledExistingArc && e2eEventOverride === undefined && !healthEscalationEvent && !debtEscalationEvent))
    ? getLastEventSelectionTrace()
    : undefined;
  const selectedEvent = scheduledExistingArc
    ? null
    : healthEscalationEvent
      || debtEscalationEvent
      || (e2eEventOverride !== undefined
        ? LIFE_EVENTS_DATABASE.find((event) => event.id === e2eEventOverride) || null
        : relationshipRestorationRequired
          ? relationshipFollowUpDue
          : relationshipFollowUpDue || dynamicEvent);
  const selectedEventProfile = selectedEvent ? getEventTemporalProfile(selectedEvent) : undefined;
  const startPolicy = resolvePhasePolicy(selectedEvent?.intent.phasePolicyId);
  const startArcDecision = selectedEvent && selectedEventProfile?.requiresFollowUp
    ? activeDebtArc && selectedEvent.id === "health_forced_pause"
      ? preemptDebtArcForAcuteHealth({
          debtArc: activeDebtArc,
          healthStartProposal: {
            eventId: selectedEvent.id,
            eventIntentType: selectedEvent.intent.type,
            currentAgeInMonths,
            summary: selectedEvent.intent.meaning
          }
        })
      : reducePressureArc({
        startProposal: { eventId: selectedEvent.id, eventIntentType: selectedEvent.intent.type, currentAgeInMonths, summary: selectedEvent.intent.meaning },
        policy: startPolicy,
        selectedDecision: input.selectedDecision,
        attributes: input.currentAttributes,
        timelineAdvance: { elapsedMonths: 0, targetAgeInMonths: currentAgeInMonths }
      })
    : undefined;
  const workingPressureArc = scheduledExistingArc || startArcDecision?.nextArcState;
  const pressureArcPolicy = resolvePhasePolicy(workingPressureArc?.phasePolicyId);
  const isPressureArcInterleave = Boolean(
    existingPressureArc
    && relationshipFollowUpDue
    && relationshipCheckpoint
    && (
      relationshipDispatchDeadlineReached
      || relationshipDeferralState?.mustRestore
    )
  );
  const nodeEvent = isPressureArcInterleave
    ? relationshipFollowUpDue
    : workingPressureArc
    ? selectArcContinuationEvent({
        arc: workingPressureArc,
        attributes: input.currentAttributes,
        userData: input.userData,
        age: Math.floor(currentAgeInMonths / 12),
        history: input.history,
        answers: input.answers,
        entropy: selectionEntropy
      })
    : selectedEvent;
  const isSelectedRelationshipFollowUp = Boolean(
    relationshipFollowUpDue
    && (!workingPressureArc || isPressureArcInterleave)
    && nodeEvent?.id === relationshipFollowUpDue.id
  );
  let nodeEventMeta: EventMeta | undefined = nodeEvent ? {
    ...buildEventMeta(nodeEvent),
    ...(existingPressureArc || healthEscalationEvent
      ? { selectionKind: "forced" as const }
      : e2eEventOverride !== undefined
        ? { selectionKind: "override" as const }
        : dynamicSelectionTrace?.lineSelection
          ? {
              selectionKind: dynamicSelectionTrace.lineSelection.selectionKind,
              linePolicyId: dynamicSelectionTrace.lineSelection.policyId,
              fallbackReason: dynamicSelectionTrace.lineSelection.fallbackReason,
              lineFallbackReason: dynamicSelectionTrace.lineSelection.fallbackReason,
              crossLineCandidateAvailable: dynamicSelectionTrace.lineSelection.crossLineCandidateAvailable
            }
          : {}),
    ...(isSelectedRelationshipFollowUp && relationshipCheckpoint ? {
      selectionKind: "relationship_follow_up" as const,
      relationshipCheckpointKind: relationshipCheckpoint.progression.checkpointKind,
      relationshipCheckpointStatus: relationshipCheckpoint.status,
      relationshipCheckpointWaitMonths: Math.max(0, currentAgeInMonths - relationshipCheckpoint.progression.startedAtAgeInMonths),
      relationshipCheckpointDueAtAgeInMonths: relationshipCheckpoint.progression.dueAtAgeInMonths,
      relationshipCheckpointMaxAtAgeInMonths: relationshipCheckpoint.progression.maxAtAgeInMonths,
      relationshipCheckpointKey: relationshipCheckpointKey(relationshipCheckpoint),
      relationshipCheckpointDeferredCount: relationshipDeferralState?.consecutiveDeferredNodes || 0,
      relationshipCheckpointMustRestore: relationshipDeferralState?.mustRestore || false,
      pressureArcInterleaved: isPressureArcInterleave
    } : {}),
    ...(!isSelectedRelationshipFollowUp
      && (existingPressureArc || healthEscalationEvent || e2eEventOverride !== undefined)
      && relationshipCheckpoint
      && ["due", "overdue"].includes(relationshipCheckpoint.status)
      ? {
          relationshipCheckpointKind: relationshipCheckpoint.progression.checkpointKind,
          relationshipCheckpointStatus: relationshipCheckpoint.status,
          relationshipCheckpointWaitMonths: Math.max(0, currentAgeInMonths - relationshipCheckpoint.progression.startedAtAgeInMonths),
          relationshipCheckpointDueAtAgeInMonths: relationshipCheckpoint.progression.dueAtAgeInMonths,
          relationshipCheckpointMaxAtAgeInMonths: relationshipCheckpoint.progression.maxAtAgeInMonths,
          relationshipCheckpointDeferred: true
        }
      : {}),
    ...(rescheduledRomanceEvent && pendingRomance ? {
      selectionKind: "unmixed" as const,
      requestedEventId: pendingRomance.requestedEventId,
      romanceRescheduleFulfilled: true,
      romanceRescheduleDelayNodes: pendingRomance.nodesSinceFallback
    } : {}),
    // The romance contract failure is the reason this replacement node exists.
    // Keep it authoritative while retaining any line-policy fallback separately.
    ...(deps.romanceFallbackContext ? {
      requestedEventId: deps.romanceFallbackContext.requestedEventId,
      fallbackReason: deps.romanceFallbackContext.reason,
      romanceRepairAttempted: deps.romanceFallbackContext.repairAttempted,
      romanceRepairSucceeded: false,
      romanceRescheduled: true
    } : {})
  } : deps.romanceFallbackContext ? {
    eventTags: [],
    selectionKind: "unmixed" as const,
    requestedEventId: deps.romanceFallbackContext.requestedEventId,
    fallbackReason: deps.romanceFallbackContext.reason,
    romanceRepairAttempted: deps.romanceFallbackContext.repairAttempted,
    romanceRepairSucceeded: false,
    romanceRescheduled: true
  } : undefined;
  const eventProfile = nodeEvent ? getEventTemporalProfile(nodeEvent) : selectedEventProfile;
  const pressurePhaseProfile = workingPressureArc && !isPressureArcInterleave
    ? resolvePhase(pressureArcPolicy, workingPressureArc.phaseId)
    : undefined;
  const stableNodeCount = input.history.slice(-2).filter((item) => item.narrativeMeta?.lifeIntensity === "stable").length;
  const baseTemporalProfile = deriveTemporalProfile({
    pressurePhaseProfile,
    choiceHint: resolveChoiceTemporalHint(input.history, input.selectedDecision),
    eventProfile,
    attributes: input.currentAttributes,
    stableNodeCount
  });
  const temporalProfile = constrainTemporalProfileForDebtDistress({
    temporalProfile: baseTemporalProfile,
    debtHealthLevel: lastNode?.debtHealthState?.level,
    isDebtDistressEvent: [
      "financial_debt_pressure_emerges",
      "financial_repayment_tradeoff",
      "financial_payment_strain"
    ].includes(nodeEvent?.id || "")
  });
  const timelineAdvance = calculateTimelineAdvance({
    currentAgeInMonths,
    temporalProfile,
    simulationSeed,
    branchFingerprint,
    hardMaximumAge: DEFAULT_ENDING_POLICY.hardMaximumAge,
    nextMilestoneAgeInMonths: deps.romanceFallbackContext && relationshipCheckpoint
        ? currentAgeInMonths + 1
      : earliestRelationshipCheckpointTimelineBoundary(currentWorldState, currentAgeInMonths)
  });
  const transactionId = stableHash({
    namespace: "simulation-transaction",
    simulationSeed,
    branchFingerprint,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths
  });
  const relationshipCheckpointDeferral = relationshipCheckpoint
    && !isSelectedRelationshipFollowUp
    && (existingPressureArc || healthEscalationEvent || e2eEventOverride !== undefined)
    ? deriveRelationshipCheckpointDeferral(relationshipCheckpoint.progression, timelineAdvance.targetAgeInMonths)
    : undefined;
  if (nodeEventMeta && relationshipCheckpointDeferral) {
    const deferredCount = (relationshipDeferralState?.consecutiveDeferredNodes || 0) + 1;
    nodeEventMeta = {
      ...nodeEventMeta,
      relationshipCheckpointKind: relationshipCheckpointDeferral.checkpointKind,
      relationshipCheckpointStatus: relationshipCheckpointDeferral.status,
      relationshipCheckpointWaitMonths: relationshipCheckpointDeferral.waitMonths,
      relationshipCheckpointDueAtAgeInMonths: relationshipCheckpointDeferral.dueAtAgeInMonths,
      relationshipCheckpointMaxAtAgeInMonths: relationshipCheckpointDeferral.maxAtAgeInMonths,
      relationshipCheckpointDeferred: true,
      relationshipCheckpointKey: relationshipCheckpoint
        ? relationshipCheckpointKey(relationshipCheckpoint)
        : undefined,
      relationshipCheckpointDeferredCount: deferredCount,
      relationshipCheckpointMustRestore: relationshipCheckpointDeferral.status === "overdue"
        || deferredCount >= 3
    };
  }
  const people = rebuildPersonStates(input.userData, input.history, timelineAdvance.targetAgeInMonths, currentWorldState.people, input.answers);
  const worldState = { ...currentWorldState, people };
  // `currentWorldState` already contains accepted relationship selections and
  // a migrated CareerState. Preserve those compatibility facts in the
  // baseline, but retain the last committed people/family/relationship sets
  // so a newly reconstructed accepted child or family transition is visible
  // to the lifecycle as a real state delta rather than a prose regex hit.
  const expenseLifecycleBaselineWorldState: WorldStateSnapshot = {
    ...currentWorldState,
    people: structuredClone(baseWorldState.people),
    relationships: structuredClone(baseWorldState.relationships || []),
    familyRelationships: structuredClone(baseWorldState.familyRelationships || [])
  };
  const ageContext = buildAgeContext({
    previousAgeInMonths: currentAgeInMonths,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    attributes: input.currentAttributes,
    userData: input.userData,
    history: input.history,
    people,
    directionArcs: worldState.directionArcs
  });
  const storyContext = buildStoryContextPack(input.userData, input.answers, input.history);
  const cacheAwarePromptV1 = deps.cacheAwarePromptV1 !== false;
  const cacheAwarePromptV2 = cacheAwarePromptV1 && deps.cacheAwarePromptV2 === true;
  const promptInput = {
    ...input,
    currentFinancialState,
    currentFinancialLedger,
    currentDebtHealthState: lastNode?.debtHealthState,
    selectedOutcomeId,
    eventSeed: nodeEvent,
    storyContext,
    timelineAdvance,
    ageContext,
    worldState,
    foregroundPressureArc: workingPressureArc,
    pressureArcInterleaved: isPressureArcInterleave,
    financialGateRetryReasonCodes: deps.financialGateRetryReasonCodes
  };
  const promptLayout = cacheAwarePromptV1
    ? buildNextNodePromptLayout(promptInput, { cacheAwarePromptV2 })
    : undefined;
  // The trace must describe the request actually sent. V2 can safely fall
  // back to the V1 layout if a caller supplies a stale Story Context Pack.
  const promptPrefixVersion = promptLayout?.prefixVersion ?? "next_node_legacy_v0";
  const prompt = promptLayout
    ? buildNextNodePromptRequestFromLayout(promptLayout)
    : buildNextNodePromptRequest(promptInput, { cacheAwarePromptV1, cacheAwarePromptV2 });

  let latestRawNode: any = {};
  deps.onGenerationStage?.("generating");
  const remainingFullGenerationAttempts = Math.max(
    1,
    generationBudget.fullGenerationLimit - generationBudget.fullGenerationsUsed
  );
  let node: SimulationNode;
  try {
    node = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
      const candidateRevision = consumeFullGeneration(generationBudget);
      let lastPreviewSignature = "";
      const response = await traceGenerationCall({
        kind: candidateRevision === 0 ? "initial_generation" : "full_regeneration",
        context: {
          transactionId,
          nodeIndex,
          candidateRevision,
          promptFamily: "next_node",
          promptPrefixVersion,
          issueCodes: previousIssues.length > 0
            ? previousIssues
            : candidateRevision > 0
              ? deps.fullRegenerationReasonCodes ?? []
              : []
        },
        listener: deps.onGenerationCallTrace,
        operation: async (markFirstToken, recordResponseMetadata) => {
          const result = await callAiJsonStream(
            buildNextNodeRetryPrompt(prompt, previousIssues, nodeEvent?.intent.type),
            {
              signal: deps.signal,
              onUsage: (usage) => recordResponseMetadata({ usage }),
              onContent: (content) => {
                markFirstToken();
                const preview = extractStreamedNodePreview(content);
                const signature = JSON.stringify(preview);
                if (signature === lastPreviewSignature) return;
                lastPreviewSignature = signature;
                deps.onNarrativeProgress?.(preview);
              }
            }
          );
          recordResponseMetadata(result);
          return result;
        }
      });
      // Keep the first raw payload intact until the authority check below. If we
      // strip an attempted Arc write here, the model violation becomes invisible
      // and the bounded consistency repair never runs.
      latestRawNode = parseAiJsonResponse(response);
      return latestRawNode;
    }, {
      fallbackAge: timelineAdvance.targetAge,
      minAge: timelineAdvance.targetAge,
      maxAge: timelineAdvance.targetAge,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      previousAgeInMonths: currentAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      pressureArcId: workingPressureArc?.id,
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      eventIntentType: nodeEvent?.intent.type,
      deferRomanceContractValidation: isDeterministicRomanceIntent(nodeEvent?.intent.type),
      fallbackAttributes: input.currentAttributes,
      fallbackAttributeHistory: input.history.map((item) => item.attributes),
      repairMissingChoiceText: deps.enableCandidatePatchRepair === true
        ? async (rawNode, invalidChoiceIndexes) => {
            if (!canPatch(generationBudget)) return rawNode;
            consumeModelPatch(generationBudget);
            latestRawNode = await traceGenerationCall({
              kind: "candidate_patch",
              context: {
                transactionId,
                nodeIndex,
                candidateRevision: generationBudget.fullGenerationsUsed - 1,
                promptFamily: "candidate_patch",
                issueCodes: ["choiceText"]
              },
              listener: deps.onGenerationCallTrace,
              operation: async (markFirstToken, recordResponseMetadata) => {
                const repaired = await repairGeneratedChoiceTexts(rawNode, invalidChoiceIndexes, callAiJson, recordResponseMetadata);
                markFirstToken();
                return repaired;
              }
            });
            return latestRawNode;
          }
        : undefined,
      maxAttempts: Math.min(2, remainingFullGenerationAttempts)
    });
  } catch (error) {
    if (!(error instanceof AiClientError)
      || error.code !== "AI_RESPONSE_INVALID"
      || canRegenerate(generationBudget)) throw error;
    node = buildInvalidInitialGenerationFallback({
      currentAttributes: input.currentAttributes,
      selectedDecision: input.selectedDecision,
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      targetAge: timelineAdvance.targetAge,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      previousAgeInMonths: currentAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      nodeIndex
    });
    latestRawNode = node;
  }
  deps.onGenerationStage?.("validating");
  node = {
    ...node,
    isEndingNode: false,
    eventMeta: nodeEventMeta,
    choices: node.choices.map((choice) => ({
      ...choice,
      expectedWorldDeltaTypes: choice.expectedWorldDeltaTypes?.length ? choice.expectedWorldDeltaTypes : fallbackWorldDeltaTypes({ ...node, eventMeta: nodeEventMeta })
    }))
  };
  node = canonicalizeGeneratedChoiceIds(node);
  node = attachPendingFinancialContext({
    node,
    previousState: currentFinancialState
  });
  node = stripUnauthorizedRomanticCharacters(node, worldState);
  // Later financial/narrative sanitizers can require a relation-only final
  // surface fallback; keep that telemetry scoped to this generated node.
  let relationshipAuthorityFallbackApplied = false;
  node = stripUnauthorizedRelationshipChoices(node, worldState);
  if (containsForbiddenArcWrite(latestRawNode)) {
    latestRawNode = stripForbiddenArcWrites(latestRawNode);
    node = stripForbiddenArcWrites(node) as SimulationNode;
  }

  const healthResolutionEvidence = "这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。";
  if (
    !isPressureArcInterleave
    && workingPressureArc?.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id
    && workingPressureArc.phaseId === "operation"
    && !hasMatchingPressureResolvedSignal(node, workingPressureArc, pressureArcPolicy)
    && node.narrativeMeta
  ) {
    const paragraphs = node.descriptionParagraphs?.filter(Boolean) ?? splitNarrativeParagraphs(node.description);
    if (!node.description.includes(healthResolutionEvidence)) paragraphs.push(healthResolutionEvidence);
    node = {
      ...node,
      descriptionParagraphs: paragraphs,
      description: paragraphs.join("\n\n"),
      narrativeMeta: {
        ...node.narrativeMeta,
        arcSignals: [
          { pressureArcId: workingPressureArc.id, type: "pressure_resolved", evidence: healthResolutionEvidence, confidence: 0.95 }
        ]
      }
    };
  }

  // Relationship authority has a narrow, explicit repair contract. In the
  // production Candidate-Patch mode, repair only the relation-owned surfaces
  // first and fall back deterministically if that bounded patch is malformed.
  // A full-node rewrite is reserved for deployments where Candidate Patch is
  // disabled; otherwise a local authority conflict needlessly doubles the
  // complete-generation count and can exhaust the user-visible retry budget.
  let relationshipConsistencyIssues = validateStoryConsistency({
    node,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    people,
    worldState
  });
  if (
    !isDeterministicRomanceIntent(nodeEvent?.intent.type)
    && hasOnlyRelationshipAuthorityConflicts(relationshipConsistencyIssues)
  ) {
    const relationshipAuthorityRepairRule = `关系事实只能保持当前权威值：${worldState.relationships.map((relationship) => (
      `stage=${relationship.stage || "unknown"}, status=${relationship.status}`
    )).join("；") || "暂无 active relationship"}。共同计划、长期安排或时间流逝不是同居、婚姻或生育的授权。请删除而不是改写为既成事实的同居、领证/结婚、婚后称谓、孩子出生、接送、托育和共同育儿；只有当前权威人物中已有 relation=child 时，才可保留既有育儿日常。`;
    const relationshipAuthorityFinalPatchRule = `【关系权威最终修复】\n上一次完整节点修复仍然让爱情正文或选项超前于权威关系状态。只修复当前候选的允许表面，并严格执行：\n1. 只写上一步 selectedDecision 和本次事件种子的现实后果；\n2. 当前事件不是爱情形成或关系 checkpoint，description 与 choices 必须删除新伴侣、具体爱情候选、约会、追求、表白、正式交往、复合、同居、领证、结婚、婚后称谓、孩子出生、接送、托育、共同育儿或分手；\n3. 可以写普通社交、参加活动、认识普通朋友，但不得让某个具体人物成为发展对象；\n4. 只能返回 node_candidate_patch_v1 合同，不得返回完整节点或解释。`;
    const applyFullRelationshipRepairResponse = (response: { text: string }) => {
      latestRawNode = stripForbiddenArcWrites(parseAiJsonResponse(response));
      if (containsForbiddenArcWrite(latestRawNode)) {
        throw new AiClientError("AI_RESPONSE_INVALID", "关系权威修复结果包含未授权的 Arc 状态修改。");
      }
      node = normalizeSimulationNode(latestRawNode, {
        fallbackAge: timelineAdvance.targetAge,
        minAge: timelineAdvance.targetAge,
        maxAge: timelineAdvance.targetAge,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        previousAgeInMonths: currentAgeInMonths,
        elapsedMonths: timelineAdvance.elapsedMonths,
        lifeIntensity: timelineAdvance.lifeIntensity,
        pressureArcId: workingPressureArc?.id
      });
      node = { ...node, isEndingNode: false, eventMeta: nodeEventMeta };
      node = attachPendingFinancialContext({ node, previousState: currentFinancialState });
      node = stripUnauthorizedRomanticCharacters(node, worldState);
      node = stripUnauthorizedRelationshipChoices(node, worldState);
      relationshipConsistencyIssues = validateStoryConsistency({
        node,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        people,
        worldState
      });
    };
    const targetedRelationshipPatchAvailable = deps.enableCandidatePatchRepair === true
      && canPatch(generationBudget);
    if (!targetedRelationshipPatchAvailable) {
      const repairedSurface = repairRelationshipAuthorityFinalSurface({
        node,
        nodeEvent,
        nodeEventMeta,
        elapsedMonths: timelineAdvance.elapsedMonths,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        people,
        worldState
      });
      const repairedIssues = validateStoryConsistency({
        node: repairedSurface.node,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        people,
        worldState
      });
      if (!hasOnlyRelationshipAuthorityConflicts(repairedIssues)) {
        node = repairedSurface.node;
        nodeEventMeta = repairedSurface.eventMeta;
        latestRawNode = {
          ...latestRawNode,
          ...node,
          financialEventProposals: rawFinancialEventProposals(latestRawNode)
        };
        relationshipConsistencyIssues = repairedIssues;
        relationshipAuthorityFallbackApplied = true;
      }
    }
    if (
      hasOnlyRelationshipAuthorityConflicts(relationshipConsistencyIssues)
      && canRegenerate(generationBudget)
      && !targetedRelationshipPatchAvailable
    ) {
      const candidateRevision = consumeFullGeneration(generationBudget);
      const response = await traceGenerationCall({
        kind: "full_regeneration",
        context: {
          transactionId,
          nodeIndex,
          candidateRevision,
          issueCodes: [CANDIDATE_ISSUE.storyConsistency]
        },
        listener: deps.onGenerationCallTrace,
        operation: async (markFirstToken) => {
          const result = await callAiJson(`${prompt}\\n\\n【年龄与状态一致性修复】\\n${relationshipConsistencyIssues.map((issue) => issue.message).join("；")}；${relationshipAuthorityRepairRule}\\n请重新生成完整节点，不得修改 Arc 状态。`);
          markFirstToken();
          return result;
        }
      });
      applyFullRelationshipRepairResponse(response);
    }
    if (
      hasOnlyRelationshipAuthorityConflicts(relationshipConsistencyIssues)
      && deps.enableCandidatePatchRepair === true
      && canPatch(generationBudget)
    ) {
      deps.onGenerationStage?.("repairing");
      consumeModelPatch(generationBudget);
      const relationshipIssue = repairIssue({
        code: CANDIDATE_ISSUE.storyConsistency,
        message: `${relationshipConsistencyIssues.map((issue) => `${issue.code}:${issue.message}`).join("；")}；${relationshipAuthorityRepairRule}\n${relationshipAuthorityFinalPatchRule}`,
        surfaces: ["titleReplacement", "descriptionParagraphPatches", "replacementChoices", "narrativeMetaPatch"],
        authorityContext: {
          careerRevision: worldState.careerRevision ?? 0,
          relationshipRevision: worldState.relationshipRevision ?? 0,
          familyRelationshipRevision: worldState.familyRelationshipRevision ?? 0,
          relationshipAuthorityRule: relationshipAuthorityRepairRule
        }
      });
      const skeleton: LockedCandidateSkeleton = {
        simulationSeed,
        branchFingerprint,
        nodeIndex,
        transactionId,
        sourceSelectedDecision: input.selectedDecision,
        selectedOutcomeId,
        currentAgeInMonths,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        elapsedMonths: timelineAdvance.elapsedMonths,
        lifeIntensity: timelineAdvance.lifeIntensity,
        eventId: nodeEvent?.id,
        eventIntentType: nodeEvent?.intent.type,
        allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes ?? [],
        foregroundPressureArcId: workingPressureArc?.id,
        pressureArcPhasePolicyId: workingPressureArc?.phasePolicyId,
        pressureArcPhaseId: workingPressureArc?.phaseId,
        worldStateFingerprint: fingerprintWorldState(worldState),
        worldStateVersion: worldState.version,
        careerRevision: worldState.careerRevision ?? 0,
        relationshipRevision: worldState.relationshipRevision ?? 0,
        familyRelationshipRevision: worldState.familyRelationshipRevision ?? 0,
        ledgerRevision: currentFinancialLedger?.revision,
        authoritativeCharacterIds: worldState.people.map((person) => person.id),
        relationshipCheckpointKey: relationshipCheckpoint ? relationshipCheckpointKey(relationshipCheckpoint) : undefined
      };
      const candidate: SimulationNodeCandidate = {
        ...node,
        financialEventProposals: rawFinancialEventProposals(latestRawNode)
      };
      const envelope = createNodeCandidateEnvelope({
        candidateRevision: generationBudget.fullGenerationsUsed === 1 ? 0 : 1,
        skeleton,
        candidate,
        requestedIssueCodes: [relationshipIssue.code],
        allowedPatchSurfaces: relationshipIssue.surfaces
      });
      let patchResult: ApplyNodeCandidatePatchResult | undefined;
      try {
        patchResult = await traceGenerationCall({
          kind: "candidate_patch",
          context: {
            transactionId,
            nodeIndex,
            candidateRevision: envelope.candidateRevision,
            candidateHash: envelope.baseCandidateHash,
            issueCodes: [relationshipIssue.code]
          },
          listener: deps.onGenerationCallTrace,
          operation: async (markFirstToken) => {
            const response = await callAiJson(buildNodeCandidatePatchPrompt({ envelope, issues: [relationshipIssue] }));
            markFirstToken();
            let parsedPatch;
            try {
              parsedPatch = parseNodeCandidatePatch(response.text);
            } catch (error) {
              throw new AiClientError("AI_RESPONSE_INVALID", "关系权威最终修复未返回合法 Candidate Patch JSON。", { cause: error });
            }
            const appliedPatch = applyNodeCandidatePatch(envelope, parsedPatch);
            if ("code" in appliedPatch) {
              throw new AiClientError("AI_RESPONSE_INVALID", `${appliedPatch.code}:${appliedPatch.message}`);
            }
            return appliedPatch;
          }
        });
      } catch (error) {
        // The model gets a single bounded Patch attempt. A complete node or an
        // invalid patch is deliberately not normalized as a replacement: its
        // failed trace is retained and the deterministic authority fallback
        // below owns the final rendered result.
        if (!(error instanceof AiClientError) || error.code !== "AI_RESPONSE_INVALID") throw error;
      }
      if (patchResult?.ok) {
        const patchedCandidate = patchResult.envelope.candidate;
        const { financialEventProposals, ...patchedNode } = patchedCandidate;
        node = attachPendingFinancialContext({
          node: stripUnauthorizedRomanticCharacters(patchedNode as SimulationNode, worldState),
          previousState: currentFinancialState
        });
        node = stripUnauthorizedRelationshipChoices(node, worldState);
        latestRawNode = { ...node, financialEventProposals };
        relationshipConsistencyIssues = validateStoryConsistency({
          node,
          targetAgeInMonths: timelineAdvance.targetAgeInMonths,
          people,
          worldState
        });
      }
    }
    if (hasOnlyRelationshipAuthorityConflicts(relationshipConsistencyIssues)) {
      const fallback = buildRelationshipAuthorityDeterministicFallback({
        node,
        nodeEvent,
        nodeEventMeta,
        elapsedMonths: timelineAdvance.elapsedMonths
      });
      node = fallback.node;
      nodeEventMeta = fallback.eventMeta;
      relationshipAuthorityFallbackApplied = true;
    }
  }

  let candidateDecisionGate = evaluateDecisionGate({
    candidateNode: node,
    previousNode: lastNode,
    pressureArc: workingPressureArc,
    recentHistory: input.history,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
    allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
    narrativeMode: nodeEvent?.narrativeMode
  });
  node = downgradeDensityLimitedNode(node, candidateDecisionGate.reasonCodes);
  candidateDecisionGate = evaluateDecisionGate({
    candidateNode: node,
    previousNode: lastNode,
    pressureArc: workingPressureArc,
    recentHistory: input.history,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
    allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
    narrativeMode: nodeEvent?.narrativeMode
  });

  const collectPreSettlementIssues = (): CandidateRepairIssue[] => {
    const issues: CandidateRepairIssue[] = [];
    const selectedDecisionIssues = validateSelectedDecisionConsistency(input.selectedDecision, node.description);
    if (selectedDecisionIssues.length) issues.push(repairIssue({
      code: CANDIDATE_ISSUE.selectedDecision,
      message: selectedDecisionIssues.join("；"),
      surfaces: ["descriptionParagraphPatches"],
      authorityContext: { selectedDecision: input.selectedDecision }
    }));
    if (containsForbiddenArcWrite(latestRawNode)) issues.push(repairIssue({
      code: CANDIDATE_ISSUE.forbiddenArcWrite,
      message: "模型尝试直接修改 PressureArc；只能提交 arcSignals",
      surfaces: ["narrativeMetaPatch"]
    }));
    if (repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc)) issues.push(repairIssue({
      code: CANDIDATE_ISSUE.repeatedAcuteHealth,
      message: "恢复或处置阶段不得再次生成急性停摆",
      surfaces: ["titleReplacement", "descriptionParagraphPatches", "narrativeMetaPatch"]
    }));
    const debtIssues = validateDebtNarrativeConsistency({
      description: node.description,
      debtHealthState: lastNode?.debtHealthState,
      ledger: currentFinancialLedger
    });
    if (debtIssues.length) issues.push(repairIssue({
      code: CANDIDATE_ISSUE.debtNarrative,
      message: debtIssues.join("；"),
      surfaces: ["descriptionParagraphPatches"]
    }));
    const storyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people, worldState })
      .filter((issue) => issue.severity === "error");
    if (storyIssues.length) issues.push(repairIssue({
      code: CANDIDATE_ISSUE.storyConsistency,
      message: storyIssues.map((issue) => `${issue.code}:${issue.message}`).join("；"),
      surfaces: ["descriptionParagraphPatches", "replacementChoices", "narrativeMetaPatch"],
      authorityContext: {
        careerRevision: worldState.careerRevision ?? 0,
        relationshipRevision: worldState.relationshipRevision ?? 0,
        familyRelationshipRevision: worldState.familyRelationshipRevision ?? 0
      }
    }));
    if (!candidateDecisionGate.isDecisionCheckpoint) issues.push(repairIssue({
      code: CANDIDATE_ISSUE.decisionGate,
      message: candidateDecisionGate.reasonCodes.join("；"),
      surfaces: ["replacementChoices", "narrativeMetaPatch"],
      authorityContext: { blockedDecisionIntents: candidateDecisionGate.blockedDecisionIntents }
    }));
    return uniqueRepairIssues(issues);
  };

  let candidateIssues = collectPreSettlementIssues();
  if (
    candidateIssues.length > 0
    && candidateIssues.every((issue) => issue.code === CANDIDATE_ISSUE.debtNarrative)
  ) {
    const currentDebtAuthority = deriveDebtNarrativeAuthority({
      ledger: currentFinancialLedger,
      debtHealthState: lastNode?.debtHealthState,
      periodStartAgeInMonths: currentAgeInMonths,
      acceptedCompletedEventKinds: []
    });
    const debtSurfaceIssues = collectDebtNarrativeSurfaceIssues({ node, authority: currentDebtAuthority });
    if (debtSurfaceIssues.length > 0) {
      node = repairDebtNarrativeSurfaces({
        node,
        authority: currentDebtAuthority,
        issues: debtSurfaceIssues
      });
      latestRawNode = {
        ...latestRawNode,
        ...node,
        financialEventProposals: rawFinancialEventProposals(latestRawNode)
      };
      candidateIssues = collectPreSettlementIssues();
    }
  }
  if (candidateIssues.length > 0 && deps.enableCandidatePatchRepair === true && canPatch(generationBudget)) {
    deps.onGenerationStage?.("repairing");
    consumeModelPatch(generationBudget);
    const skeleton: LockedCandidateSkeleton = {
      simulationSeed,
      branchFingerprint,
      nodeIndex,
      transactionId,
      sourceSelectedDecision: input.selectedDecision,
      selectedOutcomeId,
      currentAgeInMonths,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      eventId: nodeEvent?.id,
      eventIntentType: nodeEvent?.intent.type,
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes ?? [],
      foregroundPressureArcId: workingPressureArc?.id,
      pressureArcPhasePolicyId: workingPressureArc?.phasePolicyId,
      pressureArcPhaseId: workingPressureArc?.phaseId,
      worldStateFingerprint: fingerprintWorldState(worldState),
      worldStateVersion: worldState.version,
      careerRevision: worldState.careerRevision ?? 0,
      relationshipRevision: worldState.relationshipRevision ?? 0,
      familyRelationshipRevision: worldState.familyRelationshipRevision ?? 0,
      ledgerRevision: currentFinancialLedger?.revision,
      authoritativeCharacterIds: worldState.people.map((person) => person.id),
      relationshipCheckpointKey: relationshipCheckpoint ? relationshipCheckpointKey(relationshipCheckpoint) : undefined
    };
    const candidate: SimulationNodeCandidate = {
      ...node,
      financialEventProposals: rawFinancialEventProposals(latestRawNode)
    };
    const envelope = createNodeCandidateEnvelope({
      candidateRevision: generationBudget.fullGenerationsUsed === 1 ? 0 : 1,
      skeleton,
      candidate,
      requestedIssueCodes: candidateIssues.map((issue) => issue.code),
      allowedPatchSurfaces: [...new Set(candidateIssues.flatMap((issue) => issue.surfaces))]
    });
    let patchResult: ApplyNodeCandidatePatchResult | undefined;
    try {
      patchResult = await traceGenerationCall({
        kind: "candidate_patch",
        context: {
          transactionId,
          nodeIndex,
          candidateRevision: envelope.candidateRevision,
          candidateHash: envelope.baseCandidateHash,
          promptFamily: "candidate_patch",
          issueCodes: candidateIssues.map((issue) => issue.code)
        },
        listener: deps.onGenerationCallTrace,
        operation: async (markFirstToken, recordResponseMetadata) => {
          const response = await callAiJson(buildNodeCandidatePatchPrompt({ envelope, issues: candidateIssues }));
          recordResponseMetadata(response);
          markFirstToken();
          let parsedPatch;
          try {
            parsedPatch = parseNodeCandidatePatch(response.text);
          } catch (error) {
            throw new AiClientError("AI_RESPONSE_INVALID", "候选 Patch 不是合法 JSON。", { cause: error });
          }
          const appliedPatch = applyNodeCandidatePatch(envelope, parsedPatch);
          if ("code" in appliedPatch) {
            throw new AiClientError("AI_RESPONSE_INVALID", `${appliedPatch.code}:${appliedPatch.message}`);
          }
          return appliedPatch;
        }
      });
    } catch (error) {
      if (!(error instanceof AiClientError) || error.code !== "AI_RESPONSE_INVALID") throw error;
    }
    if (patchResult?.ok) {
      const patchedCandidate = patchResult.envelope.candidate;
      const { financialEventProposals, ...patchedNode } = patchedCandidate;
      node = attachPendingFinancialContext({
        node: stripUnauthorizedRomanticCharacters(patchedNode as SimulationNode, worldState),
        previousState: currentFinancialState
      });
      node = canonicalizeGeneratedChoiceIds(node);
      node = stripUnauthorizedRelationshipChoices(node, worldState);
      node = applyDecisionDensityDowngrade(node, candidateDecisionGate);
      node = downgradeDensityLimitedNode(node, candidateDecisionGate.reasonCodes);
      latestRawNode = { ...node, financialEventProposals };
      candidateDecisionGate = evaluateDecisionGate({
        candidateNode: node,
        previousNode: lastNode,
        pressureArc: workingPressureArc,
        recentHistory: input.history,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
        allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
        narrativeMode: nodeEvent?.narrativeMode
      });
      candidateIssues = collectPreSettlementIssues();
    }
  }
  if (
    candidateIssues.length > 0
    && candidateIssues.every((issue) => issue.code === CANDIDATE_ISSUE.decisionGate)
  ) {
    node = applyDeterministicDecisionGateFallback(
      node,
      nodeEvent?.intent.allowedOutcomes,
      `node-${nodeIndex}`,
      nodeEvent,
      candidateDecisionGate.reasonCodes
    );
    latestRawNode = {
      ...node,
      financialEventProposals: rawFinancialEventProposals(latestRawNode)
    };
    candidateDecisionGate = evaluateDecisionGate({
      candidateNode: node,
      previousNode: lastNode,
      pressureArc: workingPressureArc,
      recentHistory: input.history,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      narrativeMode: nodeEvent?.narrativeMode
    });
    candidateIssues = collectPreSettlementIssues();
  }
  if (candidateIssues.length > 0 && canRegenerate(generationBudget)) {
    try {
      return await generateNextNode(input, {
        ...deps,
        generationBudget,
        fullRegenerationReasonCodes: candidateIssues.map((issue) => issue.code)
      });
    } catch (error) {
      if (!isRetryableNodeGenerationError(error)) throw error;
      // Preserve the first complete candidate when the one remaining full
      // generation is itself malformed. The deterministic fallback below is
      // authority-safe and must win over a user-visible generation pause.
    }
  }
  if (candidateIssues.length > 0 && !canRegenerate(generationBudget)) {
    node = buildDeterministicCandidateFallback({
      node,
      selectedDecision: input.selectedDecision,
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      issueCodes: candidateIssues.map((issue) => issue.code),
      intentScope: `node-${nodeIndex}`,
      event: nodeEvent,
      decisionGateReasonCodes: candidateDecisionGate.reasonCodes
    });
    latestRawNode = node;
    candidateDecisionGate = evaluateDecisionGate({
      candidateNode: node,
      previousNode: lastNode,
      pressureArc: workingPressureArc,
      recentHistory: input.history,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
      allowedOutcomeIds: undefined,
      narrativeMode: undefined
    });
    candidateIssues = collectPreSettlementIssues();
  }
  if (candidateIssues.length > 0) {
    throw new AiClientError(
      "AI_RESPONSE_INVALID",
      `候选节点局部修复后仍未通过：${candidateIssues.map((issue) => `${issue.code}(${issue.message})`).join("、")}`
    );
  }

  node = {
    ...node,
    attributes: {
      ...node.attributes,
      health: reconcileHealth(
        input.currentAttributes.health,
        node.attributes.health,
        node.narrativeMeta?.recoveryState ?? "neutral",
        node.eventMeta?.eventId === "health_forced_pause"
      )
    }
  };

  const endingDecision = evaluateEnding({
    candidateNode: node,
    history: input.history,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    elapsedMonths: timelineAdvance.elapsedMonths,
    simulationSeed,
    branchFingerprint,
    nodeIndex,
    policy: DEFAULT_ENDING_POLICY
  });
  if (endingDecision.shouldEnd || shouldForceBrowserE2eEnding(latestRawNode)) {
    const endingPrompt = buildEndingNodePrompt({
      userData: input.userData,
      history: input.history,
      candidateNode: node,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      forcedByHardMaximum: endingDecision.forcedByHardMaximum,
      selectedOutcomeId,
      currentFinancialLedger,
      financialGateRetryReasonCodes: deps.financialGateRetryReasonCodes
    });
    const response = await traceGenerationCall({
      kind: "final_outcome_generation",
      context: { transactionId, nodeIndex, candidateRevision: generationBudget.fullGenerationsUsed - 1, promptFamily: "final_outcome" },
      listener: deps.onGenerationCallTrace,
      operation: async (markFirstToken, recordResponseMetadata) => {
        const result = await callAiJson(endingPrompt);
        recordResponseMetadata(result);
        markFirstToken();
        return result;
      }
    });
    const rawEnding = await ensureGeneratedChoiceTexts(parseAiJsonResponse(response), callAiJson);
    const normalizedEnding = normalizeSimulationNode(rawEnding, {
      fallbackAge: timelineAdvance.targetAge,
      minAge: timelineAdvance.targetAge,
      maxAge: timelineAdvance.targetAge,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      previousAgeInMonths: currentAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      pressureArcId: workingPressureArc?.id
    });
    const endingDescription = sanitizeFinancialNarrative(normalizedEnding.description, node.financialState!, node.financialLedger);
    let endingNode: SimulationNode = {
      ...normalizedEnding,
      description: endingDescription,
      descriptionParagraphs: splitNarrativeParagraphs(endingDescription),
      attributes: node.attributes,
      financialState: node.financialState,
      isEndingNode: true,
      choices: [{ id: "ENDING", text: "安详落幕，查看一生洞察", impactSummary: "一生回望" }],
      eventMeta: node.eventMeta
    };
    const endingOutcome = validateNodeOutcomeProposal({
      worldDeltas: endingNode.narrativeMeta?.worldDeltas,
      arcSignals: endingNode.narrativeMeta?.arcSignals,
      policy: pressureArcPolicy,
      narrativeText: endingNode.description,
      expectedSourceOutcomeId: selectedOutcomeId
    });
    const terminalTransition = workingPressureArc
      ? { action: "resolve" as const, previousPhaseId: workingPressureArc.phaseId, nextArcState: { ...workingPressureArc, status: "resolved" as const }, reasonCodes: ["life-ending"] }
      : { action: "stay" as const, reasonCodes: ["no-pressure-arc"] };
    deps.onGenerationStage?.("finalizing");
    const endingTransactionId = stableHash({ namespace: "ending-transaction", simulationSeed, branchFingerprint, targetAgeInMonths: timelineAdvance.targetAgeInMonths });
    const authoritativeFinance = await commitAuthoritativeFinancialProgress({
      node: endingNode,
      rawNode: rawEnding,
      previousState: currentFinancialState,
      currentLedger: currentFinancialLedger,
      previousDebtHealthState: lastNode?.debtHealthState,
      currentWorldState: worldState,
      acceptedOutcome: endingOutcome,
      acceptedOutcomeId: selectedOutcomeId,
      selectedDecision: input.selectedDecision,
      periodStartAgeInMonths: currentAgeInMonths,
      periodEndAgeInMonths: timelineAdvance.targetAgeInMonths,
      transactionId: endingTransactionId,
      previousWealth: input.currentAttributes.wealth,
      callAiJson,
      financialNodeGateMode: deps.financialNodeGateMode ?? DEFAULT_FINANCIAL_NODE_GATE_MODE,
      expenseLifecycleMode: deps.expenseLifecycleMode ?? DEFAULT_EXPENSE_LIFECYCLE_MODE,
      expenseNarrativeBindingMode: compatibleExpenseNarrativeBindingMode({
        expenseLifecycleMode: deps.expenseLifecycleMode ?? DEFAULT_EXPENSE_LIFECYCLE_MODE,
        expenseNarrativeBindingMode: deps.expenseNarrativeBindingMode ?? DEFAULT_EXPENSE_NARRATIVE_BINDING_MODE
      }),
      onFinancialGateDecision: deps.onFinancialGateDecision,
      financialGateRegenerationCount: deps.financialGateRegenerationCount ?? 0,
      nodeIndex,
      onGenerationCallTrace: deps.onGenerationCallTrace,
      generationBudget
    });
    endingNode = authoritativeFinance.node;
    const finalEndingOutcome = validateNodeOutcomeProposal({
      worldDeltas: endingNode.narrativeMeta?.worldDeltas,
      arcSignals: endingNode.narrativeMeta?.arcSignals,
      policy: pressureArcPolicy,
      narrativeText: endingNode.description,
      expectedSourceOutcomeId: selectedOutcomeId
    });
    requireFinalExpenseResponsibilityEvidence({
      initialOutcome: endingOutcome,
      finalOutcome: finalEndingOutcome,
      narrativeText: endingNode.description,
      expenseLifecycleMode: deps.expenseLifecycleMode ?? DEFAULT_EXPENSE_LIFECYCLE_MODE,
      transactionId: endingTransactionId,
      regenerationCount: deps.financialGateRegenerationCount ?? 0,
      authoritativeAgeBefore: currentAgeInMonths,
      onFinancialGateDecision: deps.onFinancialGateDecision
    });
    return commitSimulationTransaction({
      transactionId: endingTransactionId,
      node: endingNode,
      storyEpisode: endingNode.narrativeMeta!.storyEpisode,
      acceptedOutcome: finalEndingOutcome,
      pressureArcTransition: terminalTransition,
      currentWorldStateSnapshot: authoritativeFinance.worldState,
      domainTransactionAlreadyCommitted: true
    }).node;
  }

  // Compatibility guard for the legacy repair block below. The unified
  // candidate pass above already guarantees these predicates, so the loops do
  // not issue another model call; keeping the final validation temporarily
  // limits the integration diff while preserving every existing validator.
  let consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people, worldState });
  let repeatsAcuteHealthCrisis = repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc);
  let debtNarrativeIssues = validateDebtNarrativeConsistency({
    description: node.description,
    debtHealthState: lastNode?.debtHealthState,
    ledger: currentFinancialLedger
  });
  let decisionGate = evaluateDecisionGate({
    candidateNode: node,
    previousNode: lastNode,
    pressureArc: workingPressureArc,
    recentHistory: input.history,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
    allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
    narrativeMode: nodeEvent?.narrativeMode
  });
  const densityLimitedNode = downgradeDensityLimitedNode(node, decisionGate.reasonCodes);
  if (densityLimitedNode !== node) {
    node = densityLimitedNode;
    decisionGate = evaluateDecisionGate({
      candidateNode: node,
      previousNode: lastNode,
      pressureArc: workingPressureArc,
      recentHistory: input.history,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      narrativeMode: nodeEvent?.narrativeMode
    });
  }
  const blockedIntentsForRepair = new Set(decisionGate.blockedDecisionIntents);
  for (let decisionRepairAttempt = 1; !decisionGate.isDecisionCheckpoint && decisionRepairAttempt <= 2; decisionRepairAttempt += 1) {
    for (const blockedIntent of decisionGate.blockedDecisionIntents) blockedIntentsForRepair.add(blockedIntent);
    const blockedChoicePrompt = blockedIntentsForRepair.size > 0
      ? `\n以下 decisionIntent 近期已被用户重复未采纳，处于冷却中：${[...blockedIntentsForRepair].join("、")}。保留相关真实事实或人物关系，但三个新选项均不得包含或改写为这些行动。`
      : "";
    const repairPrompt = `${prompt}\n\n【DecisionGate 未通过：第 ${decisionRepairAttempt} 次修复】\n问题：${decisionGate.reasonCodes.join("、")}。${blockedChoicePrompt}\n请把等待、复查、恢复等过程压缩进 storyEpisode.internalTransitions，并重新生成完整节点。最终 choices 必须正好三个，按顺序使用 id=A、B、C；三个选项必须是语义不同、会改变未来状态的实质方向，并分别使用不同 decisionIntent。不得只替换近义词或用同一行动的不同措辞凑数${nodeEvent?.intent.allowedOutcomes?.length ? `；同时从允许的 eventOutcomeId 中覆盖至少两个不同策略：${nodeEvent.intent.allowedOutcomes.join("、")}` : ""}。`;
    try {
      const response = await callAiJson(repairPrompt);
      latestRawNode = await ensureGeneratedChoiceTexts(
        stripForbiddenArcWrites(parseAiJsonResponse(response)),
        callAiJson
      );
    } catch (error) {
      if (isRetryableNodeGenerationError(error) && decisionRepairAttempt < 2) continue;
      throw error;
    }
    if (containsForbiddenArcWrite(latestRawNode)) {
      if (decisionRepairAttempt < 2) continue;
      throw new AiClientError("AI_RESPONSE_INVALID", "DecisionGate 修复结果包含未授权的 Arc 状态修改。");
    }
    node = normalizeSimulationNode(latestRawNode, {
      fallbackAge: timelineAdvance.targetAge,
      minAge: timelineAdvance.targetAge,
      maxAge: timelineAdvance.targetAge,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      previousAgeInMonths: currentAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      pressureArcId: workingPressureArc?.id,
      fallbackAttributes: input.currentAttributes
    });
    node = canonicalizeGeneratedChoiceIds({ ...node, isEndingNode: false, eventMeta: nodeEventMeta });
    node = attachPendingFinancialContext({
      node,
      previousState: currentFinancialState
    });
    node = applyDecisionDensityDowngrade(node, decisionGate);
    node = stripUnauthorizedRomanticCharacters(node, worldState);
    node = downgradeDensityLimitedNode(node, decisionGate.reasonCodes);
    consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people, worldState });
    repeatsAcuteHealthCrisis = repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc);
    debtNarrativeIssues = validateDebtNarrativeConsistency({
      description: node.description,
      debtHealthState: lastNode?.debtHealthState,
      ledger: currentFinancialLedger
    });
    if (repeatsAcuteHealthCrisis || debtNarrativeIssues.length > 0 || consistencyIssues.some((issue) => issue.severity === "error")) {
      if (decisionRepairAttempt < 2) continue;
      throw new AiClientError(
        "AI_RESPONSE_INVALID",
        repeatsAcuteHealthCrisis
          ? "健康恢复节点仍在重复急性危机，请重试。"
          : consistencyIssues.map((issue) => issue.message).join("；")
      );
    }
    decisionGate = evaluateDecisionGate({
      candidateNode: node,
      previousNode: lastNode,
      pressureArc: workingPressureArc,
      recentHistory: input.history,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      narrativeMode: nodeEvent?.narrativeMode
    });
    const repairedDensityLimitedNode = downgradeDensityLimitedNode(node, decisionGate.reasonCodes);
    if (repairedDensityLimitedNode !== node) {
      node = repairedDensityLimitedNode;
      decisionGate = evaluateDecisionGate({
        candidateNode: node,
        previousNode: lastNode,
        pressureArc: workingPressureArc,
        recentHistory: input.history,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
        allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
        narrativeMode: nodeEvent?.narrativeMode
      });
    }
  }
  if (!decisionGate.isDecisionCheckpoint) {
    throw new AiClientError(
      "AI_RESPONSE_INVALID",
      `生成结果没有形成真正不同的人生选择，请重试：${decisionGate.reasonCodes.join("、")}`
    );
  }

  // Run the health-operation evidence repair after every generic node repair.
  // Otherwise a later consistency or DecisionGate rewrite can silently remove
  // a valid pressure_resolved signal and prevent the reflection invitation.
  if (
    !isPressureArcInterleave
    &&
    workingPressureArc?.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id
    && workingPressureArc.phaseId === "operation"
    && !hasMatchingPressureResolvedSignal(node, workingPressureArc, pressureArcPolicy)
  ) {
    const originalRawNode = latestRawNode;
    const originalNode = node;
    try {
      const response = await callAiJson(`${prompt}\n\n【健康 operation 结果证据修复】\n上一次最终候选节点缺少可校验的 pressure_resolved，请重新生成完整节点。\n硬性要求：\n1. description 必须原样包含完整句子：“这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。”\n2. narrativeMeta.arcSignals 必须是非空数组，并至少包含：{ "pressureArcId": "${workingPressureArc.id}", "type": "pressure_resolved", "evidence": "这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。", "confidence": 0.95 }。\n3. 不得把阶段结果写成完全治愈，不得修改 PressureArc 状态。\n返回前逐字检查 evidence 能在 description 中找到。`);
      let repairedRawNode = await ensureGeneratedChoiceTexts(
        stripForbiddenArcWrites(parseAiJsonResponse(response)),
        callAiJson
      );
      if (containsForbiddenArcWrite(repairedRawNode)) {
        throw new AiClientError("AI_RESPONSE_INVALID", "健康 operation 证据修复结果包含未授权的 Arc 状态修改。");
      }
      let repairedNode = normalizeSimulationNode(repairedRawNode, {
        fallbackAge: timelineAdvance.targetAge,
        minAge: timelineAdvance.targetAge,
        maxAge: timelineAdvance.targetAge,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        previousAgeInMonths: currentAgeInMonths,
        elapsedMonths: timelineAdvance.elapsedMonths,
        lifeIntensity: timelineAdvance.lifeIntensity,
        pressureArcId: workingPressureArc.id,
        fallbackAttributes: input.currentAttributes
      });
      repairedNode = {
        ...repairedNode,
        isEndingNode: false,
        eventMeta: nodeEventMeta,
        choices: repairedNode.choices.map((choice) => ({
          ...choice,
          expectedWorldDeltaTypes: choice.expectedWorldDeltaTypes?.length
            ? choice.expectedWorldDeltaTypes
            : fallbackWorldDeltaTypes({ ...repairedNode, eventMeta: nodeEventMeta })
        }))
      };
      repairedNode = canonicalizeGeneratedChoiceIds(repairedNode) as SimulationNode;
      repairedNode = attachPendingFinancialContext({
        node: repairedNode,
        previousState: currentFinancialState
      });
      repairedNode = stripUnauthorizedRomanticCharacters(repairedNode, worldState);
      const repairedConsistencyIssues = validateStoryConsistency({
        node: repairedNode,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        people,
        worldState
      });
      repairedNode = {
        ...repairedNode,
        attributes: {
          ...repairedNode.attributes,
          health: reconcileHealth(
            input.currentAttributes.health,
            repairedNode.attributes.health,
            repairedNode.narrativeMeta?.recoveryState ?? "neutral",
            false
          )
        }
      };
      const repairedDecisionGate = evaluateDecisionGate({
        candidateNode: repairedNode,
        previousNode: lastNode,
        pressureArc: workingPressureArc,
        recentHistory: input.history,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        independentCriticalEvent: Boolean(existingPressureArc || independentCriticalHealthEvent),
        allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
        narrativeMode: nodeEvent?.narrativeMode
      });
      if (
        repairedConsistencyIssues.every((issue) => issue.severity !== "error")
        && repairedDecisionGate.isDecisionCheckpoint
        && hasMatchingPressureResolvedSignal(repairedNode, workingPressureArc, pressureArcPolicy)
      ) {
        latestRawNode = repairedRawNode;
        node = repairedNode;
      }
    } catch {
      latestRawNode = originalRawNode;
      node = originalNode;
    }
  }

  if (
    nodeEvent?.intent.type
    && ["romance_connection_clarification", "romance_exploration_resolution", "relationship_material_commitment_test", "relationship_commitment_resolution"].includes(nodeEvent.intent.type)
  ) {
    node = withAuthoritativeRomanceCharacter(node, currentWorldState);
  }
  const romanceCandidatePreparation = await prepareDeterministicRomanceCandidate(
    node,
    nodeEvent?.intent.type,
    async (romancePrompt) => traceGenerationCall({
      kind: "romance_candidate_extraction",
      context: { transactionId, nodeIndex, candidateRevision: generationBudget.fullGenerationsUsed - 1, promptFamily: "romance_candidate" },
      listener: deps.onGenerationCallTrace,
      operation: async (markFirstToken, recordResponseMetadata) => {
        const result = await callAiJson(romancePrompt);
        recordResponseMetadata(result);
        markFirstToken();
        return result;
      }
    })
  );
  node = romanceCandidatePreparation.node;
  node = repairDeterministicRomanceChoices(node, nodeEvent?.intent.type, nodeEvent?.intent.allowedOutcomes);
  const finalNodeContractIssues = getSimulationNodeValidationIssues(node, {
    allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
    eventIntentType: nodeEvent?.intent.type
  }).filter((issue) => ["eventOutcomeId", "eventOutcomeCoverage", "romanceChoiceSemantics", "romanceNarrativeGrounding"].includes(issue));
  let romanceContractFallbackApplied = false;
  if (finalNodeContractIssues.length > 0) {
    if (isDeterministicRomanceIntent(nodeEvent?.intent.type)) {
      const reason = `romance_contract_failed:${finalNodeContractIssues.join("+")}`;
      if (!deps.romanceFallbackContext && canRegenerate(generationBudget)) {
        return generateNextNode(input, {
          ...deps,
          fullRegenerationReasonCodes: ["ROMANCE_CONTRACT_FAILED", ...finalNodeContractIssues],
          romanceFallbackContext: {
            requestedEventId: nodeEvent.id,
            reason,
            repairAttempted: romanceCandidatePreparation.repairAttempted
          }
        });
      }
      node = buildDeterministicRomanceRescheduleNode(
        node,
        deps.romanceFallbackContext?.requestedEventId ?? nodeEvent.id,
        reason,
        romanceCandidatePreparation.repairAttempted
      );
      latestRawNode = node;
      romanceContractFallbackApplied = true;
    } else {
      throw new AiClientError("AI_RESPONSE_INVALID", `最终选项未通过事件授权合同：${finalNodeContractIssues.join(",")}`);
    }
  }
  if (isDeterministicRomanceIntent(nodeEvent?.intent.type) && !romanceContractFallbackApplied) {
    node = deriveDeterministicRomanceProposals(node, nodeEvent.intent.type);
    node = {
      ...node,
      eventMeta: node.eventMeta ? {
        ...node.eventMeta,
        romanceRepairAttempted: romanceCandidatePreparation.repairAttempted,
        romanceRepairSucceeded: romanceCandidatePreparation.repairSucceeded,
        romanceRescheduled: false
      } : node.eventMeta
    };
  }

  const legacyIncomeEvidenceNarrativeRepair = reconcileLegacyIncomeProposalEvidenceNarrative({
    node,
    rawNode: latestRawNode,
    ledger: currentFinancialLedger,
    currentCareerState: currentCareerState(worldState)!,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    acceptedOutcomeId: selectedOutcomeId
  });
  node = legacyIncomeEvidenceNarrativeRepair.node;
  latestRawNode = legacyIncomeEvidenceNarrativeRepair.rawNode;

  const financialCandidateOutcome = validateNodeOutcomeProposal({
    worldDeltas: node.narrativeMeta?.worldDeltas,
    arcSignals: node.narrativeMeta?.arcSignals,
    policy: pressureArcPolicy,
    narrativeText: node.description,
    expectedSourceOutcomeId: selectedOutcomeId
  });
  deps.onGenerationStage?.("finalizing");
  const authoritativeFinance = await commitAuthoritativeFinancialProgress({
    node,
    rawNode: latestRawNode,
    previousState: currentFinancialState,
    currentLedger: currentFinancialLedger,
    previousDebtHealthState: lastNode?.debtHealthState,
    currentWorldState: worldState,
    expenseLifecycleBaselineWorldState,
    acceptedOutcome: financialCandidateOutcome,
    acceptedOutcomeId: selectedOutcomeId,
    selectedDecision: input.selectedDecision,
    periodStartAgeInMonths: currentAgeInMonths,
    periodEndAgeInMonths: timelineAdvance.targetAgeInMonths,
    transactionId,
    previousWealth: input.currentAttributes.wealth,
    callAiJson,
    financialNodeGateMode: deps.financialNodeGateMode ?? DEFAULT_FINANCIAL_NODE_GATE_MODE,
    expenseLifecycleMode: deps.expenseLifecycleMode ?? DEFAULT_EXPENSE_LIFECYCLE_MODE,
    expenseNarrativeBindingMode: compatibleExpenseNarrativeBindingMode({
      expenseLifecycleMode: deps.expenseLifecycleMode ?? DEFAULT_EXPENSE_LIFECYCLE_MODE,
      expenseNarrativeBindingMode: deps.expenseNarrativeBindingMode ?? DEFAULT_EXPENSE_NARRATIVE_BINDING_MODE
    }),
    onFinancialGateDecision: deps.onFinancialGateDecision,
    financialGateRegenerationCount: deps.financialGateRegenerationCount ?? 0,
    nodeIndex,
    onGenerationCallTrace: deps.onGenerationCallTrace,
    generationBudget
  });
  node = authoritativeFinance.node;
  node = sanitizeSimulationNodeFinancialNarrative(node, node.financialState!, node.financialLedger, authoritativeFinance.acceptedFinancialEvents);
  const debtNarrativeAuthority = deriveDebtNarrativeAuthority({
    ledger: node.financialLedger!,
    debtHealthState: node.debtHealthState!,
    periodStartAgeInMonths: currentAgeInMonths,
    acceptedCompletedEventKinds: authoritativeFinance.acceptedFinancialEvents.map((event) => event.kind)
  });
  if (Math.abs(debtNarrativeAuthority.deltaBreakdown.unexplainedDeltaWan) > 0.01) {
    throw new FinancialLedgerInvariantError(
      "UNBALANCED_TRANSACTION",
      `债务增量缺少权威解释：${debtNarrativeAuthority.deltaBreakdown.unexplainedDeltaWan} 万元`
    );
  }
  let debtSurfaceIssues = collectDebtNarrativeSurfaceIssues({ node, authority: debtNarrativeAuthority });
  if (debtSurfaceIssues.length > 0) {
    node = repairDebtNarrativeSurfaces({ node, authority: debtNarrativeAuthority, issues: debtSurfaceIssues });
    debtSurfaceIssues = collectDebtNarrativeSurfaceIssues({ node, authority: debtNarrativeAuthority });
  }
  if (debtSurfaceIssues.length > 0) {
    const reasonCodes = [...new Set(debtSurfaceIssues.map((issue) => issue.reasonCode))];
    node = applyDebtNarrativeFallback({
      node,
      authority: debtNarrativeAuthority,
      reasonCodes,
      rejectedCompletionKinds: reasonCodes.includes("UNACCEPTED_RESTRUCTURE_COMPLETION") ? ["debt_restructured"] : []
    });
    debtSurfaceIssues = collectDebtNarrativeSurfaceIssues({ node, authority: debtNarrativeAuthority });
  } else if (node.financialProcessingMeta?.narrativeFallback) {
    node = applyDebtNarrativeFallback({
      node,
      authority: debtNarrativeAuthority,
      reasonCodes: node.financialProcessingMeta.narrativeFallbackReasonCodes ?? ["FINANCIAL_COMPLETION_ROLLBACK"],
      rejectedCompletionKinds: (node.financialProcessingMeta.rejectedFinancialProposalKinds ?? []) as FinancialEventKind[]
    });
  } else {
    node = applyDebtNarrativeAuthorityToNode({ node, authority: debtNarrativeAuthority });
  }
  if (debtSurfaceIssues.length > 0) {
    throw new AiClientError("AI_RESPONSE_INVALID", debtSurfaceIssues.map((issue) => `${issue.surface}:${issue.reasonCode}`).join("；"));
  }
  // Debt authority repair/fallback may replace complete paragraphs after the
  // first financial sanitizer pass. Re-ground every user-visible surface once
  // more against the closing ledger so canonical debt totals also obey the
  // public two-decimal display contract.
  node = sanitizeSimulationNodeFinancialNarrative(node, node.financialState!, node.financialLedger, authoritativeFinance.acceptedFinancialEvents);
  // Financial grounding can remove or rewrite a paragraph that contained the
  // evidence selected by the earlier deterministic romance proposal pass. The
  // accepted choice and event contract are unchanged, so re-derive against the
  // final user-visible text instead of persisting a proposal whose evidence no
  // longer exists and silently repeating the same relationship checkpoint.
  if (isDeterministicRomanceIntent(nodeEvent?.intent.type)) {
    node = deriveDeterministicRomanceProposals(node, nodeEvent!.intent.type);
  }
  const committedDebtNarrativeIssues = validateDebtNarrativeConsistency({
    description: node.description,
    debtHealthState: node.debtHealthState,
    ledger: node.financialLedger,
    allowExactServicingCount: true
  });
  if (committedDebtNarrativeIssues.length > 0) {
    throw new AiClientError("AI_RESPONSE_INVALID", committedDebtNarrativeIssues.join("；"));
  }

  // Financial/debt surface repair can replace full paragraphs and choices after
  // the first relationship check.  Re-close the authority boundary on the
  // final, user-visible node before any SimulationTransaction is committed.
  let finalSurfaceConsistencyIssues = validateStoryConsistency({
    node,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    people: authoritativeFinance.worldState.people,
    worldState: authoritativeFinance.worldState
  });
  if (
    !isDeterministicRomanceIntent(nodeEvent?.intent.type)
    && hasOnlyRelationshipAuthorityConflicts(finalSurfaceConsistencyIssues)
  ) {
    // Later debt/financial writers may preserve a stale candidateOrdinal or
    // replace a paragraph after the earlier repair. Repair only relation-owned
    // surfaces here; accepted ledger-derived financial content stays intact.
    const repairedSurface = repairRelationshipAuthorityFinalSurface({
      node,
      nodeEvent,
      nodeEventMeta,
      elapsedMonths: timelineAdvance.elapsedMonths,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      people: authoritativeFinance.worldState.people,
      worldState: authoritativeFinance.worldState
    });
    node = sanitizeSimulationNodeFinancialNarrative(
      repairedSurface.node,
      repairedSurface.node.financialState!,
      repairedSurface.node.financialLedger
    );
    nodeEventMeta = repairedSurface.eventMeta;
    relationshipAuthorityFallbackApplied = true;
    finalSurfaceConsistencyIssues = validateStoryConsistency({
      node,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      people: authoritativeFinance.worldState.people,
      worldState: authoritativeFinance.worldState
    });
  }
  if (finalSurfaceConsistencyIssues.some((issue) => issue.severity === "error")) {
    throw new AiClientError(
      "AI_RESPONSE_INVALID",
      finalSurfaceConsistencyIssues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("；")
    );
  }
  if (relationshipAuthorityFallbackApplied) {
    // Apply after debt authority has intentionally reset its own fallback
    // fields, so a relation-only rendered fallback is visible to production
    // audits without pretending that it was a debt narrative failure.
    node = markRelationshipAuthorityNarrativeFallback(node);
  }
  if (legacyIncomeEvidenceNarrativeRepair.reasonCodes.length > 0 && node.financialProcessingMeta) {
    node = {
      ...node,
      financialProcessingMeta: {
        ...node.financialProcessingMeta,
        candidateNarrativeRepairReasonCodes: legacyIncomeEvidenceNarrativeRepair.reasonCodes
      }
    };
  }

  // Financial repair and narrative sanitization may change the final evidence
  // text. Revalidate from that final narrative, then reduce the Arc against the
  // same node's closing debt health so recovery never lags by one checkpoint.
  const acceptedOutcome = validateNodeOutcomeProposal({
    worldDeltas: node.narrativeMeta?.worldDeltas,
    arcSignals: node.narrativeMeta?.arcSignals,
    policy: pressureArcPolicy,
    narrativeText: node.description,
    expectedSourceOutcomeId: selectedOutcomeId
  });
  requireFinalExpenseResponsibilityEvidence({
    initialOutcome: financialCandidateOutcome,
    finalOutcome: acceptedOutcome,
    narrativeText: node.description,
    expenseLifecycleMode: deps.expenseLifecycleMode ?? DEFAULT_EXPENSE_LIFECYCLE_MODE,
    transactionId,
    regenerationCount: deps.financialGateRegenerationCount ?? 0,
    authoritativeAgeBefore: currentAgeInMonths,
    onFinancialGateDecision: deps.onFinancialGateDecision
  });
  const reducedPressureArcTransition = reducePressureArc({
    currentArc: workingPressureArc,
    policy: pressureArcPolicy,
    interleave: isPressureArcInterleave,
    selectedDecision: input.selectedDecision,
    acceptedOutcome,
    acceptedFinancialEvents: authoritativeFinance.acceptedFinancialEvents,
    rejectedFinancialProposalIds: authoritativeFinance.rejectedFinancialProposalIds,
    attributes: node.attributes,
    timelineAdvance,
    closingDebtHealthState: node.debtHealthState
  });
  const pressureArcTransition = completeScheduledArcTransition({
    transition: reducedPressureArcTransition,
    startDecision: startArcDecision,
    workingArc: workingPressureArc,
    worldState: authoritativeFinance.worldState,
    closingDebtHealthState: node.debtHealthState
  });
  // Financial and relationship grounding can replace choice surfaces after the
  // initial model normalization. Re-assert the public choice-id invariant at
  // the final authority boundary so a late repair can never persist duplicate
  // ids into history.
  node = normalizeSimulationNodeChoices(node);
  const committed = commitSimulationTransaction({
    transactionId,
    node,
    storyEpisode: node.narrativeMeta!.storyEpisode,
    acceptedOutcome,
    pressureArcTransition,
    currentWorldStateSnapshot: authoritativeFinance.worldState,
    domainTransactionAlreadyCommitted: true
  });
  const invitationDecision = evaluateReportInvitation({
    candidateNode: committed.node,
    history: input.history,
    completedChoiceCount: input.history.length,
    pressureArcTransition,
    acceptedOutcome,
    policy: DEFAULT_REPORT_INVITATION_POLICY,
    simulationSeed,
    branchFingerprint
  });
  return invitationDecision.invitation
    ? { ...committed.node, reportInvitation: invitationDecision.invitation }
    : committed.node;
}

export async function generateNextNode(
  input: GenerateNextNodeInput,
  deps: SimulationServiceDeps = {}
): Promise<SimulationNode> {
  const gateMode = deps.financialNodeGateMode ?? DEFAULT_FINANCIAL_NODE_GATE_MODE;
  const expenseMode = deps.expenseLifecycleMode ?? DEFAULT_EXPENSE_LIFECYCLE_MODE;
  const narrativeBindingMode = compatibleExpenseNarrativeBindingMode({
    expenseLifecycleMode: expenseMode,
    expenseNarrativeBindingMode: deps.expenseNarrativeBindingMode ?? DEFAULT_EXPENSE_NARRATIVE_BINDING_MODE
  });
  const initialRegenerationCount = deps.financialGateRegenerationCount ?? 0;
  let lastGateError: FinancialNodeGateError | undefined;
  for (
    let regenerationCount = initialRegenerationCount;
    regenerationCount <= FINANCIAL_GATE_MAX_REGENERATIONS;
    regenerationCount += 1
  ) {
    try {
      return await generateNextNodeAttempt(input, {
        ...deps,
        financialNodeGateMode: gateMode,
        expenseLifecycleMode: expenseMode,
        expenseNarrativeBindingMode: narrativeBindingMode,
        financialGateRegenerationCount: regenerationCount,
        // Review telemetry remains in the rejection diagnostic, but asking the
        // model to repair it alongside a hard gate failure encourages invented
        // expense facts. Regeneration must receive only the reasons that
        // actually prevented the Preview from committing.
        financialGateRetryReasonCodes: lastGateError?.decision.blockingReasonCodes
          ?? deps.financialGateRetryReasonCodes
      });
    } catch (error) {
      if (!(error instanceof FinancialNodeGateError) || (gateMode !== "enforced" && expenseMode !== "enforced")) throw error;
      lastGateError = error;
      // Production shares one bounded generation budget across the full
      // financial-gate loop. Once it has no full candidate generation left,
      // preserve the last authoritative rejection instead of entering another
      // attempt solely to surface an internal budget-exhausted error.
      if (
        regenerationCount === FINANCIAL_GATE_MAX_REGENERATIONS
        || (deps.generationBudget && !canRegenerate(deps.generationBudget))
      ) throw error;
    }
  }
  throw lastGateError || new AiClientError("AI_RESPONSE_INVALID", "财务节点未通过接受门");
}

export interface AnalyzePersonalityInput {
  userData: UserInitialData;
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
}

export async function analyzePersonality(
  input: AnalyzePersonalityInput,
  deps: SimulationServiceDeps = {}
): Promise<PersonalityInsight> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildPersonalityPrompt(input.userData, input.history, input.currentAttributes);
  const data = parseAiJsonResponse(await callAiJson(prompt));
  return normalizePersonalityInsight(data);
}

export interface TimeTravelInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  targetAge: number;
  targetTitle?: string;
  targetStage?: string;
  targetDescription?: string;
}

export async function timeTravel(
  input: TimeTravelInput,
  deps: SimulationServiceDeps = {}
): Promise<SimulationNode> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildTimeTravelPrompt(input);

  return generateCompleteSimulationNode(async (_attempt, previousIssues) => {
    const response = await callAiJson(buildNodePromptWithRetryNotice(prompt, previousIssues));
    const data = parseAiJsonResponse(response);
    return data.newPath || data.node || data;
  }, {
    fallbackAge: input.targetAge,
    minAge: input.targetAge,
    maxAge: input.targetAge,
    targetAgeInMonths: input.targetAge * 12,
    previousAgeInMonths: input.targetAge * 12,
    elapsedMonths: 0,
    lifeIntensity: "normal",
    repairMissingChoiceText: (node, invalidChoiceIndexes) => (
      repairGeneratedChoiceTexts(node, invalidChoiceIndexes, callAiJson)
    )
  });
}
