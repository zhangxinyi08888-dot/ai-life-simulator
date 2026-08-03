import type { ExpenseResponsibilityKind } from "./types";
import type { EmploymentStatus } from "../../types";
import { roundWan } from "./ledgerMath";

/**
 * Versioned, deterministic policy for a responsibility whose existence is
 * already authoritative but whose personal amount is not yet known.  This is
 * deliberately not a wealth or affordability policy: it never reads income,
 * cash, net worth, or a target saving rate.
 */
export type ExpenseLivingArrangement = "with_family" | "renting" | "owner_occupied" | "provided" | "unknown";
export type ExpenseAgeBand = "minor" | "young_adult" | "adult" | "older_adult";
export type ExpenseCareIntensity = "baseline" | "elevated";

export interface ExpenseResponsibilityEstimateContext {
  responsibilityKind: ExpenseResponsibilityKind;
  ageInMonths: number;
  lifeStage?: string;
  employmentStatus?: EmploymentStatus;
  livingArrangement?: ExpenseLivingArrangement;
  householdSize?: number;
  cityCostBand?: "low" | "medium" | "high" | "unknown";
  /**
   * Only an already-accepted, newly escalated care responsibility may select
   * `elevated`. It is never inferred from age, health score, or a missing
   * expense account.
   */
  careIntensity?: ExpenseCareIntensity;
}

export interface ExpenseEstimate {
  accrualMonthlyAmountWan: number;
  plausibleRangeWan: [number, number];
  policyId: string;
  policyVersion: number;
  reasonCodes: string[];
  inputs: {
    ageBand: ExpenseAgeBand;
    lifeStage?: string;
    employmentStatus?: EmploymentStatus;
    livingArrangement: ExpenseLivingArrangement;
    householdSize?: number;
    cityCostBand: "low" | "medium" | "high" | "unknown";
    responsibilityKind: ExpenseResponsibilityKind;
    careIntensity: ExpenseCareIntensity;
  };
}

interface PolicyRow {
  responsibilityKind: ExpenseResponsibilityKind;
  /**
   * The calibrated base is deliberately for a medium-cost city.  Low/high
   * bands are an explicit, bounded contextual adjustment; an unknown city
   * therefore resolves to medium rather than silently choosing the lowest
   * plausible value.
   */
  applicableCityCostBands: readonly ("low" | "medium" | "high")[];
  /**
   * The policy must declare the age context in which it can be selected.
   * In particular, `adult_basic_living` is a floor for adults, not a hidden
   * fallback for a minor or an otherwise unmatched responsibility.
   */
  applicableAgeBands: readonly ExpenseAgeBand[];
  /**
   * This is explicit even where every arrangement is valid: it keeps a row's
   * coverage auditable and prevents future row additions from accidentally
   * treating an unmatched arrangement as the generic default.
   */
  applicableLivingArrangements?: readonly ExpenseLivingArrangement[];
  /** Optional special-purpose rows (for example, a student basic-living floor). */
  applicableEmploymentStatuses?: readonly EmploymentStatus[];
  /** Undefined means this row is not intensity-specific. */
  applicableCareIntensities?: readonly ExpenseCareIntensity[];
  baseMonthlyAmountWan: number;
  plausibleRangeWan: [number, number];
  /** Product calibration reference; this is audit metadata, not an external price feed. */
  sourceNote: string;
}

const CITY_COST_MULTIPLIER: Record<"low" | "medium" | "high", number> = {
  low: 0.9,
  medium: 1,
  high: 1.2
};

export const EXPENSE_ESTIMATION_POLICY_V2 = {
  id: "expense-estimation-policy-v2",
  version: 2,
  approvedAt: "2026-08-03",
  rows: [
    {
      responsibilityKind: "adult_basic_living",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      applicableEmploymentStatuses: ["student"],
      baseMonthlyAmountWan: 0.2,
      plausibleRangeWan: [0.12, 0.35],
      sourceNote: "在校青年由家庭/学校支持后的个人最低生活支出；不是成年就业者的替代标准"
    },
    {
      responsibilityKind: "adult_basic_living",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult", "adult", "older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      baseMonthlyAmountWan: 0.35,
      plausibleRangeWan: [0.35, 0.6],
      sourceNote: "成年个人非住房基本日常开销的最低保护线"
    },
    {
      responsibilityKind: "primary_residence",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["minor", "young_adult", "adult", "older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      baseMonthlyAmountWan: 0.35,
      plausibleRangeWan: [0.2, 0.7],
      sourceNote: "中等成本城市个人承担的基础居住服务估计，不含房贷本息"
    },
    {
      responsibilityKind: "child_support",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult", "adult", "older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      baseMonthlyAmountWan: 0.25,
      plausibleRangeWan: [0.15, 0.6],
      sourceNote: "已确认主角承担的单名子女日常抚养保守计提"
    },
    {
      responsibilityKind: "elder_care",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult", "adult", "older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      applicableCareIntensities: ["baseline"],
      baseMonthlyAmountWan: 0.2,
      plausibleRangeWan: [0.1, 0.6],
      sourceNote: "已确认主角承担的父母生活支持或非医疗照护保守计提"
    },
    {
      responsibilityKind: "elder_care",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult", "adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      applicableCareIntensities: ["elevated"],
      baseMonthlyAmountWan: 0.25,
      plausibleRangeWan: [0.15, 0.7],
      sourceNote: "已确认且有新持续照护升级证据的父母照护保守计提；不是年龄自动收费"
    },
    {
      responsibilityKind: "elder_care",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      applicableCareIntensities: ["elevated"],
      baseMonthlyAmountWan: 0.35,
      plausibleRangeWan: [0.25, 0.9],
      sourceNote: "高龄且有新持续照护升级证据的父母照护保守计提；不由高龄单独创建或上调账户"
    },
    {
      responsibilityKind: "recurring_healthcare",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["minor", "young_adult", "adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      baseMonthlyAmountWan: 0.12,
      plausibleRangeWan: [0.08, 0.5],
      sourceNote: "已确认的持续用药、复诊或治疗责任保守计提；年龄本身不创建该责任"
    },
    {
      responsibilityKind: "recurring_healthcare",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      // This applies only after an accepted long-term treatment/medication
      // responsibility exists. It reflects that the same ongoing medical
      // obligation at high age must not be calibrated as a young-adult
      // baseline, while still never inventing a medical account from age.
      baseMonthlyAmountWan: 0.24,
      plausibleRangeWan: [0.16, 0.8],
      sourceNote: "已确认的高龄持续医疗责任保守计提；不由年龄单独触发"
    },
    {
      responsibilityKind: "personal_insurance",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult", "adult", "older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      baseMonthlyAmountWan: 0.08,
      plausibleRangeWan: [0.04, 0.2],
      sourceNote: "已确认的个人持续商业保险保费保守计提"
    },
    {
      responsibilityKind: "continuing_education",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult", "adult", "older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      baseMonthlyAmountWan: 0.2,
      plausibleRangeWan: [0.1, 0.5],
      sourceNote: "已确认主角承担的持续教育项目保守计提"
    },
    {
      responsibilityKind: "legacy_aggregate",
      applicableCityCostBands: ["low", "medium", "high"],
      applicableAgeBands: ["young_adult", "adult", "older_adult"],
      applicableLivingArrangements: ["with_family", "renting", "owner_occupied", "provided", "unknown"],
      baseMonthlyAmountWan: 0.35,
      plausibleRangeWan: [0.35, 0.6],
      sourceNote: "仅在聚合 legacy 事实无法安全拆分时的最低保护参数"
    }
  ] satisfies PolicyRow[]
} as const;

function ageBand(ageInMonths: number): ExpenseAgeBand {
  if (ageInMonths < 18 * 12) return "minor";
  if (ageInMonths < 35 * 12) return "young_adult";
  if (ageInMonths < 65 * 12) return "adult";
  return "older_adult";
}

function normalizedCityCostBand(input: ExpenseResponsibilityEstimateContext): "low" | "medium" | "high" {
  // Unknown is not a license to choose a low-cost city.  It is normalized to
  // the policy's medium calibration before selector matching and amount
  // calculation, while the caller still records the underlying uncertainty
  // as `needs_review` on the commitment.
  return input.cityCostBand === "low" || input.cityCostBand === "high"
    ? input.cityCostBand
    : "medium";
}

function selectPolicyRow(input: {
  responsibilityKind: ExpenseResponsibilityKind;
  ageBand: ExpenseAgeBand;
  livingArrangement: ExpenseLivingArrangement;
  cityCostBand: "low" | "medium" | "high";
  employmentStatus?: EmploymentStatus;
  careIntensity: ExpenseCareIntensity;
}): PolicyRow | undefined {
  // `satisfies` intentionally preserves literal row values for config
  // validation. Widen only at selection time so the predicate can evaluate
  // the common PolicyRow contract rather than the union of individual rows.
  const rows: readonly PolicyRow[] = EXPENSE_ESTIMATION_POLICY_V2.rows;
  return rows.find((row) => (
    row.responsibilityKind === input.responsibilityKind
    && row.applicableAgeBands.includes(input.ageBand)
    && row.applicableCityCostBands.includes(input.cityCostBand)
    && (!row.applicableLivingArrangements || row.applicableLivingArrangements.includes(input.livingArrangement))
    && (!row.applicableEmploymentStatuses || row.applicableEmploymentStatuses.includes(input.employmentStatus as EmploymentStatus))
    && (!row.applicableCareIntensities || row.applicableCareIntensities.includes(input.careIntensity))
  ));
}

export function expenseReviewIntervalMonths(kind: ExpenseResponsibilityKind): number {
  switch (kind) {
    case "adult_basic_living": return 60;
    case "primary_residence": return 36;
    case "personal_insurance": return 24;
    case "child_support":
    case "elder_care":
    case "recurring_healthcare":
    case "continuing_education":
    case "legacy_aggregate": return 12;
  }
}

/**
 * Returns the policy base, never a range lower bound.  A parent, child,
 * medical, or housing responsibility must be supplied by accepted facts
 * before this function may be called; age alone never creates one.
 */
export function estimateExpenseResponsibility(input: ExpenseResponsibilityEstimateContext): ExpenseEstimate | undefined {
  const resolvedAgeBand = ageBand(input.ageInMonths);
  const livingArrangement = input.livingArrangement || "unknown";
  const cityCostBand = normalizedCityCostBand(input);
  const careIntensity = input.careIntensity || "baseline";
  const row = selectPolicyRow({
    responsibilityKind: input.responsibilityKind,
    ageBand: resolvedAgeBand,
    livingArrangement,
    cityCostBand,
    employmentStatus: input.employmentStatus,
    careIntensity
  });
  if (!row) return undefined;
  // A verified rent-free/provided arrangement does not manufacture a housing
  // charge.  The caller must provide that accepted arrangement explicitly.
  const isVerifiedNoPersonalHousing = input.responsibilityKind === "primary_residence"
    && (livingArrangement === "with_family" || livingArrangement === "provided");
  const multiplier = CITY_COST_MULTIPLIER[cityCostBand];
  const policyBase = roundWan(row.baseMonthlyAmountWan * multiplier);
  const policyRange: [number, number] = [
    roundWan(row.plausibleRangeWan[0] * multiplier),
    roundWan(row.plausibleRangeWan[1] * multiplier)
  ];
  return {
    accrualMonthlyAmountWan: isVerifiedNoPersonalHousing ? 0 : policyBase,
    plausibleRangeWan: policyRange,
    policyId: EXPENSE_ESTIMATION_POLICY_V2.id,
    policyVersion: EXPENSE_ESTIMATION_POLICY_V2.version,
    reasonCodes: [
      "EXPENSE_CONTEXTUAL_ESTIMATE",
      `EXPENSE_POLICY_${input.responsibilityKind.toUpperCase()}`,
      `EXPENSE_CONTEXT_AGE_${resolvedAgeBand.toUpperCase()}`,
      `EXPENSE_CONTEXT_CITY_${cityCostBand.toUpperCase()}`,
      ...(careIntensity === "elevated" ? ["EXPENSE_CONTEXT_CARE_ELEVATED"] : []),
      ...(isVerifiedNoPersonalHousing ? ["EXPENSE_VERIFIED_PROVIDED_HOUSING"] : [])
    ],
    inputs: {
      ageBand: resolvedAgeBand,
      lifeStage: input.lifeStage,
      employmentStatus: input.employmentStatus,
      livingArrangement,
      householdSize: input.householdSize,
      cityCostBand,
      responsibilityKind: input.responsibilityKind,
      careIntensity
    }
  };
}
