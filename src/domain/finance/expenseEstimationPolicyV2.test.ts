import assert from "node:assert/strict";
import test from "node:test";
import { estimateExpenseResponsibility } from "./expenseEstimationPolicyV2";

test("V2 policy treats an unknown city as medium rather than silently choosing a low-cost estimate", () => {
  const unknownCity = estimateExpenseResponsibility({
    responsibilityKind: "primary_residence",
    ageInMonths: 32 * 12,
    cityCostBand: "unknown"
  });
  const mediumCity = estimateExpenseResponsibility({
    responsibilityKind: "primary_residence",
    ageInMonths: 32 * 12,
    cityCostBand: "medium"
  });
  const highCity = estimateExpenseResponsibility({
    responsibilityKind: "primary_residence",
    ageInMonths: 32 * 12,
    cityCostBand: "high"
  });

  assert.ok(unknownCity && mediumCity && highCity);
  assert.equal(unknownCity.inputs.cityCostBand, "medium");
  assert.equal(unknownCity.accrualMonthlyAmountWan, mediumCity.accrualMonthlyAmountWan);
  assert.ok(highCity.accrualMonthlyAmountWan > mediumCity.accrualMonthlyAmountWan);
});

test("V2 policy never turns a verified provided residence into an active zero-cost housing estimate", () => {
  const estimate = estimateExpenseResponsibility({
    responsibilityKind: "primary_residence",
    ageInMonths: 32 * 12,
    livingArrangement: "provided"
  });

  assert.ok(estimate);
  assert.equal(estimate.accrualMonthlyAmountWan, 0);
  assert.equal(estimate.inputs.cityCostBand, "medium");
});

test("V2 policy selector uses age applicability and reports no policy instead of borrowing the adult floor", () => {
  const unmatchedMinor = estimateExpenseResponsibility({
    responsibilityKind: "adult_basic_living",
    ageInMonths: 17 * 12,
    cityCostBand: "high",
    livingArrangement: "renting"
  });
  const matchedAdult = estimateExpenseResponsibility({
    responsibilityKind: "adult_basic_living",
    ageInMonths: 18 * 12,
    cityCostBand: "high",
    livingArrangement: "renting"
  });

  assert.equal(unmatchedMinor, undefined);
  assert.ok(matchedAdult);
  assert.equal(matchedAdult.inputs.ageBand, "young_adult");
  assert.equal(matchedAdult.inputs.cityCostBand, "high");
  assert.ok(matchedAdult.reasonCodes.includes("EXPENSE_CONTEXT_AGE_YOUNG_ADULT"));
  assert.ok(matchedAdult.reasonCodes.includes("EXPENSE_CONTEXT_CITY_HIGH"));
});

test("a young student uses a distinct V2 basic-living policy row rather than an employed adult floor", () => {
  const student = estimateExpenseResponsibility({
    responsibilityKind: "adult_basic_living",
    ageInMonths: 22 * 12,
    employmentStatus: "student"
  });
  const employed = estimateExpenseResponsibility({
    responsibilityKind: "adult_basic_living",
    ageInMonths: 22 * 12,
    employmentStatus: "employed"
  });
  assert.ok(student && employed);
  assert.equal(student.accrualMonthlyAmountWan, 0.2);
  assert.equal(employed.accrualMonthlyAmountWan, 0.35);
});

test("a young student's accepted living arrangement calibrates routine living without inventing housing or debt", () => {
  const withFamily = estimateExpenseResponsibility({
    responsibilityKind: "adult_basic_living",
    ageInMonths: 22 * 12,
    employmentStatus: "student",
    livingArrangement: "with_family",
    cityCostBand: "medium"
  });
  const rentingInHighCostCity = estimateExpenseResponsibility({
    responsibilityKind: "adult_basic_living",
    ageInMonths: 22 * 12,
    employmentStatus: "student",
    livingArrangement: "renting",
    cityCostBand: "high"
  });
  assert.ok(withFamily && rentingInHighCostCity);
  assert.equal(withFamily.accrualMonthlyAmountWan, 0.15);
  assert.equal(rentingInHighCostCity.accrualMonthlyAmountWan, 0.24);
});

test("an accepted ongoing healthcare responsibility receives a higher older-adult calibration without age inventing an account", () => {
  const youngTreatment = estimateExpenseResponsibility({
    responsibilityKind: "recurring_healthcare",
    ageInMonths: 32 * 12,
    cityCostBand: "medium"
  });
  const olderTreatment = estimateExpenseResponsibility({
    responsibilityKind: "recurring_healthcare",
    ageInMonths: 89 * 12,
    cityCostBand: "medium"
  });

  assert.ok(youngTreatment && olderTreatment);
  assert.equal(youngTreatment.accrualMonthlyAmountWan, 0.12);
  assert.equal(olderTreatment.accrualMonthlyAmountWan, 0.24);
  assert.ok(olderTreatment.accrualMonthlyAmountWan > youngTreatment.accrualMonthlyAmountWan);
  assert.ok(olderTreatment.reasonCodes.includes("EXPENSE_CONTEXT_AGE_OLDER_ADULT"));
});

test("elder-care intensity is a separately selected, evidence-gated policy input", () => {
  const baseline = estimateExpenseResponsibility({
    responsibilityKind: "elder_care",
    ageInMonths: 64 * 12,
    cityCostBand: "medium"
  });
  const elevatedAdult = estimateExpenseResponsibility({
    responsibilityKind: "elder_care",
    ageInMonths: 64 * 12,
    cityCostBand: "medium",
    careIntensity: "elevated"
  });
  const elevatedOlderAdult = estimateExpenseResponsibility({
    responsibilityKind: "elder_care",
    ageInMonths: 80 * 12,
    cityCostBand: "medium",
    careIntensity: "elevated"
  });

  assert.ok(baseline && elevatedAdult && elevatedOlderAdult);
  assert.equal(baseline.accrualMonthlyAmountWan, 0.2);
  assert.equal(elevatedAdult.accrualMonthlyAmountWan, 0.25);
  assert.equal(elevatedOlderAdult.accrualMonthlyAmountWan, 0.35);
  assert.ok(elevatedAdult.reasonCodes.includes("EXPENSE_CONTEXT_CARE_ELEVATED"));
  assert.ok(elevatedOlderAdult.reasonCodes.includes("EXPENSE_CONTEXT_CARE_ELEVATED"));
  assert.equal(baseline.inputs.careIntensity, "baseline");
});
