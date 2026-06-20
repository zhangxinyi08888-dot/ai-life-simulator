import assert from "node:assert/strict";
import { normalizePersonalityInsight } from "./insightResponse";

const objectShapedInsight = normalizePersonalityInsight({
  lifeTitle: "镜中孤岛的诗意守望者",
  epitaph: "一生未曾远航，却在方寸之地看尽了潮起潮落。",
  personalityTraits: {
    "逆境自我治愈率": {
      score: 50,
      analysis: "你在逆境中倾向于保持中庸，既不激烈挣扎，也不彻底放弃。"
    },
    "现实物质抱负心": {
      score: 62,
      description: "你对物质既非贪婪也非漠然，而是将其视为生活安稳的基石。"
    },
    "感性直觉与利他指数": {
      score: 48,
      comment: "你在关系中保持温和，注重维护和谐。"
    }
  },
  detailedAnalysis: "你的人生轨迹呈现出一幅中庸的画卷。",
  realLifeAdvice: "从小处尝试更主动的选择。",
  growthAdvice: "未来的突破点是有限冒险。",
  decisionAdvice: "用长期视角检查关键选择。",
  wellnessAdvice: "用动态平衡代替静态硬撑。"
});

assert.deepEqual(objectShapedInsight.personalityTraits, [
  {
    trait: "逆境自我治愈率",
    score: 50,
    description: "你在逆境中倾向于保持中庸，既不激烈挣扎，也不彻底放弃。"
  },
  {
    trait: "现实物质抱负心",
    score: 62,
    description: "你对物质既非贪婪也非漠然，而是将其视为生活安稳的基石。"
  },
  {
    trait: "感性直觉与利他指数",
    score: 48,
    description: "你在关系中保持温和，注重维护和谐。"
  }
]);

const arrayShapedInsight = normalizePersonalityInsight({
  lifeTitle: "远行者",
  epitaph: "仍然向前。",
  personalityTraits: [
    { trait: "求真探索驱动力", score: 77, description: "愿意为长期答案付出代价。" }
  ],
  detailedAnalysis: "持续探索。",
  realLifeAdvice: "把节奏放慢。",
  growthAdvice: "稳定投入。",
  decisionAdvice: "减少冲动。",
  wellnessAdvice: "保留休息。"
});

assert.equal(arrayShapedInsight.personalityTraits[0].trait, "求真探索驱动力");
assert.equal(arrayShapedInsight.personalityTraits[0].score, 77);
