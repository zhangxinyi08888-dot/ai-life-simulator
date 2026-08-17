import assert from "node:assert/strict";
import test from "node:test";
import { requiresHardLateLifeCareerIncomeResolution } from "./lateLifeCareerIncomePolicy";
import type { IncomeSource } from "./types";

function source(overrides: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: "salary",
    type: "salary",
    displayName: "工资",
    monthlyNetAmountWan: 2,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_current",
    factStatus: "known",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: 331,
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "EVIDENCE_EXACT_MATCHED", confidence: 1 }],
    ...overrides
  };
}

test("known exact income for the unchanged current career does not require hard late-life resolution", () => {
  assert.equal(requiresHardLateLifeCareerIncomeResolution({
    source: source(),
    currentCareerStateId: "career_current"
  }), false);
});

test("estimated late-life career income still requires hard resolution", () => {
  assert.equal(requiresHardLateLifeCareerIncomeResolution({
    source: source({ factStatus: "estimated" }),
    currentCareerStateId: "career_current"
  }), true);
});

test("known income linked to a superseded career state still requires hard resolution", () => {
  assert.equal(requiresHardLateLifeCareerIncomeResolution({
    source: source({ linkedCareerStateId: "career_old" }),
    currentCareerStateId: "career_current"
  }), true);
});
