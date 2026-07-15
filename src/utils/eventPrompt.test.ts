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
    allowedOutcomes: [
      "maintain_current_load_with_monitoring",
      "continue_goal_with_adjusted_execution",
      "pause_or_seek_professional_support"
    ],
    emotionalTone: "crisis"
  }
}, storyContext);

assert.match(intentPrompt, /Event Intent/);
assert.match(intentPrompt, /Story Context Pack/);
assert.match(intentPrompt, /health_system_warning/);
assert.match(intentPrompt, /我爸妈希望我稳定/);
assert.match(intentPrompt, /至少显性使用 1 条追问答案/);
assert.match(intentPrompt, /allowedOutcomes 是行动原语/);
assert.match(intentPrompt, /不得把继续事业目标等同于维持原有负荷/);
assert.match(intentPrompt, /也允许暂停、离职或退出当前工作进行调养/);
assert.match(intentPrompt, /正文应说明当前风险和可调整因素/);
assert.match(intentPrompt, /至少一个应能实质改善恢复条件/);
assert.match(intentPrompt, /不得承诺健康立即回升/);
assert.match(intentPrompt, /continue_goal_with_adjusted_execution/);
assert.match(intentPrompt, /background thread.*不等于把用户未采纳的具体方案/);
assert.match(intentPrompt, /state=cooldown 或 dormant/);
assert.doesNotMatch(intentPrompt, /高薪不是必然伤健康/);
assert.doesNotMatch(intentPrompt, /高收入选项/);
assert.doesNotMatch(intentPrompt, /现实人生事件触发/);
assert.doesNotMatch(intentPrompt, /剧情指令/);

const nullPrompt = buildNullEventPrompt(storyContext);
assert.match(nullPrompt, /本轮没有强事件结构/);
assert.match(nullPrompt, /Story Context Pack/);
assert.match(nullPrompt, /最近 5 个历史节点/);
assert.match(nullPrompt, /轻量关系\/亲情\/生活副线/);
assert.match(nullPrompt, /不要强行制造事故/);
assert.match(nullPrompt, /初始事实、追问答案和 background thread 都不能绕过冷却/);

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
      attributes: { happiness: 50, intelligence: 60, wealth: 45, relation: 55, health: 58 },
      choices: [{ id: "A", text: "继续做社区服务", impactSummary: "聚焦现金" }],
      isEndingNode: false
    }
  ]
);

const interestPrompt = buildNullEventPrompt(interestContext);
assert.match(interestPrompt, /方向线索使用边界/);
assert.match(interestPrompt, /state=mentioned|state=background_detail/);
assert.match(interestPrompt, /模型正文偶然提及不计入强化/);
assert.match(interestPrompt, /只有 state=stage_main_arc 或 long_term_main_arc 的方向可以成为职业、创业、重大转型方向/);
assert.match(interestPrompt, /state=background_detail 的方向不得进入选项主语/);
