import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import { buildLateLifeEmploymentClosure } from "./lateLifeEmploymentClosure";

const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];

test("age-80 policy closes ordinary employment and its wage but preserves passive income", () => {
  const career = initializeCareerState({ id: "career", employmentStatus: "employed", effectiveFromAgeInMonths: 360 });
  const ledger = initializeFinancialLedger({
    id: "late_life", asOfAgeInMonths: 960,
    openingPosition: {
      cashAccounts: [{ id: "cash_primary", type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      incomeSources: [
        { id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 360, status: "active", linkedCareerStateId: career.id, factStatus: "known", evidence },
        { id: "royalty", type: "royalty", displayName: "版税", monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 360, status: "active", factStatus: "known", evidence }
      ]
    }
  });
  const result = buildLateLifeEmploymentClosure({ currentCareer: career, ledger, ageInMonths: 961, transactionId: "late" });
  assert.equal(result.careerTransitions[0].nextCareerState.employmentStatus, "retired");
  assert.deepEqual(result.financialEvents.map((event) => event.payload.incomeSourceId), ["salary"]);
  assert.ok(result.financialEvents.every((event) => event.evidence[0].reasonCode === "AGE_80_EMPLOYMENT_STATUS_CLOSED"));
});

test("age-80 policy does not override an already authoritative self-employed state", () => {
  const career = initializeCareerState({ id: "career", employmentStatus: "self_employed", effectiveFromAgeInMonths: 900 });
  const ledger = initializeFinancialLedger({ id: "self_employed", asOfAgeInMonths: 961 });
  const result = buildLateLifeEmploymentClosure({ currentCareer: career, ledger, ageInMonths: 961, transactionId: "independent" });
  assert.deepEqual(result, { careerTransitions: [], financialEvents: [] });
});
