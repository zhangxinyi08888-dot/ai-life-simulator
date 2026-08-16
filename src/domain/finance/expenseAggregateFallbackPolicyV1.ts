import type { EmploymentStatus } from "../../types";
import { roundWan } from "./ledgerMath";
import type { ExpenseLivingArrangement } from "./expenseEstimationPolicyV2";

/**
 * A low-authority estimate for total recurring personal consumption when the
 * ledger still contains only a policy-managed basic-living floor.  This is
 * deliberately separate from Expense Estimation Policy V2: V2 prices an
 * already-authoritative typed responsibility, while this policy prevents
 * otherwise unavoidable but unclassified consumption from becoming zero.
 *
 * The income input selects a bounded statistical prior; it is not a target
 * saving rate and never scales linearly with income, cash or wealth.
 */
export const EXPENSE_AGGREGATE_FALLBACK_POLICY_V1 = {
  id: "expense-aggregate-fallback-policy-v1",
  version: 1,
  approvedAt: "2026-08-16"
} as const;

export interface ExpenseAggregateFallbackContext {
  ageInMonths: number;
  employmentStatus?: EmploymentStatus;
  livingArrangement?: ExpenseLivingArrangement;
  cityCostBand?: "low" | "medium" | "high" | "unknown";
  householdSize?: number;
  lifeStage?: string;
  annualRecurringPersonalIncomeWan?: number;
}

export interface ExpenseAggregateFallbackEstimate {
  targetMonthlyCoreExpenseWan: number;
  plausibleRangeWan: [number, number];
  policyId: typeof EXPENSE_AGGREGATE_FALLBACK_POLICY_V1.id;
  policyVersion: typeof EXPENSE_AGGREGATE_FALLBACK_POLICY_V1.version;
  reasonCodes: string[];
  inputs: {
    employmentStatus: EmploymentStatus | "unknown";
    livingArrangement: ExpenseLivingArrangement;
    cityCostBand: "low" | "medium" | "high";
    householdSize?: number;
    annualRecurringPersonalIncomeWan: number;
  };
}

const CITY_MULTIPLIER = { low: 0.9, medium: 1, high: 1.2 } as const;

function normalizedCity(input: ExpenseAggregateFallbackContext): "low" | "medium" | "high" {
  return input.cityCostBand === "low" || input.cityCostBand === "high"
    ? input.cityCostBand
    : "medium";
}

function contextualBaseMonthlyWan(input: ExpenseAggregateFallbackContext): number {
  const arrangement = input.livingArrangement || "unknown";
  if (input.employmentStatus === "student") {
    if (arrangement === "with_family" || arrangement === "provided") return 0.15;
    // A student's housing must still come from an accepted residence fact;
    // the existing matched family-support policy covers this routine living
    // amount without manufacturing personal debt.
    return 0.2;
  }
  const olderAdult = input.ageInMonths >= 65 * 12;
  if (arrangement === "with_family" || arrangement === "provided") return olderAdult ? 0.55 : 0.45;
  if (arrangement === "renting" || arrangement === "owner_occupied") return olderAdult ? 0.75 : 0.7;
  return olderAdult ? 0.65 : 0.6;
}

/** A bounded, diminishing consumption prior. Never a percentage of income. */
function incomeBandMonthlyPriorWan(annualIncomeWan: number): number {
  if (!Number.isFinite(annualIncomeWan) || annualIncomeWan <= 0) return 0;
  if (annualIncomeWan <= 6) return 0.4;
  if (annualIncomeWan <= 12) return 0.6;
  if (annualIncomeWan <= 24) return 0.9;
  if (annualIncomeWan <= 36) return 1.1;
  if (annualIncomeWan <= 60) return 1.35;
  return 1.6;
}

export function estimateUnclassifiedCoreConsumption(
  input: ExpenseAggregateFallbackContext
): ExpenseAggregateFallbackEstimate | undefined {
  if (input.ageInMonths < 18 * 12) return undefined;
  const cityCostBand = normalizedCity(input);
  const annualIncome = roundWan(Math.max(0, input.annualRecurringPersonalIncomeWan || 0));
  const contextualBase = roundWan(contextualBaseMonthlyWan(input) * CITY_MULTIPLIER[cityCostBand]);
  // A student living with family or in accepted provided housing already has
  // a separately balanced family-support policy. Do not manufacture a second
  // aggregate merely because a household income number happens to exist.
  const suppressIncomePrior = input.employmentStatus === "student"
    && (input.livingArrangement === "with_family" || input.livingArrangement === "provided");
  const incomePrior = suppressIncomePrior ? 0 : incomeBandMonthlyPriorWan(annualIncome);
  const target = roundWan(Math.max(contextualBase, incomePrior));
  const reasonCodes = [
    "EXPENSE_AGGREGATE_CONTEXTUAL_FALLBACK",
    `EXPENSE_CONTEXT_CITY_${cityCostBand.toUpperCase()}`,
    `EXPENSE_CONTEXT_RESIDENCE_${String(input.livingArrangement || "unknown").toUpperCase()}`,
    `EXPENSE_CONTEXT_EMPLOYMENT_${String(input.employmentStatus || "unknown").toUpperCase()}`
  ];
  if (incomePrior > contextualBase) reasonCodes.push("EXPENSE_INCOME_BAND_PRIOR_APPLIED");
  if ((input.householdSize || 1) > 1) {
    // Household size is audit context only until payer/share is accepted.
    reasonCodes.push("EXPENSE_HOUSEHOLD_SIZE_REVIEW_ONLY");
  }
  return {
    targetMonthlyCoreExpenseWan: target,
    plausibleRangeWan: [roundWan(target * 0.8), roundWan(target * 1.4)],
    policyId: EXPENSE_AGGREGATE_FALLBACK_POLICY_V1.id,
    policyVersion: EXPENSE_AGGREGATE_FALLBACK_POLICY_V1.version,
    reasonCodes,
    inputs: {
      employmentStatus: input.employmentStatus || "unknown",
      livingArrangement: input.livingArrangement || "unknown",
      cityCostBand,
      householdSize: input.householdSize,
      annualRecurringPersonalIncomeWan: annualIncome
    }
  };
}
