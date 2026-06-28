import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../types";
import { buildStoryContextPack, formatStoryContextPack } from "./storyContext";

const attributes: LifeAttributes = {
  happiness: 50,
  intelligence: 60,
  wealth: 45,
  relation: 55,
  health: 58
};

const userData: Partial<UserInitialData> = {
  gender: "女",
  regressionAge: 22,
  regressionSituation: "刚毕业时想离开稳定工作去做设计，但父母强烈反对。",
  regressionChoices: "想试试自由职业",
  coreStoryFocus: "romance",
  milestoneRelationship: "大学时有一段异地恋，后来因为城市选择分开。",
  milestoneCareer: "毕业后进了一家稳定公司。"
};

const answers: QuestionTurn[] = [
  {
    id: 1,
    question: "当时真实发生了什么？",
    answer: "我爸妈希望我稳定，不支持我冒险辞职。"
  },
  {
    id: 2,
    question: "当时你怎么反应？",
    answer: "我表面答应，心里一直想逃。"
  }
];

function historyItem(age: number, title: string, description: string): HistoryItem {
  return {
    age,
    title,
    stage: "测试阶段",
    description,
    selectedChoice: "继续推进",
    attributes
  };
}

const history = [
  historyItem(20, "旧节点一", "早期经历。"),
  historyItem(21, "旧节点二", "更早经历。"),
  historyItem(22, "母亲来电", "母亲反复提醒你不要轻易辞职。"),
  historyItem(23, "城市分岔", "前任问你还会不会留在这座城市。"),
  historyItem(24, "工作拉扯", "稳定工作让你安心，也让你压抑。"),
  historyItem(25, "朋友饭局", "朋友建议你先接小单试试水。")
];

const pack = buildStoryContextPack(userData, answers, history);

assert.deepEqual(
  pack.answerFacts,
  [
    "当时真实发生了什么？：我爸妈希望我稳定，不支持我冒险辞职。",
    "当时你怎么反应？：我表面答应，心里一直想逃。"
  ]
);
assert.equal(pack.recentHistory.length, 5);
assert.equal(pack.recentHistory[0].title, "旧节点二");
assert.ok(pack.userFacts.some((fact) => fact.includes("刚毕业时想离开稳定工作")));
assert.ok(pack.activeThreads.some((thread) => thread.type === "family" && thread.summary.includes("父母")));
assert.ok(pack.activeThreads.some((thread) => thread.type === "romance" && thread.summary.includes("异地恋")));

const formatted = formatStoryContextPack(pack);
assert.match(formatted, /Story Context Pack/);
assert.match(formatted, /追问补全事实/);
assert.match(formatted, /我爸妈希望我稳定/);
assert.match(formatted, /最近 5 个历史节点/);
assert.match(formatted, /当前可延续副线/);
