import { EmploymentStatus, FinancialChange, FinancialSignals, FinancialState, IncomeStability, LifeAttributes } from "../types";

const STABILITIES: IncomeStability[] = ["unstable", "volatile", "stable", "very_stable"];
const EMPLOYMENT_STATUSES: EmploymentStatus[] = ["student", "part_time", "employed", "self_employed", "not_working", "medical_leave", "retired"];

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundSignalMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stability(value: unknown, fallback: IncomeStability = "volatile"): IncomeStability {
  return typeof value === "string" && STABILITIES.includes(value as IncomeStability)
    ? value as IncomeStability
    : fallback;
}

const REQUIRED_CHANGE_NUMBERS: Array<keyof FinancialChange> = [
  "afterTaxIncomeWan",
  "livingExpenseWan",
  "medicalEducationExpenseWan",
  "interestAndFeesWan",
  "assetValueChangeWan",
  "otherNetChangeWan"
];

export function getFinancialChangeInputIssues(raw: unknown, expectedPeriodMonths: number): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["financialChange 缺失"];
  const record = raw as Record<string, unknown>;
  const issues = REQUIRED_CHANGE_NUMBERS
    .filter((key) => typeof record[key] !== "number" || !Number.isFinite(record[key]))
    .map((key) => `financialChange.${key} 必须是有效数字`);
  if (record.periodMonths !== undefined && record.periodMonths !== expectedPeriodMonths) {
    issues.push(`financialChange.periodMonths 必须等于 ${expectedPeriodMonths}`);
  }
  if (record.incomeStability !== undefined && !STABILITIES.includes(record.incomeStability as IncomeStability)) {
    issues.push("financialChange.incomeStability 无效");
  }
  if (!Array.isArray(record.reasons) || !record.reasons.some((reason) => typeof reason === "string" && Boolean(reason.trim()))) {
    issues.push("financialChange.reasons 至少需要一条变化依据");
  }
  return issues;
}

const REQUIRED_SIGNAL_NUMBERS: Array<keyof FinancialSignals> = [
  "monthlyNetIncomeWan",
  "incomeMonths",
  "monthlyLivingExpenseWan",
  "oneOffIncomeWan",
  "oneOffExpenseWan",
  "assetValueChangeWan",
  "propertyMarketValueChangeWan",
  "personalDebtChangeWan",
  "confidence"
];

export function getFinancialSignalsInputIssues(raw: unknown, periodMonths: number): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["financialSignals 缺失"];
  const record = raw as Record<string, unknown>;
  const issues = REQUIRED_SIGNAL_NUMBERS
    .filter((key) => typeof record[key] !== "number" || !Number.isFinite(record[key]))
    .map((key) => `financialSignals.${key} 必须是有效数字`);
  if (!EMPLOYMENT_STATUSES.includes(record.employmentStatus as EmploymentStatus)) issues.push("financialSignals.employmentStatus 无效");
  if (!STABILITIES.includes(record.incomeStability as IncomeStability)) issues.push("financialSignals.incomeStability 无效");
  if (typeof record.incomeMonths === "number" && (record.incomeMonths < 0 || record.incomeMonths > periodMonths)) {
    issues.push(`financialSignals.incomeMonths 必须在 0-${periodMonths} 之间`);
  }
  if (typeof record.confidence === "number" && (record.confidence < 0 || record.confidence > 1)) {
    issues.push("financialSignals.confidence 必须在 0-1 之间");
  }
  if (!Array.isArray(record.reasons) || !record.reasons.some((reason) => typeof reason === "string" && Boolean(reason.trim()))) {
    issues.push("financialSignals.reasons 至少需要一条依据");
  }
  return issues;
}

export function normalizeFinancialSignals(raw: Partial<FinancialSignals>, periodMonths: number): FinancialSignals {
  const employmentStatus = EMPLOYMENT_STATUSES.includes(raw.employmentStatus as EmploymentStatus)
    ? raw.employmentStatus as EmploymentStatus
    : "not_working";
  return {
    employmentStatus,
    monthlyNetIncomeWan: roundSignalMoney(Math.max(0, finite(raw.monthlyNetIncomeWan))),
    incomeMonths: roundMoney(clamp(finite(raw.incomeMonths), 0, periodMonths)),
    monthlyLivingExpenseWan: roundSignalMoney(Math.max(0, finite(raw.monthlyLivingExpenseWan))),
    oneOffIncomeWan: roundSignalMoney(Math.max(0, finite(raw.oneOffIncomeWan))),
    oneOffExpenseWan: roundSignalMoney(Math.max(0, finite(raw.oneOffExpenseWan))),
    assetValueChangeWan: roundSignalMoney(finite(raw.assetValueChangeWan)),
    propertyMarketValueChangeWan: roundSignalMoney(finite(raw.propertyMarketValueChangeWan)),
    personalDebtChangeWan: roundSignalMoney(finite(raw.personalDebtChangeWan)),
    incomeStability: stability(raw.incomeStability),
    confidence: clamp(finite(raw.confidence, 0.3), 0, 1),
    reasons: Array.isArray(raw.reasons)
      ? raw.reasons.filter((reason): reason is string => typeof reason === "string" && Boolean(reason.trim())).map((reason) => reason.trim()).slice(0, 4)
      : []
  };
}

function moneyToWan(value: string, unit: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return unit === "万" || unit === "万元" ? parsed : parsed / 10000;
}

function firstMoneyMatch(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return moneyToWan(match[1], match[2]);
  }
  return undefined;
}

function moneyMismatchIsMaterial(actual: number, explicit: number): boolean {
  if (explicit <= 0) return false;
  return actual >= explicit * 5 || actual <= explicit / 5;
}

export function isStudentFinancialNarrative(description: string): boolean {
  return /在校|大学|学生|大[一二三四]|院校|专业课|学期|导师/.test(description);
}

function monthlyFamilySupport(description: string): number {
  return firstMoneyMatch(description, [
    /(?:父母|家里|家人|母亲|父亲)[^。；]{0,16}(?:每月|每个月)[^。；]{0,12}(?:给|提供|补贴|承担)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:每月|每个月)[^。；]{0,12}(?:父母|家里|家人|母亲|父亲)[^。；]{0,12}(?:给|提供|补贴|承担)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/
  ]) || 0;
}

function studentExpenseCeiling(description: string): number {
  const explicitLivingExpense = firstMoneyMatch(description, [
    /(?:生活费|房租|住宿费|伙食费)[^。；，]{0,16}(?:每月|月付)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:每月|月付)[^。；，]{0,12}(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；，]{0,8}(?:生活费|房租|住宿费|伙食费)/
  ]);
  const explicitStudyInstallment = firstMoneyMatch(description, [
    /(?:训练营|培训费|课程费|学费|分期)[^。；]{0,24}(?:每月|月付)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:每月|月付)[^。；，]{0,12}(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；，]{0,8}(?:训练营|培训费|课程费|学费|分期)/
  ]) || 0;

  // 学生的默认值只代表本人实际承担、扣除家庭或学校支持后的净生活支出。
  return Math.max(0.1, explicitLivingExpense || 0) + explicitStudyInstallment;
}

export function reconcileStudentFinancialSignals(
  raw: Partial<FinancialSignals>,
  description: string,
  periodMonths: number,
  previousState?: FinancialState,
  authoritativeEmploymentStatus?: EmploymentStatus
): FinancialSignals {
  const explicitMonthlyIncome = firstMoneyMatch(description, [
    /(?:月薪|月工资|月收入|月入(?:能到)?|每月收入)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /每月[^。；，]{0,16}(?:能赚|赚到|拿到)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万元|万|元)/
  ]);
  const explicitOneOffIncome = firstMoneyMatch(description, [
    /(?:赚了|挣了|获得报酬|拿到报酬|收入)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万元|万|元)/
  ]);
  const explicitMonthlyFamilySupport = monthlyFamilySupport(description);
  const normalized = normalizeFinancialSignals(raw, periodMonths);
  const employmentStatus = authoritativeEmploymentStatus ?? normalized.employmentStatus;
  const isStudentPhase = employmentStatus === "student";
  if (!isStudentPhase) return { ...normalized, employmentStatus };
  const signals: FinancialSignals = {
    ...normalized,
    employmentStatus
  };
  const expenseCeiling = studentExpenseCeiling(description);

  const monthlyNetIncomeWan = explicitMonthlyIncome !== undefined
    && moneyMismatchIsMaterial(signals.monthlyNetIncomeWan, explicitMonthlyIncome)
    ? roundSignalMoney(explicitMonthlyIncome)
    : explicitMonthlyFamilySupport > 0 && explicitMonthlyIncome === undefined
      ? 0
      : signals.monthlyNetIncomeWan;
  const monthlyLivingExpenseWan = roundSignalMoney(Math.max(
    0,
    Math.min(signals.monthlyLivingExpenseWan, expenseCeiling) - explicitMonthlyFamilySupport
  ));
  const reconciled = {
    ...signals,
    monthlyNetIncomeWan,
    oneOffIncomeWan: explicitOneOffIncome !== undefined
      && moneyMismatchIsMaterial(signals.oneOffIncomeWan, explicitOneOffIncome)
      ? roundSignalMoney(explicitOneOffIncome)
      : signals.oneOffIncomeWan,
    monthlyLivingExpenseWan,
    reasons: [
      ...signals.reasons,
      ...(signals.monthlyLivingExpenseWan > expenseCeiling ? ["学生个人净支出按正文金额和保守生活费校正"] : []),
      ...(explicitMonthlyFamilySupport > 0 ? ["父母生活支持只抵扣学生生活支出，不计入工资或可积累财富"] : [])
    ].slice(0, 4)
  };

  if (!previousState || reconciled.personalDebtChangeWan > 0 || periodMonths <= 0) return reconciled;

  const availableForExpenses = Math.max(0,
    Math.max(0, previousState.cashWan)
      + reconciled.monthlyNetIncomeWan * reconciled.incomeMonths
      + reconciled.oneOffIncomeWan
  );
  const fundedOneOffExpense = roundSignalMoney(Math.min(reconciled.oneOffExpenseWan, availableForExpenses));
  const remainingForLiving = Math.max(0, availableForExpenses - fundedOneOffExpense);
  const fundedMonthlyExpense = roundSignalMoney(remainingForLiving / periodMonths);
  if (
    reconciled.oneOffExpenseWan <= fundedOneOffExpense
    && reconciled.monthlyLivingExpenseWan <= fundedMonthlyExpense
  ) return reconciled;

  return {
    ...reconciled,
    oneOffExpenseWan: fundedOneOffExpense,
    monthlyLivingExpenseWan: roundSignalMoney(Math.min(reconciled.monthlyLivingExpenseWan, fundedMonthlyExpense)),
    reasons: [...reconciled.reasons, "无新增个人债务时学生支出不生成隐含负现金"].slice(0, 4)
  };
}

export function inferFinancialSignalsFromNarrative(input: {
  description: string;
  previousState: FinancialState;
  periodMonths: number;
  targetAgeInMonths: number;
  employmentStatus?: EmploymentStatus;
}): FinancialSignals {
  const monthlyIncome = firstMoneyMatch(input.description, [
    /(?:月薪|月工资|月收入|月入(?:能到)?|每月收入)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /每月[^。；，]{0,16}(?:能赚|赚到|拿到)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万元|万|元)/
  ]);
  const previousMonthlyIncome = Math.max(0, input.previousState.annualAfterTaxIncomeWan / 12);
  const previousMonthlyExpense = Math.max(0, input.previousState.annualCoreExpenseWan / 12);
  const age = Math.floor(input.targetAgeInMonths / 12);
  const employmentStatus = input.employmentStatus ?? input.previousState.employmentStatus ?? "not_working";
  const defaultLivingExpense = employmentStatus === "student"
    ? 0.1
    : age < 30 ? 0.35 : 0.45;
  const monthlyLivingExpenseWan = employmentStatus === "student"
    ? Math.min(previousMonthlyExpense || defaultLivingExpense, 0.2)
    : (input.previousState.employmentStatus === "student" || previousMonthlyExpense <= 0.2)
      ? defaultLivingExpense
      : previousMonthlyExpense > 0 ? previousMonthlyExpense : defaultLivingExpense;
  const explicitMonthlyTransfer = firstMoneyMatch(input.description, [
    /每月(?:寄|汇|转)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/
  ]) || 0;
  const resolvedMonthlyIncome = monthlyIncome ?? previousMonthlyIncome;
  const inactive = employmentStatus === "not_working" || employmentStatus === "medical_leave" || employmentStatus === "retired";
  const incomeMonths = inactive && monthlyIncome === undefined ? 0 : input.periodMonths;
  const reasons = monthlyIncome !== undefined
    ? ["根据正文明确月收入估算", "按阶段月份累计收入并参考上期生活成本"]
    : ["正文未给出新薪资，沿用上一阶段收入和生活水平"];
  if (explicitMonthlyTransfer > 0) reasons.push("计入正文明确的每月家庭汇款");

  return normalizeFinancialSignals({
    employmentStatus,
    monthlyNetIncomeWan: resolvedMonthlyIncome,
    incomeMonths,
    monthlyLivingExpenseWan: monthlyLivingExpenseWan + explicitMonthlyTransfer,
    oneOffIncomeWan: 0,
    oneOffExpenseWan: 0,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: monthlyIncome !== undefined ? "volatile" : input.previousState.incomeStability,
    confidence: monthlyIncome !== undefined ? 0.65 : 0.35,
    reasons
  }, input.periodMonths);
}

function scoreByBands(value: number, bands: Array<[number, number]>): number {
  if (value <= bands[0][0]) return bands[0][1];
  for (let index = 1; index < bands.length; index += 1) {
    const [rightValue, rightScore] = bands[index];
    const [leftValue, leftScore] = bands[index - 1];
    if (value <= rightValue) {
      const progress = (value - leftValue) / (rightValue - leftValue);
      return leftScore + (rightScore - leftScore) * progress;
    }
  }
  return bands[bands.length - 1][1];
}

export function calculateNetWorth(state: Pick<FinancialState,
  "cashWan" | "investmentAssetsWan" | "propertyMarketValueWan" | "businessAndOtherAssetsWan" | "totalDebtWan"
>): number {
  return roundMoney(
    state.cashWan
      + state.investmentAssetsWan
      + state.propertyMarketValueWan
      + state.businessAndOtherAssetsWan
      - state.totalDebtWan
  );
}

export function calculateFinancialChange(raw: Partial<FinancialChange>, periodMonths: number): FinancialChange {
  const afterTaxIncomeWan = finite(raw.afterTaxIncomeWan);
  const livingExpenseWan = Math.max(0, finite(raw.livingExpenseWan));
  const medicalEducationExpenseWan = Math.max(0, finite(raw.medicalEducationExpenseWan));
  const interestAndFeesWan = Math.max(0, finite(raw.interestAndFeesWan));
  const assetValueChangeWan = finite(raw.assetValueChangeWan);
  const otherNetChangeWan = finite(raw.otherNetChangeWan);
  const netWorthChangeWan = roundMoney(
    afterTaxIncomeWan
      - livingExpenseWan
      - medicalEducationExpenseWan
      - interestAndFeesWan
      + assetValueChangeWan
      + otherNetChangeWan
  );

  return {
    periodMonths,
    afterTaxIncomeWan: roundMoney(afterTaxIncomeWan),
    livingExpenseWan: roundMoney(livingExpenseWan),
    medicalEducationExpenseWan: roundMoney(medicalEducationExpenseWan),
    interestAndFeesWan: roundMoney(interestAndFeesWan),
    assetValueChangeWan: roundMoney(assetValueChangeWan),
    otherNetChangeWan: roundMoney(otherNetChangeWan),
    netWorthChangeWan,
    incomeStability: raw.incomeStability ? stability(raw.incomeStability) : undefined,
    reasons: Array.isArray(raw.reasons)
      ? raw.reasons.filter((reason): reason is string => typeof reason === "string" && Boolean(reason.trim())).map((reason) => reason.trim()).slice(0, 4)
      : []
  };
}

export function reconcileLiquidityShortfall(state: FinancialState): {
  financialState: FinancialState;
  liquidityShortfallWan: number;
} {
  if (state.cashWan >= 0) {
    const financialState = { ...state, netWorthWan: calculateNetWorth(state) };
    return { financialState, liquidityShortfallWan: 0 };
  }

  const liquidityShortfallWan = roundMoney(-state.cashWan);
  const financialState: FinancialState = {
    ...state,
    cashWan: 0,
    totalDebtWan: roundMoney(state.totalDebtWan + liquidityShortfallWan)
  };
  financialState.netWorthWan = calculateNetWorth(financialState);
  return { financialState, liquidityShortfallWan };
}

function withLiquidityShortfall(
  financialState: FinancialState,
  financialChange: FinancialChange
): { financialState: FinancialState; financialChange: FinancialChange } {
  const reconciled = reconcileLiquidityShortfall(financialState);
  if (reconciled.liquidityShortfallWan <= 0) {
    return { financialState: reconciled.financialState, financialChange };
  }
  return {
    financialState: reconciled.financialState,
    financialChange: {
      ...financialChange,
      liquidityShortfallWan: reconciled.liquidityShortfallWan,
      reasons: [
        ...financialChange.reasons,
        `现金缺口 ${reconciled.liquidityShortfallWan} 万元转为短期负债`
      ]
    }
  };
}

export function normalizeInitialFinancialState(
  raw: Partial<FinancialState> | undefined,
  ageInMonths: number,
  fallbackWealth: number
): FinancialState {
  if (!raw || typeof raw !== "object") return estimateFinancialStateFromWealth(fallbackWealth, ageInMonths);
  const fallback = estimateFinancialStateFromWealth(fallbackWealth, ageInMonths);
  const requiredInitialNumbers: Array<keyof FinancialState> = [
    "cashWan", "investmentAssetsWan", "propertyMarketValueWan", "businessAndOtherAssetsWan",
    "totalDebtWan", "annualAfterTaxIncomeWan", "annualDisposableIncomeWan", "annualCoreExpenseWan"
  ];
  const isIncomplete = requiredInitialNumbers.some((key) => typeof raw[key] !== "number" || !Number.isFinite(raw[key]));

  const state: FinancialState = {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: ageInMonths,
    cashWan: roundMoney(finite(raw.cashWan, fallback.cashWan)),
    investmentAssetsWan: roundMoney(Math.max(0, finite(raw.investmentAssetsWan, fallback.investmentAssetsWan))),
    propertyMarketValueWan: roundMoney(Math.max(0, finite(raw.propertyMarketValueWan, fallback.propertyMarketValueWan))),
    businessAndOtherAssetsWan: roundMoney(Math.max(0, finite(raw.businessAndOtherAssetsWan, fallback.businessAndOtherAssetsWan))),
    totalDebtWan: roundMoney(Math.max(0, finite(raw.totalDebtWan, fallback.totalDebtWan))),
    netWorthWan: 0,
    annualAfterTaxIncomeWan: roundMoney(Math.max(0, finite(raw.annualAfterTaxIncomeWan, fallback.annualAfterTaxIncomeWan))),
    annualDisposableIncomeWan: roundMoney(finite(raw.annualDisposableIncomeWan, fallback.annualDisposableIncomeWan)),
    annualCoreExpenseWan: roundMoney(Math.max(0, finite(raw.annualCoreExpenseWan, fallback.annualCoreExpenseWan))),
    employmentStatus: EMPLOYMENT_STATUSES.includes(raw.employmentStatus as EmploymentStatus)
      ? raw.employmentStatus as EmploymentStatus
      : fallback.employmentStatus,
    incomeStability: stability(raw.incomeStability, fallback.incomeStability),
    isEstimated: raw.isEstimated !== false || isIncomplete
  };
  state.netWorthWan = calculateNetWorth(state);
  return reconcileLiquidityShortfall(state).financialState;
}

export function estimateFinancialStateFromWealth(wealth: number, ageInMonths: number): FinancialState {
  const score = clamp(finite(wealth, 50), 0, 100);
  const age = Math.floor(ageInMonths / 12);
  const netWorthWan = roundMoney(age <= 22
    ? clamp((score - 40) * 0.5, -5, 30)
    : age <= 30
      ? clamp((score - 35) * 1.5, -20, 120)
      : age <= 45
        ? clamp((score - 30) * 5, -50, 350)
        : clamp((score - 25) * 8, -100, 600));
  const debtWan = netWorthWan < 0 ? Math.abs(netWorthWan) : score < 35 ? roundMoney((35 - score) * 1.5) : 0;
  const positiveAssets = Math.max(0, netWorthWan + debtWan);
  const annualAfterTaxIncomeWan = roundMoney(age <= 22
    ? Math.max(0, (score - 35) * 0.15)
    : Math.max(0, (score - 25) * 0.8));
  const annualCoreExpenseWan = roundMoney(Math.max(age <= 22 ? 2.4 : 4.2, annualAfterTaxIncomeWan * 0.55));
  return {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: ageInMonths,
    cashWan: roundMoney(positiveAssets * 0.25),
    investmentAssetsWan: roundMoney(positiveAssets * 0.15),
    propertyMarketValueWan: roundMoney(positiveAssets * 0.6),
    businessAndOtherAssetsWan: 0,
    totalDebtWan: debtWan,
    netWorthWan,
    annualAfterTaxIncomeWan,
    annualDisposableIncomeWan: roundMoney(annualAfterTaxIncomeWan - annualCoreExpenseWan),
    annualCoreExpenseWan,
    employmentStatus: age <= 22 ? "student" : annualAfterTaxIncomeWan > 0 ? "employed" : "not_working",
    incomeStability: score >= 70 ? "very_stable" : score >= 50 ? "stable" : score >= 30 ? "volatile" : "unstable",
    isEstimated: true
  };
}

export function applyFinancialChange(
  previous: FinancialState,
  rawChange: Partial<FinancialChange> | undefined,
  periodMonths: number,
  targetAgeInMonths: number,
  authoritativeEmploymentStatus?: EmploymentStatus
): { financialState: FinancialState; financialChange: FinancialChange } {
  const financialChange = calculateFinancialChange(rawChange || {}, periodMonths);
  const cashFlowChange = financialChange.afterTaxIncomeWan
    - financialChange.livingExpenseWan
    - financialChange.medicalEducationExpenseWan
    - financialChange.interestAndFeesWan
    + financialChange.otherNetChangeWan;
  const annualFactor = periodMonths > 0 ? 12 / periodMonths : 0;
  const next: FinancialState = {
    ...previous,
    asOfAgeInMonths: targetAgeInMonths,
    cashWan: roundMoney(previous.cashWan + cashFlowChange),
    investmentAssetsWan: roundMoney(previous.investmentAssetsWan + financialChange.assetValueChangeWan),
    annualAfterTaxIncomeWan: roundMoney(financialChange.afterTaxIncomeWan * annualFactor),
    annualCoreExpenseWan: roundMoney(financialChange.livingExpenseWan * annualFactor),
    annualDisposableIncomeWan: roundMoney(
      (financialChange.afterTaxIncomeWan
        - financialChange.livingExpenseWan
        - financialChange.medicalEducationExpenseWan
        - financialChange.interestAndFeesWan) * annualFactor
    ),
    employmentStatus: authoritativeEmploymentStatus ?? previous.employmentStatus,
    incomeStability: financialChange.incomeStability || previous.incomeStability,
    isEstimated: previous.isEstimated || !rawChange
  };
  next.netWorthWan = calculateNetWorth(next);
  return withLiquidityShortfall(next, financialChange);
}

export function applyFinancialSignals(
  previous: FinancialState,
  rawSignals: Partial<FinancialSignals>,
  periodMonths: number,
  targetAgeInMonths: number,
  authoritativeEmploymentStatus?: EmploymentStatus
): { financialState: FinancialState; financialSignals: FinancialSignals; financialChange: FinancialChange } {
  const normalizedSignals = normalizeFinancialSignals(rawSignals, periodMonths);
  const financialSignals: FinancialSignals = {
    ...normalizedSignals,
    employmentStatus: authoritativeEmploymentStatus ?? previous.employmentStatus ?? normalizedSignals.employmentStatus
  };
  const recurringIncome = roundMoney(financialSignals.monthlyNetIncomeWan * financialSignals.incomeMonths);
  const livingExpense = roundMoney(financialSignals.monthlyLivingExpenseWan * periodMonths);
  const afterTaxIncome = roundMoney(recurringIncome + financialSignals.oneOffIncomeWan);
  const financialChange = calculateFinancialChange({
    afterTaxIncomeWan: afterTaxIncome,
    livingExpenseWan: livingExpense,
    medicalEducationExpenseWan: financialSignals.oneOffExpenseWan,
    interestAndFeesWan: 0,
    assetValueChangeWan: roundMoney(
      financialSignals.assetValueChangeWan
      + financialSignals.propertyMarketValueChangeWan
    ),
    otherNetChangeWan: -financialSignals.personalDebtChangeWan,
    incomeStability: financialSignals.incomeStability,
    reasons: financialSignals.reasons
  }, periodMonths);
  const next: FinancialState = {
    ...previous,
    asOfAgeInMonths: targetAgeInMonths,
    cashWan: roundMoney(
      previous.cashWan
      + afterTaxIncome
      - livingExpense
      - financialSignals.oneOffExpenseWan
    ),
    investmentAssetsWan: roundMoney(previous.investmentAssetsWan + financialSignals.assetValueChangeWan),
    propertyMarketValueWan: roundMoney(Math.max(
      0,
      previous.propertyMarketValueWan + financialSignals.propertyMarketValueChangeWan
    )),
    totalDebtWan: roundMoney(Math.max(0, previous.totalDebtWan + financialSignals.personalDebtChangeWan)),
    annualAfterTaxIncomeWan: roundMoney(financialSignals.monthlyNetIncomeWan * 12),
    annualCoreExpenseWan: roundMoney(financialSignals.monthlyLivingExpenseWan * 12),
    annualDisposableIncomeWan: roundMoney((financialSignals.monthlyNetIncomeWan - financialSignals.monthlyLivingExpenseWan) * 12),
    employmentStatus: financialSignals.employmentStatus,
    incomeStability: financialSignals.incomeStability,
    isEstimated: previous.isEstimated || financialSignals.confidence < 0.85
  };
  next.netWorthWan = calculateNetWorth(next);
  const reconciled = withLiquidityShortfall(next, financialChange);
  return { ...reconciled, financialSignals };
}

const COMPLETED_PROPERTY_PURCHASE = /买下|购入|购买了|支付(?:了)?.{0,12}首付|首付.{0,8}(?:支付|付清)|办理(?:了)?.{0,8}(?:按揭|房贷)/;
const COMPLETED_PROPERTY_SALE = /卖掉|卖出|出售了|出售房产|房产出售|完成.{0,8}房产出售/;

export function getPropertyTransactionSignalIssues(
  description: string,
  rawSignals: unknown
): string[] {
  const record = rawSignals && typeof rawSignals === "object" && !Array.isArray(rawSignals)
    ? rawSignals as Record<string, unknown>
    : {};
  const propertyChange = finite(record.propertyMarketValueChangeWan);
  const issues: string[] = [];
  const completedPurchase = COMPLETED_PROPERTY_PURCHASE.test(description);
  const completedSale = COMPLETED_PROPERTY_SALE.test(description);
  // A single net-change field cannot infer the direction when a home is sold and
  // another is bought in the same stage; the required numeric field still gets
  // validated by getFinancialSignalsInputIssues.
  if (completedPurchase && completedSale) return issues;
  if (completedPurchase && propertyChange <= 0) {
    issues.push("正文已发生购房，但 propertyMarketValueChangeWan 未填写正数房产价值");
  }
  if (completedSale && propertyChange >= 0) {
    issues.push("正文已发生卖房，但 propertyMarketValueChangeWan 未填写负数房产价值");
  }
  return issues;
}

export function deriveWealthScore(state: FinancialState): number {
  const netWorthScore = scoreByBands(state.netWorthWan, [
    [-100, 0], [0, 20], [50, 35], [100, 45], [300, 60], [500, 70], [1000, 82], [3000, 94], [10000, 100]
  ]);
  const cashFlowScore = scoreByBands(state.annualDisposableIncomeWan, [
    [-20, 0], [0, 30], [10, 45], [30, 60], [60, 75], [100, 85], [200, 95], [500, 100]
  ]);
  const stabilityScore: Record<IncomeStability, number> = {
    unstable: 20, volatile: 40, stable: 70, very_stable: 90
  };
  const monthlyExpense = state.annualCoreExpenseWan / 12;
  const liquidityMonths = monthlyExpense > 0 ? Math.max(0, state.cashWan) / monthlyExpense : 24;
  const liquidityScore = scoreByBands(liquidityMonths, [[0, 10], [3, 40], [6, 60], [12, 80], [24, 100]]);
  const debtRatio = state.annualAfterTaxIncomeWan > 0
    ? state.totalDebtWan / Math.max(state.annualAfterTaxIncomeWan * 5, 1)
    : state.totalDebtWan > 0 ? 1 : 0;
  const debtSafetyScore = scoreByBands(1 - clamp(debtRatio, 0, 1), [[0, 0], [0.2, 20], [0.5, 50], [0.8, 80], [1, 100]]);
  return clamp(Math.round(
    netWorthScore * 0.3
      + cashFlowScore * 0.25
      + stabilityScore[state.incomeStability] * 0.2
      + liquidityScore * 0.15
      + debtSafetyScore * 0.1
  ), 0, 100);
}

export function withCalculatedWealth(
  attributes: LifeAttributes,
  financialState: FinancialState,
  previousWealth?: number,
  maxOrdinaryDelta = 12
): LifeAttributes {
  const calculated = deriveWealthScore(financialState);
  const wealth = typeof previousWealth === "number"
    ? clamp(calculated, previousWealth - maxOrdinaryDelta, previousWealth + maxOrdinaryDelta)
    : calculated;
  return { ...attributes, wealth: clamp(Math.round(wealth), 0, 100) };
}

export function formatNetWorthWan(value: number): string {
  if (Math.abs(value) >= 10000) {
    const yi = value / 10000;
    return `${Number.isInteger(yi) ? yi.toFixed(0) : yi.toFixed(1)}亿`;
  }
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : roundMoney(value);
  return `${rounded}万`;
}

export function formatFinancialStateForPrompt(state?: FinancialState): string {
  if (!state) return "暂无结构化财务快照";
  return [
    `累计净财富：${state.netWorthWan} 万元（${state.isEstimated ? "估算" : "已确认"}）`,
    `现金及存款：${state.cashWan} 万元`,
    `投资资产：${state.investmentAssetsWan} 万元`,
    `房产市值：${state.propertyMarketValueWan} 万元`,
    `企业及其他资产：${state.businessAndOtherAssetsWan} 万元`,
    `总负债：${state.totalDebtWan} 万元`,
    `当前工作状态：${state.employmentStatus || "unknown"}`,
    `年税后收入：${state.annualAfterTaxIncomeWan} 万元`,
    `年可支配收入：${state.annualDisposableIncomeWan} 万元`,
    `收入稳定性：${state.incomeStability}`
  ].join("\n- ");
}
