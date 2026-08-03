import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialState } from "../../types";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, ledgerNetWorthWan, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  BusinessHolding,
  DebtAccount,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEvidence,
  FinancialLedger,
  IncomeSource
} from "./types";

const evidence: FinancialEvidence[] = [{
  source: "accepted_simulation_outcome",
  sourceEventId: "accepted_outcome",
  reasonCode: "OUTCOME_CONFIRMED",
  confidence: 1
}];

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  effectiveAtAgeInMonths: number,
  payload: FinancialEventPayloadMap[K]
): AcceptedFinancialEvent<K> {
  return {
    id,
    kind,
    effectiveAtAgeInMonths,
    payload,
    evidence,
    acceptedByReasonCodes: ["STRUCTURED_FACT_ACCEPTED"]
  } as AcceptedFinancialEvent<K>;
}

function ledgerAt(ageInMonths = 240, cashWan = 20): FinancialLedger {
  return initializeFinancialLedger({
    id: "ledger_test",
    asOfAgeInMonths: ageInMonths,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: cashWan,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
}

function debt(id: string, principalWan: number, type: DebtAccount["type"] = "family_or_personal_loan"): DebtAccount {
  const requiresAmortization = ["mortgage", "consumer_loan", "student_loan", "credit_balance"].includes(type);
  return {
    id,
    type,
    displayName: id,
    principalWan,
    openedAtAgeInMonths: 240,
    status: "active",
    repaymentPolicy: requiresAmortization
      ? { mode: "estimated_amortizing", monthlyPrincipalWan: 1, monthlyInterestWan: 0.1, remainingTermMonths: Math.ceil(principalWan) }
      : { mode: "event_driven" },
    factStatus: "known",
    evidence
  };
}

test("initializes a version 3 protagonist ledger and derives the compatibility snapshot", () => {
  const ledger = ledgerAt(240, 12.5);
  const derived = deriveFinancialState({ ledger, employmentStatus: "employed" });

  assert.equal(ledger.version, 3);
  assert.equal(ledger.revision, 0);
  assert.equal(derived.state.cashWan, 12.5);
  assert.equal(derived.state.netWorthWan, 12.5);
  assert.equal(derived.state.employmentStatus, "employed");
  assert.equal(derived.compatibilityState.netWorthWan, 12.5);
});

test("rejects invalid opening balances before they can become authoritative", () => {
  assert.throws(() => initializeFinancialLedger({
    id: "invalid_opening",
    asOfAgeInMonths: 240,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: -1,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "INVALID_LEDGER");
});

test("accrues recurring income and commitments only for their actual active months", () => {
  const salary: IncomeSource = {
    id: "salary_primary",
    type: "salary",
    displayName: "税后工资",
    monthlyNetAmountWan: 2,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 240,
    status: "active",
    linkedCareerStateId: "career_1",
    factStatus: "known",
    evidence
  };
  const ledger = initializeFinancialLedger({
    id: "ledger_accrual",
    asOfAgeInMonths: 240,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      incomeSources: [salary],
      expenseCommitments: [{
        id: "living",
        type: "basic_living",
        displayName: "基本生活",
        monthlyAmountWan: 1,
        activeFromAgeInMonths: 240,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_accrual",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 246,
    events: [accepted("salary_end", "income_source_ended", 243, { incomeSourceId: "salary_primary" })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.periodSummary.incomeWan, 6);
  assert.equal(result.periodSummary.coreExpenseWan, 6);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 10);

  const derived = deriveFinancialState({ ledger: result.ledger, periodSummary: result.periodSummary, employmentStatus: "not_working" });
  assert.equal(derived.state.periodIncomeWan, 6);
  assert.equal(derived.state.annualizedRecurringIncomeWan, 0);
  assert.equal(derived.state.annualizedCoreExpenseWan, 12);
  assert.equal(derived.state.annualizedDisposableCashFlowWan, -12);
});

test("accepted income facts replace stale account evidence on start and adjustment", () => {
  const staleEvidence: FinancialEvidence[] = [{
    source: "accepted_simulation_outcome",
    sourceEventId: "stale_outcome",
    excerpt: "前三个月没有任何个人收入。",
    reasonCode: "EVIDENCE_EXACT_MATCHED",
    confidence: 0.9
  }];
  const ledger = ledgerAt(240, 10);
  ledger.incomeSources.push({
    id: "owner_draw",
    type: "self_employment_draw",
    displayName: "创业个人工资",
    monthlyNetAmountWan: 0.5,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 240,
    status: "active",
    linkedCareerStateId: "career_founder",
    factStatus: "known",
    evidence: staleEvidence
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_income_evidence_refresh",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [accepted("owner_draw_adjusted", "income_source_adjusted", 240, {
      incomeSourceId: "owner_draw",
      nextSource: { ...ledger.incomeSources[0], monthlyNetAmountWan: 4 }
    })]
  });
  assert.deepEqual(result.ledger.incomeSources[0].evidence, evidence);
  assert.equal(result.ledger.incomeSources[0].monthlyNetAmountWan, 4);
  assert.equal(result.ledger.incomeSources[0].lastConfirmedAtAgeInMonths, 240);
});

test("transaction audit retains each accepted event evidence instead of conflating same-period facts", () => {
  const ledger = ledgerAt(240, 10);
  const salaryEvidence: FinancialEvidence[] = [{
    source: "accepted_simulation_outcome",
    sourceEventId: "salary_outcome",
    excerpt: "你继续在原公司工作，年税后收入稳定在32万元。",
    reasonCode: "EVIDENCE_EXACT_MATCHED",
    confidence: 1,
    financialScope: "personal"
  }];
  const restrictedFundEvidence: FinancialEvidence[] = [{
    source: "accepted_simulation_outcome",
    sourceEventId: "project_outcome",
    excerpt: "你申请到一笔10万元的项目基金，用于为5所村小提供硬件和教师津贴。",
    reasonCode: "EVIDENCE_EXACT_MATCHED",
    confidence: 1,
    financialScope: "business_operating"
  }];
  ledger.businessHoldings.push({
    id: "holding_project",
    business: {
      id: "project_entity",
      displayName: "公益项目机构",
      status: "operating",
      factStatus: "known",
      evidence: restrictedFundEvidence
    },
    ownershipRate: 1,
    personalCarryingValueWan: 0,
    status: "active",
    factStatus: "known",
    evidence: restrictedFundEvidence
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_event_audit",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [
      {
        ...accepted("personal_salary", "one_off_income_received", 241, {
          destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
          amountWan: 2
        }),
        evidence: salaryEvidence
      },
      {
        ...accepted("restricted_project_fact", "business_financing_recorded", 241, {
          businessHoldingId: "holding_project",
          financingAmountWan: 1,
          personalCashReceivedWan: 0
        }),
        evidence: restrictedFundEvidence
      }
    ]
  });
  assert.deepEqual(result.transaction.acceptedEventAudit, [
    { eventId: "personal_salary", kind: "one_off_income_received", evidence: salaryEvidence },
    { eventId: "restricted_project_fact", kind: "business_financing_recorded", evidence: restrictedFundEvidence }
  ]);
});

test("rejects business-scoped restricted funding before a one-off personal cash credit", () => {
  const ledger = ledgerAt(240, 10);
  const restrictedFundEvidence: FinancialEvidence[] = [{
    source: "accepted_simulation_outcome",
    sourceEventId: "project_outcome",
    excerpt: "你申请到一笔10万元的项目基金，用于为5所村小提供硬件和教师津贴。",
    reasonCode: "EVIDENCE_EXACT_MATCHED",
    confidence: 1,
    financialScope: "business_operating"
  }];
  assert.throws(() => reduceFinancialLedger({
    ledger,
    transactionId: "tx_restricted_project_one_off",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [{
      ...accepted("restricted_project_fact", "one_off_income_received", 241, {
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 1
      }),
      evidence: restrictedFundEvidence
    }]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "INVALID_LEDGER");
  assert.equal(ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(ledger.revision, 0);
});

test("rejects business-scoped restricted funding before a holding-backed distribution can credit personal cash", () => {
  const ledger = ledgerAt(240, 10);
  const restrictedFundEvidence: FinancialEvidence[] = [{
    source: "accepted_simulation_outcome",
    sourceEventId: "project_outcome",
    excerpt: "公司收到10万元公益项目款，仅限用于项目执行。",
    reasonCode: "EVIDENCE_EXACT_MATCHED",
    confidence: 1,
    financialScope: "business_operating"
  }];
  ledger.businessHoldings.push({
    id: "holding_project",
    business: {
      id: "project_entity",
      displayName: "公益项目机构",
      status: "operating",
      factStatus: "known",
      evidence: restrictedFundEvidence
    },
    ownershipRate: 1,
    personalCarryingValueWan: 0,
    status: "active",
    factStatus: "known",
    evidence: restrictedFundEvidence
  });
  assert.throws(() => reduceFinancialLedger({
    ledger,
    transactionId: "tx_restricted_project_distribution",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [{
      ...accepted("restricted_project_distribution", "business_distribution_received", 241, {
        businessHoldingId: "holding_project",
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 1
      }),
      evidence: restrictedFundEvidence
    }]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "INVALID_LEDGER");
  assert.equal(ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(ledger.revision, 0);
});

test("cash purchase plus linked borrowing preserves principal transfer and charges only real loss", () => {
  const ledger = ledgerAt(240, 21);
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_home",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [
      accepted("mortgage_draw", "debt_drawn", 241, {
        debtAccount: debt("mortgage", 80, "mortgage"),
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        principalDrawnWan: 80
      }),
      accepted("home_purchase", "asset_purchased", 241, {
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        assetAccount: {
          id: "home",
          type: "property",
          displayName: "自住房",
          marketValueWan: 100,
          liquidity: "illiquid",
          status: "active",
          factStatus: "known",
          openedAtAgeInMonths: 241,
          evidence
        },
        cashPaidWan: 100,
        transactionFeeWan: 1,
        linkedDebtDrawEventId: "mortgage_draw"
      })
    ]
  });

  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 80);
  assert.equal(result.ledger.assetAccounts[0].marketValueWan, 100);
  assert.equal(result.periodSummary.netWorthChangeWan, -1);
  assert.equal(ledgerNetWorthWan(result.ledger), 20);
});

test("borrowing, principal repayment and interest use different accounting directions", () => {
  const ledger = ledgerAt(240, 20);
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_debt",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [
      accepted("draw", "debt_drawn", 240, {
        debtAccount: debt("loan", 10),
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        principalDrawnWan: 10
      }),
      accepted("repay", "debt_principal_repaid", 241, {
        debtAccountId: "loan",
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        principalPaidWan: 4
      }),
      accepted("interest", "debt_interest_paid", 241, {
        debtAccountId: "loan",
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        interestPaidWan: 1
      })
    ]
  });

  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 25);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 6);
  assert.equal(result.periodSummary.debtPrincipalPaidWan, 4);
  assert.equal(result.periodSummary.debtInterestPaidWan, 1);
  assert.equal(result.periodSummary.netWorthChangeWan, -1);
  assert.deepEqual(result.transaction.debtSettlementAccountIds, ["loan"]);
});

test("company financing changes company facts but never personal cash or carrying value", () => {
  const holding: BusinessHolding = {
    id: "holding_startup",
    business: {
      id: "startup",
      displayName: "创业公司",
      status: "operating",
      factStatus: "known",
      evidence
    },
    ownershipRate: 0.6,
    personalCarryingValueWan: 10,
    status: "active",
    factStatus: "known",
    evidence
  };
  const ledger = initializeFinancialLedger({
    id: "ledger_business",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 5, status: "active", factStatus: "known", evidence }],
      businessHoldings: [holding]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_financing",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 301,
    events: [accepted("financing", "business_financing_recorded", 301, {
      businessHoldingId: "holding_startup",
      financingAmountWan: 1000,
      postMoneyValuationWan: 5000,
      ownershipRateAfterFinancing: 0.5,
      personalCashReceivedWan: 0
    })]
  });

  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 5);
  assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 10);
  assert.equal(result.ledger.businessHoldings[0].business.latestPostMoneyValuationWan, 5000);
  assert.equal(result.periodSummary.netWorthChangeWan, 0);
});

test("financing amount alone marks personal business value for review instead of inventing wealth", () => {
  const holding: BusinessHolding = {
    id: "holding_unknown",
    business: { id: "company_unknown", displayName: "待核实公司", status: "operating", factStatus: "known", evidence },
    personalCarryingValueWan: 3,
    status: "active",
    factStatus: "known",
    evidence
  };
  const ledger = initializeFinancialLedger({
    id: "ledger_unknown_financing",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 5, status: "active", factStatus: "known", evidence }],
      businessHoldings: [holding]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_unknown_financing",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 301,
    events: [accepted("financing_only", "business_financing_recorded", 301, {
      businessHoldingId: "holding_unknown",
      financingAmountWan: 500,
      personalCashReceivedWan: 0
    })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 5);
  assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 3);
  assert.equal(result.ledger.businessHoldings[0].factStatus, "needs_review");
  assert.equal(result.ledger.unresolvedIssues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
});

test("requires an explicit funding event and never silently commits negative cash", () => {
  const ledger = ledgerAt(240, 1);
  const expense = accepted("expense", "one_off_expense_paid", 241, {
    sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
    amountWan: 3
  });
  assert.throws(() => reduceFinancialLedger({
    ledger,
    transactionId: "tx_unfunded",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [expense]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");
  assert.equal(ledger.cashAccounts[0].balanceWan, 1);
  assert.equal(ledger.revision, 0);

  const funded = reduceFinancialLedger({
    ledger,
    transactionId: "tx_funded",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [
      expense,
      accepted("shortfall", "liquidity_shortfall_created", 241, {
        debtAccount: debt("shortfall_debt", 2, "liquidity_shortfall"),
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        principalDrawnWan: 2
      })
    ]
  });
  assert.equal(funded.alreadyCommitted, false);
  assert.equal(funded.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(funded.ledger.debtAccounts[0].principalWan, 2);
  assert.equal(funded.periodSummary.netWorthChangeWan, -3);
});

test("authoritative liquidity policy converts negative cash into an auditable debt draw", () => {
  const opening = initializeFinancialLedger({
    id: "auto_shortfall_ledger",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: 1,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
  const result = reduceFinancialLedger({
    ledger: opening,
    transactionId: "auto_shortfall_tx",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [{
      ...accepted(
        "unfunded_expense",
        "one_off_expense_paid",
        361,
        { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 3 }
      ),
      liquidityTreatment: "allow_system_shortfall"
    }],
    liquidityPolicy: "auto_shortfall_debt"
  });
  assert.equal(result.alreadyCommitted, false);
  if (result.alreadyCommitted) return;
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 2);
  assert.equal(result.ledger.debtAccounts[0].type, "liquidity_shortfall");
  assert.ok(result.transaction.eventIds.some((id) => id.startsWith("auto_shortfall_")));
  assert.equal(result.periodSummary.netWorthChangeWan, -3);
});

test("system liquidity shortfall reuses one revolving account, avoids schedule noise and preserves cash when reserve facts are missing", () => {
  const opening = initializeFinancialLedger({
    id: "revolving_shortfall",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 1, status: "active", factStatus: "known", evidence }]
    }
  });
  const first = reduceFinancialLedger({
    ledger: opening, transactionId: "shortfall_one", expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360, periodEndAgeInMonths: 361,
    events: [{
      ...accepted("expense_one", "one_off_expense_paid", 361, { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 3 }),
      liquidityTreatment: "allow_system_shortfall"
    }],
    liquidityPolicy: "auto_shortfall_debt"
  });
  const second = reduceFinancialLedger({
    ledger: first.ledger, transactionId: "shortfall_two", expectedLedgerRevision: 1,
    periodStartAgeInMonths: 361, periodEndAgeInMonths: 362,
    events: [{
      ...accepted("expense_two", "one_off_expense_paid", 362, { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1 }),
      liquidityTreatment: "allow_system_shortfall"
    }],
    liquidityPolicy: "auto_shortfall_debt"
  });
  assert.equal(second.ledger.debtAccounts.filter((debt) => debt.type === "liquidity_shortfall").length, 1);
  assert.equal(second.ledger.debtAccounts[0].principalWan, 3);
  const aged = reduceFinancialLedger({
    ledger: second.ledger, transactionId: "shortfall_aged", expectedLedgerRevision: 2,
    periodStartAgeInMonths: 362, periodEndAgeInMonths: 386, events: [], liquidityPolicy: "auto_shortfall_debt"
  });
  assert.equal(aged.ledger.unresolvedIssues.some((issue) => issue.code === "UNKNOWN_DEBT_SCHEDULE"), false);
  const recovered = reduceFinancialLedger({
    ledger: aged.ledger, transactionId: "shortfall_recovered", expectedLedgerRevision: 3,
    periodStartAgeInMonths: 386, periodEndAgeInMonths: 387,
    events: [accepted("recovery", "one_off_income_received", 387, { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 5 })],
    liquidityPolicy: "auto_shortfall_debt"
  });
  if (!("periodSummary" in recovered)) return;
  assert.equal(recovered.ledger.debtAccounts[0].status, "active");
  assert.equal(recovered.ledger.debtAccounts[0].principalWan, 3);
  assert.equal(recovered.ledger.cashAccounts[0].balanceWan, 5);
  assert.equal(recovered.periodSummary.debtPrincipalPaidWan, 0);
  assert.equal(recovered.transaction.eventIds.some((id) => id.startsWith("auto_shortfall_recovery_")), false);
});

test("proposal-created liquidity shortfall merges into the canonical revolving account", () => {
  const opening = ledgerAt(240, 0);
  const first = reduceFinancialLedger({
    ledger: opening,
    transactionId: "canonical_shortfall_open",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [{
      ...accepted("essential_expense", "one_off_expense_paid", 241, {
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 1
      }),
      liquidityTreatment: "allow_system_shortfall"
    }],
    liquidityPolicy: "auto_shortfall_debt"
  });
  const canonicalId = first.ledger.debtAccounts.find((item) => item.type === "liquidity_shortfall")!.id;
  const second = reduceFinancialLedger({
    ledger: first.ledger,
    transactionId: "canonical_shortfall_proposal",
    expectedLedgerRevision: first.ledger.revision,
    periodStartAgeInMonths: 241,
    periodEndAgeInMonths: 242,
    events: [accepted("proposal_shortfall", "liquidity_shortfall_created", 242, {
      debtAccount: {
        ...debt("proposal_shortfall_account", 0.5, "liquidity_shortfall"),
        openedAtAgeInMonths: 242
      },
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 0.5
    })],
    liquidityPolicy: "auto_shortfall_debt"
  });

  const active = second.ledger.debtAccounts.filter((item) => item.type === "liquidity_shortfall" && item.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].id, canonicalId);
  assert.equal(active[0].origin, "system_auto_shortfall");
  assert.equal(active[0].principalWan, 1.5);
  assert.equal(second.ledger.cashAccounts[0].balanceWan, 0.5);
  const merged = second.ledger.debtAccounts.find((item) => item.id === "proposal_shortfall_account")!;
  assert.equal(merged.status, "restructured");
  assert.equal(merged.principalWan, 0);
});

test("does not let a later inflow retroactively fund an earlier expense", () => {
  assert.throws(() => reduceFinancialLedger({
    ledger: ledgerAt(240, 1),
    transactionId: "tx_late_funding",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 243,
    events: [
      accepted("expense_first", "one_off_expense_paid", 241, {
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 3
      }),
      accepted("income_later", "one_off_income_received", 242, {
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 3
      })
    ]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");
});

test("records late-discovered property and mortgage as prior fact correction without fake cash flow", () => {
  const result = reduceFinancialLedger({
    ledger: ledgerAt(360, 10),
    transactionId: "late_balance_facts",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [
      accepted("home_discovered", "asset_balance_discovered", 361, {
        assetAccount: {
          id: "home_existing", type: "property", displayName: "此前已有住房",
          marketValueWan: 300, liquidity: "illiquid", status: "active", factStatus: "estimated",
          openedAtAgeInMonths: 300, evidence
        }
      }),
      accepted("mortgage_discovered", "debt_balance_discovered", 361, {
        debtAccount: debt("mortgage_existing", 120, "mortgage")
      })
    ]
  });
  if (!("periodSummary" in result)) return;
  assert.equal(result.transaction.cashDeltaWan, 0);
  assert.equal(result.transaction.incomeWan, 0);
  assert.equal(result.transaction.valuationChangeWan, 0);
  assert.equal(result.transaction.priorFactCorrectionWan, 180);
  assert.equal(result.transaction.nonCashGainLossWan, 0);
  assert.equal(result.transaction.netWorthDeltaWan, 180);
  assert.equal(result.periodSummary.priorFactCorrectionWan, 180);
});

test("is idempotent for the same simulation transaction id", () => {
  const first = reduceFinancialLedger({
    ledger: ledgerAt(240, 1),
    transactionId: "tx_once",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [accepted("income", "one_off_income_received", 241, {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 2
    })]
  });
  assert.equal(first.alreadyCommitted, false);
  const repeated = reduceFinancialLedger({
    ledger: first.ledger,
    transactionId: "tx_once",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: []
  });
  assert.equal(repeated.alreadyCommitted, true);
  assert.equal(repeated.ledger.revision, 1);
  assert.equal(repeated.ledger.cashAccounts[0].balanceWan, 3);
  assert.equal(repeated.ledger.committedTransactionIds.length, 1);
});

test("migrates any V1 aggregate snapshot without preserving negative cash", () => {
  const legacyState: FinancialState = {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: 360,
    cashWan: -5,
    investmentAssetsWan: 10,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 4,
    totalDebtWan: 2,
    netWorthWan: 7,
    annualAfterTaxIncomeWan: 24,
    annualDisposableIncomeWan: 12,
    annualCoreExpenseWan: 12,
    employmentStatus: "employed",
    incomeStability: "stable",
    isEstimated: true
  };
  const ledger = migrateLegacyFinancialState({ id: "legacy_ledger", legacyState });
  const derived = deriveFinancialState({ ledger, employmentStatus: "employed" });

  assert.equal(derived.state.cashWan, 0);
  assert.equal(derived.state.totalDebtWan, 7);
  assert.equal(derived.state.investmentAssetsWan, 10);
  assert.equal(derived.state.businessAndOtherAssetsWan, 4);
  assert.equal(derived.state.netWorthWan, 7);
  assert.equal(derived.state.annualizedRecurringIncomeWan, 24);
  assert.equal(derived.state.annualizedCoreExpenseWan, 12);
  assert.deepEqual(derived.state.unresolvedIssueCodes, ["LEGACY_UNCERTAINTY"]);
});
