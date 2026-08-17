import type { EmploymentStatus } from "../../types";
import { estimateExpenseResponsibility } from "./expenseEstimationPolicyV2";
import { roundWan } from "./ledgerMath";
import type { ExpenseCommitment } from "./types";

export interface FinancialEstimationContext {
  ageInMonths: number;
  employmentStatus?: EmploymentStatus;
  livingArrangement?: "with_family" | "renting" | "owner_occupied" | "provided" | "unknown";
  cityCostBand?: "low" | "medium" | "high" | "unknown";
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
  // Keep this V1-named compatibility function as the single automatic-floor
  // call site, but source every newly produced amount from the versioned V2
  // responsibility policy.  Historical V1 records stay readable through the
  // migration path; no new node can silently recreate a separate complete
  // lifestyle estimate.
  const estimate = estimateExpenseResponsibility({
    responsibilityKind: "adult_basic_living",
    ageInMonths: input.ageInMonths,
    employmentStatus: input.employmentStatus,
    livingArrangement: input.livingArrangement || "unknown",
    cityCostBand: input.cityCostBand || "unknown"
  });
  if (!estimate) return undefined;
  return {
    id: `estimated_basic_living_v1_${input.ageInMonths}`,
    type: "basic_living",
    displayName: "基础生活支出（系统保守估计）",
    monthlyAmountWan: roundWan(estimate.accrualMonthlyAmountWan),
    activeFromAgeInMonths: input.ageInMonths,
    status: "active",
    factStatus: "estimated",
    estimationPolicyId: estimate.policyId,
    evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING_ESTIMATED_V2", confidence: 0.6 }]
  };
}
