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

function historyItem(age: number, title: string, description: string, selectedChoice = "继续推进"): HistoryItem {
  return {
    age,
    title,
    stage: "测试阶段",
    description,
    selectedChoice,
    attributes,
    choices: [{ id: "A", text: selectedChoice, impactSummary: "继续推进" }],
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

const girlfriendPack = buildStoryContextPack({}, [], [
  historyItem(23, "纪念日失约", "你连续加班错过纪念日，女友因此和你冷战。")
]);
assert.ok(girlfriendPack.activeThreads.some((thread) => thread.type === "romance" && thread.summary.includes("女友")));

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
assert.equal((plantInterest as any)?.userReinforcementCount, 0);
assert.equal((plantInterest as any)?.directionState, "mentioned");
assert.ok(((plantInterest as any)?.consecutiveUnselectedCount ?? 0) >= 5);
assert.ok((plantInterest?.currentWeight ?? 1) < 0.45);
assert.match(interestFormatted, /兴趣倾向/);
assert.match(interestFormatted, /方向线索使用边界/);
assert.match(interestFormatted, /模型正文偶然提及不计入强化/);
assert.match(interestFormatted, /state=mentioned/);

const reinforcedPack = buildStoryContextPack(
  interestUserData,
  [],
  [
    historyItem(19, "植物社团", "你加入植物社团，开始系统学习植物养护。", "系统学习植物学"),
    historyItem(22, "植物科技实习", "你进入植物科技公司，继续围绕植物方向积累经验。", "申请植物科技实习"),
    historyItem(25, "园艺项目", "你选择参与社区园艺项目，把植物兴趣变成真实工作，获得第一批付费用户。", "把植物项目变成收入来源")
  ]
);
const reinforcedPlantInterest = reinforcedPack.interestSignals.find((fact) => fact.text.includes("植物"));
assert.equal(reinforcedPlantInterest?.promotedToArc, true);
assert.equal((reinforcedPlantInterest as any)?.userReinforcementCount, 3);
assert.equal((reinforcedPlantInterest as any)?.directionState, "long_term_main_arc");
assert.ok((reinforcedPlantInterest?.currentWeight ?? 0) >= 0.75);

const modelMentionOnlyPack = buildStoryContextPack(
  interestUserData,
  [],
  [
    historyItem(22, "运营实习", "你在周末路过花市，想起自己曾经喜欢植物。", "继续做平台运营"),
    historyItem(24, "平台转正", "办公室窗台上的植物让你放松，但工作重点仍是用户增长。", "负责用户增长项目"),
    historyItem(27, "小团队管理", "你偶尔用植物做活动主题，但没有把它当成职业方向。", "扩大本地服务团队")
  ]
);
const modelMentionPlant = modelMentionOnlyPack.interestSignals.find((fact) => fact.text.includes("植物"));
assert.equal((modelMentionPlant as any)?.userReinforcementCount, 0);
assert.equal((modelMentionPlant as any)?.modelMentionCount, 3);
assert.equal(modelMentionPlant?.promotedToArc, false);
assert.equal((modelMentionPlant as any)?.directionState, "background_detail");

const stageArcPack = buildStoryContextPack(
  interestUserData,
  [],
  [
    historyItem(19, "植物社团", "你加入植物社团，开始系统学习植物养护。", "系统学习植物学"),
    historyItem(22, "植物科技实习", "你进入植物科技公司，继续围绕植物方向积累经验。", "申请植物科技实习")
  ]
);
const stageArcPlant = stageArcPack.interestSignals.find((fact) => fact.text.includes("植物"));
assert.equal((stageArcPlant as any)?.directionState, "stage_main_arc");
assert.equal(stageArcPlant?.promotedToArc, true);

const decayedAfterReinforcementPack = buildStoryContextPack(
  interestUserData,
  [],
  [
    historyItem(19, "植物社团", "你加入植物社团，开始系统学习植物养护。", "系统学习植物学"),
    historyItem(22, "平台运营", "你转去互联网平台做运营。", "继续做平台运营"),
    historyItem(24, "增长项目", "你负责社区增长。", "负责用户增长项目"),
    historyItem(27, "本地服务", "你围绕本地服务做现金流。", "扩大本地服务团队"),
    historyItem(30, "合伙创业", "你和合伙人做社区服务创业。", "继续做社区服务")
  ]
);
const decayedPlant = decayedAfterReinforcementPack.interestSignals.find((fact) => fact.text.includes("植物"));
assert.equal((decayedPlant as any)?.userReinforcementCount, 1);
assert.equal((decayedPlant as any)?.directionState, "background_detail");
assert.equal(decayedPlant?.promotedToArc, false);

const genericDirectionCases = [
  { keyword: "写作", situation: "我喜欢写作，想试试内容行业。", choice: "继续做平台运营" },
  { keyword: "游戏", situation: "我对游戏策划感兴趣，但后来先做了运营。", choice: "继续做平台运营" },
  { keyword: "深圳", situation: "我想去深圳发展，看看大城市机会。", choice: "留在本地服务团队" },
  { keyword: "互联网", situation: "我想进入互联网行业，但当时没有明确路径。", choice: "继续做线下服务" }
];

for (const item of genericDirectionCases) {
  const genericPack = buildStoryContextPack(
    {
      regressionAge: 18,
      regressionSituation: item.situation,
      regressionChoices: "想看看不同方向会怎样",
      coreStoryFocus: "career"
    },
    [],
    [
      historyItem(22, "现实转向", `你偶尔想起${item.keyword}，但工作主线已经转到本地服务。`, item.choice),
      historyItem(24, "继续积累", "你继续围绕现金流和团队协作做选择。", item.choice)
    ]
  );
  const signal = genericPack.interestSignals.find((fact) => fact.text.includes(item.keyword));
  assert.ok(signal, `${item.keyword} should be tracked as a direction signal`);
  assert.equal((signal as any)?.userReinforcementCount, 0);
  assert.equal(signal?.promotedToArc, false);
  assert.equal((signal as any)?.directionState, "background_detail");
}
