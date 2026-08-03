import type { EmploymentStatus, EmploymentTransitionProposal, ResidenceOccupancyChange, WorldDelta } from "../types";
import { normalizeExpenseResponsibilityChange } from "./expenseResponsibilityOutcome";

export interface WorldDeltaNormalizationAudit {
  index: number;
  reasonCode: "DELTA_TYPE_NORMALIZED" | "EMPLOYMENT_TRANSITION_FLATTENED" | "EMPLOYMENT_TRANSITION_DROPPED" | "PENDING_EMPLOYER_OFFER_RESOLUTION_FLATTENED" | "PENDING_EMPLOYER_OFFER_RESOLUTION_DROPPED" | "EMPLOYMENT_STATUS_MAPPED" | "SOURCE_OUTCOME_FILLED" | "RESIDENCE_CHANGE_FLATTENED" | "RESIDENCE_CHANGE_DROPPED" | "EXPENSE_RESPONSIBILITY_FLATTENED" | "EXPENSE_RESPONSIBILITY_DROPPED";
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
  "person_status", "person_role", "relationship_change", "career_state", "health_state", "expense_responsibility", "location_change"
]);

const RESIDENCE_LIVING_ARRANGEMENTS = new Set<ResidenceOccupancyChange["livingArrangement"]>([
  "renting", "owner_occupied", "with_family", "provided"
]);
const RESIDENCE_FINANCIAL_SCOPES = new Set<ResidenceOccupancyChange["financialScope"]>([
  "personal", "shared_household", "business_operating", "third_party"
]);
const RESIDENCE_LIABILITIES = new Set<ResidenceOccupancyChange["liability"]>([
  "protagonist", "shared", "third_party", "none"
]);

function normalizeResidenceChange(raw: unknown): ResidenceOccupancyChange | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Record<string, unknown>;
  const livingArrangement = candidate.livingArrangement;
  const financialScope = candidate.financialScope;
  const liability = candidate.liability;
  if (
    !RESIDENCE_LIVING_ARRANGEMENTS.has(livingArrangement as ResidenceOccupancyChange["livingArrangement"])
    || !RESIDENCE_FINANCIAL_SCOPES.has(financialScope as ResidenceOccupancyChange["financialScope"])
    || !RESIDENCE_LIABILITIES.has(liability as ResidenceOccupancyChange["liability"])
  ) return undefined;
  const evidence = typeof candidate.evidence === "string" && candidate.evidence.trim()
    ? candidate.evidence.trim()
    : undefined;
  return {
    livingArrangement: livingArrangement as ResidenceOccupancyChange["livingArrangement"],
    financialScope: financialScope as ResidenceOccupancyChange["financialScope"],
    liability: liability as ResidenceOccupancyChange["liability"],
    ...(evidence ? { evidence } : {})
  };
}

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
    if (rawType === "career_state" && !source.pendingEmployerOfferResolution && payload?.pendingEmployerOfferResolution) {
      source.pendingEmployerOfferResolution = payload.pendingEmployerOfferResolution;
      audit.push({ index, reasonCode: "PENDING_EMPLOYER_OFFER_RESOLUTION_FLATTENED" });
    }
    if (rawType === "location_change" && !source.residence && payload?.residence) {
      source.residence = payload.residence;
      audit.push({ index, reasonCode: "RESIDENCE_CHANGE_FLATTENED" });
    }
    if (rawType === "expense_responsibility" && !source.responsibility && payload?.responsibility) {
      source.responsibility = payload.responsibility;
      audit.push({ index, reasonCode: "EXPENSE_RESPONSIBILITY_FLATTENED" });
    }
    const rawTransition = source.employmentTransition;
    const transition = rawTransition && typeof rawTransition === "object" && !Array.isArray(rawTransition)
      ? rawTransition as Record<string, any>
      : undefined;
    if (rawTransition !== undefined && !transition) {
      // Model output is untrusted.  In particular, a boolean `true` used as a
      // shorthand for a career change used to reach the sourceOutcomeId
      // backfill below and throw while mutating the primitive.  Preserve the
      // ordinary career delta, but never carry an invalid transition forward.
      delete source.employmentTransition;
      audit.push({ index, reasonCode: "EMPLOYMENT_TRANSITION_DROPPED" });
    }
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
    const rawPendingOfferResolution = source.pendingEmployerOfferResolution;
    const pendingOfferResolution = rawPendingOfferResolution && typeof rawPendingOfferResolution === "object" && !Array.isArray(rawPendingOfferResolution)
      ? rawPendingOfferResolution as Record<string, unknown>
      : undefined;
    if (rawPendingOfferResolution !== undefined && !pendingOfferResolution) {
      delete source.pendingEmployerOfferResolution;
      audit.push({ index, reasonCode: "PENDING_EMPLOYER_OFFER_RESOLUTION_DROPPED" });
    }
    if (pendingOfferResolution && (!pendingOfferResolution.sourceOutcomeId || pendingOfferResolution.sourceOutcomeId === null) && onlyOutcomeId) {
      pendingOfferResolution.sourceOutcomeId = onlyOutcomeId;
      audit.push({ index, reasonCode: "SOURCE_OUTCOME_FILLED", normalizedValue: onlyOutcomeId });
    }
    if (rawType === "location_change" && source.residence !== undefined) {
      const residence = normalizeResidenceChange(source.residence);
      if (residence) source.residence = residence;
      else {
        delete source.residence;
        audit.push({ index, reasonCode: "RESIDENCE_CHANGE_DROPPED" });
      }
    }
    if (rawType === "expense_responsibility") {
      const normalized = normalizeExpenseResponsibilityChange({
        raw: source.responsibility,
        acceptedOutcomeId: onlyOutcomeId
      });
      if (!normalized.responsibility) {
        audit.push({ index, reasonCode: "EXPENSE_RESPONSIBILITY_DROPPED" });
        return [];
      }
      source.responsibility = normalized.responsibility;
      source.summary = typeof source.summary === "string" && source.summary.trim()
        ? source.summary.trim()
        : normalized.responsibility.evidence;
      if (normalized.sourceOutcomeFilled) {
        audit.push({ index, reasonCode: "SOURCE_OUTCOME_FILLED", normalizedValue: onlyOutcomeId });
      }
    }
    const { deltaType: _deltaType, payload: _payload, ...rest } = source;
    return [{ ...rest, type: rawType } as WorldDelta];
  });
  return { worldDeltas, audit };
}
