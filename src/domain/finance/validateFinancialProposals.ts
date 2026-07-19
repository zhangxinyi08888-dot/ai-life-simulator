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
import { validateFinancialPayloadSchema } from "./financialProposalSchema";

const FINANCIAL_EVENT_KINDS = new Set<FinancialEventKind>([
  "income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended",
  "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended",
  "one_off_expense_paid", "asset_purchased", "asset_balance_discovered", "asset_sold", "asset_revalued", "debt_drawn", "debt_balance_discovered",
  "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven",
  "business_holding_started",
  "business_option_granted", "business_option_vested", "business_option_revalued",
  "business_option_exercised", "business_option_expired", "business_option_cancelled",
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
  const isHoldingPayload = input.proposal?.kind === "business_holding_started";
  const relatedBusinessHoldingIds = [payload.businessHoldingId, isHoldingPayload ? payload.id : undefined, payload.optionHolding?.id, payload.resultingEquityHolding?.id]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const safeSummary = String(input.summary || "财务 Proposal 校验失败")
    .replace(/\bundefined\b/gi, "缺失值")
    .replace(/\bnull\b/gi, "空值");
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
    summary: safeSummary,
    createdAtAgeInMonths: input.ageInMonths,
    ...(input.proposal?.kind === "income_source_adjusted" ? { pendingFactPolicy: "bounded_last_known_income" as const } : {})
  };
}

function typedReferenceIssue(input: { proposal: FinancialEventProposal; ledger: FinancialLedger; ageInMonths: number }): FinancialLedgerIssue | undefined {
  const payload = input.proposal.payload as Record<string, any>;
  const references: Array<{ id: unknown; label: string; ids: string[] }> = [];
  const activeCash = input.ledger.cashAccounts.filter((item) => item.status === "active").map((item) => item.id);
  const activeIncome = input.ledger.incomeSources.filter((item) => item.status !== "ended").map((item) => item.id);
  const activeExpenses = input.ledger.expenseCommitments.filter((item) => item.status !== "ended").map((item) => item.id);
  const activeAssets = input.ledger.assetAccounts.filter((item) => item.status !== "disposed").map((item) => item.id);
  const activeDebts = input.ledger.debtAccounts.filter((item) => item.status === "active" || item.status === "defaulted").map((item) => item.id);
  const activeHoldings = input.ledger.businessHoldings.filter((item) => item.status === "active" || item.status === "partially_sold").map((item) => item.id);
  if (["income_source_adjusted", "income_source_paused", "income_source_ended"].includes(input.proposal.kind)) references.push({ id: payload.incomeSourceId, label: "收入来源", ids: activeIncome });
  if (["expense_commitment_adjusted", "expense_commitment_ended"].includes(input.proposal.kind)) references.push({ id: payload.expenseCommitmentId, label: "支出义务", ids: activeExpenses });
  if (["asset_sold", "asset_revalued"].includes(input.proposal.kind)) references.push({ id: payload.assetAccountId, label: "资产账户", ids: activeAssets });
  if (["debt_principal_repaid", "debt_interest_paid", "debt_forgiven"].includes(input.proposal.kind)) references.push({ id: payload.debtAccountId, label: "债务账户", ids: activeDebts });
  if (input.proposal.kind === "debt_restructured") references.push({ id: payload.oldDebtAccountId, label: "债务账户", ids: activeDebts });
  if (["business_financing_recorded", "business_holding_revalued", "business_distribution_received", "business_holding_sold",
    "business_option_vested", "business_option_revalued", "business_option_exercised", "business_option_expired", "business_option_cancelled"
  ].includes(input.proposal.kind)) references.push({ id: payload.businessHoldingId, label: "企业持股", ids: activeHoldings });
  const destinationCashKinds: FinancialEventKind[] = ["one_off_income_received", "family_support_received", "asset_sold", "debt_drawn", "liquidity_shortfall_created", "business_distribution_received", "business_holding_sold"];
  const sourceCashKinds: FinancialEventKind[] = ["one_off_expense_paid", "family_support_paid", "asset_purchased", "debt_principal_repaid", "debt_interest_paid", "business_option_exercised"];
  if (destinationCashKinds.includes(input.proposal.kind)) references.push({ id: payload.destinationCashAccountId, label: "现金账户", ids: activeCash });
  if (sourceCashKinds.includes(input.proposal.kind) || (input.proposal.kind === "debt_restructured" && payload.sourceCashAccountId)) references.push({ id: payload.sourceCashAccountId, label: "现金账户", ids: activeCash });
  const invalid = references.find((reference) => typeof reference.id === "string" && !reference.ids.includes(reference.id));
  if (!invalid) return undefined;
  return proposalIssue({
    proposal: input.proposal,
    code: "ACCOUNT_TYPE_MISMATCH",
    summary: `${invalid.label} ID 类型错误或不存在：${String(invalid.id)}；合法候选：${invalid.ids.length ? invalid.ids.join("、") : "无可用候选"}`,
    ageInMonths: input.ageInMonths
  });
}

function businessOperatingFact(proposal: FinancialEventProposal): boolean {
  const payload = proposal.payload as Record<string, any>;
  const subject = proposal.kind === "expense_commitment_adjusted" ? payload.nextCommitment : payload;
  const text = `${proposal.evidence || ""} ${subject?.displayName || ""}`;
  const businessExpense = /(?:公司|团队|项目|门店|工作室|机构|中心)[^。；]{0,40}(?:工资|薪酬|人力成本|运营成本|服务器|市场推广|采购|办公成本|仓库|场地|审计费)|(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,30}(?:会计|员工|助理|工程师|销售|运营)[^。；]{0,20}(?:月薪|工资|薪酬)|(?:专职会计|员工|助理|工程师|销售|运营)[^。；]{0,16}(?:月薪|工资|薪酬)|(?:仓库|办公室|门店|场地)(?:月租|租金)|(?:团队工资|员工工资|助理补贴|企业运营)/u.test(text);
  const businessRevenue = /(?:公司|SaaS|产品|平台|客户合同|客户年费|工作室|机构|中心|基金会|协会|公益项目)[^。；]{0,45}(?:营收|收入|年费|回款|销售额|资助|拨款|赞助|项目款|首期款|可支配资金)|(?:订阅收入|公司月收入|项目营收|项目资助|项目拨款)/u.test(text);
  const explicitlyNegatedReceipt = /你(?:个人)?[^。；]{0,12}(?:没有|未|并未|不曾)[^。；]{0,12}(?:领取|获得|收到|分红|股息)/u.test(text);
  const isIncomeProposal = ["income_source_started", "income_source_adjusted", "one_off_income_received"].includes(proposal.kind);
  const explicitPersonal = isIncomeProposal && !explicitlyNegatedReceipt
    && /你(?:个人)?[^。；]{0,20}(?:领取|获得|收到|税后工资|月薪|年薪|顾问费|分红|股息)|转入(?:你的|个人)账户/u.test(text);
  const personalCompensation = ["salary", "contract", "self_employment_draw"].includes(String(subject?.type))
    && /(?:税后|到手)?(?:工资|薪资|月薪|年薪)|顾问费|咨询费/u.test(text);
  return (businessExpense || businessRevenue) && !explicitPersonal && !personalCompensation;
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
    const schemaErrors = validateFinancialPayloadSchema(proposal.kind, proposal.payload);
    if (schemaErrors.length > 0) {
      issues.push(proposalIssue({
        proposal,
        code: "UNBALANCED_TRANSACTION",
        summary: `财务 Proposal payload schema 无效：${schemaErrors.map((error) => `${error.path} ${error.reason}`).join("；")}`,
        ageInMonths: input.periodEndAgeInMonths
      }));
      continue;
    }
    const referenceIssue = typedReferenceIssue({ proposal, ledger: input.currentLedger, ageInMonths: proposal.effectiveAtAgeInMonths });
    if (referenceIssue) { issues.push(referenceIssue); continue; }
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
    const payload = proposal.payload as Record<string, unknown>;
    if (["expense_commitment_started", "expense_commitment_adjusted", "one_off_expense_paid"].includes(proposal.kind)
      && businessOperatingFact(proposal)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司团队工资或经营成本不得进入主人公个人支出账本", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (["income_source_started", "income_source_adjusted", "one_off_income_received"].includes(proposal.kind)
      && businessOperatingFact(proposal)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司营收、客户回款或产品年费不得进入主人公个人收入账本；只有个人工资、提款或已分配分红可以入账", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "income_source_started" && payload.type === "business_dividend"
      && !/分红|股息|利润分配|个人领取|转入个人/u.test(`${proposal.evidence} ${String(payload.displayName || "")}`)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "business_dividend 必须有已向主人公分配利润的证据，不能用公司年费或营收替代", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    const evidenceMatch = matchFinancialEvidence({ proposal, narrativeText: input.narrativeText });
    if (!evidenceMatch.matched || !evidenceMatch.reasonCode || !Number.isFinite(proposal.confidence) || proposal.confidence < 0.6 || proposal.confidence > 1) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 缺少可靠正文证据或 confidence", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "expense_commitment_started") {
      const durableType = String(payload.type);
      const existingSameType = input.currentLedger.expenseCommitments.filter((item) => item.status === "active" && item.type === durableType);
      const onlyPolicyEstimate = existingSameType.length > 0 && existingSameType.every((item) => item.evidence.some((evidence) => evidence.source === "system_policy"
        || (evidence.source === "legacy_migration" && evidence.reasonCode === "LEGACY_FINANCIAL_STATE_MIGRATION")));
      if (["basic_living", "housing"].includes(durableType)
        && existingSameType.length > 0 && !onlyPolicyEstimate) {
        issues.push(proposalIssue({
          proposal,
          code: "UNBALANCED_TRANSACTION",
          summary: `持续支出 ${durableType} 已存在，必须引用现有支出 ID 使用 expense_commitment_adjusted，不能重复 started`,
          ageInMonths: proposal.effectiveAtAgeInMonths
        }));
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
      if (!(error instanceof FinancialLedgerInvariantError)) throw error;
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
