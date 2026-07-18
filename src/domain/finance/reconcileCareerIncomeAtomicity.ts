import type { AcceptedCareerTransition } from "../career/types";
import type { AcceptedFinancialEvent, FinancialLedger, FinancialLedgerIssue } from "./types";

export interface CareerIncomeAtomicityResult {
  acceptedCareerTransitions: AcceptedCareerTransition[];
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  issues: FinancialLedgerIssue[];
}

function incomeSourceId(event: AcceptedFinancialEvent): string | undefined {
  if (event.kind === "income_source_ended" || event.kind === "income_source_paused" || event.kind === "income_source_adjusted") {
    return event.payload.incomeSourceId;
  }
  return undefined;
}

/**
 * Career role changes are cross-domain facts. Retirement commits with closure of
 * the old wage; a new working role commits with settlement of the old wage and an
 * active source linked to the next CareerState. Passive income remains untouched.
 */
export function reconcileCareerIncomeAtomicity(input: {
  currentCareerStateId: string;
  currentLedger: FinancialLedger;
  careerTransitions: AcceptedCareerTransition[];
  financialEvents: AcceptedFinancialEvent[];
  ageInMonths: number;
}): CareerIncomeAtomicityResult {
  const removedCareerStateIds = new Set<string>();
  const removedIncomeSourceIds = new Set<string>();
  const issues: FinancialLedgerIssue[] = [];
  const acceptedCareerTransitions = input.careerTransitions.filter((transition) => {
    const nextStatus = transition.nextCareerState.employmentStatus;
    const stopsWorking = nextStatus === "retired" || nextStatus === "not_working";
    const continuesWorking = nextStatus === "employed" || nextStatus === "part_time" || nextStatus === "self_employed";
    if (!stopsWorking && !continuesWorking) return true;
    const linkedActiveSources = input.currentLedger.incomeSources.filter((source) => (
      source.status === "active" && source.linkedCareerStateId === input.currentCareerStateId
    ));
    const settledIds = new Set(input.financialEvents.flatMap((event) => {
      const sourceId = incomeSourceId(event);
      if (!sourceId) return [];
      if (event.kind !== "income_source_adjusted") return [sourceId];
      return event.payload.nextSource.linkedCareerStateId === transition.nextCareerState.id ? [sourceId] : [];
    }));
    const missing = linkedActiveSources.filter((source) => !settledIds.has(source.id));
    const hasNextCareerIncome = input.financialEvents.some((event) => (
      (event.kind === "income_source_started" && event.payload.status === "active" && event.payload.linkedCareerStateId === transition.nextCareerState.id)
      || (event.kind === "income_source_adjusted" && event.payload.nextSource.status === "active" && event.payload.nextSource.linkedCareerStateId === transition.nextCareerState.id)
    ));
    if (missing.length === 0 && (!continuesWorking || hasNextCareerIncome)) return true;

    removedCareerStateIds.add(transition.nextCareerState.id);
    for (const source of linkedActiveSources) removedIncomeSourceIds.add(source.id);
    issues.push({
      id: `career_income_atomicity_${transition.proposalId}_${input.ageInMonths}`,
      code: "CAREER_INCOME_CONFLICT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [transition.proposalId],
      relatedIncomeSourceIds: linkedActiveSources.map((source) => source.id),
      summary: continuesWorking && !hasNextCareerIncome
        ? `职业转换缺少关联到新 CareerState 的有效收入来源：${transition.nextCareerState.id}`
        : `职业转换缺少旧收入来源的结束、暂停或迁移事件：${missing.map((source) => source.id).join("、")}`,
      createdAtAgeInMonths: input.ageInMonths
    });
    return false;
  });

  const acceptedFinancialEvents = input.financialEvents.filter((event) => {
    const sourceId = incomeSourceId(event);
    if (sourceId && removedIncomeSourceIds.has(sourceId)) return false;
    if (event.kind === "income_source_started" && event.payload.linkedCareerStateId && removedCareerStateIds.has(event.payload.linkedCareerStateId)) return false;
    if (event.kind === "income_source_adjusted" && event.payload.nextSource.linkedCareerStateId && removedCareerStateIds.has(event.payload.nextSource.linkedCareerStateId)) return false;
    return true;
  });

  return { acceptedCareerTransitions, acceptedFinancialEvents, issues };
}
