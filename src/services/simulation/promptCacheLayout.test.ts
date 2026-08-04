import assert from "node:assert/strict";
import { LIFE_EVENTS_DATABASE } from "../../data/lifeEvents";
import { initializeFinancialLedger } from "../../domain/finance";
import { flattenAiPromptInput } from "../../utils/deepseek";
import { buildStoryContextPack } from "../../utils/storyContext";
import {
  buildNextNodePrompt,
  buildNextNodePromptLayout,
  buildNextNodePromptRequest,
  NEXT_NODE_INVARIANT_PREFIX_V1,
  NEXT_NODE_INVARIANT_PREFIX_VERSION
} from "./prompts";

function longestCommonPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index;
}

const cacheEvent = LIFE_EVENTS_DATABASE.find((event) => event.intent.type === "career_venture_pressure");
assert.ok(cacheEvent, "cache layout fixture needs a real event seed");

function historyAt(count: number): any[] {
  return Array.from({ length: count }, (_, index) => ({
    age: 20 + index,
    ageInMonths: (20 + index) * 12,
    stage: "缓存布局阶段",
    title: `CACHE_HISTORY_TITLE_${index + 1}`,
    description: `CACHE_HISTORY_DESCRIPTION_${index + 1}`,
    selectedChoice: `CACHE_HISTORY_CHOICE_${index + 1}`
  }));
}

function cacheLedger(): any {
  const ledger = initializeFinancialLedger({ id: "cache_layout_ledger", asOfAgeInMonths: 26 * 12 });
  return {
    ...ledger,
    cashAccounts: [{ id: "CACHE_LEDGER_CASH_ALPHA", type: "cash", balanceWan: 11, status: "active", factStatus: "known" }]
  };
}

function inputFor(input: {
  gender?: string;
  regressionAge?: number;
  focus?: string;
  historyCount?: number;
  selectedDecision?: string;
  selectedOutcomeId?: string;
  pressureArc?: any;
  debtHealth?: any;
} = {}): any {
  const userData = {
    birthday: "1998-01-01",
    gender: input.gender ?? "女",
    regressionAge: input.regressionAge ?? 22,
    regressionSituation: "CACHE_USER_SITUATION_ALPHA",
    regressionChoices: "CACHE_USER_BRANCH_ALPHA",
    coreStoryFocus: input.focus ?? "career",
    milestoneCareer: "CACHE_MILESTONE_CAREER_ALPHA",
    milestoneRelationship: "CACHE_MILESTONE_RELATIONSHIP_ALPHA",
    milestoneOther: "CACHE_MILESTONE_OTHER_ALPHA"
  };
  const answers = [{
    question: "CACHE_ANSWER_QUESTION_ALPHA",
    answer: "CACHE_ANSWER_VALUE_ALPHA"
  }];
  const history = historyAt(input.historyCount ?? 6);
  return {
    userData,
    answers,
    history,
    storyContext: buildStoryContextPack(userData, answers, history),
    currentAttributes: { happiness: 51, intelligence: 63, wealth: 44, relation: 58, health: 47 },
    currentFinancialState: {
      cashWan: 11,
      investmentAssetsWan: 2,
      propertyMarketValueWan: 0,
      businessAndOtherAssetsWan: 0,
      totalDebtWan: 3,
      annualAfterTaxIncomeWan: 24,
      annualDisposableIncomeWan: 9,
      annualCoreExpenseWan: 12,
      netWorthWan: 10,
      employmentStatus: "employed"
    },
    currentFinancialLedger: cacheLedger(),
    currentDebtHealthState: input.debtHealth,
    selectedDecision: input.selectedDecision ?? "CACHE_SELECTED_DECISION_ALPHA",
    selectedOutcomeId: input.selectedOutcomeId ?? "CACHE_OUTCOME_ALPHA",
    eventSeed: cacheEvent,
    foregroundPressureArc: input.pressureArc
  };
}

const first = inputFor({ historyCount: 1 });
const fifth = inputFor({ historyCount: 5 });
const sixth = inputFor({ historyCount: 6 });
const twentieth = inputFor({
  historyCount: 20,
  selectedDecision: "CACHE_SELECTED_DECISION_BETA",
  selectedOutcomeId: "CACHE_OUTCOME_BETA",
  debtHealth: {
    level: "default_risk",
    source: "authoritative_ledger",
    trend: "worsening",
    reasonCodes: ["CACHE_DEBT_REASON_ALPHA"],
    consecutiveMissedPaymentMonths: 2,
    missedPaymentMonthsLast12: 2
  },
  pressureArc: {
    id: "CACHE_PRESSURE_ARC_ALPHA",
    phaseId: "operation",
    phasePolicyId: "health_crisis_v1",
    unresolvedSummary: "CACHE_PRESSURE_SUMMARY_ALPHA"
  }
});
const variedSession = inputFor({
  gender: "男",
  regressionAge: 31,
  focus: "wealth",
  historyCount: 20
});

const layouts = [first, fifth, sixth, twentieth].map((input) => buildNextNodePromptLayout(input));
for (const layout of layouts) {
  assert.equal(layout.prefixVersion, NEXT_NODE_INVARIANT_PREFIX_VERSION);
  assert.equal(layout.invariantPrefix, NEXT_NODE_INVARIANT_PREFIX_V1);
  assert.ok(layout.text.startsWith(NEXT_NODE_INVARIANT_PREFIX_V1));
}

assert.equal(layouts[0].invariantPrefix, layouts[1].invariantPrefix);
assert.equal(layouts[1].invariantPrefix, layouts[2].invariantPrefix);
assert.equal(layouts[2].invariantPrefix, layouts[3].invariantPrefix);
assert.doesNotMatch(NEXT_NODE_INVARIANT_PREFIX_V1, /CACHE_|CACHE_USER_SITUATION_ALPHA|CACHE_OUTCOME_ALPHA|CACHE_PRESSURE_ARC_ALPHA/);
const variedLayout = buildNextNodePromptLayout(variedSession);
assert.equal(variedLayout.invariantPrefix, NEXT_NODE_INVARIANT_PREFIX_V1);
assert.match(variedLayout.sessionContext, /性别：男/);
assert.match(variedLayout.sessionContext, /31 岁/);
assert.match(variedLayout.sessionContext, /财富积累与抗风险拉扯/);
assert.doesNotMatch(NEXT_NODE_INVARIANT_PREFIX_V1, /男|31 岁|财富积累与抗风险拉扯/);

const v1Prompts = [first, fifth, sixth, twentieth].map((input) => buildNextNodePrompt(input));
const v1Requests = [first, fifth, sixth, twentieth].map((input) => buildNextNodePromptRequest(input));
for (const request of v1Requests) {
  assert.notEqual(typeof request, "string");
  if (typeof request === "string") continue;
  assert.equal(flattenAiPromptInput(request), buildNextNodePrompt([first, fifth, sixth, twentieth][v1Requests.indexOf(request)]));
  assert.equal(request.systemPrefix, [NEXT_NODE_INVARIANT_PREFIX_V1, layouts[v1Requests.indexOf(request)].sessionContext].join("\n\n"));
  assert.equal(request.userPrompt, [layouts[v1Requests.indexOf(request)].turnContext, layouts[v1Requests.indexOf(request)].tailChecklist].join("\n\n"));
  assert.ok(
    request.systemPrefix.length / flattenAiPromptInput(request).length >= 0.6,
    `stable session prefix too short: ${request.systemPrefix.length}/${flattenAiPromptInput(request).length}`
  );
}
for (const request of v1Requests.slice(1)) {
  assert.equal(typeof request === "string" ? request : request.systemPrefix, typeof v1Requests[0] === "string" ? v1Requests[0] : v1Requests[0].systemPrefix);
}
for (const prompt of v1Prompts.slice(1)) {
  const shared = longestCommonPrefixLength(v1Prompts[0], prompt);
  assert.ok(
    shared / Math.min(v1Prompts[0].length, prompt.length) >= 0.6,
    `stable prefix too short: ${shared}/${Math.min(v1Prompts[0].length, prompt.length)}`
  );
}

const legacyPrompt = buildNextNodePrompt(twentieth, { cacheAwarePromptV1: false });
const v1Prompt = buildNextNodePrompt(twentieth);
assert.equal(buildNextNodePromptRequest(twentieth, { cacheAwarePromptV1: false }), legacyPrompt);
assert.ok(
  v1Prompt.length <= legacyPrompt.length * 1.02,
  `short-context overhead escaped 2% guard: legacy=${legacyPrompt.length}, v1=${v1Prompt.length}`
);

const denseTwentieth = inputFor({ historyCount: 20 });
denseTwentieth.history = denseTwentieth.history.map((item: any, index: number) => ({
  ...item,
  description: `${item.description}。父母与项目伙伴都在等待这项选择的后续安排。${`CACHE_DENSE_REALITY_${index + 1} `.repeat(48)}`
}));
denseTwentieth.storyContext = buildStoryContextPack(denseTwentieth.userData, denseTwentieth.answers, denseTwentieth.history);
const legacyDensePrompt = buildNextNodePrompt(denseTwentieth, { cacheAwarePromptV1: false });
const v1DensePrompt = buildNextNodePrompt(denseTwentieth);
assert.ok(
  v1DensePrompt.length <= legacyDensePrompt.length * 1.02,
  `high-volume prompt grew: legacy=${legacyDensePrompt.length}, v1=${v1DensePrompt.length}`
);

for (const expected of [
  "CACHE_USER_SITUATION_ALPHA",
  "CACHE_USER_BRANCH_ALPHA",
  "CACHE_ANSWER_VALUE_ALPHA",
  "CACHE_MILESTONE_CAREER_ALPHA",
  "CACHE_MILESTONE_RELATIONSHIP_ALPHA",
  "CACHE_MILESTONE_OTHER_ALPHA",
  "CACHE_HISTORY_TITLE_16",
  "CACHE_HISTORY_TITLE_20",
  "CACHE_HISTORY_DESCRIPTION_16",
  "CACHE_LEDGER_CASH_ALPHA",
  "CACHE_SELECTED_DECISION_BETA",
  "CACHE_OUTCOME_BETA",
  "CACHE_PRESSURE_ARC_ALPHA",
  "CACHE_PRESSURE_SUMMARY_ALPHA",
  "事业上出现一次更高收益但更高不确定性的跃迁机会。"
]) {
  assert.match(v1Prompt, new RegExp(expected));
}
assert.doesNotMatch(v1Prompt, /CACHE_HISTORY_TITLE_15/);
assert.match(v1DensePrompt, /CACHE_DENSE_REALITY_16/);
assert.match(v1DensePrompt, /CACHE_DENSE_REALITY_20/);

for (const requiredRule of [
  "canonicalFacts 是代码拥有的事实句",
  "sourceOutcomeId 必须等于上方已接受 outcome id",
  "choice.id 是内部稳定键",
  "arcSignals 只能提出",
  "期权必须走生命周期事件",
  "attributes 必须由上一步选择和本轮现实后果共同决定"
]) {
  assert.match(v1Prompt, new RegExp(requiredRule));
}
assert.match(v1Prompt, /crossroads_opportunity 模式契约/);
assert.match(v1Prompt, /type: career_venture_pressure/);
assert.doesNotMatch(v1Prompt, /health_forced_pause/);
assert.match(v1Prompt, /Story Context Pack/);

const twentiethRequest = buildNextNodePromptRequest(twentieth);
assert.notEqual(typeof twentiethRequest, "string");
if (typeof twentiethRequest !== "string") {
  for (const dynamicValue of [
    "CACHE_HISTORY_DESCRIPTION_16",
    "CACHE_LEDGER_CASH_ALPHA",
    "CACHE_SELECTED_DECISION_BETA",
    "CACHE_OUTCOME_BETA",
    "CACHE_PRESSURE_ARC_ALPHA",
    "CACHE_MILESTONE_CAREER_ALPHA"
  ]) {
    assert.doesNotMatch(twentiethRequest.systemPrefix, new RegExp(dynamicValue));
    assert.match(twentiethRequest.userPrompt, new RegExp(dynamicValue));
  }

  const orderedSections = [
    "【平行宇宙既往旅程】",
    "CACHE_HISTORY_TITLE_16",
    "【当前精神五维能量值】",
    "【当前财务快照，单位：万元，按当前购买力】",
    "CACHE_LEDGER_CASH_ALPHA",
    "【上一步做出的命运裁决】",
    "CACHE_SELECTED_DECISION_BETA",
    "CACHE_OUTCOME_BETA",
    "【Story Context Pack】",
    "【本轮 Event Intent 数据】",
    "【输出前检查】"
  ];
  let previousIndex = -1;
  for (const section of orderedSections) {
    const currentIndex = twentiethRequest.userPrompt.indexOf(section);
    assert.ok(currentIndex > previousIndex, `${section} moved before the required prompt context`);
    previousIndex = currentIndex;
  }
}

const retryPrompt = `${v1Prompt}\n\n【上一次返回不完整，必须重新生成】`;
assert.ok(retryPrompt.startsWith(v1Prompt));
