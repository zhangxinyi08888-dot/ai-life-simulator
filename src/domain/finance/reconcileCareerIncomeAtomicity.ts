import type { AcceptedCareerTransition } from "../career/types";
import type { AcceptedFinancialEvent, FinancialLedger, FinancialLedgerIssue } from "./types";

export interface CareerIncomeAtomicityResult {
  acceptedCareerTransitions: AcceptedCareerTransition[];
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  issues: FinancialLedgerIssue[];
}

const EXPLICIT_PERSONAL_INCOME_PATTERN = /(?:(?:你|主角|本人).{0,80}(?:(?:税后)?(?:月薪|年薪|月收入|年收入|工资|薪资|可支配收入|个人进账|业主提款|分红)(?:约为|约|达到|增至|稳定在|为)?\s*\d|(?:给自己发|领取|提取|获得|收到).{0,20}\d+(?:\.\d+)?\s*万元?.{0,20}(?:个人提款|工资|薪资|业主提款|分红))|(?:个人净收入|个人可支配收入|个人进账)(?:仅|约为|约|达到|为)?\s*\d)/u;
const EXPLICIT_UNPAID_PATTERN = /(?:暂不|没有|未|不)(?:领取|提取|获得)(?:个人)?(?:工资|薪资|业主提款|分红|收入)|不领薪|无薪/u;

export function hasExplicitUnpaidPersonalIncomeStatement(narrativeText: string): boolean {
  return EXPLICIT_UNPAID_PATTERN.test(narrativeText);
}

function acceptedPersonalIncomeEvent(event: AcceptedFinancialEvent): boolean {
  if (event.kind === "business_distribution_received") return true;
  if (event.kind === "income_source_started") {
    return ["salary", "contract", "self_employment_draw", "business_dividend"].includes(event.payload.type)
      && event.payload.status === "active";
  }
  if (event.kind === "income_source_adjusted") {
    return ["salary", "contract", "self_employment_draw", "business_dividend"].includes(event.payload.nextSource.type)
      && event.payload.nextSource.status === "active";
  }
  return false;
}

/** Audits prose claims; it never creates income or changes CareerState. */
export function collectPersonalIncomeNarrativeContractIssues(input: {
  narrativeText: string;
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  ageInMonths: number;
  currentLedger?: FinancialLedger;
}): FinancialLedgerIssue[] {
  if (hasExplicitUnpaidPersonalIncomeStatement(input.narrativeText)) return [];
  const currentPersonalIncomeClaimed = input.narrativeText.split(/(?<=[。！？；])/u).some((sentence) => (
    EXPLICIT_PERSONAL_INCOME_PATTERN.test(sentence)
    && !/(?:辞职|辞去|离职|退休|离开|结束|中断|停发|上一份|原工作).{0,36}(?:月薪|年薪|工资|薪资)|(?:月薪|年薪|工资|薪资).{0,36}(?:辞职|辞去|离职|退休|结束|中断|停发)/u.test(sentence)
  ));
  if (!currentPersonalIncomeClaimed) return [];
  if (input.acceptedFinancialEvents.some(acceptedPersonalIncomeEvent)) return [];
  const hasCurrentPersonalIncomeAuthority = input.currentLedger?.incomeSources.some((source) => (
    source.status === "active"
    && Boolean(source.linkedCareerStateId)
    && ["salary", "contract", "self_employment_draw", "other"].includes(source.type)
    && source.accrualReviewStatus !== "quarantined"
    && source.factStatus !== "needs_review"
  ));
  if (hasCurrentPersonalIncomeAuthority) return [];
  return [{
    id: `personal_income_claim_without_event_${input.ageInMonths}`,
    code: "CAREER_INCOME_CONFLICT",
    severity: "blocking",
    status: "open",
    relatedProposalIds: [],
    summary: "正文明确声明主角个人收入，但本节点没有对应的已接受工资、业主提款或分红事件",
    createdAtAgeInMonths: input.ageInMonths
  }];
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
  explicitUnpaid?: boolean;
  /** True only when prose claims an actual personal salary, draw or dividend. */
  personalIncomeClaimed?: boolean;
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
    const selfEmployedWithoutPersonalIncome = nextStatus === "self_employed" && input.personalIncomeClaimed === false;
    if (missing.length === 0 && (!continuesWorking || hasNextCareerIncome || input.explicitUnpaid || selfEmployedWithoutPersonalIncome)) return true;

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
