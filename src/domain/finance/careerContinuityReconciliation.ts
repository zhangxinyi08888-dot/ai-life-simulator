import type { HistoryItem } from "../../types";
import type { AcceptedCareerTransition, CareerState } from "../career/types";
import {
  CAREER_COMPENSATION_ANNUAL_GROWTH_RATE,
  CAREER_COMPENSATION_MAX_CUMULATIVE_GROWTH_RATE,
  resolveCareerCompensationEstimate
} from "./careerCompensationPolicy";
import { PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type {
  AcceptedFinancialEvent,
  FinancialEventProposal,
  FinancialLedger,
  IncomeSource
} from "./types";

const CONTINUING_EMPLOYMENT_PATTERN = /(?:你|本人|主角)[^。！？]{0,24}(?:(?:继续|一直|仍(?:然)?|长期)[^。！？]{0,24})?(?:在|于)[^。！？]{1,24}(?:公司|企业|机构|团队|工作室|规划院)[^。！？]{0,28}(?:工作|任职|做|担任|负责|写代码|开发)/u;
const NON_AUTHORITATIVE_PATTERN = /(?:如果|若|计划|准备|考虑|希望|可能|面试|求职|尚未|还没|未能|没有入职|拒绝|婉拒)/u;

export interface CareerContinuityEvidence {
  excerpt: string;
  effectiveFromAgeInMonths: number;
  occupation?: string;
  industry?: string;
  organization?: string;
  explicitMonthlySalaryWan?: number;
}

export interface CareerContinuityReconciliation {
  evidence: CareerContinuityEvidence;
  transition: AcceptedCareerTransition;
  salaryProposal: FinancialEventProposal;
}

function employmentSentence(text: string): string | undefined {
  return text.split(/(?<=[。！？；])/u).map((sentence) => sentence.trim()).find((sentence) => (
    CONTINUING_EMPLOYMENT_PATTERN.test(sentence)
    && !NON_AUTHORITATIVE_PATTERN.test(sentence)
    && !/(?:实习|志愿者|无薪)/u.test(sentence)
  ));
}

function extractRole(sentence: string): Pick<CareerContinuityEvidence, "occupation" | "industry" | "organization"> {
  const organization = sentence.match(/(?:在|于)([^，。；]{1,20}(?:公司|企业|机构|团队|工作室|规划院))/u)?.[1]?.trim();
  const occupation = sentence.match(/(?:做|担任|任职|负责)([^，。；]{1,18}?)(?=，|。|；|、|并|和|$)/u)?.[1]?.trim()
    || (/写代码|软件开发|程序开发/u.test(sentence) ? "软件开发工程师" : undefined);
  const industry = /互联网|软件|科技|程序|开发/u.test(`${organization || ""}${sentence}`) ? "互联网" : undefined;
  return { organization, occupation, industry };
}

function explicitMonthlySalaryWan(text: string): number | undefined {
  const monthlyWan = text.match(/(?:税后)?月薪(?:约为|约|达到|为|稳定在)?\s*(\d+(?:\.\d+)?)\s*万/u)?.[1];
  if (monthlyWan) return Number(monthlyWan);
  const monthlyYuan = text.match(/(?:税后)?月薪(?:约为|约|达到|为|稳定在)?\s*(\d+(?:\.\d+)?)\s*元/u)?.[1];
  if (monthlyYuan) return roundWan(Number(monthlyYuan) / 10_000);
  const annualWan = text.match(/(?:税后)?年薪(?:约为|约|达到|为|稳定在)?\s*(\d+(?:\.\d+)?)\s*万/u)?.[1];
  return annualWan ? roundWan(Number(annualWan) / 12) : undefined;
}

export function findEarliestCareerContinuityEvidence(input: {
  history: HistoryItem[];
  narrativeText: string;
  periodStartAgeInMonths: number;
}): CareerContinuityEvidence | undefined {
  const observations = input.history.flatMap((item, index) => {
    const excerpt = employmentSentence(item.description);
    if (!excerpt) return [];
    const previous = input.history[index - 1];
    const effectiveFromAgeInMonths = previous?.ageInMonths
      ?? (previous ? previous.age * 12 : item.ageInMonths ?? item.age * 12);
    return [{
      excerpt,
      effectiveFromAgeInMonths,
      ...extractRole(excerpt),
      explicitMonthlySalaryWan: explicitMonthlySalaryWan(item.description)
    }];
  });
  const currentExcerpt = employmentSentence(input.narrativeText);
  if (currentExcerpt) {
    observations.push({
      excerpt: currentExcerpt,
      effectiveFromAgeInMonths: input.periodStartAgeInMonths,
      ...extractRole(currentExcerpt),
      explicitMonthlySalaryWan: explicitMonthlySalaryWan(input.narrativeText)
    });
  }
  return observations.sort((left, right) => left.effectiveFromAgeInMonths - right.effectiveFromAgeInMonths)[0];
}

export function buildCareerContinuityReconciliation(input: {
  history: HistoryItem[];
  narrativeText: string;
  currentCareerState: CareerState;
  periodStartAgeInMonths: number;
  acceptedOutcomeId?: string;
  transactionId: string;
}): CareerContinuityReconciliation | undefined {
  if (!input.acceptedOutcomeId
    || ["employed", "part_time", "self_employed"].includes(input.currentCareerState.employmentStatus)) return undefined;
  const currentExcerpt = employmentSentence(input.narrativeText);
  if (!currentExcerpt) return undefined;
  const evidence = findEarliestCareerContinuityEvidence(input);
  if (!evidence) return undefined;
  const nextCareerState: CareerState = {
    id: `career_continuity_${input.transactionId}`,
    employmentStatus: /兼职|非全职/u.test(evidence.excerpt) ? "part_time" : "employed",
    occupation: evidence.occupation || "技术岗位",
    industry: evidence.industry,
    organization: evidence.organization,
    activeProjectIds: [...input.currentCareerState.activeProjectIds],
    effectiveFromAgeInMonths: evidence.effectiveFromAgeInMonths,
    source: "accepted_history",
    confidence: 0.78
  };
  const completedYears = Math.max(0, Math.floor(
    (input.periodStartAgeInMonths - evidence.effectiveFromAgeInMonths) / 12
  ));
  const cumulativeGrowthRate = Math.min(
    CAREER_COMPENSATION_MAX_CUMULATIVE_GROWTH_RATE,
    completedYears * CAREER_COMPENSATION_ANNUAL_GROWTH_RATE
  );
  const currentPolicyEstimate = resolveCareerCompensationEstimate({
      careerState: nextCareerState,
      narrativeText: input.narrativeText,
      effectiveAtAgeInMonths: input.periodStartAgeInMonths
    });
  const baselineMonthlyNetAmountWan = currentPolicyEstimate.monthlyNetAmountWan;
  const currentEstimate = {
    ...currentPolicyEstimate,
    monthlyNetAmountWan: roundWan(baselineMonthlyNetAmountWan * (1 + cumulativeGrowthRate)),
    baselineMonthlyNetAmountWan,
    cumulativeGrowthRate
  };
  const explicitSalaryWan = evidence.explicitMonthlySalaryWan
    ?? explicitMonthlySalaryWan(input.narrativeText);
  const transition: AcceptedCareerTransition = {
    id: `accepted_career_continuity_${input.transactionId}`,
    proposalId: `career_continuity_${input.transactionId}`,
    fromCareerStateId: input.currentCareerState.id,
    nextCareerState,
    effectiveAtAgeInMonths: input.periodStartAgeInMonths,
    evidence: [{
      source: "accepted_history",
      sourceEventId: input.acceptedOutcomeId,
      excerpt: evidence.excerpt,
      reasonCode: "CAREER_CONTINUITY_RECONCILIATION",
      confidence: 0.78
    }],
    acceptedByReasonCodes: ["OUTCOME_AUTHORITY", "CAREER_CONTINUITY_RECONCILIATION"]
  };
  const source: IncomeSource = {
    id: `career_income_${nextCareerState.id}`,
    type: "salary",
    displayName: explicitSalaryWan
      ? `${nextCareerState.occupation || "当前职位"}税后工资`
      : `${nextCareerState.occupation || "当前职位"}估算税后工资`,
    monthlyNetAmountWan: explicitSalaryWan ?? currentEstimate.monthlyNetAmountWan,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: evidence.effectiveFromAgeInMonths,
    status: "active",
    linkedCareerStateId: nextCareerState.id,
    factStatus: explicitSalaryWan ? "known" : "estimated",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: input.periodStartAgeInMonths,
    employmentConfirmedAtAgeInMonths: input.periodStartAgeInMonths,
    compensationEstimate: explicitSalaryWan ? undefined : currentEstimate,
    evidence: [{
      source: "accepted_history",
      sourceEventId: input.acceptedOutcomeId,
      excerpt: evidence.excerpt,
      reasonCode: "CAREER_CONTINUITY_RECONCILIATION",
      confidence: 0.78,
      financialScope: "personal"
    }]
  };
  return {
    evidence,
    transition,
    salaryProposal: {
      id: `policy_career_continuity_salary_${input.transactionId}`,
      kind: "income_source_started",
      effectiveAtAgeInMonths: input.periodStartAgeInMonths,
      payload: source,
      sourceOutcomeId: input.acceptedOutcomeId,
      financialScope: "personal",
      systemGenerated: "career_continuity_reconciliation",
      evidence: currentExcerpt,
      confidence: explicitSalaryWan ? 1 : currentEstimate.confidence
    }
  };
}

export function buildCareerContinuityCatchUpEvent(input: {
  reconciliation: CareerContinuityReconciliation;
  ledger: FinancialLedger;
  salarySource: IncomeSource;
  periodStartAgeInMonths: number;
  transactionId: string;
}): AcceptedFinancialEvent | undefined {
  const from = input.reconciliation.evidence.effectiveFromAgeInMonths;
  if (from >= input.periodStartAgeInMonths) return undefined;
  const baseline = input.salarySource.compensationEstimate?.baselineMonthlyNetAmountWan
    ?? input.salarySource.monthlyNetAmountWan
    ?? 0;
  let grossSalaryWan = 0;
  let duplicatedStudentSupportWan = 0;
  for (let month = from; month < input.periodStartAgeInMonths; month += 1) {
    const completedYears = Math.floor((month - from) / 12);
    const growth = input.salarySource.factStatus === "known" ? 0 : Math.min(
      CAREER_COMPENSATION_MAX_CUMULATIVE_GROWTH_RATE,
      completedYears * CAREER_COMPENSATION_ANNUAL_GROWTH_RATE
    );
    grossSalaryWan += baseline * (1 + growth);
    duplicatedStudentSupportWan += input.ledger.incomeSources
      .filter((source) => source.type === "family_support"
        && source.evidence.some((item) => item.reasonCode === "STUDENT_BASIC_LIVING_FAMILY_COVERED")
        && source.activeFromAgeInMonths <= month
        && (source.activeUntilAgeInMonths === undefined || source.activeUntilAgeInMonths > month))
      .reduce((sum, source) => sum + Number(source.monthlyNetAmountWan || 0), 0);
  }
  const amountWan = roundWan(Math.max(0, grossSalaryWan - duplicatedStudentSupportWan));
  if (amountWan <= 0) return undefined;
  return {
    id: `accepted_career_continuity_catch_up_${input.transactionId}`,
    proposalId: `career_continuity_catch_up_${input.transactionId}`,
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: input.periodStartAgeInMonths,
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan },
    evidence: [{
      source: "system_policy",
      sourceNodeId: input.transactionId,
      excerpt: input.reconciliation.evidence.excerpt,
      reasonCode: "CAREER_CONTINUITY_NET_CATCH_UP",
      confidence: 0.72,
      financialScope: "personal"
    }],
    acceptedByReasonCodes: ["CAREER_CONTINUITY_RECONCILIATION", "NET_OF_DUPLICATED_STUDENT_SUPPORT"]
  };
}
