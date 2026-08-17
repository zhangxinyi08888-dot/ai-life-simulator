import type { ResidenceOccupancyState, WorldDelta } from "../types";

/**
 * Turn a validated, accepted location delta into the persisted residence
 * state.  Callers deliberately invoke this only from the candidate preview or
 * the final simulation transaction, never while examining free-form prose.
 */
export function acceptedResidenceOccupancyState(input: {
  delta: WorldDelta;
  ageInMonths: number;
}): ResidenceOccupancyState | undefined {
  if (input.delta.type !== "location_change" || !input.delta.residence) return undefined;
  const evidence = input.delta.residence.evidence?.trim() || input.delta.summary.trim();
  if (!evidence) return undefined;
  return {
    ...input.delta.residence,
    evidence,
    effectiveFromAgeInMonths: input.ageInMonths,
    source: "accepted_history"
  };
}
