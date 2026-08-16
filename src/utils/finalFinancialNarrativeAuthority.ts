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

export type FinalBusinessValueClaim =
  | { kind: "no_confirmed_business_value" }
  | { kind: "confirmed_business_carrying_value"; holdingIds: string[] };

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
  businessValue: FinalBusinessValueClaim;
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
    | "REPORT_NEGATIVE_NET_WORTH_ROMANTICIZATION"
    | "REPORT_PROPERTY_CONFLICT"
    | "REPORT_INTERNAL_PLACEHOLDER"
    | "REPORT_ORPHAN_FINANCIAL_AMOUNT"
    | "REPORT_FINANCIAL_PRECISION"
    | "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT"
    | "REPORT_UNSUPPORTED_RETURN_CLAIM"
    | "REPORT_UNCONFIRMED_BUSINESS_VALUE"
    | "REPORT_FINANCIAL_AUTHORITY_UNAVAILABLE"
    | "REPORT_PROPERTY_ABSENCE_OVERCLAIM"
    | "REPORT_ASSET_ABSENCE_OVERCLAIM";
  text: string;
}

// Keep this aligned with the production-audit completion detector.  A title
// saying that debt has "归零/清零" is still a completed-settlement claim,
// even when it avoids the literal words "还清" or "结清".
const DEBT_COMPLETION_PATTERN = /(?:还清(?:了|全部|所有)?(?:债务|欠款|贷款)?|结清(?:了|全部|所有)?(?:债务|欠款|贷款)?|清偿完毕|无债一身轻|摆脱(?:了)?全部债务|不再欠债|(?:债务|欠款|贷款|房贷|信用卡)(?:已经|已|终于|最终|彻底)?(?:归零|清零))/u;
const DEBT_NON_COMPLETION_PATTERNS = [
  /(?:未能|没有|并未|尚未|仍未|还未|从未|不曾|无法|不能|没能|未曾|未)(?:真正|完全|全部)?(?:还清|结清|清偿|摆脱)(?:了|全部|所有)?(?:债务|欠款|贷款)?/gu,
  /(?:未|没有|并无|尚无|缺少|无法|不能)[^，。！？；;\n]{0,12}(?:记录|证据|结果)?[^，。！？；;\n]{0,8}(?:显示|表明|证明|确认)[^，。！？；;\n]{0,20}(?:已|已经)?(?:还清|结清|清偿|摆脱)(?:了|全部|所有)?(?:债务|欠款|贷款)?/gu,
  /离(?:真正|完全|全部)?(?:还清|结清|清偿)[^，。！？；;\n]{0,12}(?:仍有|还有|尚有)/gu,
  /(?:还清|结清|清偿)[^，。！？；;\n]{0,12}(?:仍未|尚未|没有|未能)(?:发生|完成|实现)?/gu
];
const NEGATIVE_NET_WORTH_SUCCESS_PATTERN = /(?:财务自由|财富自由|资产充足|经济无忧|财务无忧|财富安全垫(?:已经)?建立)/u;
const NEGATIVE_NET_WORTH_ROMANTICIZATION_PATTERN = /(?:(?:负债|债务|负净资产)[^。！？]{0,28}(?:换来|换来了|换得)[^。！？]{0,24}(?:值得|丰盈|意义|平静|余裕|河堤)|(?:还|偿还)[^。！？]{0,12}(?:债|债务)[^。！？]{0,18}(?:却|但)[^。！？]{0,24}(?:平静|余裕|意义|作品|传承|种子|曲子|河堤)|(?:值得|丰盈|意义)[^。！？]{0,24}(?:交换|代价)[^。！？]{0,20}(?:负债|债务|负净资产)|留下的不是(?:负债|债务)[^。！？]{0,16}而是|真正的财富不在(?:于)?(?:账户|数字)|债务是[^。！？]{0,16}(?:音符|旋律|值得的代价|意义的代价)|债务[^。！？]{0,20}代价[^。！？]{0,20}(?:但|却)[^。！？]{0,20}(?:作品|传承|意义|希望)|比债务更(?:重要|重)|不再为(?:债务|它)焦虑[^。！？]{0,16}接受(?:债务|它)|(?:愿意|甘愿)背负债务|愿意背负债务[^。！？]{0,16}(?:也要|仍要|也愿)|即使(?:负债|背负债务)[^。！？]{0,20}(?:也可以|仍然可以|未曾后悔)|(?:负债|债务)[\s\S]{0,30}(?:没有遗憾|未曾后悔)|换来[^。！？]{0,20}(?:平静|意义|丰盈)[^。！？]{0,20}(?:债务|负债)|背负着债务[^。！？]{0,16}(?:希望|意义))/u;
const PROPERTY_POSSESSION_PATTERN = /(?:名下有(?:一套|房产)|名下房产|自己的(?:房[屋产子]|公寓|住房)|(?:出售|卖掉|抵押)(?:了)?(?:自己的|名下的)?(?:房屋|房产|住房|公寓)|房产升值|房贷压力)/u;
const PROPERTY_ABSENCE_OVERCLAIM_PATTERN = /(?:(?:没有|并无|名下无|未持有|从未拥有)(?!已确认)(?:任何|一套|属于自己的|自己的)?(?:房屋|房产|住房|公寓)|(?:房屋|房产|住房|公寓)[^。！？]{0,8}(?:并不存在|不存在|一套也没有))/u;
const ASSET_ABSENCE_OVERCLAIM_PATTERN = /(?:没有|并无|不存在)[^。！？]{0,10}(?:其他)?(?:可变现|流动|个人)?资产/u;
const NEGATED_PROPERTY_ACTION_PATTERN = /(?:(?:没有|并未|未曾|从未|无法|不能|未能|没能)(?:出售|卖掉|抵押)|(?:出售|卖掉|抵押)[^。！？]{0,10}(?:没有|并未|未曾|从未|无法|不能|未能|没能)(?:发生|完成|实现)?)/u;
const MONEY_PATTERN = /-?\d+(?:\.\d+)?\s*(?:万元|万|元)(?:人民币)?/gu;
const NUMERIC_RETURN_PATTERN = /\d+(?:\.\d+)?\s*倍(?:的)?(?:投资)?回报|(?:回报率|收益率)(?:达到|为|约为|超过)?\s*\d+(?:\.\d+)?%/u;
const BUSINESS_VALUE_PATTERN = /(?:公司|企业|创业项目|股权|期权)[^。！？]{0,24}(?:估值|市值|价值|获利|回报)/u;

function moneyToWan(value: string): number | undefined {
  const parsed = value.match(/(-?\d+(?:\.\d+)?)\s*(万元|万|元)/u);
  if (!parsed) return undefined;
  const amount = Number(parsed[1]);
  return parsed[2] === "元" ? amount / 10_000 : amount;
}

function matchesNumericAuthority(valueWan: number, authority: FinalFinancialNarrativeAuthority): boolean {
  return authority.numericClaims.some((claim) => (
    Math.abs(claim.valueWan - valueWan) <= Math.max(0.01, Math.abs(claim.valueWan) * 0.001)
  ));
}

function hasUnsupportedDebtCompletionClaim(text: string): boolean {
  const withoutNonCompletionClaims = DEBT_NON_COMPLETION_PATTERNS.reduce(
    (remaining, pattern) => remaining.replace(pattern, " "),
    text
  );
  return DEBT_COMPLETION_PATTERN.test(withoutNonCompletionClaims);
}

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
 * shortfall recovery) targeted at that exact debt account. A period-level
 * total must never make a different account look settled.
 */
function transactionHasDebtSettlementFactForAccount(
  transaction: FinancialLedger["recentTransactions"][number],
  debtAccountId: string
): boolean {
  if (transaction.debtSettlementAccountIds?.includes(debtAccountId)) return true;
  // Historical reducer snapshots predate debtSettlementAccountIds, but a
  // debt-service record has always carried the target account id and remains
  // account-specific proof. Do not fall back to aggregate transaction totals.
  return transaction.debtServiceRecords?.some((record) => record.debtAccountId === debtAccountId
    && (record.principalPaidWan > 0 || record.interestPaidWan > 0)) ?? false;
}

function hasRecordedDebtSettlementForAccount(history: HistoryItem[], debtAccountId: string): boolean {
  return history.some((item) => {
    const ledger = item.financialLedger;
    const account = ledger?.debtAccounts.find((candidate) => candidate.id === debtAccountId);
    if (!ledger || !account || account.status !== "repaid") return false;
    return ledger.recentTransactions.some((transaction) => (
      transactionHasDebtSettlementFactForAccount(transaction, debtAccountId)
    ));
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
  const confirmedBusinessHoldings = ledger.businessHoldings.filter((holding) => (
    holding.status === "active" || holding.status === "partially_sold"
  ) && isReportEligibleFinancialFact(holding));
  const businessValue: FinalBusinessValueClaim = confirmedBusinessHoldings.length > 0
    ? { kind: "confirmed_business_carrying_value", holdingIds: confirmedBusinessHoldings.map((holding) => holding.id) }
    : { kind: "no_confirmed_business_value" };
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
    businessValue,
    numericClaims,
    permittedSemanticClaims: [debt.kind, netWorth.kind, property.kind, businessValue.kind],
    forbiddenSemanticClaims: [
      ...(debt.kind !== "debt_fully_repaid" ? ["debt_fully_repaid"] : []),
      ...(netWorth.kind === "negative_net_worth" ? ["financial_freedom"] : []),
      ...(netWorth.kind === "negative_net_worth" ? ["negative_net_worth_as_worthwhile_trade"] : []),
      ...(property.kind === "no_confirmed_property" ? ["confirmed_property_ownership_or_sale"] : []),
      ...(businessValue.kind === "no_confirmed_business_value" ? ["confirmed_business_valuation_or_return"] : [])
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
  const strings: Array<{ path: string; text: string }> = [];
  collectStrings({ share: input.outcome.share, report: input.outcome.report }, "", strings);
  const issues: FinalFinancialNarrativeIssue[] = [];
  for (const item of strings) {
    if (!input.authority) {
      if (MONEY_PATTERN.test(item.text) || NUMERIC_RETURN_PATTERN.test(item.text) || DEBT_COMPLETION_PATTERN.test(item.text) || PROPERTY_POSSESSION_PATTERN.test(item.text)) {
        issues.push({ path: item.path, code: "REPORT_FINANCIAL_AUTHORITY_UNAVAILABLE", text: item.text });
      }
      MONEY_PATTERN.lastIndex = 0;
      continue;
    }
    if (/金额待账本确认|回报幅度待账本确认|回报率待账本确认|价值待确认|账本确认/u.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_INTERNAL_PLACEHOLDER", text: item.text });
    }
    if (/(?:负债|债务|净资产|现金|收入|支出)\s*-?\d+(?:\.\d+)?\s*(?:…|\.{2,})/u.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_ORPHAN_FINANCIAL_AMOUNT", text: item.text });
    }
    if (/-?\d+\.\d{3,}\s*万(?:元)?/u.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_FINANCIAL_PRECISION", text: item.text });
    }
    if (NUMERIC_RETURN_PATTERN.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_UNSUPPORTED_RETURN_CLAIM", text: item.text });
    }
    if (input.authority.businessValue.kind === "no_confirmed_business_value" && BUSINESS_VALUE_PATTERN.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_UNCONFIRMED_BUSINESS_VALUE", text: item.text });
    }
    for (const match of item.text.match(MONEY_PATTERN) || []) {
      const valueWan = moneyToWan(match);
      if (valueWan !== undefined && !matchesNumericAuthority(valueWan, input.authority)) {
        issues.push({ path: item.path, code: "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT", text: item.text });
        break;
      }
    }
    if (input.authority.debt.kind !== "debt_fully_repaid"
      && hasUnsupportedDebtCompletionClaim(item.text)) {
      issues.push({ path: item.path, code: "REPORT_DEBT_COMPLETION_CONFLICT", text: item.text });
    }
    if (input.authority.netWorth.kind === "negative_net_worth" && NEGATIVE_NET_WORTH_SUCCESS_PATTERN.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_NEGATIVE_NET_WORTH_CONFLICT", text: item.text });
    }
    if (input.authority.netWorth.kind === "negative_net_worth" && NEGATIVE_NET_WORTH_ROMANTICIZATION_PATTERN.test(item.text)) {
      issues.push({ path: item.path, code: "REPORT_NEGATIVE_NET_WORTH_ROMANTICIZATION", text: item.text });
    }
    if (input.authority.property.kind === "no_confirmed_property") {
      if (PROPERTY_ABSENCE_OVERCLAIM_PATTERN.test(item.text)) {
        issues.push({ path: item.path, code: "REPORT_PROPERTY_ABSENCE_OVERCLAIM", text: item.text });
      }
      if (ASSET_ABSENCE_OVERCLAIM_PATTERN.test(item.text)) {
        issues.push({ path: item.path, code: "REPORT_ASSET_ABSENCE_OVERCLAIM", text: item.text });
      }
      if (PROPERTY_POSSESSION_PATTERN.test(item.text) && !NEGATED_PROPERTY_ACTION_PATTERN.test(item.text)) {
        issues.push({ path: item.path, code: "REPORT_PROPERTY_CONFLICT", text: item.text });
      }
    }
  }
  return issues;
}

export function formatFinalFinancialNarrativeAuthorityForPrompt(authority?: FinalFinancialNarrativeAuthority): string {
  if (!authority) return JSON.stringify({ version: "unavailable", rule: "不得生成具体资产、债务、净资产或房产完成结论。" }, null, 2);
  const debt = authority.debt.kind === "debt_outstanding"
    || authority.debt.kind === "debt_repayment_in_progress"
    || authority.debt.kind === "formal_default_outstanding"
    ? { kind: authority.debt.kind, totalDebt: `${formatFinancialWan(authority.debt.totalDebtWan)}元` }
    : authority.debt;
  const netWorth = authority.netWorth.kind === "positive_net_worth" || authority.netWorth.kind === "negative_net_worth"
    ? { kind: authority.netWorth.kind, netWorth: `${formatFinancialWan(authority.netWorth.netWorthWan)}元` }
    : authority.netWorth;
  const property = authority.property.kind === "confirmed_property_holdings"
    ? {
      kind: authority.property.kind,
      properties: authority.property.properties.map((item) => ({
        id: item.id,
        displayName: item.displayName,
        marketValue: `${formatFinancialWan(item.marketValueWan)}元`,
        factStatus: item.factStatus
      }))
    }
    : authority.property;
  return JSON.stringify({
    version: authority.version,
    asOfAgeInMonths: authority.asOfAgeInMonths,
    sourceLedgerRevision: authority.sourceLedgerRevision,
    debt,
    netWorth,
    property,
    personalExpenseSummary: authority.personalExpenseSummary,
    businessValue: authority.businessValue,
    numericClaims: authority.numericClaims.map(({ kind, displayText, sourceLedgerRevision }) => ({ kind, displayText, sourceLedgerRevision })),
    permittedSemanticClaims: authority.permittedSemanticClaims,
    forbiddenSemanticClaims: authority.forbiddenSemanticClaims
  }, null, 2);
}
