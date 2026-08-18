import { parseBoundedEngagementMonths, resolveCareerCompensationEstimate } from "./careerCompensationPolicy";
import type { CareerState } from "../career/types";

type JsonRecord = Record<string, any>;

export interface CareerCompensationShadowMetrics {
  nodeCount: number;
  paidCareerZeroIncomeNodeCount: number;
  crossCareerIncomeReuseNodeCount: number;
  boundedIncomeOverrunCount: number;
  systemAutoShortfallDebtWan: number;
  unsupportedDebtAccountCount: number;
  policyEstimateSourceCount: number;
  paidRoleWithoutCompensationCount: number;
}

export interface EducationShadowProjection {
  baselineNetWorthWan: number;
  projectedNetWorthRangeWan?: [number, number];
  projectedNetWorthMedianWan?: number;
  removedInternshipOverrunIncomeWan: number;
  restoredStudentSupportWan: number;
  estimatedFullTimeIncomeRangeWan?: [number, number];
  fullTimeEffectiveAtAgeInMonths?: number;
  policyId?: string;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function currentCareer(node: JsonRecord): JsonRecord | undefined {
  const world = node.worldStateSnapshot;
  return world?.careerStates?.find((state: JsonRecord) => state.id === world.currentCareerStateId);
}

function careerIncomeSources(node: JsonRecord): JsonRecord[] {
  return (node.financialLedger?.incomeSources || []).filter((source: JsonRecord) => (
    ["salary", "contract", "self_employment_draw"].includes(source.type)
  ));
}

function sourceCovers(source: JsonRecord, ageInMonths: number): boolean {
  return source.status !== "ended"
    && source.activeFromAgeInMonths <= ageInMonths
    && (source.activeUntilAgeInMonths === undefined || source.activeUntilAgeInMonths > ageInMonths)
    && source.accrualReviewStatus !== "quarantined";
}

export function auditCareerCompensationHistory(nodes: JsonRecord[]): CareerCompensationShadowMetrics {
  const finalLedger = nodes.at(-1)?.financialLedger || {};
  let paidCareerZeroIncomeNodeCount = 0;
  let crossCareerIncomeReuseNodeCount = 0;
  let paidRoleWithoutCompensationCount = 0;
  for (const node of nodes) {
    const career = currentCareer(node);
    if (!career || !["employed", "part_time", "self_employed"].includes(career.employmentStatus)) continue;
    const sources = careerIncomeSources(node).filter((source) => sourceCovers(source, node.ageInMonths));
    if (Number(node.financialState?.annualAfterTaxIncomeWan || 0) === 0) paidCareerZeroIncomeNodeCount += 1;
    if (sources.length === 0) paidRoleWithoutCompensationCount += 1;
    if (sources.some((source) => source.linkedCareerStateId && source.linkedCareerStateId !== career.id)) {
      crossCareerIncomeReuseNodeCount += 1;
    }
  }
  const boundedIncomeOverrunCount = (finalLedger.incomeSources || []).filter((source: JsonRecord) => {
    const text = (source.evidence || []).map((item: JsonRecord) => item.excerpt || "").join(" ");
    const duration = parseBoundedEngagementMonths(text);
    return duration !== undefined
      && source.activeUntilAgeInMonths !== undefined
      && source.activeUntilAgeInMonths - source.activeFromAgeInMonths > duration;
  }).length;
  const autoDebts = (finalLedger.debtAccounts || []).filter((debt: JsonRecord) => debt.origin === "system_auto_shortfall");
  return {
    nodeCount: nodes.length,
    paidCareerZeroIncomeNodeCount,
    crossCareerIncomeReuseNodeCount,
    boundedIncomeOverrunCount,
    systemAutoShortfallDebtWan: round(autoDebts.reduce((sum: number, debt: JsonRecord) => sum + Number(debt.principalWan || 0), 0)),
    unsupportedDebtAccountCount: autoDebts.length,
    policyEstimateSourceCount: (finalLedger.incomeSources || []).filter((source: JsonRecord) => source.compensationEstimate?.policyId === "career_compensation_cn_v1").length,
    paidRoleWithoutCompensationCount
  };
}

export function projectEducationHistoryWithCareerCompensation(nodes: JsonRecord[]): EducationShadowProjection {
  const finalNode = nodes.at(-1) || {};
  const finalLedger = finalNode.financialLedger || {};
  const baselineNetWorthWan = Number(finalNode.financialState?.netWorthWan || 0);
  const internship = (finalLedger.incomeSources || []).find((source: JsonRecord) => {
    const text = (source.evidence || []).map((item: JsonRecord) => item.excerpt || "").join(" ");
    return /实习|intern/u.test(text) && parseBoundedEngagementMonths(text) !== undefined;
  });
  let removedInternshipOverrunIncomeWan = 0;
  if (internship) {
    const text = (internship.evidence || []).map((item: JsonRecord) => item.excerpt || "").join(" ");
    const duration = parseBoundedEngagementMonths(text)!;
    const recordedMonths = Math.max(0, Number(internship.activeUntilAgeInMonths ?? finalNode.ageInMonths) - Number(internship.activeFromAgeInMonths));
    removedInternshipOverrunIncomeWan = round(Math.max(0, recordedMonths - duration) * Number(internship.monthlyNetAmountWan || 0));
  }
  const fullTimeNode = nodes.find((node) => (
    /(?:正式)?入职[^。！？]{0,32}(?:头部互联网|大型科技|大厂)[^。！？]{0,32}(?:前端|web\s*engineer)/iu.test(node.description || "")
  ));
  if (!fullTimeNode) {
    return { baselineNetWorthWan, removedInternshipOverrunIncomeWan, restoredStudentSupportWan: 0 };
  }
  const effectiveAtAgeInMonths = Number(fullTimeNode.ageInMonths);
  const support = (finalLedger.incomeSources || []).find((source: JsonRecord) => source.type === "family_support");
  const restoredStudentSupportWan = support
    ? round(Math.max(0, effectiveAtAgeInMonths - Number(support.activeUntilAgeInMonths ?? effectiveAtAgeInMonths)) * Number(support.monthlyNetAmountWan || 0))
    : 0;
  const estimatedCareer: CareerState = {
    id: "shadow_head_internet_frontend",
    employmentStatus: "employed",
    occupation: "应届前端工程师",
    industry: "互联网",
    organization: "头部互联网公司",
    careerStage: "entry",
    activeProjectIds: [],
    effectiveFromAgeInMonths: effectiveAtAgeInMonths,
    source: "accepted_history",
    confidence: 0.9
  };
  const estimate = resolveCareerCompensationEstimate({
    careerState: estimatedCareer,
    narrativeText: fullTimeNode.description,
    effectiveAtAgeInMonths,
    calendarYear: 2026
  });
  const months = Math.max(0, Number(finalNode.ageInMonths) - effectiveAtAgeInMonths);
  const estimatedFullTimeIncomeRangeWan: [number, number] = [
    round(estimate.monthlyNetRangeWan[0] * months),
    round(estimate.monthlyNetRangeWan[1] * months)
  ];
  const correctionBase = baselineNetWorthWan - removedInternshipOverrunIncomeWan + restoredStudentSupportWan;
  return {
    baselineNetWorthWan,
    projectedNetWorthRangeWan: [
      round(correctionBase + estimatedFullTimeIncomeRangeWan[0]),
      round(correctionBase + estimatedFullTimeIncomeRangeWan[1])
    ],
    projectedNetWorthMedianWan: round(correctionBase + estimate.monthlyNetAmountWan * months),
    removedInternshipOverrunIncomeWan,
    restoredStudentSupportWan,
    estimatedFullTimeIncomeRangeWan,
    fullTimeEffectiveAtAgeInMonths: effectiveAtAgeInMonths,
    policyId: estimate.policyId
  };
}
