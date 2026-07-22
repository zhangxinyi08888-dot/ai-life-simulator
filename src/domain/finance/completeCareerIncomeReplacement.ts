import type { AcceptedCareerTransition } from "../career/types";
import type { FinancialEventProposal, FinancialLedger } from "./types";

/**
 * An accepted CareerTransition is authoritative proof that the previous role
 * ended. Complete only the missing settlement events for income sources owned
 * by that old CareerState; never invent the next role's income or amount.
 */
export function completeCareerIncomeReplacementProposals(input: {
  proposals: FinancialEventProposal[];
  currentLedger: FinancialLedger;
  currentCareerStateId: string;
  transition?: AcceptedCareerTransition;
  acceptedOutcomeId?: string;
}): FinancialEventProposal[] {
  if (!input.transition || !input.acceptedOutcomeId
    || input.transition.fromCareerStateId !== input.currentCareerStateId) return input.proposals;
  const settledIds = new Set(input.proposals.flatMap((proposal) => {
    if (proposal.kind !== "income_source_ended" && proposal.kind !== "income_source_paused" && proposal.kind !== "income_source_adjusted") return [];
    const incomeSourceId = (proposal.payload as { incomeSourceId?: unknown }).incomeSourceId;
    return typeof incomeSourceId === "string" ? [incomeSourceId] : [];
  }));
  const evidence = input.transition.evidence.find((item) => item.excerpt)?.excerpt;
  if (!evidence) return input.proposals;
  const additions: FinancialEventProposal[] = input.currentLedger.incomeSources
    .filter((source) => source.status === "active"
      && source.linkedCareerStateId === input.currentCareerStateId
      && !settledIds.has(source.id))
    .map((source) => ({
      id: `career_settlement_${input.transition!.proposalId}_${source.id}`,
      kind: "income_source_ended" as const,
      effectiveAtAgeInMonths: input.transition!.effectiveAtAgeInMonths,
      payload: { incomeSourceId: source.id },
      sourceOutcomeId: input.acceptedOutcomeId!,
      evidence,
      confidence: input.transition!.evidence[0]?.confidence ?? 1
    }));
  return [...input.proposals, ...additions];
}
