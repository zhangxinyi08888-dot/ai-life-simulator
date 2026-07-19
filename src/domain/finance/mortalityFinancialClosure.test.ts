import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import { buildMortalityFinancialClosure } from "./mortalityFinancialClosure";

const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];

test("mortality deterministically ends labor income but leaves passive income untouched", () => {
  const career = initializeCareerState({ id: "career", employmentStatus: "employed", effectiveFromAgeInMonths: 360 });
  const ledger = initializeFinancialLedger({
    id: "mortality", asOfAgeInMonths: 1320,
    openingPosition: {
      cashAccounts: [{ id: "cash_primary", type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      incomeSources: [
        { id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 360, status: "active", linkedCareerStateId: career.id, factStatus: "known", evidence },
        { id: "rent", type: "rent", displayName: "租金", monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 360, status: "active", factStatus: "known", evidence }
      ]
    }
  });
  const result = buildMortalityFinancialClosure({ currentCareer: career, ledger, ageInMonths: 1320, transactionId: "terminal" });
  assert.equal(result.careerTransitions[0].nextCareerState.employmentStatus, "not_working");
  assert.deepEqual(result.financialEvents.map((event) => event.payload.incomeSourceId), ["salary"]);
  assert.ok(result.financialEvents.every((event) => event.evidence[0].source === "system_policy"));
});
