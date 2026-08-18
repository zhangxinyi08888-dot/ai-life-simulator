import type { AcceptedCareerTransition, CareerState } from "../career/types";
import type {
  CareerCompensationEstimate,
  CareerCompensationPolicyInputs,
  CareerCompensationStage,
  CareerEmploymentType,
  CareerOccupationFamily,
  FinancialEventProposal,
  FinancialLedger,
  IncomeSource
} from "./types";

export const CAREER_COMPENSATION_POLICY_ID = "career_compensation_cn_v1" as const;
export const CAREER_COMPENSATION_POLICY_VERSION = 1 as const;
export const CAREER_COMPENSATION_REFERENCE_YEAR = 2026;
const REVIEW_INTERVAL_MONTHS = 12;

interface CompensationBand {
  min: number;
  max: number;
}

const BASE_BANDS: Record<CareerOccupationFamily, Record<CareerCompensationStage, CompensationBand>> = {
  software_engineering: {
    internship: { min: 0.25, max: 0.8 }, entry: { min: 0.9, max: 1.6 }, mid: { min: 1.5, max: 2.8 },
    senior: { min: 2.5, max: 4.5 }, lead: { min: 3.2, max: 5.5 }, manager: { min: 3.5, max: 6.5 }, executive: { min: 5, max: 10 }
  },
  design: {
    internship: { min: 0.2, max: 0.65 }, entry: { min: 0.65, max: 1.25 }, mid: { min: 1.1, max: 2.1 },
    senior: { min: 1.8, max: 3.2 }, lead: { min: 2.3, max: 4 }, manager: { min: 2.8, max: 5 }, executive: { min: 4, max: 8 }
  },
  product: {
    internship: { min: 0.2, max: 0.7 }, entry: { min: 0.75, max: 1.4 }, mid: { min: 1.3, max: 2.5 },
    senior: { min: 2.2, max: 4 }, lead: { min: 2.8, max: 5 }, manager: { min: 3.2, max: 6 }, executive: { min: 5, max: 10 }
  },
  management: {
    internship: { min: 0.2, max: 0.6 }, entry: { min: 0.65, max: 1.2 }, mid: { min: 1.2, max: 2.3 },
    senior: { min: 2, max: 3.8 }, lead: { min: 2.6, max: 4.8 }, manager: { min: 3, max: 6 }, executive: { min: 5, max: 12 }
  },
  consulting: {
    internship: { min: 0.2, max: 0.7 }, entry: { min: 0.75, max: 1.5 }, mid: { min: 1.3, max: 2.8 },
    senior: { min: 2.2, max: 4.5 }, lead: { min: 2.8, max: 5.5 }, manager: { min: 3.5, max: 7 }, executive: { min: 5.5, max: 12 }
  },
  education: {
    internship: { min: 0.15, max: 0.5 }, entry: { min: 0.45, max: 0.9 }, mid: { min: 0.75, max: 1.5 },
    senior: { min: 1.2, max: 2.4 }, lead: { min: 1.6, max: 3 }, manager: { min: 2, max: 4 }, executive: { min: 3, max: 7 }
  },
  sales_operations: {
    internship: { min: 0.15, max: 0.55 }, entry: { min: 0.5, max: 1 }, mid: { min: 0.85, max: 1.8 },
    senior: { min: 1.4, max: 2.8 }, lead: { min: 1.8, max: 3.5 }, manager: { min: 2.2, max: 4.5 }, executive: { min: 3.5, max: 8 }
  },
  general: {
    internship: { min: 0.15, max: 0.5 }, entry: { min: 0.45, max: 0.9 }, mid: { min: 0.75, max: 1.5 },
    senior: { min: 1.2, max: 2.3 }, lead: { min: 1.5, max: 3 }, manager: { min: 1.8, max: 3.8 }, executive: { min: 3, max: 7 }
  }
};

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roleText(career: CareerState, narrativeText = ""): string {
  return [career.occupation, career.careerStage, career.industry, career.organization, narrativeText]
    .filter(Boolean).join(" ").toLowerCase();
}

export function normalizeOccupationFamily(text: string): CareerOccupationFamily {
  const normalized = text.toLowerCase();
  if (/前端|后端|全栈|软件|程序|开发|研发|计算机|web|engineer|engineering|developer|算法|测试工程/u.test(normalized)) return "software_engineering";
  if (/设计|交互|视觉|体验|ui|ux|designer/u.test(normalized)) return "design";
  if (/产品|product/u.test(normalized)) return "product";
  if (/顾问|咨询|consult/u.test(normalized)) return "consulting";
  if (/教师|老师|讲师|教育|培训|教研/u.test(normalized)) return "education";
  if (/销售|运营|市场|商务|客户成功|sales|operation|marketing/u.test(normalized)) return "sales_operations";
  if (/经理|管理|主管|总监|负责人|创始人|高管|manager|director|founder|chief/u.test(normalized)) return "management";
  return "general";
}

export function normalizeCareerStage(text: string, employmentType?: CareerEmploymentType): CareerCompensationStage {
  if (employmentType === "internship" || /实习|intern/u.test(text)) return "internship";
  if (/首席|高管|总经理|副总裁|合伙人|chief|c-level|vp\b/u.test(text)) return "executive";
  if (/经理|总监|负责人|主管|manager|director|head\b/u.test(text)) return "manager";
  if (/技术负责人|组长|主程|lead|staff|principal/u.test(text)) return "lead";
  if (/高级|资深|senior/u.test(text)) return "senior";
  if (/应届|校招|初级|助理|新人|毕业生|junior|entry/u.test(text)) return "entry";
  return "mid";
}

export function normalizeEmploymentType(career: CareerState, text: string): CareerEmploymentType {
  const roleDefinition = [career.occupation, career.careerStage].filter(Boolean).join(" ").toLowerCase();
  if (/实习|intern/u.test(roleDefinition)) return "internship";
  if (career.employmentStatus === "part_time" || /兼职|part[- ]?time/u.test(text)) return "part_time";
  if (career.employmentStatus === "self_employed") return "self_employed";
  if (career.employmentStatus === "employed") return "full_time";
  if (/实习|intern/u.test(text)) return "internship";
  return "full_time";
}

function normalizeIndustryTier(text: string): CareerCompensationPolicyInputs["industryTier"] {
  if (/互联网|科技|软件|人工智能|ai\b|金融科技|游戏/u.test(text)) return "technology";
  if (/咨询|律所|会计|审计|professional service/u.test(text)) return "professional_services";
  if (/教育|学校|大学|培训/u.test(text)) return "education";
  return "general";
}

function normalizeOrganizationTier(text: string): CareerCompensationPolicyInputs["organizationTier"] {
  if (/头部|顶级|一线大厂|行业龙头|top\b|fortune\s*500/u.test(text)) return "top";
  if (/大型|大厂|集团|上市|知名/u.test(text)) return "large";
  if (/初创|小型|工作室|创业团队|startup/u.test(text)) return "small";
  return "unknown";
}

function normalizeRegionTier(text: string): CareerCompensationPolicyInputs["regionTier"] {
  if (/北京|上海|深圳|广州|杭州|一线城市/u.test(text)) return "tier_1";
  if (/成都|武汉|南京|苏州|西安|重庆|长沙|郑州|青岛|厦门|二线|三线/u.test(text)) return "other";
  return "unknown";
}

export function resolveCareerCompensationEstimate(input: {
  careerState: CareerState;
  narrativeText?: string;
  effectiveAtAgeInMonths: number;
  calendarYear?: number;
}): CareerCompensationEstimate {
  const text = roleText(input.careerState, input.narrativeText);
  const roleDefinition = [input.careerState.occupation, input.careerState.careerStage].filter(Boolean).join(" ").toLowerCase();
  const employmentType = normalizeEmploymentType(input.careerState, text);
  const roleFamily = normalizeOccupationFamily(roleDefinition);
  const occupationFamily = roleFamily === "general" ? normalizeOccupationFamily(text) : roleFamily;
  const careerStage = normalizeCareerStage(roleDefinition || text, employmentType);
  const industryTier = normalizeIndustryTier(text);
  const organizationTier = normalizeOrganizationTier(text);
  const regionTier = normalizeRegionTier(text);
  const inputs: CareerCompensationPolicyInputs = {
    occupationFamily, careerStage, employmentType, industryTier, organizationTier, regionTier,
    calendarYear: input.calendarYear ?? CAREER_COMPENSATION_REFERENCE_YEAR
  };
  const base = BASE_BANDS[occupationFamily][careerStage];
  const organizationMultiplier = organizationTier === "top" ? 1.25 : organizationTier === "large" ? 1.1 : organizationTier === "small" ? 0.9 : 1;
  const regionMultiplier = regionTier === "tier_1" ? 1.15 : regionTier === "other" ? 0.9 : 1;
  const industryMultiplier = industryTier === "technology" ? 1.1 : industryTier === "professional_services" ? 1.05 : industryTier === "education" ? 0.9 : 1;
  const employmentMultiplier = employmentType === "part_time" ? 0.55 : employmentType === "self_employed" ? 0.75 : 1;
  const uncertaintyLow = organizationTier === "unknown" || regionTier === "unknown" ? 0.85 : 1;
  const uncertaintyHigh = organizationTier === "unknown" || regionTier === "unknown" ? 1.15 : 1;
  const min = round(base.min * organizationMultiplier * regionMultiplier * industryMultiplier * employmentMultiplier * uncertaintyLow);
  const max = round(base.max * organizationMultiplier * regionMultiplier * industryMultiplier * employmentMultiplier * uncertaintyHigh);
  const confidence = round(Math.max(0.6, 0.92
    - (organizationTier === "unknown" ? 0.1 : 0)
    - (regionTier === "unknown" ? 0.1 : 0)
    - (occupationFamily === "general" ? 0.08 : 0)));
  return {
    resolution: "estimated",
    policyId: CAREER_COMPENSATION_POLICY_ID,
    policyVersion: CAREER_COMPENSATION_POLICY_VERSION,
    monthlyNetRangeWan: [min, max],
    monthlyNetAmountWan: round((min + max) / 2),
    inputs,
    confidence,
    effectiveAtAgeInMonths: input.effectiveAtAgeInMonths,
    reviewAtAgeInMonths: input.effectiveAtAgeInMonths + REVIEW_INTERVAL_MONTHS,
    evidence: input.narrativeText?.trim() || input.careerState.occupation || input.careerState.employmentStatus
  };
}

export function isMaterialCompensationOutlier(monthlyNetAmountWan: number, estimate: CareerCompensationEstimate): boolean {
  const [min, max] = estimate.monthlyNetRangeWan;
  return monthlyNetAmountWan < min * 0.5 || monthlyNetAmountWan > max * 2;
}

function proposalIncomeSource(proposal: FinancialEventProposal): Partial<IncomeSource> | undefined {
  if (proposal.kind === "income_source_started") return proposal.payload as Partial<IncomeSource>;
  if (proposal.kind === "income_source_adjusted") return (proposal.payload as { nextSource?: Partial<IncomeSource> }).nextSource;
  return undefined;
}

export function completeCareerCompensationProposals(input: {
  proposals: FinancialEventProposal[];
  currentLedger: FinancialLedger;
  transition?: AcceptedCareerTransition;
  acceptedOutcomeId?: string;
  narrativeText: string;
  calendarYear?: number;
  explicitUnpaid?: boolean;
  /** Exact accepted user-authored decision text; user compensation always wins. */
  userEvidenceText?: string;
}): FinancialEventProposal[] {
  const transition = input.transition;
  if (!transition || !input.acceptedOutcomeId || input.explicitUnpaid) return input.proposals;
  // A role definition can estimate an employee wage, but company traction or
  // founder status alone never authorizes a personal owner draw. Self-employed
  // compensation still requires an explicit accepted personal receipt.
  if (!["employed", "part_time"].includes(transition.nextCareerState.employmentStatus)) return input.proposals;
  const resolvedProposal = input.proposals.find((proposal) => {
    const source = proposalIncomeSource(proposal);
    return source?.status === "active" && source.linkedCareerStateId === transition.nextCareerState.id
      && ["salary", "contract"].includes(String(source.type));
  });
  const estimate = resolveCareerCompensationEstimate({
    careerState: transition.nextCareerState,
    narrativeText: input.narrativeText,
    effectiveAtAgeInMonths: transition.effectiveAtAgeInMonths,
    calendarYear: input.calendarYear
  });
  let proposals = input.proposals;
  if (resolvedProposal) {
    const source = proposalIncomeSource(resolvedProposal)!;
    const amount = source.accrualPolicy === "annual"
      ? Number(source.annualNetAmountWan || 0) / 12
      : Number(source.monthlyNetAmountWan || 0);
    const userGrounded = Boolean(input.userEvidenceText?.trim())
      && input.userEvidenceText!.includes(resolvedProposal.evidence.trim());
    const exceptionalReasonGrounded = /挖角|竞业|海外|外派|稀缺|特殊津贴|签字费|奖金|股权|晋升|薪资谈判|竞聘/u.test(resolvedProposal.evidence);
    if (!isMaterialCompensationOutlier(amount, estimate) || userGrounded || exceptionalReasonGrounded) {
      return input.proposals;
    }
    proposals = input.proposals.filter((proposal) => proposal !== resolvedProposal);
  }
  const source: IncomeSource = {
    id: `career_income_${transition.nextCareerState.id}`,
    type: "salary",
    displayName: `${transition.nextCareerState.occupation || "当前职位"}估算税后收入`,
    monthlyNetAmountWan: estimate.monthlyNetAmountWan,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: transition.effectiveAtAgeInMonths,
    status: "active",
    linkedCareerStateId: transition.nextCareerState.id,
    factStatus: "estimated",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: transition.effectiveAtAgeInMonths,
    compensationEstimate: estimate,
    evidence: []
  };
  const evidence = transition.evidence.find((item) => item.excerpt)?.excerpt || input.narrativeText.trim();
  return [...proposals, {
    id: `policy_compensation_${transition.proposalId}`,
    kind: "income_source_started",
    effectiveAtAgeInMonths: transition.effectiveAtAgeInMonths,
    payload: source,
    sourceOutcomeId: input.acceptedOutcomeId,
    financialScope: "personal",
    evidence,
    confidence: estimate.confidence
  }];
}

export function completeDueCareerCompensationReviewProposals(input: {
  proposals: FinancialEventProposal[];
  currentLedger: FinancialLedger;
  currentCareerState: CareerState;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  acceptedOutcomeId?: string;
  narrativeText: string;
  calendarYear?: number;
}): FinancialEventProposal[] {
  if (!input.acceptedOutcomeId || !input.narrativeText.trim()) return input.proposals;
  const touchedIds = new Set(input.proposals.flatMap((proposal) => {
    if (proposal.kind === "income_source_adjusted" || proposal.kind === "income_source_ended" || proposal.kind === "income_source_paused") {
      const id = (proposal.payload as { incomeSourceId?: unknown }).incomeSourceId;
      return typeof id === "string" ? [id] : [];
    }
    return [];
  }));
  const additions: FinancialEventProposal[] = [];
  for (const source of input.currentLedger.incomeSources) {
    if (source.status !== "active" || source.linkedCareerStateId !== input.currentCareerState.id
      || !source.compensationEstimate || touchedIds.has(source.id)) continue;
    let reviewMonth = source.compensationEstimate.reviewAtAgeInMonths;
    while (reviewMonth <= input.periodEndAgeInMonths) {
      const effectiveMonth = Math.max(reviewMonth, input.periodStartAgeInMonths);
      const estimate = resolveCareerCompensationEstimate({
        careerState: input.currentCareerState,
        narrativeText: input.narrativeText,
        effectiveAtAgeInMonths: effectiveMonth,
        calendarYear: (input.calendarYear ?? source.compensationEstimate.inputs.calendarYear)
          + Math.floor((effectiveMonth - source.compensationEstimate.effectiveAtAgeInMonths) / 12)
      });
      const nextSource: IncomeSource = {
        ...structuredClone(source),
        monthlyNetAmountWan: estimate.monthlyNetAmountWan,
        factStatus: "estimated",
        accrualReviewStatus: "normal",
        lastConfirmedAtAgeInMonths: effectiveMonth,
        compensationEstimate: estimate
      };
      additions.push({
        id: `policy_compensation_review_${source.id}_${effectiveMonth}`,
        kind: "income_source_adjusted",
        effectiveAtAgeInMonths: effectiveMonth,
        payload: { incomeSourceId: source.id, nextSource },
        sourceOutcomeId: input.acceptedOutcomeId,
        financialScope: "personal",
        evidence: input.narrativeText.trim(),
        confidence: estimate.confidence
      });
      reviewMonth += REVIEW_INTERVAL_MONTHS;
    }
  }
  return [...input.proposals, ...additions];
}

export function parseBoundedEngagementMonths(text: string): number | undefined {
  const arabic = text.match(/(?:为期|持续|做了|进行|实习期)(?:约)?\s*(\d{1,2})\s*个?月/u);
  if (arabic) return Number(arabic[1]);
  const chinese: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const localized = text.match(/(?:为期|持续|做了|进行|实习期)(?:约)?\s*([一二两三四五六])\s*个?月/u);
  return localized ? chinese[localized[1]] : undefined;
}

export function reclassifyBoundedStudentEngagement(input: {
  currentCareerState: CareerState;
  transitions: AcceptedCareerTransition[];
  narrativeText: string;
  acceptedOutcomeId?: string;
  calendarYear?: number;
}): { transitions: AcceptedCareerTransition[]; proposals: FinancialEventProposal[]; reclassified: boolean } {
  if (input.currentCareerState.employmentStatus !== "student" || !input.acceptedOutcomeId) {
    return { transitions: input.transitions, proposals: [], reclassified: false };
  }
  const engagement = input.transitions.find((transition) => {
    const text = `${transition.evidence.map((item) => item.excerpt || "").join(" ")} ${input.narrativeText}`;
    return /实习|intern/u.test(text) && Boolean(parseBoundedEngagementMonths(text));
  });
  if (!engagement) return { transitions: input.transitions, proposals: [], reclassified: false };
  const evidence = engagement.evidence.find((item) => item.excerpt)?.excerpt || input.narrativeText.trim();
  const durationMonths = parseBoundedEngagementMonths(`${evidence} ${input.narrativeText}`)!;
  const internshipCareer: CareerState = {
    ...engagement.nextCareerState,
    id: input.currentCareerState.id,
    employmentStatus: "part_time",
    careerStage: "internship"
  };
  const estimate = resolveCareerCompensationEstimate({
    careerState: internshipCareer,
    narrativeText: input.narrativeText,
    effectiveAtAgeInMonths: engagement.effectiveAtAgeInMonths,
    calendarYear: input.calendarYear
  });
  const explicit = input.narrativeText.match(/(?:税后)?(?:月薪|月工资|每月(?:能)?(?:拿到|赚到|收入))[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万|元)/u);
  const monthlyNetAmountWan = explicit ? Number(explicit[1]) * (explicit[2] === "元" ? 0.0001 : 1) : estimate.monthlyNetAmountWan;
  const source: IncomeSource = {
    id: `student_engagement_${engagement.proposalId}`,
    type: "contract",
    displayName: `${engagement.nextCareerState.occupation || "实习"}收入`,
    monthlyNetAmountWan: round(monthlyNetAmountWan),
    accrualPolicy: "monthly",
    activeFromAgeInMonths: engagement.effectiveAtAgeInMonths,
    activeUntilAgeInMonths: engagement.effectiveAtAgeInMonths + durationMonths,
    status: "active",
    linkedCareerStateId: input.currentCareerState.id,
    factStatus: explicit ? "known" : "estimated",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: engagement.effectiveAtAgeInMonths,
    ...(explicit ? {} : { compensationEstimate: estimate }),
    evidence: []
  };
  return {
    transitions: input.transitions.filter((transition) => transition !== engagement),
    proposals: [{
      id: `bounded_student_engagement_${engagement.proposalId}`,
      kind: "income_source_started",
      effectiveAtAgeInMonths: engagement.effectiveAtAgeInMonths,
      payload: source,
      sourceOutcomeId: input.acceptedOutcomeId,
      financialScope: "personal",
      evidence,
      confidence: explicit ? 1 : estimate.confidence
    }],
    reclassified: true
  };
}
