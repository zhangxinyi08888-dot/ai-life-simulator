import assert from "node:assert/strict";
import test from "node:test";
import { applyLifeStageExpenseLifecycle, detectLifeStageExpenseTriggers } from "./lifeStageExpenseLifecycle";

test("lifecycle is candidate-only: narrative cannot directly manufacture Accepted events", () => {
  const result = applyLifeStageExpenseLifecycle({
    narrativeText: "你们迎来孩子，正式开始承担育儿责任。你开始长期治疗，每月复诊。",
    ageInMonths: 372
  });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.coveredTriggerCount, 0);
  assert.equal("acceptedEvents" in result, false);
});

test("plans and third-party workshop responsibilities remain candidates or ignored by reconciliation, not personal events", () => {
  assert.deepEqual(detectLifeStageExpenseTriggers("你们计划明年生孩子，也考虑租一间办公室。"), []);
  const workshop = detectLifeStageExpenseTriggers("你租下木工坊作为公司工作室。");
  assert.equal(workshop[0]?.financialScope, "business_operating");
});
