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
  process.env.TARO_APP_FINANCIAL_NODE_GATE_MODE
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
  process.env.TARO_APP_EXPENSE_LIFECYCLE_MODE
);

/**
 * Selects the writer for narrative-originated responsibility candidates.  It
 * is deliberately separate from `ExpenseLifecycleMode`: the latter controls
 * whether a reconciled plan becomes authoritative, while this switch controls
 * whether the clause binder or the legacy sentence detector supplies the
 * narrative candidates in the first place.
 */
export type ExpenseNarrativeBindingMode = "legacy" | "shadow" | "enforced";

export function resolveExpenseNarrativeBindingMode(value: unknown): ExpenseNarrativeBindingMode {
  return value === "legacy" || value === "shadow" || value === "enforced" ? value : "enforced";
}

export const DEFAULT_EXPENSE_NARRATIVE_BINDING_MODE: ExpenseNarrativeBindingMode = resolveExpenseNarrativeBindingMode(
  process.env.TARO_APP_EXPENSE_NARRATIVE_BINDING_MODE
);

/**
 * Keep rollout combinations safe even when an operator sets independent
 * environment variables.  A binder must never become the authoritative
 * narrative writer while lifecycle reconciliation itself is only shadowed or
 * disabled.  Normalising down is intentional: it preserves the existing
 * authoritative path and leaves an auditable configuration rather than
 * creating two competing writers.
 */
export function compatibleExpenseNarrativeBindingMode(input: {
  expenseLifecycleMode: ExpenseLifecycleMode;
  expenseNarrativeBindingMode: ExpenseNarrativeBindingMode;
}): ExpenseNarrativeBindingMode {
  if (input.expenseLifecycleMode === "off") return "legacy";
  if (input.expenseLifecycleMode === "shadow" && input.expenseNarrativeBindingMode === "enforced") return "shadow";
  return input.expenseNarrativeBindingMode;
}
