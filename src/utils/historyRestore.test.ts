import assert from "node:assert/strict";
import { HistoryItem, SimulationNode } from "../types";
import { createHistoryItemFromNode, restoreHistoryNodeAtIndex } from "./historyRestore";

const choices = [
  { id: "A", text: "留在本城继续试错", impactSummary: "稳中求变" },
  { id: "B", text: "去外地接受新机会", impactSummary: "异地重启" },
  { id: "C", text: "暂停一年整理方向", impactSummary: "蓄力观察" }
];

const node: SimulationNode = {
  age: 24,
  stage: "职场岔路",
  title: "第一份工作后的摇摆",
  description: "你站在是否离开的节点上。",
  choices,
  attributes: { happiness: 55, intelligence: 63, wealth: 41, relation: 58, health: 72 },
  financialState: {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: 24 * 12,
    cashWan: 20,
    investmentAssetsWan: 10,
    propertyMarketValueWan: 100,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 40,
    netWorthWan: 90,
    annualAfterTaxIncomeWan: 24,
    annualDisposableIncomeWan: 10,
    annualCoreExpenseWan: 14,
    incomeStability: "stable",
    isEstimated: false
  },
  financialChange: {
    periodMonths: 12,
    afterTaxIncomeWan: 24,
    livingExpenseWan: 12,
    medicalEducationExpenseWan: 1,
    interestAndFeesWan: 1,
    assetValueChangeWan: 0,
    otherNetChangeWan: 0,
    netWorthChangeWan: 10,
    reasons: ["稳定工作形成结余"]
  },
  isEndingNode: false,
  eventMeta: { eventId: "career-crossroad", eventCategory: "career", eventTags: ["job"] }
};

const item = createHistoryItemFromNode(node, "去外地接受新机会");
assert.deepEqual(item.choices, choices);
assert.equal(item.isEndingNode, false);
assert.equal(item.selectedChoice, "去外地接受新机会");
assert.equal(item.selectedDecisionIntent, "去外地接受新机会");
assert.equal(item.financialState?.netWorthWan, 90);

const explicitIntentItem = createHistoryItemFromNode({
  ...node,
  choices: node.choices.map((choice) => choice.id === "B"
    ? { ...choice, decisionIntent: "location:relocate_to:another_city" }
    : choice)
}, "去外地接受新机会");
assert.equal(explicitIntentItem.selectedDecisionIntent, "location:relocate_to:another_city");

const customIntentItem = createHistoryItemFromNode(node, "先远程试住三个月");
assert.equal(customIntentItem.selectedDecisionIntent, "先远程试住三个月");

const earlier: HistoryItem = createHistoryItemFromNode(
  { ...node, age: 23, title: "前一个节点" },
  "继续推进"
);
const sameAgeLater: HistoryItem = createHistoryItemFromNode(
  { ...node, title: "同岁但不同节点", description: "同一年发生的另一个转折。" },
  "暂停一年整理方向"
);

const restored = restoreHistoryNodeAtIndex([earlier, item, sameAgeLater], 2);
assert.equal(restored.node.age, 24);
assert.equal(restored.node.title, "同岁但不同节点");
assert.equal(restored.node.description, "同一年发生的另一个转折。");
assert.deepEqual(restored.node.choices, choices);
assert.deepEqual(restored.historyBefore, [earlier, item]);
assert.equal(restored.nodeCount, 3);
assert.equal(restored.node.financialState?.netWorthWan, 90);

assert.throws(() => restoreHistoryNodeAtIndex([earlier], -1), /HISTORY_RESTORE_INDEX_OUT_OF_RANGE/);
assert.throws(() => restoreHistoryNodeAtIndex([earlier], 1), /HISTORY_RESTORE_INDEX_OUT_OF_RANGE/);
