import { buildEventMeta, getEventTemporalProfile, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent, queryHealthEscalationEvent, type LifeEventSeed } from "../../data/lifeEvents";
import { ChoiceTemporalHint, EmploymentTransitionProposal, FinancialState, HistoryItem, LifeAttributes, PersonalityInsight, PressureArcState, QuestionItem, QuestionTurn, SimulationNode, UserInitialData, WorldDelta } from "../../types";
import { DEFAULT_ENDING_POLICY } from "../../config/endingPolicy";
import { DEFAULT_REPORT_INVITATION_POLICY } from "../../config/reportInvitationPolicy";
import { buildQuestionPrompt } from "../../utils/questionPrompt";
import { normalizePersonalityInsight } from "../../utils/insightResponse";
import { generateCompleteSimulationNode, isRetryableNodeGenerationError } from "../../utils/simulationNodeRetry";
import { normalizeSimulationNode } from "../../utils/simulationResponse";
import { buildStoryContextPack } from "../../utils/storyContext";
import { buildAgeContext } from "../../utils/ageContext";
import { FINANCIAL_DEBT_PHASE_POLICY, HEALTH_CRISIS_PHASE_POLICY, preemptDebtArcForAcuteHealth, reducePressureArc, resolveDebtArcAfterHealth, resolvePhase, resolvePhasePolicy, resolvePressureArcPresentationEvent as resolvePolicyPressureArcPresentationEvent, validateNodeOutcomeProposal, type AcceptedNodeOutcome, type PhaseTransitionPolicy, type PressureArcTransitionDecision } from "../../utils/arcLifecycle";
import { applyDecisionDensityDowngrade, evaluateDecisionGate, pruneRecentlyPassedChoices } from "../../utils/decisionGate";
import { evaluateEnding } from "../../utils/endingDecision";
import { rebuildPersonStates } from "../../utils/personTimeline";
import { commitSimulationTransaction, emptyWorldState } from "../../utils/simulationTransaction";
import { buildBranchFingerprint, calculateTimelineAdvance, constrainTemporalProfileForDebtDistress, deriveTemporalProfile } from "../../utils/timelineAdvance";
import { stableHash } from "../../utils/stableRandom";
import { containsForbiddenArcWrite, stripForbiddenArcWrites, validateStoryConsistency } from "../../utils/storyConsistency";
import { estimateFinancialStateFromWealth, normalizeInitialFinancialState, withCalculatedWealth } from "../../utils/financialState";
import { resolveAuthoritativeEmploymentStatus } from "../../utils/employmentState";
import { sanitizeFinancialNarrative, sanitizeOpeningFinancialTitle, sanitizeSimulationNodeFinancialNarrative, sanitizeUnsupportedOpeningAccountClaims, validateDebtNarrativeConsistency } from "../../utils/financialNarrative";
import { applyDebtNarrativeAuthorityToNode, applyDebtNarrativeFallback, collectDebtNarrativeSurfaceIssues, deriveDebtNarrativeAuthority, repairDebtNarrativeSurfaces } from "../../utils/debtNarrativeAuthority";
import { reconcileHealth } from "../../utils/healthReconciliation";
import { evaluateReportInvitation } from "../../utils/reportInvitationDecision";
import { queryDebtEscalationEvent } from "../../utils/debtEventScheduling";
import { adaptTransitionalEmploymentProposal, currentCareerState, initializeCareerState, validateAndAcceptCareerTransition } from "../../domain/career/careerState";
import type { CareerState } from "../../domain/career/types";
import {
  commitFinancialDomainTransaction,
  deriveDebtHealthState,
  deriveFinancialState,
  deriveConservativeWealthBasis,
  migrateFinancialLedgerV2ToV3,
  initializeOpeningFinancialLedger,
  migrateLegacyFinancialState,
  applyOpeningFactsToFinancialState,
  applyAuthoritativeOpeningFactsToFinancialState,
  extractOpeningFinancialFacts,
  normalizeFinancialProposals,
  normalizeRepairedFinancialProposals,
  matchesNormalizedEvidence,
  collectPersonalIncomeNarrativeContractIssues,
  hasExplicitUnpaidPersonalIncomeStatement,
  buildLateLifeEmploymentClosure,
  completeCareerIncomeReplacementProposals,
  buildMortalityFinancialClosure,
  reconcileCareerIncomeAtomicity,
  validateFinancialProposals,
  FinancialLedgerInvariantError,
  type FinancialEventProposal,
  type AcceptedFinancialEvent,
  type FinancialLedger,
  type FinancialLedgerInput,
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
  buildFinancialNarrativeRepairPrompt,
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

export function synthesizeSelectedCareerTransition(input: {
  selectedDecision?: string;
  narrativeText: string;
  acceptedOutcomeId?: string;
  effectiveAtAgeInMonths: number;
  currentStatus?: CareerState["employmentStatus"];
}): EmploymentTransitionProposal | undefined {
  if (!input.acceptedOutcomeId || !input.selectedDecision) return undefined;
  const decision = input.selectedDecision;
  const narrativeEvidence = input.narrativeText.split(/(?<=[。！？])/u).map((item) => item.trim()).find((sentence) => (
    /(?:你|主角|本人).{0,50}(?:辞职|辞去|辞掉|离职|离开.{0,10}(?:岗位|公司|平台)|正式退休|停止工作|开始创业|全职投入.{0,12}创业|回归职场|重返职场|正式入职|接受了?.{0,20}(?:offer|工作|职位|岗位)|获得了?.{0,20}(?:offer|工作|职位|岗位)|转岗|转任|转为.{0,12}顾问|顾问角色|被任命|晋升|提升为|成为.{0,12}负责人)/iu.test(sentence)
  ));
  let toStatus: EmploymentTransitionProposal["toStatus"] | undefined;
  if (/辞职.{0,12}创业|离职.{0,12}创业|全职.{0,12}创业/u.test(decision)) toStatus = "self_employed";
  else if (/退休/u.test(decision)) toStatus = "retired";
  else if (/停止工作|不再工作/u.test(decision)) toStatus = "not_working";
  else if (/入职|接受.{0,20}(?:offer|工作|职位|岗位)|回.{0,8}职场/iu.test(decision)) toStatus = "employed";
  else if (narrativeEvidence
    && /正式入职|已经入职|已入职|受聘|拿到.{0,16}(?:录用通知|offer)|接受了?.{0,20}(?:offer|工作|职位|岗位)|获得了?.{0,20}(?:offer|工作|职位|岗位)/iu.test(narrativeEvidence)) {
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
    && /转岗|转任|被任命|晋升|提升为|成为.{0,12}负责人/u.test(narrativeEvidence)
    && input.currentStatus
    && ["employed", "part_time", "self_employed"].includes(input.currentStatus)) {
    toStatus = input.currentStatus;
  }
  if (!toStatus) return undefined;
  // The accepted choice is itself authoritative action evidence. Narrative text
  // may use a synonym such as "递交辞呈", so a prose regex miss must not leave
  // CareerState behind the accepted branch.
  const evidence = narrativeEvidence || decision.trim();
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
  const completed = /已经|已(?:经)?(?:到账|支付|缴纳|买入|买下|卖出|偿还|还清|重组|减免|签署|完成)|到账|放款|获批|拿到|获得|收到|支付了|投入了|购买了|卖掉了|偿还了|结清/u.test(evidence);
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
  const protagonistSentences = input.narrativeText.split(/(?<=[。！？；])/u)
    .filter((sentence) => /你|你的|你们|本人|自己|名下/u.test(sentence))
    .filter((sentence) => !/(?:母亲|父亲|妈妈|爸爸|表哥|表姐|堂哥|堂姐|朋友|同事|伴侣|丈夫|妻子)[^，。；]{0,24}(?:房贷|按揭)/u.test(sentence)
      || /你(?:本人)?[^，。；]{0,24}(?:房贷|按揭)|(?:你的|你名下)[^，。；]{0,24}(?:房产|住房|房子|公寓)/u.test(sentence));
  const protagonistPropertyText = protagonistSentences.join(" ");
  if (/(?:买下|购入|购买了|名下已有|自有|拥有)(?:[^。；]{0,20})(?:房产|住房|房子|公寓)|(?:还完|偿还|还清|背上|尚有|剩余)[^。；]{0,12}(?:房贷|按揭)|(?:房贷|按揭)[^。；]{0,12}(?:月供|本金|余额)/u.test(protagonistPropertyText)) {
    if (!input.ledger.assetAccounts.some((item) => item.status === "active" && item.type === "property")
      && !hasKind("asset_purchased", "asset_balance_discovered")) push("property", "正文包含已发生的主人公房产事实，但没有房产资产 Proposal");
    if (/(?:房贷|按揭)/u.test(protagonistPropertyText)
      && !input.ledger.debtAccounts.some((item) => item.status === "active" && item.type === "mortgage")
      && !hasKind("debt_drawn", "debt_balance_discovered")) push("mortgage", "正文包含已发生的主人公房贷事实，但没有房贷债务 Proposal");
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
    const monthly = [...sentence.matchAll(/(?:税后)?月薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*(万|元)/gu)]
      .filter((match) => !/(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,70}(?:会计|员工|助理|工程师|销售|运营|护工)[^。；]{0,35}$/u.test(sentence.slice(Math.max(0, Number(match.index) - 110), Number(match.index))))
      .map((match) => Math.round(Number(match[1]) * (match[2] === "元" ? 0.0001 : 1) * 12 * 10000) / 10000);
    const annual = [...sentence.matchAll(/(?:税后)?年薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
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
}): FinancialLedgerIssue[] {
  const authoritativeIssues = [
    ...detectNarrativeFinancialCoverageIssues({
      narrativeText: input.narrativeText,
      ledger: input.ledger,
      acceptedEvents: input.acceptedEvents,
      ageInMonths: input.ageInMonths
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

function repairedNarrativeParagraphs(raw: unknown): string[] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.descriptionParagraphs)) return undefined;
  const paragraphs = source.descriptionParagraphs
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return paragraphs.length >= 2 && paragraphs.length <= 4 ? paragraphs : undefined;
}

export function stillClaimsRejectedDebtDraw(description: string): boolean {
  return description.split(/(?<=[。！？])/u).some((sentence) => {
    if (/尚未|还未|未能|没有|并未|不再|无需|尚在|仍在(?:申请|审核|审批|协商)/u.test(sentence)) return false;
    return /(?:贷款|借款)[^。！？]{0,36}(?:已(?:经)?(?:获批|放款|到账)|审批通过|完成(?:了)?放款|(?:完成[^。！？]{0,18})?贷款放款|到账|余额|还剩)|(?:拿到|获得|收到)[^。！？]{0,24}(?:贷款|借款)|(?:开始|需要|每月需|每月|正在|扣除)[^。！？]{0,18}(?:月供|还贷|偿还贷款)|(?:本金未还|剩余本金|月供\s*\d)/u.test(sentence);
  });
}

export function stillClaimsRejectedDebtRestructure(description: string): boolean {
  return description.split(/(?<=[。！？])/u).some((sentence) => {
    if (/申请|可以申请|待审核|审批中|协商中|尚未|还未|未能|没有通过|被拒/u.test(sentence)
      && !/确认函|正式生效|已经生效|已改为|调整为|月供[^。！？]{0,24}(?:降至|降到|降低到)(?:了)?/u.test(sentence)) return false;
    return /新还款计划确认函|(?:重组|宽限期)协议.{0,10}(?:签署|生效)|签了协议|还款方式(?:已经|已)?改为|期限(?:已经|已)?延长|(?:把)?月供[^。！？]{0,24}(?:降至|降到|降低到)(?:了)?|(?:把)?月供[^。！？]{0,24}归零|月供暂时归零|宽限期内|银行(?:已经|已)?(?:批准|同意).{0,16}(?:展期|重组|先息后本|宽限期)/u.test(sentence);
  });
}

function stillClaimsRejectedProposal(proposal: FinancialEventProposal, description: string): boolean {
  if (proposal.kind === "debt_drawn") return stillClaimsRejectedDebtDraw(description);
  if (proposal.kind === "debt_restructured") return stillClaimsRejectedDebtRestructure(description);
  return rejectedProposalClaimsCompletedFact(proposal) && description.includes(proposal.evidence.trim());
}

export function buildDeterministicFinancialNarrativeRollback(input: {
  rejectedProposals: FinancialEventProposal[];
  acceptedEvents: AcceptedFinancialEvent[];
  narrativeText?: string;
}): string[] {
  const acceptedEvidence = [...new Set(input.acceptedEvents.flatMap((event) => (
    event.evidence.map((item) => item.excerpt?.trim()).filter((item): item is string => Boolean(item))
  )))];
  const pendingByKind: Partial<Record<FinancialEventProposal["kind"], string>> = {
    debt_drawn: "你尝试申请借款，但这次尚未形成已经到账的结果。",
    debt_restructured: "你已经尝试申请调整还款安排，但尚未形成生效协议。",
    asset_sold: "你开始评估资产处置，但这次尚未形成确定成交。",
    family_support_received: "你尝试寻求外部支持，但这次尚未确认资金到账。"
  };
  const fallbackFor = (proposal: FinancialEventProposal) => pendingByKind[proposal.kind]
    ?? "你已经尝试推进这项财务安排，但它暂时还没有形成确定结果。";
  const sourceParagraphs = String(input.narrativeText || "").split(/\n\s*\n+/u).map((item) => item.trim()).filter(Boolean);
  let changed = false;
  const repairedParagraphs = sourceParagraphs.map((paragraph) => {
    const sentences = paragraph.split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean);
    const repaired = sentences.map((sentence) => {
      const rejected = input.rejectedProposals.find((proposal) => stillClaimsRejectedProposal(proposal, sentence)
        || (proposal.evidence.trim().length > 0 && sentence.includes(proposal.evidence.trim())));
      if (!rejected) return sentence;
      changed = true;
      return fallbackFor(rejected);
    });
    return repaired.join("");
  }).filter(Boolean);
  if (!changed) repairedParagraphs.push(...[...new Set(input.rejectedProposals.map(fallbackFor))]);
  for (const excerpt of acceptedEvidence) {
    if (/^(?:自定义抉择|用户选择|已接受选择)\s*[:：]/u.test(excerpt)) continue;
    if (!repairedParagraphs.some((paragraph) => paragraph.includes(excerpt))) repairedParagraphs.push(excerpt);
  }
  return repairedParagraphs.length > 0
    ? repairedParagraphs
    : ["你把这次行动保留为仍在推进的尝试，没有把尚未确认的结果提前写进生活。"];
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
    if (!rejectedOnly || (issue.status ?? "open") !== "open") return issue;
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
  const appendMissing = (kind: "debt_drawn" | "debt_restructured", claimsCompletion: boolean) => {
    if (!claimsCompletion || proposals.some((proposal) => proposal.kind === kind)) return;
    const evidence = sentences.find((sentence) => (
      kind === "debt_drawn" ? stillClaimsRejectedDebtDraw(sentence) : stillClaimsRejectedDebtRestructure(sentence)
    )) || "";
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
  appendMissing("debt_drawn", stillClaimsRejectedDebtDraw(input.narrativeText));
  appendMissing("debt_restructured", stillClaimsRejectedDebtRestructure(input.narrativeText));
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
  ledger: FinancialLedger;
}): FinancialEventProposal[] {
  const decision = input.selectedDecision?.trim();
  if (!decision || !input.acceptedOutcomeId) return input.proposals;
  const narrativeEvidence = input.allowNarrativeEvidence
    ? input.narrativeText?.split(/(?<=[。！？])/u).map((item) => item.trim()).find((sentence) => (
        (
          /(?:你|主角|本人|你的个人账户).{0,48}(?:税后)?(?:月薪|年薪|工资|薪资|副业月收入|个人月收入).{0,16}\d+(?:\.\d+)?\s*(?:万)?元|(?:税后)?(?:月薪|年薪|副业月收入|个人月收入)(?:约|为|达到|降至|升至|涨到|调整为|维持在|稳定在)?\s*\d+(?:\.\d+)?\s*(?:万)?元/u.test(sentence)
        )
        && !/(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,70}(?:员工|助理|工程师|销售|运营|护工)[^。；]{0,35}(?:月薪|年薪)/u.test(sentence)
        && !/(?:如果|若|预计|计划|考虑|希望|目标|可以给你)[^。；]{0,50}(?:月薪|年薪)/iu.test(sentence)
      ))
    : undefined;
  const evidenceText = /个人账户|个人工资|个人薪资|给自己|向我(?:的)?账户|我(?:每月|开始|从本月起).{0,24}(?:工资|薪资|月薪)/u.test(decision)
    ? decision
    : narrativeEvidence;
  const sideIncomeEvidence = Boolean(evidenceText) && /副业|课程|咨询|工作坊|稿费|版税/u.test(evidenceText!);
  const explicitlyPersonal = Boolean(evidenceText) && /个人账户|个人工资|个人薪资|给自己|向我(?:的)?账户|你|主角|本人|月薪|年薪|副业月收入|个人月收入/u.test(evidenceText!);
  const monthlyMatch = evidenceText?.match(/每月[^，。；]{0,28}?(?:支付|发放|领取|获得|拿到|为|达到|调整为|降至|升至)?\s*(\d+(?:\.\d+)?)\s*(万|元)(?:税后)?(?:工资|薪资|月薪)?/u)
    || evidenceText?.match(/(?:税后)?(?:月薪|副业月收入|个人月收入)(?:正式)?(?:约|为|达到|调整为|降至|升至|涨到|维持在|稳定在)?\s*(\d+(?:\.\d+)?)\s*(万|元)/u);
  const annualMatch = evidenceText?.match(/(?:税后)?年薪(?:正式)?(?:约|为|达到|调整为|降至|升至|涨到|维持在|稳定在)?\s*(\d+(?:\.\d+)?)\s*万元?/u);
  if (!explicitlyPersonal || (!monthlyMatch && !annualMatch)) return input.proposals;

  const monthlyNetAmountWan = monthlyMatch
    ? Number(monthlyMatch[1]) * (monthlyMatch[2] === "元" ? 0.0001 : 1)
    : undefined;
  const annualNetAmountWan = annualMatch ? Number(annualMatch[1]) : undefined;
  if (!(Number(monthlyNetAmountWan ?? annualNetAmountWan) > 0)) return input.proposals;
  const careerIncomeTypes = new Set(["salary", "contract", "self_employment_draw"]);
  const allActiveCareerSources = input.ledger.incomeSources.filter((source) => (
    source.status === "active" && careerIncomeTypes.has(source.type)
  ));
  const activeCareerSources = allActiveCareerSources.filter((source) => (
    source.status === "active" && careerIncomeTypes.has(source.type) && source.linkedCareerStateId === input.currentCareerStateId
  ));
  const decisionChangesCareer = /辞职|离职|入职|就职|转岗|转行|回归职场|退休|停止工作/u.test(decision);
  const sideIncomeSources = allActiveCareerSources.filter((source) => (
    source.type === "contract"
    && /副业|课程|咨询|工作坊|稿费|版税/u.test(`${source.displayName} ${source.evidence.map((item) => item.excerpt || "").join(" ")}`)
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
  const incomeType = existingSource?.type
    || (sideIncomeEvidence ? "contract" : undefined)
    || (input.currentEmploymentStatus === "self_employed" ? "self_employment_draw" : "salary");
  const proposalsWithoutCompetingCareerIncome = input.proposals.filter((proposal) => {
    if (proposal.kind === "income_source_started") {
      const type = String((proposal.payload as Record<string, unknown>)?.type);
      return sideIncomeEvidence ? type !== "contract" : !careerIncomeTypes.has(type);
    }
    if (proposal.kind === "income_source_adjusted") {
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
    accrualPolicy: monthlyMatch ? "monthly" as const : "annual" as const,
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
    accrualPolicy: monthlyMatch ? "monthly" as const : "annual" as const,
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
  const stopsWorking = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && !negatesExit(sentence)
    && /(?:你|本人)[^。；]{0,24}(?:正式退休|办理退休|已经退休|已退休|最终决定[^。；]{0,8}(?:离职|辞职|辞去|停止工作)|递交了?辞呈|提交了?辞职申请|正式离职|正式辞职|已经离职|已经辞职|辞去了|停止了?工作|结束了?全职工作)|(?:正式退休|办理退休)[^。；]{0,16}你/u.test(sentence)
  ));
  if (stopsWorking && !["retired", "not_working"].includes(input.currentStatus)) return true;
  const startsWorking = protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && (
      /你[^。；]{0,28}(?:正式入职|已经入职|已入职|受聘|开始全职工作|(?:决定|选择|正式)加入[^。；]{0,12}(?:公司|机构|团队)|(?:接受|选择)[^。；]{0,16}(?:offer|新职位|新工作))/iu.test(sentence)
      || /新公司[^。；]{0,40}你(?:负责|担任|任职)/u.test(sentence)
    )
  ));
  if (startsWorking && ["student", "not_working", "retired", "medical_leave"].includes(input.currentStatus)) return true;
  return protagonistSentences.some((sentence) => (
    !hypotheticalOnly(sentence)
    && /你[^。；]{0,24}(?:(?:决定|选择|正式|已经|已)[^。；]{0,8})(?:换工作|跳槽|转任|转岗|转为[^。；]{0,8}顾问|全职投入创业|再次创业)/u.test(sentence)
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

async function commitAuthoritativeFinancialProgress(input: {
  node: SimulationNode;
  rawNode: any;
  previousState: FinancialState;
  currentLedger?: SimulationNode["financialLedger"];
  previousDebtHealthState?: SimulationNode["debtHealthState"];
  currentWorldState: ReturnType<typeof emptyWorldState>;
  acceptedOutcome: AcceptedNodeOutcome;
  acceptedOutcomeId?: string;
  selectedDecision?: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  transactionId: string;
  previousWealth: number;
  callAiJson: AiJsonCaller;
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
  const selectedDecisionRequiresCareerTransition = /退休|转为.{0,12}顾问|结束.{0,12}全职|离职|辞职|换工作|入职|(?:接受|选择).{0,20}(?:offer|新职位|新工作)|开始.{0,8}创业|全职.{0,8}创业/iu.test(input.selectedDecision || "");
  const careerTransitionRequired = selectedDecisionRequiresCareerTransition || narrativeRequiresCareerTransition({
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
    ? migrateFinancialLedgerV2ToV3(input.currentLedger as unknown as FinancialLedgerInput)
    : undefined;
  const initialLedger = migratedCurrentLedger?.asOfAgeInMonths === input.periodStartAgeInMonths
    ? migratedCurrentLedger
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
    ledger: initialLedger
  });
  normalizedFinancial.proposals = completeCareerIncomeReplacementProposals({
    proposals: normalizedFinancial.proposals,
    currentLedger: initialLedger,
    currentCareerStateId: currentCareer.id,
    transition: acceptedCareerTransitions[0],
    acceptedOutcomeId: input.acceptedOutcomeId
  });
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
        liquidityPolicy: "require_explicit" as const
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
  const rejectedCompletedProposals = [...allCandidateProposals.values()].filter((proposal) => (
    finalRejectedIdSet.has(proposal.id)
    && !isCompanyOperatingNarrativeProposal(proposal)
    && stillClaimsRejectedProposal(proposal, input.node.description)
  ));
  let committedNarrativeNode = input.node;
  let rejectedNarrativeWasRolledBack = false;
  if (rejectedCompletedProposals.length > 0) {
    let paragraphs: string[] | undefined;
    try {
      const narrativeRepairPrompt = buildFinancialNarrativeRepairPrompt({
        narrativeText: input.node.description,
        rejectedProposals: rejectedCompletedProposals,
        acceptedEvents: validated.acceptedEvents
      });
      const repairedRaw = parseAiJsonResponse(await input.callAiJson(narrativeRepairPrompt));
      paragraphs = repairedNarrativeParagraphs(repairedRaw);
    } catch {
      paragraphs = undefined;
    }
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
      paragraphs = buildDeterministicFinancialNarrativeRollback({
        rejectedProposals: rejectedCompletedProposals,
        acceptedEvents: validated.acceptedEvents,
        narrativeText: input.node.description
      });
      repairedDescription = paragraphs.join("\n\n");
      narrativeFallbackReasonCodes.push("FINANCIAL_COMPLETION_ROLLBACK");
      rejectedNarrativeWasRolledBack = true;
    }
    committedNarrativeNode = {
      ...input.node,
      description: repairedDescription,
      descriptionParagraphs: paragraphs
    };
  }
  const closingNarrativeContractIssues = [
    ...detectNarrativeFinancialCoverageIssues({
      narrativeText: committedNarrativeNode.description,
      ledger: initialLedger,
      acceptedEvents: validated.acceptedEvents,
      ageInMonths: input.periodEndAgeInMonths
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
  const transactionInput = {
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
    financialIssues: finalizedFinancialIssues.filter((issue) => (
      issue.id !== "proposal_issue_missing_adult_expense"
      && !issue.id.startsWith("proposal_issue_stale_late_career_")
    )),
    liquidityPolicy: "auto_shortfall_debt"
  } as const;
  // Narrative grounding depends on the closing ledger, while narrative contract
  // issues must describe the text the user actually sees. Trial the otherwise
  // pure transaction first, sanitize against that closing state, then rebuild
  // only the current node's narrative issues before the authoritative commit.
  const previewCommitted = commitFinancialDomainTransaction(transactionInput);
  const previewFinancialState = previewCommitted.derivedFinancialState.compatibilityState;
  const previewDescription = sanitizeFinancialNarrative(
    committedNarrativeNode.description,
    previewFinancialState,
    previewCommitted.financialLedger,
    validated.acceptedEvents
  );
  const postSanitizationIssues = reconcileNarrativeFinancialIssues({
    issues: transactionInput.financialIssues,
    narrativeText: previewDescription,
    ledger: initialLedger,
    acceptedEvents: validated.acceptedEvents,
    ageInMonths: input.periodEndAgeInMonths
  });
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
  const conservativeWealthBasis = deriveConservativeWealthBasis({ ledger: committed.financialLedger, financialState });
  const description = sanitizeFinancialNarrative(
    previewDescription,
    financialState,
    committed.financialLedger,
    validated.acceptedEvents
  );
  return {
    node: {
      ...committedNarrativeNode,
      description,
      descriptionParagraphs: splitNarrativeParagraphs(description),
      attributes: withCalculatedWealth(input.node.attributes, conservativeWealthBasis, input.previousWealth),
      financialLedger: committed.financialLedger,
      financialLedgerMode: "authoritative",
      financialState,
      debtHealthState,
      financialPeriodSummary: committed.financialPeriodSummary,
      financialSignals: undefined,
      financialChange: undefined,
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
        rejectedDebtClaimKinds: narrativeFallbackReasonCodes
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
  // A restored v2 ledger is upgraded only as a working candidate. The HistoryItem
  // remains byte-for-byte unchanged until a new node is committed.
  const currentFinancialLedger = lastNode?.financialLedger
    ? migrateFinancialLedgerV2ToV3(lastNode.financialLedger as unknown as FinancialLedgerInput)
    : undefined;
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
  // Foreground scheduling is deterministic. Acute health is the only event
  // allowed to preempt an active debt Arc; debt escalation itself bypasses the
  // ordinary random pool but never bypasses an already active Arc.
  const activeHealthArc = activeArcByPolicy(currentWorldState, HEALTH_CRISIS_PHASE_POLICY.id);
  const activeDebtArc = activeArcByPolicy(currentWorldState, FINANCIAL_DEBT_PHASE_POLICY.id);
  const foregroundArc = foregroundPressureArc(input.history);
  const otherActiveArc = currentWorldState.pressureArcs.find((arc) => (
    arc.status !== "resolved"
    && arc.status !== "suspended"
    && arc.phasePolicyId !== HEALTH_CRISIS_PHASE_POLICY.id
    && arc.phasePolicyId !== FINANCIAL_DEBT_PHASE_POLICY.id
  ));
  // This release only adds one new concurrency rule: acute health may suspend
  // an active debt Arc. A generic foreground Arc still keeps the legacy
  // single-foreground behavior; general-purpose Arc preemption is out of scope.
  const blockingGenericArc = foregroundArc?.phasePolicyId !== FINANCIAL_DEBT_PHASE_POLICY.id
    && foregroundArc?.phasePolicyId !== HEALTH_CRISIS_PHASE_POLICY.id
    ? foregroundArc
    : otherActiveArc;
  const healthEscalationEvent = activeHealthArc || blockingGenericArc
    ? null
    : queryHealthEscalationEvent(input.currentAttributes, input.history);
  const scheduledExistingArc = activeHealthArc
    || (!healthEscalationEvent ? activeDebtArc || foregroundArc || otherActiveArc : undefined);
  const debtEscalationEvent = scheduledExistingArc || healthEscalationEvent
    ? undefined
    : queryDebtEscalationEvent({ history: input.history, worldState: currentWorldState });
  const e2eEventOverride = scheduledExistingArc || healthEscalationEvent || debtEscalationEvent
    ? undefined
    : getBrowserE2eEventOverride(input.history.length);
  const selectedEvent = scheduledExistingArc
    ? null
    : healthEscalationEvent
      || debtEscalationEvent
      || (e2eEventOverride !== undefined
        ? LIFE_EVENTS_DATABASE.find((event) => event.id === e2eEventOverride) || null
        : queryDynamicLifeEvent(input.currentAttributes, input.userData, Math.floor(currentAgeInMonths / 12), input.history, input.answers));
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
    currentFinancialLedger,
    currentDebtHealthState: lastNode?.debtHealthState,
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
    latestRawNode = stripForbiddenArcWrites(parseAiJsonResponse(response));
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

  let selectedDecisionIssues = validateSelectedDecisionConsistency(input.selectedDecision, node.description);
  if (selectedDecisionIssues.length > 0) {
    const response = await callAiJson(`${prompt}\n\n【已接受选择一致性修复】\n${selectedDecisionIssues.join("；")}。\n用户的选择是已经接受的行动权限，不能改写成主角选择了另一条分支。行动可以因银行拒绝、交易条件未满足等客观原因失败，但正文必须明确写出主角确实执行或尝试了已选行动及其结果。请重新生成完整节点。`);
    latestRawNode = stripForbiddenArcWrites(parseAiJsonResponse(response));
    if (containsForbiddenArcWrite(latestRawNode)) throw new AiClientError("AI_RESPONSE_INVALID", "选择一致性修复结果包含未授权的 Arc 状态修改。");
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
    node = attachPendingFinancialContext({ node, previousState: currentFinancialState });
    selectedDecisionIssues = validateSelectedDecisionConsistency(input.selectedDecision, node.description);
    const repairedConsistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
    if (selectedDecisionIssues.length > 0 || repairedConsistencyIssues.some((issue) => issue.severity === "error")) {
      throw new AiClientError("AI_RESPONSE_INVALID", [...selectedDecisionIssues, ...repairedConsistencyIssues.map((issue) => issue.message)].join("；"));
    }
  }

  let consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
  let repeatsAcuteHealthCrisis = repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc);
  let debtNarrativeIssues = validateDebtNarrativeConsistency({
    description: node.description,
    debtHealthState: lastNode?.debtHealthState,
    ledger: currentFinancialLedger
  });
  if (containsForbiddenArcWrite(latestRawNode) || repeatsAcuteHealthCrisis || debtNarrativeIssues.length > 0 || consistencyIssues.some((issue) => issue.severity === "error")) {
    const issueText = [
      containsForbiddenArcWrite(latestRawNode) ? "模型尝试直接修改 PressureArc phase；只能返回 arcSignals" : "",
      repeatsAcuteHealthCrisis ? "健康 recovery/operation 不得新增倒地、急救、再次住院或再次停摆；保留健康未改善及其代价，但改写为持续症状、复查指标和负荷观察" : "",
      ...debtNarrativeIssues,
      ...consistencyIssues.map((issue) => issue.message)
    ].filter(Boolean).join("；");
    const response = await callAiJson(`${prompt}\n\n【年龄与状态一致性修复】\n${issueText}\n请重新生成完整节点，不得修改 Arc 状态。`);
    latestRawNode = stripForbiddenArcWrites(parseAiJsonResponse(response));
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
    debtNarrativeIssues = validateDebtNarrativeConsistency({
      description: node.description,
      debtHealthState: lastNode?.debtHealthState,
      ledger: currentFinancialLedger
    });
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
  const initiallyPrunedNode = pruneRecentlyPassedChoices(node, decisionGate);
  if (initiallyPrunedNode !== node) {
    node = initiallyPrunedNode;
    decisionGate = evaluateDecisionGate({
      candidateNode: node,
      previousNode: lastNode,
      pressureArc: workingPressureArc,
      recentHistory: input.history,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      narrativeMode: nodeEvent?.narrativeMode
    });
  }
  for (let decisionRepairAttempt = 1; !decisionGate.isDecisionCheckpoint && decisionRepairAttempt <= 2; decisionRepairAttempt += 1) {
    const blockedChoicePrompt = decisionGate.blockedDecisionIntents.length > 0
      ? `\n以下 decisionIntent 近期已被用户重复未采纳，处于冷却中：${decisionGate.blockedDecisionIntents.join("、")}。保留相关真实事实或人物关系，但不得改写文案后再次提供同一行动。`
      : "";
    const repairPrompt = `${prompt}\n\n【DecisionGate 未通过：第 ${decisionRepairAttempt} 次修复】\n问题：${decisionGate.reasonCodes.join("、")}。${blockedChoicePrompt}\n请把等待、复查、恢复等过程压缩进 storyEpisode.internalTransitions，并生成至少两个会改变未来状态的实质选项。不得只替换近义词；每个选项必须使用不同 decisionIntent${nodeEvent?.intent.allowedOutcomes?.length ? `，并从允许的 eventOutcomeId 中覆盖至少两个不同策略：${nodeEvent.intent.allowedOutcomes.join("、")}` : ""}。`;
    try {
      const response = await callAiJson(repairPrompt);
      latestRawNode = stripForbiddenArcWrites(parseAiJsonResponse(response));
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
      pressureArcId: workingPressureArc?.id
    });
    node = { ...node, isEndingNode: false, eventMeta: nodeEvent ? buildEventMeta(nodeEvent) : undefined };
    node = attachPendingFinancialContext({
      node,
      previousState: currentFinancialState
    });
    node = applyDecisionDensityDowngrade(node, decisionGate);
    consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
    repeatsAcuteHealthCrisis = repeatsAcuteHealthCrisisAfterTrigger(node, workingPressureArc);
    debtNarrativeIssues = validateDebtNarrativeConsistency({
      description: node.description,
      debtHealthState: lastNode?.debtHealthState,
      ledger: currentFinancialLedger
    });
    if (repeatsAcuteHealthCrisis || consistencyIssues.some((issue) => issue.severity === "error")) {
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
      allowedOutcomeIds: nodeEvent?.intent.allowedOutcomes,
      narrativeMode: nodeEvent?.narrativeMode
    });
    const prunedNode = pruneRecentlyPassedChoices(node, decisionGate);
    if (prunedNode !== node) {
      node = prunedNode;
      decisionGate = evaluateDecisionGate({
        candidateNode: node,
        previousNode: lastNode,
        pressureArc: workingPressureArc,
        recentHistory: input.history,
        targetAgeInMonths: timelineAdvance.targetAgeInMonths,
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
    workingPressureArc?.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id
    && workingPressureArc.phaseId === "operation"
    && !hasMatchingPressureResolvedSignal(node, workingPressureArc, pressureArcPolicy)
  ) {
    const originalRawNode = latestRawNode;
    const originalNode = node;
    try {
      const response = await callAiJson(`${prompt}\n\n【健康 operation 结果证据修复】\n上一次最终候选节点缺少可校验的 pressure_resolved，请重新生成完整节点。\n硬性要求：\n1. description 必须原样包含完整句子：“这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。”\n2. narrativeMeta.arcSignals 必须是非空数组，并至少包含：{ "pressureArcId": "${workingPressureArc.id}", "type": "pressure_resolved", "evidence": "这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。", "confidence": 0.95 }。\n3. 不得把阶段结果写成完全治愈，不得修改 PressureArc 状态。\n返回前逐字检查 evidence 能在 description 中找到。`);
      let repairedRawNode = stripForbiddenArcWrites(parseAiJsonResponse(response));
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

  const financialCandidateOutcome = validateNodeOutcomeProposal({
    worldDeltas: node.narrativeMeta?.worldDeltas,
    arcSignals: node.narrativeMeta?.arcSignals,
    policy: pressureArcPolicy,
    narrativeText: node.description,
    expectedSourceOutcomeId: selectedOutcomeId
  });
  const transactionId = stableHash({ namespace: "simulation-transaction", simulationSeed, branchFingerprint, targetAgeInMonths: timelineAdvance.targetAgeInMonths });
  deps.onGenerationStage?.("finalizing");
  const authoritativeFinance = await commitAuthoritativeFinancialProgress({
    node,
    rawNode: latestRawNode,
    previousState: currentFinancialState,
    currentLedger: currentFinancialLedger,
    previousDebtHealthState: lastNode?.debtHealthState,
    currentWorldState: worldState,
    acceptedOutcome: financialCandidateOutcome,
    acceptedOutcomeId: selectedOutcomeId,
    selectedDecision: input.selectedDecision,
    periodStartAgeInMonths: currentAgeInMonths,
    periodEndAgeInMonths: timelineAdvance.targetAgeInMonths,
    transactionId,
    previousWealth: input.currentAttributes.wealth,
    callAiJson
  });
  node = authoritativeFinance.node;
  node = sanitizeSimulationNodeFinancialNarrative(node, node.financialState!, node.financialLedger);
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
      reasonCodes: node.financialProcessingMeta.narrativeFallbackReasonCodes ?? ["FINANCIAL_COMPLETION_ROLLBACK"]
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
  node = sanitizeSimulationNodeFinancialNarrative(node, node.financialState!, node.financialLedger);
  const committedDebtNarrativeIssues = validateDebtNarrativeConsistency({
    description: node.description,
    debtHealthState: node.debtHealthState,
    ledger: node.financialLedger,
    allowExactServicingCount: true
  });
  if (committedDebtNarrativeIssues.length > 0) {
    throw new AiClientError("AI_RESPONSE_INVALID", committedDebtNarrativeIssues.join("；"));
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
  const reducedPressureArcTransition = reducePressureArc({
    currentArc: workingPressureArc,
    policy: pressureArcPolicy,
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
