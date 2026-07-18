import { buildEventMeta, getEventTemporalProfile, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent, queryHealthEscalationEvent, type LifeEventSeed } from "../../data/lifeEvents";
import { ChoiceTemporalHint, EmploymentTransitionProposal, FinancialState, HistoryItem, LifeAttributes, PersonalityInsight, PressureArcState, QuestionItem, QuestionTurn, SimulationNode, UserInitialData, WorldDelta } from "../../types";
import { DEFAULT_ENDING_POLICY } from "../../config/endingPolicy";
import { DEFAULT_REPORT_INVITATION_POLICY } from "../../config/reportInvitationPolicy";
import { buildQuestionPrompt } from "../../utils/questionPrompt";
import { normalizePersonalityInsight } from "../../utils/insightResponse";
import { generateCompleteSimulationNode } from "../../utils/simulationNodeRetry";
import { normalizeSimulationNode } from "../../utils/simulationResponse";
import { buildStoryContextPack } from "../../utils/storyContext";
import { buildAgeContext } from "../../utils/ageContext";
import { HEALTH_CRISIS_PHASE_POLICY, reducePressureArc, resolvePhase, resolvePhasePolicy, validateNodeOutcomeProposal, type AcceptedNodeOutcome, type PhaseTransitionPolicy } from "../../utils/arcLifecycle";
import { evaluateDecisionGate } from "../../utils/decisionGate";
import { evaluateEnding } from "../../utils/endingDecision";
import { rebuildPersonStates } from "../../utils/personTimeline";
import { commitSimulationTransaction, emptyWorldState } from "../../utils/simulationTransaction";
import { buildBranchFingerprint, calculateTimelineAdvance, deriveTemporalProfile } from "../../utils/timelineAdvance";
import { stableHash } from "../../utils/stableRandom";
import { containsForbiddenArcWrite, validateStoryConsistency } from "../../utils/storyConsistency";
import { estimateFinancialStateFromWealth, normalizeInitialFinancialState, withCalculatedWealth } from "../../utils/financialState";
import { resolveAuthoritativeEmploymentStatus } from "../../utils/employmentState";
import { sanitizeFinancialNarrative } from "../../utils/financialNarrative";
import { reconcileHealth } from "../../utils/healthReconciliation";
import { evaluateReportInvitation } from "../../utils/reportInvitationDecision";
import { adaptTransitionalEmploymentProposal, currentCareerState, initializeCareerState, validateAndAcceptCareerTransition } from "../../domain/career/careerState";
import {
  commitFinancialDomainTransaction,
  deriveConservativeWealthBasis,
  deriveFinancialState,
  initializeOpeningFinancialLedger,
  migrateLegacyFinancialState,
  applyOpeningFactsToFinancialState,
  extractOpeningFinancialFacts,
  normalizeFinancialProposals,
  normalizeRepairedFinancialProposals,
  matchesNormalizedEvidence,
  buildMortalityFinancialClosure,
  reconcileCareerIncomeAtomicity,
  validateFinancialProposals,
  type FinancialEventProposal,
  type FinancialLedger,
  type FinancialLedgerIssue
} from "../../domain/finance";
import { callDeepSeekJsonFromBrowser, callDeepSeekJsonStreamFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import { AiClientError } from "../ai/errors";
import { getBrowserE2eAiJsonCaller, getBrowserE2eAiJsonStreamCaller, getBrowserE2eEventOverride, shouldForceBrowserE2eEnding } from "../e2e/e2eAiMock";
import { extractStreamedNodePreview, type StreamedNodePreview } from "../../utils/streamingJsonPreview";
import { splitNarrativeParagraphs } from "../../utils/narrativePresentation";
import {
  buildNextNodePrompt,
  buildEndingNodePrompt,
  buildFinancialProposalRepairPrompt,
  buildNodePromptWithRetryNotice,
  buildPersonalityPrompt,
  buildStartSimulationPrompt,
  buildTimeTravelPrompt
} from "./prompts";

type AiJsonCaller = (prompt: string) => Promise<{ text: string }>;
type AiJsonStreamCaller = (
  prompt: string,
  options?: { signal?: AbortSignal; onContent?: (content: string) => void }
) => Promise<{ text: string }>;

export type NextGenerationStage = "preparing" | "generating" | "validating" | "finalizing" | "revealing";

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
  const toStatus = statusAliases[rawStatus] || rawStatus as EmploymentTransitionProposal["toStatus"];
  let evidence = typeof merged.evidence === "string" ? merged.evidence : "";
  if (!evidence || !matchesNormalizedEvidence(input.narrativeText, evidence)) {
    const evidencePattern = toStatus === "retired" || toStatus === "not_working"
      ? /退休|离职|停止工作|结束工资|离开工资序列/
      : /顾问|咨询|转为|岗位|工作节奏|工时/;
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
  callAiJsonStream?: AiJsonStreamCaller;
  onGenerationStage?: (stage: NextGenerationStage) => void;
  onNarrativeProgress?: (preview: StreamedNodePreview) => void;
  signal?: AbortSignal;
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

export function detectNarrativeFinancialCoverageIssues(input: {
  narrativeText: string;
  ledger: FinancialLedger;
  acceptedEvents: Array<{ kind: string }>;
  ageInMonths: number;
}): FinancialLedgerIssue[] {
  const issues: FinancialLedgerIssue[] = [];
  const hasKind = (...kinds: string[]) => input.acceptedEvents.some((event) => kinds.includes(event.kind));
  const push = (id: string, summary: string) => issues.push({
    id: `narrative_coverage_${id}_${input.ageInMonths}`,
    code: "PENDING_FACT",
    severity: "blocking",
    status: "open",
    relatedProposalIds: [],
    summary,
    createdAtAgeInMonths: input.ageInMonths
  });
  if (/(?:买下|购入|购买了|名下已有|自有)(?:[^。；]{0,16})(?:房产|住房|房子|公寓)|(?:房贷|按揭)/u.test(input.narrativeText)) {
    if (!input.ledger.assetAccounts.some((item) => item.status === "active" && item.type === "property")
      && !hasKind("asset_purchased")) push("property", "正文包含已发生的主人公房产事实，但没有房产资产 Proposal");
    if (/(?:房贷|按揭)/u.test(input.narrativeText)
      && !input.ledger.debtAccounts.some((item) => item.status === "active" && item.type === "mortgage")
      && !hasKind("debt_drawn")) push("mortgage", "正文包含已发生的主人公房贷事实，但没有房贷债务 Proposal");
  }
  const hasHolding = input.ledger.businessHoldings.some((item) => item.status === "active" || item.status === "partially_sold");
  const hasProtagonistOptionFact = /(?:你(?:获得|获授|被授予|持有|拥有|行使|行权)[^。；]{0,24}期权|(?:授予|发放)[^。；]{0,12}(?:给)?你[^。；]{0,12}期权|你的[^。；]{0,16}期权)/u.test(input.narrativeText);
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
  return issues;
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

async function commitAuthoritativeFinancialProgress(input: {
  node: SimulationNode;
  rawNode: any;
  previousState: FinancialState;
  currentLedger?: SimulationNode["financialLedger"];
  currentWorldState: ReturnType<typeof emptyWorldState>;
  acceptedOutcome: AcceptedNodeOutcome;
  acceptedOutcomeId?: string;
  selectedDecision?: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  transactionId: string;
  previousWealth: number;
  callAiJson: AiJsonCaller;
}): Promise<{ node: SimulationNode; worldState: ReturnType<typeof emptyWorldState> }> {
  const processingStartedAt = Date.now();
  let repairTriggered = false;
  let repairLatencyMs = 0;
  let repairedCareerAttempted = false;
  const currentCareer = currentCareerState(input.currentWorldState)!;
  const currentCareerCollection = {
    careerStates: input.currentWorldState.careerStates || [currentCareer],
    currentCareerStateId: currentCareer.id,
    careerRevision: input.currentWorldState.careerRevision || 0
  };
  let rejectedEmploymentTransition: EmploymentTransitionProposal | undefined;
  const careerValidationIssues: FinancialLedgerIssue[] = [];
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
  let nextCareerIds = acceptedCareerTransitions.map((transition) => transition.nextCareerState.id);
  const selectedDecisionRequiresCareerTransition = /退休|转为.{0,12}顾问|结束.{0,12}全职|离职|换工作|入职/u.test(input.selectedDecision || "");
  if (selectedDecisionRequiresCareerTransition && acceptedCareerTransitions.length === 0 && careerValidationIssues.length === 0) {
    careerValidationIssues.push({
      id: `career_transition_missing_${input.transactionId}`,
      code: "CAREER_INCOME_CONFLICT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      summary: `已接受选择“${input.selectedDecision}”要求职业转换，但本轮没有通过校验的 employmentTransition`,
      createdAtAgeInMonths: input.periodEndAgeInMonths
    });
  }
  const initialLedger = input.currentLedger?.asOfAgeInMonths === input.periodStartAgeInMonths
    ? input.currentLedger
    : migrateLegacyFinancialState({
        id: input.currentLedger?.id || `financial_${input.transactionId}`,
        legacyState: input.previousState,
        linkedCareerStateId: currentCareer.id
      });
  const normalizedFinancial = normalizeFinancialProposals({
        proposals: rawFinancialEventProposals(input.rawNode),
        acceptedOutcomeIds: input.acceptedOutcomeId ? [input.acceptedOutcomeId] : [],
        currentLedger: initialLedger,
        currentCareerStateId: currentCareer.id,
        nextCareerStateIds: nextCareerIds
      });
  const validationInput = {
        currentLedger: initialLedger,
        currentCareerState: currentCareer,
        acceptedOutcomeId: input.acceptedOutcomeId,
        narrativeText: input.node.description,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths,
        simulationTransactionId: input.transactionId,
        allowedCareerStateIds: nextCareerIds,
        liquidityPolicy: "auto_shortfall_debt" as const
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
      ageInMonths: input.periodEndAgeInMonths
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
      if (source.status !== "active" || !source.linkedCareerStateId || acceptedIncomeIds.has(source.id)
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
  validated = { ...validated, issues: [...validated.issues, ...careerValidationIssues, ...completenessIssues] };
  const blockingIssues = validated.issues.filter((issue) => issue.severity === "blocking");
  const rejectedIds = new Set(blockingIssues.flatMap((issue) => issue.relatedProposalIds));
  if (input.acceptedOutcomeId && blockingIssues.length > 0) {
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
      const repairedRaw = parseAiJsonResponse(await input.callAiJson(repairPrompt));
      repairLatencyMs = Date.now() - repairStartedAt;
      const repairedEmploymentTransition = normalizeRepairedEmploymentTransition({
        raw: repairedRaw?.employmentTransition,
        fallback: rejectedEmploymentTransition,
        acceptedOutcomeId: input.acceptedOutcomeId,
        narrativeText: input.node.description,
        periodStartAgeInMonths: input.periodStartAgeInMonths
      });
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
      validated = validateFinancialProposals({
        proposals: [...combinedProposals.values()],
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
  if (rejectedEmploymentTransition && acceptedCareerTransitions.length === 0) {
    const existingIds = new Set(validated.issues.map((issue) => issue.id));
    validated = {
      ...validated,
      issues: [...validated.issues, ...careerValidationIssues.filter((issue) => !existingIds.has(issue.id))]
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
    return !(issue.relatedIncomeSourceIds || []).some((sourceId) => finalAcceptedIncomeIds.has(sourceId));
  });
  const existingValidatedIssueIds = new Set(validated.issues.map((issue) => issue.id));
  const remainingCoverageIssues = detectNarrativeFinancialCoverageIssues({
    narrativeText: input.node.description,
    ledger: initialLedger,
    acceptedEvents: validated.acceptedEvents,
    ageInMonths: input.periodEndAgeInMonths
  });
  validated = {
    ...validated,
    issues: [
      ...validated.issues,
      ...unresolvedCompletenessIssues.filter((issue) => !existingValidatedIssueIds.has(issue.id)),
      ...remainingCoverageIssues.filter((issue) => !existingValidatedIssueIds.has(issue.id))
    ]
  };
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
  const atomicCareerIncome = reconcileCareerIncomeAtomicity({
    currentCareerStateId: currentCareer.id,
    currentLedger: initialLedger,
    careerTransitions: acceptedCareerTransitions,
    financialEvents: validated.acceptedEvents,
    ageInMonths: input.periodEndAgeInMonths
  });
  acceptedCareerTransitions = atomicCareerIncome.acceptedCareerTransitions;
  validated = {
    acceptedEvents: atomicCareerIncome.acceptedFinancialEvents,
    issues: [...validated.issues, ...atomicCareerIncome.issues]
  };
  const committed = commitFinancialDomainTransaction({
    transactionId: input.transactionId,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    expectedCareerRevision: currentCareerCollection.careerRevision,
    expectedLedgerRevision: initialLedger.revision,
    currentCareer: currentCareerCollection,
    currentFinancialLedger: initialLedger,
    currentWorldState: input.currentWorldState,
    acceptedCareerTransitions,
    acceptedFinancialEvents: validated.acceptedEvents,
    financialIssues: validated.issues.filter((issue) => (
      issue.id !== "proposal_issue_missing_adult_expense"
      && !issue.id.startsWith("proposal_issue_stale_late_career_")
    )),
    liquidityPolicy: "auto_shortfall_debt"
  });
  const financialState = committed.derivedFinancialState.compatibilityState;
  const conservativeWealthBasis = deriveConservativeWealthBasis({ ledger: committed.financialLedger, financialState });
  const description = sanitizeFinancialNarrative(input.node.description, financialState, committed.financialLedger);
  return {
    node: {
      ...input.node,
      description,
      descriptionParagraphs: splitNarrativeParagraphs(description),
      attributes: withCalculatedWealth(input.node.attributes, conservativeWealthBasis, input.previousWealth),
      financialLedger: committed.financialLedger,
      financialLedgerMode: "authoritative",
      financialState,
      financialPeriodSummary: committed.financialPeriodSummary,
      financialSignals: undefined,
      financialChange: undefined,
      financialProcessingMeta: {
        proposalCount: normalizedFinancial.proposals.length,
        acceptedEventCount: validated.acceptedEvents.length,
        acceptedCareerTransitionCount: acceptedCareerTransitions.length,
        blockingIssueCount: validated.issues.filter((issue) => issue.severity === "blocking").length,
        repairTriggered,
        repairLatencyMs,
        totalProcessingLatencyMs: Date.now() - processingStartedAt
      }
    },
    worldState: committed.worldState
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
  if (deps.callAiJsonStream) return deps.callAiJsonStream;
  if (deps.callAiJson) {
    return async (prompt, options = {}) => {
      if (options.signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      const response = await fallbackCaller(prompt);
      options.onContent?.(response.text);
      return response;
    };
  }

  const e2eStreamCaller = getBrowserE2eAiJsonStreamCaller();
  if (e2eStreamCaller) return e2eStreamCaller;

  return (prompt, options = {}) => callDeepSeekJsonStreamFromBrowser(
    getBrowserAiEnv(),
    prompt,
    options
  );
}

function parseAiJsonResponse(response: { text?: string }): any {
  try {
    return JSON.parse(response.text || "{}");
  } catch (error) {
    throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回内容不是合法 JSON，请重试。", { cause: error });
  }
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
    lifeIntensity: "normal"
  });
  const startAgeInMonths = startNode.ageInMonths ?? startNode.age * 12;
  const rawFinancialState = latestData.initialFinancialState || latestData.startNode?.financialState || latestData.financialState;
  const modelFinancialState = normalizeInitialFinancialState(rawFinancialState, startAgeInMonths, startNode.attributes.wealth);
  const openingFacts = extractOpeningFinancialFacts(userData, answers);
  const proposedFinancialState = applyOpeningFactsToFinancialState(modelFinancialState, openingFacts);
  const startWorldState = emptyWorldState();
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
  startWorldState.people = rebuildPersonStates(userData, [], startNode.ageInMonths ?? startNode.age * 12);
  const openingResult = initializeOpeningFinancialLedger({
    id: `financial_opening_${startAgeInMonths}`,
    proposedState: proposedFinancialState,
    linkedCareerStateId: openingCareerState.id,
    openingFacts
  });
  const openingFinancialLedger = openingResult.ledger;
  const financialState = deriveFinancialState({
    ledger: openingFinancialLedger,
    employmentStatus: openingCareerState.employmentStatus
  }).compatibilityState;
  const startAttributes = withCalculatedWealth(startNode.attributes, financialState);
  const startDescription = sanitizeFinancialNarrative(startNode.description, financialState, openingFinancialLedger);
  const initializedStartNodeWithFinance = {
    ...startNode,
    description: startDescription,
    descriptionParagraphs: splitNarrativeParagraphs(startDescription),
    attributes: startAttributes,
    financialLedger: openingFinancialLedger,
    financialLedgerMode: "authoritative" as const,
    financialState,
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
  const selectedChoice = latest?.choices.find((choice) => (
    choice.text === selectedDecision
    || selectedDecision.includes(choice.text)
  ));
  if (!selectedChoice || !latest) return undefined;
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
}): LifeEventSeed | null {
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
    input.answers
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

export async function generateNextNode(
  input: GenerateNextNodeInput,
  deps: SimulationServiceDeps = {}
): Promise<SimulationNode> {
  deps.onGenerationStage?.("preparing");
  const callAiJson = getAiJsonCaller(deps);
  const callAiJsonStream = getAiJsonStreamCaller(deps, callAiJson);
  const lastNode = input.history[input.history.length - 1];
  const lastAge = lastNode ? lastNode.age : (input.userData.regressionAge || 20);
  const currentAgeInMonths = lastNode?.ageInMonths ?? lastAge * 12;
  const currentFinancialState = lastNode?.financialState
    || estimateFinancialStateFromWealth(input.currentAttributes.wealth, currentAgeInMonths);
  const nodeIndex = input.nodeIndex ?? input.history.length;
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
  const currentWorldState = {
    ...baseWorldState,
    directionArcs: ensureDirectionArcs(baseWorldState, input.userData, currentAgeInMonths),
    careerStates: existingCareerState ? baseWorldState.careerStates : [migratedCareerState],
    currentCareerStateId: migratedCareerState.id,
    careerRevision: baseWorldState.careerRevision || 0,
    currentEmploymentStatus: migratedCareerState.employmentStatus,
    version: 2 as const
  };
  const existingPressureArc = foregroundPressureArc(input.history);
  const e2eEventOverride = existingPressureArc ? undefined : getBrowserE2eEventOverride(input.history.length);
  const healthEscalationEvent = existingPressureArc
    ? null
    : queryHealthEscalationEvent(input.currentAttributes, input.history);
  const selectedEvent = existingPressureArc
    ? null
    : e2eEventOverride !== undefined
      ? LIFE_EVENTS_DATABASE.find((event) => event.id === e2eEventOverride) || null
      : healthEscalationEvent
        || queryDynamicLifeEvent(input.currentAttributes, input.userData, Math.floor(currentAgeInMonths / 12), input.history, input.answers);
  const selectedEventProfile = selectedEvent ? getEventTemporalProfile(selectedEvent) : undefined;
  const startPolicy = resolvePhasePolicy(selectedEvent?.intent.phasePolicyId);
  const startArcDecision = !existingPressureArc && selectedEvent && selectedEventProfile?.requiresFollowUp
    ? reducePressureArc({
        startProposal: { eventId: selectedEvent.id, eventIntentType: selectedEvent.intent.type, currentAgeInMonths, summary: selectedEvent.intent.meaning },
        policy: startPolicy,
        selectedDecision: input.selectedDecision,
        attributes: input.currentAttributes,
        timelineAdvance: { elapsedMonths: 0, targetAgeInMonths: currentAgeInMonths }
      })
    : undefined;
  const workingPressureArc = existingPressureArc || startArcDecision?.nextArcState;
  const pressureArcPolicy = resolvePhasePolicy(workingPressureArc?.phasePolicyId);
  const nodeEvent = workingPressureArc
    ? selectArcContinuationEvent({
        arc: workingPressureArc,
        attributes: input.currentAttributes,
        userData: input.userData,
        age: Math.floor(currentAgeInMonths / 12),
        history: input.history,
        answers: input.answers
      })
    : selectedEvent;
  const eventProfile = nodeEvent ? getEventTemporalProfile(nodeEvent) : selectedEventProfile;
  const pressurePhaseProfile = workingPressureArc ? resolvePhase(pressureArcPolicy, workingPressureArc.phaseId) : undefined;
  const stableNodeCount = input.history.slice(-2).filter((item) => item.narrativeMeta?.lifeIntensity === "stable").length;
  const temporalProfile = deriveTemporalProfile({
    pressurePhaseProfile,
    choiceHint: resolveChoiceTemporalHint(input.history, input.selectedDecision),
    eventProfile,
    attributes: input.currentAttributes,
    stableNodeCount
  });
  const timelineAdvance = calculateTimelineAdvance({
    currentAgeInMonths,
    temporalProfile,
    simulationSeed,
    branchFingerprint,
    hardMaximumAge: DEFAULT_ENDING_POLICY.hardMaximumAge
  });
  const people = rebuildPersonStates(input.userData, input.history, timelineAdvance.targetAgeInMonths);
  const worldState = { ...currentWorldState, people };
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
  const prompt = buildNextNodePrompt({
    ...input,
    currentFinancialState,
    currentFinancialLedger: lastNode?.financialLedger,
    selectedOutcomeId,
    eventSeed: nodeEvent,
    storyContext,
    timelineAdvance,
    ageContext,
    worldState,
    foregroundPressureArc: workingPressureArc
  });

  let latestRawNode: any = {};
  deps.onGenerationStage?.("generating");
  let node = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
    let lastPreviewSignature = "";
    const response = await callAiJsonStream(
      buildNodePromptWithRetryNotice(prompt, previousIssues),
      {
        signal: deps.signal,
        onContent: (content) => {
          const preview = extractStreamedNodePreview(content);
          const signature = JSON.stringify(preview);
          if (signature === lastPreviewSignature) return;
          lastPreviewSignature = signature;
          deps.onNarrativeProgress?.(preview);
        }
      }
    );
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
    allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes
  });
  deps.onGenerationStage?.("validating");
  node = {
    ...node,
    isEndingNode: false,
    eventMeta: nodeEvent ? buildEventMeta(nodeEvent) : undefined,
    choices: node.choices.map((choice) => ({
      ...choice,
      expectedWorldDeltaTypes: choice.expectedWorldDeltaTypes?.length ? choice.expectedWorldDeltaTypes : fallbackWorldDeltaTypes({ ...node, eventMeta: nodeEvent ? buildEventMeta(nodeEvent) : undefined })
    }))
  };
  node = attachPendingFinancialContext({
    node,
    previousState: currentFinancialState
  });

  let consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
  let repeatsAcuteHealthCrisis = repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc);
  if (containsForbiddenArcWrite(latestRawNode) || repeatsAcuteHealthCrisis || consistencyIssues.some((issue) => issue.severity === "error")) {
    const issueText = [
      containsForbiddenArcWrite(latestRawNode) ? "模型尝试直接修改 PressureArc phase；只能返回 arcSignals" : "",
      repeatsAcuteHealthCrisis ? "健康 recovery/operation 不得新增倒地、急救、再次住院或再次停摆；保留健康未改善及其代价，但改写为持续症状、复查指标和负荷观察" : "",
      ...consistencyIssues.map((issue) => issue.message)
    ].filter(Boolean).join("；");
    const response = await callAiJson(`${prompt}\n\n【年龄与状态一致性修复】\n${issueText}\n请重新生成完整节点，不得修改 Arc 状态。`);
    latestRawNode = parseAiJsonResponse(response);
    if (containsForbiddenArcWrite(latestRawNode)) throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回包含未授权的 Arc 状态修改，请重试。");
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
    node = { ...node, isEndingNode: false, eventMeta: nodeEvent ? buildEventMeta(nodeEvent) : undefined };
    node = attachPendingFinancialContext({
      node,
      previousState: currentFinancialState
    });
    consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
    repeatsAcuteHealthCrisis = repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc);
    if (repeatsAcuteHealthCrisis || consistencyIssues.some((issue) => issue.severity === "error")) {
      throw new AiClientError(
        "AI_RESPONSE_INVALID",
        repeatsAcuteHealthCrisis
          ? "健康恢复节点仍在重复急性危机，请重试。"
          : consistencyIssues.map((issue) => issue.message).join("；")
      );
    }
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
    const endingPrompt = buildEndingNodePrompt({ userData: input.userData, history: input.history, candidateNode: node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, forcedByHardMaximum: endingDecision.forcedByHardMaximum });
    const response = await callAiJson(endingPrompt);
    const rawEnding = parseAiJsonResponse(response);
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
      currentLedger: lastNode?.financialLedger,
      currentWorldState: worldState,
      acceptedOutcome: endingOutcome,
      acceptedOutcomeId: selectedOutcomeId,
      selectedDecision: input.selectedDecision,
      periodStartAgeInMonths: currentAgeInMonths,
      periodEndAgeInMonths: timelineAdvance.targetAgeInMonths,
      transactionId: endingTransactionId,
      previousWealth: input.currentAttributes.wealth,
      callAiJson
    });
    endingNode = authoritativeFinance.node;
    return commitSimulationTransaction({
      transactionId: endingTransactionId,
      node: endingNode,
      storyEpisode: endingNode.narrativeMeta!.storyEpisode,
      acceptedOutcome: endingOutcome,
      pressureArcTransition: terminalTransition,
      currentWorldStateSnapshot: authoritativeFinance.worldState,
      domainTransactionAlreadyCommitted: true
    }).node;
  }

  let decisionGate = evaluateDecisionGate({
    candidateNode: node,
    previousNode: lastNode,
    pressureArc: workingPressureArc,
    recentHistory: input.history,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
    narrativeMode: nodeEvent?.narrativeMode
  });
  if (!decisionGate.isDecisionCheckpoint) {
    const blockedChoicePrompt = decisionGate.blockedDecisionIntents.length > 0
      ? `\n以下 decisionIntent 近期已被用户重复未采纳，处于冷却中：${decisionGate.blockedDecisionIntents.join("、")}。保留相关真实事实或人物关系，但不得改写文案后再次提供同一行动。`
      : "";
    const repairPrompt = `${prompt}\n\n【DecisionGate 未通过】\n问题：${decisionGate.reasonCodes.join("、")}。${blockedChoicePrompt}\n请把等待、复查、恢复等过程压缩进 storyEpisode.internalTransitions，并生成至少两个会改变未来状态的实质选项。`;
    const response = await callAiJson(repairPrompt);
    latestRawNode = parseAiJsonResponse(response);
    if (containsForbiddenArcWrite(latestRawNode)) throw new AiClientError("AI_RESPONSE_INVALID", "DecisionGate 修复结果包含未授权的 Arc 状态修改。");
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
    node = { ...node, isEndingNode: false, eventMeta: nodeEvent ? buildEventMeta(nodeEvent) : undefined };
    node = attachPendingFinancialContext({
      node,
      previousState: currentFinancialState
    });
    consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
    repeatsAcuteHealthCrisis = repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc);
    if (repeatsAcuteHealthCrisis || consistencyIssues.some((issue) => issue.severity === "error")) {
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
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      narrativeMode: nodeEvent?.narrativeMode
    });
    if (!decisionGate.isDecisionCheckpoint) throw new AiClientError("AI_RESPONSE_INVALID", "生成结果没有形成真正不同的人生选择，请重试。");
  }

  // Run the health-operation evidence repair after every generic node repair.
  // Otherwise a later consistency or DecisionGate rewrite can silently remove
  // a valid pressure_resolved signal and prevent the reflection invitation.
  if (
    workingPressureArc?.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id
    && workingPressureArc.phaseId === "operation"
    && !hasMatchingPressureResolvedSignal(node, workingPressureArc, pressureArcPolicy)
  ) {
    const originalRawNode = latestRawNode;
    const originalNode = node;
    try {
      const response = await callAiJson(`${prompt}\n\n【健康 operation 结果证据修复】\n上一次最终候选节点缺少可校验的 pressure_resolved，请重新生成完整节点。\n硬性要求：\n1. description 必须原样包含完整句子：“这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。”\n2. narrativeMeta.arcSignals 必须是非空数组，并至少包含：{ "pressureArcId": "${workingPressureArc.id}", "type": "pressure_resolved", "evidence": "这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。", "confidence": 0.95 }。\n3. 不得把阶段结果写成完全治愈，不得修改 PressureArc 状态。\n返回前逐字检查 evidence 能在 description 中找到。`);
      let repairedRawNode = parseAiJsonResponse(response);
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
        pressureArcId: workingPressureArc.id
      });
      repairedNode = {
        ...repairedNode,
        isEndingNode: false,
        eventMeta: nodeEvent ? buildEventMeta(nodeEvent) : undefined,
        choices: repairedNode.choices.map((choice) => ({
          ...choice,
          expectedWorldDeltaTypes: choice.expectedWorldDeltaTypes?.length
            ? choice.expectedWorldDeltaTypes
            : fallbackWorldDeltaTypes({ ...repairedNode, eventMeta: nodeEvent ? buildEventMeta(nodeEvent) : undefined })
        }))
      };
      repairedNode = attachPendingFinancialContext({
        node: repairedNode,
        previousState: currentFinancialState
      });
      const repairedConsistencyIssues = validateStoryConsistency({
        node: repairedNode,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
        people
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

  const acceptedOutcome = validateNodeOutcomeProposal({
    worldDeltas: node.narrativeMeta?.worldDeltas,
    arcSignals: node.narrativeMeta?.arcSignals,
    policy: pressureArcPolicy,
    narrativeText: node.description,
    expectedSourceOutcomeId: selectedOutcomeId
  });
  const pressureArcTransition = reducePressureArc({
    currentArc: workingPressureArc,
    policy: pressureArcPolicy,
    selectedDecision: input.selectedDecision,
    acceptedOutcome,
    attributes: node.attributes,
    timelineAdvance
  });
  const transactionId = stableHash({ namespace: "simulation-transaction", simulationSeed, branchFingerprint, targetAgeInMonths: timelineAdvance.targetAgeInMonths });
  deps.onGenerationStage?.("finalizing");
  const authoritativeFinance = await commitAuthoritativeFinancialProgress({
    node,
    rawNode: latestRawNode,
    previousState: currentFinancialState,
    currentLedger: lastNode?.financialLedger,
    currentWorldState: worldState,
    acceptedOutcome,
    acceptedOutcomeId: selectedOutcomeId,
    selectedDecision: input.selectedDecision,
    periodStartAgeInMonths: currentAgeInMonths,
    periodEndAgeInMonths: timelineAdvance.targetAgeInMonths,
    transactionId,
    previousWealth: input.currentAttributes.wealth,
    callAiJson
  });
  node = authoritativeFinance.node;
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
    lifeIntensity: "normal"
  });
}
