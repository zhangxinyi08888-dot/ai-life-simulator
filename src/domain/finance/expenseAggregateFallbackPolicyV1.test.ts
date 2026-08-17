import assert from "node:assert/strict";
import test from "node:test";
import { estimateUnclassifiedCoreConsumption } from "./expenseAggregateFallbackPolicyV1";

test("aggregate fallback uses a bounded income band rather than a target expense ratio", () => {
  const medium = estimateUnclassifiedCoreConsumption({ ageInMonths: 30 * 12, employmentStatus: "employed", annualRecurringPersonalIncomeWan: 24 });
  const high = estimateUnclassifiedCoreConsumption({ ageInMonths: 30 * 12, employmentStatus: "employed", annualRecurringPersonalIncomeWan: 240 });
  assert.ok(medium && high);
  assert.equal(medium.targetMonthlyCoreExpenseWan, 0.9);
  assert.equal(high.targetMonthlyCoreExpenseWan, 1.6);
  assert.ok(high.targetMonthlyCoreExpenseWan < medium.targetMonthlyCoreExpenseWan * 10, "tenfold income must not create tenfold expense");
  assert.ok(medium.reasonCodes.includes("EXPENSE_INCOME_BAND_PRIOR_APPLIED"));
});

test("accepted student family/provided housing suppresses the income prior", () => {
  for (const livingArrangement of ["with_family", "provided"] as const) {
    const estimate = estimateUnclassifiedCoreConsumption({
      ageInMonths: 21 * 12,
      employmentStatus: "student",
      livingArrangement,
      cityCostBand: "medium",
      annualRecurringPersonalIncomeWan: 24
    });
    assert.ok(estimate);
    assert.equal(estimate.targetMonthlyCoreExpenseWan, 0.15);
    assert.equal(estimate.reasonCodes.includes("EXPENSE_INCOME_BAND_PRIOR_APPLIED"), false);
  }
});

test("household size remains review context and never fabricates a payer amount", () => {
  const one = estimateUnclassifiedCoreConsumption({ ageInMonths: 35 * 12, employmentStatus: "employed", householdSize: 1 });
  const three = estimateUnclassifiedCoreConsumption({ ageInMonths: 35 * 12, employmentStatus: "employed", householdSize: 3 });
  assert.ok(one && three);
  assert.equal(three.targetMonthlyCoreExpenseWan, one.targetMonthlyCoreExpenseWan);
  assert.ok(three.reasonCodes.includes("EXPENSE_HOUSEHOLD_SIZE_REVIEW_ONLY"));
});
