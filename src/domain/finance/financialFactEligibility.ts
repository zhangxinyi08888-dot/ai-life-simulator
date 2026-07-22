import type { DebtAccount, FinancialEvidence } from "./types";

const AUTHORITATIVE_SOURCES = new Set(["user", "accepted_history", "accepted_simulation_outcome"]);

function hasAuthoritativeEvidence(value: { evidence: FinancialEvidence[] }): boolean {
  return value.evidence.some((item) => AUTHORITATIVE_SOURCES.has(item.source));
}

export function isNarrativeEligibleFinancialFact(value: { factStatus: string; evidence: FinancialEvidence[] }): boolean {
  return (value.factStatus === "known" || value.factStatus === "estimated")
    && hasAuthoritativeEvidence(value);
}

export const isReportEligibleFinancialFact = isNarrativeEligibleFinancialFact;

export function isDebtCrisisEligibleAccount(value: DebtAccount): boolean {
  return (value.status === "active" || value.status === "defaulted")
    && (value.origin === "system_auto_shortfall" || isNarrativeEligibleFinancialFact(value));
}
