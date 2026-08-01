import assert from "node:assert/strict";
import {
  DEFAULT_FINANCIAL_NODE_GATE_MODE,
  DEFAULT_EXPENSE_LIFECYCLE_MODE,
  resolveFinancialNodeGateMode,
  resolveExpenseLifecycleMode
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
