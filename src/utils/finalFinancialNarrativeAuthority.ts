import type { AssetAccount, FinancialLedger } from "../domain/finance/types";
import { isReportEligibleFinancialFact } from "../domain/finance/financialFactEligibility";
import { totalDebtWan } from "../domain/finance/ledgerMath";
import {
  derivePersonalExpenseSummary,
  formatPersonalExpenseSummaryForPrompt,
  type PersonalExpenseSummary
} from "../domain/finance/personalExpenseSummary";
import type { FinalLifeOutcome, HistoryItem } from "../types";

export const FINAL_FINANCIAL_NARRATIVE_AUTHORITY_VERSION = "final_financial_narrative_v1" as const;

export type FinalDebtClaim =
  | { kind: "no_active_debt" }
  | { kind: "debt_outstanding"; totalDebtWan: number }
  | { kind: "debt_repayment_in_progress"; totalDebtWan: number }
  | { kind: "debt_fully_repaid"; evidenceAccountIds: string[] }
  | { kind: "formal_default_outstanding"; totalDebtWan: number };

export type FinalNetWorthClaim =
  | { kind: "positive_net_worth"; netWorthWan: number }
  | { kind: "zero_net_worth" }
  | { kind: "negative_net_worth"; netWorthWan: number };

export type FinalPropertyClaim =
  | { kind: "no_confirmed_property" }
  | { kind: "confirmed_property_holdings"; properties: Array<Pick<AssetAccount, "id" | "displayName" | "marketValueWan" | "factStatus">> };

export type FinalFinancialNumericClaimKind =
  | "cash"
  | "total_debt"
  | "net_worth"
  | "property_market_value"
  | "personal_annual_income"
  | "personal_annual_expense";

export interface FinalFinancialNumericClaim {
  kind: FinalFinancialNumericClaimKind;
  valueWan: number;
  displayText: string;
  sourceLedgerRevision: number;
}

export interface FinalFinancialNarrativeAuthority {
  version: typeof FINAL_FINANCIAL_NARRATIVE_AUTHORITY_VERSION;
  asOfAgeInMonths: number;
  sourceLedgerRevision: number;
  debt: FinalDebtClaim;
  netWorth: FinalNetWorthClaim;
  property: FinalPropertyClaim;
  /**
   * The terminal report and poster must consume this exact V4 responsibility
   * summary, never reconstruct an independent "living expense" total.
   */
  personalExpenseSummary: PersonalExpenseSummary;
  numericClaims: FinalFinancialNumericClaim[];
  permittedSemanticClaims: string[];
  forbiddenSemanticClaims: string[];
  canonicalSummary: string;
}

export interface FinalFinancialNarrativeIssue {
  path: string;
  code:
    | "REPORT_DEBT_COMPLETION_CONFLICT"
    | "REPORT_NEGATIVE_NET_WORTH_CONFLICT"
    | "REPORT_PROPERTY_CONFLICT"
    | "REPORT_INTERNAL_PLACEHOLDER"
    | "REPORT_ORPHAN_FINANCIAL_AMOUNT"
    | "REPORT_FINANCIAL_PRECISION";
  text: string;
}

// Keep this aligned with the production-audit completion detector.  A title
// saying that debt has "归零/清零" is still a completed-settlement claim,
// even when it avoids the literal words "还清" or "结清".
const DEBT_COMPLETION_PATTERN = /(?:还清(?:了|全部|所有)?(?:债务|欠款|贷款)?|结清(?:了|全部|所有)?(?:债务|欠款|贷款)?|清偿完毕|无债一身轻|摆脱(?:了)?全部债务|不再欠债|(?:债务|欠款|贷款|房贷|信用卡)(?:已经|已|终于|最终|彻底)?(?:归零|清零))/u;
const NEGATIVE_NET_WORTH_SUCCESS_PATTERN = /(?:财务自由|财富自由|资产充足|经济无忧|财务无忧|财富安全垫(?:已经)?建立)/u;
const PROPERTY_POSSESSION_PATTERN = /(?:名下有(?:一套|房产)|名下房产|自己的(?:房[屋产子]|公寓|住房)|(?:出售|卖掉)(?:了)?(?:自己的|名下的)?(?:房屋|房产|住房|公寓)|房产升值|房贷压力)/u;

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function formatFinancialWan(value: number): string {
  const digits = Math.abs(value) >= 100 ? 1 : 2;
  return `${Number(round(value).toFixed(digits))}万`;
}

function activeMonthsInHorizon(input: {
  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
  asOfAgeInMonths: number;
}): number {
  const start = Math.max(input.asOfAgeInMonths, input.activeFromAgeInMonths);
  const endExclusive = Math.min(input.asOfAgeInMonths + 12, (input.activeUntilAgeInMonths ?? (input.asOfAgeInMonths + 11)) + 1);
  return Math.max(0, endExclusive - start);
}

function confirmedProperties(ledger: FinancialLedger): AssetAccount[] {
  return ledger.assetAccounts.filter((account) => account.status === "active"
    && account.type === "property"
    && isReportEligibleFinancialFact(account));
}

/**
 * A zero closing balance or a raw `repaid` account status is not, by itself,
 * evidence that a repayment actually happened during the represented life.
 * Repaid statuses may be present in migrated snapshots.  Final copy may use
 * payoff language only when the authoritative ledger history contains a
 * reducer-produced liability reduction (payment, forgiveness, or automatic
 * shortfall recovery).
 */
function transactionHasDebtSettlementFact(transaction: FinancialLedger["recentTransactions"][number]): boolean {
  return (transaction.debtPrincipalPaidWan ?? 0) > 0
    || (transaction.debtPrincipalForgivenWan ?? 0) > 0
    || (transaction.debtInterestLiabilityPaidWan ?? 0) > 0
    || (transaction.debtInterestForgivenWan ?? 0) > 0
    || (transaction.automaticLiquidityShortfallRecoveryWan ?? 0) > 0;
}

function hasRecordedDebtSettlementForAccount(history: HistoryItem[], debtAccountId: string): boolean {
  return history.some((item, index) => {
    const ledger = item.financialLedger;
    const account = ledger?.debtAccounts.find((candidate) => candidate.id === debtAccountId);
    if (!ledger || !account || account.status !== "repaid") return false;
    const priorAccount = history[index - 1]?.financialLedger?.debtAccounts.find((candidate) => candidate.id === debtAccountId);
    return ledger.recentTransactions.some((transaction) => {
      if (!transactionHasDebtSettlementFact(transaction)) return false;
      if (transaction.debtServiceRecords?.some((record) => record.debtAccountId === debtAccountId
        && (record.principalPaidWan > 0 || record.interestPaidWan > 0))) return true;
      return Boolean(priorAccount && (priorAccount.status === "active" || priorAccount.status === "defaulted"));
    });
  });
}

function hasReliableRepaidDebt(history: HistoryItem[], ledger: FinancialLedger): string[] {
  return ledger.debtAccounts.filter((account) => account.status === "repaid"
    && (isReportEligibleFinancialFact(account) || account.origin === "system_auto_shortfall")
    && hasRecordedDebtSettlementForAccount(history, account.id))
    .map((account) => account.id);
}

export function deriveFinalFinancialNarrativeAuthority(history: HistoryItem[]): FinalFinancialNarrativeAuthority | undefined {
  const latest = history.at(-1);
  const ledger = latest?.financialLedger;
  if (!latest || !ledger) return undefined;
  // The report must reconcile to the same total liability shown in the financial
  // panel. Fact confidence can limit prose detail, but it cannot make an active
  // liability disappear from the terminal debt and net-worth totals.
  const eligibleDebts = ledger.debtAccounts.filter((account) => account.status === "active" || account.status === "defaulted");
  const debtWan = totalDebtWan(ledger);
  const defaulted = eligibleDebts.some((account) => account.status === "defaulted");
  const eligibleDebtIds = new Set(eligibleDebts.map((account) => account.id));
  const hasRecentPayment = ledger.recentTransactions.some((transaction) => (
    transaction.debtServiceRecords?.some((record) => eligibleDebtIds.has(record.debtAccountId)
      && (record.principalPaidWan > 0 || record.interestPaidWan > 0))
    || (transaction.automaticLiquidityShortfallRecoveryWan ?? 0) > 0
  ));
  const terminalRepaidAccountIds = ledger.debtAccounts
    .filter((account) => account.status === "repaid")
    .map((account) => account.id);
  const repaidAccounts = hasReliableRepaidDebt(history, ledger);
  const debt: FinalDebtClaim = debtWan > 0.01
    ? defaulted
      ? { kind: "formal_default_outstanding", totalDebtWan: debtWan }
      : hasRecentPayment
        ? { kind: "debt_repayment_in_progress", totalDebtWan: debtWan }
        : { kind: "debt_outstanding", totalDebtWan: debtWan }
    : terminalRepaidAccountIds.length > 0 && repaidAccounts.length === terminalRepaidAccountIds.length
      ? { kind: "debt_fully_repaid", evidenceAccountIds: repaidAccounts }
      : { kind: "no_active_debt" };
  const reportEligibleCashWan = round(ledger.cashAccounts
    .filter((account) => account.status === "active" && isReportEligibleFinancialFact(account))
    .reduce((sum, account) => sum + account.balanceWan, 0));
  const reportEligibleAssetWan = round(ledger.assetAccounts
    .filter((account) => account.status === "active" && isReportEligibleFinancialFact(account))
    .reduce((sum, account) => sum + account.marketValueWan, 0)
    + ledger.businessHoldings
      .filter((holding) => (holding.status === "active" || holding.status === "partially_sold") && isReportEligibleFinancialFact(holding))
      .reduce((sum, holding) => sum + holding.personalCarryingValueWan, 0));
  const reportNetWorthWan = round(reportEligibleCashWan + reportEligibleAssetWan - debtWan);
  const netWorth: FinalNetWorthClaim = reportNetWorthWan < -0.01
    ? { kind: "negative_net_worth", netWorthWan: reportNetWorthWan }
    : reportNetWorthWan > 0.01
      ? { kind: "positive_net_worth", netWorthWan: reportNetWorthWan }
      : { kind: "zero_net_worth" };
  const properties = confirmedProperties(ledger);
  const property: FinalPropertyClaim = properties.length > 0
    ? { kind: "confirmed_property_holdings", properties: properties.map(({ id, displayName, marketValueWan, factStatus }) => ({ id, displayName, marketValueWan, factStatus })) }
    : { kind: "no_confirmed_property" };
  const propertyMarketValueWan = round(properties.reduce((sum, propertyAccount) => sum + propertyAccount.marketValueWan, 0));
  const personalAnnualIncomeWan = round(ledger.incomeSources
    .filter((source) => source.status === "active" && source.accrualReviewStatus !== "quarantined" && isReportEligibleFinancialFact(source))
    .reduce((sum, source) => {
      const activeMonths = activeMonthsInHorizon({ ...source, asOfAgeInMonths: ledger.asOfAgeInMonths });
      if (source.accrualPolicy === "monthly") return sum + (source.monthlyNetAmountWan ?? 0) * activeMonths;
      if (source.accrualPolicy === "annual") return sum + (source.annualNetAmountWan ?? 0) * activeMonths / 12;
      return sum;
    }, 0));
  const personalExpenseSummary = derivePersonalExpenseSummary(ledger);
  // V4 has one canonical recurring-expense representation.  Keep the V3
  // compatibility branch only for historical reports that predate V4; all
  // V4 report values are derived from the exact same summary sent to prompts.
  const personalAnnualExpenseWan = personalExpenseSummary.availability === "available"
    ? personalExpenseSummary.reportEligibleAnnualizedExpenseWan
    : round(ledger.expenseCommitments
      .filter((commitment) => commitment.status === "active" && isReportEligibleFinancialFact(commitment))
      .reduce((sum, commitment) => sum + commitment.monthlyAmountWan * activeMonthsInHorizon({ ...commitment, asOfAgeInMonths: ledger.asOfAgeInMonths }), 0));
  const numericClaims: FinalFinancialNumericClaim[] = [
    { kind: "cash", valueWan: reportEligibleCashWan, displayText: formatFinancialWan(reportEligibleCashWan), sourceLedgerRevision: ledger.revision },
    { kind: "total_debt", valueWan: debtWan, displayText: formatFinancialWan(debtWan), sourceLedgerRevision: ledger.revision },
    { kind: "net_worth", valueWan: reportNetWorthWan, displayText: formatFinancialWan(reportNetWorthWan), sourceLedgerRevision: ledger.revision },
    { kind: "property_market_value", valueWan: propertyMarketValueWan, displayText: formatFinancialWan(propertyMarketValueWan), sourceLedgerRevision: ledger.revision },
    { kind: "personal_annual_income", valueWan: personalAnnualIncomeWan, displayText: formatFinancialWan(personalAnnualIncomeWan), sourceLedgerRevision: ledger.revision },
    { kind: "personal_annual_expense", valueWan: personalAnnualExpenseWan, displayText: formatFinancialWan(personalAnnualExpenseWan), sourceLedgerRevision: ledger.revision }
  ];

  const debtSummary = debt.kind === "debt_outstanding" || debt.kind === "debt_repayment_in_progress" || debt.kind === "formal_default_outstanding"
    ? `截至这段人生结束时，你仍有${round(debt.totalDebtWan)}万元个人债务需要处理。`
    : debt.kind === "debt_fully_repaid"
      ? "截至这段人生结束时，已有可靠记录的个人债务已经清偿。"
      : "截至这段人生结束时，没有仍在账上的个人债务。";
  const netWorthSummary = netWorth.kind === "negative_net_worth"
    ? `净资产仍为负${Math.abs(round(netWorth.netWorthWan))}万元，现金流恢复不等于财务自由。`
    : netWorth.kind === "positive_net_worth"
      ? `净资产为${round(netWorth.netWorthWan)}万元。`
      : "净资产接近零。";
  const propertySummary = property.kind === "no_confirmed_property"
    ? "没有可以写入报告的已确认房产事实。"
    : `已确认持有房产：${property.properties.map((item) => item.displayName).join("、")}。`;

  return {
    version: FINAL_FINANCIAL_NARRATIVE_AUTHORITY_VERSION,
    asOfAgeInMonths: ledger.asOfAgeInMonths,
    sourceLedgerRevision: ledger.revision,
    debt,
    netWorth,
    property,
    personalExpenseSummary,
    numericClaims,
    permittedSemanticClaims: [debt.kind, netWorth.kind, property.kind],
    forbiddenSemanticClaims: [
      ...(debt.kind !== "debt_fully_repaid" ? ["debt_fully_repaid"] : []),
      ...(netWorth.kind === "negative_net_worth" ? ["financial_freedom"] : []),
      ...(property.kind === "no_confirmed_property" ? ["confirmed_property_ownership_or_sale"] : [])
    ],
    canonicalSummary: `${debtSummary}${netWorthSummary}${propertySummary}\n${formatPersonalExpenseSummaryForPrompt(personalExpenseSummary)}`
  };
}

function collectStrings(value: unknown, path: string, output: Array<{ path: string; text: string }>): void {
  if (typeof value === "string") {
    output.push({ path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => collectStrings(item, path ? `${path}.${key}` : key, output));
  }
}

export function collectFinalFinancialNarrativeIssues(input: {
  outcome: FinalLifeOutcome;
  authority?: FinalFinancialNarrativeAuthority;
}): FinalFinancialNarrativeIssue[] {
  if (!input.authority) return [];
  const strings: Array<{ path: string; text: string }> = [];
  collectStrings({ share: input.outcome.share, report: input.outcome.report }, "", strings);
  const issues: FinalFinancialNarrativeIssue[] = [];
  for (const item of strings) {
    if (/金额待账本确认|回报幅度待账本确认|回报率待账本确认|价值待确认|账本确认/u.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_INTERNAL_PLACEHOLDER", text: item.text });
    }
    if (/(?:负债|债务|净资产|现金|收入|支出)\s*-?\d+(?:\.\d+)?\s*(?:…|\.{2,})/u.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_ORPHAN_FINANCIAL_AMOUNT", text: item.text });
    }
    if (/-?\d+\.\d{3,}\s*万(?:元)?/u.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_FINANCIAL_PRECISION", text: item.text });
    }
    if (input.authority.debt.kind !== "debt_fully_repaid"
      && DEBT_COMPLETION_PATTERN.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_DEBT_COMPLETION_CONFLICT", text: item.text });
    }
    if (input.authority.netWorth.kind === "negative_net_worth" && NEGATIVE_NET_WORTH_SUCCESS_PATTERN.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_NEGATIVE_NET_WORTH_CONFLICT", text: item.text });
    }
    if (input.authority.property.kind === "no_confirmed_property" && PROPERTY_POSSESSION_PATTERN.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_PROPERTY_CONFLICT", text: item.text });
    }
  }
  return issues;
}

function replacementFor(issue: FinalFinancialNarrativeIssue, authority: FinalFinancialNarrativeAuthority): string {
  if (issue.code === "REPORT_INTERNAL_PLACEHOLDER" || issue.code === "REPORT_ORPHAN_FINANCIAL_AMOUNT" || issue.code === "REPORT_FINANCIAL_PRECISION") {
    return issue.path === "share.viralTitle"
      ? "我在现实起伏中重新安排了生活"
      : "财务现实仍在变化，你选择按已经发生的事实继续安排生活。";
  }
  if (issue.code === "REPORT_DEBT_COMPLETION_CONFLICT") {
    if (issue.path === "share.viralTitle") return "我在未完成的偿债路上重新安排了生活";
    if (issue.path === "share.covenantTitle") return "稳步重建者";
    return authority.debt.kind === "formal_default_outstanding"
      ? "债务问题仍未解决，你在压力中继续重整生活。"
      : "债务仍在偿还过程中，你开始用更可持续的方式安排生活。";
  }
  if (issue.code === "REPORT_NEGATIVE_NET_WORTH_CONFLICT") {
    return "现金流有所恢复，但净资产仍为负，你仍需要继续修复长期财务缺口。";
  }
  return "你重新安排了居住与生活节奏，但没有把未确认的房产变化写成既成事实。";
}

function repairText(text: string, issues: FinalFinancialNarrativeIssue[], authority: FinalFinancialNarrativeAuthority): string {
  const matching = issues.filter((issue) => issue.text === text);
  if (matching.length === 0) return text;
  if (matching.some((issue) => issue.path === "share.viralTitle" || issue.path === "share.covenantTitle")) {
    return replacementFor(matching[0], authority);
  }
  const sentences = text.split(/(?<=[。！？])/u).filter(Boolean);
  const repaired = sentences.map((sentence) => {
    const issue = matching.find((candidate) => candidate.code === "REPORT_DEBT_COMPLETION_CONFLICT" && DEBT_COMPLETION_PATTERN.test(sentence))
      ?? matching.find((candidate) => candidate.code === "REPORT_NEGATIVE_NET_WORTH_CONFLICT" && NEGATIVE_NET_WORTH_SUCCESS_PATTERN.test(sentence))
      ?? matching.find((candidate) => candidate.code === "REPORT_PROPERTY_CONFLICT" && PROPERTY_POSSESSION_PATTERN.test(sentence));
    return issue ? replacementFor(issue, authority) : sentence;
  });
  return [...new Set(repaired)].join("");
}

function repairUnknown(value: unknown, issues: FinalFinancialNarrativeIssue[], authority: FinalFinancialNarrativeAuthority): unknown {
  if (typeof value === "string") return repairText(value, issues, authority);
  if (Array.isArray(value)) return value.map((item) => repairUnknown(item, issues, authority));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairUnknown(item, issues, authority)]));
  }
  return value;
}

export function applyFinalFinancialNarrativeFallback(input: {
  outcome: FinalLifeOutcome;
  authority: FinalFinancialNarrativeAuthority;
  issues: FinalFinancialNarrativeIssue[];
}): FinalLifeOutcome {
  return repairUnknown(input.outcome, input.issues, input.authority) as FinalLifeOutcome;
}

export function formatFinalFinancialNarrativeAuthorityForPrompt(authority?: FinalFinancialNarrativeAuthority): string {
  if (!authority) return JSON.stringify({ version: "unavailable", rule: "不得生成具体资产、债务、净资产或房产完成结论。" }, null, 2);
  return JSON.stringify(authority, null, 2);
}

export function buildFinalFinancialNarrativeRepairPrompt(input: {
  outcome: FinalLifeOutcome;
  authority: FinalFinancialNarrativeAuthority;
  issues: FinalFinancialNarrativeIssue[];
}): string {
  return `你只修复终局报告中与权威财务事实冲突的字段。保持 JSON schema、非冲突字段、年龄、人物和关键选择不变。\n\n【权威财务语义】\n${formatFinalFinancialNarrativeAuthorityForPrompt(input.authority)}\n\n【冲突字段】\n${JSON.stringify(input.issues, null, 2)}\n\n【原报告】\n${JSON.stringify(input.outcome, null, 2)}\n\n返回修复后的完整 JSON，不要 Markdown。`;
}
