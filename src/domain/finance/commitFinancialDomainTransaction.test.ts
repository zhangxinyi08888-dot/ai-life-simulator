import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState, validateAndAcceptCareerTransition } from "../career/careerState";
import type { CareerStateCollection } from "../career/types";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import type { AcceptedFinancialEvent, FinancialEventKind, FinancialEventPayloadMap, FinancialEvidence } from "./types";
import type { WorldStateSnapshot } from "../../types";

const evidence: FinancialEvidence[] = [{ source: "accepted_simulation_outcome", sourceEventId: "start_business", reasonCode: "TEST_ACCEPTED", confidence: 1 }];

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  effectiveAtAgeInMonths: number,
  payload: FinancialEventPayloadMap[K]
): AcceptedFinancialEvent<K> {
  return { id, kind, effectiveAtAgeInMonths, payload, evidence, acceptedByReasonCodes: ["TEST_ACCEPTED"] } as AcceptedFinancialEvent<K>;
}

function setup() {
  const careerState = initializeCareerState({ id: "career_employed", employmentStatus: "employed", effectiveFromAgeInMonths: 300 });
  const career: CareerStateCollection = { careerStates: [careerState], currentCareerStateId: careerState.id, careerRevision: 0 };
  const ledger = initializeFinancialLedger({
    id: "atomic_ledger",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 2, status: "active", factStatus: "known", evidence }]
    }
  });
  const worldState: WorldStateSnapshot = {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    careerStates: [careerState],
    currentCareerStateId: careerState.id,
    currentEmploymentStatus: careerState.employmentStatus,
    careerRevision: 0,
    committedTransactionIds: [],
    version: 2
  };
  const transition = validateAndAcceptCareerTransition({
    proposal: {
      id: "start_business",
      fromCareerStateId: careerState.id,
      toStatus: "self_employed",
      occupation: "创业者",
      organization: "新公司",
      effectiveAtAgeInMonths: 361,
      sourceOutcomeId: "start_business",
      evidence: "你正式离职并创办新公司",
      confidence: 0.95
    },
    currentCareerState: careerState,
    acceptedOutcomeId: "start_business",
    narrativeText: "你正式离职并创办新公司。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361
  });
  return { career, ledger, worldState, transition };
}

test("commits CareerState, ledger, WorldState and derived snapshot as one transaction", () => {
  const current = setup();
  const nextCareerStateId = current.transition.nextCareerState.id;
  const result = commitFinancialDomainTransaction({
    transactionId: "atomic_success",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [current.transition],
    acceptedFinancialEvents: [
      accepted("income_source", "income_source_started", 361, {
        id: "founder_draw",
        type: "self_employment_draw",
        displayName: "创始人个人提款",
        monthlyNetAmountWan: 1,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 361,
        status: "active",
        linkedCareerStateId: nextCareerStateId,
        factStatus: "known",
        evidence
      }),
      accepted("opening_income", "one_off_income_received", 361, {
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 1
      })
    ]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.career.currentCareerStateId, nextCareerStateId);
  assert.equal(result.worldState.currentEmploymentStatus, "self_employed");
  assert.equal(result.worldState.careerRevision, 1);
  assert.equal(result.financialLedger.revision, 1);
  assert.equal(result.financialLedger.cashAccounts[0].balanceWan, 3);
  assert.equal(result.derivedFinancialState.state.employmentStatus, "self_employed");
  assert.equal(result.derivedFinancialState.compatibilityState.cashWan, 3);
  assert.deepEqual(result.worldState.committedTransactionIds, ["atomic_success"]);
});

test("a ledger failure returns no partial CareerState or WorldState mutation", () => {
  const current = setup();
  assert.throws(() => commitFinancialDomainTransaction({
    transactionId: "atomic_failure",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [current.transition],
    acceptedFinancialEvents: [accepted("unfunded", "one_off_expense_paid", 361, {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 5
    })]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");
  assert.equal(current.career.currentCareerStateId, "career_employed");
  assert.equal(current.career.careerRevision, 0);
  assert.equal(current.ledger.revision, 0);
  assert.equal(current.ledger.cashAccounts[0].balanceWan, 2);
  assert.deepEqual(current.worldState.committedTransactionIds, []);
});

test("repeated domain transaction is idempotent only when ledger and WorldState agree", () => {
  const current = setup();
  const committed = commitFinancialDomainTransaction({
    transactionId: "atomic_once",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  const repeated = commitFinancialDomainTransaction({
    transactionId: "atomic_once",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: committed.career.careerRevision,
    expectedLedgerRevision: committed.financialLedger.revision,
    currentCareer: committed.career,
    currentFinancialLedger: committed.financialLedger,
    currentWorldState: committed.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  assert.equal(repeated.alreadyCommitted, true);
  assert.equal(repeated.financialLedger.revision, 1);
  assert.equal(repeated.worldState.committedTransactionIds?.length, 1);
});
