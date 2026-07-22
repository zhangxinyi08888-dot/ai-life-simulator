import type { CareerState } from "../career/types";
import { FinancialLedgerInvariantError } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { LiquidityPolicy } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEventProposal,
  FinancialLedger,
  FinancialLedgerIssue
} from "./types";
import { matchFinancialEvidence, type EvidenceMatchReason } from "./evidenceMatching";

const FINANCIAL_EVENT_KINDS = new Set<FinancialEventKind>([
  "income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended",
  "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended",
  "one_off_expense_paid", "asset_purchased", "asset_sold", "asset_revalued", "debt_drawn",
  "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven", "debt_default_recorded",
  "business_holding_started", "business_financing_recorded", "business_holding_revalued", "business_distribution_received",
  "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"
]);
const ASSET_TYPES = new Set(["investment", "property", "annuity", "insurance_cash_value", "other_personal_asset"]);
const PERSONAL_INCOME_SOURCE_TYPES = new Set(["salary", "contract", "self_employment_draw", "rent", "pension", "annuity_payment", "royalty", "investment_distribution", "business_dividend", "family_support", "other"]);
const PERSONAL_OPERATING_FLOW_KINDS = new Set<FinancialEventKind>([
  "income_source_started",
  "income_source_adjusted",
  "income_source_paused",
  "income_source_ended",
  "one_off_income_received",
  "expense_commitment_started",
  "expense_commitment_adjusted",
  "expense_commitment_ended",
  "one_off_expense_paid"
]);

function personalCareerIncomeEvidenceIsExplicit(type: unknown, evidence: string): boolean {
  if (!["salary", "contract", "self_employment_draw", "business_dividend"].includes(String(type))) return true;
  if (String(type) === "self_employment_draw" || String(type) === "business_dividend") {
    return /(?:你|我|主角|本人).{0,80}(?:领取|提取|获得|收到|赚|挣|顾问费|咨询收入|转入个人|给自己发|个人可支配收入|个人收入|个人提款|个人账户|工资|薪资|降薪|涨薪|调薪|业主提款|分红)/u.test(evidence);
  }
  return /(?:你|我|主角|本人).{0,80}(?:领取|获得|收到|赚|挣|顾问费|咨询收入|月薪|年薪|工资|薪资|降薪|涨薪|调薪|报酬|个人收入|个人进账|个人账户|可支配收入)/u.test(evidence);
}

function proposalIssue(input: {
  proposal?: FinancialEventProposal;
  code: FinancialLedgerIssue["code"];
  summary: string;
  ageInMonths: number;
  severity?: FinancialLedgerIssue["severity"];
}): FinancialLedgerIssue {
  const payload = input.proposal?.payload && typeof input.proposal.payload === "object"
    ? input.proposal.payload as Record<string, any>
    : {};
  const relatedIncomeSourceIds = [payload.incomeSourceId, payload.nextSource?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
  const relatedAccountIds = [payload.sourceCashAccountId, payload.destinationCashAccountId, payload.assetAccountId, payload.assetAccount?.id, payload.expenseCommitmentId, payload.nextCommitment?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
  const relatedDebtAccountIds = [payload.debtAccountId, payload.oldDebtAccountId, payload.debtAccount?.id, payload.replacementDebtAccount?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
  const relatedBusinessHoldingIds = [payload.businessHoldingId, payload.businessHolding?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
  return {
    id: `proposal_issue_${input.proposal?.id || input.code}_${input.ageInMonths}`,
    code: input.code,
    severity: input.severity || "blocking",
    status: "open",
    relatedProposalIds: input.proposal ? [input.proposal.id] : [],
    relatedAccountIds,
    relatedIncomeSourceIds,
    relatedDebtAccountIds,
    relatedBusinessHoldingIds,
    summary: input.summary,
    createdAtAgeInMonths: input.ageInMonths
  };
}

function markEstimatedFacts<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(markEstimatedFacts) as T;
  const clone = structuredClone(value) as Record<string, unknown>;
  if ("factStatus" in clone) clone.factStatus = "estimated";
  for (const [key, child] of Object.entries(clone)) {
    if (key !== "evidence") clone[key] = markEstimatedFacts(child);
  }
  return clone as T;
}

function acceptedEvent(proposal: FinancialEventProposal, evidenceReason: EvidenceMatchReason): AcceptedFinancialEvent {
  const payload = proposal.confidence < 0.8
    ? markEstimatedFacts(proposal.payload)
    : structuredClone(proposal.payload);
  const event = {
    id: `accepted_${proposal.id}`,
    proposalId: proposal.id,
    kind: proposal.kind,
    effectiveAtAgeInMonths: proposal.effectiveAtAgeInMonths,
    payload: payload as FinancialEventPayloadMap[FinancialEventKind],
    evidence: [{
      source: "accepted_simulation_outcome",
      sourceEventId: proposal.sourceOutcomeId,
      excerpt: proposal.evidence.trim(),
      reasonCode: evidenceReason,
      confidence: proposal.confidence,
      financialScope: proposal.financialScope ?? "personal"
    }],
    acceptedByReasonCodes: ["SCHEMA", "OUTCOME_AUTHORITY", "SUBJECT", "TEMPORAL", evidenceReason, "ACCOUNTING_INVARIANTS"]
  } as AcceptedFinancialEvent;
  if (event.kind === "asset_purchased") {
    const account = event.payload.assetAccount;
    if (!Array.isArray(account.evidence) || account.evidence.length === 0) {
      account.evidence = structuredClone(event.evidence);
    }
  }
  if (event.kind === "business_holding_started") {
    const holding = event.payload.businessHolding;
    if (!Array.isArray(holding.evidence) || holding.evidence.length === 0) holding.evidence = structuredClone(event.evidence);
    if (!Array.isArray(holding.business.evidence) || holding.business.evidence.length === 0) holding.business.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "business_holding_revalued" && (!Array.isArray(event.payload.valuationEvidence) || event.payload.valuationEvidence.length === 0)) {
    event.payload.valuationEvidence = structuredClone(event.evidence);
  }
  if (event.kind === "income_source_started" && (!Array.isArray(event.payload.evidence) || event.payload.evidence.length === 0)) {
    event.payload.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "income_source_adjusted" && (!Array.isArray(event.payload.nextSource.evidence) || event.payload.nextSource.evidence.length === 0)) {
    event.payload.nextSource.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "expense_commitment_started" && (!Array.isArray(event.payload.evidence) || event.payload.evidence.length === 0)) {
    event.payload.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "expense_commitment_adjusted" && (!Array.isArray(event.payload.nextCommitment.evidence) || event.payload.nextCommitment.evidence.length === 0)) {
    event.payload.nextCommitment.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "debt_drawn" || event.kind === "liquidity_shortfall_created") {
    const account = event.payload.debtAccount;
    if (!Array.isArray(account.evidence) || account.evidence.length === 0) {
      account.evidence = structuredClone(event.evidence);
    }
  }
  if (event.kind === "debt_restructured") {
    const account = event.payload.replacementDebtAccount;
    if (!Array.isArray(account.evidence) || account.evidence.length === 0) {
      account.evidence = structuredClone(event.evidence);
    }
  }
  return event;
}

/**
 * Automatic liquidity is an exception for an expense that the narrative says
 * has already happened and that cannot reasonably be cancelled.  The model
 * cannot opt into this path: the marker is added only after ordinary evidence
 * matching and the first explicit-funding trial have both run.
 *
 * Keep this deliberately conservative. Generic consumption and future intent
 * are repairable proposals, not system-authorised borrowing.
 */
function isIncurredEssentialOneOffExpense(
  proposal: FinancialEventProposal,
  narrativeText: string
): boolean {
  if (proposal.kind !== "one_off_expense_paid") return false;
  const evidence = proposal.evidence.trim();
  if (!evidence || !matchFinancialEvidence({ proposal, narrativeText }).matched) return false;

  const isAttemptOrFuture = /(?:尝试|试图|打算|计划|准备|考虑|申请|协商|报价|预算|尚未|还未|未能|没有|取消|可退|attempt|plan|intend|consider|apply|negotiate|not yet|cancel)/iu.test(evidence);
  if (isAttemptOrFuture) return false;
  const isCompleted = /(?:已经|已(?:经)?(?:支付|缴纳|结清|发生|产生|接受|完成)|支付了|缴纳了|花费了|住院|急诊|手术|治疗|抢救|丧葬|paid|incurred|completed|underwent|hospitali[sz]ed)/iu.test(evidence);
  const isEssential = /(?:必要|必需|无法撤回|不可撤回|医疗|医药|治疗|住院|急诊|手术|抢救|护理|丧葬|基本住房|房租|学费|教育|保险|抚养|赡养|essential|necessary|unavoidable|medical|hospital|surgery|funeral|tuition|insurance|dependent care)/iu.test(evidence);
  return isCompleted && isEssential;
}

function markSystemShortfallAllowed(event: AcceptedFinancialEvent): AcceptedFinancialEvent {
  return {
    ...event,
    // This field is intentionally absent from Proposal. It is validator-owned.
    liquidityTreatment: "allow_system_shortfall",
    acceptedByReasonCodes: [...event.acceptedByReasonCodes, "INCURRED_ESSENTIAL_EXPENSE"]
  } as AcceptedFinancialEvent;
}

function dependentProposalIds(proposal: FinancialEventProposal): string[] {
  const payload = proposal.payload as Record<string, unknown> | undefined;
  if (proposal.kind === "asset_purchased" && typeof payload?.linkedDebtDrawEventId === "string") {
    return [payload.linkedDebtDrawEventId];
  }
  return [];
}

function proposalGroups(proposals: FinancialEventProposal[], ledger: FinancialLedger): FinancialEventProposal[][] {
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const parent = new Map(proposals.map((proposal) => [proposal.id, proposal.id]));
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const proposal of proposals) {
    for (const dependencyId of dependentProposalIds(proposal)) {
      if (byId.has(dependencyId)) union(proposal.id, dependencyId);
    }
  }
  const activeCareerIncomeIds = new Set(ledger.incomeSources
    .filter((source) => source.status === "active" && Boolean(source.linkedCareerStateId))
    .map((source) => source.id));
  const wageStarts = proposals.filter((proposal) => proposal.kind === "income_source_started" && ["salary", "contract", "self_employment_draw"].includes(String((proposal.payload as Record<string, unknown>)?.type)));
  const careerIncomeClosures = proposals.filter((proposal) => (
    (proposal.kind === "income_source_ended" || proposal.kind === "income_source_paused")
    && activeCareerIncomeIds.has(String((proposal.payload as Record<string, unknown>)?.incomeSourceId))
  ));
  for (const start of wageStarts) {
    for (const closure of careerIncomeClosures) union(start.id, closure.id);
  }
  const grouped = new Map<string, FinancialEventProposal[]>();
  for (const proposal of proposals) {
    const root = find(proposal.id);
    grouped.set(root, [...(grouped.get(root) || []), proposal]);
  }
  const priority = (proposal: FinancialEventProposal) => proposal.kind === "debt_drawn" || proposal.kind === "liquidity_shortfall_created" ? 0 : 1;
  return [...grouped.values()]
    .map((group) => [...group].sort((left, right) => priority(left) - priority(right)))
    .sort((left, right) => {
      const ageDifference = Math.min(...left.map((proposal) => proposal.effectiveAtAgeInMonths))
        - Math.min(...right.map((proposal) => proposal.effectiveAtAgeInMonths));
      if (ageDifference !== 0) return ageDifference;
      return Math.min(...left.map(priority)) - Math.min(...right.map(priority));
    });
}

export function validateFinancialProposals(input: {
  proposals: FinancialEventProposal[];
  currentLedger: FinancialLedger;
  currentCareerState: CareerState;
  acceptedOutcomeId?: string;
  narrativeText: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  simulationTransactionId: string;
  allowedCareerStateIds?: string[];
  liquidityPolicy?: LiquidityPolicy;
}): { acceptedEvents: AcceptedFinancialEvent[]; issues: FinancialLedgerIssue[] } {
  const issues: FinancialLedgerIssue[] = [];
  const acceptedEvents: AcceptedFinancialEvent[] = [];
  const acceptedProposals: FinancialEventProposal[] = [];
  const ids = new Set<string>();
  const allowedCareerStateIds = new Set([input.currentCareerState.id, ...(input.allowedCareerStateIds || [])]);

  for (const proposal of input.proposals) {
    if (!proposal.id || ids.has(proposal.id) || !FINANCIAL_EVENT_KINDS.has(proposal.kind) || !proposal.payload || typeof proposal.payload !== "object") {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal schema 无效或 id 重复", ageInMonths: input.periodEndAgeInMonths }));
      continue;
    }
    ids.add(proposal.id);
    if (!input.acceptedOutcomeId || proposal.sourceOutcomeId !== input.acceptedOutcomeId) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 未关联本轮已接受结果", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (!Number.isInteger(proposal.effectiveAtAgeInMonths)
      || proposal.effectiveAtAgeInMonths < input.periodStartAgeInMonths
      || proposal.effectiveAtAgeInMonths > input.periodEndAgeInMonths) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 生效时间不在本阶段内", ageInMonths: input.periodEndAgeInMonths }));
      continue;
    }
    const evidenceMatch = matchFinancialEvidence({ proposal, narrativeText: input.narrativeText });
    if (!evidenceMatch.matched || !evidenceMatch.reasonCode || !Number.isFinite(proposal.confidence) || proposal.confidence < 0.6 || proposal.confidence > 1) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 缺少可靠正文证据或 confidence", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    const payload = proposal.payload as Record<string, unknown>;
    if (proposal.financialScope === "business_operating" && PERSONAL_OPERATING_FLOW_KINDS.has(proposal.kind)) {
      issues.push(proposalIssue({
        proposal,
        code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
        summary: "公司营业收入、员工工资和运营成本不得作为主角个人收支入账",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (proposal.kind === "asset_purchased") {
      const assetAccount = payload.assetAccount as Record<string, unknown> | undefined;
      if (!assetAccount || !ASSET_TYPES.has(String(assetAccount.type))) {
        issues.push(proposalIssue({ proposal, code: "INVALID_ASSET_TYPE", summary: "资产购买包含不受支持的资产类型", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
    }
    if (proposal.kind === "business_financing_recorded" && payload.personalCashReceivedWan !== 0) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司融资不得进入个人现金", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "one_off_income_received" && ("businessHoldingId" in payload || "financingAmountWan" in payload)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司融资或公司营收不得伪装成个人一次性收入", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "income_source_started") {
      if (!PERSONAL_INCOME_SOURCE_TYPES.has(String(payload.type))) {
        issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司营业收入类型不能进入个人收入来源账本", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      const linkedCareerStateId = payload.linkedCareerStateId;
      const isCareerIncome = ["salary", "self_employment_draw"].includes(String(payload.type));
      if (!personalCareerIncomeEvidenceIsExplicit(payload.type, proposal.evidence)) {
        issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司合同额或营业收入不能证明主角已经领取个人工资、提款或分红", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      if (isCareerIncome && typeof linkedCareerStateId !== "string") {
        issues.push(proposalIssue({ proposal, code: "CAREER_INCOME_CONFLICT", summary: "职业收入来源必须引用当前或本轮已接受的 CareerState", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      if (typeof linkedCareerStateId === "string" && !allowedCareerStateIds.has(linkedCareerStateId)) {
        issues.push(proposalIssue({ proposal, code: "CAREER_INCOME_CONFLICT", summary: "收入来源引用了非当前或未接受的 CareerState", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      if (isCareerIncome) {
        const activeCareerSources = input.currentLedger.incomeSources.filter((source) => source.status === "active" && Boolean(source.linkedCareerStateId));
        const replacedSourceIds = new Set(input.proposals.flatMap((candidate) => {
          if (candidate.kind === "income_source_ended" || candidate.kind === "income_source_paused") {
            const id = (candidate.payload as Record<string, unknown>)?.incomeSourceId;
            return typeof id === "string" ? [id] : [];
          }
          if (candidate.kind === "income_source_adjusted") {
            const id = (candidate.payload as Record<string, unknown>)?.incomeSourceId;
            return typeof id === "string" ? [id] : [];
          }
          return [];
        }));
        const unreplaced = activeCareerSources.filter((source) => !replacedSourceIds.has(source.id));
        if (unreplaced.length > 0) {
          issues.push(proposalIssue({
            proposal,
            code: "CAREER_INCOME_CONFLICT",
            summary: `新职业收入不得与旧职业收入叠加；请调整或结束：${unreplaced.map((source) => source.id).join("、")}`,
            ageInMonths: proposal.effectiveAtAgeInMonths
          }));
          continue;
        }
      }
    }
    if (proposal.kind === "income_source_adjusted"
      && !personalCareerIncomeEvidenceIsExplicit((payload.nextSource as Record<string, unknown> | undefined)?.type, proposal.evidence)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司合同额或营业收入不能证明主角个人收入已经调整", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "income_source_adjusted"
      && !PERSONAL_INCOME_SOURCE_TYPES.has(String((payload.nextSource as Record<string, unknown> | undefined)?.type))) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司营业收入类型不能进入个人收入来源账本", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    const amount = typeof payload.amountWan === "number" ? payload.amountWan : 0;
    const plausibilityLimit = Math.max(100, Math.abs(input.currentLedger.cashAccounts.reduce((sum, account) => sum + account.balanceWan, 0)) * 5);
    if ((proposal.kind === "one_off_income_received" || proposal.kind === "one_off_expense_paid") && amount > plausibilityLimit) {
      issues.push(proposalIssue({ proposal, code: "UNSUPPORTED_LARGE_VALUE_CHANGE", summary: "通用一次性金额远超当前账本规模，需要更具体的资产、债务或企业事件", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    acceptedEvents.push(acceptedEvent(proposal, evidenceMatch.reasonCode));
    acceptedProposals.push(proposal);
  }

  const candidatesByProposalId = new Map(acceptedEvents.map((event) => [event.proposalId!, event]));
  const acceptedAfterTrial: AcceptedFinancialEvent[] = [];
  for (const group of proposalGroups(acceptedProposals, input.currentLedger)) {
    const groupEvents = group.map((proposal) => candidatesByProposalId.get(proposal.id)!);
    try {
      reduceFinancialLedger({
        ledger: input.currentLedger,
        transactionId: `validation_${input.simulationTransactionId}_${acceptedAfterTrial.length}`,
        expectedLedgerRevision: input.currentLedger.revision,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths,
        events: [...acceptedAfterTrial, ...groupEvents],
        // Proposal trials are always strict. Production's broad liquidity
        // policy must never make an unfunded model proposal appear valid.
        liquidityPolicy: "require_explicit"
      });
      acceptedAfterTrial.push(...groupEvents);
    } catch (error) {
      const missingFunding = error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE";
      const mayUseSystemShortfall = missingFunding
        && group.length > 0
        && group.every((proposal) => isIncurredEssentialOneOffExpense(proposal, input.narrativeText));
      if (mayUseSystemShortfall) {
        const markedEvents = groupEvents.map(markSystemShortfallAllowed);
        try {
          reduceFinancialLedger({
            ledger: input.currentLedger,
            transactionId: `validation_essential_${input.simulationTransactionId}_${acceptedAfterTrial.length}`,
            expectedLedgerRevision: input.currentLedger.revision,
            periodStartAgeInMonths: input.periodStartAgeInMonths,
            periodEndAgeInMonths: input.periodEndAgeInMonths,
            events: [...acceptedAfterTrial, ...markedEvents],
            liquidityPolicy: "auto_shortfall_debt"
          });
          acceptedAfterTrial.push(...markedEvents);
          continue;
        } catch (secondTrialError) {
          error = secondTrialError;
        }
      }
      const code = error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE"
        ? "MISSING_FUNDING_SOURCE"
        : "UNBALANCED_TRANSACTION";
      for (const proposal of group) {
        issues.push(proposalIssue({
          proposal,
          code,
          summary: error instanceof Error ? error.message : "财务 Proposal 账本试算失败",
          ageInMonths: input.periodEndAgeInMonths
        }));
      }
    }
  }
  return { acceptedEvents: acceptedAfterTrial, issues };
}
