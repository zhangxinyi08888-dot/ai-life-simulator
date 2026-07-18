import type { WorldStateSnapshot } from "../../types";
import { currentCareerState, reduceCareerStates } from "../career/careerState";
import type { AcceptedCareerTransition, CareerStateCollection } from "../career/types";
import { deriveFinancialState } from "./deriveFinancialState";
import { estimatedBasicLivingCommitment } from "./financialEstimationPolicy";
import { FinancialLedgerInvariantError } from "./ledgerMath";
import { reduceFinancialLedger, type LiquidityPolicy } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  DerivedFinancialStateResult,
  FinancialLedger,
  FinancialLedgerIssue,
  FinancialPeriodSummary,
  FinancialTransaction
} from "./types";

function eventReferences(event: AcceptedFinancialEvent): {
  incomeSourceIds: string[];
  expenseCommitmentIds: string[];
  debtAccountIds: string[];
  businessHoldingIds: string[];
  accountIds: string[];
} {
  const payload = event.payload as Record<string, any>;
  const incomeSourceIds = event.kind === "income_source_started"
    ? [payload.id]
    : [payload.incomeSourceId, payload.nextSource?.id];
  const expenseCommitmentIds = event.kind === "expense_commitment_started"
    ? [payload.id]
    : [payload.expenseCommitmentId, payload.nextCommitment?.id];
  return {
    incomeSourceIds: incomeSourceIds.filter((value): value is string => typeof value === "string"),
    expenseCommitmentIds: expenseCommitmentIds.filter((value): value is string => typeof value === "string"),
    debtAccountIds: [payload.debtAccountId, payload.oldDebtAccountId, payload.debtAccount?.id, payload.replacementDebtAccount?.id].filter((value): value is string => typeof value === "string"),
    businessHoldingIds: [payload.businessHoldingId, event.kind === "business_holding_started" ? payload.id : undefined, event.kind === "business_option_granted" ? payload.optionHolding?.id : undefined]
      .filter((value): value is string => typeof value === "string"),
    accountIds: [payload.sourceCashAccountId, payload.destinationCashAccountId, payload.assetAccountId, payload.assetAccount?.id, ...expenseCommitmentIds].filter((value): value is string => typeof value === "string")
  };
}

function intersects(left: string[] | undefined, right: string[]): boolean {
  return Boolean(left?.some((item) => right.includes(item)));
}

function isDefaultStudentFamilySupport(source: FinancialLedger["incomeSources"][number]): boolean {
  return source.type === "family_support"
    && source.evidence.some((item) => item.reasonCode === "STUDENT_BASIC_LIVING_FAMILY_COVERED");
}

function applyStudentFamilySupportLifecycle(input: {
  ledger: FinancialLedger;
  currentEmploymentStatus: string;
  transitions: AcceptedCareerTransition[];
}): void {
  if (input.currentEmploymentStatus !== "student") return;
  const leavingStudent = [...input.transitions]
    .sort((left, right) => left.effectiveAtAgeInMonths - right.effectiveAtAgeInMonths)
    .find((transition) => transition.nextCareerState.employmentStatus !== "student");
  if (!leavingStudent) return;
  for (const source of input.ledger.incomeSources) {
    if (source.status !== "active" || !isDefaultStudentFamilySupport(source)) continue;
    source.activeUntilAgeInMonths = leavingStudent.effectiveAtAgeInMonths;
  }
}

function addOrObserveIssue(ledger: FinancialLedger, issue: FinancialLedgerIssue, ageInMonths: number): FinancialLedgerIssue {
  const sameRefs = (left: string[] | undefined, right: string[] | undefined) => (
    JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort())
  );
  const existing = ledger.unresolvedIssues.find((candidate) => (
    candidate.status !== "resolved"
    && candidate.code === issue.code
    && candidate.summary === issue.summary
    && sameRefs(candidate.relatedIncomeSourceIds, issue.relatedIncomeSourceIds)
    && sameRefs(candidate.relatedAccountIds, issue.relatedAccountIds)
    && sameRefs(candidate.relatedDebtAccountIds, issue.relatedDebtAccountIds)
    && sameRefs(candidate.relatedBusinessHoldingIds, issue.relatedBusinessHoldingIds)
  ));
  if (existing) {
    existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
    existing.lastObservedAtAgeInMonths = ageInMonths;
    return existing;
  }
  const next = {
    ...structuredClone(issue),
    status: issue.status || "open" as const,
    occurrenceCount: issue.occurrenceCount || 1,
    lastObservedAtAgeInMonths: ageInMonths
  };
  ledger.unresolvedIssues.push(next);
  return next;
}

function applyPreAccrualFactCompletenessPolicy(input: {
  ledger: FinancialLedger;
  events: AcceptedFinancialEvent[];
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
}): FinancialLedgerIssue[] {
  const issues: FinancialLedgerIssue[] = [];
  const hasActiveBasicLiving = input.ledger.expenseCommitments.some((commitment) => (
    commitment.status === "active" && commitment.type === "basic_living"
  ));
  const startsBasicLivingEvent = input.events.find((event) => (
    event.kind === "expense_commitment_started"
    && (event.payload as { type?: string }).type === "basic_living"
  ));
  if (startsBasicLivingEvent) {
    for (const commitment of input.ledger.expenseCommitments) {
      const isSystemEstimate = commitment.type === "basic_living"
        && commitment.status === "active"
        && commitment.factStatus === "estimated"
        && commitment.evidence.some((item) => item.source === "system_policy");
      if (!isSystemEstimate) continue;
      commitment.activeUntilAgeInMonths = startsBasicLivingEvent.effectiveAtAgeInMonths;
      if (commitment.activeUntilAgeInMonths <= input.periodStartAgeInMonths) commitment.status = "ended";
    }
  }
  if (input.periodEndAgeInMonths >= 18 * 12 && !hasActiveBasicLiving && !startsBasicLivingEvent) {
    const estimatedLiving = estimatedBasicLivingCommitment({ ageInMonths: input.periodStartAgeInMonths });
    if (estimatedLiving) input.ledger.expenseCommitments.push(estimatedLiving);
  }

  if (input.periodEndAgeInMonths >= 55 * 12) {
    const confirmedIncomeIds = new Set(input.events.flatMap((event) => eventReferences(event).incomeSourceIds));
    for (const source of input.ledger.incomeSources) {
      if (source.status !== "active" || !source.linkedCareerStateId || source.accrualPolicy === "event_only") continue;
      if (confirmedIncomeIds.has(source.id)) continue;
      const lastConfirmedAt = source.lastConfirmedAtAgeInMonths ?? source.activeFromAgeInMonths;
      if (input.periodStartAgeInMonths - lastConfirmedAt < 36) continue;
      source.factStatus = "needs_review";
      source.accrualReviewStatus = "quarantined";
      issues.push({
        id: `pending_fact_stale_late_career_${source.id}`,
        code: "CAREER_STATE_STALE",
        severity: "blocking",
        status: "open",
        relatedProposalIds: [],
        relatedIncomeSourceIds: [source.id],
        summary: `55岁后职业收入 ${source.displayName} 已超过36个月没有新的主人公工作证据；工资计提已暂停，等待确认继续工作、调整收入或退休`,
        createdAtAgeInMonths: input.periodEndAgeInMonths
      });
    }
  }
  return issues;
}

function resolveIssuesFromAcceptedEvents(ledger: FinancialLedger, events: AcceptedFinancialEvent[], ageInMonths: number): void {
  for (const event of events) {
    const refs = eventReferences(event);
    for (const issue of ledger.unresolvedIssues) {
      if (issue.status === "resolved") continue;
      const resolvesMissingExpense = issue.id === "pending_fact_missing_adult_expense"
        && event.kind === "expense_commitment_started";
      const resolvesCoverage = (issue.id.startsWith("narrative_coverage_property_") && event.kind === "asset_purchased")
        || (issue.id.startsWith("narrative_coverage_mortgage_") && event.kind === "debt_drawn" && event.payload.debtAccount.type === "mortgage")
        || (issue.id.startsWith("narrative_coverage_business_holding_")
          && (event.kind === "business_holding_started" || event.kind === "business_option_granted"));
      if (!resolvesMissingExpense && !resolvesCoverage
        && !intersects(issue.relatedIncomeSourceIds, refs.incomeSourceIds)
        && !intersects(issue.relatedAccountIds, refs.accountIds)
        && !intersects(issue.relatedDebtAccountIds, refs.debtAccountIds)
        && !intersects(issue.relatedBusinessHoldingIds, refs.businessHoldingIds)) continue;
      issue.status = "resolved";
      issue.resolvedAtAgeInMonths = ageInMonths;
      issue.resolvedByEventId = event.id;
      if (resolvesMissingExpense) {
        for (const sourceId of issue.relatedIncomeSourceIds || []) {
          const source = ledger.incomeSources.find((item) => item.id === sourceId);
          if (source) source.accrualReviewStatus = "normal";
        }
      }
    }
    for (const sourceId of refs.incomeSourceIds) {
      const source = ledger.incomeSources.find((item) => item.id === sourceId);
      if (source) {
        source.accrualReviewStatus = "normal";
        source.lastConfirmedAtAgeInMonths = event.effectiveAtAgeInMonths;
      }
    }
  }
}

function applyPendingFactPolicy(ledger: FinancialLedger, issues: FinancialLedgerIssue[], ageInMonths: number): void {
  for (const issue of issues.filter((item) => item.severity === "blocking")) {
    const completenessPolicyAlreadyApplied = issue.id === "pending_fact_missing_adult_expense"
      || issue.id.startsWith("pending_fact_stale_late_career_")
      || issue.id === "proposal_issue_missing_adult_expense"
      || issue.id.startsWith("proposal_issue_stale_late_career_");
    for (const sourceId of issue.relatedIncomeSourceIds || []) {
      const source = ledger.incomeSources.find((item) => item.id === sourceId && item.status === "active");
      if (!source) continue;
      source.factStatus = "needs_review";
      if (completenessPolicyAlreadyApplied) {
        source.accrualReviewStatus = "quarantined";
        continue;
      }
      const pendingId = `pending_fact_income_${sourceId}`;
      const pending = addOrObserveIssue(ledger, {
          id: pendingId,
          code: "PENDING_FACT",
          severity: "blocking",
          status: "open",
          relatedProposalIds: [...issue.relatedProposalIds],
          relatedIncomeSourceIds: [sourceId],
          summary: issue.pendingFactPolicy === "bounded_last_known_income"
            ? `收入来源 ${source.displayName} 的调整事实未能通过校验；旧权威基线最多沿用2个节点，等待修复确认`
            : `收入来源 ${source.displayName} 的新事实未能通过校验，后续确定性计提已隔离等待确认`,
          createdAtAgeInMonths: ageInMonths
        }, ageInMonths);
      source.accrualReviewStatus = issue.pendingFactPolicy === "bounded_last_known_income" && (pending.occurrenceCount || 1) < 2
        ? "normal"
        : "quarantined";
    }
    for (const commitmentId of issue.relatedAccountIds || []) {
      const commitment = ledger.expenseCommitments.find((item) => item.id === commitmentId && item.status === "active");
      if (commitment) {
        commitment.factStatus = "needs_review";
        commitment.accrualReviewStatus = "conservative";
      }
    }
    for (const debtId of issue.relatedDebtAccountIds || []) {
      const debt = ledger.debtAccounts.find((item) => item.id === debtId);
      if (debt) debt.factStatus = "needs_review";
    }
    for (const holdingId of issue.relatedBusinessHoldingIds || []) {
      const holding = ledger.businessHoldings.find((item) => item.id === holdingId);
      if (holding) holding.factStatus = "needs_review";
    }
  }
}

function addLegacyIncomeReconfirmation(ledger: FinancialLedger, ageInMonths: number): void {
  for (const source of ledger.incomeSources) {
    if (source.status !== "active" || !source.id.startsWith("legacy_") || source.factStatus !== "estimated" || source.accrualReviewStatus === "quarantined") continue;
    const lastConfirmedAt = source.lastConfirmedAtAgeInMonths ?? source.activeFromAgeInMonths;
    const materialTransactions = ledger.recentTransactions.filter((transaction) => transaction.periodEndAgeInMonths > lastConfirmedAt).length;
    if (ageInMonths - lastConfirmedAt < 36 && materialTransactions < 3) continue;
    source.factStatus = "needs_review";
    source.accrualReviewStatus = "quarantined";
    const issueId = `pending_fact_legacy_income_${source.id}`;
    addOrObserveIssue(ledger, {
      id: issueId,
      code: "PENDING_FACT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      relatedIncomeSourceIds: [source.id],
      summary: `旧版估算收入 ${source.displayName} 已连续多个实质节点未获确认，确定性计提已隔离；下一节点需要确认当前收入`,
      createdAtAgeInMonths: ageInMonths
    }, ageInMonths);
  }
}

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
  financialIssues?: FinancialLedgerIssue[];
  liquidityPolicy?: LiquidityPolicy;
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
  const settlementLedger = structuredClone(input.currentFinancialLedger);
  applyStudentFamilySupportLifecycle({
    ledger: settlementLedger,
    currentEmploymentStatus: currentState.employmentStatus,
    transitions: input.acceptedCareerTransitions
  });
  const completenessIssues = applyPreAccrualFactCompletenessPolicy({
    ledger: settlementLedger,
    events: input.acceptedFinancialEvents,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths
  });
  const financialResult = reduceFinancialLedger({
    ledger: settlementLedger,
    transactionId: input.transactionId,
    expectedLedgerRevision: input.expectedLedgerRevision,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    events: input.acceptedFinancialEvents,
    liquidityPolicy: input.liquidityPolicy
  });
  if (financialResult.alreadyCommitted || !("periodSummary" in financialResult)) {
    throw new FinancialLedgerInvariantError("REVISION_CONFLICT", "事务在原子提交过程中被重复处理");
  }
  const committedLedger = structuredClone(financialResult.ledger);
  for (const source of committedLedger.incomeSources) {
    if (source.status === "active" && isDefaultStudentFamilySupport(source)
      && source.activeUntilAgeInMonths !== undefined && source.activeUntilAgeInMonths <= input.periodEndAgeInMonths) {
      source.status = "ended";
    }
  }
  resolveIssuesFromAcceptedEvents(committedLedger, input.acceptedFinancialEvents, input.periodEndAgeInMonths);
  const newIssues = [...completenessIssues, ...(input.financialIssues || [])];
  for (const issue of newIssues) addOrObserveIssue(committedLedger, issue, input.periodEndAgeInMonths);
  applyPendingFactPolicy(committedLedger, newIssues, input.periodEndAgeInMonths);
  addLegacyIncomeReconfirmation(committedLedger, input.periodEndAgeInMonths);
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
    financialLedger: committedLedger,
    worldState: nextWorldState,
    financialTransaction: financialResult.transaction,
    financialPeriodSummary: financialResult.periodSummary,
    derivedFinancialState: deriveFinancialState({
      ledger: committedLedger,
      periodSummary: financialResult.periodSummary,
      employmentStatus: nextCurrentCareerState.employmentStatus
    }),
    alreadyCommitted: false
  };
}
