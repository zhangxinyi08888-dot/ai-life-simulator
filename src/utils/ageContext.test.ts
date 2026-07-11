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
