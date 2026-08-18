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
  // An adjustment that moves an existing source to the accepted next
  // CareerState is itself the atomic replacement: it closes the old role and
  // opens the same source under the new role.  A model-provided end/pause for
  // that same id would otherwise run after the adjustment and silently leave
  // the new CareerState with zero active income.
  const migratedIncomeSourceIds = new Set(input.proposals.flatMap((proposal) => {
    if (proposal.kind !== "income_source_adjusted") return [];
    const payload = proposal.payload as {
      incomeSourceId?: unknown;
      nextSource?: { linkedCareerStateId?: unknown };
    };
    return typeof payload.incomeSourceId === "string"
      && payload.nextSource?.linkedCareerStateId === input.transition!.nextCareerState.id
      ? [payload.incomeSourceId]
      : [];
  }));
  const proposals = input.proposals.filter((proposal) => {
    if (proposal.kind !== "income_source_ended" && proposal.kind !== "income_source_paused") return true;
    const incomeSourceId = (proposal.payload as { incomeSourceId?: unknown }).incomeSourceId;
    return typeof incomeSourceId !== "string" || !migratedIncomeSourceIds.has(incomeSourceId);
  });
  const settledIds = new Set(proposals.flatMap((proposal) => {
    if (proposal.kind !== "income_source_ended" && proposal.kind !== "income_source_paused" && proposal.kind !== "income_source_adjusted") return [];
    const incomeSourceId = (proposal.payload as { incomeSourceId?: unknown }).incomeSourceId;
    return typeof incomeSourceId === "string" ? [incomeSourceId] : [];
  }));
  const evidence = input.transition.evidence.find((item) => item.excerpt)?.excerpt;
  if (!evidence) return proposals;
  const additions: FinancialEventProposal[] = input.currentLedger.incomeSources
    .filter((source) => source.status === "active"
      && source.linkedCareerStateId === input.currentCareerStateId
      && (source.activeUntilAgeInMonths === undefined
        || source.activeUntilAgeInMonths > input.transition!.effectiveAtAgeInMonths)
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
  return [...proposals, ...additions];
}
