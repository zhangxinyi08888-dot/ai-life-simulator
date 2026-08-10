import type { AcceptedCareerTransition } from "../career/types";
import type { AcceptedFinancialEvent, FinancialLedger, FinancialLedgerIssue } from "./types";

export interface CareerIncomeAtomicityResult {
  acceptedCareerTransitions: AcceptedCareerTransition[];
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  issues: FinancialLedgerIssue[];
}

const EXPLICIT_PERSONAL_INCOME_PATTERN = /(?:(?:你|主角|本人).{0,80}(?:(?:税后)?(?:月薪|年薪|月收入|年收入|工资|薪资|可支配收入|个人进账|业主提款|分红)(?:约为|约|达到|增至|稳定在|为)?\s*\d|(?:给自己发|领取|提取|获得|收到).{0,20}\d+(?:\.\d+)?\s*万元?.{0,20}(?:个人提款|工资|薪资|业主提款|分红))|(?:个人净收入|个人可支配收入|个人进账)(?:仅|约为|约|达到|为)?\s*\d)/u;
// Business activity is not personal income. A contract, customer, order,
// course or company receipt only crosses the personal-income boundary when
// the prose explicitly says money reached the protagonist.
const NEW_PERSONAL_INCOME_ACTIVITY_PATTERN = /(?:对方[^。！？]{0,24}(?:付了|支付|付给你|向你支付|结算给你)[^。！？]{0,20}(?:咨询费|顾问费|课酬)|(?:你|本人|主角)[^。！？]{0,20}(?:收了|收到|拿到|获得)[^。！？]{0,12}(?:\d+(?:\.\d+)?|[零一二三四五六七八九十百千万两]+)\s*(?:万|千|百)?元|(?:你|本人|主角)(?:的)?[^。！？]{0,16}(?:个人收入|个人进账|可支配收入|现金收入)[^。！？]{0,16}(?:增加|新增|形成|到账|稳定)|(?:你|本人|主角)[^。！？]{0,20}(?:多了|新增|形成|建立)[^。！？]{0,12}(?:一条|新的?)?[^。！？]{0,6}(?:个人)?收入来源)/u;
const PERSONAL_INCOME_COMPLETION_SIGNAL_PATTERN = /(?:(?:这笔|该笔)(?:订单|咨询|顾问|课程|副业)?[^。！？]{0,12}(?:让我|使我|给我|个人)[^。！？]{0,8}(?:收入|进账|现金流)[^。！？]{0,16}(?:到账|增加|稳定|形成)?|(?:个人收入|个人进账|可支配收入)[^。！？]{0,16}(?:稳定|形成|增加|新增|额外|到账)|(?:你|本人|主角)[^。！？]{0,28}(?:按次收费|每次收费|收取(?:了)?费用|拿到(?:分成|佣金|报酬)|(?:分成|佣金|报酬)[^。！？]{0,8}到账)|(?:支付|到账|收到)[^。！？]{0,16}(?:分成|佣金|报酬)|(?:分成|佣金|报酬)[^。！？]{0,20}(?:支付|到账|垫付))/u;
const COMPANY_OPERATING_INCOME_PATTERN = /(?:公司|企业|平台|团队|工作室|机构|中心|项目|产品)(?:的)?[^。！？]{0,32}(?:营收|销售额|合同额|客户回款|项目收入|营业收入|合同|订单|客户|试点|采购|咨询|培训)/u;
const EXPLICIT_UNPAID_PATTERN = /(?:暂不|没有|未|不)(?:领取|提取|获得)(?:个人)?(?:工资|薪资|业主提款|分红|收入)|不领薪|无薪/u;
const TENTATIVE_PERSONAL_INCOME_PATTERN = /(?:个人)?收入[^。！？]{0,16}(?:是否形成|尚待确认|仍需观察|未形成|没有形成|尚未形成|暂时没有)|(?:是否形成|尚待确认|仍需观察|未形成|没有形成|尚未形成|暂时没有)[^。！？]{0,16}(?:个人)?收入/u;

export function narrativeClaimsExplicitPersonalIncome(narrativeText: string): boolean {
  if (hasExplicitUnpaidPersonalIncomeStatement(narrativeText)) return false;
  return narrativeText.split(/(?<=[。！？；])/u).some((sentence) => (
    EXPLICIT_PERSONAL_INCOME_PATTERN.test(sentence)
    && !/(?:公司|企业|项目|平台|团队|工作室|机构|中心)(?:的)?(?:年收入|月收入|营收|销售额|回款)/u.test(sentence)
    && !/(?:辞职|辞去|离职|退休|离开|结束|中断|停发|上一份|原工作).{0,36}(?:月薪|年薪|工资|薪资)|(?:月薪|年薪|工资|薪资).{0,36}(?:辞职|辞去|离职|退休|结束|中断|停发)/u.test(sentence)
  ));
}

export function narrativeClaimsNewPersonalIncomeActivity(narrativeText: string): boolean {
  if (hasExplicitUnpaidPersonalIncomeStatement(narrativeText)) return false;
  let companyOperationContext = false;
  for (const sentence of narrativeText.split(/(?<=[。！？；])/u)) {
    const companyOperation = COMPANY_OPERATING_INCOME_PATTERN.test(sentence);
    companyOperationContext = companyOperationContext || companyOperation;
    if (companyOperationContext
      && !NEW_PERSONAL_INCOME_ACTIVITY_PATTERN.test(sentence)
      && !EXPLICIT_PERSONAL_INCOME_PATTERN.test(sentence)
      && /(?:这笔|该笔)(?:订单|合同|采购|回款)|(?:咨询|培训|课程|业务|主业)[^。！？]{0,24}(?:收入|现金流|进账|回款|收费|基本盘)/u.test(sentence)) {
      continue;
    }
    if (sentenceClaimsNewPersonalIncomeActivity(sentence)) return true;
  }
  return false;
}

export function sentenceClaimsNewPersonalIncomeActivity(sentence: string): boolean {
  if (TENTATIVE_PERSONAL_INCOME_PATTERN.test(sentence)) return false;
  if (NEW_PERSONAL_INCOME_ACTIVITY_PATTERN.test(sentence)) return true;
  if (COMPANY_OPERATING_INCOME_PATTERN.test(sentence)) return false;
  return PERSONAL_INCOME_COMPLETION_SIGNAL_PATTERN.test(sentence)
    || /(?:这笔|该笔)[^。！？]{0,16}(?:收入|进账|现金流)/u.test(sentence);
}

export function hasExplicitUnpaidPersonalIncomeStatement(narrativeText: string): boolean {
  return EXPLICIT_UNPAID_PATTERN.test(narrativeText);
}

function acceptedPersonalIncomeEvent(event: AcceptedFinancialEvent): boolean {
  if (event.kind === "business_distribution_received" || event.kind === "one_off_income_received") return true;
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
  const newPersonalIncomeActivityClaimed = narrativeClaimsNewPersonalIncomeActivity(input.narrativeText);
  const currentPersonalIncomeClaimed = narrativeClaimsExplicitPersonalIncome(input.narrativeText);
  if (!currentPersonalIncomeClaimed && !newPersonalIncomeActivityClaimed) return [];
  if (input.acceptedFinancialEvents.some(acceptedPersonalIncomeEvent)) return [];
  if (newPersonalIncomeActivityClaimed) {
    return [{
      id: `personal_income_claim_without_event_${input.ageInMonths}`,
      code: "CAREER_INCOME_CONFLICT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      summary: "正文宣告了本轮新增个人收入活动，但没有对应的已接受个人收入事件",
      createdAtAgeInMonths: input.ageInMonths
    }];
  }
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

function dedupeSameEvidenceCareerIncome(events: AcceptedFinancialEvent[]): AcceptedFinancialEvent[] {
  const result: AcceptedFinancialEvent[] = [];
  const keyToIndex = new Map<string, number>();
  for (const event of events) {
    if (event.kind !== "income_source_started" || !event.payload.linkedCareerStateId) {
      result.push(event);
      continue;
    }
    const excerpt = event.evidence.map((item) => item.excerpt?.trim()).filter(Boolean).join("|");
    if (!excerpt) {
      result.push(event);
      continue;
    }
    const amount = Number.isFinite(Number(event.payload.monthlyNetAmountWan))
      ? `m:${Number(event.payload.monthlyNetAmountWan)}`
      : `a:${Number(event.payload.annualNetAmountWan || 0)}`;
    const key = [
      event.payload.linkedCareerStateId,
      event.effectiveAtAgeInMonths,
      amount,
      excerpt
    ].join("::");
    const existingIndex = keyToIndex.get(key);
    if (existingIndex === undefined) {
      keyToIndex.set(key, result.length);
      result.push(event);
      continue;
    }
    const existing = result[existingIndex];
    const existingIsSynthetic = existing.proposalId.startsWith("selected_personal_income_");
    const candidateIsSynthetic = event.proposalId.startsWith("selected_personal_income_");
    if (existingIsSynthetic && !candidateIsSynthetic) result[existingIndex] = event;
  }
  return result;
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
  const authoritativeFinancialEvents = dedupeSameEvidenceCareerIncome(input.financialEvents);
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
    const settledIds = new Set(authoritativeFinancialEvents.flatMap((event) => {
      const sourceId = incomeSourceId(event);
      if (!sourceId) return [];
      if (event.kind !== "income_source_adjusted") return [sourceId];
      return event.payload.nextSource.linkedCareerStateId === transition.nextCareerState.id ? [sourceId] : [];
    }));
    const missing = linkedActiveSources.filter((source) => !settledIds.has(source.id));
    const hasNextCareerIncome = authoritativeFinancialEvents.some((event) => (
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

  const committedCareerStateIds = new Set([
    input.currentCareerStateId,
    ...acceptedCareerTransitions.map((transition) => transition.nextCareerState.id)
  ]);
  const acceptedFinancialEvents = authoritativeFinancialEvents.filter((event) => {
    const sourceId = incomeSourceId(event);
    if (sourceId && removedIncomeSourceIds.has(sourceId)) return false;
    if (event.kind === "income_source_started" && event.payload.linkedCareerStateId && removedCareerStateIds.has(event.payload.linkedCareerStateId)) return false;
    if (event.kind === "income_source_adjusted" && event.payload.nextSource.linkedCareerStateId && removedCareerStateIds.has(event.payload.nextSource.linkedCareerStateId)) return false;
    const linkedCareerStateId = event.kind === "income_source_started"
      ? event.payload.linkedCareerStateId
      : event.kind === "income_source_adjusted"
        ? event.payload.nextSource.linkedCareerStateId
        : undefined;
    if (linkedCareerStateId && !committedCareerStateIds.has(linkedCareerStateId)) {
      issues.push({
        id: `career_income_uncommitted_state_${event.proposalId}_${input.ageInMonths}`,
        code: "CAREER_INCOME_CONFLICT",
        severity: "blocking",
        status: "open",
        relatedProposalIds: [event.proposalId],
        relatedIncomeSourceIds: sourceId ? [sourceId] : [],
        summary: `收入事件引用了未提交的 CareerState，已与职业转换一起拒绝：${linkedCareerStateId}`,
        createdAtAgeInMonths: input.ageInMonths
      });
      return false;
    }
    return true;
  });

  return { acceptedCareerTransitions, acceptedFinancialEvents, issues };
}
