import type { IncomeSource } from "./types";

/**
 * Age and elapsed time may request a review, but they are not evidence that an
 * accepted salary stopped.  Hard resolution is reserved for non-authoritative
 * income or for a source that no longer belongs to the current CareerState.
 */
export function requiresHardLateLifeCareerIncomeResolution(input: {
  source: IncomeSource;
  currentCareerStateId?: string;
}): boolean {
  const { source, currentCareerStateId } = input;
  if (source.status !== "active" || !source.linkedCareerStateId || source.accrualPolicy === "event_only") {
    return false;
  }
  if (source.factStatus !== "known") return true;
  return Boolean(currentCareerStateId && source.linkedCareerStateId !== currentCareerStateId);
}
