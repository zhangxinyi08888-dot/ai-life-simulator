import { RecoveryState } from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function reconcileHealth(
  previousHealth: number,
  proposedHealth: number,
  recoveryState: RecoveryState,
  isMajorHealthEvent: boolean
): number {
  const safePreviousHealth = clamp(previousHealth, 0, 100);
  const safeProposedHealth = Number.isFinite(proposedHealth) ? proposedHealth : safePreviousHealth;
  const maxDecline = isMajorHealthEvent ? 12 : 6;
  const rawDelta = safeProposedHealth - safePreviousHealth;
  let delta = clamp(rawDelta, -maxDecline, 6);

  if (recoveryState === "protected") {
    delta = Math.max(delta, -2);
  }

  if (recoveryState === "depleted") {
    delta = Math.min(delta, 2);
  }

  return clamp(safePreviousHealth + delta, 0, 100);
}
