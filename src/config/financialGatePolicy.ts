export type FinancialNodeGateMode = "off" | "shadow" | "enforced";

export function resolveFinancialNodeGateMode(value: unknown): FinancialNodeGateMode {
  // Phase 4 shadow telemetry has been retained as an explicit rollout mode,
  // but an unconfigured application must not silently let a blocking Preview
  // commit.  Production and ordinary local runs now exercise the same
  // reject-with-zero-state-change contract; operators can still choose shadow
  // deliberately via VITE_FINANCIAL_NODE_GATE_MODE or the dev query parameter.
  return value === "off" || value === "shadow" || value === "enforced" ? value : "enforced";
}

export const DEFAULT_FINANCIAL_NODE_GATE_MODE: FinancialNodeGateMode = resolveFinancialNodeGateMode(
  (import.meta as ImportMeta & { env?: ImportMetaEnv }).env?.VITE_FINANCIAL_NODE_GATE_MODE
);

export const FINANCIAL_GATE_MAX_REGENERATIONS = 2;

/**
 * The expense reconciler has its own rollout switch.  The generic financial
 * acceptance gate still protects its existing critical facts in every mode;
 * this switch only controls whether newly derived V4 expense plans become
 * authoritative.
 */
export type ExpenseLifecycleMode = "off" | "shadow" | "enforced";

export function resolveExpenseLifecycleMode(value: unknown): ExpenseLifecycleMode {
  // Shadow remains an explicit rollout choice, not the default authority
  // contract.  Once V4 is released, silently dropping family, housing, or
  // healthcare responsibilities in an unconfigured environment would defeat
  // the acceptance-gate guarantee.
  return value === "off" || value === "shadow" || value === "enforced" ? value : "enforced";
}

export const DEFAULT_EXPENSE_LIFECYCLE_MODE: ExpenseLifecycleMode = resolveExpenseLifecycleMode(
  (import.meta as ImportMeta & { env?: ImportMetaEnv }).env?.VITE_EXPENSE_LIFECYCLE_MODE
);
