import { accruePeriodSlice } from "./accruePeriod";
import { validateAcceptedFinancialEvents } from "./acceptFinancialEvents";
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
  assetPurchaseWan: number;
  assetSaleProceedsWan: number;
  valuationChangeWan: number;
}

function accumulatePeriodAccrual(
  accrual: ReturnType<typeof accruePeriodSlice>,
  totals: EventTotals
): { incomeWan: number; coreExpenseWan: number } {
  totals.debtPrincipalPaidWan = roundWan(totals.debtPrincipalPaidWan + accrual.debtPrincipalPaidWan);
  totals.debtInterestPaidWan = roundWan(totals.debtInterestPaidWan + accrual.debtInterestPaidWan);
  totals.otherExpenseWan = roundWan(totals.otherExpenseWan + accrual.debtInterestPaidWan);
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
      ledger.incomeSources.push({ ...structuredClone(source), accrualReviewStatus: "normal", lastConfirmedAtAgeInMonths: event.effectiveAtAgeInMonths });
      return;
    }
    case "income_source_adjusted": {
      const { incomeSourceId, nextSource } = event.payload;
      const index = ledger.incomeSources.findIndex((source) => source.id === incomeSourceId);
      if (index < 0 || nextSource.id !== incomeSourceId) throw new FinancialLedgerInvariantError("INVALID_LEDGER", `收入来源调整必须引用同一账户: ${incomeSourceId}`);
      validateIncomeSource(nextSource);
      ledger.incomeSources[index] = { ...structuredClone(nextSource), accrualReviewStatus: "normal", lastConfirmedAtAgeInMonths: event.effectiveAtAgeInMonths };
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
      ledger.debtAccounts.push(structuredClone(payload.debtAccount));
      changeCash(ledger, payload.destinationCashAccountId, principal);
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
      requiredById(ledger.debtAccounts, payload.debtAccountId, "债务账户");
      const interest = positiveMoney(payload.interestPaidWan, "debt_interest_paid.interestPaidWan");
      changeCash(ledger, payload.sourceCashAccountId, -interest);
      totals.debtInterestPaidWan = roundWan(totals.debtInterestPaidWan + interest);
      totals.otherExpenseWan = roundWan(totals.otherExpenseWan + interest);
      return;
    }
    case "debt_restructured": {
      const payload = event.payload;
      const oldDebt = requiredById(ledger.debtAccounts, payload.oldDebtAccountId, "旧债务账户");
      assertNewId(ledger.debtAccounts, payload.replacementDebtAccount.id, "替代债务账户");
      if (roundWan(oldDebt.principalWan) !== roundWan(payload.replacementDebtAccount.principalWan)) {
        throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "再融资替代债务必须承接相同本金；额外借款或减免需单独事件");
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
      ledger.debtAccounts.push(structuredClone(payload.replacementDebtAccount));
      return;
    }
    case "debt_forgiven": {
      const payload = event.payload;
      const debt = requiredById(ledger.debtAccounts, payload.debtAccountId, "债务账户");
      const forgiven = positiveMoney(payload.principalForgivenWan, "debt_forgiven.principalForgivenWan");
      if (forgiven > debt.principalWan) throw new FinancialLedgerInvariantError("UNBALANCED_TRANSACTION", "债务减免超过剩余本金");
      debt.principalWan = roundWan(debt.principalWan - forgiven);
      if (debt.principalWan === 0) {
        debt.status = "repaid";
        debt.closedAtAgeInMonths = event.effectiveAtAgeInMonths;
      }
      return;
    }
    case "business_holding_started": {
      const holding = event.payload;
      assertNewId(ledger.businessHoldings, holding.id, "企业持股");
      if (holding.instrumentType === "stock_option") {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权必须通过 business_option_granted 创建");
      }
      ledger.businessHoldings.push({ ...structuredClone(holding), instrumentType: holding.instrumentType || "equity" });
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
    case "business_option_granted": {
      const holding = structuredClone(event.payload.optionHolding);
      assertNewId(ledger.businessHoldings, holding.id, "企业期权");
      if (holding.instrumentType !== "stock_option" || !holding.optionTerms || holding.optionTerms.grantedUnits <= 0) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "期权授予事件必须创建具有正授予数量的 stock_option holding 和 optionTerms");
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
      if (payload.postMoneyValuationWan === undefined || payload.ownershipRate === undefined) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "个人企业权益重估必须同时提供企业估值和持股比例");
      }
      const valuationWan = nonNegativeMoney(payload.postMoneyValuationWan, "business_holding_revalued.postMoneyValuationWan");
      if (payload.ownershipRate < 0 || payload.ownershipRate > 1) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", "企业权益重估持股比例必须在 0-1 之间");
      }
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
  const beforeCash = totalCashWan(next);
  const beforeAssets = totalAssetWan(next);
  const beforeDebt = totalDebtWan(next);
  const beforeNetWorth = ledgerNetWorthWan(next);
  const totals: EventTotals = {
    oneOffIncomeWan: 0,
    otherExpenseWan: 0,
    debtPrincipalPaidWan: 0,
    debtInterestPaidWan: 0,
    assetPurchaseWan: 0,
    assetSaleProceedsWan: 0,
    valuationChangeWan: 0
  };
  let recurringIncomeWan = 0;
  let coreExpenseWan = 0;
  let cursor = input.periodStartAgeInMonths;
  const automaticLiquidityEventIds: string[] = [];
  const systemShortfallId = "system_liquidity_shortfall";

  const primaryCashAccount = () => next.cashAccounts.find((candidate) => candidate.id === PRIMARY_CASH_ACCOUNT_ID && candidate.status === "active")
    || next.cashAccounts.find((candidate) => candidate.status === "active");

  const systemShortfallAccount = () => next.debtAccounts.find((debt) => debt.id === systemShortfallId)
    || next.debtAccounts.find((debt) => debt.type === "liquidity_shortfall"
      && debt.evidence.some((item) => item.source === "system_policy"));

  const reconcileSystemLiquidity = (ageInMonths: number) => {
    const cash = totalCashWan(next);
    if (input.liquidityPolicy !== "auto_shortfall_debt") return;
    const account = primaryCashAccount();
    if (!account) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "自动流动性闭环缺少现金账户");
    if (cash < 0) {
      const principalWan = roundWan(-cash);
      let shortfall = systemShortfallAccount();
      if (!shortfall) {
        shortfall = {
          id: systemShortfallId,
          type: "liquidity_shortfall",
          displayName: "系统流动性滚动额度",
          principalWan: 0,
          openedAtAgeInMonths: ageInMonths,
          status: "active",
          repaymentPolicy: { mode: "event_driven" },
          factStatus: "known",
          evidence: [{ source: "system_policy", reasonCode: "SYSTEM_MANAGED_REVOLVING_SHORTFALL", confidence: 1 }]
        };
        next.debtAccounts.push(shortfall);
      }
      shortfall.status = "active";
      shortfall.closedAtAgeInMonths = undefined;
      shortfall.principalWan = roundWan(shortfall.principalWan + principalWan);
      account.balanceWan = roundWan(account.balanceWan + principalWan);
      automaticLiquidityEventIds.push(`auto_shortfall_draw_${input.transactionId}_${ageInMonths}_${automaticLiquidityEventIds.length}`);
      return;
    }
    const shortfall = systemShortfallAccount();
    if (!shortfall || shortfall.status !== "active" || shortfall.principalWan <= 0) return;
    const monthlyCoreExpenseWan = next.expenseCommitments
      .filter((commitment) => commitment.status === "active")
      .reduce((sum, commitment) => sum + commitment.monthlyAmountWan, 0);
    const reserveWan = roundWan(monthlyCoreExpenseWan * 3);
    const repayWan = roundWan(Math.min(shortfall.principalWan, Math.max(0, cash - reserveWan)));
    if (repayWan <= 0) return;
    account.balanceWan = roundWan(account.balanceWan - repayWan);
    shortfall.principalWan = roundWan(shortfall.principalWan - repayWan);
    totals.debtPrincipalPaidWan = roundWan(totals.debtPrincipalPaidWan + repayWan);
    if (shortfall.principalWan === 0) {
      shortfall.status = "repaid";
      shortfall.closedAtAgeInMonths = ageInMonths;
    }
    automaticLiquidityEventIds.push(`auto_shortfall_repayment_${input.transactionId}_${ageInMonths}_${automaticLiquidityEventIds.length}`);
  };

  for (let index = 0; index < events.length;) {
    const boundary = events[index].effectiveAtAgeInMonths;
    const accrual = accumulatePeriodAccrual(accruePeriodSlice(next, cursor, boundary), totals);
    recurringIncomeWan = roundWan(recurringIncomeWan + accrual.incomeWan);
    coreExpenseWan = roundWan(coreExpenseWan + accrual.coreExpenseWan);
    while (index < events.length && events[index].effectiveAtAgeInMonths === boundary) {
      applyEvent(next, events[index], allEventIds, totals);
      index += 1;
    }
    reconcileSystemLiquidity(boundary);
    assertSufficientLiquidity(next, boundary);
    cursor = boundary;
  }
  const finalAccrual = accumulatePeriodAccrual(accruePeriodSlice(next, cursor, input.periodEndAgeInMonths), totals);
  recurringIncomeWan = roundWan(recurringIncomeWan + finalAccrual.incomeWan);
  coreExpenseWan = roundWan(coreExpenseWan + finalAccrual.coreExpenseWan);

  reconcileSystemLiquidity(input.periodEndAgeInMonths);
  assertSufficientLiquidity(next, input.periodEndAgeInMonths);

  next.asOfAgeInMonths = input.periodEndAgeInMonths;
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
  const nonCashGainLossWan = roundWan(netWorthDeltaWan - incomeWan + expenseWan - totals.valuationChangeWan);
  const evidence = events.flatMap((event) => event.evidence);
  const transaction: FinancialTransaction = {
    id: `financial_${input.transactionId}`,
    simulationTransactionId: input.transactionId,
    eventIds: [...events.map((event) => event.id), ...automaticLiquidityEventIds],
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    cashDeltaWan: roundWan(afterCash - beforeCash),
    assetDeltaWan: roundWan(afterAssets - beforeAssets),
    debtDeltaWan: roundWan(afterDebt - beforeDebt),
    incomeWan,
    expenseWan,
    valuationChangeWan: totals.valuationChangeWan,
    nonCashGainLossWan,
    netWorthDeltaWan,
    evidence
  };
  next.recentTransactions = [...next.recentTransactions, transaction].slice(-RECENT_TRANSACTION_LIMIT);
  assertFinancialLedgerInvariants(next);

  const expectedNetWorthDelta = roundWan(incomeWan - expenseWan + totals.valuationChangeWan + nonCashGainLossWan);
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
    assetPurchaseWan: totals.assetPurchaseWan,
    assetSaleProceedsWan: totals.assetSaleProceedsWan,
    valuationChangeWan: totals.valuationChangeWan,
    netCashFlowWan: transaction.cashDeltaWan,
    netWorthChangeWan: netWorthDeltaWan,
    transactionIds: [transaction.id]
  };
  return { ledger: next, transaction, periodSummary, alreadyCommitted: false };
}
