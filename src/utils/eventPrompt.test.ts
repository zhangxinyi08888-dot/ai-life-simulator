import assert from "node:assert/strict";
import { buildEventIntentPrompt, buildNullEventPrompt } from "./eventPrompt";

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
});

assert.match(intentPrompt, /Event Intent/);
assert.match(intentPrompt, /health_system_warning/);
assert.match(intentPrompt, /allowedOutcomes 是行动原语/);
assert.doesNotMatch(intentPrompt, /现实人生事件触发/);
assert.doesNotMatch(intentPrompt, /剧情指令/);

const nullPrompt = buildNullEventPrompt();
assert.match(nullPrompt, /本轮没有强事件结构/);
assert.match(nullPrompt, /最近 5 个历史节点/);
assert.match(nullPrompt, /不要强行制造事故/);
