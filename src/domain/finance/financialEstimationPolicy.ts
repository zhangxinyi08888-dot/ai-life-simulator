import type { EmploymentStatus } from "../../types";
import { roundWan } from "./ledgerMath";
import type { ExpenseCommitment } from "./types";

export interface FinancialEstimationContext {
  ageInMonths: number;
  employmentStatus?: EmploymentStatus;
  livingArrangement?: "with_family" | "renting" | "owner_occupied" | "unknown";
}

export interface EstimatedMoney {
  valueWan: number;
  plausibleRangeWan: [number, number];
  policyId: string;
  reasonCode: string;
}

export interface FinancialEstimationPolicy {
  id: string;
  version: number;
  estimateBasicLivingCommitment(context: FinancialEstimationContext): EstimatedMoney;
  estimateMortgagedPropertyValue(mortgagePrincipalWan: number): EstimatedMoney;
}

export const DEFAULT_FINANCIAL_ESTIMATION_POLICY: FinancialEstimationPolicy = {
  id: "cn_conservative_basic_living",
  version: 1,
  estimateBasicLivingCommitment(context) {
    const youngAdult = context.ageInMonths < 23 * 12;
    const livesWithFamily = context.livingArrangement === "with_family";
    const monthlyWan = youngAdult || context.employmentStatus === "student"
      ? (livesWithFamily ? 0.15 : 0.2)
      : 0.35;
    return {
      valueWan: monthlyWan,
      plausibleRangeWan: youngAdult ? [0.12, 0.35] : [0.25, 0.6],
      policyId: "cn_conservative_basic_living@1",
      reasonCode: "ADULT_BASIC_LIVING_ESTIMATED_V1"
    };
  },
  estimateMortgagedPropertyValue(mortgagePrincipalWan) {
    const principal = roundWan(Math.max(0, mortgagePrincipalWan));
    return {
      valueWan: principal,
      plausibleRangeWan: [roundWan(principal * 0.8), roundWan(principal * 1.5)],
      policyId: "cn_conservative_mortgaged_property@1",
      reasonCode: "MORTGAGED_PROPERTY_VALUE_ESTIMATED_V1"
    };
  }
};

export function estimatedBasicLivingCommitment(input: FinancialEstimationContext): ExpenseCommitment | undefined {
  if (input.ageInMonths < 18 * 12) return undefined;
  const estimate = DEFAULT_FINANCIAL_ESTIMATION_POLICY.estimateBasicLivingCommitment(input);
  return {
    id: `estimated_basic_living_v1_${input.ageInMonths}`,
    type: "basic_living",
    displayName: "基础生活支出（系统保守估计）",
    monthlyAmountWan: roundWan(estimate.valueWan),
    activeFromAgeInMonths: input.ageInMonths,
    status: "active",
    factStatus: "estimated",
    evidence: [{ source: "system_policy", reasonCode: estimate.reasonCode, confidence: 0.6 }]
  };
}
