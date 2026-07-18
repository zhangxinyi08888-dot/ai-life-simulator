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

function sentenceHasUnsupportedFinancialClaim(text: string, context: AuthoritativeFinalFinancialContext): boolean {
  const unsupportedAmount = [...text.matchAll(/\d+(?:\.\d+)?\s*(?:万元|万|元)(?:人民币)?/gu)].some((match) => {
    const parsed = match[0].match(/(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
    if (!parsed) return false;
    const amountWan = amountToWan(Number(parsed[1]), parsed[2]);
    return !context.allowedWanValues.some((value) => closeEnough(value, amountWan));
  });
  return unsupportedAmount
    || /\d+(?:\.\d+)?\s*倍(?:的)?(?:投资)?回报/gu.test(text)
    || /(?:回报率|收益率)(?:达到|为|约为|超过)?\s*\d+(?:\.\d+)?%/gu.test(text)
    || (context.hasBusinessValueNeedsReview
      && /公司|企业|创业|股权|期权/u.test(text)
      && /估值|市值|价值|获利|回报/u.test(text));
}

function rewriteUnsupportedSentence(text: string, context: AuthoritativeFinalFinancialContext): string {
  if (context.hasBusinessValueNeedsReview && /公司|企业|创业|股权|期权/u.test(text)) {
    return "相关企业权益仍缺少足够的权威估值依据，暂不作具体金额判断";
  }
  return "相关财务变化尚无足够的权威账本依据，暂不作具体金额判断";
}

function sanitizeText(text: string, context: AuthoritativeFinalFinancialContext): string {
  return text
    .split(/([。！？；\n])/u)
    .map((part) => sentenceHasUnsupportedFinancialClaim(part, context)
      ? rewriteUnsupportedSentence(part, context)
      : part)
    .join("")
    .replace(/(?:相关财务变化尚无足够的权威账本依据，暂不作具体金额判断[，、；\s]*){2,}/gu, "相关财务变化尚无足够的权威账本依据，暂不作具体金额判断");
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
