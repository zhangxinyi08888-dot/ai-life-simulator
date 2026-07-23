import { accruePeriodSlice } from "./accruePeriod";
import { validateAcceptedFinancialEvents } from "./acceptFinancialEvents";
import { normalizeDebtAccountV3 } from "./initializeLedger";
import {
  assertFinancialLedgerInvariants,
  cloneLedger,
  FinancialLedgerInvariantError,
  ledgerNetWorthWan,
  PRIMARY_CASH_ACCOUNT_ID,
  roundWan,
  totalAssetWan,
  totalCashWan,
  totalDebtWan
} from "./ledgerMath";
import type {
  AcceptedFinancialEvent,
  AssetAccount,
  BusinessHolding,
  CashAccount,
  DebtAccount,
  DebtServiceRecord,
  ExpenseCommitment,
  FinancialEventKind,
  FinancialLedger,
  FinancialPeriodSummary,
  FinancialTransaction,
  IncomeSource
} from "./types";
import { assertSufficientLiquidity } from "./reconcileLiquidity";

const RECENT_TRANSACTION_LIMIT = 20;
const EVENT_DRIVEN_DEBT_REVIEW_MONTHS = 24;

export type ReduceFinancialLedgerResult =
  | {
      ledger: FinancialLedger;
      transaction: FinancialTransaction;
      periodSummary: FinancialPeriodSummary;
      alreadyCommitted: false;
    }
  | {
      ledger: FinancialLedger;
      transaction?: FinancialTransaction;
      alreadyCommitted: true;
    };

export type LiquidityPolicy = "require_explicit" | "auto_shortfall_debt";

function positiveMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `${label} 必须是正数`);
  }
  return roundWan(value);
}

function nonNegativeMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `${label} 必须是非负数`);
  }
  return roundWan(value);
}

function requiredById<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new FinancialLedgerInvariantError("INVALID_LEDGER", `${label}不存在: ${id}`);
  return item;
}

function assertNewId<T extends { id: string }>(items: T[], id: string, label: string): void {
  if (!id || items.some((item) => item.id === id)) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `${label} id 已存在或为空: ${id || "<empty>"}`);
  }
}

function cashAccount(ledger: FinancialLedger, id: string): CashAccount {
  const account = requiredById(ledger.cashAccounts, id, "现金账户");
  if (account.status !== "active") throw new FinancialLedgerInvariantError("INVALID_LEDGER", `现金账户已关闭: ${id}`);
  return account;
}

function changeCash(ledger: FinancialLedger, accountId: string, deltaWan: number): void {
  const account = cashAccount(ledger, accountId);
  account.balanceWan = roundWan(account.balanceWan + deltaWan);
}

function validateIncomeSource(source: IncomeSource): void {
  if (source.accrualPolicy === "monthly" && (!Number.isFinite(source.monthlyNetAmountWan) || (source.monthlyNetAmountWan || 0) < 0)) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `月度收入来源 ${source.id} 缺少有效月净额`);
  }
  if (source.accrualPolicy === "annual" && (!Number.isFinite(source.annualNetAmountWan) || (source.annualNetAmountWan || 0) < 0)) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `年度收入来源 ${source.id} 缺少有效年净额`);
  }
}

function validateExpenseCommitment(commitment: ExpenseCommitment): void {
  nonNegativeMoney(commitment.monthlyAmountWan, `支出义务 ${commitment.id}.monthlyAmountWan`);
}

function requiredOptionHolding(ledger: FinancialLedger, id: string): BusinessHolding {
  const holding = requiredById(ledger.businessHoldings, id, "企业期权");
  if (holding.instrumentType !== "stock_option" || !holding.optionTerms) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `企业权益 ${id} 不是有效期权`);
  }
  if (holding.status !== "active" && holding.status !== "partially_sold") {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `期权 ${id} 已关闭`);
  }
  return holding;
}

function optionCarryingValue(holding: BusinessHolding): number {
  const terms = holding.optionTerms;
  if (!terms || terms.fairValueWanPerUnit === undefined) return 0;
  const availableVestedUnits = terms.vestedUnits - terms.exercisedUnits;
  const intrinsicValueWan = availableVestedUnits * Math.max(terms.fairValueWanPerUnit - terms.strikePriceWanPerUnit, 0);
  return roundWan(intrinsicValueWan
    * (1 - (holding.liquidityDiscountRate || 0))
    * (1 - (terms.realizationRiskDiscountRate || 0)));
}

interface EventTotals {
  oneOffIncomeWan: number;
  otherExpenseWan: number;
  debtPrincipalPaidWan: number;
  debtInterestPaidWan: number;
  debtInterestLiabilityPaidWan: number;
  debtInterestAccruedWan: number;
  debtInterestUnpaidWan: number;
  debtPrincipalDrawnWan: number;
  debtPrincipalForgivenWan: number;
  debtInterestForgivenWan: number;
  debtCapitalizedInterestWan: number;
  automaticLiquidityShortfallRecoveryWan: number;
  debtServiceRecords: DebtServiceRecord[];
  assetPurchaseWan: number;
  assetSaleProceedsWan: number;
  valuationChangeWan: number;
  priorFactCorrectionWan: number;
}

function accumulatePeriodAccrual(
  accrual: ReturnType<typeof accruePeriodSlice>,
  totals: EventTotals
): { incomeWan: number; coreExpenseWan: number } {
  totals.debtPrincipalPaidWan = roundWan(totals.debtPrincipalPaidWan + accrual.debtPrincipalPaidWan);
  totals.debtInterestPaidWan = roundWan(totals.debtInterestPaidWan + accrual.debtInterestPaidWan);
  totals.debtInterestLiabilityPaidWan = roundWan(totals.debtInterestLiabilityPaidWan + accrual.debtInterestPaidWan);
  totals.debtInterestAccruedWan = roundWan(totals.debtInterestAccruedWan + accrual.debtInterestAccruedWan);
  totals.debtInterestUnpaidWan = roundWan(totals.debtInterestUnpaidWan + accrual.debtInterestUnpaidWan);
  totals.automaticLiquidityShortfallRecoveryWan = roundWan(
    totals.automaticLiquidityShortfallRecoveryWan + accrual.automaticLiquidityShortfallRecoveryWan
  );
  totals.debtServiceRecords.push(...accrual.debtServiceRecords);
  totals.otherExpenseWan = roundWan(totals.otherExpenseWan + accrual.debtInterestAccruedWan);
  totals.valuationChangeWan = roundWan(totals.valuationChangeWan + accrual.valuationChangeWan);
  return { incomeWan: accrual.incomeWan, coreExpenseWan: accrual.coreExpenseWan };
}

function addDebtScheduleReviewIssues(ledger: FinancialLedger): void {
  for (const debt of ledger.debtAccounts) {
    if (debt.status !== "active"
      || debt.type === "liquidity_shortfall"
      || debt.repaymentPolicy.mode !== "event_driven"
      || ledger.asOfAgeInMonths - debt.openedAtAgeInMonths < EVENT_DRIVEN_DEBT_REVIEW_MONTHS) continue;
    const issueId = `unknown_debt_schedule_${debt.id}`;
    if (ledger.unresolvedIssues.some((issue) => issue.id === issueId)) continue;
    debt.factStatus = "needs_review";
    debt.repaymentPolicy = {
      mode: "estimated_amortizing",
      monthlyPrincipalWan: roundWan(debt.principalWan / 240),
      remainingTermMonths: 240
    };
    ledger.unresolvedIssues.push({
      id: issueId,
      code: "UNKNOWN_DEBT_SCHEDULE",
      severity: "warning",
      status: "open",
      relatedDebtAccountIds: [debt.id],
      relatedProposalIds: [],
      summary: `债务 ${debt.displayName} 已长期缺少明确还款计划`,
      createdAtAgeInMonths: ledger.asOfAgeInMonths
    });
  }
}

function addDebtServiceIssues(ledger: FinancialLedger, records: DebtServiceRecord[]): void {
  for (const record of records) {
    if (record.outcome === "paid") continue;
    const debt = ledger.debtAccounts.find((candidate) => candidate.id === record.debtAccountId);
    if (!debt) continue;
    const code = debt.servicingStatus === "delinquent"
      ? "DEBT_PAYMENT_DELINQUENT" as const
      : "DEBT_PAYMENT_MISSED" as const;
    const id = `${code.toLowerCase()}_${debt.id}_${record.ageInMonths}`;
    if (ledger.unresolvedIssues.some((issue) => issue.id === id)) continue;
    ledger.unresolvedIssues.push({
      id,
      code,
      severity: "warning",
      status: "open",
      relatedProposalIds: [],
      relatedDebtAccountIds: [debt.id],
      summary: code === "DEBT_PAYMENT_DELINQUENT"
        ? `债务 ${debt.displayName} 已连续未足额履约`
        : `债务 ${debt.displayName} 本月未足额履约`,
      createdAtAgeInMonths: record.ageInMonths
    });
  }
}

type AutomaticShortfallDebt = DebtAccount & {
  origin?: "explicit" | "system_auto_shortfall" | "legacy_migration";
  lastPrincipalIncreaseAtAgeInMonths?: number;
};

function isAutomaticShortfallDebt(debt: DebtAccount): debt is AutomaticShortfallDebt {
  const candidate = debt as AutomaticShortfallDebt;
  return debt.type === "liquidity_shortfall" && (
    candidate.origin === "system_auto_shortfall"
    || debt.evidence.some((item) => item.reasonCode === "AUTOMATIC_LIQUIDITY_SHORTFALL")
  );
}

/**
 * The reducer is a mechanical boundary: even an old or partially migrated
 * ledger must not be able to keep multiple live system-created shortfall
 * accounts. Explicit bridge loans remain separate because they represent an
 * accepted user/world fact rather than the liquidity-floor policy.
 */
function consolidateAutomaticShortfallAccounts(ledger: FinancialLedger): AutomaticShortfallDebt | undefined {
  // liquidity_shortfall is a policy-created/event-created balance, never a
  // scheduled instalment. Repair stale v2 schedules before period accrual so
  // they cannot pay themselves by creating another liquidity gap.
  for (const debt of ledger.debtAccounts) {
    if (debt.type !== "liquidity_shortfall") continue;
    const shortfall = debt as AutomaticShortfallDebt;
    shortfall.repaymentPolicy = { mode: "event_driven" };
    shortfall.origin ??= isAutomaticShortfallDebt(shortfall) ? "system_auto_shortfall" : "explicit";
    shortfall.accruedUnpaidInterestWan ??= 0;
    shortfall.servicingStatus ??= "current";
    shortfall.consecutiveMissedPaymentMonths ??= 0;
    shortfall.totalMissedPaymentMonths ??= 0;
    shortfall.recentMissedPaymentAgeInMonths ??= [];
  }
  const active = ledger.debtAccounts.filter(
    (debt): debt is AutomaticShortfallDebt => debt.status === "active" && isAutomaticShortfallDebt(debt)
  );
  if (active.length === 0) return undefined;

  const canonical = active[0];
  canonical.origin = "system_auto_shortfall";
  canonical.repaymentPolicy = { mode: "event_driven" };
  for (const duplicate of active.slice(1)) {
    canonical.principalWan = roundWan(canonical.principalWan + duplicate.principalWan);
    canonical.accruedUnpaidInterestWan = roundWan(
      (canonical.accruedUnpaidInterestWan ?? 0) + (duplicate.accruedUnpaidInterestWan ?? 0)
    );
    canonical.consecutiveMissedPaymentMonths = Math.max(
      canonical.consecutiveMissedPaymentMonths ?? 0,
      duplicate.consecutiveMissedPaymentMonths ?? 0
    );
    canonical.totalMissedPaymentMonths = (canonical.totalMissedPaymentMonths ?? 0)
      + (duplicate.totalMissedPaymentMonths ?? 0);
    canonical.recentMissedPaymentAgeInMonths = [...new Set([
      ...(canonical.recentMissedPaymentAgeInMonths ?? []),
      ...(duplicate.recentMissedPaymentAgeInMonths ?? [])
    ])].sort((left, right) => left - right);
    canonical.evidence.push(...structuredClone(duplicate.evidence));
    duplicate.principalWan = 0;
    duplicate.accruedUnpaidInterestWan = 0;
    duplicate.status = "restructured";
    duplicate.closedAtAgeInMonths = ledger.asOfAgeInMonths;
    duplicate.repaymentPolicy = { mode: "event_driven" };
  }
  return canonical;
}

function applyEvent(
  ledger: FinancialLedger,
  event: AcceptedFinancialEvent,
  allEventIds: Set<string>,
  totals: EventTotals
): void {
  switch (event.kind) {
    case "income_source_started": {
      const source = event.payload as IncomeSource;
      assertNewId(ledger.incomeSources, source.id, "收入来源");
      validateIncomeSource(source);
      ledger.incomeSources.push({
        ...structuredClone(source),
        evidence: event.evidence.length ? structuredClone(event.evidence) : structuredClone(source.evidence),
        accrualReviewStatus: "normal",
        lastConfirmedAtAgeInMonths: event.effectiveAtAgeInMonths
      });
      return;
    }
    case "income_source_adjusted": {
      const { incomeSourceId, nextSource } = event.payload;
      const index = ledger.incomeSources.findIndex((source) => source.id === incomeSourceId);
      if (index < 0 || nextSource.id !== incomeSourceId) throw new FinancialLedgerInvariantError("INVALID_LEDGER", `收入来源调整必须引用同一账户: ${incomeSourceId}`);
      validateIncomeSource(nextSource);
      ledger.incomeSources[index] = {
        ...structuredClone(nextSource),
        evidence: event.evidence.length ? structuredClone(event.evidence) : structuredClone(nextSource.evidence),
        accrualReviewStatus: "normal",
        lastConfirmedAtAgeInMonths: event.effectiveAtAgeInMonths
      };
      return;
    }
    case "income_source_paused": {
      requiredById(ledger.incomeSources, event.payload.incomeSourceId, "收入来源").status = "paused";
      return;
    }
    case "income_source_ended": {
      const source = requiredById(ledger.incomeSources, event.payload.incomeSourceId, "收入来源");
      source.status = "ended";
      source.activeUntilAgeInMonths = event.effectiveAtAgeInMonths;
      return;
    }
    case "expense_commitment_started": {
      const commitment = event.payload as ExpenseCommitment;
      assertNewId(ledger.expenseCommitments, commitment.id, "支出义务");
      validateExpenseCommitment(commitment);
      ledger.expenseCommitments.push(structuredClone(commitment));
      return;
    }
    case "expense_commitment_adjusted": {
      const { expenseCommitmentId, nextCommitment } = event.payload;
      const index = ledger.expenseCommitments.findIndex((commitment) => commitment.id === expenseCommitmentId);
      if (index < 0 || nextCommitment.id !== expenseCommitmentId) throw new FinancialLedgerInvariantError("INVALID_LEDGER", `支出义务调整必须引用同一账户: ${expenseCommitmentId}`);
      validateExpenseCommitment(nextCommitment);
      ledger.expenseCommitments[index] = structuredClone(nextCommitment);
      return;
    }
    case "expense_commitment_ended": {
      const commitment = requiredById(ledger.expenseCommitments, event.payload.expenseCommitmentId, "支出义务");
      commitment.status = "ended";
      commitment.activeUntilAgeInMonths = event.effectiveAtAgeInMonths;
      return;
    }
    case "one_off_income_received":
    case "family_support_received": {
      const amount = positiveMoney(event.payload.amountWan, `${event.kind}.amountWan`);
      changeCash(ledger, event.payload.destinationCashAccountId, amount);
      totals.oneOffIncomeWan = roundWan(totals.oneOffIncomeWan + amount);
      return;
    }
    case "one_off_expense_paid":
    case "family_support_paid": {
      const amount = positiveMoney(event.payload.amountWan, `${event.kind}.amountWan`);
      changeCash(ledger, event.payload.sourceCashAccountId, -amount);
      totals.otherExpenseWan = roundWan(totals.otherExpenseWan + amount);
      return;
    }
    case "asset_purchased": {
      const payload = event.payload;
      assertNewId(ledger.assetAccounts, payload.assetAccount.id, "资产账户");
      const cashPaid = positiveMoney(payload.cashPaidWan, "asset_purchased.cashPaidWan");
      const fee = nonNegativeMoney(payload.transactionFeeWan, "asset_purchased.transactionFeeWan");
      if (payload.linkedDebtDrawEventId && !allEventIds.has(payload.linkedDebtDrawEventId)) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", `资产购买引用了不存在的借款事件: ${payload.linkedDebtDrawEventId}`);
      }
      changeCash(ledger, payload.sourceCashAccountId, -(cashPaid + fee));
      ledger.assetAccounts.push(structuredClone(payload.assetAccount));
      totals.assetPurchaseWan = roundWan(totals.assetPurchaseWan + cashPaid);
      totals.otherExpenseWan = roundWan(totals.otherExpenseWan + fee);
      return;
    }
    case "asset_balance_discovered": {
      const asset = event.payload.assetAccount;
      assertNewId(ledger.assetAccounts, asset.id, "资产账户");
      const value = nonNegativeMoney(asset.marketValueWan, "asset_balance_discovered.assetAccount.marketValueWan");
      ledger.assetAccounts.push(structuredClone({ ...asset, marketValueWan: value }));
      totals.priorFactCorrectionWan = roundWan(totals.priorFactCorrectionWan + value);
      return;
    }
    case "asset_sold": {
      const payload = event.payload;
      const asset = requiredById(ledger.assetAccounts, payload.assetAccountId, "资产账户");
      const removed = positiveMoney(payload.assetValueRemovedWan, "asset_sold.assetValueRemovedWan");
      const received = positiveMoney(payload.cashReceivedWan, "asset_sold.cashReceivedWan");
      const fee = nonNegativeMoney(payload.transactionFeeWan, "asset_sold.transactionFeeWan");
      if (removed > asset.marketValueWan) throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "出售资产价值超过当前账面价值");
      asset.marketValueWan = roundWan(asset.marketValueWan - removed);
      if (asset.marketValueWan === 0) {
        asset.status = "disposed";
        asset.closedAtAgeInMonths = event.effectiveAtAgeInMonths;
      }
      changeCash(ledger, payload.destinationCashAccountId, received - fee);
      totals.assetSaleProceedsWan = roundWan(totals.assetSaleProceedsWan + received);
      totals.otherExpenseWan = roundWan(totals.otherExpenseWan + fee);
      return;
    }
    case "asset_revalued": {
      const payload = event.payload;
      const asset = requiredById(ledger.assetAccounts, payload.assetAccountId, "资产账户");
      if (roundWan(asset.marketValueWan) !== roundWan(payload.previousMarketValueWan)) {
        throw new FinancialLedgerInvariantError("REVISION_CONFLICT", `资产 ${asset.id} 的旧市值与当前账本不一致`);
      }
      const nextValue = nonNegativeMoney(payload.newMarketValueWan, "asset_revalued.newMarketValueWan");
      totals.valuationChangeWan = roundWan(totals.valuationChangeWan + nextValue - asset.marketValueWan);
      asset.marketValueWan = nextValue;
      asset.evidence.push(...structuredClone(payload.valuationEvidence));
      return;
    }
    case "debt_drawn":
    case "liquidity_shortfall_created": {
      const payload = event.payload;
      assertNewId(ledger.debtAccounts, payload.debtAccount.id, "债务账户");
      const principal = positiveMoney(payload.principalDrawnWan, `${event.kind}.principalDrawnWan`);
      if (roundWan(payload.debtAccount.principalWan) !== principal) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "新债账户本金必须等于本次到账本金");
      }
      if (event.kind === "liquidity_shortfall_created" && payload.debtAccount.type !== "liquidity_shortfall") {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "流动性缺口事件只能创建 liquidity_shortfall 债务");
      }
      const createdDebt = normalizeDebtAccountV3({
        ...structuredClone(payload.debtAccount),
        origin: payload.debtAccount.origin ?? "explicit"
      });
      if (event.kind === "liquidity_shortfall_created") {
        createdDebt.repaymentPolicy = { mode: "event_driven" };
      }
      ledger.debtAccounts.push(createdDebt);
      changeCash(ledger, payload.destinationCashAccountId, principal);
      totals.debtPrincipalDrawnWan = roundWan(totals.debtPrincipalDrawnWan + principal);
      return;
    }
    case "debt_balance_discovered": {
      const debt = event.payload.debtAccount;
      assertNewId(ledger.debtAccounts, debt.id, "债务账户");
      const principal = positiveMoney(debt.principalWan, "debt_balance_discovered.debtAccount.principalWan");
      ledger.debtAccounts.push(normalizeDebtAccountV3({ ...structuredClone(debt), principalWan: principal }));
      totals.priorFactCorrectionWan = roundWan(totals.priorFactCorrectionWan - principal);
      return;
    }
    case "debt_principal_repaid": {
      const payload = event.payload;
      const debt = requiredById(ledger.debtAccounts, payload.debtAccountId, "债务账户");
      const principal = positiveMoney(payload.principalPaidWan, "debt_principal_repaid.principalPaidWan");
      if (principal > debt.principalWan) throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "偿还本金超过剩余本金");
      changeCash(ledger, payload.sourceCashAccountId, -principal);
      debt.principalWan = roundWan(debt.principalWan - principal);
      totals.debtPrincipalPaidWan = roundWan(totals.debtPrincipalPaidWan + principal);
      if (debt.principalWan === 0) {
        debt.status = "repaid";
        debt.closedAtAgeInMonths = event.effectiveAtAgeInMonths;
      }
      return;
    }
    case "debt_interest_paid": {
      const payload = event.payload;
      const debt = requiredById(ledger.debtAccounts, payload.debtAccountId, "债务账户");
      const interest = positiveMoney(payload.interestPaidWan, "debt_interest_paid.interestPaidWan");
      const liabilityPaidWan = roundWan(Math.min(interest, debt.accruedUnpaidInterestWan ?? 0));
      changeCash(ledger, payload.sourceCashAccountId, -interest);
      debt.accruedUnpaidInterestWan = roundWan(Math.max(0, (debt.accruedUnpaidInterestWan ?? 0) - interest));
      totals.debtInterestPaidWan = roundWan(totals.debtInterestPaidWan + interest);
      totals.debtInterestLiabilityPaidWan = roundWan(totals.debtInterestLiabilityPaidWan + liabilityPaidWan);
      totals.otherExpenseWan = roundWan(totals.otherExpenseWan + interest);
      return;
    }
    case "debt_restructured": {
      const payload = event.payload;
      const oldDebt = requiredById(ledger.debtAccounts, payload.oldDebtAccountId, "旧债务账户");
      assertNewId(ledger.debtAccounts, payload.replacementDebtAccount.id, "替代债务账户");
      const oldObligationWan = roundWan(oldDebt.principalWan + (oldDebt.accruedUnpaidInterestWan ?? 0));
      const replacementObligationWan = roundWan(payload.replacementDebtAccount.principalWan + (payload.replacementDebtAccount.accruedUnpaidInterestWan ?? 0));
      if (oldObligationWan !== replacementObligationWan) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "再融资替代债务必须完整承接本金与未付利息；额外借款或减免需单独事件");
      }
      const fee = nonNegativeMoney(payload.transactionFeeWan, "debt_restructured.transactionFeeWan");
      if (fee > 0) {
        if (!payload.sourceCashAccountId) throw new FinancialLedgerInvariantError("MISSING_FUNDING_SOURCE", "债务重组费用缺少现金来源");
        changeCash(ledger, payload.sourceCashAccountId, -fee);
        totals.otherExpenseWan = roundWan(totals.otherExpenseWan + fee);
      }
      oldDebt.status = "restructured";
      oldDebt.closedAtAgeInMonths = event.effectiveAtAgeInMonths;
      oldDebt.principalWan = 0;
      oldDebt.accruedUnpaidInterestWan = 0;
      ledger.debtAccounts.push(normalizeDebtAccountV3({
        ...structuredClone(payload.replacementDebtAccount),
        origin: payload.replacementDebtAccount.origin ?? "explicit"
      }));
      totals.debtCapitalizedInterestWan = roundWan(
        totals.debtCapitalizedInterestWan + (payload.capitalizedInterestWan ?? 0)
      );
      return;
    }
    case "debt_forgiven": {
      const payload = event.payload;
      const debt = requiredById(ledger.debtAccounts, payload.debtAccountId, "债务账户");
      const principalForgivenWan = nonNegativeMoney(payload.principalForgivenWan, "debt_forgiven.principalForgivenWan");
      const interestForgivenWan = nonNegativeMoney(payload.accruedInterestForgivenWan ?? 0, "debt_forgiven.accruedInterestForgivenWan");
      if (principalForgivenWan + interestForgivenWan <= 0) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "债务减免金额必须大于零");
      if (principalForgivenWan > debt.principalWan || interestForgivenWan > (debt.accruedUnpaidInterestWan ?? 0)) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "债务减免超过剩余本金或未付利息");
      }
      debt.principalWan = roundWan(debt.principalWan - principalForgivenWan);
      debt.accruedUnpaidInterestWan = roundWan((debt.accruedUnpaidInterestWan ?? 0) - interestForgivenWan);
      totals.debtPrincipalForgivenWan = roundWan(totals.debtPrincipalForgivenWan + principalForgivenWan);
      totals.debtInterestForgivenWan = roundWan(totals.debtInterestForgivenWan + interestForgivenWan);
      if (debt.principalWan === 0 && debt.accruedUnpaidInterestWan === 0) {
        debt.status = "repaid";
        debt.closedAtAgeInMonths = event.effectiveAtAgeInMonths;
      }
      return;
    }
    case "debt_default_recorded": {
      const debt = requiredById(ledger.debtAccounts, event.payload.debtAccountId, "债务账户");
      if (!event.payload.reason.trim()) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "正式违约必须记录原因");
      debt.status = "defaulted";
      debt.servicingStatus = "delinquent";
      return;
    }
    case "business_financing_recorded": {
      const payload = event.payload;
      positiveMoney(payload.financingAmountWan, "business_financing_recorded.financingAmountWan");
      if (payload.personalCashReceivedWan !== 0) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "公司融资不得进入个人现金");
      }
      const holding = requiredById(ledger.businessHoldings, payload.businessHoldingId, "企业持股");
      holding.business.latestFinancingAmountWan = roundWan(payload.financingAmountWan);
      holding.business.financingAsOfAgeInMonths = event.effectiveAtAgeInMonths;
      if (payload.postMoneyValuationWan !== undefined) {
        holding.business.latestPostMoneyValuationWan = nonNegativeMoney(payload.postMoneyValuationWan, "business_financing_recorded.postMoneyValuationWan");
        holding.business.valuationAsOfAgeInMonths = event.effectiveAtAgeInMonths;
      }
      if (payload.ownershipRateAfterFinancing !== undefined) {
        if (payload.ownershipRateAfterFinancing < 0 || payload.ownershipRateAfterFinancing > 1) {
          throw new FinancialLedgerInvariantError("INVALID_LEDGER", "融资后持股比例必须在 0-1 之间");
        }
        holding.ownershipRate = payload.ownershipRateAfterFinancing;
      }
      if (payload.postMoneyValuationWan === undefined || payload.ownershipRateAfterFinancing === undefined) {
        holding.factStatus = "needs_review";
        if (!ledger.unresolvedIssues.some((issue) => issue.id === `business_financing_${event.id}`)) {
          ledger.unresolvedIssues.push({
            id: `business_financing_${event.id}`,
            code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
            severity: "warning",
            relatedProposalIds: event.proposalId ? [event.proposalId] : [],
            summary: "已记录公司融资，但缺少投后估值或融资后持股比例，个人权益未重估",
            createdAtAgeInMonths: event.effectiveAtAgeInMonths
          });
        }
      }
      return;
    }
    case "business_holding_started": {
      const payload = event.payload;
      const invested = nonNegativeMoney(payload.personalCashInvestedWan, "business_holding_started.personalCashInvestedWan");
      assertNewId(ledger.businessHoldings, payload.businessHolding.id, "企业持股");
      if (roundWan(payload.businessHolding.personalCarryingValueWan) !== invested) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "新企业持股账面价值必须等于个人实际出资");
      }
      if (invested > 0) changeCash(ledger, payload.sourceCashAccountId, -invested);
      ledger.businessHoldings.push(structuredClone(payload.businessHolding));
      totals.assetPurchaseWan = roundWan(totals.assetPurchaseWan + invested);
      return;
    }
    case "business_option_granted": {
      const holding = structuredClone(event.payload.optionHolding);
      assertNewId(ledger.businessHoldings, holding.id, "企业期权");
      if (holding.instrumentType !== "stock_option" || !holding.optionTerms || holding.optionTerms.grantedUnits < 0) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权授予事件必须创建具有非负授予数量的 stock_option holding 和 optionTerms");
      }
      if (holding.optionTerms.grantedUnits === 0 && holding.factStatus !== "needs_review") {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "授予数量未知的期权只能以 needs_review 保存");
      }
      if (holding.personalCarryingValueWan !== 0 || holding.optionTerms.exercisedUnits !== 0) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "授予期权在可靠估值前不得直接计入个人财富");
      }
      if (holding.optionTerms.fairValueWanPerUnit !== undefined) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权公允价值只能通过独立重估事件进入账本");
      }
      if (holding.optionTerms.vestedUnits > holding.optionTerms.grantedUnits) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "已归属期权数量不得超过授予数量");
      }
      holding.optionTerms.grantedAtAgeInMonths ??= event.effectiveAtAgeInMonths;
      const vestingPolicy = holding.optionTerms.vestingPolicy;
      if (vestingPolicy && (vestingPolicy.totalMonths <= 0
        || (vestingPolicy.cliffMonths ?? 0) < 0
        || (vestingPolicy.frequencyMonths ?? 1) <= 0
        || (vestingPolicy.cliffMonths ?? 0) > vestingPolicy.totalMonths)) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权固定归属政策的期限、悬崖期或结算频率无效");
      }
      holding.status = "active";
      ledger.businessHoldings.push(holding);
      return;
    }
    case "business_option_vested": {
      const holding = requiredOptionHolding(ledger, event.payload.businessHoldingId);
      const terms = holding.optionTerms!;
      const units = positiveMoney(event.payload.unitsVested, "business_option_vested.unitsVested");
      if (terms.vestedUnits + units > terms.grantedUnits) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "归属数量超过尚未归属的期权数量");
      }
      const previousValue = holding.personalCarryingValueWan;
      terms.vestedUnits = roundWan(terms.vestedUnits + units);
      holding.personalCarryingValueWan = optionCarryingValue(holding);
      totals.valuationChangeWan = roundWan(totals.valuationChangeWan + holding.personalCarryingValueWan - previousValue);
      return;
    }
    case "business_option_revalued": {
      const payload = event.payload;
      const holding = requiredOptionHolding(ledger, payload.businessHoldingId);
      if (roundWan(holding.personalCarryingValueWan) !== roundWan(payload.previousCarryingValueWan)) {
        throw new FinancialLedgerInvariantError("REVISION_CONFLICT", `期权 ${holding.id} 的旧账面价值不一致`);
      }
      const fairValue = nonNegativeMoney(payload.fairValueWanPerUnit, "business_option_revalued.fairValueWanPerUnit");
      if (payload.liquidityDiscountRate < 0 || payload.liquidityDiscountRate > 1
        || payload.realizationRiskDiscountRate < 0 || payload.realizationRiskDiscountRate > 1) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权的流动性和实现风险折扣必须在 0-1 之间");
      }
      if (!payload.valuationEvidence.length) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权重估必须提供可靠估值证据");
      holding.optionTerms!.fairValueWanPerUnit = fairValue;
      holding.optionTerms!.realizationRiskDiscountRate = payload.realizationRiskDiscountRate;
      holding.liquidityDiscountRate = payload.liquidityDiscountRate;
      const expected = optionCarryingValue(holding);
      if (roundWan(payload.newCarryingValueWan) !== expected) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", `已归属期权的个人账面价值应为 ${expected} 万元，不能使用融资额或期权名义金额`);
      }
      totals.valuationChangeWan = roundWan(totals.valuationChangeWan + expected - holding.personalCarryingValueWan);
      holding.personalCarryingValueWan = expected;
      holding.factStatus = event.evidence.some((item) => item.confidence < 0.8) ? "estimated" : "known";
      holding.evidence.push(...structuredClone(payload.valuationEvidence));
      return;
    }
    case "business_option_exercised": {
      const payload = event.payload;
      const holding = requiredOptionHolding(ledger, payload.businessHoldingId);
      const terms = holding.optionTerms!;
      const units = positiveMoney(payload.unitsExercised, "business_option_exercised.unitsExercised");
      if (units > terms.vestedUnits - terms.exercisedUnits) throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "行权数量超过可行权的已归属期权");
      if (terms.fairValueWanPerUnit === undefined) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权行权前必须有可靠公允价值");
      const expectedCost = roundWan(units * terms.strikePriceWanPerUnit);
      if (roundWan(payload.exerciseCostWan) !== expectedCost) throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", `行权成本应为 ${expectedCost} 万元`);
      const equity = structuredClone(payload.resultingEquityHolding);
      assertNewId(ledger.businessHoldings, equity.id, "行权所得股权");
      if ((equity.instrumentType || "equity") !== "equity" || equity.business.id !== holding.business.id) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "行权所得必须是同一企业的普通股权 holding");
      }
      const grossEquityValue = roundWan(units * terms.fairValueWanPerUnit);
      const expectedEquityValue = roundWan(grossEquityValue * (1 - (equity.liquidityDiscountRate || 0)));
      if (roundWan(equity.personalCarryingValueWan) !== expectedEquityValue) throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", `行权所得股权账面价值应为 ${expectedEquityValue} 万元`);
      const previousOptionValue = holding.personalCarryingValueWan;
      changeCash(ledger, payload.sourceCashAccountId, -expectedCost);
      terms.exercisedUnits = roundWan(terms.exercisedUnits + units);
      holding.personalCarryingValueWan = optionCarryingValue(holding);
      if (terms.exercisedUnits === terms.grantedUnits) holding.status = "exercised";
      ledger.businessHoldings.push(equity);
      totals.assetPurchaseWan = roundWan(totals.assetPurchaseWan + expectedCost);
      totals.valuationChangeWan = roundWan(totals.valuationChangeWan + equity.personalCarryingValueWan + holding.personalCarryingValueWan - previousOptionValue);
      return;
    }
    case "business_option_expired":
    case "business_option_cancelled": {
      const holding = requiredOptionHolding(ledger, event.payload.businessHoldingId);
      totals.valuationChangeWan = roundWan(totals.valuationChangeWan - holding.personalCarryingValueWan);
      holding.personalCarryingValueWan = 0;
      holding.status = event.kind === "business_option_expired" ? "expired" : "cancelled";
      return;
    }
    case "business_holding_revalued": {
      const payload = event.payload;
      const holding = requiredById(ledger.businessHoldings, payload.businessHoldingId, "企业持股");
      if (roundWan(holding.personalCarryingValueWan) !== roundWan(payload.previousCarryingValueWan)) {
        throw new FinancialLedgerInvariantError("REVISION_CONFLICT", `企业持股 ${holding.id} 的旧账面价值不一致`);
      }
      if (payload.ownershipRate === undefined) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "个人企业权益调整必须提供持股比例");
      }
      if (payload.ownershipRate < 0 || payload.ownershipRate > 1) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "企业权益重估持股比例必须在 0-1 之间");
      }
      if (payload.postMoneyValuationWan === undefined) {
        if (roundWan(payload.newCarryingValueWan) !== roundWan(payload.previousCarryingValueWan)) {
          throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "没有企业估值时只能调整持股比例，不能改变个人账面价值");
        }
        holding.ownershipRate = payload.ownershipRate;
        holding.evidence.push(...structuredClone(payload.valuationEvidence));
        return;
      }
      const valuationWan = nonNegativeMoney(payload.postMoneyValuationWan, "business_holding_revalued.postMoneyValuationWan");
      const attributableValueWan = roundWan(valuationWan * payload.ownershipRate);
      const expectedCarryingValueWan = roundWan(attributableValueWan * (1 - (holding.liquidityDiscountRate || 0)));
      const nextValue = nonNegativeMoney(payload.newCarryingValueWan, "business_holding_revalued.newCarryingValueWan");
      if (nextValue !== expectedCarryingValueWan) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", `个人企业权益应为 ${expectedCarryingValueWan} 万元，不能直接搬运融资额或企业总估值`);
      }
      totals.valuationChangeWan = roundWan(totals.valuationChangeWan + nextValue - holding.personalCarryingValueWan);
      holding.personalCarryingValueWan = nextValue;
      holding.attributableValueWan = attributableValueWan;
      holding.business.latestPostMoneyValuationWan = valuationWan;
      holding.business.valuationAsOfAgeInMonths = event.effectiveAtAgeInMonths;
      holding.ownershipRate = payload.ownershipRate;
      holding.evidence.push(...structuredClone(payload.valuationEvidence));
      return;
    }
    case "business_distribution_received": {
      requiredById(ledger.businessHoldings, event.payload.businessHoldingId, "企业持股");
      const amount = positiveMoney(event.payload.amountWan, "business_distribution_received.amountWan");
      changeCash(ledger, event.payload.destinationCashAccountId, amount);
      totals.oneOffIncomeWan = roundWan(totals.oneOffIncomeWan + amount);
      return;
    }
    case "business_holding_sold": {
      const payload = event.payload;
      const holding = requiredById(ledger.businessHoldings, payload.businessHoldingId, "企业持股");
      const removed = positiveMoney(payload.holdingValueRemovedWan, "business_holding_sold.holdingValueRemovedWan");
      const received = positiveMoney(payload.cashReceivedWan, "business_holding_sold.cashReceivedWan");
      const fee = nonNegativeMoney(payload.transactionFeeWan, "business_holding_sold.transactionFeeWan");
      if (removed > holding.personalCarryingValueWan) throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "出售持股价值超过个人账面价值");
      if (holding.ownershipRate !== undefined && removed < holding.personalCarryingValueWan && payload.ownershipRateSold === undefined) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "部分出售企业权益必须提供出售持股比例");
      }
      if (payload.ownershipRateSold !== undefined) {
        if (payload.ownershipRateSold <= 0 || payload.ownershipRateSold > (holding.ownershipRate ?? 1)) {
          throw new FinancialLedgerInvariantError("INVALID_LEDGER", "出售持股比例超过当前个人持股");
        }
        if (holding.ownershipRate !== undefined) holding.ownershipRate = roundWan(holding.ownershipRate - payload.ownershipRateSold);
      }
      holding.personalCarryingValueWan = roundWan(holding.personalCarryingValueWan - removed);
      holding.status = holding.personalCarryingValueWan === 0 ? "sold" : "partially_sold";
      if (holding.status === "sold") {
        holding.ownershipRate = 0;
        holding.attributableValueWan = 0;
      }
      changeCash(ledger, payload.destinationCashAccountId, received - fee);
      totals.assetSaleProceedsWan = roundWan(totals.assetSaleProceedsWan + received);
      totals.otherExpenseWan = roundWan(totals.otherExpenseWan + fee);
      return;
    }
    default: {
      const exhaustive: never = event;
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `未实现财务事件: ${(exhaustive as { kind?: FinancialEventKind }).kind || "unknown"}`);
    }
  }
}

export function reduceFinancialLedger(input: {
  ledger: FinancialLedger;
  transactionId: string;
  expectedLedgerRevision: number;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  events: AcceptedFinancialEvent[];
  liquidityPolicy?: LiquidityPolicy;
}): ReduceFinancialLedgerResult {
  if (input.ledger.committedTransactionIds.includes(input.transactionId)) {
    return {
      ledger: input.ledger,
      transaction: input.ledger.recentTransactions.find((transaction) => transaction.simulationTransactionId === input.transactionId),
      alreadyCommitted: true
    };
  }
  if (input.expectedLedgerRevision !== input.ledger.revision) {
    throw new FinancialLedgerInvariantError("REVISION_CONFLICT", `账本 revision 冲突：期望 ${input.expectedLedgerRevision}，实际 ${input.ledger.revision}`);
  }
  if (input.periodStartAgeInMonths !== input.ledger.asOfAgeInMonths || input.periodEndAgeInMonths < input.periodStartAgeInMonths) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "事务阶段必须从账本当前时间开始，且结束不能早于开始");
  }

  const events = validateAcceptedFinancialEvents(input);
  const allEventIds = new Set(events.map((event) => event.id));
  const next = cloneLedger(input.ledger);
  let automaticShortfallAccount = consolidateAutomaticShortfallAccounts(next);
  const beforeCash = totalCashWan(next);
  const beforeAssets = totalAssetWan(next);
  const beforeDebt = totalDebtWan(next);
  const beforeNetWorth = ledgerNetWorthWan(next);
  const totals: EventTotals = {
    oneOffIncomeWan: 0,
    otherExpenseWan: 0,
    debtPrincipalPaidWan: 0,
    debtInterestPaidWan: 0,
    debtInterestLiabilityPaidWan: 0,
    debtInterestAccruedWan: 0,
    debtInterestUnpaidWan: 0,
    debtPrincipalDrawnWan: 0,
    debtPrincipalForgivenWan: 0,
    debtInterestForgivenWan: 0,
    debtCapitalizedInterestWan: 0,
    automaticLiquidityShortfallRecoveryWan: 0,
    debtServiceRecords: [],
    assetPurchaseWan: 0,
    assetSaleProceedsWan: 0,
    valuationChangeWan: 0,
    priorFactCorrectionWan: 0
  };
  let recurringIncomeWan = 0;
  let coreExpenseWan = 0;
  let cursor = input.periodStartAgeInMonths;
  const automaticLiquidityEventIds: string[] = [];
  const automaticLiquidityRecoveryEventIds: string[] = [];
  let automaticLiquidityShortfallIncreaseWan = 0;

  const closeLiquidityShortfall = (ageInMonths: number, allowed: boolean) => {
    const cash = totalCashWan(next);
    if (cash >= 0 || !allowed) return;
    const principalWan = roundWan(-cash);
    let auditEventId: string;
    if (automaticShortfallAccount) {
      automaticShortfallAccount.principalWan = roundWan(automaticShortfallAccount.principalWan + principalWan);
      automaticShortfallAccount.origin = "system_auto_shortfall";
      automaticShortfallAccount.repaymentPolicy = { mode: "event_driven" };
      automaticShortfallAccount.lastPrincipalIncreaseAtAgeInMonths = ageInMonths;
      auditEventId = `auto_shortfall_increase_${input.transactionId}_${ageInMonths}_${automaticLiquidityEventIds.length}`;
    } else {
      const id = `auto_shortfall_${input.transactionId}_${ageInMonths}`;
      automaticShortfallAccount = {
        id,
        type: "liquidity_shortfall",
        displayName: "自动流动性缺口",
        principalWan,
        openedAtAgeInMonths: ageInMonths,
        status: "active",
        repaymentPolicy: { mode: "event_driven" },
        factStatus: "known",
        origin: "system_auto_shortfall",
        accruedUnpaidInterestWan: 0,
        servicingStatus: "current",
        consecutiveMissedPaymentMonths: 0,
        totalMissedPaymentMonths: 0,
        recentMissedPaymentAgeInMonths: [],
        lastPrincipalIncreaseAtAgeInMonths: ageInMonths,
        evidence: [{
          source: "system_policy",
          reasonCode: "AUTOMATIC_LIQUIDITY_SHORTFALL",
          confidence: 1
        }]
      } as AutomaticShortfallDebt;
      next.debtAccounts.push(automaticShortfallAccount);
      // Preserve the original creation event identity for restored histories;
      // later increases receive their own transaction-scoped audit ids.
      auditEventId = id;
    }
    const account = next.cashAccounts.find((candidate) => candidate.id === PRIMARY_CASH_ACCOUNT_ID && candidate.status === "active")
      || next.cashAccounts.find((candidate) => candidate.status === "active");
    if (!account) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "自动流动性闭环缺少现金账户");
    account.balanceWan = roundWan(account.balanceWan + principalWan);
    automaticLiquidityShortfallIncreaseWan = roundWan(automaticLiquidityShortfallIncreaseWan + principalWan);
    automaticLiquidityEventIds.push(auditEventId);
  };

  const recoverAutomaticLiquidityShortfall = (ageInMonths: number): number => {
    if (!automaticShortfallAccount || automaticShortfallAccount.status !== "active") return 0;
    const activeMonthlyCoreExpenseWan = roundWan(next.expenseCommitments
      .filter((commitment) => commitment.status === "active"
        && commitment.activeFromAgeInMonths < ageInMonths
        && (commitment.activeUntilAgeInMonths === undefined || commitment.activeUntilAgeInMonths >= ageInMonths))
      .reduce((sum, commitment) => sum + commitment.monthlyAmountWan, 0));
    // Missing adult expense facts are blocking elsewhere. Never interpret the
    // missing commitment as a zero reserve and drain all cash here.
    if (ageInMonths >= 18 * 12 && activeMonthlyCoreExpenseWan <= 0) return 0;
    const cashReserveTargetWan = roundWan(activeMonthlyCoreExpenseWan * 3);
    const availableWan = roundWan(Math.max(0, totalCashWan(next) - cashReserveTargetWan));
    const recoveredWan = roundWan(Math.min(availableWan, automaticShortfallAccount.principalWan));
    if (recoveredWan <= 0) return 0;

    let remainingWan = recoveredWan;
    const orderedCashAccounts = [...next.cashAccounts]
      .filter((account) => account.status === "active" && account.balanceWan > 0)
      .sort((left, right) => {
        if (left.id === PRIMARY_CASH_ACCOUNT_ID) return -1;
        if (right.id === PRIMARY_CASH_ACCOUNT_ID) return 1;
        return left.id.localeCompare(right.id);
      });
    for (const account of orderedCashAccounts) {
      const paidWan = roundWan(Math.min(account.balanceWan, remainingWan));
      account.balanceWan = roundWan(account.balanceWan - paidWan);
      remainingWan = roundWan(remainingWan - paidWan);
      if (remainingWan <= 0) break;
    }
    if (remainingWan > 0.001) {
      throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "自动缺口债回补无法从现金账户完整扣除");
    }

    const recoveredDebtId = automaticShortfallAccount.id;
    automaticShortfallAccount.principalWan = roundWan(automaticShortfallAccount.principalWan - recoveredWan);
    automaticShortfallAccount.lastPaymentAtAgeInMonths = ageInMonths;
    automaticShortfallAccount.servicingStatus = "current";
    automaticShortfallAccount.consecutiveMissedPaymentMonths = 0;
    if (automaticShortfallAccount.principalWan === 0 && (automaticShortfallAccount.accruedUnpaidInterestWan ?? 0) === 0) {
      automaticShortfallAccount.status = "repaid";
      automaticShortfallAccount.closedAtAgeInMonths = ageInMonths;
      for (const issue of next.unresolvedIssues) {
        if (issue.status !== "resolved"
          && issue.code === "LIQUIDITY_SHORTFALL_PERSISTED"
          && issue.relatedDebtAccountIds?.includes(recoveredDebtId)) issue.status = "resolved";
      }
      automaticShortfallAccount = undefined;
    }
    automaticLiquidityRecoveryEventIds.push(
      `auto_shortfall_recovery_${input.transactionId}_${ageInMonths}_${automaticLiquidityRecoveryEventIds.length}`
    );
    return recoveredWan;
  };

  for (let index = 0; index < events.length;) {
    const boundary = events[index].effectiveAtAgeInMonths;
    let boundaryEnd = index;
    while (boundaryEnd < events.length && events[boundaryEnd].effectiveAtAgeInMonths === boundary) boundaryEnd += 1;
    const boundaryEvents = events.slice(index, boundaryEnd);
    const restructuringDebtIds = new Set(boundaryEvents
      .filter((event) => event.kind === "debt_restructured")
      .map((event) => event.kind === "debt_restructured" ? event.payload.oldDebtAccountId : ""));
    const accrual = accumulatePeriodAccrual(accruePeriodSlice(next, cursor, boundary, {
      closeNonDebtLiquidityShortfall: (ageInMonths) => closeLiquidityShortfall(ageInMonths, true),
      recoverAutomaticLiquidityShortfall,
      excludedDebtAccountIds: restructuringDebtIds
    }), totals);
    recurringIncomeWan = roundWan(recurringIncomeWan + accrual.incomeWan);
    coreExpenseWan = roundWan(coreExpenseWan + accrual.coreExpenseWan);
    while (index < boundaryEnd) {
      applyEvent(next, events[index], allEventIds, totals);
      index += 1;
    }
    automaticShortfallAccount = consolidateAutomaticShortfallAccounts(next) ?? automaticShortfallAccount;
    const containsForbiddenShortfallUse = boundaryEvents.some((event) => [
      "asset_purchased", "debt_principal_repaid", "debt_interest_paid", "debt_restructured"
    ].includes(event.kind));
    const mayUseSystemShortfall = input.liquidityPolicy === "auto_shortfall_debt"
      && !containsForbiddenShortfallUse
      && boundaryEvents.some((event) => event.kind === "one_off_expense_paid"
        && event.liquidityTreatment === "allow_system_shortfall");
    closeLiquidityShortfall(boundary, mayUseSystemShortfall);
    totals.automaticLiquidityShortfallRecoveryWan = roundWan(
      totals.automaticLiquidityShortfallRecoveryWan + recoverAutomaticLiquidityShortfall(boundary)
    );
    assertSufficientLiquidity(next, boundary);
    cursor = boundary;
  }
  const finalAccrual = accumulatePeriodAccrual(accruePeriodSlice(next, cursor, input.periodEndAgeInMonths, {
    closeNonDebtLiquidityShortfall: (ageInMonths) => closeLiquidityShortfall(ageInMonths, true),
    recoverAutomaticLiquidityShortfall
  }), totals);
  recurringIncomeWan = roundWan(recurringIncomeWan + finalAccrual.incomeWan);
  coreExpenseWan = roundWan(coreExpenseWan + finalAccrual.coreExpenseWan);

  assertSufficientLiquidity(next, input.periodEndAgeInMonths);

  next.asOfAgeInMonths = input.periodEndAgeInMonths;
  addDebtServiceIssues(next, totals.debtServiceRecords);
  addDebtScheduleReviewIssues(next);
  next.revision += 1;
  next.committedTransactionIds.push(input.transactionId);

  const afterCash = totalCashWan(next);
  const afterAssets = totalAssetWan(next);
  const afterDebt = totalDebtWan(next);
  const afterNetWorth = ledgerNetWorthWan(next);
  const incomeWan = roundWan(recurringIncomeWan + totals.oneOffIncomeWan);
  const expenseWan = roundWan(coreExpenseWan + totals.otherExpenseWan);
  const netWorthDeltaWan = roundWan(afterNetWorth - beforeNetWorth);
  const nonCashGainLossWan = roundWan(
    netWorthDeltaWan - incomeWan + expenseWan - totals.valuationChangeWan - totals.priorFactCorrectionWan
  );
  const expectedDebtDeltaWan = roundWan(
    totals.debtPrincipalDrawnWan
    + events.filter((event) => event.kind === "debt_balance_discovered")
      .reduce((sum, event) => sum + event.payload.debtAccount.principalWan, 0)
    + automaticLiquidityShortfallIncreaseWan
    + totals.debtInterestAccruedWan
    - totals.debtPrincipalPaidWan
    - totals.automaticLiquidityShortfallRecoveryWan
    - totals.debtPrincipalForgivenWan
    - totals.debtInterestLiabilityPaidWan
    - totals.debtInterestForgivenWan
  );
  const actualDebtDeltaWan = roundWan(afterDebt - beforeDebt);
  if (expectedDebtDeltaWan !== actualDebtDeltaWan) {
    throw new FinancialLedgerInvariantError(
      "UNBALANCED_TRANSACTION",
      `债务变化无法闭合：expected=${expectedDebtDeltaWan}, actual=${actualDebtDeltaWan}`
    );
  }
  const evidence = events.flatMap((event) => event.evidence);
  const debtBalanceDiscoveredWan = roundWan(events
    .filter((event) => event.kind === "debt_balance_discovered")
    .reduce((sum, event) => sum + event.payload.debtAccount.principalWan, 0));
  const transaction: FinancialTransaction = {
    id: `financial_${input.transactionId}`,
    simulationTransactionId: input.transactionId,
    eventIds: [...events.map((event) => event.id), ...automaticLiquidityEventIds, ...automaticLiquidityRecoveryEventIds],
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    cashDeltaWan: roundWan(afterCash - beforeCash),
    assetDeltaWan: roundWan(afterAssets - beforeAssets),
    debtDeltaWan: actualDebtDeltaWan,
    incomeWan,
    expenseWan,
    valuationChangeWan: totals.valuationChangeWan,
    priorFactCorrectionWan: totals.priorFactCorrectionWan,
    nonCashGainLossWan,
    netWorthDeltaWan,
    debtServiceRecords: totals.debtServiceRecords,
    automaticLiquidityShortfallIncreaseWan,
    automaticLiquidityShortfallRecoveryWan: totals.automaticLiquidityShortfallRecoveryWan,
    debtPrincipalDrawnWan: roundWan(totals.debtPrincipalDrawnWan + automaticLiquidityShortfallIncreaseWan),
    debtBalanceDiscoveredWan,
    debtPrincipalPaidWan: roundWan(totals.debtPrincipalPaidWan + totals.automaticLiquidityShortfallRecoveryWan),
    debtPrincipalForgivenWan: totals.debtPrincipalForgivenWan,
    debtInterestAccruedWan: totals.debtInterestAccruedWan,
    debtInterestPaidWan: totals.debtInterestPaidWan,
    debtInterestLiabilityPaidWan: totals.debtInterestLiabilityPaidWan,
    debtInterestForgivenWan: totals.debtInterestForgivenWan,
    debtCapitalizedInterestWan: totals.debtCapitalizedInterestWan,
    evidence
  } as FinancialTransaction;
  next.recentTransactions = [...next.recentTransactions, transaction].slice(-RECENT_TRANSACTION_LIMIT);
  assertFinancialLedgerInvariants(next);

  const expectedNetWorthDelta = roundWan(incomeWan - expenseWan + totals.valuationChangeWan + totals.priorFactCorrectionWan + nonCashGainLossWan);
  if (expectedNetWorthDelta !== netWorthDeltaWan) {
    throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "净资产变化无法由收入、支出、估值和非现金损益解释");
  }
  const periodSummary: FinancialPeriodSummary = {
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    incomeWan,
    coreExpenseWan,
    otherExpenseWan: totals.otherExpenseWan,
    debtPrincipalPaidWan: totals.debtPrincipalPaidWan,
    debtInterestPaidWan: totals.debtInterestPaidWan,
    debtInterestUnpaidWan: totals.debtInterestUnpaidWan,
    automaticLiquidityShortfallRecoveryWan: totals.automaticLiquidityShortfallRecoveryWan,
    assetPurchaseWan: totals.assetPurchaseWan,
    assetSaleProceedsWan: totals.assetSaleProceedsWan,
    valuationChangeWan: totals.valuationChangeWan,
    priorFactCorrectionWan: totals.priorFactCorrectionWan,
    netCashFlowWan: transaction.cashDeltaWan,
    netWorthChangeWan: netWorthDeltaWan,
    transactionIds: [transaction.id]
  };
  return { ledger: next, transaction, periodSummary, alreadyCommitted: false };
}
