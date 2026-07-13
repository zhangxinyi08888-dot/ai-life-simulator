import assert from "node:assert/strict";
import type { HistoryItem, SimulationChoice } from "../types";
import { buildChoicePreferenceSignals, normalizeDecisionIntent } from "./choicePreference";

const attributes = { happiness: 50, intelligence: 60, wealth: 45, relation: 55, health: 58 };

const stayInShenzhen: SimulationChoice = {
  id: "A",
  text: "继续留在深圳发展",
  impactSummary: "留深发展",
  decisionIntent: "location:stay_in:shenzhen"
};

const moveToWuhan: SimulationChoice = {
  id: "B",
  text: "接受武汉光谷 offer 并搬迁",
  impactSummary: "迁往武汉",
  decisionIntent: "location:relocate_to:wuhan_guanggu"
};

function historyItem(
  age: number,
  selectedChoice: string,
  choices: SimulationChoice[] = [stayInShenzhen, moveToWuhan]
): HistoryItem {
  return {
    age,
    stage: "职业选择",
    title: "城市与工作选择",
    description: "家庭建议和职业发展出现分歧。",
    selectedChoice,
    attributes,
    choices,
    isEndingNode: false
  };
}

const twicePassedHistory = [
  historyItem(39, stayInShenzhen.text),
  historyItem(40, stayInShenzhen.text)
];

const twicePassedSignals = buildChoicePreferenceSignals(twicePassedHistory);
const wuhanCooldown = twicePassedSignals.find((signal) => signal.decisionIntent === moveToWuhan.decisionIntent);
const shenzhenSelected = twicePassedSignals.find((signal) => signal.decisionIntent === stayInShenzhen.decisionIntent);

assert.equal(wuhanCooldown?.passedOfferCount, 2);
assert.equal(wuhanCooldown?.consecutivePassedOfferCount, 2);
assert.equal(wuhanCooldown?.state, "cooldown");
assert.equal(shenzhenSelected?.selectedCount, 2);
assert.equal(shenzhenSelected?.consecutivePassedOfferCount, 0);
assert.equal(shenzhenSelected?.state, "available");

const neutralChoices: SimulationChoice[] = [
  { id: "A", text: "控制项目强度", impactSummary: "降低负荷", decisionIntent: "career:reduce_load:current_project" },
  { id: "B", text: "争取内部支持", impactSummary: "内部协作", decisionIntent: "career:seek_support:current_team" },
  { id: "C", text: "休假恢复精力", impactSummary: "短期恢复", decisionIntent: "health:take_leave:self" }
];

const afterThreeNeutralNodes = [
  ...twicePassedHistory,
  historyItem(41, neutralChoices[0].text, neutralChoices),
  historyItem(42, neutralChoices[0].text, neutralChoices),
  historyItem(43, neutralChoices[0].text, neutralChoices)
];
const afterCooldown = buildChoicePreferenceSignals(afterThreeNeutralNodes)
  .find((signal) => signal.decisionIntent === moveToWuhan.decisionIntent);

assert.equal(afterCooldown?.passedOfferCount, 2);
assert.equal(afterCooldown?.consecutivePassedOfferCount, 2);
assert.equal(afterCooldown?.state, "available");

const thirdPassHistory = [
  ...afterThreeNeutralNodes,
  historyItem(44, stayInShenzhen.text)
];
const dormantWuhan = buildChoicePreferenceSignals(thirdPassHistory)
  .find((signal) => signal.decisionIntent === moveToWuhan.decisionIntent);

assert.equal(dormantWuhan?.passedOfferCount, 3);
assert.equal(dormantWuhan?.state, "dormant");

const explicitlySelectedHistory = [
  ...thirdPassHistory,
  historyItem(45, `我的自定义决定是：${moveToWuhan.text}`)
];
const restoredWuhan = buildChoicePreferenceSignals(explicitlySelectedHistory)
  .find((signal) => signal.decisionIntent === moveToWuhan.decisionIntent);

assert.equal(restoredWuhan?.selectedCount, 1);
assert.equal(restoredWuhan?.consecutivePassedOfferCount, 0);
assert.equal(restoredWuhan?.state, "available");

assert.equal(
  normalizeDecisionIntent({ id: "C", text: "去一个从未配置过的城市", impactSummary: "迁居尝试" }),
  "去一个从未配置过的城市"
);
assert.equal(
  normalizeDecisionIntent({ id: "A", text: "接受新岗位", impactSummary: "职业变化", decisionIntent: "career:accept_role:architect" }),
  "career:accept_role:architect"
);
assert.equal(
  twicePassedSignals.some((signal) => signal.decisionIntent.includes("beijing")),
  false
);
