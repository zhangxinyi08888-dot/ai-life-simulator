import type { FinalLifeOutcome, HistoryItem } from "../types";
import { deriveFinancialState } from "../domain/finance/deriveFinancialState";
import type { DerivedFinancialStateV2, FinancialPeriodSummary } from "../domain/finance/types";
import {
  deriveFinalFinancialNarrativeAuthority,
  type FinalFinancialNarrativeAuthority
} from "./finalFinancialNarrativeAuthority";

export interface AuthoritativeFinalFinancialContext {
  state?: DerivedFinancialStateV2;
  periodSummary?: FinancialPeriodSummary;
  hasBusinessValueNeedsReview: boolean;
  allowedWanValues: number[];
  narrativeAuthority?: FinalFinancialNarrativeAuthority;
}

function finiteValues(record: Record<string, unknown>): number[] {
  return Object.values(record).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function getAuthoritativeFinalFinancialContext(history: HistoryItem[]): AuthoritativeFinalFinancialContext {
  const latest = history.at(-1);
  const ledger = latest?.financialLedger;
  const periodSummary = latest?.financialPeriodSummary;
  if (!ledger) return { periodSummary, hasBusinessValueNeedsReview: false, allowedWanValues: [], narrativeAuthority: undefined };
  const employmentStatus = latest.worldStateSnapshot?.currentEmploymentStatus || latest.financialState?.employmentStatus || "not_working";
  const state = deriveFinancialState({ ledger, periodSummary, employmentStatus }).state;
  const narrativeAuthority = deriveFinalFinancialNarrativeAuthority(history);
  const allowedWanValues = narrativeAuthority?.numericClaims.map((claim) => claim.valueWan) ?? [];
  return {
    state,
    periodSummary,
    hasBusinessValueNeedsReview: ledger.businessHoldings.some((holding) => holding.factStatus === "needs_review"),
    allowedWanValues,
    narrativeAuthority
  };
}

function amountToWan(amount: number, unit: string): number {
  return unit.startsWith("元") ? amount / 10_000 : amount;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.01, Math.abs(right) * 0.001);
}

const INTERNAL_PLACEHOLDER_PATTERN = /金额待账本确认|回报幅度待账本确认|回报率待账本确认|价值待确认|账本确认/u;
const ORPHAN_FINANCIAL_AMOUNT_PATTERN = /(?:负债|债务|净资产|现金|收入|支出)\s*-?\d+(?:\.\d+)?\s*(?:…|\.{2,})/u;
const MONEY_PATTERN = /-?\d+(?:\.\d+)?\s*(?:万元|万|元)(?:人民币)?/gu;
const UNSUPPORTED_RETURN_PATTERN = /\d+(?:\.\d+)?\s*倍(?:的)?(?:投资)?回报|(?:回报率|收益率)(?:达到|为|约为|超过)?\s*\d+(?:\.\d+)?%/u;

function qualitativeFallback(path: string): string {
  return path.endsWith("viralTitle")
    ? "我在现实起伏中重新安排了生活"
    : "财务现实仍在变化，你选择按已经发生的事实继续安排生活。";
}

function canonicalMoney(match: string, context: AuthoritativeFinalFinancialContext): string | undefined {
  const parsed = match.match(/(-?\d+(?:\.\d+)?)\s*(万元|万|元)/u);
  if (!parsed) return undefined;
  const amountWan = amountToWan(Number(parsed[1]), parsed[2]);
  const claim = context.narrativeAuthority?.numericClaims.find((candidate) => closeEnough(candidate.valueWan, amountWan));
  if (!claim) return undefined;
  if (parsed[2] === "元") return `${Math.round(claim.valueWan * 10_000)}元`;
  return parsed[2] === "万元" ? `${claim.displayText}元` : claim.displayText;
}

function sanitizeSegment(segment: string, context: AuthoritativeFinalFinancialContext, path: string): string {
  if (INTERNAL_PLACEHOLDER_PATTERN.test(segment)
    || ORPHAN_FINANCIAL_AMOUNT_PATTERN.test(segment)
    || UNSUPPORTED_RETURN_PATTERN.test(segment)
    || (context.hasBusinessValueNeedsReview
      && /公司|企业|创业|股权|期权/u.test(segment)
      && /估值|市值|价值|获利|回报/u.test(segment))) {
    return qualitativeFallback(path);
  }
  let invalidAmount = false;
  const canonicalized = segment.replace(MONEY_PATTERN, (match) => {
    const replacement = canonicalMoney(match, context);
    if (!replacement) {
      invalidAmount = true;
      return match;
    }
    return replacement;
  });
  return invalidAmount ? qualitativeFallback(path) : canonicalized;
}

function sanitizeText(text: string, context: AuthoritativeFinalFinancialContext, path: string): string {
  if (path.endsWith("viralTitle") || path.endsWith("covenantTitle")) {
    return sanitizeSegment(text, context, path);
  }
  return (text.match(/[^。！？\n]+[。！？]?|\n+/gu) || [text])
    .map((segment) => /^\n+$/u.test(segment) ? segment : sanitizeSegment(segment, context, path))
    .join("");
}

function sanitizeUnknown(value: unknown, context: AuthoritativeFinalFinancialContext, path = ""): unknown {
  if (typeof value === "string") return sanitizeText(value, context, path);
  if (Array.isArray(value)) return value.map((item, index) => sanitizeUnknown(item, context, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeUnknown(item, context, path ? `${path}.${key}` : key)]));
  }
  return value;
}

export function sanitizeFinalOutcomeFinancialClaims(
  outcome: FinalLifeOutcome,
  history: HistoryItem[]
): FinalLifeOutcome {
  return sanitizeUnknown(outcome, getAuthoritativeFinalFinancialContext(history)) as FinalLifeOutcome;
}
