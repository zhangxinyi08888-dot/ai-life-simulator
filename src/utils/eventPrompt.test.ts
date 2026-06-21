import assert from "node:assert/strict";
import { buildEventSeedPrompt } from "./eventPrompt";

const promptSeedPrompt = buildEventSeedPrompt({
  id: "health_life_accident_lesson",
  category: "health",
  title: "身体宕机与生活暂停",
  minAge: 18,
  maxAge: 70,
  conditionDescription: "健康 < 40 或 幸福度 < 35",
  check: () => true,
  cooldown: 8,
  tags: ["health", "major_crisis", "forced_pause"],
  promptSeed: {
    core: "长期透支导致一次现实的身体宕机，被迫暂停原有生活节奏。",
    contextGuidance: ["结合上一阶段的职业选择、财务状况、居住状态和家庭支持度来决定具体表现。"],
    forbidden: ["不要固定写雨夜骨折。"],
    optionDirections: ["接受停顿，重排生活节奏和工作方式。"]
  }
});

assert.match(promptSeedPrompt, /剧情指令/);
assert.match(promptSeedPrompt, /长期透支导致一次现实的身体宕机/);
assert.match(promptSeedPrompt, /不要固定写雨夜骨折/);
assert.doesNotMatch(promptSeedPrompt, /骑共享单车/);

const legacyPrompt = buildEventSeedPrompt({
  id: "legacy_event",
  category: "career",
  title: "旧事件",
  minAge: 20,
  maxAge: 60,
  conditionDescription: "测试",
  check: () => true,
  conceptPrompt: "旧版具体剧情种子。"
});

assert.match(legacyPrompt, /旧版具体剧情种子/);
