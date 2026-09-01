import assert from "node:assert/strict";
import test from "node:test";
import { estimateUnclassifiedCoreConsumption } from "./expenseAggregateFallbackPolicyV1";

test("deterministic path A keeps ordinary living increasing across 0.8, 1.5 and 3 万/月 while its ratio diminishes", () => {
  const estimates = [0.8, 1.5, 3].map((monthlyIncomeWan) => estimateUnclassifiedCoreConsumption({
    ageInMonths: 30 * 12,
    employmentStatus: "employed",
    annualRecurringPersonalIncomeWan: monthlyIncomeWan * 12
  }));
  assert.ok(estimates.every(Boolean));
  const targets = estimates.map((item) => item!.targetMonthlyCoreExpenseWan);
  assert.deepEqual(targets, [0.68, 1.184, 2.164]);
  assert.ok(targets[0] < targets[1] && targets[1] < targets[2]);
  const ratios = targets.map((target, index) => target / [0.8, 1.5, 3][index]);
  assert.ok(ratios[0] > ratios[1] && ratios[1] > ratios[2]);
  assert.ok(estimates[2]!.reasonCodes.includes("EXPENSE_INCOME_AWARE_LIFESTYLE_APPLIED"));
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
    assert.equal(estimate.reasonCodes.includes("EXPENSE_INCOME_AWARE_LIFESTYLE_APPLIED"), false);
  }
});

test("low income ordinary living is capped below monthly income", () => {
  const estimate = estimateUnclassifiedCoreConsumption({
    ageInMonths: 30 * 12,
    employmentStatus: "employed",
    annualRecurringPersonalIncomeWan: 4.8
  });
  assert.ok(estimate);
  assert.equal(estimate.targetMonthlyCoreExpenseWan, 0.38);
  assert.ok(estimate.reasonCodes.includes("EXPENSE_ORDINARY_LIVING_AFFORDABILITY_CAP_APPLIED"));
});

test("household size remains review context and never fabricates a payer amount", () => {
  const one = estimateUnclassifiedCoreConsumption({ ageInMonths: 35 * 12, employmentStatus: "employed", householdSize: 1 });
  const three = estimateUnclassifiedCoreConsumption({ ageInMonths: 35 * 12, employmentStatus: "employed", householdSize: 3 });
  assert.ok(one && three);
  assert.equal(three.targetMonthlyCoreExpenseWan, one.targetMonthlyCoreExpenseWan);
  assert.ok(three.reasonCodes.includes("EXPENSE_HOUSEHOLD_SIZE_REVIEW_ONLY"));
});
