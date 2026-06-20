import { PersonalityInsight } from "../types";

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback = 50): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTraitItem(item: any, fallbackTrait = "人格特质"): PersonalityInsight["personalityTraits"][number] {
  return {
    trait: readString(item?.trait ?? item?.name, fallbackTrait),
    score: readNumber(item?.score ?? item?.value),
    description: readString(item?.description ?? item?.analysis ?? item?.comment ?? item?.commentary, "暂无详细说明。")
  };
}

function normalizeTraits(traits: any): PersonalityInsight["personalityTraits"] {
  if (Array.isArray(traits)) {
    return traits.map((item, index) => normalizeTraitItem(item, `人格特质${index + 1}`));
  }

  if (traits && typeof traits === "object") {
    return Object.entries(traits).map(([trait, value]) => normalizeTraitItem(value, trait));
  }

  return [];
}

export function normalizePersonalityInsight(data: any): PersonalityInsight {
  return {
    lifeTitle: readString(data?.lifeTitle, "未命名人生"),
    epitaph: readString(data?.epitaph, "愿你在回望中看见自己。"),
    personalityTraits: normalizeTraits(data?.personalityTraits),
    detailedAnalysis: readString(data?.detailedAnalysis, "暂无深度分析。"),
    realLifeAdvice: readString(data?.realLifeAdvice, "暂无现实建议。"),
    growthAdvice: readString(data?.growthAdvice, "暂无成长建议。"),
    decisionAdvice: readString(data?.decisionAdvice, "暂无决策建议。"),
    wellnessAdvice: readString(data?.wellnessAdvice, "暂无身心建议。")
  };
}
