import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CareerCompensationValidationCases } from "./careerCompensationValidationHarness";
import { runCareerCompensationAdditionalValidation } from "./careerCompensationValidationHarness";

const casesUrl = new URL("../../../test-data/career-compensation-authority/cases.v1.json", import.meta.url);
const cases = JSON.parse(await readFile(casesUrl, "utf8")) as CareerCompensationValidationCases;
const report = runCareerCompensationAdditionalValidation(cases);

test("month-boundary matrix has one career income per month and exact settlement totals", () => {
  assert.equal(report.boundaryMatrix.length, 5);
  for (const result of report.boundaryMatrix) {
    assert.equal(result.incomeMatches, true, `income mismatch at month ${result.transitionMonth}`);
    assert.equal(result.exactlyOneCareerIncomePerMonth, true, `coverage mismatch at month ${result.transitionMonth}`);
    assert.equal(result.noOldSalaryReuse, true);
    assert.equal(result.sameMonthEffective, true);
  }
});

test("metamorphic frontend role wording derives an identical versioned estimate", () => {
  assert.equal(report.metamorphic.equivalent, true);
  assert.equal(new Set(report.metamorphic.estimates.map((item) => item.policyVersion)).size, 1);
  assert.equal(report.metamorphic.estimates[0]?.policyVersion, 1);
});

test("JSON checkpoint restore and duplicate retry reproduce the exact ledger", () => {
  assert.equal(report.recovery.restoreEquivalent, true);
  assert.equal(report.recovery.duplicateTransactionAlreadyCommitted, true);
  assert.match(report.recovery.finalLedgerDigestSha256, /^[a-f0-9]{64}$/);
});

test("fault-injection guards reject all listed root-cause mutations", () => {
  for (const guard of cases.requiredMutationGuards) {
    assert.equal(report.mutationGuards[guard], true, `mutation survived: ${guard}`);
  }
  assert.equal(report.allPassed, true);
});
