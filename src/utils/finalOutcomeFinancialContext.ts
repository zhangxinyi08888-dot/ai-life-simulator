import type { HistoryItem } from "../types";
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

export function getAuthoritativeFinalFinancialContext(history: HistoryItem[]): AuthoritativeFinalFinancialContext {
  const latest = history.at(-1);
  const ledger = latest?.financialLedger;
  const periodSummary = latest?.financialPeriodSummary;
  if (!ledger) return { periodSummary, hasBusinessValueNeedsReview: false, allowedWanValues: [], narrativeAuthority: undefined };
  const employmentStatus = latest.worldStateSnapshot?.currentEmploymentStatus || latest.financialState?.employmentStatus || "not_working";
  const state = deriveFinancialState({ ledger, periodSummary, employmentStatus }).state;
  const narrativeAuthority = deriveFinalFinancialNarrativeAuthority(history);
  return {
    state,
    periodSummary,
    hasBusinessValueNeedsReview: ledger.businessHoldings.some((holding) => holding.factStatus === "needs_review"),
    allowedWanValues: narrativeAuthority?.numericClaims.map((claim) => claim.valueWan) ?? [],
    narrativeAuthority
  };
}
