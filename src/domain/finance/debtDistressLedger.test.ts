import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import {
  FinancialLedgerInvariantError,
  ledgerNetWorthWan,
  PRIMARY_CASH_ACCOUNT_ID,
  totalDebtWan
} from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  DebtAccount,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEventProposal,
  FinancialEvidence,
  FinancialLedger
} from "./types";
import { validateFinancialProposals } from "./validateFinancialProposals";

/**
 * Executable acceptance tests for debt-distress spec section 17.1 (Gate D1).
 *
 * These tests intentionally describe the v3 contract before the production
 * implementation exists. Structural casts are confined to helpers so the
 * assertions remain executable against the current v2 ledger while still
 * pinning the exact v3 fields and semantics.
 */

const evidence: FinancialEvidence[] = [{
  source: "accepted_history",
  reasonCode: "DEBT_DISTRESS_D1_TEST",
  confidence: 1
}];

type DebtServiceRecordView = {
  debtAccountId: string;
  interestDueWan: number;
  interestPaidWan: number;
  interestUnpaidWan: number;
  principalDueWan: number;
  principalPaidWan: number;
  principalUnpaidWan: number;
  outcome: "paid" | "partial" | "missed";
};

type DebtV3View = DebtAccount & {
  origin: "explicit" | "system_auto_shortfall" | "legacy_migration";
  accruedUnpaidInterestWan: number;
  servicingStatus: "current" | "partial" | "missed" | "delinquent";
  consecutiveMissedPaymentMonths: number;
  totalMissedPaymentMonths: number;
  recentMissedPaymentAgeInMonths: number[];
  lastPrincipalIncreaseAtAgeInMonths?: number;
};

type TransactionV3View = {
  debtServiceRecords: DebtServiceRecordView[];
  automaticLiquidityShortfallIncreaseWan: number;
};

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  ageInMonths: number,
  payload: FinancialEventPayloadMap[K],
  extras: Record<string, unknown> = {}
): AcceptedFinancialEvent<K> {
  return {
    id,
    kind,
    effectiveAtAgeInMonths: ageInMonths,
    payload,
    evidence,
    acceptedByReasonCodes: ["STRUCTURED_FACT_ACCEPTED"],
    ...extras
  } as AcceptedFinancialEvent<K>;
}

function scheduledDebt(overrides: Partial<DebtV3View> = {}): DebtV3View {
  return {
    id: "scheduled_loan",
    type: "consumer_loan",
    displayName: "分期贷款",
    principalWan: 12,
    openedAtAgeInMonths: 240,
    status: "active",
    repaymentPolicy: {
      mode: "known_schedule",
      monthlyPrincipalWan: 1,
      monthlyInterestWan: 0.2,
      remainingTermMonths: 12
    },
    factStatus: "known",
    evidence,
    origin: "explicit",
    accruedUnpaidInterestWan: 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: [],
    ...overrides
  };
}

function ledger(input: {
  cashWan?: number;
  debts?: DebtAccount[];
  monthlyExpenseWan?: number;
  monthlyIncomeWan?: number;
  ageInMonths?: number;
} = {}): FinancialLedger {
  const age = input.ageInMonths ?? 240;
  return initializeFinancialLedger({
    id: `debt_distress_${age}`,
    asOfAgeInMonths: age,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: input.cashWan ?? 10,
        status: "active",
        factStatus: "known",
        evidence
      }],
      debtAccounts: input.debts,
      incomeSources: input.monthlyIncomeWan === undefined ? undefined : [{
        id: "salary",
        type: "salary",
        displayName: "工资",
        monthlyNetAmountWan: input.monthlyIncomeWan,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: age,
        status: "active",
        linkedCareerStateId: "career",
        factStatus: "known",
        evidence
      }],
      expenseCommitments: input.monthlyExpenseWan === undefined ? undefined : [{
        id: "essential_living",
        type: "basic_living",
        displayName: "必要生活支出",
        monthlyAmountWan: input.monthlyExpenseWan,
        activeFromAgeInMonths: age,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
}

function commitOneMonth(
  opening: FinancialLedger,
  transactionId: string,
  events: AcceptedFinancialEvent[] = [],
  liquidityPolicy: "require_explicit" | "auto_shortfall_debt" = "auto_shortfall_debt"
) {
  return reduceFinancialLedger({
    ledger: opening,
    transactionId,
    expectedLedgerRevision: opening.revision,
    periodStartAgeInMonths: opening.asOfAgeInMonths,
    periodEndAgeInMonths: opening.asOfAgeInMonths + 1,
    events,
    liquidityPolicy
  });
}

function committed(result: ReturnType<typeof reduceFinancialLedger>) {
  assert.equal(result.alreadyCommitted, false);
  if (result.alreadyCommitted) throw new Error("expected a newly committed financial transaction");
  return result;
}

function v3Debt(account: DebtAccount): DebtV3View {
  return account as DebtV3View;
}

function v3Transaction(value: unknown): TransactionV3View {
  return value as TransactionV3View;
}

test("D1-01 cash sufficient: pays scheduled interest and principal in full", () => {
  const result = committed(commitOneMonth(ledger({ cashWan: 5, debts: [scheduledDebt()] }), "d1_cash_sufficient"));
  const record = v3Transaction(result.transaction).debtServiceRecords[0];
  assert.equal(record.debtAccountId, "scheduled_loan");
  assert.equal(record.interestDueWan, 0.2);
  assert.equal(record.interestPaidWan, 0.2);
  assert.equal(record.interestUnpaidWan, 0);
  assert.equal(record.principalDueWan, 1);
  assert.equal(record.principalPaidWan, 1);
  assert.equal(record.principalUnpaidWan, 0);
  assert.equal(record.outcome, "paid");
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 3.8);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 11);
});

test("D1-02 cash covers only interest: principal remains unpaid without shortfall borrowing", () => {
  const result = committed(commitOneMonth(ledger({ cashWan: 0.2, debts: [scheduledDebt()] }), "d1_interest_only"));
  const record = v3Transaction(result.transaction).debtServiceRecords[0];
  assert.equal(record.interestPaidWan, 0.2);
  assert.equal(record.principalPaidWan, 0);
  assert.equal(record.principalUnpaidWan, 1);
  assert.equal(record.outcome, "partial");
  assert.equal(result.ledger.debtAccounts.filter((item) => item.type === "liquidity_shortfall").length, 0);
});

test("D1-03 cash covers partial interest: accrues unpaid interest and records missed payment", () => {
  const result = committed(commitOneMonth(ledger({ cashWan: 0.1, debts: [scheduledDebt()] }), "d1_partial_interest"));
  const debt = v3Debt(result.ledger.debtAccounts[0]);
  const record = v3Transaction(result.transaction).debtServiceRecords[0];
  assert.equal(record.interestPaidWan, 0.1);
  assert.equal(record.interestUnpaidWan, 0.1);
  assert.equal(record.principalUnpaidWan, 1);
  assert.equal(record.outcome, "partial");
  assert.equal(debt.accruedUnpaidInterestWan, 0.1);
  assert.equal(debt.consecutiveMissedPaymentMonths, 1);
  assert.equal(result.ledger.debtAccounts.filter((item) => item.type === "liquidity_shortfall").length, 0);
});

test("D1-04 non-debt recurring deficit floors cash and increases shortfall principal equally", () => {
  const result = committed(commitOneMonth(ledger({ cashWan: 0.25, monthlyExpenseWan: 1 }), "d1_living_shortfall"));
  const shortfall = v3Debt(result.ledger.debtAccounts.find((item) => item.type === "liquidity_shortfall")!);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(shortfall.principalWan, 0.75);
  assert.equal(shortfall.origin, "system_auto_shortfall");
  assert.equal(v3Transaction(result.transaction).automaticLiquidityShortfallIncreaseWan, 0.75);
});

test("D1-05 repeated deficits reuse exactly one active automatic shortfall account", () => {
  const first = committed(commitOneMonth(ledger({ cashWan: 0, monthlyExpenseWan: 1 }), "d1_shortfall_first"));
  const firstShortfallId = first.ledger.debtAccounts.find((item) => item.type === "liquidity_shortfall")!.id;
  const second = committed(commitOneMonth(first.ledger, "d1_shortfall_second"));
  const active = second.ledger.debtAccounts.filter((item) => item.type === "liquidity_shortfall" && item.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].id, firstShortfallId);
  assert.equal(active[0].principalWan, 2);
});

test("D1-06 each consolidated shortfall increase remains independently auditable", () => {
  const first = committed(commitOneMonth(ledger({ cashWan: 0, monthlyExpenseWan: 1 }), "d1_audit_first"));
  const second = committed(commitOneMonth(first.ledger, "d1_audit_second"));
  const firstAudit = v3Transaction(first.transaction);
  const secondAudit = v3Transaction(second.transaction);
  assert.equal(firstAudit.automaticLiquidityShortfallIncreaseWan, 1);
  assert.equal(secondAudit.automaticLiquidityShortfallIncreaseWan, 1);
  assert.notEqual(first.transaction.id, second.transaction.id);
});

test("D1-07 automatic shortfall remains event-driven after 24 months", () => {
  const opening = ledger({ cashWan: 0, monthlyExpenseWan: 1 });
  const first = committed(commitOneMonth(opening, "d1_long_shortfall_open"));
  const long = committed(reduceFinancialLedger({
    ledger: first.ledger,
    transactionId: "d1_long_shortfall_age",
    expectedLedgerRevision: first.ledger.revision,
    periodStartAgeInMonths: first.ledger.asOfAgeInMonths,
    periodEndAgeInMonths: first.ledger.asOfAgeInMonths + 25,
    events: [],
    liquidityPolicy: "auto_shortfall_debt"
  }));
  const shortfall = long.ledger.debtAccounts.find((item) => item.type === "liquidity_shortfall")!;
  assert.equal(shortfall.repaymentPolicy.mode, "event_driven");
  assert.equal(long.ledger.unresolvedIssues.some((issue) => issue.code === "UNKNOWN_DEBT_SCHEDULE"), false);
});

test("D1-08 shortfall debt never auto-services itself or creates descendant shortfall debt", () => {
  const shortfall = scheduledDebt({
    id: "automatic_shortfall",
    type: "liquidity_shortfall",
    origin: "system_auto_shortfall",
    principalWan: 2,
    repaymentPolicy: { mode: "event_driven" }
  });
  const result = committed(commitOneMonth(ledger({ cashWan: 0, debts: [shortfall] }), "d1_no_recursive_shortfall"));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(result.ledger.debtAccounts.length, 1);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 2);
  assert.equal(v3Transaction(result.transaction).debtServiceRecords.length, 0);
});

test("D1-09 unpaid interest is included in total debt and net worth", () => {
  const opening = ledger({ cashWan: 0.1, debts: [scheduledDebt()] });
  const beforeNetWorth = ledgerNetWorthWan(opening);
  const result = committed(commitOneMonth(opening, "d1_unpaid_interest_wealth"));
  assert.equal(totalDebtWan(result.ledger), 12.1);
  assert.equal(ledgerNetWorthWan(result.ledger), beforeNetWorth - 0.2);
  assert.equal((result.periodSummary as typeof result.periodSummary & { debtInterestUnpaidWan: number }).debtInterestUnpaidWan, 0.1);
});

test("D1-10 unpaid scheduled principal is not added to principal a second time", () => {
  const result = committed(commitOneMonth(ledger({ cashWan: 0.2, debts: [scheduledDebt()] }), "d1_no_duplicate_principal"));
  const record = v3Transaction(result.transaction).debtServiceRecords[0];
  assert.equal(record.principalDueWan, 1);
  assert.equal(record.principalPaidWan, 0);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 12);
  assert.equal(totalDebtWan(result.ledger), 12);
});

test("D1-11 first missed payment does not formally default the account", () => {
  const result = committed(commitOneMonth(ledger({ cashWan: 0, debts: [scheduledDebt()] }), "d1_first_missed"));
  const debt = v3Debt(result.ledger.debtAccounts[0]);
  assert.equal(debt.status, "active");
  assert.equal(debt.servicingStatus, "missed");
  assert.equal(debt.consecutiveMissedPaymentMonths, 1);
  assert.equal(result.ledger.unresolvedIssues.some((issue) => String(issue.code) === "DEBT_PAYMENT_MISSED"), true);
});

test("D1-11b repeated missed payments update one active servicing issue per debt", () => {
  const first = committed(commitOneMonth(ledger({ cashWan: 0, debts: [scheduledDebt()] }), "d1_servicing_issue_1"));
  const second = committed(commitOneMonth(first.ledger, "d1_servicing_issue_2"));
  const third = committed(commitOneMonth(second.ledger, "d1_servicing_issue_3"));
  const active = third.ledger.unresolvedIssues.filter((issue) => (
    (issue.status ?? "open") === "open"
    && (issue.code === "DEBT_PAYMENT_MISSED" || issue.code === "DEBT_PAYMENT_DELINQUENT")
    && issue.relatedDebtAccountIds?.includes("scheduled_loan")
  ));
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "debt_payment_servicing_scheduled_loan");
  assert.equal(active[0].code, "DEBT_PAYMENT_DELINQUENT");
  assert.equal(active[0].occurrenceCount, 3);
  assert.equal(active[0].lastObservedAtAgeInMonths, 243);
});

test("D1-12 only an accepted formal default event changes lifecycle status to defaulted", () => {
  const opening = ledger({ cashWan: 0, debts: [scheduledDebt()] });
  const missed = committed(commitOneMonth(opening, "d1_before_default"));
  assert.notEqual(missed.ledger.debtAccounts[0].status, "defaulted");
  const defaultEvent = {
    id: "formal_default",
    kind: "debt_default_recorded",
    effectiveAtAgeInMonths: 242,
    payload: { debtAccountId: "scheduled_loan", reason: "explicit_default" },
    evidence,
    acceptedByReasonCodes: ["EXPLICIT_DEFAULT_EVIDENCE"]
  } as unknown as AcceptedFinancialEvent;
  const defaulted = committed(commitOneMonth(missed.ledger, "d1_formal_default", [defaultEvent]));
  assert.equal(defaulted.ledger.debtAccounts[0].status, "defaulted");
  assert.equal(v3Debt(defaulted.ledger.debtAccounts[0]).servicingStatus, "delinquent");
});

test("D1-13 restructuring conserves principal plus accrued unpaid interest", () => {
  const oldDebt = scheduledDebt({ principalWan: 5, accruedUnpaidInterestWan: 0.4 });
  const replacement = scheduledDebt({ id: "replacement", principalWan: 5.4, openedAtAgeInMonths: 241 });
  const opening = ledger({ cashWan: 2, debts: [oldDebt] });
  const result = committed(commitOneMonth(opening, "d1_restructure_conservation", [accepted(
    "restructure",
    "debt_restructured",
    241,
    {
      oldDebtAccountId: oldDebt.id,
      replacementDebtAccount: replacement,
      transactionFeeWan: 0,
      capitalizedInterestWan: 0.4
    } as FinancialEventPayloadMap["debt_restructured"]
  )], "require_explicit"));
  assert.equal(result.ledger.debtAccounts[0].status, "restructured");
  assert.equal(totalDebtWan(result.ledger), 5.4);
  assert.equal(v3Debt(result.ledger.debtAccounts[1]).accruedUnpaidInterestWan, 0);
});

test("D1-14 forgiving accrued interest is non-cash and does not increase income", () => {
  const opening = ledger({ cashWan: 2, debts: [scheduledDebt({ type: "family_or_personal_loan", principalWan: 5, accruedUnpaidInterestWan: 0.4, repaymentPolicy: { mode: "event_driven" } })] });
  const result = committed(commitOneMonth(opening, "d1_interest_forgiveness", [accepted(
    "forgive_interest",
    "debt_forgiven",
    241,
    { debtAccountId: "scheduled_loan", principalForgivenWan: 0, accruedInterestForgivenWan: 0.4 } as FinancialEventPayloadMap["debt_forgiven"]
  )], "require_explicit"));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 2);
  assert.equal(result.periodSummary.incomeWan, 0);
  assert.equal(v3Debt(result.ledger.debtAccounts[0]).accruedUnpaidInterestWan, 0);
  assert.equal(result.transaction.nonCashGainLossWan, 0.4);
});

test("D1-15 retrying one transaction cannot duplicate missed counters or shortfall increments", () => {
  const first = committed(commitOneMonth(ledger({ cashWan: 0, monthlyExpenseWan: 1, debts: [scheduledDebt()] }), "d1_idempotent"));
  const firstDebt = v3Debt(first.ledger.debtAccounts.find((item) => item.id === "scheduled_loan")!);
  const firstShortfall = first.ledger.debtAccounts.find((item) => item.type === "liquidity_shortfall")!;
  const retried = reduceFinancialLedger({
    ledger: first.ledger,
    transactionId: "d1_idempotent",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [],
    liquidityPolicy: "auto_shortfall_debt"
  });
  assert.equal(retried.alreadyCommitted, true);
  assert.equal(v3Debt(retried.ledger.debtAccounts.find((item) => item.id === "scheduled_loan")!).consecutiveMissedPaymentMonths, firstDebt.consecutiveMissedPaymentMonths);
  assert.equal(retried.ledger.debtAccounts.find((item) => item.id === firstShortfall.id)!.principalWan, firstShortfall.principalWan);
});

test("D1-16 v2-to-v3 migration consolidates legacy shortfalls without changing cash, debt or net worth", async () => {
  const legacy = ledger({
    cashWan: 3,
    debts: [
      scheduledDebt({ id: "legacy_shortfall_1", type: "liquidity_shortfall", principalWan: 1, repaymentPolicy: { mode: "event_driven" } }),
      scheduledDebt({ id: "legacy_shortfall_2", type: "liquidity_shortfall", principalWan: 2, repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.1 } })
    ]
  });
  const before = { cash: legacy.cashAccounts[0].balanceWan, debt: totalDebtWan(legacy), netWorth: ledgerNetWorthWan(legacy) };
  const modulePath = "./migrateFinancialLedgerV2ToV3.ts";
  const migrationModule = await import(modulePath).catch(() => undefined) as undefined | {
    migrateFinancialLedgerV2ToV3: (value: FinancialLedger) => FinancialLedger;
  };
  assert.ok(migrationModule, "migrateFinancialLedgerV2ToV3 must exist for Gate D1");
  const migrated = migrationModule.migrateFinancialLedgerV2ToV3(legacy);
  const active = migrated.debtAccounts.filter((item) => item.type === "liquidity_shortfall" && item.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].repaymentPolicy.mode, "event_driven");
  assert.deepEqual(
    { cash: migrated.cashAccounts[0].balanceWan, debt: totalDebtWan(migrated), netWorth: ledgerNetWorthWan(migrated) },
    before
  );
});

test("D1-17 proposals default to explicit funding while deterministic essential obligations may create shortfall", () => {
  const opening = ledger({ cashWan: 0, monthlyExpenseWan: 1 });
  const result = committed(commitOneMonth(opening, "d1_deterministic_obligation", [], "require_explicit"));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(result.ledger.debtAccounts.filter((item) => item.type === "liquidity_shortfall").length, 1);

  const proposed = validateFinancialProposals({
    proposals: [{
      id: "optional_purchase",
      kind: "asset_purchased",
      effectiveAtAgeInMonths: 241,
      payload: {
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        assetAccount: { id: "optional_asset", type: "other_personal_asset", displayName: "可选资产", marketValueWan: 1, liquidity: "liquid", status: "active", factStatus: "known", openedAtAgeInMonths: 241, evidence },
        cashPaidWan: 1,
        transactionFeeWan: 0
      },
      sourceOutcomeId: "choice",
      evidence: "你已经购买1万元可选资产。",
      confidence: 0.9
    }],
    currentLedger: opening,
    currentCareerState: initializeCareerState({ id: "career", employmentStatus: "employed", effectiveFromAgeInMonths: 240 }),
    acceptedOutcomeId: "choice",
    narrativeText: "你已经购买1万元可选资产。",
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    simulationTransactionId: "d1_default_trial"
  });
  assert.equal(proposed.acceptedEvents.length, 0);
  assert.equal(proposed.issues.some((issue) => issue.code === "MISSING_FUNDING_SOURCE"), true);
});

test("D1-18 asset purchase, debt payment and restructure fee cannot use automatic shortfall", () => {
  const opening = ledger({ cashWan: 0, debts: [scheduledDebt({ type: "family_or_personal_loan", repaymentPolicy: { mode: "event_driven" } })] });
  const forbidden: AcceptedFinancialEvent[][] = [
    [accepted("purchase", "asset_purchased", 241, {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      assetAccount: { id: "asset", type: "other_personal_asset", displayName: "资产", marketValueWan: 1, liquidity: "liquid", status: "active", factStatus: "known", openedAtAgeInMonths: 241, evidence },
      cashPaidWan: 1,
      transactionFeeWan: 0
    })],
    [accepted("repay", "debt_principal_repaid", 241, { debtAccountId: "scheduled_loan", sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, principalPaidWan: 1 })],
    [accepted("restructure_fee", "debt_restructured", 241, {
      oldDebtAccountId: "scheduled_loan",
      replacementDebtAccount: scheduledDebt({ id: "replacement", type: "family_or_personal_loan", repaymentPolicy: { mode: "event_driven" } }),
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      transactionFeeWan: 1
    })]
  ];
  for (const [index, events] of forbidden.entries()) {
    assert.throws(() => commitOneMonth(opening, `d1_forbidden_${index}`, events, "auto_shortfall_debt"),
      (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");
  }
});

test("D1-19 only validator-marked incurred essential expense may use system shortfall on second trial", () => {
  const opening = ledger({ cashWan: 0 });
  const expense = accepted("incurred_medical", "one_off_expense_paid", 241, {
    sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
    amountWan: 1
  });
  assert.throws(() => commitOneMonth(opening, "d1_unmarked_expense", [expense], "auto_shortfall_debt"),
    (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");

  const marked = { ...expense, liquidityTreatment: "allow_system_shortfall" } as AcceptedFinancialEvent;
  const result = committed(commitOneMonth(opening, "d1_marked_expense", [marked], "auto_shortfall_debt"));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(result.ledger.debtAccounts.find((item) => item.type === "liquidity_shortfall")!.principalWan, 1);
});

test("D1-20 rejected proposal does not commit, while independent deterministic settlement stays committable", () => {
  const opening = ledger({ cashWan: 0, monthlyIncomeWan: 0.5, monthlyExpenseWan: 1 });
  const proposal: FinancialEventProposal = {
    id: "unfunded_asset",
    kind: "asset_purchased",
    effectiveAtAgeInMonths: 241,
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      assetAccount: { id: "never_committed", type: "other", displayName: "未购资产", marketValueWan: 2, liquidity: "liquid", status: "active", factStatus: "known", evidence },
      cashPaidWan: 2,
      transactionFeeWan: 0
    },
    sourceOutcomeId: "choice",
    evidence: "你尝试购买2万元资产，但资金不足。",
    confidence: 0.9
  };
  const validation = validateFinancialProposals({
    proposals: [proposal],
    currentLedger: opening,
    currentCareerState: initializeCareerState({ id: "career", employmentStatus: "employed", effectiveFromAgeInMonths: 240 }),
    acceptedOutcomeId: "choice",
    narrativeText: proposal.evidence,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    simulationTransactionId: "d1_repair_failure"
  });
  assert.equal(validation.acceptedEvents.length, 0);
  assert.equal(validation.issues.some((issue) => issue.relatedProposalIds.includes("unfunded_asset")), true);

  const deterministic = committed(commitOneMonth(opening, "d1_after_repair_failure", [], "require_explicit"));
  assert.equal(deterministic.ledger.assetAccounts.some((item) => item.id === "never_committed"), false);
  assert.equal(deterministic.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(deterministic.ledger.debtAccounts.find((item) => item.type === "liquidity_shortfall")!.principalWan, 0.5);
});
