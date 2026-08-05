import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "./initializeLedger";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import {
  derivePersonalExpenseSummary,
  formatPersonalExpenseSummaryForPrompt
} from "./personalExpenseSummary";
import type { ExpenseCommitment, FinancialEvidence } from "./types";

const personalEvidence: FinancialEvidence[] = [{
  source: "accepted_history",
  sourceEventId: "accepted_expense_fact",
  reasonCode: "TEST_PERSONAL_EXPENSE",
  confidence: 1,
  financialScope: "personal"
}];

function expense(input: Partial<ExpenseCommitment> & Pick<ExpenseCommitment, "id" | "type" | "displayName" | "monthlyAmountWan">): ExpenseCommitment {
  return {
    activeFromAgeInMonths: 480,
    status: "active",
    factStatus: "known",
    evidence: personalEvidence,
    ...input
  };
}

function v4Ledger() {
  const ledger = initializeFinancialLedger({
    id: "personal_expense_summary",
    asOfAgeInMonths: 480,
    openingPosition: {
      expenseCommitments: [
        expense({
          id: "living", type: "basic_living", displayName: "基本生活", monthlyAmountWan: 0.4,
          responsibilityKey: "adult_basic_living:protagonist", responsibilityKind: "adult_basic_living",
          amountBasis: "explicit_known", amountSourceIds: ["opening:living"],
          confirmedMonthlyAmountWan: 0.4
        }),
        expense({
          id: "shared_home", type: "housing", displayName: "共同租房", monthlyAmountWan: 0.3,
          responsibilityKey: "primary_residence:shared_home", responsibilityKind: "primary_residence",
          financialScope: "shared_household", amountBasis: "explicit_shared_amount", amountSourceIds: ["lease:shared"],
          grossMonthlyAmountWan: 0.6, householdShareRate: 0.5, confirmedMonthlyAmountWan: 0.3,
          evidence: [{ ...personalEvidence[0], financialScope: "shared_household" }]
        }),
        expense({
          id: "ongoing_treatment", type: "healthcare", displayName: "长期复诊", monthlyAmountWan: 0.12,
          status: "paused", responsibilityKey: "recurring_healthcare:ongoing_treatment", responsibilityKind: "recurring_healthcare",
          amountBasis: "explicit_known", amountSourceIds: ["care:ongoing"], confirmedMonthlyAmountWan: 0.12
        }),
        expense({
          id: "workshop", type: "housing", displayName: "木工坊租金", monthlyAmountWan: 0.8,
          evidence: [{ ...personalEvidence[0], financialScope: "business_operating", excerpt: "木工坊用于公司经营。" }]
        }),
        expense({
          id: "parent_bill", type: "dependent_support", displayName: "父母自行承担账单", monthlyAmountWan: 0.2,
          evidence: [{ ...personalEvidence[0], financialScope: "third_party", excerpt: "父母自行承担这笔费用。" }]
        })
      ]
    }
  });
  return migrateFinancialLedgerV3ToV4(ledger);
}

test("V4 personal expense summary is responsibility-level, deterministic and excludes business/third-party flows", () => {
  const summary = derivePersonalExpenseSummary(v4Ledger());
  assert.equal(summary.availability, "available");
  if (summary.availability !== "available") throw new Error("expected V4 summary");

  assert.deepEqual(
    summary.activeCommitments.map((item) => item.responsibilityKey),
    ["adult_basic_living:protagonist", "primary_residence:shared_home"]
  );
  assert.deepEqual(summary.pausedCommitments.map((item) => item.responsibilityKey), ["recurring_healthcare:ongoing_treatment"]);
  assert.equal(summary.annualizedActiveExpenseWan, 8.4);
  assert.equal(summary.reportEligibleAnnualizedExpenseWan, 8.4);
  assert.deepEqual(summary.activeCommitments[1], {
    commitmentId: "shared_home",
    responsibilityKey: "primary_residence:shared_home",
    responsibilityKind: "primary_residence",
    financialScope: "shared_household",
    monthlyAmountWan: 0.3,
    amountBasis: "explicit_shared_amount",
    factStatus: "known",
    reviewStatus: "normal",
    status: "active",
    accrues: true,
    narrativeEligible: true
  });

  const formatted = formatPersonalExpenseSummaryForPrompt(summary);
  assert.match(formatted, /responsibilityKey=primary_residence:shared_home/);
  assert.match(formatted, /kind=primary_residence/);
  assert.match(formatted, /scope=shared_household/);
  assert.match(formatted, /monthly=0.3/);
  assert.match(formatted, /basis=explicit_shared_amount/);
  assert.match(formatted, /factStatus=known/);
  assert.match(formatted, /review=normal/);
  assert.doesNotMatch(formatted, /workshop|parent_bill|木工坊|父母自行/u);
});

test("V3 never masquerades as a V4 classified expense summary", () => {
  const v3 = initializeFinancialLedger({ id: "legacy_summary", asOfAgeInMonths: 480 });
  assert.deepEqual(derivePersonalExpenseSummary(v3), {
    version: "personal_expense_summary_v4",
    availability: "unavailable",
    reason: "not_v4"
  });
  assert.match(formatPersonalExpenseSummaryForPrompt(derivePersonalExpenseSummary(v3)), /兼容账本/u);
});
