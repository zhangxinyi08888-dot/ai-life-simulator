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
  "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven",
  "business_financing_recorded", "business_holding_revalued", "business_distribution_received",
  "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"
]);

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
  const relatedBusinessHoldingIds = [payload.businessHoldingId].filter((value): value is string => typeof value === "string" && value.length > 0);
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
  return {
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
      confidence: proposal.confidence
    }],
    acceptedByReasonCodes: ["SCHEMA", "OUTCOME_AUTHORITY", "SUBJECT", "TEMPORAL", evidenceReason, "ACCOUNTING_INVARIANTS"]
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
    if (proposal.kind === "business_financing_recorded" && payload.personalCashReceivedWan !== 0) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司融资不得进入个人现金", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "one_off_income_received" && ("businessHoldingId" in payload || "financingAmountWan" in payload)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司融资或公司营收不得伪装成个人一次性收入", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "income_source_started") {
      const linkedCareerStateId = payload.linkedCareerStateId;
      const isCareerIncome = ["salary", "self_employment_draw"].includes(String(payload.type));
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
        liquidityPolicy: input.liquidityPolicy
      });
      acceptedAfterTrial.push(...groupEvents);
    } catch (error) {
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
