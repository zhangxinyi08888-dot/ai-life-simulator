import type { DebtHealthLevel, DebtHealthState } from "../domain/finance/debtHealth";
import { totalCashWan, totalDebtWan } from "../domain/finance/ledgerMath";
import type { FinancialEventKind, FinancialLedger } from "../domain/finance/types";
import type { SimulationNode } from "../types";

export const DEBT_NARRATIVE_AUTHORITY_VERSION = "debt_narrative_v1" as const;

export type InstitutionActionKind =
  | "payment_reminder"
  | "documents_requested"
  | "negotiation_invited"
  | "internal_account_review"
  | "restructuring_approved"
  | "formal_collection"
  | "legal_action"
  | "credit_reporting";

export type DebtNarrativeFactKind =
  | "debt_outstanding"
  | "payments_current"
  | "missed_payments_continue"
  | "cash_exhausted"
  | "formal_default_recorded"
  | "debt_increased_from_shortfall"
  | "debt_recovered_from_surplus"
  | "debt_principal_repaid"
  | "debt_interest_accrued";

export type DebtNarrativeTimelineFactKind = "payment_paid" | "payment_partial" | "payment_missed";

export interface DebtNarrativeFact {
  id: string;
  kind: DebtNarrativeFactKind;
  text: string;
}

export interface DebtNarrativeTimelineFact {
  id: string;
  ageInMonths: number;
  kind: DebtNarrativeTimelineFactKind;
  debtAccountId: string;
}

export interface DebtDeltaBreakdown {
  openingDebtWan: number;
  closingDebtWan: number;
  drawsWan: number;
  balanceDiscoveredWan: number;
  automaticShortfallIncreaseWan: number;
  currentInterestAccruedWan: number;
  principalPaidWan: number;
  interestLiabilityPaidWan: number;
  forgivenWan: number;
  automaticShortfallRecoveryWan: number;
  unexplainedDeltaWan: number;
}

export interface DebtNarrativeAuthority {
  version: typeof DEBT_NARRATIVE_AUTHORITY_VERSION;
  asOfAgeInMonths: number;
  lifecycle: "current" | "delinquent" | "defaulted";
  healthLevel: DebtHealthLevel;
  consecutiveMissedPaymentMonths: number;
  permittedInstitutionActions: InstitutionActionKind[];
  acceptedCompletedEventKinds: FinancialEventKind[];
  canonicalFacts: DebtNarrativeFact[];
  timeline: DebtNarrativeTimelineFact[];
  deltaBreakdown: DebtDeltaBreakdown;
}

export type DebtNarrativeSurface =
  | "description"
  | "choice.text"
  | "choice.impactSummary"
  | "choice.decisionIntent"
  | "storyEpisode.summary"
  | "storyEpisode.internalTransition"
  | "arcSignal.evidence";

export interface DebtNarrativeSurfaceIssue {
  surface: DebtNarrativeSurface;
  path?: string;
  reasonCode:
    | "UNAUTHORIZED_COLLECTION"
    | "UNAUTHORIZED_LEGAL_ACTION"
    | "UNAUTHORIZED_CREDIT_CONSEQUENCE"
    | "UNAUTHORIZED_PENALTY"
    | "FALSE_FIRST_DELINQUENCY"
    | "MISMATCHED_MISSED_PAYMENT_COUNT"
    | "MISMATCHED_DEBT_AMOUNT"
    | "UNACCEPTED_DEBT_COMPLETION"
    | "UNACCEPTED_ARREARS_CATCHUP"
    | "UNACCEPTED_RESTRUCTURE_COMPLETION"
    | "DENIED_EXISTING_DEBT"
    | "DEBT_STIGMA";
  text: string;
}

function formatWan(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function sumTransactions(ledger: FinancialLedger, periodStartAgeInMonths: number) {
  return ledger.recentTransactions.filter((transaction) => (
    transaction.periodEndAgeInMonths > periodStartAgeInMonths
    && transaction.periodEndAgeInMonths <= ledger.asOfAgeInMonths
  ));
}

function deriveDebtDeltaBreakdown(ledger: FinancialLedger, periodStartAgeInMonths: number): DebtDeltaBreakdown {
  const transactions = sumTransactions(ledger, periodStartAgeInMonths);
  const sum = (field: keyof typeof transactions[number]) => transactions.reduce((total, transaction) => {
    const value = transaction[field];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  const closingDebtWan = totalDebtWan(ledger);
  const actualDeltaWan = Number(sum("debtDeltaWan").toFixed(4));
  const totalDrawnWan = sum("debtPrincipalDrawnWan");
  const balanceDiscoveredWan = sum("debtBalanceDiscoveredWan");
  const automaticShortfallIncreaseWan = sum("automaticLiquidityShortfallIncreaseWan");
  const automaticShortfallRecoveryWan = sum("automaticLiquidityShortfallRecoveryWan");
  const totalPrincipalPaidWan = sum("debtPrincipalPaidWan");
  const drawsWan = Math.max(0, totalDrawnWan - automaticShortfallIncreaseWan);
  const principalPaidWan = Math.max(0, totalPrincipalPaidWan - automaticShortfallRecoveryWan);
  const currentInterestAccruedWan = sum("debtInterestAccruedWan");
  const interestLiabilityPaidWan = sum("debtInterestLiabilityPaidWan");
  const forgivenWan = sum("debtPrincipalForgivenWan") + sum("debtInterestForgivenWan");
  const explainedDeltaWan = drawsWan
    + balanceDiscoveredWan
    + automaticShortfallIncreaseWan
    + currentInterestAccruedWan
    - principalPaidWan
    - interestLiabilityPaidWan
    - forgivenWan
    - automaticShortfallRecoveryWan;
  return {
    openingDebtWan: Number((closingDebtWan - actualDeltaWan).toFixed(4)),
    closingDebtWan,
    drawsWan: Number(drawsWan.toFixed(4)),
    balanceDiscoveredWan: Number(balanceDiscoveredWan.toFixed(4)),
    automaticShortfallIncreaseWan: Number(automaticShortfallIncreaseWan.toFixed(4)),
    currentInterestAccruedWan: Number(currentInterestAccruedWan.toFixed(4)),
    principalPaidWan: Number(principalPaidWan.toFixed(4)),
    interestLiabilityPaidWan: Number(interestLiabilityPaidWan.toFixed(4)),
    forgivenWan: Number(forgivenWan.toFixed(4)),
    automaticShortfallRecoveryWan: Number(automaticShortfallRecoveryWan.toFixed(4)),
    unexplainedDeltaWan: Number((actualDeltaWan - explainedDeltaWan).toFixed(4))
  };
}

function lifecycleOf(ledger: FinancialLedger, debtHealthState: DebtHealthState): DebtNarrativeAuthority["lifecycle"] {
  if (ledger.debtAccounts.some((account) => account.status === "defaulted")) return "defaulted";
  if (debtHealthState.consecutiveMissedPaymentMonths > 0
    || ledger.debtAccounts.some((account) => account.servicingStatus === "partial" || account.servicingStatus === "missed" || account.servicingStatus === "delinquent")) {
    return "delinquent";
  }
  return "current";
}

export function deriveDebtNarrativeAuthority(input: {
  ledger: FinancialLedger;
  debtHealthState: DebtHealthState;
  periodStartAgeInMonths?: number;
  acceptedCompletedEventKinds?: FinancialEventKind[];
}): DebtNarrativeAuthority {
  const { ledger, debtHealthState } = input;
  const lifecycle = lifecycleOf(ledger, debtHealthState);
  const debtWan = totalDebtWan(ledger);
  const missed = debtHealthState.consecutiveMissedPaymentMonths;
  const periodStart = input.periodStartAgeInMonths ?? ledger.asOfAgeInMonths;
  const deltaBreakdown = deriveDebtDeltaBreakdown(ledger, periodStart);
  const canonicalFacts: DebtNarrativeFact[] = [];
  if (debtWan > 0) {
    canonicalFacts.push({
      id: `debt_fact_outstanding_${ledger.revision}`,
      kind: "debt_outstanding",
      text: `到这一阶段结束时，你仍有${formatWan(debtWan)}万元个人债务需要处理。`
    });
  }
  if (missed > 0) {
    canonicalFacts.push({
      id: `debt_fact_missed_${ledger.revision}`,
      kind: "missed_payments_continue",
      text: `这段时间里，连续${missed}个月未能足额偿付的情况仍在持续。`
    });
  } else if (debtWan > 0) {
    canonicalFacts.push({
      id: `debt_fact_current_${ledger.revision}`,
      kind: "payments_current",
      text: "这段时间没有出现未足额偿付记录。"
    });
  }
  if (totalCashWan(ledger) <= 0) {
    canonicalFacts.push({
      id: `debt_fact_cash_exhausted_${ledger.revision}`,
      kind: "cash_exhausted",
      text: "到这一阶段结束时，可用现金已经降至零。"
    });
  }
  if (lifecycle === "defaulted") {
    canonicalFacts.push({
      id: `debt_fact_formal_default_${ledger.revision}`,
      kind: "formal_default_recorded",
      text: "正式违约已经被记录。"
    });
  }
  if (deltaBreakdown.automaticShortfallIncreaseWan > 0) {
    canonicalFacts.push({
      id: `debt_fact_shortfall_increase_${ledger.revision}`,
      kind: "debt_increased_from_shortfall",
      text: `必要支出超过可用现金后，有${formatWan(deltaBreakdown.automaticShortfallIncreaseWan)}万元现金缺口转入了待处理债务。`
    });
  }
  if (deltaBreakdown.automaticShortfallRecoveryWan > 0) {
    canonicalFacts.push({
      id: `debt_fact_shortfall_recovery_${ledger.revision}`,
      kind: "debt_recovered_from_surplus",
      text: `保留基本生活缓冲后，你用${formatWan(deltaBreakdown.automaticShortfallRecoveryWan)}万元结余回补了此前的现金缺口。`
    });
  }
  if (deltaBreakdown.principalPaidWan > 0) {
    canonicalFacts.push({
      id: `debt_fact_principal_paid_${ledger.revision}`,
      kind: "debt_principal_repaid",
      text: `这段时间实际偿还了${formatWan(deltaBreakdown.principalPaidWan)}万元本金。`
    });
  }
  if (deltaBreakdown.currentInterestAccruedWan > 0) {
    canonicalFacts.push({
      id: `debt_fact_interest_accrued_${ledger.revision}`,
      kind: "debt_interest_accrued",
      text: `这段时间按已确认条款计提了${formatWan(deltaBreakdown.currentInterestAccruedWan)}万元利息。`
    });
  }
  const timeline = ledger.recentTransactions
    .flatMap((transaction) => transaction.debtServiceRecords ?? [])
    .filter((record) => record.ageInMonths > periodStart && record.ageInMonths <= ledger.asOfAgeInMonths)
    .sort((left, right) => left.ageInMonths - right.ageInMonths || left.id.localeCompare(right.id))
    .map((record): DebtNarrativeTimelineFact => ({
      id: `debt_timeline_${record.id}`,
      ageInMonths: record.ageInMonths,
      kind: record.outcome === "paid" ? "payment_paid" : record.outcome === "partial" ? "payment_partial" : "payment_missed",
      debtAccountId: record.debtAccountId
    }));

  const permittedInstitutionActions: InstitutionActionKind[] = lifecycle === "defaulted"
    ? ["payment_reminder", "documents_requested", "negotiation_invited", "internal_account_review"]
    : ["payment_reminder", "documents_requested", "negotiation_invited", "internal_account_review"];
  const acceptedCompletedEventKinds = [...new Set(input.acceptedCompletedEventKinds ?? [])];
  if (acceptedCompletedEventKinds.includes("debt_restructured")) permittedInstitutionActions.push("restructuring_approved");

  return {
    version: DEBT_NARRATIVE_AUTHORITY_VERSION,
    asOfAgeInMonths: ledger.asOfAgeInMonths,
    lifecycle,
    healthLevel: debtHealthState.level,
    consecutiveMissedPaymentMonths: missed,
    permittedInstitutionActions,
    acceptedCompletedEventKinds,
    canonicalFacts,
    timeline,
    deltaBreakdown
  };
}

export function formatDebtNarrativeAuthorityForPrompt(
  ledger?: FinancialLedger,
  debtHealthState?: DebtHealthState
): string {
  if (!ledger || !debtHealthState || debtHealthState.source !== "authoritative_ledger") {
    return "- authority unavailable：不得生成任何正式违约、催收、法律行动、征信后果或重组完成事实。";
  }
  const authority = deriveDebtNarrativeAuthority({ ledger, debtHealthState });
  return JSON.stringify({
    version: authority.version,
    lifecycle: authority.lifecycle,
    healthLevel: authority.healthLevel,
    permittedInstitutionActions: authority.permittedInstitutionActions,
    canonicalFacts: authority.canonicalFacts.map(({ id, kind, text }) => ({ id, kind, text })),
    instruction: "银行行为和偿付事实只能使用 canonicalFacts 或 permittedInstitutionActions；未列出的外部后果一律不得生成。"
  }, null, 2);
}

const COLLECTION_PATTERN = /催收|贷后处置(?:团队|部门)|资产保全(?:团队|部门)|清收(?:团队|部门)|上门追债/u;
const LEGAL_PATTERN = /法务|诉讼|起诉|查封|拍卖|强制处置|法院传票|司法程序/u;
const CREDIT_PATTERN = /上报征信|报送征信|征信受损|征信记录.{0,12}(?:产生|留下|出现|影响)|影响未来(?:信贷|贷款)|信用评分(?:下降|降低)|贷款资格.{0,8}(?:受限|被拒)/u;
const PENALTY_PATTERN = /罚息|复利/u;
const FIRST_DELINQUENCY_PATTERN = /第一次.{0,12}(?:逾期|拖欠)|首次.{0,12}(?:逾期|拖欠)|刚开始.{0,12}(?:逾期|拖欠)/u;
const RESTRUCTURE_COMPLETED_PATTERN = /重组协议.{0,10}(?:签署|生效)|(?:债务|贷款|房贷)?重组(?:方案|安排|协议)?(?:已经|已)?生效|还款方式(?:已经|已)?改为|期限(?:已经|已)?延长|银行(?:已经|已)?(?:批准|同意).{0,16}(?:展期|重组|先息后本|宽限期)/u;
const DEBT_COMPLETED_PATTERN = /(?:还清|结清)(?:了|全部|所有)?(?:房贷|贷款|债务|欠款)?|(?:房贷|贷款|债务|欠款)(?:已经|已)?清零|清偿完毕|无债一身轻|不再欠债/u;
const ARREARS_CATCHUP_PATTERN = /补(?:上|齐)(?:了)?[^。！？]{0,24}(?:欠款|欠下的月供|逾期款|房贷|月供|还款差额|房贷差额|月供差额)|(?:欠款|欠下的月供|逾期款|房贷差额|月供差额)[^。！？]{0,16}补(?:上|齐)(?:了)?/u;
const STIGMA_PATTERN = /彻底失败|人生失败|信用破产/u;
const DENIED_DEBT_PATTERN = /(?:没有|并未|未曾|拒绝)(?:[^。！？]{0,16})(?:申请|办理|接受|背负)(?:[^。！？]{0,12})(?:贷款|借款)|(?:没有|无)(?:任何)?(?:个人)?(?:债务|负债)|债务为零|零负债/u;
const EXACT_MISSED_PATTERN = /连续(\d+)个?月(?:未还|逾期|拖欠|未足额偿还|未足额支付|未足额偿付|未能足额偿还|未能足额支付|未能足额偿付)/gu;
const EXACT_TOTAL_DEBT_PATTERN = /(?:个人(?:总)?|累计|当前|总计|整体|这笔)?(?:总)?(?:债务|负债)(?:余额)?(?:约|为|达到|升至|增加到|降到|降至|减少到|减少至|还有)?\s*(\d+(?:\.\d+)?)\s*万(?:元)?/gu;
const EXACT_PREFIXED_DEBT_AMOUNT_PATTERN = /这笔\s*(\d+(?:\.\d+)?)\s*万(?:元)?(?:的)?(?:债务|负债)/gu;
const EXACT_LOAN_BALANCE_PATTERN = /(?:房贷|贷款|按揭)(?:(?:剩余)?(?:本金|余额)(?:约|为|达到|升至|降至|减少到|还有)?|还剩)\s*(\d+(?:\.\d+)?)\s*万(?:元)?/gu;
const EXACT_LOAN_REMAINING_PATTERN = /(?:房贷|贷款|按揭)(?:还有|尚有|剩下)\s*(\d+(?:\.\d+)?)\s*万(?:元)?(?:本金)?/gu;
const DEBT_SENTENCE_CONTEXT_PATTERN = /债务|负债|借款|贷款|房贷|按揭|月供|还款|偿付|逾期|拖欠|欠款|债权|银行|信用卡|征信|催收|贷后|清收|罚息/u;

function debtScopedPatternMatches(text: string, pattern: RegExp, authoritativeDebtContext = false): boolean {
  return text.split(/[。！？\n]/u).some((sentence) =>
    (authoritativeDebtContext || DEBT_SENTENCE_CONTEXT_PATTERN.test(sentence)) && pattern.test(sentence)
  );
}

function containsCompletedDebtClaim(text: string): boolean {
  return text.split(/[。！？\n]/u).some((sentence) => {
    if (!DEBT_COMPLETED_PATTERN.test(sentence)) return false;
    if (/(?:如果|一旦|可以|可望|希望|计划|打算|准备|考虑|尝试|需要|才能|能否|尚未|还未|未能)[^。！？]{0,24}(?:还清|结清|清偿|清零)/u.test(sentence)) return false;
    if (/(?:还清|结清|清偿)[^。！？]{0,18}(?:计划|打算|准备|可能|目标|需要|才能|能否)/u.test(sentence)) return false;
    return true;
  });
}

function issuesForText(text: string, surface: DebtNarrativeSurface, authority: DebtNarrativeAuthority, path?: string): DebtNarrativeSurfaceIssue[] {
  const issues: DebtNarrativeSurfaceIssue[] = [];
  const push = (reasonCode: DebtNarrativeSurfaceIssue["reasonCode"]) => issues.push({ surface, path, reasonCode, text });
  const authoritativeDebtContext = surface === "arcSignal.evidence"
    && (authority.healthLevel !== "none"
      || authority.deltaBreakdown.openingDebtWan > 0.01
      || authority.deltaBreakdown.closingDebtWan > 0.01);
  if (!authority.permittedInstitutionActions.includes("formal_collection") && debtScopedPatternMatches(text, COLLECTION_PATTERN)) push("UNAUTHORIZED_COLLECTION");
  if (!authority.permittedInstitutionActions.includes("legal_action") && debtScopedPatternMatches(text, LEGAL_PATTERN, authoritativeDebtContext)) push("UNAUTHORIZED_LEGAL_ACTION");
  if (!authority.permittedInstitutionActions.includes("credit_reporting") && debtScopedPatternMatches(text, CREDIT_PATTERN)) push("UNAUTHORIZED_CREDIT_CONSEQUENCE");
  if (debtScopedPatternMatches(text, PENALTY_PATTERN)) push("UNAUTHORIZED_PENALTY");
  if (authority.consecutiveMissedPaymentMonths > 0 && FIRST_DELINQUENCY_PATTERN.test(text)) push("FALSE_FIRST_DELINQUENCY");
  if (!authority.acceptedCompletedEventKinds.includes("debt_restructured") && RESTRUCTURE_COMPLETED_PATTERN.test(text)) push("UNACCEPTED_RESTRUCTURE_COMPLETION");
  if (!authority.acceptedCompletedEventKinds.includes("debt_principal_repaid") && ARREARS_CATCHUP_PATTERN.test(text)) push("UNACCEPTED_ARREARS_CATCHUP");
  const completionSupportedByClosingLedger = authority.deltaBreakdown.closingDebtWan <= 0.01
    && authority.deltaBreakdown.openingDebtWan > 0.01
    && (authority.deltaBreakdown.principalPaidWan
      + authority.deltaBreakdown.automaticShortfallRecoveryWan
      + authority.deltaBreakdown.forgivenWan) > 0.01;
  if (containsCompletedDebtClaim(text)
    && (authority.canonicalFacts.some((fact) => fact.kind === "debt_outstanding") || !completionSupportedByClosingLedger)) {
    push("UNACCEPTED_DEBT_COMPLETION");
  }
  if (authority.canonicalFacts.some((fact) => fact.kind === "debt_outstanding") && DENIED_DEBT_PATTERN.test(text)) push("DENIED_EXISTING_DEBT");
  if (debtScopedPatternMatches(text, STIGMA_PATTERN)) push("DEBT_STIGMA");
  for (const match of text.matchAll(EXACT_MISSED_PATTERN)) {
    if (Number(match[1]) !== authority.consecutiveMissedPaymentMonths) {
      push("MISMATCHED_MISSED_PAYMENT_COUNT");
      break;
    }
  }
  const authoritativeDebtAmount = authority.canonicalFacts.find((fact) => fact.kind === "debt_outstanding")?.text.match(/(\d+(?:\.\d+)?)万元/u)?.[1];
  if (authoritativeDebtAmount !== undefined) {
    for (const match of [...text.matchAll(EXACT_TOTAL_DEBT_PATTERN), ...text.matchAll(EXACT_PREFIXED_DEBT_AMOUNT_PATTERN), ...text.matchAll(EXACT_LOAN_BALANCE_PATTERN), ...text.matchAll(EXACT_LOAN_REMAINING_PATTERN)]) {
      const tolerance = Math.max(0.01, Number(authoritativeDebtAmount) * 0.001);
      if (Math.abs(Number(match[1]) - Number(authoritativeDebtAmount)) > tolerance) {
        push("MISMATCHED_DEBT_AMOUNT");
        break;
      }
    }
  }
  return issues;
}

export function collectDebtNarrativeSurfaceIssues(input: {
  node: SimulationNode;
  authority: DebtNarrativeAuthority;
}): DebtNarrativeSurfaceIssue[] {
  const texts: Array<{ surface: DebtNarrativeSurface; path: string; text?: string }> = [
    { surface: "description", path: "description", text: input.node.description },
    ...input.node.choices.flatMap((choice, index) => [
      { surface: "choice.text" as const, path: `choices[${index}].text`, text: choice.text },
      { surface: "choice.impactSummary" as const, path: `choices[${index}].impactSummary`, text: choice.impactSummary },
      { surface: "choice.decisionIntent" as const, path: `choices[${index}].decisionIntent`, text: choice.decisionIntent }
    ]),
    { surface: "storyEpisode.summary", path: "narrativeMeta.storyEpisode.summary", text: input.node.narrativeMeta?.storyEpisode.summary },
    ...(input.node.narrativeMeta?.storyEpisode.internalTransitions ?? []).map((transition, index) => ({
      surface: "storyEpisode.internalTransition" as const,
      path: `narrativeMeta.storyEpisode.internalTransitions[${index}].summary`,
      text: transition.summary
    })),
    ...(input.node.narrativeMeta?.arcSignals ?? []).map((signal, index) => ({
      surface: "arcSignal.evidence" as const,
      path: `narrativeMeta.arcSignals[${index}].evidence`,
      text: signal.evidence
    }))
  ];
  return texts.flatMap(({ surface, path, text }) => text ? issuesForText(text, surface, input.authority, path) : []);
}

const SAFE_CHOICE_COPY: Record<string, { text: string; impactSummary: string; decisionIntent: string }> = {
  request_debt_restructuring: { text: "申请核对并调整还款安排", impactSummary: "提交材料，结果仍待确认", decisionIntent: "financial:request_debt_restructuring" },
  sell_nonessential_asset: { text: "评估出售非必要资产", impactSummary: "只按实际成交结果入账", decisionIntent: "financial:consider_nonessential_asset_sale" },
  seek_verified_family_support: { text: "核对可验证的家庭支持", impactSummary: "确认支持是否真实可用", decisionIntent: "financial:seek_verified_support" },
  accept_and_record_payment_arrears: { text: "承认并核对当前拖欠", impactSummary: "以账本事实重排生活支出", decisionIntent: "financial:record_payment_arrears" }
};

export function applyDebtNarrativeAuthorityToNode(input: {
  node: SimulationNode;
  authority: DebtNarrativeAuthority;
}): SimulationNode {
  return {
    ...input.node,
    choices: input.node.choices.map((choice) => {
      const safe = choice.eventOutcomeId ? SAFE_CHOICE_COPY[choice.eventOutcomeId] : undefined;
      return safe ? { ...choice, ...safe } : choice;
    }),
    financialProcessingMeta: input.node.financialProcessingMeta ? {
      ...input.node.financialProcessingMeta,
      debtNarrativeAuthorityVersion: input.authority.version,
      narrativeFallback: false,
      narrativeFallbackReasonCodes: [],
      rejectedDebtClaimKinds: []
    } : input.node.financialProcessingMeta
  };
}

function repairDebtNarrativeText(
  text: string | undefined,
  surface: DebtNarrativeSurface,
  authority: DebtNarrativeAuthority
): string {
  if (!text) return "";
  const debtFact = authority.canonicalFacts.find((fact) => fact.kind === "debt_outstanding")?.text;
  const missedFact = authority.canonicalFacts.find((fact) => fact.kind === "missed_payments_continue")?.text;
  const chunks = text.split(/(?<=[。！？])|\n+/u).filter(Boolean);
  const repaired = chunks.map((chunk) => {
    const reasons = new Set(issuesForText(chunk, surface, authority).map((issue) => issue.reasonCode));
    if (reasons.size === 0) return chunk;
    if (reasons.has("UNACCEPTED_RESTRUCTURE_COMPLETION")) {
      return "你已经提交调整还款安排的申请，结果仍待确认。";
    }
    if (reasons.has("UNACCEPTED_DEBT_COMPLETION")) {
      return debtFact ?? "这笔收入被留作现金缓冲与生活安排。";
    }
    if (reasons.has("UNACCEPTED_ARREARS_CATCHUP")) {
      return "你恢复按当前计划还款，过去的偿付问题仍按账本继续处理。";
    }
    if (reasons.has("MISMATCHED_MISSED_PAYMENT_COUNT") || reasons.has("FALSE_FIRST_DELINQUENCY")) {
      return missedFact ?? "你暂时没有把偿付状态写成确定结论，而是继续核对实际进展。";
    }
    if (reasons.has("MISMATCHED_DEBT_AMOUNT") || reasons.has("DENIED_EXISTING_DEBT")) {
      return debtFact ?? "债务仍需继续处理，你没有把它写成已经解决。";
    }
    return "现阶段只能确认还款提醒、材料核对和协商准备。";
  });
  return repaired.filter((chunk, index) => chunk !== repaired[index - 1]).join("");
}

export function repairDebtNarrativeSurfaces(input: {
  node: SimulationNode;
  authority: DebtNarrativeAuthority;
  issues: DebtNarrativeSurfaceIssue[];
}): SimulationNode {
  const canonicalized = applyDebtNarrativeAuthorityToNode({ node: input.node, authority: input.authority });
  const repair = (text: string, surface: DebtNarrativeSurface) => repairDebtNarrativeText(text, surface, input.authority);
  const paragraphs = (canonicalized.descriptionParagraphs?.length
    ? canonicalized.descriptionParagraphs
    : canonicalized.description.split(/\n\s*\n+/u)
  ).map((paragraph) => repair(paragraph, "description"));
  const reasonCodes = [...new Set(input.issues.map((issue) => issue.reasonCode))];
  return {
    ...canonicalized,
    description: paragraphs.join("\n\n"),
    descriptionParagraphs: paragraphs,
    choices: canonicalized.choices.map((choice) => ({
      ...choice,
      text: repair(choice.text, "choice.text") || "继续核对现实条件后再行动",
      impactSummary: repair(choice.impactSummary, "choice.impactSummary") || "现实影响仍需观察",
      decisionIntent: choice.decisionIntent ? repair(choice.decisionIntent, "choice.decisionIntent") : choice.decisionIntent
    })),
    narrativeMeta: canonicalized.narrativeMeta ? {
      ...canonicalized.narrativeMeta,
      storyEpisode: {
        ...canonicalized.narrativeMeta.storyEpisode,
        summary: repair(canonicalized.narrativeMeta.storyEpisode.summary, "storyEpisode.summary"),
        internalTransitions: canonicalized.narrativeMeta.storyEpisode.internalTransitions.map((transition) => ({
          ...transition,
          summary: repair(transition.summary, "storyEpisode.internalTransition")
        }))
      },
      arcSignals: canonicalized.narrativeMeta.arcSignals.map((signal) => ({
        ...signal,
        evidence: repair(signal.evidence, "arcSignal.evidence")
      }))
    } : canonicalized.narrativeMeta,
    financialProcessingMeta: canonicalized.financialProcessingMeta ? {
      ...canonicalized.financialProcessingMeta,
      narrativeFallback: false,
      narrativeFallbackReasonCodes: [],
      rejectedDebtClaimKinds: reasonCodes,
      narrativeRepairAttempts: (canonicalized.financialProcessingMeta.narrativeRepairAttempts ?? 0) + 1,
      narrativeRepairSucceeded: true,
      narrativeFallbackSurfacePaths: []
    } : canonicalized.financialProcessingMeta
  };
}

export function applyDebtNarrativeFallback(input: {
  node: SimulationNode;
  authority: DebtNarrativeAuthority;
  reasonCodes: string[];
  rejectedCompletionKinds?: FinancialEventKind[];
}): SimulationNode {
  const surfaceIssues = collectDebtNarrativeSurfaceIssues({ node: input.node, authority: input.authority });
  let fallbackNode = surfaceIssues.length > 0
    ? repairDebtNarrativeSurfaces({ node: input.node, authority: input.authority, issues: surfaceIssues })
    : applyDebtNarrativeAuthorityToNode({ node: input.node, authority: input.authority });
  const rejectedRestructure = input.rejectedCompletionKinds?.includes("debt_restructured");
  if (rejectedRestructure && stillContainsCompletedRestructure(fallbackNode.description)) {
    const paragraphs = (fallbackNode.descriptionParagraphs?.length
      ? fallbackNode.descriptionParagraphs
      : fallbackNode.description.split(/\n\s*\n+/u)
    ).map((paragraph) => RESTRUCTURE_COMPLETED_PATTERN.test(paragraph)
      ? "你已经尝试申请调整还款安排，但尚未形成生效协议；接下来先保留基本生活缓冲，再等待进一步确认。"
      : paragraph);
    fallbackNode = { ...fallbackNode, descriptionParagraphs: paragraphs, description: paragraphs.join("\n\n") };
  }
  const currentMeta = input.node.financialProcessingMeta;
  fallbackNode = {
    ...fallbackNode,
    financialProcessingMeta: {
      proposalCount: currentMeta?.proposalCount ?? 0,
      acceptedEventCount: currentMeta?.acceptedEventCount ?? 0,
      acceptedCareerTransitionCount: currentMeta?.acceptedCareerTransitionCount ?? 0,
      blockingIssueCount: currentMeta?.blockingIssueCount ?? 0,
      repairTriggered: currentMeta?.repairTriggered ?? false,
      repairLatencyMs: currentMeta?.repairLatencyMs ?? 0,
      totalProcessingLatencyMs: currentMeta?.totalProcessingLatencyMs ?? 0,
      debtNarrativeAuthorityVersion: DEBT_NARRATIVE_AUTHORITY_VERSION,
      narrativeFallback: true,
      narrativeFallbackReasonCodes: [...new Set(input.reasonCodes)],
      rejectedDebtClaimKinds: [...new Set(input.reasonCodes)],
      narrativeRepairAttempts: Math.max(1, currentMeta?.narrativeRepairAttempts ?? 0),
      narrativeRepairSucceeded: false,
      narrativeFallbackSurfacePaths: [...new Set(surfaceIssues.map((issue) => issue.path ?? issue.surface))]
    }
  };
  const canonicalized = applyDebtNarrativeAuthorityToNode({ node: fallbackNode, authority: input.authority });
  return {
    ...canonicalized,
    financialProcessingMeta: {
      ...canonicalized.financialProcessingMeta!,
      narrativeFallback: true,
      narrativeFallbackReasonCodes: [...new Set(input.reasonCodes)],
      rejectedDebtClaimKinds: [...new Set(input.reasonCodes)],
      narrativeRepairAttempts: Math.max(1, currentMeta?.narrativeRepairAttempts ?? 0),
      narrativeRepairSucceeded: false,
      narrativeFallbackSurfacePaths: [...new Set(surfaceIssues.map((issue) => issue.path ?? issue.surface))]
    }
  };
}

function stillContainsCompletedRestructure(text: string): boolean {
  RESTRUCTURE_COMPLETED_PATTERN.lastIndex = 0;
  return RESTRUCTURE_COMPLETED_PATTERN.test(text);
}
