import assert from "node:assert/strict";
import { buildEventIntentPrompt, buildNullEventPrompt } from "./eventPrompt";
import { buildStoryContextPack } from "./storyContext";

const storyContext = buildStoryContextPack(
  {
    regressionAge: 22,
    regressionSituation: "刚毕业想辞职做设计，但父母希望我稳定。",
    coreStoryFocus: "romance",
    milestoneRelationship: "大学时有一段异地恋。"
  },
  [
    {
      id: 1,
      question: "当时真实发生了什么？",
      answer: "我爸妈希望我稳定，不支持我冒险辞职。"
    }
  ],
  []
);

const intentPrompt = buildEventIntentPrompt({
  id: "health_system_warning",
  category: "health",
  title: "健康系统预警",
  minAge: 18,
  maxAge: 70,
  conditionDescription: "健康低或压力高",
  cooldown: 6,
  baseProbability: 0.8,
  tags: ["health", "burnout", "instability"],
  trigger: { eligibility: () => true },
  intent: {
    type: "health_system_warning",
    meaning: "长期高压生活引发身体系统性反馈",
    tensionAxes: ["收益 vs 健康", "短期稳定 vs 长期风险"],
    allowedOutcomes: ["persist_high_pressure", "optimize_load", "exit_or_pause"],
    emotionalTone: "crisis"
  }
}, storyContext);

assert.match(intentPrompt, /Event Intent/);
assert.match(intentPrompt, /Story Context Pack/);
assert.match(intentPrompt, /health_system_warning/);
assert.match(intentPrompt, /我爸妈希望我稳定/);
assert.match(intentPrompt, /至少显性使用 1 条追问答案/);
assert.match(intentPrompt, /allowedOutcomes 是行动原语/);
assert.doesNotMatch(intentPrompt, /现实人生事件触发/);
assert.doesNotMatch(intentPrompt, /剧情指令/);

const nullPrompt = buildNullEventPrompt(storyContext);
assert.match(nullPrompt, /本轮没有强事件结构/);
assert.match(nullPrompt, /Story Context Pack/);
assert.match(nullPrompt, /最近 5 个历史节点/);
assert.match(nullPrompt, /轻量关系\/亲情\/生活副线/);
assert.match(nullPrompt, /不要强行制造事故/);

const interestContext = buildStoryContextPack(
  {
    regressionAge: 18,
    regressionSituation: "高考填报志愿时对植物感兴趣。",
    regressionChoices: "想按兴趣选择专业",
    coreStoryFocus: "career"
  },
  [],
  [
    {
      age: 30,
      stage: "创业阶段",
      title: "社区服务创业",
      description: "你围绕本地社区服务搭建团队，主要压力来自现金流和获客。",
      selectedChoice: "继续做社区服务",
      attributes: { happiness: 50, intelligence: 60, wealth: 45, relation: 55, health: 58 }
    }
  ]
);

const interestPrompt = buildNullEventPrompt(interestContext);
assert.match(interestPrompt, /早期兴趣若最近历史没有强化/);
assert.match(interestPrompt, /不得自动扩展为终身职业、创业方向或人生主题/);
assert.match(interestPrompt, /最近 5 个历史节点和最近选择优先/);
