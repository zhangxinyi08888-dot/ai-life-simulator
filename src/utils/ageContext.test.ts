import assert from "node:assert/strict";
import { buildAgeContext, formatAgeContextForPrompt } from "./ageContext";

const context = buildAgeContext({
  previousAgeInMonths: 79 * 12,
  targetAgeInMonths: 80 * 12,
  attributes: { happiness: 60, intelligence: 70, wealth: 55, relation: 50, health: 65 },
  userData: { regressionChoices: "继续旅行和写作" },
  history: [],
  people: [{ id: "parent", relation: "parent", estimatedAgeRange: [105, 125], lifeStatus: "unknown", source: "model_inferred", confidence: 0.5 }]
});

assert.equal(context.lifeStage, "longevity");
assert.ok(context.activeAgencyDirections.includes("继续旅行和写作"));
assert.ok(context.hardConstraints.some((item) => item.includes("不能默认仍在工作")));
const prompt = formatAgeContextForPrompt(context);
assert.match(prompt, /年龄只约束执行条件/);
assert.match(prompt, /80岁旅行/);

const thirteenMonthContext = buildAgeContext({
  previousAgeInMonths: 24 * 12 + 6,
  targetAgeInMonths: 25 * 12 + 7,
  attributes: { happiness: 42, intelligence: 53, wealth: 48, relation: 38, health: 52 },
  userData: { regressionChoices: "继续推进产品职业方向" },
  history: [],
  people: []
});
const thirteenMonthPrompt = formatAgeContextForPrompt(thirteenMonthContext);

assert.equal(thirteenMonthContext.elapsedMonths, 13);
assert.match(thirteenMonthPrompt, /必须覆盖完整的13个月/);
assert.match(thirteenMonthPrompt, /阶段末尾/);
assert.match(thirteenMonthPrompt, /storyEpisode\.internalTransitions/);
assert.match(thirteenMonthPrompt, /目标时间25 岁 7 个月附近/);
