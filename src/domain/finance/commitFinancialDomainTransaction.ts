import type { WorldStateSnapshot } from "../../types";
import { currentCareerState, reduceCareerStates } from "../career/careerState";
import type { AcceptedCareerTransition, CareerStateCollection } from "../career/types";
import { deriveFinancialState } from "./deriveFinancialState";
import { FinancialLedgerInvariantError } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  DerivedFinancialStateResult,
  FinancialLedger,
  FinancialPeriodSummary,
  FinancialTransaction
} from "./types";

export interface FinancialDomainTransactionInput {
  transactionId: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  expectedCareerRevision: number;
  expectedLedgerRevision: number;
  currentCareer: CareerStateCollection;
  currentFinancialLedger: FinancialLedger;
  currentWorldState: WorldStateSnapshot;
  acceptedCareerTransitions: AcceptedCareerTransition[];
  acceptedFinancialEvents: AcceptedFinancialEvent[];
}

export interface CommittedFinancialDomainTransaction {
  career: CareerStateCollection;
  financialLedger: FinancialLedger;
  worldState: WorldStateSnapshot;
  financialTransaction?: FinancialTransaction;
  financialPeriodSummary?: FinancialPeriodSummary;
  derivedFinancialState: DerivedFinancialStateResult;
  alreadyCommitted: boolean;
}

function assertLinkedCareerStates(
  events: AcceptedFinancialEvent[],
  career: CareerStateCollection
): void {
  const careerStateIds = new Set(career.careerStates.map((state) => state.id));
  for (const event of events) {
    const source = event.kind === "income_source_started"
      ? event.payload
      : event.kind === "income_source_adjusted"
        ? event.payload.nextSource
        : undefined;
    if (source?.linkedCareerStateId && !careerStateIds.has(source.linkedCareerStateId)) {
      throw new FinancialLedgerInvariantError(
        "INVALID_LEDGER",
        `收入来源 ${source.id} 引用了未提交的 CareerState ${source.linkedCareerStateId}`
      );
    }
  }
}

export function commitFinancialDomainTransaction(
  input: FinancialDomainTransactionInput
): CommittedFinancialDomainTransaction {
  const ledgerCommitted = input.currentFinancialLedger.committedTransactionIds.includes(input.transactionId);
  const worldCommitted = input.currentWorldState.committedTransactionIds?.includes(input.transactionId) || false;
  if (ledgerCommitted !== worldCommitted) {
    throw new FinancialLedgerInvariantError("REVISION_CONFLICT", "财务账本与 WorldState 的事务提交状态不一致");
  }
  const currentState = currentCareerState(input.currentCareer);
  if (!currentState) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "缺少当前 CareerState");
  if (ledgerCommitted && worldCommitted) {
    return {
      career: input.currentCareer,
      financialLedger: input.currentFinancialLedger,
      worldState: input.currentWorldState,
      derivedFinancialState: deriveFinancialState({ ledger: input.currentFinancialLedger, employmentStatus: currentState.employmentStatus }),
      alreadyCommitted: true
    };
  }

  // Both reducers are pure. Nothing is returned unless every domain succeeds.
  const nextCareer = reduceCareerStates({
    current: input.currentCareer,
    expectedCareerRevision: input.expectedCareerRevision,
    acceptedTransitions: input.acceptedCareerTransitions
  });
  assertLinkedCareerStates(input.acceptedFinancialEvents, nextCareer);
  const financialResult = reduceFinancialLedger({
    ledger: input.currentFinancialLedger,
    transactionId: input.transactionId,
    expectedLedgerRevision: input.expectedLedgerRevision,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    events: input.acceptedFinancialEvents
  });
  if (financialResult.alreadyCommitted || !("periodSummary" in financialResult)) {
    throw new FinancialLedgerInvariantError("REVISION_CONFLICT", "事务在原子提交过程中被重复处理");
  }
  const nextCurrentCareerState = currentCareerState(nextCareer);
  if (!nextCurrentCareerState) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "职业事务未产生当前 CareerState");
  const nextWorldState: WorldStateSnapshot = {
    ...structuredClone(input.currentWorldState),
    careerStates: structuredClone(nextCareer.careerStates),
    currentCareerStateId: nextCareer.currentCareerStateId,
    currentEmploymentStatus: nextCurrentCareerState.employmentStatus,
    careerRevision: nextCareer.careerRevision,
    committedTransactionIds: [...(input.currentWorldState.committedTransactionIds || []), input.transactionId],
    version: 2
  };
  return {
    career: nextCareer,
    financialLedger: financialResult.ledger,
    worldState: nextWorldState,
    financialTransaction: financialResult.transaction,
    financialPeriodSummary: financialResult.periodSummary,
    derivedFinancialState: deriveFinancialState({
      ledger: financialResult.ledger,
      periodSummary: financialResult.periodSummary,
      employmentStatus: nextCurrentCareerState.employmentStatus
    }),
    alreadyCommitted: false
  };
}
