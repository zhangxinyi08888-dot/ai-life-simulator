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
  isEndingNode: false,
  eventMeta: { eventId: "career-crossroad", eventCategory: "career", eventTags: ["job"] }
};

const item = createHistoryItemFromNode(node, "去外地接受新机会");
assert.deepEqual(item.choices, choices);
assert.equal(item.isEndingNode, false);
assert.equal(item.selectedChoice, "去外地接受新机会");

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

assert.throws(() => restoreHistoryNodeAtIndex([earlier], -1), /HISTORY_RESTORE_INDEX_OUT_OF_RANGE/);
assert.throws(() => restoreHistoryNodeAtIndex([earlier], 1), /HISTORY_RESTORE_INDEX_OUT_OF_RANGE/);
