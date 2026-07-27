import assert from "node:assert/strict";
import test from "node:test";
import { ledgerNetWorthWan, totalDebtWan } from "./ledgerMath";
import { migrateFinancialLedgerV2ToV3 } from "./migrateFinancialLedgerV2ToV3";
import type { DebtAccountV2, FinancialLedgerV2 } from "./types";

const legacyEvidence = [{
  source: "legacy_migration" as const,
  reasonCode: "V2_MIGRATION_TEST",
  confidence: 1
}];

function shortfall(id: string, principalWan: number, openedAtAgeInMonths: number): DebtAccountV2 {
  return {
    id,
    type: "liquidity_shortfall",
    displayName: id,
    principalWan,
    openedAtAgeInMonths,
    status: "active",
    repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.1 },
    factStatus: "estimated",
    evidence: legacyEvidence
  };
}

function v2Ledger(): FinancialLedgerV2 {
  return {
    id: "persisted-v2",
    owner: "protagonist",
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: 300,
    cashAccounts: [{
      id: "primary_cash",
      type: "bank_deposit",
      balanceWan: 3,
      status: "active",
      factStatus: "known",
      evidence: legacyEvidence
    }],
    assetAccounts: [],
    debtAccounts: [shortfall("later", 2, 250), shortfall("earliest", 1, 240)],
    incomeSources: [],
    expenseCommitments: [],
    businessHoldings: [],
    recentTransactions: [],
    committedTransactionIds: [],
    unresolvedIssues: [],
    revision: 4,
    version: 2
  };
}

test("v2 migration writes canonical defaults and consolidates shortfalls into the earliest account", () => {
  const input = v2Ledger();
  const original = structuredClone(input);
  const migrated = migrateFinancialLedgerV2ToV3(input);

  assert.deepEqual(input, original, "migration must not rewrite a History v2 snapshot");
  assert.equal(migrated.version, 3);
  const active = migrated.debtAccounts.filter((debt) => debt.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "earliest");
  assert.equal(active[0].principalWan, 3);
  assert.equal(active[0].repaymentPolicy.mode, "event_driven");
  assert.equal(active[0].origin, "system_auto_shortfall");
  assert.equal(active[0].factStatus, "known");
  assert.equal(active[0].accruedUnpaidInterestWan, 0);
  assert.equal(active[0].servicingStatus, "current");
  assert.equal(active[0].consecutiveMissedPaymentMonths, 0);
  assert.equal(active[0].totalMissedPaymentMonths, 0);
  assert.deepEqual(active[0].recentMissedPaymentAgeInMonths, []);

  const redundant = migrated.debtAccounts.find((debt) => debt.id === "later")!;
  assert.equal(redundant.status, "restructured");
  assert.equal(redundant.principalWan, 0);
  assert.equal(redundant.accruedUnpaidInterestWan, 0);
});

test("v2 migration preserves cash, principal debt and net worth exactly", () => {
  const input = v2Ledger();
  const migrated = migrateFinancialLedgerV2ToV3(input);
  const legacyPrincipal = input.debtAccounts.reduce((sum, debt) => sum + debt.principalWan, 0);

  assert.equal(migrated.cashAccounts[0].balanceWan, input.cashAccounts[0].balanceWan);
  assert.equal(totalDebtWan(migrated), legacyPrincipal);
  assert.equal(ledgerNetWorthWan(migrated), input.cashAccounts[0].balanceWan - legacyPrincipal);
});

test("migration is safe to call at a restore boundary more than once", () => {
  const first = migrateFinancialLedgerV2ToV3(v2Ledger());
  const second = migrateFinancialLedgerV2ToV3(first);
  assert.deepEqual(second, first);
});

test("v3 restore consolidates an explicit-tagged shortfall with the system facility", () => {
  const input = v2Ledger() as any;
  input.version = 3;
  input.debtAccounts[0].origin = "explicit";
  input.debtAccounts[1].origin = "system_auto_shortfall";
  const before = {
    cash: input.cashAccounts[0].balanceWan,
    debt: totalDebtWan(input),
    netWorth: ledgerNetWorthWan(input)
  };

  const migrated = migrateFinancialLedgerV2ToV3(input);
  const active = migrated.debtAccounts.filter((debt) => debt.type === "liquidity_shortfall" && debt.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "earliest");
  assert.equal(active[0].origin, "system_auto_shortfall");
  assert.equal(active[0].principalWan, 3);
  assert.deepEqual({
    cash: migrated.cashAccounts[0].balanceWan,
    debt: totalDebtWan(migrated),
    netWorth: ledgerNetWorthWan(migrated)
  }, before);
});

test("restore migration repairs missing recurring-fact effective dates without retroactive accrual", () => {
  const input = v2Ledger() as any;
  input.version = 3;
  input.expenseCommitments = [{
    id: "undated_staff_cost",
    type: "staff_salary",
    displayName: "历史节点里的员工工资",
    monthlyAmountWan: 1,
    status: "active",
    factStatus: "estimated",
    evidence: []
  }];
  const migrated = migrateFinancialLedgerV2ToV3(input);
  assert.equal(migrated.expenseCommitments[0].activeFromAgeInMonths, input.asOfAgeInMonths);
  assert.ok(migrated.unresolvedIssues.some((issue) => issue.id === "migrated_missing_active_from_expense_undated_staff_cost"));
  assert.deepEqual(migrateFinancialLedgerV2ToV3(migrated), migrated);
});
