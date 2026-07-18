import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import type { AcceptedCareerTransition } from "../career/types";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { reconcileCareerIncomeAtomicity } from "./reconcileCareerIncomeAtomicity";
import type { AcceptedFinancialEvent, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_simulation_outcome", reasonCode: "TEST", confidence: 1 }];

function fixture() {
  const currentCareer = initializeCareerState({ id: "career_job", employmentStatus: "employed", effectiveFromAgeInMonths: 600 });
  const retired = initializeCareerState({ id: "career_retired", employmentStatus: "retired", effectiveFromAgeInMonths: 660 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_retire_now",
    proposalId: "retire_now",
    fromCareerStateId: currentCareer.id,
    nextCareerState: retired,
    effectiveAtAgeInMonths: 660,
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const ledger = initializeFinancialLedger({
    id: "retirement_atomicity",
    asOfAgeInMonths: 659,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      incomeSources: [
        { id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: 3, accrualPolicy: "monthly", activeFromAgeInMonths: 600, status: "active", linkedCareerStateId: currentCareer.id, factStatus: "known", evidence },
        { id: "rent", type: "rent", displayName: "租金", monthlyNetAmountWan: 1, accrualPolicy: "monthly", activeFromAgeInMonths: 600, status: "active", factStatus: "known", evidence }
      ]
    }
  });
  return { currentCareer, transition, ledger };
}

test("retirement is held pending when its linked wage source is not closed", () => {
  const current = fixture();
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [current.transition],
    financialEvents: [],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 0);
  assert.equal(result.issues[0].code, "CAREER_INCOME_CONFLICT");
  assert.deepEqual(result.issues[0].relatedIncomeSourceIds, ["salary"]);
});

test("retirement and linked wage closure commit as a group while rent remains untouched", () => {
  const current = fixture();
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_salary",
    proposalId: "end_salary_proposal",
    kind: "income_source_ended",
    effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [current.transition],
    financialEvents: [endSalary],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 1);
  assert.deepEqual(result.acceptedFinancialEvents.map((event) => event.payload), [{ incomeSourceId: "salary" }]);
  assert.equal(result.issues.length, 0);
});

test("consultant transition is held when the old wage closes without a next-career income", () => {
  const current = fixture();
  const consultant: AcceptedCareerTransition = {
    ...current.transition,
    id: "accepted_consultant",
    proposalId: "consultant",
    nextCareerState: { ...current.transition.nextCareerState, id: "career_consultant", employmentStatus: "self_employed", occupation: "顾问" }
  };
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_salary", proposalId: "end_salary_proposal", kind: "income_source_ended", effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" }, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [consultant],
    financialEvents: [endSalary],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 0);
  assert.equal(result.acceptedFinancialEvents.length, 0);
  assert.match(result.issues[0].summary, /新 CareerState/);
});

test("consultant transition and adjusted wage migrate as one atomic group", () => {
  const current = fixture();
  const nextCareerState = { ...current.transition.nextCareerState, id: "career_consultant", employmentStatus: "self_employed" as const, occupation: "顾问" };
  const consultant: AcceptedCareerTransition = {
    ...current.transition, id: "accepted_consultant", proposalId: "consultant", nextCareerState
  };
  const adjusted: AcceptedFinancialEvent<"income_source_adjusted"> = {
    id: "adjust_salary", proposalId: "adjust_salary_proposal", kind: "income_source_adjusted", effectiveAtAgeInMonths: 660,
    payload: {
      incomeSourceId: "salary",
      nextSource: { ...current.ledger.incomeSources[0], monthlyNetAmountWan: 1.5, linkedCareerStateId: nextCareerState.id }
    },
    evidence, acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [consultant],
    financialEvents: [adjusted],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 1);
  assert.equal(result.acceptedFinancialEvents.length, 1);
  assert.equal(result.issues.length, 0);
});
