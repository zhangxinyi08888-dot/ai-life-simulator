import assert from "node:assert/strict";
import {
  DEFAULT_FINANCIAL_NODE_GATE_MODE,
  DEFAULT_EXPENSE_LIFECYCLE_MODE,
  DEFAULT_EXPENSE_NARRATIVE_BINDING_MODE,
  compatibleExpenseNarrativeBindingMode,
  resolveFinancialNodeGateMode,
  resolveExpenseLifecycleMode,
  resolveExpenseNarrativeBindingMode
} from "./financialGatePolicy";

assert.equal(resolveFinancialNodeGateMode("off"), "off");
assert.equal(resolveFinancialNodeGateMode("shadow"), "shadow");
assert.equal(resolveFinancialNodeGateMode("enforced"), "enforced");
assert.equal(resolveFinancialNodeGateMode(undefined), "enforced");
assert.equal(resolveFinancialNodeGateMode("unexpected"), "enforced");
assert.equal(
  DEFAULT_FINANCIAL_NODE_GATE_MODE,
  "enforced",
  "an unconfigured production build must reject a blocking financial Preview"
);

assert.equal(resolveExpenseLifecycleMode("off"), "off");
assert.equal(resolveExpenseLifecycleMode("shadow"), "shadow");
assert.equal(resolveExpenseLifecycleMode("enforced"), "enforced");
assert.equal(resolveExpenseLifecycleMode(undefined), "enforced");
assert.equal(resolveExpenseLifecycleMode("unexpected"), "enforced");
assert.equal(
  DEFAULT_EXPENSE_LIFECYCLE_MODE,
  "enforced",
  "an unconfigured production build must write the accepted V4 lifecycle plan"
);

assert.equal(resolveExpenseNarrativeBindingMode("legacy"), "legacy");
assert.equal(resolveExpenseNarrativeBindingMode("shadow"), "shadow");
assert.equal(resolveExpenseNarrativeBindingMode("enforced"), "enforced");
assert.equal(resolveExpenseNarrativeBindingMode(undefined), "enforced");
assert.equal(resolveExpenseNarrativeBindingMode("unexpected"), "enforced");
assert.equal(DEFAULT_EXPENSE_NARRATIVE_BINDING_MODE, "enforced");

assert.equal(compatibleExpenseNarrativeBindingMode({
  expenseLifecycleMode: "off",
  expenseNarrativeBindingMode: "enforced"
}), "legacy");
assert.equal(compatibleExpenseNarrativeBindingMode({
  expenseLifecycleMode: "shadow",
  expenseNarrativeBindingMode: "enforced"
}), "shadow");
assert.equal(compatibleExpenseNarrativeBindingMode({
  expenseLifecycleMode: "shadow",
  expenseNarrativeBindingMode: "shadow"
}), "shadow");
assert.equal(compatibleExpenseNarrativeBindingMode({
  expenseLifecycleMode: "enforced",
  expenseNarrativeBindingMode: "legacy"
}), "legacy");
assert.equal(compatibleExpenseNarrativeBindingMode({
  expenseLifecycleMode: "enforced",
  expenseNarrativeBindingMode: "enforced"
}), "enforced");
