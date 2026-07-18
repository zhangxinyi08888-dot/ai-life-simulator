import type { EmploymentStatus, EmploymentTransitionProposal, WorldDelta } from "../types";

export interface WorldDeltaNormalizationAudit {
  index: number;
  reasonCode: "DELTA_TYPE_NORMALIZED" | "EMPLOYMENT_TRANSITION_FLATTENED" | "EMPLOYMENT_STATUS_MAPPED" | "SOURCE_OUTCOME_FILLED";
  originalValue?: string;
  normalizedValue?: string;
}

const EMPLOYMENT_ALIASES: Record<string, { status: EmploymentStatus; occupation?: string }> = {
  promoted_to_director: { status: "employed", occupation: "director" },
  employed_at_saas: { status: "employed", occupation: "SaaS employee" },
  employed_full_time: { status: "employed" },
  full_time_employed: { status: "employed" },
  freelancer: { status: "self_employed", occupation: "freelancer" },
  entrepreneur: { status: "self_employed", occupation: "entrepreneur" },
  unemployed: { status: "not_working" }
};

const WORLD_DELTA_TYPES = new Set<WorldDelta["type"]>([
  "person_status", "person_role", "relationship_change", "career_state", "health_state", "location_change"
]);

export function normalizeWorldDeltas(input: {
  worldDeltas: unknown;
  acceptedOutcomeIds?: string[];
}): { worldDeltas: WorldDelta[]; audit: WorldDeltaNormalizationAudit[] } {
  if (!Array.isArray(input.worldDeltas)) return { worldDeltas: [], audit: [] };
  const audit: WorldDeltaNormalizationAudit[] = [];
  const onlyOutcomeId = input.acceptedOutcomeIds?.length === 1 ? input.acceptedOutcomeIds[0] : undefined;
  const worldDeltas = input.worldDeltas.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const source = structuredClone(raw) as Record<string, any>;
    const rawType = source.type ?? source.deltaType;
    if (source.type == null && typeof rawType === "string") {
      audit.push({ index, reasonCode: "DELTA_TYPE_NORMALIZED", originalValue: rawType, normalizedValue: rawType });
    }
    if (!WORLD_DELTA_TYPES.has(rawType as WorldDelta["type"])) return [];
    const payload = source.payload && typeof source.payload === "object" ? source.payload : undefined;
    if (rawType === "career_state" && !source.employmentTransition && payload?.employmentTransition) {
      source.employmentTransition = payload.employmentTransition;
      audit.push({ index, reasonCode: "EMPLOYMENT_TRANSITION_FLATTENED" });
    }
    const transition = source.employmentTransition as Record<string, any> | undefined;
    if (transition) {
      const originalStatus = String(transition.toStatus || "");
      const alias = EMPLOYMENT_ALIASES[originalStatus];
      if (alias) {
        transition.toStatus = alias.status;
        transition.occupation ||= alias.occupation;
        audit.push({ index, reasonCode: "EMPLOYMENT_STATUS_MAPPED", originalValue: originalStatus, normalizedValue: alias.status });
      }
      if ((!transition.sourceOutcomeId || transition.sourceOutcomeId === null) && onlyOutcomeId) {
        transition.sourceOutcomeId = onlyOutcomeId;
        audit.push({ index, reasonCode: "SOURCE_OUTCOME_FILLED", normalizedValue: onlyOutcomeId });
      }
    }
    const { deltaType: _deltaType, payload: _payload, ...rest } = source;
    return [{ ...rest, type: rawType } as WorldDelta];
  });
  return { worldDeltas, audit };
}
