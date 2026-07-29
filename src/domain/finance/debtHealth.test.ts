import assert from "node:assert/strict";
import test from "node:test";

/*
 * TDD contract for Spec §8 and §17.2.
 * The production module intentionally does not exist in the D0 baseline. Keep
 * imports lazy so every scenario is discovered and reported independently.
 */

type DebtHealthLevel =
  | "none"
  | "manageable"
  | "watch"
  | "distressed"
  | "default_risk"
  | "defaulted"
  | "unknown";

interface DebtHealthState {
  level: DebtHealthLevel;
  trend: "improving" | "stable" | "worsening" | "unknown";
  scheduledDebtServiceNext12MonthsWan: number;
  availableCashForDebtNext12MonthsWan: number;
  debtServiceCoverageRatio?: number;
  consecutiveMissedPaymentMonths: number;
  missedPaymentMonthsLast12: number;
  reasonCodes: string[];
  source: "authoritative_ledger" | "legacy_compatibility";
}

async function derive(input: Record<string, unknown>): Promise<DebtHealthState> {
  const modulePath = "./debtHealth";
  const module = await import(modulePath) as {
    deriveDebtHealthState: (value: Record<string, unknown>) => DebtHealthState;
  };
  return module.deriveDebtHealthState(input);
}

const evidence = [{ source: "accepted_history", reasonCode: "CONFIRMED", confidence: 1 }];

function debt(overrides: Record<string, unknown> = {}) {
  return {
    id: "mortgage_1",
    type: "mortgage",
    displayName: "住房贷款",
    principalWan: 60,
    accruedUnpaidInterestWan: 0,
    openedAtAgeInMonths: 300,
    status: "active",
    origin: "explicit",
    repaymentPolicy: {
      mode: "known_schedule",
      monthlyPrincipalWan: 0.5,
      monthlyInterestWan: 0.2,
      remainingTermMonths: 120
    },
    factStatus: "known",
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: [],
    evidence,
    ...overrides
  };
}

function ledger(input: {
  cashWan?: number;
  debts?: Array<Record<string, unknown>>;
  incomeSources?: Array<Record<string, unknown>>;
  expenseCommitments?: Array<Record<string, unknown>>;
  issues?: Array<Record<string, unknown>>;
  age?: number;
} = {}) {
  const age = input.age ?? 360;
  return {
    id: "ledger_debt_health",
    version: 3,
    revision: 7,
    owner: "protagonist",
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: age,
    cashAccounts: [{
      id: "primary_cash",
      type: "bank_deposit",
      balanceWan: input.cashWan ?? 20,
      status: "active",
      factStatus: "known",
      evidence
    }],
    assetAccounts: [],
    debtAccounts: input.debts ?? [debt()],
    incomeSources: input.incomeSources ?? [{
      id: "salary",
      type: "salary",
      displayName: "工资",
      monthlyNetAmountWan: 2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: age - 24,
      status: "active",
      factStatus: "known",
      evidence
    }],
    expenseCommitments: input.expenseCommitments ?? [{
      id: "living",
      type: "basic_living",
      displayName: "基本生活",
      monthlyAmountWan: 0.8,
      activeFromAgeInMonths: age - 24,
      status: "active",
      factStatus: "known",
      evidence
    }],
    businessHoldings: [],
    recentTransactions: [],
    committedTransactionIds: [],
    unresolvedIssues: input.issues ?? []
  };
}

function derivedFinancialState(overrides: Record<string, unknown> = {}) {
  return {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: 360,
    cashWan: 20,
    totalDebtWan: 60,
    netWorthWan: -40,
    annualizedRecurringIncomeWan: 24,
    annualizedCoreExpenseWan: 9.6,
    annualizedDisposableCashFlowWan: 14.4,
    ledgerRevision: 7,
    ...overrides
  };
}

test("D2-01 no active debt derives none", async () => {
  const result = await derive({
    ledger: ledger({ debts: [] }),
    derivedFinancialState: derivedFinancialState({ totalDebtWan: 0, netWorthWan: 20 })
  });
  assert.equal(result.level, "none");
  assert.ok(result.reasonCodes.includes("NO_ACTIVE_DEBT"));
  assert.equal(result.source, "authoritative_ledger");
});

test("D2-02 a large mortgage that remains affordable is manageable", async () => {
  const result = await derive({ ledger: ledger(), derivedFinancialState: derivedFinancialState() });
  assert.equal(result.level, "manageable");
  assert.ok((result.debtServiceCoverageRatio ?? 0) >= 1.2);
  assert.ok(result.reasonCodes.includes("PAYMENTS_CURRENT"));
});

test("D2-03 negative disposable cashflow is watch even before a missed payment", async () => {
  const currentLedger = ledger({
    cashWan: 1,
    expenseCommitments: [{
      id: "living",
      type: "basic_living",
      displayName: "基本生活",
      monthlyAmountWan: 2.2,
      activeFromAgeInMonths: 300,
      status: "active",
      factStatus: "known",
      evidence
    }]
  });
  const result = await derive({ ledger: currentLedger, derivedFinancialState: derivedFinancialState() });
  assert.equal(result.level, "watch");
  assert.ok(result.reasonCodes.includes("NEGATIVE_DISPOSABLE_CASHFLOW"));
});

test("D2-04 first partial payment is distressed but not defaulted", async () => {
  const partialDebt = debt({
    servicingStatus: "partial",
    consecutiveMissedPaymentMonths: 1,
    totalMissedPaymentMonths: 1,
    recentMissedPaymentAgeInMonths: [360],
    lastMissedPaymentAtAgeInMonths: 360
  });
  const result = await derive({ ledger: ledger({ debts: [partialDebt] }), derivedFinancialState: derivedFinancialState() });
  assert.equal(result.level, "distressed");
  assert.notEqual(result.level, "defaulted");
  assert.ok(result.reasonCodes.includes("RECENT_PARTIAL_PAYMENT"));
});

test("D2-05 two consecutive missed months derive default_risk", async () => {
  const missedDebt = debt({
    servicingStatus: "delinquent",
    consecutiveMissedPaymentMonths: 2,
    totalMissedPaymentMonths: 2,
    recentMissedPaymentAgeInMonths: [359, 360]
  });
  const result = await derive({ ledger: ledger({ debts: [missedDebt] }), derivedFinancialState: derivedFinancialState() });
  assert.equal(result.level, "default_risk");
  assert.equal(result.missedPaymentMonthsLast12, 2);
  assert.ok(result.reasonCodes.includes("CONSECUTIVE_MISSED_PAYMENTS"));
});

test("an old delinquency issue cannot permanently pin a recovered current account at default_risk", async () => {
  const currentLedger = ledger({
    age: 420,
    debts: [debt({
      principalWan: 40,
      servicingStatus: "current",
      consecutiveMissedPaymentMonths: 0,
      recentMissedPaymentAgeInMonths: []
    })],
    issues: [{
      id: "old_delinquency",
      code: "DEBT_PAYMENT_DELINQUENT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      relatedDebtAccountIds: ["mortgage_1"],
      summary: "历史逾期",
      createdAtAgeInMonths: 390,
      lastObservedAtAgeInMonths: 390
    }]
  });
  const result = await derive({ ledger: currentLedger, derivedFinancialState: derivedFinancialState({ asOfAgeInMonths: 420 }) });
  assert.notEqual(result.level, "default_risk");
  assert.equal(result.consecutiveMissedPaymentMonths, 0);
  assert.equal(result.missedPaymentMonthsLast12, 0);
});

test("D2-06 only an account-level formal default derives defaulted", async () => {
  const defaultedDebt = debt({ status: "defaulted", servicingStatus: "delinquent" });
  const result = await derive({ ledger: ledger({ debts: [defaultedDebt] }), derivedFinancialState: derivedFinancialState() });
  assert.equal(result.level, "defaulted");
  assert.ok(result.reasonCodes.includes("FORMAL_DEFAULT_RECORDED"));
});

test("D2-07 two recent automatic-shortfall increases derive distressed", async () => {
  const shortfall = debt({
    id: "auto_shortfall",
    type: "liquidity_shortfall",
    principalWan: 3,
    origin: "system_auto_shortfall",
    repaymentPolicy: { mode: "event_driven" },
    lastPrincipalIncreaseAtAgeInMonths: 360
  });
  const result = await derive({
    ledger: {
      ...ledger({ debts: [shortfall] }),
      recentTransactions: [
        { id: "tx_1", periodEndAgeInMonths: 358, automaticLiquidityShortfallIncreaseWan: 1 },
        { id: "tx_2", periodEndAgeInMonths: 360, automaticLiquidityShortfallIncreaseWan: 2 }
      ]
    },
    derivedFinancialState: derivedFinancialState({ totalDebtWan: 3 })
  });
  assert.equal(result.level, "distressed");
  assert.ok(result.reasonCodes.includes("LIQUIDITY_SHORTFALL_GROWING"));
});

test("D2-08 falling balance cannot be called recovering while missed payments continue", async () => {
  const previousDebtHealthState = {
    level: "distressed",
    trend: "worsening",
    totalDebtWan: 65,
    consecutiveMissedPaymentMonths: 1,
    liquidityShortfallDebtWan: 0,
    source: "authoritative_ledger"
  };
  const missedDebt = debt({
    principalWan: 60,
    servicingStatus: "delinquent",
    consecutiveMissedPaymentMonths: 2,
    recentMissedPaymentAgeInMonths: [359, 360]
  });
  const result = await derive({
    ledger: ledger({ debts: [missedDebt] }),
    derivedFinancialState: derivedFinancialState(),
    previousDebtHealthState
  });
  assert.notEqual(result.trend, "improving");
  assert.ok(result.reasonCodes.includes("CONSECUTIVE_MISSED_PAYMENTS"));
});

test("D2-09 sustainable payments can improve while debt remains positive", async () => {
  const previousDebtHealthState = {
    level: "distressed",
    trend: "worsening",
    totalDebtWan: 65,
    consecutiveMissedPaymentMonths: 1,
    liquidityShortfallDebtWan: 0,
    source: "authoritative_ledger"
  };
  const result = await derive({
    ledger: ledger({ debts: [debt({ principalWan: 60, servicingStatus: "current" })] }),
    derivedFinancialState: derivedFinancialState({ totalDebtWan: 60 }),
    previousDebtHealthState
  });
  assert.ok(["manageable", "watch"].includes(result.level));
  assert.equal(result.trend, "improving");
  assert.ok(result.reasonCodes.includes("COVERAGE_IMPROVING") || result.reasonCodes.includes("DEBT_BALANCE_IMPROVING"));
});

test("D2-10 unreliable legacy-only debt derives unknown, never a crisis level", async () => {
  const modulePath = "./debtHealth";
  const module = await import(modulePath) as {
    deriveLegacyCompatibleDebtHealthState: (value: Record<string, unknown>) => DebtHealthState;
  };
  const result = module.deriveLegacyCompatibleDebtHealthState({
    financialState: { totalDebtWan: 10, isEstimated: true },
    asOfAgeInMonths: 360
  });
  assert.equal(result.level, "unknown");
  assert.equal(result.source, "legacy_compatibility");
});

test("D2-11 twelve-month capacity respects a contract ending after three months", async () => {
  const age = 360;
  const contractLedger = ledger({
    age,
    cashWan: 0,
    incomeSources: [{
      id: "contract",
      type: "contract",
      displayName: "短期合同",
      monthlyNetAmountWan: 2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: age,
      activeUntilAgeInMonths: age + 3,
      status: "active",
      factStatus: "known",
      evidence
    }],
    expenseCommitments: []
  });
  const result = await derive({ ledger: contractLedger, derivedFinancialState: derivedFinancialState({ cashWan: 0 }) });
  assert.equal(result.availableCashForDebtNext12MonthsWan, 6);
  assert.notEqual(result.availableCashForDebtNext12MonthsWan, 24);
});

test("D2-12 legacy compatibility can never satisfy authoritative availability", async () => {
  const modulePath = "../../utils/eventEligibility";
  const module = await import(modulePath) as {
    matchesRequiredContext: (key: string, input: Record<string, unknown>) => boolean;
  };
  const history = [{
    age: 40,
    ageInMonths: 480,
    stage: "兼容历史",
    title: "旧节点",
    description: "旧节点没有权威账本。",
    selectedChoice: "继续",
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    choices: [{ id: "A", text: "继续", impactSummary: "继续" }],
    isEndingNode: false,
    debtHealthState: {
      level: "unknown",
      trend: "unknown",
      source: "legacy_compatibility"
    }
  }];
  assert.equal(module.matchesRequiredContext("debt_health_available", {
    attribs: history[0].attributes,
    userData: {},
    age: 40,
    history
  }), false);
});
