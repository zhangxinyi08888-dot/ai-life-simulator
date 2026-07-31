import type { HistoryItem, WorldStateSnapshot } from "../types";
import type { LifeEventSeed } from "../data/lifeEvents";
import { PHASE2_LIFE_EVENTS } from "../data/phase2LifeEvents";

interface DebtEscalationWorldState {
  pressureArcs?: Array<{
    id: string;
    phasePolicyId: string;
    status: string;
  }>;
  foregroundPressureArcId?: string;
}

export interface DebtEscalationQueryInput {
  history: Array<Pick<HistoryItem, "debtHealthState" | "worldStateSnapshot">>;
  worldState?: DebtEscalationWorldState | WorldStateSnapshot;
}

function latestReliableDebtHealth(input: DebtEscalationQueryInput) {
  return [...input.history].reverse().find((item) => (
    item.debtHealthState?.source === "authoritative_ledger"
  ))?.debtHealthState;
}

function latestWorldState(input: DebtEscalationQueryInput): DebtEscalationWorldState | undefined {
  return input.worldState
    ?? [...input.history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot;
}

/**
 * Debt crisis entry is deterministic and intentionally bypasses the random
 * candidate pool. Eligibility is based only on the last committed,
 * authoritative debt-health snapshot and the committed foreground Arc state.
 */
export function queryDebtEscalationEvent(input: DebtEscalationQueryInput): LifeEventSeed | undefined {
  const debtHealth = latestReliableDebtHealth(input);
  if (!debtHealth || !["default_risk", "defaulted"].includes(debtHealth.level)) return undefined;

  const worldState = latestWorldState(input);
  const pressureArcs = worldState?.pressureArcs ?? [];
  const foregroundArc = worldState?.foregroundPressureArcId
    ? pressureArcs.find((arc) => arc.id === worldState.foregroundPressureArcId)
    : undefined;
  if (foregroundArc && foregroundArc.status !== "resolved") return undefined;

  const hasExistingDebtArc = pressureArcs.some((arc) => (
    arc.phasePolicyId === "financial_debt_v1" && arc.status !== "resolved"
  ));
  if (hasExistingDebtArc) return undefined;

  return PHASE2_LIFE_EVENTS.find((event) => event.id === "financial_payment_strain");
}
