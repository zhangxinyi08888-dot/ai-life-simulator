import type { ExpenseResponsibilityEstimateContext } from "./expenseEstimationPolicyV2";
import { estimateUnclassifiedCoreConsumption } from "./expenseAggregateFallbackPolicyV1";
import { roundWan } from "./ledgerMath";
import type {
  AcceptedFinancialEvent,
  ExpenseCommitmentV4,
  FinancialEvidence,
  FinancialLedgerV4,
  IncomeSource
} from "./types";

export const UNCLASSIFIED_CORE_EXPENSE_ID = "system_unclassified_core_consumption";
export const UNCLASSIFIED_CORE_EXPENSE_KEY = "unclassified_core_consumption:protagonist";

function annualIncome(source: IncomeSource): number {
  if (source.status !== "active" || source.accrualPolicy === "event_only" || source.accrualReviewStatus === "quarantined") return 0;
  if (source.type === "family_support") return 0;
  return source.accrualPolicy === "annual"
    ? source.annualNetAmountWan || 0
    : (source.monthlyNetAmountWan || 0) * 12;
}

function isUnclassified(commitment: ExpenseCommitmentV4): boolean {
  return commitment.responsibilityKind === "unclassified_core_consumption";
}

function isLegacyAggregate(commitment: ExpenseCommitmentV4): boolean {
  return commitment.status === "active" && commitment.responsibilityKind === "legacy_aggregate";
}

function isAggregateFallbackEligible(commitments: ExpenseCommitmentV4[]): boolean {
  const active = commitments.filter((item) => item.status === "active");
  const activeBasicLiving = active.filter((item) => item.responsibilityKind === "adult_basic_living");
  // The fallback is allowed only when an adult-basic policy floor proves that
  // the total recurring-consumption picture is incomplete. Accepted typed
  // components (rent, healthcare, care, and so on) are compatible with that
  // state and must reduce the residual rather than suppress it altogether.
  // Conversely, an exact/last-known basic-living amount is real evidence and
  // must never be padded merely to match a statistical prior.
  return activeBasicLiving.length === 1 && activeBasicLiving.every((item) => (
    item.responsibilityKind === "adult_basic_living"
    && item.factStatus !== "known"
    && (item.amountBasis === "policy_floor" || item.amountBasis === "contextual_estimate")
  ));
}

function activeTypedMonthly(commitments: ExpenseCommitmentV4[]): number {
  return roundWan(commitments
    .filter((item) => item.status === "active" && !isUnclassified(item) && item.responsibilityKind !== "legacy_aggregate")
    .reduce((sum, item) => sum + item.monthlyAmountWan, 0));
}

function applyIncomeEvent(sources: IncomeSource[], event: AcceptedFinancialEvent): void {
  if (event.kind === "income_source_started") {
    const next = structuredClone(event.payload) as IncomeSource;
    const index = sources.findIndex((item) => item.id === next.id);
    if (index >= 0) sources[index] = next;
    else sources.push(next);
    return;
  }
  if (event.kind === "income_source_adjusted") {
    const next = structuredClone(event.payload.nextSource) as IncomeSource;
    const index = sources.findIndex((item) => item.id === event.payload.incomeSourceId);
    if (index >= 0) sources[index] = next;
    else sources.push(next);
    return;
  }
  if (event.kind === "income_source_paused" || event.kind === "income_source_ended") {
    const existing = sources.find((item) => item.id === event.payload.incomeSourceId);
    if (existing) existing.status = event.kind === "income_source_paused" ? "paused" : "ended";
  }
}

function applyExpenseEvent(commitments: ExpenseCommitmentV4[], event: AcceptedFinancialEvent): void {
  if (event.kind === "expense_commitment_started") {
    const next = structuredClone(event.payload) as ExpenseCommitmentV4;
    if (!isUnclassified(next)) commitments.push(next);
    return;
  }
  if (event.kind === "expense_commitment_adjusted") {
    const next = structuredClone(event.payload.nextCommitment) as ExpenseCommitmentV4;
    if (isUnclassified(next)) return;
    const index = commitments.findIndex((item) => item.id === event.payload.expenseCommitmentId);
    if (index >= 0) commitments[index] = next;
    return;
  }
  if (event.kind === "expense_commitment_ended") {
    const existing = commitments.find((item) => item.id === event.payload.expenseCommitmentId);
    if (existing && !isUnclassified(existing)) existing.status = "ended";
  }
}

function policyEvidence(excerpt: string, reasonCode = "EXPENSE_UNCLASSIFIED_CORE_CONSUMPTION"): FinancialEvidence {
  return {
    source: "system_policy",
    reasonCode,
    excerpt,
    confidence: 1,
    financialScope: "personal"
  };
}

function acceptedEventBase(input: {
  id: string;
  effectiveAtAgeInMonths: number;
  evidence: FinancialEvidence;
}): Pick<AcceptedFinancialEvent, "id" | "effectiveAtAgeInMonths" | "evidence" | "acceptedByReasonCodes"> {
  return {
    id: input.id,
    effectiveAtAgeInMonths: input.effectiveAtAgeInMonths,
    evidence: [input.evidence],
    acceptedByReasonCodes: ["EXPENSE_UNCLASSIFIED_RESIDUAL_POLICY"]
  };
}

export interface ReconcileUnclassifiedCoreExpenseInput {
  ledger: FinancialLedgerV4;
  transactionId: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  estimateContext: Omit<ExpenseResponsibilityEstimateContext, "responsibilityKind" | "ageInMonths">;
}

/**
 * Returns deterministic internal events.  The same function runs inside
 * Preview and Commit, so a rejected node never mutates the authoritative
 * ledger.  Newly accepted typed components consume the residual at the same
 * event boundary, preventing double accrual without inventing category facts.
 */
export function reconcileUnclassifiedCoreExpense(
  input: ReconcileUnclassifiedCoreExpenseInput
): AcceptedFinancialEvent[] {
  if (input.ledger.expenseCommitments.some(isLegacyAggregate)) return [];
  const existing = input.ledger.expenseCommitments.find((item) => item.status === "active" && isUnclassified(item));
  if (!existing && !isAggregateFallbackEligible(input.ledger.expenseCommitments)) return [];
  const projectedIncomeSources = structuredClone(input.ledger.incomeSources);
  for (const event of input.acceptedFinancialEvents
    .filter((candidate) => candidate.effectiveAtAgeInMonths === input.periodStartAgeInMonths)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    applyIncomeEvent(projectedIncomeSources, event);
  }
  const estimate = estimateUnclassifiedCoreConsumption({
    ageInMonths: input.periodStartAgeInMonths,
    ...input.estimateContext,
    annualRecurringPersonalIncomeWan: roundWan(projectedIncomeSources.reduce((sum, source) => sum + annualIncome(source), 0))
  });
  if (!estimate) return [];

  const projected = structuredClone(input.ledger.expenseCommitments);
  const acceptedExpenseEvents = input.acceptedFinancialEvents
    .filter((event) => event.kind.startsWith("expense_commitment_") && !String((event.payload as any).responsibilityKind || (event.payload as any).nextCommitment?.responsibilityKind || "").includes("unclassified_core_consumption"))
    .sort((left, right) => left.effectiveAtAgeInMonths - right.effectiveAtAgeInMonths);
  const events: AcceptedFinancialEvent[] = [];
  let residual = existing?.monthlyAmountWan || 0;
  let currentCommitment = existing ? structuredClone(existing) : undefined;
  const nextCommitmentId = input.ledger.expenseCommitments.some((item) => item.id === UNCLASSIFIED_CORE_EXPENSE_ID)
    ? `${UNCLASSIFIED_CORE_EXPENSE_ID}_${input.periodStartAgeInMonths}`
    : UNCLASSIFIED_CORE_EXPENSE_ID;

  const emit = (ageInMonths: number, desired: number, reason: "context" | "reallocation") => {
    const nextAmount = roundWan(Math.max(0, desired));
    if (!currentCommitment && nextAmount <= 0) return;
    const suffix = `${ageInMonths}_${events.length}`;
    if (!currentCommitment) {
      const evidence = policyEvidence(`分类事实不足；按 ${estimate.policyId}@${estimate.policyVersion} 建立未分类核心支出余额 ${nextAmount} 万/月`);
      currentCommitment = {
        id: nextCommitmentId,
        responsibilityKey: UNCLASSIFIED_CORE_EXPENSE_KEY,
        responsibilityKind: "unclassified_core_consumption",
        type: "other",
        displayName: "未分类核心生活支出估算",
        monthlyAmountWan: nextAmount,
        plausibleMonthlyAmountRangeWan: estimate.plausibleRangeWan,
        amountBasis: "contextual_estimate",
        amountSourceIds: [`${estimate.policyId}@${estimate.policyVersion}`],
        estimationPolicyId: estimate.policyId,
        financialScope: "personal",
        activeFromAgeInMonths: ageInMonths,
        status: "active",
        factStatus: "needs_review",
        accrualReviewStatus: "conservative",
        lastReviewedAtAgeInMonths: ageInMonths,
        nextReviewAtAgeInMonths: ageInMonths + 12,
        evidence: [evidence]
      };
      events.push({
        ...acceptedEventBase({ id: `system_unclassified_start_${input.transactionId}_${suffix}`, effectiveAtAgeInMonths: ageInMonths, evidence }),
        kind: "expense_commitment_started",
        payload: structuredClone(currentCommitment)
      } as AcceptedFinancialEvent);
      residual = nextAmount;
      return;
    }
    if (Math.abs(nextAmount - residual) <= 0.0001) return;
    const evidence = policyEvidence(
      reason === "reallocation"
        ? `新分类责任已接受；未分类余额从 ${residual} 万/月原子重分配为 ${nextAmount} 万/月`
        : `上下文估计提高；未分类余额从 ${residual} 万/月调整为 ${nextAmount} 万/月`,
      reason === "reallocation"
        ? "EXPENSE_UNCLASSIFIED_RESIDUAL_REALLOCATION"
        : "EXPENSE_UNCLASSIFIED_CORE_CONSUMPTION"
    );
    if (nextAmount <= 0) {
      events.push({
        ...acceptedEventBase({ id: `system_unclassified_end_${input.transactionId}_${suffix}`, effectiveAtAgeInMonths: ageInMonths, evidence }),
        kind: "expense_commitment_ended",
        payload: {
          expenseCommitmentId: currentCommitment.id,
          previousCommitmentId: currentCommitment.id,
          changeReason: "aggregate_residual_reallocated"
        }
      } as AcceptedFinancialEvent);
      currentCommitment = undefined;
      residual = 0;
      return;
    }
    const next: ExpenseCommitmentV4 = {
      ...structuredClone(currentCommitment),
      monthlyAmountWan: nextAmount,
      plausibleMonthlyAmountRangeWan: estimate.plausibleRangeWan,
      lastReviewedAtAgeInMonths: ageInMonths,
      nextReviewAtAgeInMonths: ageInMonths + 12,
      evidence: [...currentCommitment.evidence, evidence]
    };
    events.push({
      ...acceptedEventBase({ id: `system_unclassified_adjust_${input.transactionId}_${suffix}`, effectiveAtAgeInMonths: ageInMonths, evidence }),
      kind: "expense_commitment_adjusted",
      payload: {
        expenseCommitmentId: currentCommitment.id,
        nextCommitment: next,
        ...(nextAmount < residual ? {
          previousCommitmentId: currentCommitment.id,
          changeReason: "aggregate_residual_reallocated" as const
        } : {})
      }
    } as AcceptedFinancialEvent);
    currentCommitment = next;
    residual = nextAmount;
  };

  const typedBeforeStartBoundary = activeTypedMonthly(projected);
  const startBoundaryEvents = acceptedExpenseEvents.filter((event) => event.effectiveAtAgeInMonths === input.periodStartAgeInMonths);
  for (const event of startBoundaryEvents) applyExpenseEvent(projected, event);
  const typedAfterStartBoundary = activeTypedMonthly(projected);
  const initialGap = roundWan(Math.max(0, estimate.targetMonthlyCoreExpenseWan - typedAfterStartBoundary));
  const acceptedStartIncrease = roundWan(Math.max(0, typedAfterStartBoundary - typedBeforeStartBoundary));
  const carriedResidual = roundWan(Math.max(0, residual - acceptedStartIncrease));
  emit(input.periodStartAgeInMonths, Math.max(carriedResidual, initialGap), acceptedStartIncrease > 0 ? "reallocation" : "context");

  const laterBoundaries = [...new Set(acceptedExpenseEvents
    .map((event) => event.effectiveAtAgeInMonths)
    .filter((age) => age > input.periodStartAgeInMonths && age <= input.periodEndAgeInMonths))];
  for (const boundary of laterBoundaries) {
    const before = activeTypedMonthly(projected);
    for (const event of acceptedExpenseEvents.filter((candidate) => candidate.effectiveAtAgeInMonths === boundary)) {
      applyExpenseEvent(projected, event);
    }
    const after = activeTypedMonthly(projected);
    const acceptedIncrease = roundWan(Math.max(0, after - before));
    if (acceptedIncrease > 0 && residual > 0) emit(boundary, Math.max(0, residual - acceptedIncrease), "reallocation");
  }
  return events;
}
