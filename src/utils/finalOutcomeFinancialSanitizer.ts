import type { FinalLifeOutcome, HistoryItem } from "../types";
import { deriveFinancialState } from "../domain/finance/deriveFinancialState";
import type { DerivedFinancialStateV2, FinancialPeriodSummary } from "../domain/finance/types";

export interface AuthoritativeFinalFinancialContext {
  state?: DerivedFinancialStateV2;
  periodSummary?: FinancialPeriodSummary;
  hasBusinessValueNeedsReview: boolean;
  allowedWanValues: number[];
}

function finiteValues(record: Record<string, unknown>): number[] {
  return Object.values(record).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function getAuthoritativeFinalFinancialContext(history: HistoryItem[]): AuthoritativeFinalFinancialContext {
  const latest = history.at(-1);
  const ledger = latest?.financialLedger;
  const periodSummary = latest?.financialPeriodSummary;
  if (!ledger) return { periodSummary, hasBusinessValueNeedsReview: false, allowedWanValues: periodSummary ? finiteValues(periodSummary as unknown as Record<string, unknown>) : [] };
  const employmentStatus = latest.worldStateSnapshot?.currentEmploymentStatus || latest.financialState?.employmentStatus || "not_working";
  const state = deriveFinancialState({ ledger, periodSummary, employmentStatus }).state;
  const allowedWanValues = [
    ...finiteValues(state as unknown as Record<string, unknown>),
    ...(periodSummary ? finiteValues(periodSummary as unknown as Record<string, unknown>) : [])
  ].filter((value) => value >= 0);
  return {
    state,
    periodSummary,
    hasBusinessValueNeedsReview: ledger.businessHoldings.some((holding) => holding.factStatus === "needs_review"),
    allowedWanValues
  };
}

function amountToWan(amount: number, unit: string): number {
  return unit.startsWith("元") ? amount / 10_000 : amount;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.01, Math.abs(right) * 0.001);
}

function sanitizeText(text: string, context: AuthoritativeFinalFinancialContext): string {
  let next = text.replace(/\d+(?:\.\d+)?\s*(?:万元|万|元)(?:人民币)?/gu, (match) => {
    const parsed = match.match(/(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
    if (!parsed) return match;
    const amountWan = amountToWan(Number(parsed[1]), parsed[2]);
    return context.allowedWanValues.some((value) => closeEnough(value, amountWan)) ? match : "金额待账本确认";
  });
  next = next.replace(/\d+(?:\.\d+)?\s*倍(?:的)?(?:投资)?回报/gu, "回报幅度待账本确认");
  next = next.replace(/(?:回报率|收益率)(?:达到|为|约为|超过)?\s*\d+(?:\.\d+)?%/gu, "回报率待账本确认");
  if (context.hasBusinessValueNeedsReview && /公司|企业|创业|股权|期权/u.test(next) && /估值|市值|价值|获利|回报/u.test(next)) {
    next = next.replace(/(?:估值|市值|价值|获利|回报)(?:达到|为|约为|超过|了)?[^，。；！？]{0,24}/gu, "价值待确认");
  }
  return next;
}

function sanitizeUnknown(value: unknown, context: AuthoritativeFinalFinancialContext): unknown {
  if (typeof value === "string") return sanitizeText(value, context);
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeUnknown(item, context)]));
  }
  return value;
}

export function sanitizeFinalOutcomeFinancialClaims(
  outcome: FinalLifeOutcome,
  history: HistoryItem[]
): FinalLifeOutcome {
  return sanitizeUnknown(outcome, getAuthoritativeFinalFinancialContext(history)) as FinalLifeOutcome;
}
