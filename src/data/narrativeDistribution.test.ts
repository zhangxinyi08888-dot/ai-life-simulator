import assert from "node:assert/strict";
import type { HistoryItem, LifeAttributes, NarrativeMode, UserInitialData, WorldStateSnapshot } from "../types";
import { buildEventMeta, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent } from "./lifeEvents";

const stable: LifeAttributes = { happiness: 58, intelligence: 65, wealth: 55, relation: 58, health: 60 };
const baseUser = {
  currentSituation: "目前在公司从事产品工作，持续写作和创作，希望逐步转型。",
  regressionSituation: "职业方向需要调整，但仍有稳定工作。",
  regressionChoices: "继续产品工作，同时坚持写作项目。",
  coreStoryFocus: "career"
} satisfies Partial<UserInitialData>;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function snapshot(): WorldStateSnapshot {
  return {
    people: [
      { id: "partner", relation: "partner", lifeStatus: "active", source: "user_fact", confidence: 0.95 },
      { id: "parent", relation: "parent", lifeStatus: "active", source: "answer", confidence: 0.9 },
      { id: "friend", relation: "friend", lifeStatus: "active", source: "history", confidence: 0.85 }
    ],
    directionArcs: [{ id: "writing", directionType: "career_creation", summary: "长期写作项目", status: "active", startedAtAgeInMonths: 480, userReinforcementCount: 4, establishedAssets: ["作品"] }],
    pressureArcs: [],
    careerSummary: "在职并持续创作",
    relationshipSummary: "伴侣和家庭关系明确",
    version: 1
  };
}

function historyItem(index: number, intent = "career:practice", description = "持续练习并承担项目责任。", attributes = stable): HistoryItem {
  return {
    age: 42 + index * 0.5,
    ageInMonths: 504 + index * 6,
    stage: "持续积累",
    title: "长期行动",
    description,
    selectedChoice: intent,
    selectedDecisionIntent: intent,
    attributes,
    choices: [{ id: "A", text: intent, impactSummary: "持续推进", decisionIntent: intent }],
    isEndingNode: false,
    narrativeMeta: {
      elapsedMonths: 6, elapsedYears: 0.5, lifeIntensity: "normal", nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: `e${index}`, startAgeInMonths: 498 + index * 6, endAgeInMonths: 504 + index * 6, internalTransitions: [], decisionCheckpointId: `c${index}`, summary: description },
      recoveryState: "neutral", recoveryEvidence: [], arcSignals: [], activeCharacters: [],
      primaryActivity: { domain: "career", intensity: "moderate" }, worldDeltas: []
    },
    worldStateSnapshot: snapshot()
  };
}

function sample(input: {
  seed: number;
  attributes: LifeAttributes;
  userData?: Partial<UserInitialData>;
  age: number;
  history?: HistoryItem[];
}, count = 10_000) {
  const original = Math.random;
  const modes: Record<NarrativeMode, number> = {
    pressure_crisis: 0, crossroads_opportunity: 0, recovery_growth: 0, stability_meaning: 0
  };
  const categories = new Map<string, number>();
  let nulls = 0;
  let majors = 0;
  Math.random = seeded(input.seed);
  try {
    for (let index = 0; index < count; index += 1) {
      const event = queryDynamicLifeEvent(input.attributes, input.userData || {}, input.age, input.history || []);
      if (!event) {
        nulls += 1;
        continue;
      }
      modes[event.narrativeMode] += 1;
      categories.set(event.category, (categories.get(event.category) || 0) + 1);
      if (buildEventMeta(event).eventIntensity === "major") majors += 1;
    }
  } finally {
    Math.random = original;
  }
  return { modes, categories, nulls, majors, nonNull: count - nulls };
}

const contextHistory = [historyItem(0, "self:maintain", "保持现有职业和创作方向。")];
const stableNoRecovery = sample({ seed: 1, attributes: stable, userData: baseUser, age: 45, history: contextHistory });
const stableShare = stableNoRecovery.modes.stability_meaning / stableNoRecovery.nonNull;
assert.ok(stableShare >= 0.45 && stableShare <= 0.65);
assert.equal(stableNoRecovery.majors, 0);

const accumulatedHistory = [
  historyItem(0, "career:practice"),
  historyItem(1, "career:practice"),
  historyItem(2, "career:accept_responsibility", "持续练习，同时承担项目责任并与团队协作。")
];
const stableWithRecovery = sample({ seed: 2, attributes: stable, userData: baseUser, age: 45, history: accumulatedHistory });
const positiveShare = (stableWithRecovery.modes.recovery_growth + stableWithRecovery.modes.stability_meaning) / stableWithRecovery.nonNull;
assert.ok(positiveShare >= 0.55 && positiveShare <= 0.75);
assert.ok(stableWithRecovery.modes.recovery_growth > 0);

const majorHistory = [historyItem(0)];
majorHistory[0].eventMeta = { eventId: "past_major", eventCategory: "career", eventTags: ["major_crisis"], eventIntensity: "major", eventMode: "pressure_crisis" };
const afterMajor = sample({ seed: 3, attributes: stable, userData: baseUser, age: 45, history: majorHistory });
assert.equal(afterMajor.modes.pressure_crisis, 0);
assert.equal(afterMajor.modes.stability_meaning, afterMajor.nonNull);

const lowHealth = sample({
  seed: 4,
  attributes: { ...stable, happiness: 42, health: 38 },
  userData: { ...baseUser, regressionSituation: "职业与生活结构受限，需要调整。" },
  age: 45
});
assert.ok(lowHealth.modes.pressure_crisis > 0);
assert.equal(lowHealth.majors, 0);

const relationshipHistory = [
  historyItem(0, "relationship:communicate", "与伴侣讨论共同计划和生活安排。"),
  historyItem(1, "relationship:plan", "与伴侣继续沟通承诺与共同生活。")
];
const relationshipRoute = sample({
  seed: 5, attributes: stable,
  userData: { ...baseUser, currentSituation: `${baseUser.currentSituation}，已婚并与伴侣共同生活。`, coreStoryFocus: "romance" },
  age: 45, history: relationshipHistory
});
assert.ok((relationshipRoute.categories.get("relationship") || 0) > 0);

const financialHistory = [
  historyItem(0, "financial:save", "持续储蓄并控制支出。", { ...stable, wealth: 45 }),
  historyItem(1, "financial:save", "继续储蓄并建立应急缓冲。", { ...stable, wealth: 50 }),
  historyItem(2, "career:stabilize_income", "收入逐渐稳定。", stable)
];
financialHistory.forEach((item, index) => {
  item.financialState = {
    currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: item.ageInMonths!, cashWan: 3 + index * 5,
    investmentAssetsWan: 0, propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0,
    totalDebtWan: 12 - index * 2, netWorthWan: -9 + index * 7, annualAfterTaxIncomeWan: 15,
    annualDisposableIncomeWan: 5, annualCoreExpenseWan: 10,
    incomeStability: index === 0 ? "volatile" : "stable", isEstimated: false
  };
});
const financialRoute = sample({ seed: 6, attributes: stable, userData: { ...baseUser, coreStoryFocus: "wealth" }, age: 45, history: financialHistory });
assert.ok((financialRoute.categories.get("financial") || 0) > 0);

const seniorHistory = [historyItem(0, "creation:practice"), historyItem(1, "creation:practice"), historyItem(2, "creation:practice")];
seniorHistory.forEach((item, index) => { item.age = 77 + index; item.ageInMonths = item.age * 12; });
const seniorRoute = sample({
  seed: 7, attributes: stable,
  userData: { ...baseUser, currentSituation: "长期写作、摄影和学习，仍在推进新的作品。", coreStoryFocus: "selftruth" },
  age: 82, history: seniorHistory
});
assert.ok(seniorRoute.nonNull > 0);
assert.ok((seniorRoute.categories.get("growth") || 0) > 0);

const pressureIds = LIFE_EVENTS_DATABASE.filter((event) => event.narrativeMode === "pressure_crisis" && event.dispatchMode !== "arc_only");
const cooledPressureHistory = pressureIds.map((event, index) => {
  const item = historyItem(index, "career:accept_responsibility", "组织责任、行业变化、成果归属、家庭请求和共同资源矛盾同时已有明确事实。", { ...stable, health: 40 });
  item.eventMeta = buildEventMeta(event);
  return item;
}).slice(-6);
const cooledPressure = sample({
  seed: 8, attributes: { ...stable, health: 40 },
  userData: { ...baseUser, currentSituation: `${baseUser.currentSituation}，已婚，需要照护父母，职业与生活结构受限。` },
  age: 45, history: cooledPressureHistory
});
assert.equal(cooledPressure.modes.pressure_crisis, 0);

const careerFocus = sample({ seed: 9, attributes: stable, userData: { ...baseUser, coreStoryFocus: "career" }, age: 45, history: contextHistory }, 10_000);
const selfFocus = sample({ seed: 9, attributes: stable, userData: { ...baseUser, coreStoryFocus: "selftruth" }, age: 45, history: contextHistory }, 10_000);
assert.notEqual(careerFocus.categories.get("career"), selfFocus.categories.get("career"));
