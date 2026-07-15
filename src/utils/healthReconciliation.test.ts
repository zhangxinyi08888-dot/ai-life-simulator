import assert from "node:assert/strict";
import { reconcileHealth } from "./healthReconciliation";

assert.equal(reconcileHealth(60, 42, "depleted", false), 54);
assert.equal(reconcileHealth(60, 42, "depleted", true), 48);
assert.equal(reconcileHealth(60, 40, "protected", false), 58);
assert.equal(reconcileHealth(60, 70, "neutral", false), 66);
assert.equal(reconcileHealth(60, 75, "depleted", false), 62);
assert.equal(reconcileHealth(98, 120, "protected", false), 100);
assert.equal(reconcileHealth(3, -20, "neutral", false), 0);
assert.equal(reconcileHealth(60, Number.NaN, "neutral", false), 60);
