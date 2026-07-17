import assert from "node:assert/strict";
import type { FinancialState, HistoryItem, LifeAttributes, UserInitialData, WorldStateSnapshot } from "../types";
import { buildEventMeta, isLifeEventCandidateEligible, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent } from "./lifeEvents";

const seeds = [101, 202, 303] as const;
const attributes: LifeAttributes = { happiness: 56, intelligence: 65, wealth: 54, relation: 58, health: 55 };
const userData = {
  currentSituation: "在产品岗位工作，已婚并照护父母，长期学习写作和摄影；正在处理债务、健康恢复与职业转型。",
  regressionSituation: "职业、关系、健康和财务都经历过具体限制。",
  regressionChoices: "坚持长期创作，同时用小步方式调整现实生活。",
  coreStoryFocus: "selftruth"
} satisfies Partial<UserInitialData>;

function world(ageInMonths: number, healthPhase: "recovery" | "operation" = "recovery"): WorldStateSnapshot {
  return {
    people: [
      { id: "partner", relation: "partner", lifeStatus: "active", source: "user_fact", confidence: 0.95 },
      { id: "parent", relation: "parent", lifeStatus: "limited", source: "answer", confidence: 0.9 },
      { id: "friend", relation: "friend", lifeStatus: "active", source: "history", confidence: 0.85 }
    ],
    directionArcs: [{ id: "creation", directionType: "career_creation", summary: "持续写作摄影和产品创作", status: "active", startedAtAgeInMonths: ageInMonths - 48, userReinforcementCount: 4, establishedAssets: ["作品", "练习方法"] }],
    pressureArcs: [{ id: "health", eventId: "health_forced_pause", eventIntentType: "health_forced_pause", phasePolicyId: "health_crisis_v1", phaseId: healthPhase, status: "stabilizing", startedAtAgeInMonths: ageInMonths - 24, phaseStartedAtAgeInMonths: ageInMonths - 12, phaseCheckpointCount: 1, totalCheckpointCount: 2, unresolvedSummary: "健康进入恢复管理阶段" }],
    foregroundPressureArcId: "health",
    careerSummary: "在职并持续推进创作项目",
    relationshipSummary: "伴侣、家庭和朋友关系明确",
    healthSummary: "健康正在恢复并调整负荷",
    version: 1
  };
}

function finance(ageInMonths: number, debt: number, cash: number, stable = true): FinancialState {
  return {
    currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: ageInMonths, cashWan: cash,
    investmentAssetsWan: 1, propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0,
    totalDebtWan: debt, netWorthWan: cash + 1 - debt, annualAfterTaxIncomeWan: 18,
    annualDisposableIncomeWan: 7, annualCoreExpenseWan: 11,
    incomeStability: stable ? "stable" : "volatile", isEstimated: false
  };
}

function node(input: {
  ageInMonths: number;
  intent: string;
  description: string;
  attrs?: LifeAttributes;
  eventId?: string;
  eventFamily?: string;
  debt?: number;
  cash?: number;
}): HistoryItem {
  return {
    age: input.ageInMonths / 12,
    ageInMonths: input.ageInMonths,
    stage: "长期路线",
    title: "选择产生后续结果",
    description: input.description,
    selectedChoice: input.intent,
    selectedDecisionIntent: input.intent,
    attributes: input.attrs || attributes,
    financialState: finance(input.ageInMonths, input.debt ?? 10, input.cash ?? 8, input.cash !== 2),
    choices: [{ id: "A", text: input.intent, impactSummary: "持续推进", decisionIntent: input.intent, eventOutcomeId: "route_fixture" }],
    isEndingNode: false,
    eventMeta: input.eventId
      ? (() => {
        const knownEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === input.eventId);
        return knownEvent
          ? buildEventMeta(knownEvent)
          : {
            eventId: input.eventId, eventCategory: input.eventId.startsWith("health") ? "health" as const : "growth" as const,
            eventTags: ["route_evidence"], eventIntensity: "minor" as const, eventSemanticFamily: input.eventFamily
          };
      })()
      : undefined,
    narrativeMeta: {
      elapsedMonths: 6, elapsedYears: 0.5, lifeIntensity: "normal", nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: `episode_${input.ageInMonths}`, startAgeInMonths: input.ageInMonths - 6, endAgeInMonths: input.ageInMonths, internalTransitions: [], decisionCheckpointId: `checkpoint_${input.ageInMonths}`, summary: input.description },
      recoveryState: "protected", recoveryEvidence: ["持续行动和支持条件已形成"], arcSignals: [], activeCharacters: [],
      primaryActivity: { domain: "career", intensity: "moderate" }, worldDeltas: []
    },
    worldStateSnapshot: world(input.ageInMonths)
  };
}

interface RouteDefinition {
  name: string;
  eventId: string;
  age: number;
  history: HistoryItem[];
  attrs?: LifeAttributes;
}

const routes: RouteDefinition[] = [
  {
    name: "职业坚持后能力形成", eventId: "career_skill_compounding", age: 45,
    history: [node({ ageInMonths: 510, intent: "career:practice", description: "持续练习产品和写作技能。" }), node({ ageInMonths: 522, intent: "career:practice", description: "继续练习并用于真实项目。" })]
  },
  {
    name: "职业渐进转型", eventId: "career_gradual_transition_window", age: 45,
    history: [node({ ageInMonths: 528, intent: "career:prepare_transition", description: "保留现有工作并准备小规模转型试点。" })]
  },
  {
    name: "项目获得认可后收束", eventId: "career_long_project_completion", age: 50,
    history: [node({ ageInMonths: 560, intent: "career:project", description: "持续项目得到外部认可。" }), node({ ageInMonths: 570, intent: "career:project", description: "继续推进被采用的项目。" }), node({ ageInMonths: 580, intent: "career:project", description: "项目形成阶段成果。" })]
  },
  {
    name: "关系修复", eventId: "relationship_trust_rebuilding", age: 45,
    history: [node({ ageInMonths: 516, intent: "relationship:repair", description: "伴侣关系出现信任裂纹后开始修复。", attrs: { ...attributes, relation: 55 } }), node({ ageInMonths: 528, intent: "relationship:communicate", description: "继续诚实沟通并设置边界。", attrs: { ...attributes, relation: 56 } })]
  },
  {
    name: "主动放手并重新定向", eventId: "relationship_release_and_reorientation", age: 45,
    history: [node({ ageInMonths: 516, intent: "relationship:communicate", description: "长期不匹配和距离问题持续存在。" }), node({ ageInMonths: 528, intent: "relationship:set_boundary", description: "边界冲突经过沟通仍未改善。" })]
  },
  {
    name: "健康停摆后真实恢复", eventId: "health_recovery_progress", age: 45,
    history: [node({ ageInMonths: 510, intent: "health:reduce_load", description: "健康停摆后减少负荷并接受治疗。", eventId: "health_forced_pause", attrs: { ...attributes, health: 45 } }), node({ ageInMonths: 522, intent: "health:seek_support", description: "继续接受支持并恢复睡眠。", attrs: { ...attributes, health: 50 } }), node({ ageInMonths: 528, intent: "health:reduce_load", description: "调整后的恢复条件持续生效。", attrs: { ...attributes, health: 52 } })],
    attrs: { ...attributes, health: 55 }
  },
  {
    name: "健康未完全恢复但稳定管理", eventId: "health_adapted_life_balance", age: 45,
    history: [node({ ageInMonths: 510, intent: "health:treatment", description: "健康预警后开始长期管理。", eventId: "health_system_warning", attrs: { ...attributes, health: 40 } }), node({ ageInMonths: 528, intent: "health:adapt", description: "围绕真实限制安排工作和生活。", attrs: { ...attributes, health: 45 } })],
    attrs: { ...attributes, health: 48 }
  },
  {
    name: "债务逐步下降并形成缓冲", eventId: "financial_debt_reduction_progress", age: 45,
    history: [node({ ageInMonths: 510, intent: "financial:repay", description: "开始稳定还债并控制支出。", debt: 20, cash: 2 }), node({ ageInMonths: 522, intent: "financial:repay", description: "继续还债并保留现金缓冲。", debt: 15, cash: 5 }), node({ ageInMonths: 528, intent: "career:stabilize_income", description: "收入稳定使债务继续下降。", debt: 10, cash: 8 })]
  },
  {
    name: "兴趣成为长期实践", eventId: "self_interest_becomes_practice", age: 45,
    history: [node({ ageInMonths: 516, intent: "creation:practice", description: "固定安排摄影和写作练习。" }), node({ ageInMonths: 528, intent: "creation:practice", description: "持续完成小作品。" })]
  },
  {
    name: "高龄仍持续学习创作和连接", eventId: "self_long_term_creation", age: 82,
    history: [node({ ageInMonths: 930, intent: "creation:practice", description: "继续写作和摄影。" }), node({ ageInMonths: 950, intent: "creation:practice", description: "形成稳定作品序列。" }), node({ ageInMonths: 966, intent: "creation:practice", description: "持续面向未来开展新创作。" })]
  }
];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0x100000000;
  };
}

const captures: Array<{
  route: string;
  seed: number;
  completeNodes: HistoryItem[];
  eventId: string;
  eventMode: string;
  semanticFamily: string;
  userChoice: string;
  selectedDecisionIntent: string;
  attributes: LifeAttributes;
  financialState?: FinancialState;
  people: WorldStateSnapshot["people"];
  pressureArcs: WorldStateSnapshot["pressureArcs"];
  worldState: WorldStateSnapshot;
}> = [];

for (const route of routes) {
  const target = LIFE_EVENTS_DATABASE.find((event) => event.id === route.eventId)!;
  assert.ok(target, route.name);
  assert.equal(isLifeEventCandidateEligible(target, route.attrs || attributes, userData, route.age, route.history), true, `${route.name} should reach ${route.eventId}`);

  for (const seed of seeds) {
    const original = Math.random;
    Math.random = seeded(seed);
    let selected = false;
    try {
      for (let attempt = 0; attempt < 2_000; attempt += 1) {
        if (queryDynamicLifeEvent(route.attrs || attributes, userData, route.age, route.history)?.id === target.id) {
          selected = true;
          break;
        }
      }
    } finally {
      Math.random = original;
    }
    assert.equal(selected, true, `${route.name} seed ${seed} should select ${target.id}`);

    const last = route.history.at(-1)!;
    const state = last.worldStateSnapshot!;
    captures.push({
      route: route.name,
      seed,
      completeNodes: route.history,
      eventId: target.id,
      eventMode: target.narrativeMode,
      semanticFamily: target.semanticFamily,
      userChoice: last.selectedChoice,
      selectedDecisionIntent: last.selectedDecisionIntent!,
      attributes: route.attrs || attributes,
      financialState: last.financialState,
      people: state.people,
      pressureArcs: state.pressureArcs,
      worldState: state
    });
  }
}

assert.equal(captures.length, 30);
for (const capture of captures) {
  assert.ok(capture.completeNodes.length);
  assert.ok(capture.eventId && capture.eventMode && capture.semanticFamily);
  assert.ok(capture.userChoice && capture.selectedDecisionIntent);
  assert.ok(capture.financialState);
  assert.ok(capture.people.length);
  assert.ok(capture.pressureArcs.length);
  assert.equal(capture.worldState.version, 1);
  assert.deepEqual(buildEventMeta(LIFE_EVENTS_DATABASE.find((event) => event.id === capture.eventId)!).eventSemanticFamily, capture.semanticFamily);
}
