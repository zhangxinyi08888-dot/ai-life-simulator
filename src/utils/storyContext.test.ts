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
    attributes,
    choices: [{ id: "A", text: "继续推进", impactSummary: "继续推进" }],
    isEndingNode: false
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

const interestUserData: Partial<UserInitialData> = {
  regressionAge: 18,
  regressionSituation: "高考填报志愿时，我对植物感兴趣，也想过学生物相关专业。",
  regressionChoices: "想看看如果按兴趣填志愿会怎样",
  coreStoryFocus: "career",
  milestoneCareer: "后来选择了互联网运营方向。"
};

const interestHistory = [
  historyItem(22, "运营实习", "你进入本地生活平台做运营，开始接触商家增长。"),
  historyItem(24, "平台转正", "你负责社区活动和用户增长，植物没有再成为主要选择。"),
  historyItem(27, "小团队管理", "你带着两个人做城市项目，工作重点变成现金流和团队协作。"),
  historyItem(30, "社区服务创业", "你决定围绕社区服务做创业，不再纠结当年的专业兴趣。"),
  historyItem(31, "合伙磨合", "你和合伙人讨论本地服务的获客成本。")
];

const interestPack = buildStoryContextPack(interestUserData, [], interestHistory);
const interestFormatted = formatStoryContextPack(interestPack);

assert.ok(interestPack.interestSignals.some((fact) => fact.text.includes("植物")));
assert.ok(interestPack.stageFacts.some((fact) => fact.text.includes("高考填报志愿")));
const plantInterest = interestPack.interestSignals.find((fact) => fact.text.includes("植物"));
assert.equal(plantInterest?.promotedToArc, false);
assert.equal(plantInterest?.reinforcementCount, 0);
assert.ok((plantInterest?.currentWeight ?? 1) < 0.45);
assert.match(interestFormatted, /兴趣倾向/);
assert.match(interestFormatted, /早期兴趣若最近历史没有强化/);
assert.match(interestFormatted, /不得自动升级为职业、创业方向或终身主线/);

const reinforcedPack = buildStoryContextPack(
  interestUserData,
  [],
  [
    historyItem(19, "植物社团", "你加入植物社团，开始系统学习植物养护。"),
    historyItem(22, "农业科技实习", "你进入农业科技公司，继续围绕植物方向积累经验。"),
    historyItem(25, "园艺项目", "你选择参与社区园艺项目，把植物兴趣变成真实工作。")
  ]
);
const reinforcedPlantInterest = reinforcedPack.interestSignals.find((fact) => fact.text.includes("植物"));
assert.equal(reinforcedPlantInterest?.promotedToArc, true);
assert.ok((reinforcedPlantInterest?.currentWeight ?? 0) >= 0.75);
