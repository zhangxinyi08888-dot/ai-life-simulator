import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, UserInitialData } from "../../types";
import { generateNextNode as generateNextNodeProduction, generateQuestions, narrativeRequiresCareerTransition, startSimulation, synthesizeSelectedCareerTransition, synthesizeSelectedPersonalIncomeProposal } from "./simulationService";
import { generateNextNodeWithEventOutcomes as generateNextNode } from "./testEventOutcomeAdapter";
import { deriveWealthScore, estimateFinancialStateFromWealth, normalizeInitialFinancialState } from "../../utils/financialState";
import { isFinancialGateGenerationError } from "../../utils/generationRetry";
import { queryDynamicLifeEvent } from "../../data/lifeEvents";
import { createSelectionEntropy } from "../../config/lineMixPolicy";
import { buildBranchFingerprint } from "../../utils/timelineAdvance";
import {
  createExplorationProgression,
  relationshipCheckpointKey
} from "../../domain/relationship/relationshipLifecycle";

const userData: UserInitialData = {
  birthday: "1995-05-20",
  birthtime: "08:30",
  gender: "女",
  currentSituation: "想重新选择职业路径",
  isReturnToPast: true,
  targetAgeNode: "大学毕业",
  regressionNodeKey: "career",
  regressionAge: 22,
  regressionSituation: "毕业时在稳定工作和喜欢的行业之间犹豫",
  regressionChoices: "想试试内容行业",
  coreStoryFocus: "career",
  milestones: [{ id: "career", title: "第一份工作", content: "进了一家传统公司" }]
};

assert.equal(narrativeRequiresCareerTransition({
  narrativeText: "31岁8个月，你选择了成都那家创业公司的offer，税后月薪9000元。",
  currentStatus: "student"
}), true);
assert.equal(narrativeRequiresCareerTransition({
  narrativeText: "你选择保持当前工作节奏，暂不考虑新的机会。",
  currentStatus: "employed"
}), false);
assert.equal(narrativeRequiresCareerTransition({
  narrativeText: "你辞别成都来到深圳。新公司做跨境电商SaaS，你负责前端开发。",
  currentStatus: "student"
}), true);
assert.equal(synthesizeSelectedCareerTransition({
  selectedDecision: "继续稳步提升技术深度，争取明年带团队",
  narrativeText: "36岁2个月，你正式成为数据可视化组的技术负责人，带4个人的小组。",
  acceptedOutcomeId: "continue_technical_depth",
  effectiveAtAgeInMonths: 444,
  currentStatus: "student"
})?.toStatus, "employed");

const questions = await generateQuestions(userData, {
  callAiJson: async (prompt) => {
    assert.match(prompt, /1995-05-20/);
    return {
      text: JSON.stringify({
        questions: [
          { question: "你当时最怕什么？", suggestions: ["收入不稳", "家人反对", "能力不够"] }
        ]
      })
    };
  }
});

assert.deepEqual(questions, {
  questions: [
    { question: "你当时最怕什么？", suggestions: ["收入不稳", "家人反对", "能力不够"] }
  ]
});

let questionAttempts = 0;
const retriedQuestions = await generateQuestions(userData, {
  callAiJson: async () => {
    questionAttempts += 1;
    if (questionAttempts === 1) {
      return {
        text: JSON.stringify({
          questions: [
            { question: "", suggestions: [] },
            { question: "", suggestions: [] },
            { question: "", suggestions: [] }
          ]
        })
      };
    }

    return {
      text: JSON.stringify({
        questions: [
          {
            question: "当时最影响你选择的现实限制是什么？",
            suggestions: ["家里希望我先稳定下来，但我自己想去喜欢的行业。"]
          },
          {
            question: "那时你遇到压力通常怎么反应？",
            suggestions: ["我表面说没事，实际会自己反复纠结。"]
          },
          {
            question: "当时你有哪些能力、兴趣或资源？",
            suggestions: ["我喜欢写东西，但没有成熟作品，也缺少行业人脉。"]
          }
        ]
      })
    };
  }
});

assert.equal(questionAttempts, 2);
assert.equal(retriedQuestions.questions[0]?.question, "当时最影响你选择的现实限制是什么？");

const answers: QuestionTurn[] = [
  { id: 1, question: "你当时最怕什么？", answer: "怕收入不稳，也怕后悔。" }
];

let startAttempts = 0;
const started = await startSimulation(userData, answers, {
  callAiJson: async (prompt) => {
    startAttempts += 1;
    if (startAttempts === 1) {
      assert.doesNotMatch(prompt, /上一次返回不完整/);
      assert.match(prompt, /initialFinancialState/);
      return {
        text: JSON.stringify({
          initialAttributes: { happiness: 45, intelligence: 72, wealth: 38, relation: 56, health: 68 },
          startNode: {
            age: 22,
            stage: "毕业选择",
            title: "第一份工作的岔路",
            description: "她拿着录用通知，反复比较通勤、工资和成长空间。",
            attributes: { happiness: 45, intelligence: 72, wealth: 38, relation: 56, health: 68 },
            isEndingNode: false
          }
        })
      };
    }

    assert.match(prompt, /上一次返回不完整/);
    return {
      text: JSON.stringify({
        initialAttributes: { happiness: 45, intelligence: 72, wealth: 38, relation: 56, health: 68 },
        startNode: {
          age: 22,
          stage: "毕业选择",
          title: "第一份工作的岔路",
          description: "她拿着录用通知，反复比较通勤、工资和成长空间。",
          choices: [
            { id: "A", text: "先去稳定公司攒经验", impactSummary: "稳步入行" },
            { id: "B", text: "转向内容行业实习", impactSummary: "冒险转向" },
            { id: "C", text: "边工作边准备跳槽", impactSummary: "双线准备" }
          ],
          attributes: { happiness: 45, intelligence: 72, wealth: 38, relation: 56, health: 68 },
          isEndingNode: false
        }
      })
    };
  }
});

assert.equal(startAttempts, 2);
assert.equal(started.initialAttributes.wealth, 35);
assert.equal(started.initialAttributes.wealth, started.startNode.attributes.wealth);
assert.equal(started.startNode.choices.length, 3);
assert.equal(started.startNode.age, 22);
assert.equal(started.startNode.financialLedgerMode, "authoritative");
assert.equal(started.startNode.financialLedger?.asOfAgeInMonths, 22 * 12);
assert.equal(started.startNode.financialLedger?.incomeSources[0]?.linkedCareerStateId, started.startNode.worldStateSnapshot?.currentCareerStateId);

let semanticChoiceStartCalls = 0;
const semanticChoiceStarted = await startSimulation(userData, answers, {
  callAiJson: async (prompt) => {
    semanticChoiceStartCalls += 1;
    if (prompt.includes("choiceTextRepairs")) {
      assert.match(prompt, /stay_in_current_role/);
      assert.match(prompt, /\[0,1,2\]/);
      return {
        text: JSON.stringify({
          choiceTextRepairs: [
            { index: 0, text: "留在现有岗位继续积累并争取期权兑现" },
            { index: 1, text: "接受内部转岗，进入新的业务方向" },
            { index: 2, text: "加入更大的外部平台，加快职业成长" }
          ]
        })
      };
    }
    return {
      text: JSON.stringify({
        initialAttributes: { happiness: 50, intelligence: 72, wealth: 45, relation: 56, health: 68 },
        startNode: {
          age: 22,
          stage: "毕业选择",
          title: "岗位与新机会",
          description: "现有岗位、内部转岗和外部平台同时摆在面前，你需要确认下一阶段的投入方向。",
          choices: [
            { id: "stay_in_current_role", impactSummary: "专注现岗", decisionIntent: "career:stay:current_role" },
            { id: "accept_new_role_transfer", impactSummary: "转岗新业", decisionIntent: "career:transfer:new_role" },
            { id: "startup_for_larger_platform", impactSummary: "跳槽大平台", decisionIntent: "career:join:larger_platform" }
          ],
          attributes: { happiness: 50, intelligence: 72, wealth: 45, relation: 56, health: 68 },
          isEndingNode: false
        }
      })
    };
  }
});
assert.equal(semanticChoiceStartCalls, 2);
assert.deepEqual(semanticChoiceStarted.startNode.choices.map((choice) => choice.id), [
  "stay_in_current_role",
  "accept_new_role_transfer",
  "startup_for_larger_platform"
]);
assert.deepEqual(semanticChoiceStarted.startNode.choices.map((choice) => choice.text), [
  "留在现有岗位继续积累并争取期权兑现",
  "接受内部转岗，进入新的业务方向",
  "加入更大的外部平台，加快职业成长"
]);

const relationshipStarted = await startSimulation({
  ...userData,
  regressionAge: 26,
  regressionNodeKey: "relationship",
  regressionSituation: "伴侣希望我放弃外地晋升，我们正在讨论是否继续这段关系",
  regressionChoices: "留在本地；短期外派；结束关系",
  coreStoryFocus: "relationship"
}, [{ id: 1, question: "关系背景？", answer: "我们交往四年，目前仍是伴侣。" }], {
  callAiJson: async () => ({
    text: JSON.stringify({
      initialAttributes: { happiness: 50, intelligence: 70, wealth: 45, relation: 60, health: 68 },
      startNode: {
        age: 26,
        stage: "关系选择",
        title: "外派与关系",
        description: "你拿到外派机会，伴侣希望你留在本地，你们需要决定是否继续这段关系。",
        choices: [
          { id: "A", text: "放弃外派，继续和伴侣共同生活", impactSummary: "留守关系" },
          { id: "B", text: "接受一年外派，年底再评估关系", impactSummary: "短期分隔" },
          { id: "C", text: "接受长期调任，如果对方无法接受就和平分手", impactSummary: "远调发展" }
        ],
        attributes: { happiness: 50, intelligence: 70, wealth: 45, relation: 60, health: 68 },
        isEndingNode: false
      }
    })
  })
});
assert.equal(relationshipStarted.startNode.worldStateSnapshot?.relationships[0]?.status, "active");
assert.equal(relationshipStarted.startNode.choices[0].eventOutcomeId, undefined);
assert.equal(relationshipStarted.startNode.choices[2].eventOutcomeId, "end_existing_romantic_relationship");
assert.deepEqual(relationshipStarted.startNode.choices[2].expectedWorldDeltaTypes, ["relationship_change"]);

const mortgageStarted = await startSimulation({
  ...userData,
  regressionAge: 24,
  regressionSituation: "刚背上房贷，正在考虑创业"
}, [{ id: 1, question: "当时财务情况？", answer: "我年薪税后约38万元，房贷余额210万元，每月还款1.3万元，家庭备用金约35万元。" }], {
  callAiJson: async () => ({
    text: JSON.stringify({
      initialAttributes: { happiness: 50, intelligence: 70, wealth: 45, relation: 55, health: 68 },
      initialFinancialState: {
        cashWan: 35, investmentAssetsWan: 5, propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0,
        totalDebtWan: 0, annualAfterTaxIncomeWan: 38, annualDisposableIncomeWan: 20, annualCoreExpenseWan: 18,
        employmentStatus: "employed", incomeStability: "stable", isEstimated: false
      },
      startNode: {
        age: 24, stage: "创业选择", title: "房贷与创业",
        description: "她刚背上房贷，在稳定工作和创业验证之间衡量现金流风险。",
        choices: [
          { id: "A", text: "留职验证", impactSummary: "保守验证" },
          { id: "B", text: "辞职创业", impactSummary: "全力投入" },
          { id: "C", text: "内部创业", impactSummary: "借力试水" }
        ],
        attributes: { happiness: 50, intelligence: 70, wealth: 45, relation: 55, health: 68 },
        isEndingNode: false
      }
    })
  })
});
assert.equal(mortgageStarted.startNode.financialState?.totalDebtWan, 210);
assert.equal(mortgageStarted.startNode.financialLedger?.debtAccounts[0]?.id, "opening_mortgage");
assert.equal(mortgageStarted.startNode.financialLedger?.debtAccounts[0]?.repaymentPolicy.monthlyPaymentWan, 1.3);
assert.equal(mortgageStarted.startNode.financialLedger?.assetAccounts.some((account) => account.type === "property"), true);
// The model's opening annualCoreExpenseWan=18 has no authority.  This user
// supplied opening only establishes mortgage service, so the derived figure
// uses the accepted adult basic floor (4.2/year) plus mortgage interest.
assert.equal(mortgageStarted.startNode.financialState?.annualCoreExpenseWan, 4.2);
assert.equal(mortgageStarted.startNode.financialState?.annualDisposableIncomeWan, 28.7);

const openingNarrativeAuthorityStarted = await startSimulation({
  ...userData,
  regressionAge: 24,
  regressionSituation: "在稳定工作和创业机会之间犹豫，需要保留现金流"
}, [{
  id: 1,
  question: "当时有哪些持续支出？",
  answer: "我有房租和父母医疗支出，每月必须保留稳定现金流，但已经存下约18万元。"
}], {
  callAiJson: async () => ({
    text: JSON.stringify({
      initialAttributes: { happiness: 50, intelligence: 70, wealth: 45, relation: 55, health: 68 },
      initialFinancialState: {
        cashWan: 18, investmentAssetsWan: 0, propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0,
        totalDebtWan: 0, annualAfterTaxIncomeWan: 24, annualDisposableIncomeWan: 6, annualCoreExpenseWan: 18,
        employmentStatus: "employed", incomeStability: "stable", isEstimated: false
      },
      startNode: {
        age: 24, stage: "职业选择", title: "稳定与冒险的岔路口",
        description: "每月房租四千，父母医疗和家用支出三千，加上日常开销，每月能存下五千左右。",
        choices: [
          { id: "A", text: "留在现有岗位", impactSummary: "保持稳定" },
          { id: "B", text: "加入创业团队", impactSummary: "承担风险" },
          { id: "C", text: "先兼职尝试", impactSummary: "渐进验证" }
        ],
        attributes: { happiness: 50, intelligence: 70, wealth: 45, relation: 55, health: 68 },
        isEndingNode: false
      }
    })
  })
});
assert.equal(
  openingNarrativeAuthorityStarted.startNode.description,
  "你仍在承担日常生活、住房与医疗等持续支出，具体金额仍待确认。"
);
assert.equal(openingNarrativeAuthorityStarted.startNode.financialLedger?.expenseCommitments.find((item) => item.type === "housing")?.monthlyAmountWan, 0.35);
assert.equal(openingNarrativeAuthorityStarted.startNode.financialLedger?.expenseCommitments.find((item) => item.type === "healthcare")?.monthlyAmountWan, 0.12);
assert.equal(openingNarrativeAuthorityStarted.startNode.financialLedger?.expenseCommitments.some((item) => item.type === "dependent_support"), false);

const attributes: LifeAttributes = { happiness: 50, intelligence: 70, wealth: 42, relation: 55, health: 64 };
const history: HistoryItem[] = [
  {
    age: 22,
    stage: "毕业选择",
    title: "第一份工作的岔路",
    description: "她拿着录用通知，反复比较通勤、工资和成长空间。",
    selectedChoice: "转向内容行业实习",
    attributes,
    choices: [{ id: "A", text: "转向内容行业实习", impactSummary: "内容试水", eventOutcomeId: "accept_content_trial" }],
    isEndingNode: false
  }
];
let capturedNextPrompt = "";
const nextGenerationStages: string[] = [];
const nextNarrativePreviews: Array<{ title?: string; paragraphs: string[] }> = [];

const nextNode = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "转向内容行业实习",
  nodeIndex: 1
}, {
  onGenerationStage: (stage) => nextGenerationStages.push(stage),
  onNarrativeProgress: (preview) => nextNarrativePreviews.push(preview),
  callAiJson: async (prompt) => {
    capturedNextPrompt = prompt;
    const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || 23 * 12);
    return {
      text: JSON.stringify({
        age: 23,
        stage: "试错开局",
        title: "新行业的第一年",
        description: "目前存款约90万；她进入小团队做基础内容执行，收入变低，但每天都能接触真实项目。她收到一万元项目奖金。",
        choices: [
          { id: "A", text: "继续留在小团队磨作品", impactSummary: "低薪成长" },
          { id: "B", text: "回到稳定岗位补现金流", impactSummary: "现实回撤" },
          { id: "C", text: "兼职接单扩展人脉", impactSummary: "双线积累" }
        ],
        attributes,
        financialEventProposals: [{
          id: "content_bonus",
          kind: "one_off_income_received",
          effectiveAtAgeInMonths: targetAgeInMonths,
          payload: { destinationCashAccountId: "primary_cash", amountWan: 1 },
          sourceOutcomeId: "accept_content_trial",
          evidence: "她收到一万元项目奖金。",
          confidence: 0.9
        }],
        isEndingNode: false
      })
    };
  }
});

assert.match(capturedNextPrompt, /Story Context Pack/);
assert.match(capturedNextPrompt, /追问补全事实/);
assert.match(capturedNextPrompt, /最近 5 个历史节点/);
assert.match(capturedNextPrompt, /至少显性使用 1 条追问答案/);
assert.match(capturedNextPrompt, /当前财务快照/);
assert.ok(nextNode.financialState);
assert.equal(nextNode.financialLedgerMode, "authoritative");
assert.equal(nextNode.financialLedger?.asOfAgeInMonths, nextNode.ageInMonths);
assert.equal(nextNode.financialSignals, undefined);
assert.equal(nextNode.financialChange, undefined);
assert.ok(nextNode.financialLedger?.recentTransactions.at(-1)?.eventIds.includes("accepted_content_bonus"));
assert.doesNotMatch(nextNode.description, /存款约90万/);
assert.match(nextNode.description, /现金流|现金缓冲|储蓄|负债状态/);
assert.equal(nextNode.attributes.wealth, Math.min(attributes.wealth + 12, deriveWealthScore(nextNode.financialState!)));
assert.deepEqual(nextGenerationStages, ["preparing", "generating", "validating", "finalizing"]);
assert.equal(nextNarrativePreviews.at(-1)?.title, "新行业的第一年");
assert.match(nextNarrativePreviews.at(-1)?.paragraphs[0] || "", /小团队做基础内容执行/);

// A migration-only salary is deliberately quarantined after the third
// unconfirmed material node.  The acceptance gate must remain strict, but
// its retry prompt must tell the model exactly how to make the existing source
// authoritative rather than silently carrying it forward or stalling forever.
const legacyIncomeRetryLedger = structuredClone(nextNode.financialLedger!);
const legacyIncomeRetryWorld = structuredClone(nextNode.worldStateSnapshot!);
const legacyIncomeRetryCareerId = legacyIncomeRetryWorld.currentCareerStateId!;
const legacyIncomeRetryCareer = legacyIncomeRetryWorld.careerStates.find((state) => state.id === legacyIncomeRetryCareerId)!;
legacyIncomeRetryCareer.employmentStatus = "employed";
legacyIncomeRetryWorld.currentEmploymentStatus = "employed";
legacyIncomeRetryLedger.asOfAgeInMonths = 335;
legacyIncomeRetryLedger.incomeSources = [{
  id: "legacy_recurring_income",
  type: "other",
  displayName: "旧版持续收入聚合",
  annualNetAmountWan: 30,
  accrualPolicy: "annual",
  activeFromAgeInMonths: 312,
  status: "active",
  linkedCareerStateId: legacyIncomeRetryCareerId,
  factStatus: "estimated",
  lastConfirmedAtAgeInMonths: 312,
  evidence: [{
    source: "legacy_migration",
    reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION",
    confidence: 0.5
  }]
}];
legacyIncomeRetryLedger.recentTransactions = [
  {
    id: "legacy_income_material_1",
    simulationTransactionId: "legacy_income_material_1",
    eventIds: [],
    periodStartAgeInMonths: 312,
    periodEndAgeInMonths: 324,
    cashDeltaWan: 0,
    assetDeltaWan: 0,
    debtDeltaWan: 0,
    incomeWan: 0,
    expenseWan: 0,
    valuationChangeWan: 0,
    nonCashGainLossWan: 0,
    netWorthDeltaWan: 0,
    evidence: []
  },
  {
    id: "legacy_income_material_2",
    simulationTransactionId: "legacy_income_material_2",
    eventIds: [],
    periodStartAgeInMonths: 324,
    periodEndAgeInMonths: 335,
    cashDeltaWan: 0,
    assetDeltaWan: 0,
    debtDeltaWan: 0,
    incomeWan: 0,
    expenseWan: 0,
    valuationChangeWan: 0,
    nonCashGainLossWan: 0,
    netWorthDeltaWan: 0,
    evidence: []
  }
];
const legacyIncomeRetryChoice = nextNode.choices[0]!;
const legacyIncomeRetryState = {
  ...structuredClone(nextNode.financialState!),
  asOfAgeInMonths: 335,
  annualAfterTaxIncomeWan: 30,
  annualDisposableIncomeWan: 25.8,
  annualCoreExpenseWan: 4.2,
  employmentStatus: "employed" as const,
  incomeStability: "stable" as const,
  isEstimated: true
};
const legacyIncomeRetryHistory: HistoryItem[] = [{
  ...structuredClone(nextNode),
  age: 27,
  ageInMonths: 335,
  selectedChoice: legacyIncomeRetryChoice.text,
  selectedChoiceId: legacyIncomeRetryChoice.id,
  selectedEventOutcomeId: legacyIncomeRetryChoice.eventOutcomeId,
  financialLedger: legacyIncomeRetryLedger,
  financialState: legacyIncomeRetryState,
  worldStateSnapshot: legacyIncomeRetryWorld
}];
const legacyIncomeRetryPrompts: string[] = [];
const legacyIncomeRetryGateDecisions: string[] = [];
let legacyIncomeRetryCalls = 0;
const legacyIncomeRetryNode = await generateNextNode({
  userData,
  answers,
  history: legacyIncomeRetryHistory,
  currentAttributes: legacyIncomeRetryHistory[0]!.attributes,
  selectedDecision: legacyIncomeRetryChoice.text,
  nodeIndex: 1,
  simulationSeed: "legacy-income-enforced-retry"
}, {
  financialNodeGateMode: "enforced",
  // This regression isolates the legacy-income retry contract.  The V4
  // scheduled expense-review projection has its own enforced-mode coverage
  // below and must not become a second, unrelated retry subject here.
  expenseLifecycleMode: "off",
  onFinancialGateDecision: (decision) => {
    legacyIncomeRetryGateDecisions.push(decision.disposition);
  },
  callAiJson: async (prompt) => {
    legacyIncomeRetryCalls += 1;
    legacyIncomeRetryPrompts.push(prompt);
    const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || 336);
    const confirmsIncome = prompt.includes("当前职业收入必须在本次重生中确认");
    return {
      text: JSON.stringify({
        age: Math.floor(targetAgeInMonths / 12),
        ageInMonths: targetAgeInMonths,
        // Keep this financial retry fixture outside the relationship-authority
        // surface.  Relationship wording would intentionally trigger the
        // separate deterministic relationship repair before this test reaches
        // the income gate.
        stage: "工作与生活节奏",
        title: confirmsIncome ? "稳定收入下的生活安排" : "工作节奏调整",
        description: confirmsIncome
          ? "你继续在当前岗位承担项目，并将每周休息时间固定下来。你的年税后收入稳定在30万元。"
          : "你继续在当前岗位承担项目，并将每周休息时间固定下来。",
        choices: [
          { id: "A", text: "维持当前节奏并共同储蓄", impactSummary: "稳步推进" },
          { id: "B", text: "调整工作时间留给关系", impactSummary: "平衡投入" },
          { id: "C", text: "暂缓额外项目恢复精力", impactSummary: "留出余地" }
        ],
        attributes: legacyIncomeRetryHistory[0]!.attributes,
        financialEventProposals: [],
        isEndingNode: false
      })
    };
  }
});
assert.ok(legacyIncomeRetryCalls >= 2, "the strict preview must regenerate before accepting explicit source evidence");
assert.ok(legacyIncomeRetryPrompts.some((prompt) => /仍在职的迁移估算收入需要本节点明确确认/.test(prompt)));
const legacyIncomeRetryPrompt = legacyIncomeRetryPrompts.find((prompt) => /当前职业收入必须在本次重生中确认/.test(prompt));
assert.ok(legacyIncomeRetryPrompt, "the retry must require confirmation of the current legacy income source");
assert.match(legacyIncomeRetryPrompt, /incomeSourceId=legacy_recurring_income/);
assert.match(legacyIncomeRetryPrompt, /年税后收入稳定在30万元/);
assert.deepEqual(legacyIncomeRetryGateDecisions, ["regenerate", "accept"]);
const legacyIncomeRetrySource = legacyIncomeRetryNode.financialLedger!.incomeSources.find((source) => source.id === "legacy_recurring_income")!;
assert.equal(legacyIncomeRetrySource.annualNetAmountWan, 30);
assert.equal(legacyIncomeRetrySource.linkedCareerStateId, legacyIncomeRetryCareerId);
assert.equal(legacyIncomeRetrySource.factStatus, "known");
assert.equal(legacyIncomeRetrySource.accrualReviewStatus, "normal");

// An overdue policy-floor baseline is a deterministic nonzero safeguard, not
// a narrator fact that can be reconfirmed.  Once its open review has already
// been observed twice, an ordinary node must still commit exactly once with a
// review disposition; exhausting financial-gate regeneration here caused the
// user-visible Venture pause found in the fresh v10 run.
const policyFloorReviewBaseline = structuredClone(nextNode);
const policyFloorReviewChoice = policyFloorReviewBaseline.choices[0]!;
const policyFloorReviewStartAge = policyFloorReviewBaseline.ageInMonths!;
const policyFloorReviewLedger = policyFloorReviewBaseline.financialLedger!;
const policyFloorReviewAccountId = "opening_adult_basic_living_protagonist";
const policyFloorReviewDueAt = policyFloorReviewStartAge - 12;
const policyFloorTemplate = policyFloorReviewLedger.expenseCommitments[0]!;
policyFloorReviewLedger.expenseCommitments = [{
  ...policyFloorTemplate,
  id: policyFloorReviewAccountId,
  type: "basic_living",
  displayName: "个人基础生活支出（待确认）",
  monthlyAmountWan: 0.35,
  activeFromAgeInMonths: policyFloorReviewStartAge - 36,
  status: "active",
  factStatus: "needs_review",
  responsibilityKey: "adult_basic_living:protagonist",
  responsibilityKind: "adult_basic_living",
  amountBasis: "policy_floor",
  amountSourceIds: ["opening_policy_adult_basic_living"],
  estimationPolicyId: "cn_conservative_basic_living@1",
  financialScope: "personal",
  accrualReviewStatus: "review_due",
  confirmedMonthlyAmountWan: undefined,
  lastReviewedAtAgeInMonths: policyFloorReviewDueAt,
  nextReviewAtAgeInMonths: policyFloorReviewDueAt,
  evidence: [{
    source: "system_policy",
    reasonCode: "OPENING_POLICY_FLOOR",
    confidence: 1,
    financialScope: "personal"
  }]
}];
policyFloorReviewLedger.unresolvedIssues = [{
  id: `expense_review_due_${policyFloorReviewAccountId}`,
  code: "PENDING_FACT",
  severity: "warning",
  status: "open",
  relatedProposalIds: [],
  relatedAccountIds: [policyFloorReviewAccountId],
  summary: "持续支出 个人基础生活支出（待确认） 已到复核时点；继续按现有金额计提，等待金额或责任范围确认",
  createdAtAgeInMonths: policyFloorReviewDueAt,
  lastObservedAtAgeInMonths: policyFloorReviewStartAge,
  occurrenceCount: 2
}];
const policyFloorReviewHistory: HistoryItem[] = [{
  ...policyFloorReviewBaseline,
  selectedChoice: policyFloorReviewChoice.text,
  selectedChoiceId: policyFloorReviewChoice.id,
  selectedEventOutcomeId: policyFloorReviewChoice.eventOutcomeId
}];
const policyFloorReviewCommittedBefore = policyFloorReviewLedger.committedTransactionIds.length;
const policyFloorReviewTransactionsBefore = policyFloorReviewLedger.recentTransactions.length;
const policyFloorGateDecisions: Array<{ disposition: string; reasonCodes: string[] }> = [];
let policyFloorReviewCalls = 0;
const policyFloorReviewNode = await generateNextNode({
  userData,
  answers,
  history: policyFloorReviewHistory,
  currentAttributes: policyFloorReviewHistory[0]!.attributes,
  selectedDecision: policyFloorReviewChoice.text,
  nodeIndex: 2,
  simulationSeed: "overdue-policy-floor-accept-with-review"
}, {
  financialNodeGateMode: "enforced",
  expenseLifecycleMode: "enforced",
  onFinancialGateDecision: (decision) => policyFloorGateDecisions.push({
    disposition: decision.disposition,
    reasonCodes: decision.reasonCodes
  }),
  callAiJson: async (prompt) => {
    policyFloorReviewCalls += 1;
    const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || policyFloorReviewStartAge + 12);
    return {
      text: JSON.stringify({
        age: Math.floor(targetAgeInMonths / 12),
        ageInMonths: targetAgeInMonths,
        stage: "日常节奏",
        title: "重新安排一周的时间",
        description: "你把周末留给整理作品和散步，也重新安排了下一阶段的学习计划。",
        choices: [
          { id: "A", text: "继续按当前节奏积累作品", impactSummary: "稳定投入" },
          { id: "B", text: "报名一个短期课程", impactSummary: "拓展视野" },
          { id: "C", text: "多参加线下交流", impactSummary: "补充连接" }
        ],
        attributes: policyFloorReviewHistory[0]!.attributes,
        financialEventProposals: [],
        isEndingNode: false
      })
    };
  }
});
assert.equal(policyFloorReviewCalls, 1, "a policy floor review must not trigger an invented confirmation or regeneration");
assert.deepEqual(policyFloorGateDecisions.map((item) => item.disposition), ["accept_with_review"]);
assert.ok(
  policyFloorGateDecisions[0]!.reasonCodes.includes(`expense_review_due_${policyFloorReviewAccountId}`),
  `the open policy review must remain visible in gate telemetry: ${JSON.stringify(policyFloorGateDecisions)}`
);
const policyFloorReviewAccount = policyFloorReviewNode.financialLedger!.expenseCommitments.find((item) => (
  item.id === policyFloorReviewAccountId
));
const policyFloorReviewIssue = policyFloorReviewNode.financialLedger!.unresolvedIssues.find((item) => (
  item.id === `expense_review_due_${policyFloorReviewAccountId}`
));
assert.equal(policyFloorReviewAccount?.status, "active");
assert.equal(policyFloorReviewAccount?.monthlyAmountWan, 0.35, "the floor remains a nonzero recurring cash outflow");
assert.equal(policyFloorReviewIssue?.status, "open", "the unknown real-world amount remains an explicit review item");
assert.equal(policyFloorReviewIssue?.occurrenceCount, 3, "the accepted period observes the one stable review exactly once");
assert.equal(policyFloorReviewNode.financialLedger!.committedTransactionIds.length, policyFloorReviewCommittedBefore + 1);
assert.equal(policyFloorReviewNode.financialLedger!.recentTransactions.length, policyFloorReviewTransactionsBefore + 1);
assert.equal(policyFloorReviewNode.financialPeriodSummary?.transactionIds.length, 1);
assert.equal(policyFloorReviewNode.financialPeriodSummary?.periodStartAgeInMonths, policyFloorReviewStartAge);
assert.ok((policyFloorReviewNode.ageInMonths || 0) > policyFloorReviewStartAge, "accepted policy review advances time");
assert.ok((policyFloorReviewNode.financialPeriodSummary?.coreExpenseWan || 0) > 0, "accepted policy review accrues the active floor once");

// Shadow runs the exact V4 reconciler/validator/reducer plan, but that plan
// must remain prospective: a newly narrated personal lease appears in
// telemetry and never becomes an authoritative commitment in this node.
const shadowLifecycleChoice = nextNode.choices[0]!;
const shadowLifecycleBaseline = structuredClone(nextNode);
const shadowLifecycleLegacyExpense = shadowLifecycleBaseline.financialLedger?.expenseCommitments[0];
assert.ok(shadowLifecycleLegacyExpense, "fixture must carry an opening expense commitment");
// Isolate the shadow-plan test from the separate legacy-aggregate migration
// rule.  A V4 basic-living account is the normal post-migration baseline;
// its coverage is known, so a new housing responsibility can be previewed.
if (shadowLifecycleBaseline.financialLedger) {
  shadowLifecycleBaseline.financialLedger.expenseCommitments = [{
    ...shadowLifecycleLegacyExpense,
    id: "shadow_test_basic_living",
    type: "basic_living",
    displayName: "个人基础生活支出",
    responsibilityKey: "adult_basic_living:main",
    responsibilityKind: "adult_basic_living",
    amountBasis: "policy_floor",
    amountSourceIds: ["shadow_test_basic_living_floor"],
    estimationPolicyId: "adult_basic_living_v1",
    financialScope: "personal",
    accrualReviewStatus: "normal",
    nextReviewAtAgeInMonths: shadowLifecycleLegacyExpense.activeFromAgeInMonths,
    evidence: [{
      source: "system_policy",
      reasonCode: "SHADOW_TEST_BASIC_LIVING_FLOOR",
      confidence: 1,
      financialScope: "personal"
    }]
  }];
}
const shadowLifecycleHistory: HistoryItem[] = [{
  ...shadowLifecycleBaseline,
  selectedChoice: shadowLifecycleChoice.text,
  selectedChoiceId: shadowLifecycleChoice.id,
  selectedEventOutcomeId: shadowLifecycleChoice.eventOutcomeId
}];
const shadowLifecycleLedgerBefore = structuredClone(shadowLifecycleHistory[0]!.financialLedger);
const shadowLifecycleNode = await generateNextNode({
  userData,
  answers,
  history: shadowLifecycleHistory,
  currentAttributes: shadowLifecycleHistory[0]!.attributes,
  selectedDecision: shadowLifecycleChoice.text,
  nodeIndex: 2,
  simulationSeed: "expense-lifecycle-shadow-projected-diff"
}, {
  financialNodeGateMode: "shadow",
  expenseLifecycleMode: "shadow",
  callAiJson: async () => ({
    text: JSON.stringify({
      age: 24,
      stage: "独立生活安排",
      title: "签下新的租约",
      description: "你租下一间靠近公司的公寓，每月房租 6000 元，并已经搬入开始独立生活。",
      choices: [
        { id: "A", text: "先稳定现金流", impactSummary: "维持预算" },
        { id: "B", text: "继续积累职业能力", impactSummary: "长期成长" },
        { id: "C", text: "重新评估居住开支", impactSummary: "复核支出" }
      ],
      attributes: shadowLifecycleHistory[0]!.attributes,
      financialEventProposals: [],
      isEndingNode: false
    })
  })
});
const shadowLifecycleTelemetry = shadowLifecycleNode.financialProcessingMeta?.expenseLifecycleTelemetry;
assert.equal(shadowLifecycleTelemetry?.mode, "shadow");
assert.equal(
  shadowLifecycleTelemetry?.acceptedStartCount,
  1,
  `expected a validated V4 start in shadow telemetry: ${JSON.stringify(shadowLifecycleTelemetry)}`
);
assert.ok(
  shadowLifecycleTelemetry?.projectedCommitmentChanges.some((change) => (
    change.action === "start"
    && change.responsibilityKey === "primary_residence:main"
    && change.afterMonthlyAmountWan === 0.6
  )),
  `shadow telemetry must retain the prospective housing plan: ${JSON.stringify(shadowLifecycleTelemetry)}`
);
assert.ok(
  (shadowLifecycleTelemetry?.afterAnnualizedExpenseWan || 0)
  > (shadowLifecycleTelemetry?.beforeAnnualizedExpenseWan || 0),
  "shadow telemetry must expose the planned annual expense increase"
);
assert.equal(shadowLifecycleTelemetry?.baselineDownwardBlocked, false, "telemetry must not invent a baseline-protection block");
assert.deepEqual(shadowLifecycleTelemetry?.staleResponsibilityKeys, ["adult_basic_living:main"], "review telemetry must expose responsibility keys, not ledger IDs");
assert.equal(shadowLifecycleTelemetry?.schemaRejectedCount, 0, "valid lifecycle proposals must not be counted as schema rejects");
const shadowHousingCandidate = shadowLifecycleTelemetry?.candidates.find((candidate) => (
  candidate.responsibilityKey === "primary_residence:main"
));
assert.ok(shadowHousingCandidate, "shadow telemetry must persist the raw lifecycle candidate trace");
assert.equal(shadowHousingCandidate.reconcilerDisposition, "planned_start");
assert.equal(shadowHousingCandidate.amountBasis, "explicit_protagonist_share");
assert.equal(shadowHousingCandidate.sourceMonthlyAmountWan, 0.6);
assert.equal(shadowHousingCandidate.wouldBlock, false);
assert.ok(shadowHousingCandidate.evidenceReasonCodes.length > 0);
assert.equal(
  shadowLifecycleNode.financialLedger?.expenseCommitments.some((commitment) => commitment.responsibilityKey === "primary_residence:main"),
  false,
  "shadow V4 plan must not write a housing commitment into authority"
);
assert.equal(
  shadowLifecycleHistory[0]!.financialLedger?.expenseCommitments.some((commitment) => commitment.responsibilityKey === "primary_residence:main"),
  false,
  "shadow preview must not mutate the historical ledger input"
);
assert.deepEqual(
  shadowLifecycleHistory[0]!.financialLedger,
  shadowLifecycleLedgerBefore,
  "shadow preview must leave the historical ledger byte-for-byte intact"
);

// A model proposal that has already crossed the Accepted-event boundary is
// the first writer for its stable responsibility. The lifecycle detector sees
// the same completed rent sentence, but may not start a second account or
// accrue the rent twice in this node.
const directExpenseLifecycleBaseline = structuredClone(shadowLifecycleBaseline);
const directExpenseLifecycleHistory: HistoryItem[] = [{
  ...directExpenseLifecycleBaseline,
  selectedChoice: shadowLifecycleChoice.text,
  selectedChoiceId: shadowLifecycleChoice.id,
  selectedEventOutcomeId: shadowLifecycleChoice.eventOutcomeId
}];
const directExpenseOutcomeId = shadowLifecycleChoice.eventOutcomeId;
assert.ok(directExpenseOutcomeId, "fixture must retain the Accepted outcome id for a direct financial fact");
let directExpenseLifecycleCalls = 0;
const directExpenseLifecycleNode = await generateNextNode({
  userData,
  answers,
  history: directExpenseLifecycleHistory,
  currentAttributes: directExpenseLifecycleHistory[0]!.attributes,
  selectedDecision: shadowLifecycleChoice.text,
  nodeIndex: 2,
  simulationSeed: "expense-lifecycle-direct-first-writer"
}, {
  financialNodeGateMode: "shadow",
  expenseLifecycleMode: "enforced",
  callAiJson: async (prompt) => {
    directExpenseLifecycleCalls += 1;
    const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || 24 * 12);
    const directRentProposal = {
      id: "direct_lifecycle_rent",
      kind: "expense_commitment_started",
      effectiveAtAgeInMonths: targetAgeInMonths,
      payload: {
        id: "direct_lifecycle_primary_residence",
        type: "housing",
        displayName: "个人租房",
        monthlyAmountWan: 0.6,
        activeFromAgeInMonths: targetAgeInMonths,
        status: "active",
        factStatus: "known",
        evidence: [{
          source: "accepted_simulation_outcome",
          reasonCode: "DIRECT_LIFECYCLE_RENT",
          confidence: 1,
          financialScope: "personal",
          excerpt: "你已经签下靠近公司的个人租约，每月房租6000元。"
        }],
        responsibilityKey: "primary_residence:main",
        responsibilityKind: "primary_residence",
        amountBasis: "explicit_known",
        amountSourceIds: ["direct_lifecycle_rent_6000"],
        financialScope: "personal",
        accrualReviewStatus: "normal",
        confirmedMonthlyAmountWan: 0.6,
        lastConfirmedAtAgeInMonths: targetAgeInMonths,
        nextReviewAtAgeInMonths: targetAgeInMonths + 12
      },
      evidence: "你已经签下靠近公司的个人租约，每月房租6000元。",
      sourceOutcomeId: directExpenseOutcomeId,
      confidence: 1,
      financialScope: "personal"
    };
    if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
      return { text: JSON.stringify({ financialEventProposals: [directRentProposal] }) };
    }
    return {
      text: JSON.stringify({
        age: Math.floor(targetAgeInMonths / 12),
        ageInMonths: targetAgeInMonths,
        stage: "独立生活安排",
        title: "个人租约落定",
        description: "你已经签下靠近公司的个人租约，每月房租6000元，并已经搬入开始独立生活。",
        choices: [
          { id: "A", text: "先稳定现金流", impactSummary: "维持预算" },
          { id: "B", text: "继续积累职业能力", impactSummary: "长期成长" },
          { id: "C", text: "重新评估居住开支", impactSummary: "复核支出" }
        ],
        attributes: directExpenseLifecycleHistory[0]!.attributes,
        financialEventProposals: [directRentProposal],
        isEndingNode: false
      })
    };
  }
});
assert.equal(directExpenseLifecycleCalls, 1, "the direct Accepted rent fact must not trigger a duplicate-lifecycle repair");
assert.equal(directExpenseLifecycleNode.financialProcessingMeta?.expenseLifecycleTelemetry?.acceptedStartCount, 0,
  "the lifecycle plan must not add a second start for the direct responsibility");
const directResidenceCommitments = directExpenseLifecycleNode.financialLedger!.expenseCommitments.filter((commitment) => (
  commitment.status === "active" && commitment.responsibilityKey === "primary_residence:main"
));
assert.equal(directResidenceCommitments.length, 1, "one node may accrue a stable responsibility only once");
assert.equal(directResidenceCommitments[0]!.id, "direct_lifecycle_primary_residence");
assert.equal(directResidenceCommitments[0]!.monthlyAmountWan, 0.6);

const ordinaryHealthDrop = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "继续推进项目但暂时没有恢复安排",
  nodeIndex: 1,
  simulationSeed: "ordinary-health-cap"
}, {
  callAiJson: async () => ({
    text: JSON.stringify({
      age: 23,
      stage: "项目推进",
      title: "工作节奏持续紧张",
      description: "项目仍在推进，连续熬夜让疲惫感更加明显，但尚未出现需要强制停工的重大健康危机。",
      choices: [
        { id: "A", text: "维持当前安排并监测状态", impactSummary: "维持观察" },
        { id: "B", text: "减少并行任务调整节奏", impactSummary: "调整节奏" },
        { id: "C", text: "暂停部分任务寻求支持", impactSummary: "暂停求助" }
      ],
      attributes: { ...attributes, health: 30 },
      narrativeMeta: { recoveryState: "depleted", recoveryEvidence: ["连续熬夜"] },
      isEndingNode: false
    })
  })
});
assert.equal(ordinaryHealthDrop.attributes.health, 58);

const majorHealthDrop = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: { ...attributes, health: 29 },
  selectedDecision: "身体恶化后重新安排工作与治疗",
  nodeIndex: 1,
  simulationSeed: "major-health-cap"
}, {
  callAiJson: async () => ({
    text: JSON.stringify({
      age: 23,
      stage: "健康危机",
      title: "身体迫使节奏停下",
      description: "症状明显加重，医生要求立即降低活动强度并开始治疗，原有工作安排必须重新分配。",
      choices: [
        { id: "A", text: "了解风险后仍维持关键工作", impactSummary: "风险继续" },
        { id: "B", text: "限制工时并交出部分职责", impactSummary: "受限参与" },
        { id: "C", text: "暂停工作接受治疗恢复", impactSummary: "治疗恢复" }
      ],
      attributes: { ...attributes, health: 0 },
      narrativeMeta: { recoveryState: "depleted", recoveryEvidence: ["症状明显加重"] },
      isEndingNode: false
    })
  })
});
assert.equal(majorHealthDrop.eventMeta?.eventId, "health_forced_pause");
assert.equal(majorHealthDrop.eventMeta?.selectionKind, "forced");
assert.equal(majorHealthDrop.attributes.health, 17);
assert.equal(majorHealthDrop.narrativeMeta?.lifeIntensity, "high_tension");
assert.equal(majorHealthDrop.worldStateSnapshot?.pressureArcs[0]?.phasePolicyId, "health_crisis_v1");
assert.equal(majorHealthDrop.worldStateSnapshot?.pressureArcs[0]?.phaseId, "recovery");

const degradedFinanceCases: Array<{ label: string; financialChange?: unknown }> = [
  { label: "missing" },
  { label: "malformed", financialChange: { afterTaxIncomeWan: "12", reasons: [] } }
];

for (const testCase of degradedFinanceCases) {
  let callCount = 0;
  const degradedNode = await generateNextNode({
    userData,
    answers,
    history,
    currentAttributes: attributes,
    selectedDecision: "转向内容行业实习",
    nodeIndex: 1,
    simulationSeed: `finance-${testCase.label}`
  }, {
    relationshipDispatchFeatureFlags: { enableRomanceFormationEvents: false },
    callAiJson: async () => {
      callCount += 1;
      return {
        text: JSON.stringify({
          age: 23,
          stage: "试错开局",
          title: "新行业的第一年",
          description: "她进入小团队做基础内容执行，收入变低，但每天都能接触真实项目。",
          choices: [
            { id: "A", text: "继续留在小团队磨作品", impactSummary: "低薪成长" },
            { id: "B", text: "回到稳定岗位补现金流", impactSummary: "现实回撤" },
            { id: "C", text: "兼职接单扩展人脉", impactSummary: "双线积累" }
          ],
          attributes: { ...attributes, wealth: 88 },
          financialChange: testCase.financialChange,
          isEndingNode: false
        })
      };
    }
  });

  const previousFinancialState = estimateFinancialStateFromWealth(attributes.wealth, history[0].age * 12);
  assert.equal(callCount, 1);
  assert.notEqual(degradedNode.attributes.wealth, 88);
  assert.equal(degradedNode.financialState?.employmentStatus, previousFinancialState.employmentStatus);
  assert.equal(degradedNode.financialState?.isEstimated, true);
  assert.equal(degradedNode.financialSignals, undefined);
  assert.equal(degradedNode.financialChange, undefined);
  assert.equal(degradedNode.financialLedgerMode, "authoritative");
}

const studentFinancialState = normalizeInitialFinancialState({
  cashWan: 0.5,
  investmentAssetsWan: 0,
  propertyMarketValueWan: 0,
  businessAndOtherAssetsWan: 0,
  totalDebtWan: 0,
  annualAfterTaxIncomeWan: 0,
  annualDisposableIncomeWan: 0,
  annualCoreExpenseWan: 1.2,
  employmentStatus: "student",
  incomeStability: "unstable",
  isEstimated: true
}, 18 * 12, 40);
const studentHistory: HistoryItem[] = [{
  ...history[0],
  age: 18,
  ageInMonths: 18 * 12,
  title: "进入大学",
  description: "你进入大学学习会计专业。",
  financialState: studentFinancialState,
  attributes: { ...attributes, wealth: 40 }
}];
const studentFallbackCases = [
  { label: "missing-signals" },
  {
    label: "legacy-change",
    financialChange: {
      afterTaxIncomeWan: 0,
      livingExpenseWan: 2.4,
      medicalEducationExpenseWan: 0,
      interestAndFeesWan: 0,
      assetValueChangeWan: 0,
      otherNetChangeWan: 0,
      incomeStability: "unstable",
      reasons: ["按学生生活费估算"]
    }
  }
];

for (const testCase of studentFallbackCases) {
  const studentNode = await generateNextNode({
    userData: { ...userData, regressionAge: 18 },
    answers,
    history: studentHistory,
    currentAttributes: { ...attributes, wealth: 40 },
    selectedDecision: "继续完成大学学业",
    nodeIndex: 1,
    simulationSeed: `student-support-${testCase.label}`
  }, {
    callAiJson: async () => ({
      text: JSON.stringify({
        age: 20,
        stage: "大学阶段",
        title: "夹缝中的两年",
        description: "大学两年里，父母每月给你1500元生活费，你继续完成专业课。",
        choices: [
          { id: "A", text: "继续完成会计专业", impactSummary: "稳步完成" },
          { id: "B", text: "辅修感兴趣的课程", impactSummary: "拓展方向" },
          { id: "C", text: "寻找校内实践机会", impactSummary: "积累经验" }
        ],
        attributes,
        financialChange: testCase.financialChange,
        isEndingNode: false
      })
    })
  });

  assert.equal(studentNode.financialChange, undefined);
  assert.equal(studentNode.financialState?.netWorthWan, studentFinancialState.netWorthWan);
  assert.ok((studentNode.financialState?.cashWan || 0) >= 0);
  assert.ok((studentNode.financialState?.totalDebtWan || 0) >= 0);
  assert.equal(studentNode.financialSignals, undefined);
}

let financialRepairCalls = 0;
let capturedFinancialRepairPrompt = "";
const repairedFinancialNode = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "转向内容行业实习",
  nodeIndex: 1,
  simulationSeed: "finance-repair"
}, {
  callAiJson: async (prompt) => {
    financialRepairCalls += 1;
    if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
      capturedFinancialRepairPrompt = prompt;
      return {
        text: JSON.stringify({
          financialSignals: {
            employmentStatus: "employed",
            monthlyNetIncomeWan: 0.8,
            incomeMonths: 1,
            monthlyLivingExpenseWan: 0.3,
            oneOffIncomeWan: 5,
            oneOffExpenseWan: 0,
            assetValueChangeWan: 10,
            propertyMarketValueChangeWan: -10,
            personalDebtChangeWan: 0,
            incomeStability: "volatile",
            confidence: 0.9,
            reasons: ["正文出现重大房产处置"]
          }
        })
      };
    }
    return {
      text: JSON.stringify({
        age: 23,
        stage: "试错开局",
        title: "新行业的第一年",
        description: "她完成一套房产的出售和贷款结清，同时继续原有工作。",
        choices: [
          { id: "A", text: "继续留在小团队磨作品", impactSummary: "低薪成长" },
          { id: "B", text: "回到稳定岗位补现金流", impactSummary: "现实回撤" },
          { id: "C", text: "兼职接单扩展人脉", impactSummary: "双线积累" }
        ],
        attributes: { ...attributes, wealth: 42 },
        isEndingNode: false
      })
    };
  }
});

assert.equal(financialRepairCalls, 1);
assert.equal(capturedFinancialRepairPrompt, "");
assert.equal(repairedFinancialNode.financialSignals, undefined);
assert.equal(repairedFinancialNode.financialLedgerMode, "authoritative");
assert.ok((repairedFinancialNode.financialState?.cashWan || 0) >= 0);
const repairedLedgerNetWorth = repairedFinancialNode.financialLedger
  ? repairedFinancialNode.financialLedger.cashAccounts.reduce((sum, account) => sum + account.balanceWan, 0)
    + repairedFinancialNode.financialLedger.assetAccounts.reduce((sum, account) => sum + account.marketValueWan, 0)
    + repairedFinancialNode.financialLedger.businessHoldings.reduce((sum, holding) => sum + holding.personalCarryingValueWan, 0)
    - repairedFinancialNode.financialLedger.debtAccounts.reduce((sum, debt) => sum + debt.principalWan, 0)
  : 0;
assert.ok(Math.abs((repairedFinancialNode.financialState?.netWorthWan || 0) - repairedLedgerNetWorth) < 0.001);

let propertyRepairCalls = 0;
const propertyRepairNode = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "在省会购买一套小户型",
  nodeIndex: 1,
  simulationSeed: "property-semantic-repair"
}, {
  callAiJson: async (prompt) => {
    propertyRepairCalls += 1;
    if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
      return {
        text: JSON.stringify({
          financialSignals: {
            employmentStatus: "employed",
            monthlyNetIncomeWan: 0,
            incomeMonths: 0,
            monthlyLivingExpenseWan: 0,
            oneOffIncomeWan: 0,
            oneOffExpenseWan: 63,
            assetValueChangeWan: 0,
            propertyMarketValueChangeWan: 180,
            personalDebtChangeWan: 120,
            incomeStability: "stable",
            confidence: 0.9,
            reasons: ["支付六十万元首付和三万元税费", "新增一百二十万元房贷并购入一百八十万元房产"]
          }
        })
      };
    }
    return {
      text: JSON.stringify({
        age: 23,
        stage: "安家选择",
        title: "小户型落定",
        description: "她支付了60万首付并办理120万房贷，购入一套价值180万的小户型。",
        choices: [
          { id: "A", text: "稳定工作并按期还贷", impactSummary: "稳步还贷" },
          { id: "B", text: "利用空房间增加租金收入", impactSummary: "补充现金" },
          { id: "C", text: "控制其他支出建立应急金", impactSummary: "建立缓冲" }
        ],
        attributes,
        financialSignals: {
          employmentStatus: "employed",
          monthlyNetIncomeWan: 0,
          incomeMonths: 0,
          monthlyLivingExpenseWan: 0,
          oneOffIncomeWan: 0,
          oneOffExpenseWan: 63,
          assetValueChangeWan: 0,
          propertyMarketValueChangeWan: 0,
          personalDebtChangeWan: 120,
          incomeStability: "stable",
          confidence: 0.9,
          reasons: ["支付首付并新增房贷"]
        },
        isEndingNode: false
      })
    };
  }
});

assert.equal(propertyRepairCalls, 1);
assert.equal(propertyRepairNode.financialSignals, undefined);
assert.equal(propertyRepairNode.financialChange, undefined);
assert.equal(
  propertyRepairNode.financialState?.propertyMarketValueWan,
  estimateFinancialStateFromWealth(attributes.wealth, history[0].age * 12).propertyMarketValueWan
);

const enforcedHistorySnapshot = structuredClone(history);
const enforcedGateDecisions: Array<{ disposition: string; regenerationCount?: number; previewIncome?: number }> = [];
let enforcedAiCalls = 0;
await assert.rejects(
  generateNextNode({
    userData,
    answers,
    history,
    currentAttributes: attributes,
    selectedDecision: "购入住房并办理房贷",
    nodeIndex: 1,
    simulationSeed: "financial-gate-zero-mutation"
  }, {
    financialNodeGateMode: "enforced",
    onFinancialGateDecision: (decision) => enforcedGateDecisions.push({
      disposition: decision.disposition,
      regenerationCount: decision.regenerationCount,
      previewIncome: decision.previewPeriodIncomeWan
    }),
    callAiJson: async (prompt) => {
      enforcedAiCalls += 1;
      if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
        return { text: JSON.stringify({ financialEventProposals: [] }) };
      }
      return {
        text: JSON.stringify({
          age: 23,
          stage: "安家选择",
          title: "房产已经成交",
          description: "你购入一套价值180万的住房，并背上120万房贷。",
          choices: [
            { id: "A", text: "稳定工作并按期还贷", impactSummary: "稳步还贷" },
            { id: "B", text: "出租房间增加收入", impactSummary: "补充现金" },
            { id: "C", text: "控制支出建立应急金", impactSummary: "建立缓冲" }
          ],
          attributes,
          financialEventProposals: [],
          isEndingNode: false
        })
      };
    }
  }),
  (error: unknown) => {
    assert.match(error instanceof Error ? error.message : String(error), /财务节点接受门拒绝候选/);
    assert.equal(isFinancialGateGenerationError(error), true, "only rejected, uncommitted Preview errors receive the extended internal retry budget");
    return true;
  }
);
assert.equal(enforcedAiCalls, 6, "three bounded full-node attempts plus one proposal repair per attempt");
assert.deepEqual(enforcedGateDecisions.map((item) => item.disposition), ["regenerate", "regenerate", "regenerate"]);
assert.deepEqual(enforcedGateDecisions.map((item) => item.regenerationCount), [0, 1, 2]);
assert.deepEqual(history, enforcedHistorySnapshot, "a rejected preview never advances History or mutates its financial snapshots");

// Phase 4/5: an expense-specific critical error must force the same atomic
// rejection contract even when the legacy financial gate is only shadowing.
// Start from a fully authoritative historical node so this covers every
// persisted financial surface, not only an empty legacy history record.
const expenseGateChoice = nextNode.choices[0]!;
const expenseGateHistory: HistoryItem[] = [{
  ...structuredClone(nextNode),
  selectedChoice: expenseGateChoice.text,
  selectedChoiceId: expenseGateChoice.id,
  selectedEventOutcomeId: expenseGateChoice.eventOutcomeId
}];
const expenseGateHistoryBefore = structuredClone(expenseGateHistory);
const expenseGateLedgerBefore = structuredClone(expenseGateHistory[0]!.financialLedger);
const expenseGateWorldBefore = structuredClone(expenseGateHistory[0]!.worldStateSnapshot);
const expenseGatePeriodBefore = structuredClone(expenseGateHistory[0]!.financialPeriodSummary);
const expenseGateAgeBefore = expenseGateHistory[0]!.ageInMonths ?? expenseGateHistory[0]!.age * 12;
const expenseGateAttributesBefore = structuredClone(expenseGateHistory[0]!.attributes);
const expenseGateDecisions: Array<{ mode: string; disposition: string; allowDomainCommit: boolean; reasonCodes: string[]; regenerationCount?: number }> = [];
let expenseGateAiCalls = 0;
const rejectedMortgageExpense = (ageInMonths: number) => ({
  id: "phase45_mortgage_payment_as_expense",
  kind: "expense_commitment_started",
  effectiveAtAgeInMonths: ageInMonths,
  payload: {
    id: "phase45_mortgage_payment_commitment",
    type: "mortgage_payment",
    displayName: "房贷月供",
    monthlyAmountWan: 1,
    activeFromAgeInMonths: ageInMonths,
    status: "active",
    factStatus: "known",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "TEST_MORTGAGE_PAYMENT_AS_EXPENSE",
      confidence: 1,
      financialScope: "personal"
    }]
  },
  evidence: "你已经支付首期房贷月供 1 万元。",
  confidence: 1,
  financialScope: "personal"
});
await assert.rejects(
  generateNextNode({
    userData,
    answers,
    history: expenseGateHistory,
    currentAttributes: expenseGateHistory[0]!.attributes,
    selectedDecision: expenseGateChoice.text,
    nodeIndex: 2,
    simulationSeed: "expense-enforced-zero-mutation"
  }, {
    // This deliberately proves the expense lifecycle's enforced mode cannot
    // fall back to the generic shadow gate when an EXPENSE_* fact is blocked.
    financialNodeGateMode: "shadow",
    expenseLifecycleMode: "enforced",
    onFinancialGateDecision: (decision) => expenseGateDecisions.push({
      mode: decision.mode,
      disposition: decision.disposition,
      allowDomainCommit: decision.allowDomainCommit,
      reasonCodes: decision.reasonCodes,
      regenerationCount: decision.regenerationCount
    }),
    callAiJson: async (prompt) => {
      expenseGateAiCalls += 1;
      const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || expenseGateAgeBefore + 12);
      const financialEventProposals = [rejectedMortgageExpense(targetAgeInMonths)];
      if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
        // Keep the same invalid route through its one bounded repair so the
        // test observes an actual EXPENSE_* blocking issue at the final gate.
        return { text: JSON.stringify({ financialEventProposals }) };
      }
      return {
        text: JSON.stringify({
          age: Math.floor(targetAgeInMonths / 12),
          stage: "房贷偿付核对",
          title: "首期月供已经支付",
          description: "你已经支付首期房贷月供 1 万元。",
          choices: [
            { id: "A", text: "继续维持当前工作节奏", impactSummary: "保持现金流" },
            { id: "B", text: "重新核对债务偿付安排", impactSummary: "确认房贷" },
            { id: "C", text: "暂缓新增固定支出", impactSummary: "保守安排" }
          ],
          attributes: expenseGateAttributesBefore,
          financialEventProposals,
          isEndingNode: false
        })
      };
    }
  }),
  /财务节点接受门拒绝候选/
);
assert.equal(expenseGateAiCalls, 9, "each of three attempts performs full-node generation, proposal repair and rejected-narrative repair");
assert.deepEqual(expenseGateDecisions.map((item) => item.mode), ["enforced", "enforced", "enforced"]);
assert.deepEqual(expenseGateDecisions.map((item) => item.disposition), ["regenerate", "regenerate", "regenerate"]);
assert.ok(expenseGateDecisions.every((item) => item.allowDomainCommit === false));
assert.ok(
  expenseGateDecisions.every((item) => item.reasonCodes.includes("REJECTED_COMPLETED_EXPENSE_LIFECYCLE")),
  `expected the enforced gate to retain the expense lifecycle reason: ${JSON.stringify(expenseGateDecisions)}`
);
assert.deepEqual(expenseGateDecisions.map((item) => item.regenerationCount), [0, 1, 2]);
assert.deepEqual(expenseGateHistory, expenseGateHistoryBefore, "rejected EXPENSE preview must not write History");
assert.deepEqual(expenseGateHistory[0]!.financialLedger, expenseGateLedgerBefore, "rejected EXPENSE preview must not write the ledger");
assert.deepEqual(expenseGateHistory[0]!.worldStateSnapshot, expenseGateWorldBefore, "rejected EXPENSE preview must not write WorldState");
assert.equal(expenseGateHistory[0]!.ageInMonths ?? expenseGateHistory[0]!.age * 12, expenseGateAgeBefore, "rejected EXPENSE preview must not advance time");
assert.deepEqual(expenseGateHistory[0]!.financialPeriodSummary, expenseGatePeriodBefore, "rejected EXPENSE preview must not write period accrual");

// The same no-mutation contract specifically covers the shared-responsibility
// P0: a model cannot relabel a jointly stated household total as the
// protagonist's personal recurring rent. Keep it on the full generate/repair
// route so a future normalizer or retry change cannot bypass the validator.
const collectiveExpenseHistory = structuredClone(expenseGateHistoryBefore);
const collectiveExpenseLedgerBefore = structuredClone(collectiveExpenseHistory[0]!.financialLedger);
const collectiveExpenseWorldBefore = structuredClone(collectiveExpenseHistory[0]!.worldStateSnapshot);
const collectiveExpensePeriodBefore = structuredClone(collectiveExpenseHistory[0]!.financialPeriodSummary);
const collectiveExpenseAgeBefore = collectiveExpenseHistory[0]!.ageInMonths ?? collectiveExpenseHistory[0]!.age * 12;
let collectiveExpenseAiCalls = 0;
const collectiveExpenseGateDecisions: Array<{ mode: string; disposition: string; allowDomainCommit: boolean; reasonCodes: string[] }> = [];
const rejectedCollectiveExpense = (ageInMonths: number) => ({
  id: "phase45_collective_household_total_as_personal",
  kind: "expense_commitment_started",
  effectiveAtAgeInMonths: ageInMonths,
  payload: {
    id: "phase45_collective_household_total_as_personal",
    type: "housing",
    displayName: "共同房租",
    monthlyAmountWan: 0.5,
    activeFromAgeInMonths: ageInMonths,
    status: "active",
    factStatus: "known",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "TEST_COLLECTIVE_TOTAL_AS_PERSONAL",
      confidence: 1,
      financialScope: "personal"
    }],
    responsibilityKey: "primary_residence:collective_test",
    responsibilityKind: "primary_residence",
    amountBasis: "explicit_known",
    amountSourceIds: ["test:collective-rent-5000"],
    financialScope: "personal",
    accrualReviewStatus: "normal",
    confirmedMonthlyAmountWan: 0.5,
    lastConfirmedAtAgeInMonths: ageInMonths,
    nextReviewAtAgeInMonths: ageInMonths + 12
  },
  evidence: "你们每月共同承担房租5000元。",
  confidence: 1,
  financialScope: "personal"
});
await assert.rejects(
  generateNextNode({
    userData,
    answers,
    history: collectiveExpenseHistory,
    currentAttributes: collectiveExpenseHistory[0]!.attributes,
    selectedDecision: expenseGateChoice.text,
    nodeIndex: 2,
    simulationSeed: "expense-collective-zero-mutation"
  }, {
    financialNodeGateMode: "shadow",
    expenseLifecycleMode: "enforced",
    onFinancialGateDecision: (decision) => {
      collectiveExpenseGateDecisions.push({
        mode: decision.mode,
        disposition: decision.disposition,
        allowDomainCommit: decision.allowDomainCommit,
        reasonCodes: decision.reasonCodes
      });
    },
    callAiJson: async (prompt) => {
      collectiveExpenseAiCalls += 1;
      const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || collectiveExpenseAgeBefore + 12);
      const financialEventProposals = [rejectedCollectiveExpense(targetAgeInMonths)];
      if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
        return { text: JSON.stringify({ financialEventProposals }) };
      }
      return {
        text: JSON.stringify({
          age: Math.floor(targetAgeInMonths / 12),
          stage: "共同住房核对",
          title: "共同房租仍待确认个人份额",
          description: "你们每月共同承担房租5000元。",
          choices: [
            { id: "A", text: "继续维持当前工作节奏", impactSummary: "保持现金流" },
            { id: "B", text: "重新核对住房安排", impactSummary: "确认份额" },
            { id: "C", text: "暂缓新增固定支出", impactSummary: "保守安排" }
          ],
          attributes: collectiveExpenseHistory[0]!.attributes,
          financialEventProposals,
          isEndingNode: false
        })
      };
    }
  }),
  /财务节点接受门拒绝候选/
);
assert.equal(
  collectiveExpenseAiCalls,
  6,
  "collective ownership rejection must exhaust three full-node attempts and their proposal repairs without inventing a completion rollback"
);
assert.deepEqual(collectiveExpenseGateDecisions.map((item) => item.mode), ["enforced", "enforced", "enforced"]);
assert.deepEqual(collectiveExpenseGateDecisions.map((item) => item.disposition), ["regenerate", "regenerate", "regenerate"]);
assert.ok(collectiveExpenseGateDecisions.every((item) => item.allowDomainCommit === false));
assert.ok(
  collectiveExpenseGateDecisions.every((item) => item.reasonCodes.includes("UNSATISFIED_EXPENSE_LIFECYCLE")),
  `expected the enforced gate to retain the collective expense lifecycle reason: ${JSON.stringify(collectiveExpenseGateDecisions)}`
);
assert.deepEqual(collectiveExpenseHistory, expenseGateHistoryBefore, "rejected collective expense must not write History");
assert.deepEqual(collectiveExpenseHistory[0]!.financialLedger, collectiveExpenseLedgerBefore, "rejected collective expense must not write the ledger");
assert.deepEqual(collectiveExpenseHistory[0]!.worldStateSnapshot, collectiveExpenseWorldBefore, "rejected collective expense must not write WorldState");
assert.equal(collectiveExpenseHistory[0]!.ageInMonths ?? collectiveExpenseHistory[0]!.age * 12, collectiveExpenseAgeBefore, "rejected collective expense must not advance time");
assert.deepEqual(collectiveExpenseHistory[0]!.financialPeriodSummary, collectiveExpensePeriodBefore, "rejected collective expense must not write period accrual");

// This is the real-life route P0, not a malformed model Proposal: the prose
// commits a jointly arranged elder-care service and gives its monthly total,
// but never says what the protagonist pays. The lifecycle detector must carry
// that material omission to the enforced gate. It must not advance time or
// accrue the still-active income/expense state while waiting for a corrected
// allocation.
const jointCaregiverHistory = structuredClone(expenseGateHistoryBefore);
// The live regression occurs after a relationship has already become
// authoritative. Establish that prerequisite here so the relationship guard
// does not quite correctly replace the financial evidence with its unrelated
// deterministic narrative fallback before the expense lifecycle sees it.
const jointCaregiverWorld = jointCaregiverHistory[0]!.worldStateSnapshot!;
jointCaregiverHistory[0]!.worldStateSnapshot = {
  ...jointCaregiverWorld,
  people: [
    ...(jointCaregiverWorld.people || []),
    {
      id: "joint_caregiver_partner",
      displayName: "伴侣",
      relation: "partner",
      lifeStatus: "active",
      source: "accepted_history",
      confidence: 1
    }
  ],
  relationships: [
    ...(jointCaregiverWorld.relationships || []),
    {
      id: "joint_caregiver_relationship",
      participantPersonIds: ["joint_caregiver_partner"],
      type: "romantic",
      stage: "cohabiting",
      status: "active",
      livingTogether: true,
      effectiveFromAgeInMonths: jointCaregiverHistory[0]!.ageInMonths ?? jointCaregiverHistory[0]!.age * 12,
      source: "accepted_history",
      confidence: 1
    }
  ],
  relationshipRevision: (jointCaregiverWorld.relationshipRevision || 0) + 1
};
const jointCaregiverHistoryBefore = structuredClone(jointCaregiverHistory);
const jointCaregiverLedgerBefore = structuredClone(jointCaregiverHistory[0]!.financialLedger);
const jointCaregiverWorldBefore = structuredClone(jointCaregiverHistory[0]!.worldStateSnapshot);
const jointCaregiverPeriodBefore = structuredClone(jointCaregiverHistory[0]!.financialPeriodSummary);
const jointCaregiverAgeBefore = jointCaregiverHistory[0]!.ageInMonths ?? jointCaregiverHistory[0]!.age * 12;
const jointCaregiverCashBefore = jointCaregiverLedgerBefore?.cashAccounts.map((account) => [account.id, account.balanceWan]);
const jointCaregiverIncomeBefore = jointCaregiverLedgerBefore?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]);
let jointCaregiverAiCalls = 0;
const jointCaregiverGateDecisions: Array<{ mode: string; disposition: string; allowDomainCommit: boolean; reasonCodes: string[] }> = [];
await assert.rejects(
  generateNextNode({
    userData,
    answers,
    history: jointCaregiverHistory,
    currentAttributes: jointCaregiverHistory[0]!.attributes,
    selectedDecision: expenseGateChoice.text,
    nodeIndex: 2,
    simulationSeed: "expense-joint-caregiver-zero-mutation"
  }, {
    financialNodeGateMode: "shadow",
    expenseLifecycleMode: "enforced",
    onFinancialGateDecision: (decision) => jointCaregiverGateDecisions.push({
      mode: decision.mode,
      disposition: decision.disposition,
      allowDomainCommit: decision.allowDomainCommit,
      reasonCodes: decision.reasonCodes
    }),
    callAiJson: async (prompt) => {
      jointCaregiverAiCalls += 1;
      if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
        return { text: JSON.stringify({ financialEventProposals: [] }) };
      }
      const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || jointCaregiverAgeBefore + 12);
      return {
        text: JSON.stringify({
          age: Math.floor(targetAgeInMonths / 12),
          stage: "双方老人照护安排",
          title: "共同照护费用仍待确认个人份额",
          description: "你和伴侣商量后，决定请一个白班阿姨，每周来三天，帮忙做饭和打扫，减轻两边老人的负担。这笔开销不小，你算了算，每月要多支出三千多元，但暂时还能承受。",
          choices: [
            { id: "A", text: "共同确认照护费用分担", impactSummary: "明确个人现金流" },
            { id: "B", text: "继续协调双方家庭安排", impactSummary: "缓解照护压力" },
            { id: "C", text: "先核对可承担的预算", impactSummary: "避免透支" }
          ],
          attributes: jointCaregiverHistory[0]!.attributes,
          financialEventProposals: [],
          isEndingNode: false
        })
      };
    }
  }),
  /财务节点接受门拒绝候选/
);
assert.ok(jointCaregiverAiCalls >= 3, "the material shared-care omission must exhaust bounded generation attempts");
assert.deepEqual(jointCaregiverGateDecisions.map((item) => item.mode), ["enforced", "enforced", "enforced"]);
assert.deepEqual(jointCaregiverGateDecisions.map((item) => item.disposition), ["regenerate", "regenerate", "regenerate"]);
assert.ok(jointCaregiverGateDecisions.every((item) => item.allowDomainCommit === false));
assert.ok(jointCaregiverGateDecisions.every((item) => item.reasonCodes.includes("UNSATISFIED_EXPENSE_LIFECYCLE")));
assert.deepEqual(jointCaregiverHistory, jointCaregiverHistoryBefore, "unallocated material caregiver cost must not write History");
assert.deepEqual(jointCaregiverHistory[0]!.financialLedger, jointCaregiverLedgerBefore, "rejected caregiver cost must not write the ledger");
assert.deepEqual(jointCaregiverHistory[0]!.worldStateSnapshot, jointCaregiverWorldBefore, "rejected caregiver cost must not write WorldState");
assert.equal(jointCaregiverHistory[0]!.ageInMonths ?? jointCaregiverHistory[0]!.age * 12, jointCaregiverAgeBefore, "rejected caregiver cost must not advance time");
assert.deepEqual(jointCaregiverHistory[0]!.financialPeriodSummary, jointCaregiverPeriodBefore, "rejected caregiver cost must not accrue the period");
assert.deepEqual(jointCaregiverHistory[0]!.financialLedger?.cashAccounts.map((account) => [account.id, account.balanceWan]), jointCaregiverCashBefore, "rejected caregiver cost must not change cash");
assert.deepEqual(jointCaregiverHistory[0]!.financialLedger?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]), jointCaregiverIncomeBefore, "rejected caregiver cost must not accrue or alter income sources");

// v18 showed the inverse failure: a completed, individually arranged parent
// rehabilitation service appeared in the final prose but the model omitted
// its amount-free expense_responsibility delta. The semantic detector is
// deliberately narrow, yet once it matches, the entire Preview must reject
// before history, WorldState, time, income or cash can move.
const missingCareDeltaHistory = structuredClone(expenseGateHistoryBefore);
const missingCareDeltaHistoryBefore = structuredClone(missingCareDeltaHistory);
const missingCareDeltaLedgerBefore = structuredClone(missingCareDeltaHistory[0]!.financialLedger);
const missingCareDeltaWorldBefore = structuredClone(missingCareDeltaHistory[0]!.worldStateSnapshot);
const missingCareDeltaPeriodBefore = structuredClone(missingCareDeltaHistory[0]!.financialPeriodSummary);
const missingCareDeltaAgeBefore = missingCareDeltaHistory[0]!.ageInMonths ?? missingCareDeltaHistory[0]!.age * 12;
const missingCareDeltaCashBefore = missingCareDeltaLedgerBefore?.cashAccounts.map((account) => [account.id, account.balanceWan]);
const missingCareDeltaIncomeBefore = missingCareDeltaLedgerBefore?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]);
const missingCareDeltaGateDecisions: Array<{ mode: string; disposition: string; allowDomainCommit: boolean; reasonCodes: string[]; regenerationCount?: number; requiredFactGroupCount: number; criticalFactGroupCount: number; unsatisfiedCriticalFactGroupCount: number }> = [];
let missingCareDeltaAiCalls = 0;
await assert.rejects(
  generateNextNode({
    userData,
    answers,
    history: missingCareDeltaHistory,
    currentAttributes: missingCareDeltaHistory[0]!.attributes,
    selectedDecision: expenseGateChoice.text,
    nodeIndex: 2,
    simulationSeed: "expense-care-delta-zero-mutation"
  }, {
    financialNodeGateMode: "shadow",
    expenseLifecycleMode: "enforced",
    onFinancialGateDecision: (decision) => missingCareDeltaGateDecisions.push({
      mode: decision.mode,
      disposition: decision.disposition,
      allowDomainCommit: decision.allowDomainCommit,
      reasonCodes: decision.reasonCodes,
      regenerationCount: decision.regenerationCount,
      requiredFactGroupCount: decision.requiredFactGroupCount,
      criticalFactGroupCount: decision.criticalFactGroupCount,
      unsatisfiedCriticalFactGroupCount: decision.unsatisfiedCriticalFactGroupCount
    }),
    callAiJson: async (prompt) => {
      missingCareDeltaAiCalls += 1;
      if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
        return { text: JSON.stringify({ financialEventProposals: [] }) };
      }
      const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || missingCareDeltaAgeBefore + 12);
      return {
        text: JSON.stringify({
          age: Math.floor(targetAgeInMonths / 12),
          stage: "父亲康复安排",
          title: "持续照护的责任确认",
          description: "父亲膝盖的旧疾需要持续理疗。你为他在县城找了一位康复师，每周两次上门指导。母亲腰椎旧伤需要持续理疗。你为她请了一位理疗师，每周固定上门理疗。",
          choices: [
            { id: "A", text: "继续陪父亲完成康复安排", impactSummary: "照护延续" },
            { id: "B", text: "协调更稳定的上门服务", impactSummary: "稳定支持" },
            { id: "C", text: "重新安排工作与探望节奏", impactSummary: "平衡责任" }
          ],
          attributes: missingCareDeltaHistory[0]!.attributes,
          financialEventProposals: [],
          isEndingNode: false,
          narrativeMeta: { worldDeltas: [] }
        })
      };
    }
  }),
  /财务节点接受门拒绝候选/
);
assert.equal(missingCareDeltaAiCalls, 3, "the missing structured care fact must use only bounded full-node regeneration");
// The ordinary financial gate remains in shadow mode for this focused
// regression, so each attempt records a dry-run shadow decision before the
// final expense-authority gate emits its enforced rejection. Only the latter
// may decide whether the Preview commits.
const missingCareDeltaEnforcedDecisions = missingCareDeltaGateDecisions.filter((item) => item.mode === "enforced");
assert.deepEqual(missingCareDeltaEnforcedDecisions.map((item) => item.disposition), ["regenerate", "regenerate", "regenerate"]);
assert.ok(missingCareDeltaEnforcedDecisions.every((item) => item.allowDomainCommit === false));
assert.ok(missingCareDeltaEnforcedDecisions.every((item) => item.reasonCodes.includes("EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING")));
assert.deepEqual(missingCareDeltaEnforcedDecisions.map((item) => item.regenerationCount), [0, 1, 2]);
assert.deepEqual(missingCareDeltaEnforcedDecisions.map((item) => item.requiredFactGroupCount), [2, 2, 2]);
assert.deepEqual(missingCareDeltaEnforcedDecisions.map((item) => item.criticalFactGroupCount), [2, 2, 2]);
assert.deepEqual(missingCareDeltaEnforcedDecisions.map((item) => item.unsatisfiedCriticalFactGroupCount), [2, 2, 2]);
assert.deepEqual(missingCareDeltaHistory, missingCareDeltaHistoryBefore, "missing care delta must not write History");
assert.deepEqual(missingCareDeltaHistory[0]!.financialLedger, missingCareDeltaLedgerBefore, "missing care delta must not write the ledger");
assert.deepEqual(missingCareDeltaHistory[0]!.worldStateSnapshot, missingCareDeltaWorldBefore, "missing care delta must not write WorldState");
assert.equal(missingCareDeltaHistory[0]!.ageInMonths ?? missingCareDeltaHistory[0]!.age * 12, missingCareDeltaAgeBefore, "missing care delta must not advance time");
assert.deepEqual(missingCareDeltaHistory[0]!.financialPeriodSummary, missingCareDeltaPeriodBefore, "missing care delta must not accrue the period");
assert.deepEqual(missingCareDeltaHistory[0]!.financialLedger?.cashAccounts.map((account) => [account.id, account.balanceWan]), missingCareDeltaCashBefore, "missing care delta must not change cash");
assert.deepEqual(missingCareDeltaHistory[0]!.financialLedger?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]), missingCareDeltaIncomeBefore, "missing care delta must not alter income sources");

// The same authority boundary applies to a natural ending. A terminal
// rejection reruns the whole candidate, so the ending prompt itself must
// carry the reason and the retry must commit only its final, grounded result.
const endingCareRetryHistory = structuredClone(expenseGateHistoryBefore);
const endingCareRetryPrevious = endingCareRetryHistory[0]!;
const endingCareRetryStartAgeInMonths = 109 * 12 + 11;
endingCareRetryPrevious.age = 109;
endingCareRetryPrevious.ageInMonths = endingCareRetryStartAgeInMonths;
endingCareRetryPrevious.stage = "晚年日常";
endingCareRetryPrevious.title = "家庭的安稳节奏";
endingCareRetryPrevious.selectedChoice = "继续安排晚年的家庭日常";
endingCareRetryPrevious.selectedChoiceId = "ending_parent_care";
endingCareRetryPrevious.selectedEventOutcomeId = "ending_parent_care";
endingCareRetryPrevious.choices = [{
  id: "ending_parent_care",
  text: "继续安排晚年的家庭日常",
  impactSummary: "维持照护",
  eventOutcomeId: "ending_parent_care"
}];
endingCareRetryPrevious.financialState = {
  ...endingCareRetryPrevious.financialState!,
  asOfAgeInMonths: endingCareRetryStartAgeInMonths
};
endingCareRetryPrevious.financialLedger = {
  ...endingCareRetryPrevious.financialLedger!,
  asOfAgeInMonths: endingCareRetryStartAgeInMonths,
  incomeSources: endingCareRetryPrevious.financialLedger!.incomeSources.map((source) => ({
    ...source,
    lastConfirmedAtAgeInMonths: endingCareRetryStartAgeInMonths
  })),
  expenseCommitments: endingCareRetryPrevious.financialLedger!.expenseCommitments.map((commitment) => ({
    ...commitment,
    lastConfirmedAtAgeInMonths: endingCareRetryStartAgeInMonths,
    nextReviewAtAgeInMonths: endingCareRetryStartAgeInMonths + 12
  }))
};
endingCareRetryPrevious.worldStateSnapshot = {
  ...endingCareRetryPrevious.worldStateSnapshot!,
  people: [
    ...(endingCareRetryPrevious.worldStateSnapshot?.people || []),
    {
      id: "ending_retry_father",
      identityKey: { namespace: "user_role", key: "parent:father" },
      displayName: "父亲",
      relation: "parent",
      lifeStatus: "active",
      source: "accepted_history",
      confidence: 1
    }
  ]
};
const endingCareRetryCommittedIdsBefore = [...endingCareRetryPrevious.financialLedger.committedTransactionIds];
const endingCareRetryTransactionIdsBefore = new Set(
  endingCareRetryPrevious.financialLedger.recentTransactions.map((transaction) => transaction.simulationTransactionId)
);
const endingCareRetryEndingPrompts: string[] = [];
const endingCareRetryGateDecisions: Array<{ disposition: string; reasonCodes: string[]; regenerationCount?: number }> = [];
let endingCareRetryCandidateCalls = 0;
let endingCareRetryEndingCalls = 0;
const endingCareRetryNode = await generateNextNode({
  userData,
  answers,
  history: endingCareRetryHistory,
  currentAttributes: endingCareRetryPrevious.attributes,
  selectedDecision: "继续安排晚年的家庭日常",
  nodeIndex: 110,
  simulationSeed: "ending-care-retry-grounded-delta"
}, {
  financialNodeGateMode: "shadow",
  expenseLifecycleMode: "enforced",
  onFinancialGateDecision: (decision) => endingCareRetryGateDecisions.push({
    disposition: decision.disposition,
    reasonCodes: decision.reasonCodes,
    regenerationCount: decision.regenerationCount
  }),
  callAiJson: async (prompt) => {
    if (prompt.includes("你正在为一段写实人生生成自然终章")) {
      endingCareRetryEndingCalls += 1;
      endingCareRetryEndingPrompts.push(prompt);
      const withRequiredDelta = endingCareRetryEndingCalls > 1;
      const careEvidence = "父亲膝盖的旧疾需要持续理疗。你为他在县城找了一位康复师，每周两次上门指导。";
      return {
        text: JSON.stringify({
          age: 110,
          ageInMonths: 110 * 12,
          stage: "人生终章",
          title: "照护与回望",
          descriptionParagraphs: [
            `${careEvidence}你把探望和自己的生活重新排进同一张日历。`,
            "多年以后，你不再急着证明什么，只把能承担的责任一点点做好，也把温柔留给身边的人。"
          ],
          attributes: endingCareRetryPrevious.attributes,
          choices: [{ id: "ENDING", text: "安详落幕，查看一生洞察", impactSummary: "一生回望" }],
          isEndingNode: true,
          narrativeMeta: {
            worldDeltas: withRequiredDelta ? [{
              type: "expense_responsibility",
              summary: "持续父亲照护",
              responsibility: {
                responsibilityKind: "elder_care",
                beneficiary: "father",
                owner: "protagonist",
                cadence: "recurring_unknown",
                sourceOutcomeId: "ending_parent_care",
                evidence: careEvidence,
                confidence: 0.9
              }
            }] : []
          }
        })
      };
    }
    endingCareRetryCandidateCalls += 1;
    const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || 110 * 12);
    return {
      text: JSON.stringify({
        age: Math.floor(targetAgeInMonths / 12),
        ageInMonths: targetAgeInMonths,
        stage: "晚年日常",
        title: "家庭日常仍在继续",
        description: "你继续安排晚年的家庭日常，也在每周的探望中保持与家人的联系。",
        choices: [
          { id: "A", text: "维持现有生活节奏", impactSummary: "安稳维系" },
          { id: "B", text: "多留出时间陪伴家人", impactSummary: "增加陪伴" },
          { id: "C", text: "整理重要的人生资料", impactSummary: "沉淀回望" }
        ],
        attributes: endingCareRetryPrevious.attributes,
        financialEventProposals: [],
        isEndingNode: false
      })
    };
  }
});
assert.equal(endingCareRetryCandidateCalls, 2, "a rejected ending must regenerate the full candidate exactly once");
assert.equal(endingCareRetryEndingCalls, 2, "the first ending omits the delta and the second supplies it");
assert.doesNotMatch(endingCareRetryEndingPrompts[0]!, /EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING/);
assert.match(endingCareRetryEndingPrompts[1]!, /EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING/);
assert.match(endingCareRetryEndingPrompts[1]!, /evidence 必须逐字包含病情句与服务句/);
assert.match(endingCareRetryEndingPrompts[1]!, /本轮唯一已接受的 outcome id：【ending_parent_care】/);
assert.match(endingCareRetryEndingPrompts[1]!, /sourceOutcomeId 必须逐字等于 "ending_parent_care"/);
assert.equal(endingCareRetryNode.isEndingNode, true);
assert.equal(
  endingCareRetryNode.narrativeMeta?.worldDeltas.some((delta) => (
    delta.type === "expense_responsibility"
    && delta.responsibility.responsibilityKind === "elder_care"
    && delta.responsibility.beneficiary === "father"
    && delta.responsibility.sourceOutcomeId === "ending_parent_care"
  )),
  true,
  "the valid retry delta must survive the terminal authority path"
);
assert.equal(
  endingCareRetryNode.financialLedger!.committedTransactionIds.length,
  endingCareRetryCommittedIdsBefore.length + 1,
  "only the final terminal candidate may commit a ledger transaction"
);
assert.equal(
  endingCareRetryNode.financialLedger!.recentTransactions.filter((transaction) => (
    !endingCareRetryTransactionIdsBefore.has(transaction.simulationTransactionId)
  )).length,
  1,
  "the rejected terminal preview must leave no duplicate transaction"
);
const endingCareRetryMissingDeltaDecisions = endingCareRetryGateDecisions.filter((decision) => (
  decision.reasonCodes.includes("EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING")
));
assert.deepEqual(endingCareRetryMissingDeltaDecisions, [{
  disposition: "regenerate",
  reasonCodes: ["EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING"],
  regenerationCount: 0
}]);

// A completed, quantified first-person medical payment is a current-period
// cash outlay, not a recurring care commitment.  If the model narrates the
// actual payment but cannot provide its one-off event, the ordinary enforced
// acceptance gate must reject every bounded Preview before time, income, or
// cash accrual can move.  This is the exact fact shape found in the live
// relationship route; the later "共同账户" reserve must not disguise it as a
// monthly medical expense.
const personalMedicalOutlayHistory = structuredClone(expenseGateHistoryBefore);
const personalMedicalOutlayHistoryBefore = structuredClone(personalMedicalOutlayHistory);
const personalMedicalOutlayLedgerBefore = structuredClone(personalMedicalOutlayHistory[0]!.financialLedger);
const personalMedicalOutlayWorldBefore = structuredClone(personalMedicalOutlayHistory[0]!.worldStateSnapshot);
const personalMedicalOutlayPeriodBefore = structuredClone(personalMedicalOutlayHistory[0]!.financialPeriodSummary);
const personalMedicalOutlayAgeBefore = personalMedicalOutlayHistory[0]!.ageInMonths ?? personalMedicalOutlayHistory[0]!.age * 12;
const personalMedicalOutlayCashBefore = personalMedicalOutlayLedgerBefore?.cashAccounts.map((account) => [account.id, account.balanceWan]);
const personalMedicalOutlayIncomeBefore = personalMedicalOutlayLedgerBefore?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]);
const personalMedicalOutlayGateDecisions: Array<{ mode: string; disposition: string; allowDomainCommit: boolean; reasonCodes: string[]; regenerationCount?: number }> = [];
let personalMedicalOutlayAiCalls = 0;
await assert.rejects(
  generateNextNode({
    userData,
    answers,
    history: personalMedicalOutlayHistory,
    currentAttributes: personalMedicalOutlayHistory[0]!.attributes,
    selectedDecision: expenseGateChoice.text,
    nodeIndex: 2,
    simulationSeed: "personal-medical-outlay-zero-mutation"
  }, {
    financialNodeGateMode: "enforced",
    // Isolate the one-off cash-flow acceptance contract from recurring
    // lifecycle classification: this medical deposit must not become a
    // synthesized monthly healthcare account just to let the node commit.
    expenseLifecycleMode: "off",
    onFinancialGateDecision: (decision) => personalMedicalOutlayGateDecisions.push({
      mode: decision.mode,
      disposition: decision.disposition,
      allowDomainCommit: decision.allowDomainCommit,
      reasonCodes: decision.reasonCodes,
      regenerationCount: decision.regenerationCount
    }),
    callAiJson: async (prompt) => {
      personalMedicalOutlayAiCalls += 1;
      if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
        return { text: JSON.stringify({ financialEventProposals: [] }) };
      }
      const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || personalMedicalOutlayAgeBefore + 12);
      return {
        text: JSON.stringify({
          age: Math.floor(targetAgeInMonths / 12),
          ageInMonths: targetAgeInMonths,
          stage: "父母医疗照护",
          title: "住院押金仍待入账",
          description: "你父亲上个月因腰椎问题住院，你垫付了1.2万元住院押金。这笔钱本应从共同账户的父母照护预算中支出，但预算只覆盖常规体检和药物，没有预留突发医疗。",
          choices: [
            { id: "A", text: "先核对住院费用与报销", impactSummary: "确认医疗现金流" },
            { id: "B", text: "补足家庭应急预算", impactSummary: "留出照护缓冲" },
            { id: "C", text: "与家人确认后续分担", impactSummary: "明确责任边界" }
          ],
          attributes: personalMedicalOutlayHistory[0]!.attributes,
          financialEventProposals: [],
          isEndingNode: false
        })
      };
    }
  }),
  (error: unknown) => {
    assert.match(error instanceof Error ? error.message : String(error), /财务节点接受门拒绝候选/);
    assert.equal(isFinancialGateGenerationError(error), true, "the uncommitted personal outlay Preview receives only the bounded financial-gate retry budget");
    return true;
  }
);
assert.equal(personalMedicalOutlayAiCalls, 6, "each of three bounded attempts repairs the missing one-off event once before the gate rejects it");
assert.deepEqual(personalMedicalOutlayGateDecisions.map((item) => item.mode), ["enforced", "enforced", "enforced"]);
assert.deepEqual(personalMedicalOutlayGateDecisions.map((item) => item.disposition), ["regenerate", "regenerate", "regenerate"]);
assert.ok(personalMedicalOutlayGateDecisions.every((item) => item.allowDomainCommit === false));
assert.ok(
  personalMedicalOutlayGateDecisions.every((item) => item.reasonCodes.includes("UNSATISFIED_LARGE_PERSONAL_CASHFLOW")),
  `expected the personal-outlay coverage issue to stay a critical financial fact: ${JSON.stringify(personalMedicalOutlayGateDecisions)}`
);
assert.deepEqual(personalMedicalOutlayGateDecisions.map((item) => item.regenerationCount), [0, 1, 2]);
assert.deepEqual(personalMedicalOutlayHistory, personalMedicalOutlayHistoryBefore, "unmodeled completed medical outlay must not write History");
assert.deepEqual(personalMedicalOutlayHistory[0]!.financialLedger, personalMedicalOutlayLedgerBefore, "unmodeled completed medical outlay must not write the ledger");
assert.deepEqual(personalMedicalOutlayHistory[0]!.worldStateSnapshot, personalMedicalOutlayWorldBefore, "unmodeled completed medical outlay must not write WorldState");
assert.equal(personalMedicalOutlayHistory[0]!.ageInMonths ?? personalMedicalOutlayHistory[0]!.age * 12, personalMedicalOutlayAgeBefore, "unmodeled completed medical outlay must not advance time");
assert.deepEqual(personalMedicalOutlayHistory[0]!.financialPeriodSummary, personalMedicalOutlayPeriodBefore, "unmodeled completed medical outlay must not accrue the period");
assert.deepEqual(personalMedicalOutlayHistory[0]!.financialLedger?.cashAccounts.map((account) => [account.id, account.balanceWan]), personalMedicalOutlayCashBefore, "unmodeled completed medical outlay must not change cash");
assert.deepEqual(personalMedicalOutlayHistory[0]!.financialLedger?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]), personalMedicalOutlayIncomeBefore, "unmodeled completed medical outlay must not accrue or alter income sources");

// The late-arriving route fact is stronger than a missing current-period
// Proposal: the narrative opens at this transaction's authoritative age, then
// says the payment happened "上个月".  Supplying an otherwise valid 1.2 万元
// one-off at this period end must still be rejected; accepting it would forge
// a backdated historical cash movement and double-count the time boundary.
const historicalMedicalOutlayHistory = structuredClone(expenseGateHistoryBefore);
const historicalMedicalOutlayHistoryBefore = structuredClone(historicalMedicalOutlayHistory);
const historicalMedicalOutlayLedgerBefore = structuredClone(historicalMedicalOutlayHistory[0]!.financialLedger);
const historicalMedicalOutlayWorldBefore = structuredClone(historicalMedicalOutlayHistory[0]!.worldStateSnapshot);
const historicalMedicalOutlayPeriodBefore = structuredClone(historicalMedicalOutlayHistory[0]!.financialPeriodSummary);
const historicalMedicalOutlayAgeBefore = historicalMedicalOutlayHistory[0]!.ageInMonths ?? historicalMedicalOutlayHistory[0]!.age * 12;
const historicalMedicalOutlayCashBefore = historicalMedicalOutlayLedgerBefore?.cashAccounts.map((account) => [account.id, account.balanceWan]);
const historicalMedicalOutlayIncomeBefore = historicalMedicalOutlayLedgerBefore?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]);
const historicalMedicalOutlayCashAccountId = historicalMedicalOutlayLedgerBefore!.cashAccounts.find((account) => account.status === "active")!.id;
const formatNarrativeAge = (ageInMonths: number) => `${Math.floor(ageInMonths / 12)}岁${ageInMonths % 12}个月`;
const historicalMedicalOutlayDescription = (periodEndAgeInMonths: number) => (
  `${formatNarrativeAge(historicalMedicalOutlayAgeBefore)}，共同账户规则正式运行了三个月。`
  + "你父亲上个月因腰椎问题住院，你垫付了1.2万元住院押金。这笔钱本应从共同账户的父母照护预算中支出，但预算只覆盖常规体检和药物，没有预留突发医疗。"
  + `到${formatNarrativeAge(periodEndAgeInMonths)}，你们开始重新梳理家庭责任。`
);
const falseCurrentPeriodMedicalOutlay = (periodEndAgeInMonths: number) => ({
  id: "historical_medical_outlay_as_current_period_expense",
  kind: "one_off_expense_paid",
  effectiveAtAgeInMonths: periodEndAgeInMonths,
  payload: {
    sourceCashAccountId: historicalMedicalOutlayCashAccountId,
    amountWan: 1.2
  },
  evidence: "你父亲上个月因腰椎问题住院，你垫付了1.2万元住院押金。",
  confidence: 1,
  financialScope: "personal"
});
const historicalMedicalOutlayGateDecisions: Array<{ mode: string; disposition: string; allowDomainCommit: boolean; reasonCodes: string[]; regenerationCount?: number }> = [];
let historicalMedicalOutlayAiCalls = 0;
await assert.rejects(
  generateNextNode({
    userData,
    answers,
    history: historicalMedicalOutlayHistory,
    currentAttributes: historicalMedicalOutlayHistory[0]!.attributes,
    selectedDecision: expenseGateChoice.text,
    nodeIndex: 2,
    simulationSeed: "historical-medical-outlay-current-period-zero-mutation"
  }, {
    financialNodeGateMode: "enforced",
    expenseLifecycleMode: "off",
    onFinancialGateDecision: (decision) => historicalMedicalOutlayGateDecisions.push({
      mode: decision.mode,
      disposition: decision.disposition,
      allowDomainCommit: decision.allowDomainCommit,
      reasonCodes: decision.reasonCodes,
      regenerationCount: decision.regenerationCount
    }),
    callAiJson: async (prompt) => {
      historicalMedicalOutlayAiCalls += 1;
      const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || historicalMedicalOutlayAgeBefore + 12);
      const financialEventProposals = [falseCurrentPeriodMedicalOutlay(targetAgeInMonths)];
      if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
        return { text: JSON.stringify({ financialEventProposals }) };
      }
      return {
        text: JSON.stringify({
          age: Math.floor(targetAgeInMonths / 12),
          ageInMonths: targetAgeInMonths,
          stage: "父母医疗照护",
          title: "历史住院押金不能伪装为本期支出",
          description: historicalMedicalOutlayDescription(targetAgeInMonths),
          choices: [
            { id: "A", text: "核对住院历史费用", impactSummary: "确认历史事实" },
            { id: "B", text: "建立后续照护预算", impactSummary: "补足生活安排" },
            { id: "C", text: "确认后续分担方式", impactSummary: "明确责任边界" }
          ],
          attributes: historicalMedicalOutlayHistory[0]!.attributes,
          financialEventProposals,
          isEndingNode: false
        })
      };
    }
  }),
  (error: unknown) => {
    assert.match(error instanceof Error ? error.message : String(error), /财务节点接受门拒绝候选/);
    assert.equal(isFinancialGateGenerationError(error), true);
    return true;
  }
);
assert.equal(historicalMedicalOutlayAiCalls, 9, "a rejected pre-period one-off performs full-node, proposal and narrative repair on each bounded attempt without writing a false current cash flow");
assert.deepEqual(historicalMedicalOutlayGateDecisions.map((item) => item.mode), ["enforced", "enforced", "enforced"]);
assert.deepEqual(historicalMedicalOutlayGateDecisions.map((item) => item.disposition), ["regenerate", "regenerate", "regenerate"]);
assert.ok(historicalMedicalOutlayGateDecisions.every((item) => item.allowDomainCommit === false));
assert.ok(
  historicalMedicalOutlayGateDecisions.every((item) => item.reasonCodes.includes("REJECTED_COMPLETED_LARGE_PERSONAL_CASHFLOW")),
  `a rejected period-end one-off must remain a critical cash-flow fact: ${JSON.stringify(historicalMedicalOutlayGateDecisions)}`
);
assert.deepEqual(historicalMedicalOutlayGateDecisions.map((item) => item.regenerationCount), [0, 1, 2]);
assert.deepEqual(historicalMedicalOutlayHistory, historicalMedicalOutlayHistoryBefore, "a rejected historical outlay correction must not write History");
assert.deepEqual(historicalMedicalOutlayHistory[0]!.financialLedger, historicalMedicalOutlayLedgerBefore, "a rejected historical outlay correction must not write the ledger");
assert.deepEqual(historicalMedicalOutlayHistory[0]!.worldStateSnapshot, historicalMedicalOutlayWorldBefore, "a rejected historical outlay correction must not write WorldState");
assert.equal(historicalMedicalOutlayHistory[0]!.ageInMonths ?? historicalMedicalOutlayHistory[0]!.age * 12, historicalMedicalOutlayAgeBefore, "a rejected historical outlay correction must not advance time");
assert.deepEqual(historicalMedicalOutlayHistory[0]!.financialPeriodSummary, historicalMedicalOutlayPeriodBefore, "a rejected historical outlay correction must not accrue the period");
assert.deepEqual(historicalMedicalOutlayHistory[0]!.financialLedger?.cashAccounts.map((account) => [account.id, account.balanceWan]), historicalMedicalOutlayCashBefore, "a rejected historical outlay correction must not change cash");
assert.deepEqual(historicalMedicalOutlayHistory[0]!.financialLedger?.incomeSources.map((source) => [source.id, source.monthlyNetAmountWan, source.status]), historicalMedicalOutlayIncomeBefore, "a rejected historical outlay correction must not accrue or alter income sources");

// Keeping a rejected EXPENSE_* issue open must not turn the repair path into a
// dead end. When the bounded repair replaces the same Proposal with evidence
// for the exact personal share, only the repaired final payload reaches the
// gate and the authoritative node may commit.
const repairedCollectiveHistory = structuredClone(expenseGateHistoryBefore);
let repairedCollectiveFullCalls = 0;
let repairedCollectiveProposalRepairCalls = 0;
const correctedCollectiveExpense = (ageInMonths: number) => {
  const proposal = rejectedCollectiveExpense(ageInMonths);
  const evidence = "你们每月共同承担房租5000元，其中你每月承担2500元（各半）。";
  return {
    ...proposal,
    financialScope: "shared_household",
    evidence,
    payload: {
      ...proposal.payload,
      monthlyAmountWan: 0.25,
      financialScope: "shared_household",
      amountBasis: "explicit_shared_amount",
      grossMonthlyAmountWan: 0.5,
      householdShareRate: 0.5,
      confirmedMonthlyAmountWan: 0.25,
      evidence: proposal.payload.evidence.map((item) => ({
        ...item,
        financialScope: "shared_household"
      }))
    }
  };
};
const repairedCollectiveNode = await generateNextNode({
  userData,
  answers,
  history: repairedCollectiveHistory,
  currentAttributes: repairedCollectiveHistory[0]!.attributes,
  selectedDecision: expenseGateChoice.text,
  nodeIndex: 2,
  simulationSeed: "expense-collective-repaired-authority"
}, {
  financialNodeGateMode: "shadow",
  expenseLifecycleMode: "enforced",
  callAiJson: async (prompt) => {
    const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || collectiveExpenseAgeBefore + 12);
    if (prompt.includes("你只修复财务 Proposal")) {
      repairedCollectiveProposalRepairCalls += 1;
      return { text: JSON.stringify({ financialEventProposals: [correctedCollectiveExpense(targetAgeInMonths)] }) };
    }
    repairedCollectiveFullCalls += 1;
    return {
      text: JSON.stringify({
        age: Math.floor(targetAgeInMonths / 12),
        stage: "共同住房核对",
        title: "共同房租的个人份额已确认",
        description: "你们每月共同承担房租5000元，其中你每月承担2500元（各半）。",
        choices: [
          { id: "A", text: "继续维持当前工作节奏", impactSummary: "保持现金流" },
          { id: "B", text: "重新核对住房安排", impactSummary: "确认份额" },
          { id: "C", text: "暂缓新增固定支出", impactSummary: "保守安排" }
        ],
        attributes: repairedCollectiveHistory[0]!.attributes,
        financialEventProposals: [rejectedCollectiveExpense(targetAgeInMonths)],
        isEndingNode: false
      })
    };
  }
});
assert.equal(repairedCollectiveFullCalls, 1);
assert.equal(repairedCollectiveProposalRepairCalls, 1);
const repairedCollectiveCommitment = repairedCollectiveNode.financialLedger?.expenseCommitments.find((item) => (
  item.id === "phase45_collective_household_total_as_personal"
));
assert.equal(repairedCollectiveCommitment?.financialScope, "shared_household");
assert.equal(repairedCollectiveCommitment?.monthlyAmountWan, 0.25);
assert.equal(repairedCollectiveCommitment?.grossMonthlyAmountWan, 0.5);
assert.equal(repairedCollectiveCommitment?.householdShareRate, 0.5);

let failedRepairCalls = 0;
const failedRepairNode = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "转向内容行业实习",
  nodeIndex: 1,
  simulationSeed: "finance-repair-fallback"
}, {
  // This fallback regression is about graceful handling of an unparseable
  // legacy financial repair, not production acceptance of that legacy input.
  financialNodeGateMode: "shadow",
  expenseLifecycleMode: "shadow",
  relationshipDispatchFeatureFlags: { enableRomanceFormationEvents: false },
  callAiJson: async (prompt) => {
    failedRepairCalls += 1;
    if (prompt.includes("你只负责补全一段人生剧情对应的财务变化")) {
      return { text: JSON.stringify({ financialSignals: { monthlyNetIncomeWan: "无法判断", reasons: [] } }) };
    }
    return {
      text: JSON.stringify({
        age: 23,
        stage: "试错开局",
        title: "新行业的第一年",
        description: "她准备处理一套房产，但正文没有给出已经成交或实际收款的财务数字。",
        choices: [
          { id: "A", text: "继续积累项目经验", impactSummary: "继续积累" },
          { id: "B", text: "寻找收入更稳的岗位", impactSummary: "稳定现金" },
          { id: "C", text: "利用业余时间小步试错", impactSummary: "控制风险" }
        ],
        attributes: { ...attributes, wealth: 88 },
        isEndingNode: false
      })
    };
  }
});

assert.equal(failedRepairCalls, 1);
assert.notEqual(failedRepairNode.attributes.wealth, 88);
assert.equal(failedRepairNode.financialSignals, undefined);
assert.equal(failedRepairNode.financialChange, undefined);
assert.equal(failedRepairNode.financialLedgerMode, "authoritative");

let rejectedDebtProposalRepairCalls = 0;
let rejectedDebtNarrativeRepairCalls = 0;
const rejectedDebtNarrativeNode = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "转向内容行业实习",
  nodeIndex: 1,
  simulationSeed: "rejected-debt-narrative-repair"
}, {
  // This compatibility regression isolates debt-narrative repair.  It uses
  // explicit shadow modes so the ordinary product default can remain
  // enforced: the test is proving the safe prose repair path, not that an
  // unresolved completed-loan fact may commit in production.
  financialNodeGateMode: "shadow",
  expenseLifecycleMode: "shadow",
  callAiJson: async (prompt) => {
    if (prompt.includes("你只修复财务 Proposal")) {
      rejectedDebtProposalRepairCalls += 1;
      return { text: JSON.stringify({ employmentTransition: null, financialEventProposals: [] }) };
    }
    if (prompt.includes("你只修复故事正文中的财务完成事实")) {
      rejectedDebtNarrativeRepairCalls += 1;
      return {
        text: JSON.stringify({
          descriptionParagraphs: [
            "银行仍在审核20万元经营贷款，资金尚未到账。你保留原工作，并继续用小项目验证需求。",
            "在融资没有完成前，你没有承担月供，也没有把计划中的贷款当作可用现金。"
          ]
        })
      };
    }
    const targetAgeInMonths = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || 23 * 12);
    return {
      text: JSON.stringify({
        age: 23,
        ageInMonths: targetAgeInMonths,
        stage: "创业试探",
        title: "贷款与项目",
        descriptionParagraphs: [
          "银行已经完成20万元经营贷款放款，你开始用这笔资金推进项目。",
          "贷款到账后，你每月还贷6083元，同时继续寻找稳定客户。"
        ],
        choices: [
          { id: "A", text: "保留工作继续验证", impactSummary: "控制风险" },
          { id: "B", text: "缩小项目等待审批", impactSummary: "缩小投入" },
          { id: "C", text: "寻找无需借款的合作", impactSummary: "替代融资" }
        ],
        attributes,
        financialEventProposals: [{
          id: "invalid_loan",
          kind: "debt_drawn",
          effectiveAtAgeInMonths: targetAgeInMonths,
          payload: {
            debtAccount: {
              id: "loan_invalid_destination", type: "family_or_personal_loan", displayName: "经营贷款",
              principalWan: 20, openedAtAgeInMonths: targetAgeInMonths, status: "active",
              repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 0.6083, remainingTermMonths: 36 },
              factStatus: "estimated", evidence: []
            },
            destinationCashAccountId: "missing_cash_account",
            principalDrawnWan: 20
          },
          evidence: "银行已经完成20万元经营贷款放款，你开始用这笔资金推进项目。",
          confidence: 0.9
        }],
        isEndingNode: false
      })
    };
  }
});

assert.equal(rejectedDebtProposalRepairCalls, 1);
assert.equal(rejectedDebtNarrativeRepairCalls, 1);
assert.equal(rejectedDebtNarrativeNode.financialState?.totalDebtWan, 0);
assert.doesNotMatch(rejectedDebtNarrativeNode.description, /贷款到账|完成20万元经营贷款放款|每月还贷6083元/);
assert.match(rejectedDebtNarrativeNode.description, /资金尚未到账/);

function healthArcHistory(phaseId: "recovery" | "operation", length: number): HistoryItem[] {
  const arc: PressureArcState = {
    id: `pressure_health_${phaseId}`,
    eventId: "health_forced_pause",
    eventIntentType: "health_forced_pause",
    phasePolicyId: "health_crisis_v1",
    phaseId,
    status: "active",
    startedAtAgeInMonths: 39 * 12,
    phaseStartedAtAgeInMonths: 40 * 12,
    phaseCheckpointCount: 0,
    totalCheckpointCount: phaseId === "recovery" ? 1 : 2,
    unresolvedSummary: "身体状态迫使原有生活节奏暂停"
  };

  return Array.from({ length }, (_, index) => ({
    age: 40,
    ageInMonths: 40 * 12,
    stage: "健康调整",
    title: `健康阶段历史 ${index + 1}`,
    description: "她已经开始治疗并重新安排工作负荷。",
    selectedChoice: `执行健康调整方案 ${index + 1}`,
    attributes: { ...attributes, health: 35 },
    choices: [{ id: "A", text: `执行健康调整方案 ${index + 1}`, impactSummary: "调整负荷" }],
    isEndingNode: false,
    worldStateSnapshot: {
      people: [],
      directionArcs: [],
      pressureArcs: [{ ...arc }],
      foregroundPressureArcId: arc.id,
      committedTransactionIds: [],
      version: 1
    }
  }));
}

function healthArcRawNode(input: { arcId: string; includeResolvedSignal?: boolean }) {
  const resultEvidence = "这次健康危机已经转为可以持续管理的长期状态。";
  return {
    age: 40,
    stage: "治疗观察",
    title: "重新安排后的生活",
    description: input.includeResolvedSignal
      ? `她保留治疗和减负安排，同时继续原来的方向。${resultEvidence}`
      : "她保留治疗和减负安排，同时继续原来的方向，身体状态仍需长期观察。",
    choices: [
      {
        id: "A",
        text: "维持减负后的工作节奏",
        impactSummary: "稳态执行",
        decisionIntent: "health:maintain:adjusted_load",
        expectedWorldDeltaTypes: ["health_state"]
      },
      {
        id: "B",
        text: "进一步委派工作并扩大支持",
        impactSummary: "扩大支持",
        decisionIntent: "career:delegate:workload",
        expectedWorldDeltaTypes: ["career_state"]
      },
      {
        id: "C",
        text: "重新规划长期生活结构",
        impactSummary: "重排生活",
        decisionIntent: "family:restructure:daily_life",
        expectedWorldDeltaTypes: ["relationship_change"]
      }
    ],
    attributes: { ...attributes, health: 36 },
    narrativeMeta: {
      recoveryState: "protected",
      recoveryEvidence: ["治疗、睡眠和工作减负安排已经稳定"],
      arcSignals: input.includeResolvedSignal
        ? [{
            pressureArcId: input.arcId,
            type: "pressure_resolved",
            evidence: resultEvidence,
            confidence: 0.95
          }]
        : [{
            pressureArcId: input.arcId,
            type: "pressure_persists",
            evidence: "身体状态仍需长期观察",
            confidence: 0.8
          }],
      worldDeltas: [{ type: "health_state", summary: "健康进入长期管理阶段" }]
    },
    isEndingNode: false
  };
}

let recoveryPrompt = "";
const recoveryHistory = healthArcHistory("recovery", 1);
const recoveryNode = await generateNextNode({
  userData,
  answers,
  history: recoveryHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续执行治疗和减负安排",
  nodeIndex: recoveryHistory.length,
  simulationSeed: "health-recovery-presentation"
}, {
  callAiJson: async (prompt) => {
    recoveryPrompt = prompt;
    const arcId = recoveryHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
    const node = healthArcRawNode({ arcId });
    node.narrativeMeta.arcSignals = [{
      pressureArcId: arcId,
      type: "stability_reached",
      evidence: "治疗、睡眠和工作减负安排已经稳定",
      confidence: 0.9
    }];
    node.description = "治疗、睡眠和工作减负安排已经稳定，她开始观察这一方案能否长期维持。";
    return { text: JSON.stringify(node) };
  }
});

assert.notEqual(recoveryNode.eventMeta?.eventId, "health_forced_pause");
assert.equal(recoveryNode.narrativeMeta?.lifeIntensity, "normal");
assert.equal(recoveryNode.committedArcMeta?.transitionAction, "advance");
assert.equal(recoveryNode.worldStateSnapshot?.pressureArcs[0]?.phaseId, "operation");
assert.match(recoveryPrompt, /健康恢复与观察阶段/);
assert.match(recoveryPrompt, /当前压力主线=身体状态迫使原有生活节奏暂停/);
assert.doesNotMatch(recoveryPrompt, /当前没有前台 PressureArc/);

let repeatedAcuteRecoveryCalls = 0;
const repairedRecoveryNode = await generateNextNode({
  userData,
  answers,
  history: recoveryHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续硬撑但观察身体状态",
  nodeIndex: recoveryHistory.length,
  simulationSeed: "health-recovery-acute-narrative-repair"
}, {
  callAiJson: async (prompt) => {
    repeatedAcuteRecoveryCalls += 1;
    const arcId = recoveryHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
    const candidate = healthArcRawNode({ arcId });
    if (repeatedAcuteRecoveryCalls === 1) {
      candidate.title = "再次倒下";
      candidate.description = "她在加班时突然胸闷倒地，拨打120后被送进急诊并被要求立即住院，身体状态仍需长期观察。";
    } else {
      assert.match(prompt, /健康 recovery\/operation 不得新增倒地、急救、再次住院或再次停摆/);
    }
    return { text: JSON.stringify(candidate) };
  }
});

assert.equal(repeatedAcuteRecoveryCalls, 2);
assert.notEqual(repairedRecoveryNode.eventMeta?.eventId, "health_forced_pause");
assert.doesNotMatch(`${repairedRecoveryNode.title}\n${repairedRecoveryNode.description}`, /再次倒下|突然胸闷倒地|拨打120|被送进急诊|要求立即住院/);

let operationRepairCalls = 0;
const operationHistory = healthArcHistory("operation", 12);
const operationArcId = operationHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
const resolvedHealthNode = await generateNextNode({
  userData,
  answers,
  history: operationHistory,
  currentAttributes: { ...attributes, health: 24 },
  selectedDecision: "接受长期健康管理方案",
  nodeIndex: operationHistory.length,
  simulationSeed: "health-operation-evidence-repair"
}, {
  callAiJson: async (prompt) => {
    operationRepairCalls += 1;
    const includeResolvedSignal = prompt.includes("健康 operation 结果证据修复");
    return { text: JSON.stringify(healthArcRawNode({ arcId: operationArcId, includeResolvedSignal })) };
  }
});

assert.equal(operationRepairCalls, 2);
assert.notEqual(resolvedHealthNode.eventMeta?.eventId, "health_forced_pause");
assert.equal(resolvedHealthNode.narrativeMeta?.lifeIntensity, "stable");
assert.equal(resolvedHealthNode.committedArcMeta?.transitionAction, "resolve");
assert.equal(resolvedHealthNode.worldStateSnapshot?.foregroundPressureArcId, undefined);
assert.equal(resolvedHealthNode.attributes.health, 30);
assert.equal(resolvedHealthNode.reportInvitation?.reason, "arc_resolved");
assert.equal(resolvedHealthNode.reportInvitation?.pressureArcId, operationArcId);
assert.deepEqual(resolvedHealthNode.reportInvitation?.resolutionEvidence, ["这次健康危机已经转为可以持续管理的长期状态。"]);

let failedOperationEvidenceCalls = 0;
const unresolvedOperationNode = await generateNextNode({
  userData,
  answers,
  history: operationHistory,
  currentAttributes: { ...attributes, health: 24 },
  selectedDecision: "继续观察但暂时没有明确结论",
  nodeIndex: operationHistory.length,
  simulationSeed: "health-operation-evidence-fallback"
}, {
  callAiJson: async () => {
    failedOperationEvidenceCalls += 1;
    return { text: JSON.stringify(healthArcRawNode({ arcId: operationArcId })) };
  }
});

assert.equal(failedOperationEvidenceCalls, 2);
assert.equal(unresolvedOperationNode.committedArcMeta?.transitionAction, "resolve");
assert.equal(unresolvedOperationNode.reportInvitation, undefined);

let lateOperationRepairCalls = 0;
let lateOperationDecisionRepairCalls = 0;
const lateOperationRepairNode = await generateNextNode({
  userData,
  answers,
  history: operationHistory,
  currentAttributes: { ...attributes, health: 24 },
  selectedDecision: "接受长期健康管理方案",
  nodeIndex: operationHistory.length,
  simulationSeed: "health-operation-late-evidence-repair"
}, {
  callAiJson: async (prompt) => {
    lateOperationRepairCalls += 1;
    if (prompt.includes("健康 operation 结果证据修复")) {
      return { text: JSON.stringify(healthArcRawNode({ arcId: operationArcId, includeResolvedSignal: true })) };
    }
    if (prompt.includes("DecisionGate 未通过")) {
      lateOperationDecisionRepairCalls += 1;
      const repaired = healthArcRawNode({ arcId: operationArcId });
      if (lateOperationDecisionRepairCalls === 1) {
        repaired.choices = repaired.choices.map((choice) => ({
          ...choice,
          decisionIntent: "health:wait:same-plan",
          expectedWorldDeltaTypes: ["health_state" as const]
        }));
      }
      return { text: JSON.stringify(repaired) };
    }
    const initiallyValidButChoiceBlocked = healthArcRawNode({ arcId: operationArcId, includeResolvedSignal: true });
    initiallyValidButChoiceBlocked.choices = initiallyValidButChoiceBlocked.choices.map((choice) => ({
      ...choice,
      decisionIntent: "health:wait:same-plan",
      expectedWorldDeltaTypes: ["health_state" as const]
    }));
    return { text: JSON.stringify(initiallyValidButChoiceBlocked) };
  }
});

assert.equal(lateOperationRepairCalls, 4);
assert.equal(lateOperationDecisionRepairCalls, 2);
assert.equal(lateOperationRepairNode.committedArcMeta?.transitionAction, "resolve");
assert.equal(lateOperationRepairNode.reportInvitation?.reason, "arc_resolved");
assert.notEqual(lateOperationRepairNode.eventMeta?.eventId, "health_forced_pause");
assert.deepEqual(lateOperationRepairNode.reportInvitation?.resolutionEvidence, ["这次健康危机已经转为可以持续管理的长期状态。"]);

let postResolutionPrompt = "";
const postResolutionHistory: HistoryItem[] = [
  ...operationHistory,
  {
    ...resolvedHealthNode,
    selectedChoice: "继续走向下一段人生"
  }
];
const postResolutionNode = await generateNextNode({
  userData,
  answers,
  history: postResolutionHistory,
  currentAttributes: { ...resolvedHealthNode.attributes, health: 50 },
  selectedDecision: "继续走向下一段人生",
  nodeIndex: postResolutionHistory.length,
  simulationSeed: "health-post-resolution-dynamic-event"
}, {
  // The synthetic pressure-arc history intentionally has no independently
  // confirmed career-income source. Keep this non-financial dispatch
  // regression out of the production enforced acceptance contract.
  financialNodeGateMode: "shadow",
  expenseLifecycleMode: "shadow",
  callAiJson: async (prompt) => {
    postResolutionPrompt = prompt;
    return { text: JSON.stringify(healthArcRawNode({ arcId: operationArcId })) };
  }
});

assert.notEqual(postResolutionNode.eventMeta?.eventId, "health_recovery_observation");
assert.doesNotMatch(postResolutionPrompt, /健康恢复与观察阶段|健康压力阶段结果/);

function genericArcHistory(phaseId: "growth" | "operation", length: number): HistoryItem[] {
  const arc: PressureArcState = {
    id: `pressure_generic_${phaseId}`,
    eventId: "career_venture_pressure",
    eventIntentType: "career_venture_pressure",
    phasePolicyId: "generic_pressure_v1",
    phaseId,
    status: "active",
    startedAtAgeInMonths: 35 * 12,
    phaseStartedAtAgeInMonths: 36 * 12,
    phaseCheckpointCount: 0,
    totalCheckpointCount: phaseId === "growth" ? 2 : 3,
    unresolvedSummary: "事业机会带来的现金流与长期方向压力"
  };

  return Array.from({ length }, (_, index) => ({
    age: 36,
    ageInMonths: 36 * 12,
    stage: "事业推进",
    title: `事业阶段历史 ${index + 1}`,
    description: "她仍在处理这次事业机会带来的现金流和长期方向压力。",
    selectedChoice: `处理事业机会 ${index + 1}`,
    attributes,
    choices: [{ id: "A", text: `处理事业机会 ${index + 1}`, impactSummary: "继续评估" }],
    isEndingNode: false,
    eventMeta: {
      eventId: "career_venture_pressure",
      eventCategory: "career",
      eventTags: ["career", "opportunity"],
      eventIntensity: "major",
      phasePolicyId: "generic_pressure_v1"
    },
    worldStateSnapshot: {
      people: [],
      directionArcs: [],
      pressureArcs: [{ ...arc }],
      foregroundPressureArcId: arc.id,
      committedTransactionIds: [],
      version: 1
    }
  }));
}

function genericArcRawNode(input: { arcId: string; includeResolvedSignal?: boolean }) {
  const resultEvidence = "这次事业压力已经转为可以继续管理的长期安排。";
  return {
    age: 36,
    stage: "事业重排",
    title: "重新分配事业风险",
    description: input.includeResolvedSignal
      ? `她把合作规模和现金流边界重新写进计划，同时保留长期方向。${resultEvidence}`
      : "她把合作规模和现金流边界重新写进计划，同时保留长期方向。",
    choices: [
      {
        id: "A",
        text: "缩小合作规模保住现金流",
        impactSummary: "控制风险",
        decisionIntent: "career:reduce:exposure",
        expectedWorldDeltaTypes: ["career_state"]
      },
      {
        id: "B",
        text: "保留机会但设置退出边界",
        impactSummary: "设置边界",
        decisionIntent: "career:boundary:exit",
        expectedWorldDeltaTypes: ["career_state"]
      },
      {
        id: "C",
        text: "寻找合作伙伴共同承担风险",
        impactSummary: "分担风险",
        decisionIntent: "relationship:support:shared",
        expectedWorldDeltaTypes: ["relationship_change"]
      }
    ],
    attributes: { ...attributes, wealth: 43 },
    narrativeMeta: {
      recoveryState: "neutral",
      recoveryEvidence: ["现金流边界已经写进计划"],
      arcSignals: input.includeResolvedSignal
        ? [{ pressureArcId: input.arcId, type: "pressure_resolved", evidence: resultEvidence, confidence: 0.9 }]
        : [{ pressureArcId: input.arcId, type: "pressure_addressed", evidence: "现金流边界已经写进计划", confidence: 0.85 }],
      worldDeltas: [{ type: "career_state", summary: "事业风险边界重新设定" }]
    },
    isEndingNode: false
  };
}

const originalMathRandom = Math.random;
// Choose a safe candidate deterministically for this fixture.
Math.random = () => 0.7;
try {
  let genericGrowthPrompt = "";
  const genericGrowthHistory = genericArcHistory("growth", 3);
  const genericGrowthNode = await generateNextNode({
    userData,
    answers,
    history: genericGrowthHistory,
    currentAttributes: attributes,
    selectedDecision: "继续评估事业机会",
    nodeIndex: genericGrowthHistory.length,
    simulationSeed: "generic-growth-dynamic-event"
  }, {
    callAiJson: async (prompt) => {
      genericGrowthPrompt = prompt;
      return { text: JSON.stringify(genericArcRawNode({ arcId: "pressure_generic_growth" })) };
    }
  });

  assert.notEqual(genericGrowthNode.eventMeta?.eventId, "career_venture_pressure");
  assert.equal(genericGrowthNode.committedArcMeta?.pressureArcId, "pressure_generic_growth");
  assert.equal(genericGrowthNode.committedArcMeta?.transitionAction, "advance");
  assert.match(genericGrowthPrompt, /当前压力主线=事业机会带来的现金流与长期方向压力/);
  assert.equal(genericGrowthNode.narrativeMeta?.lifeIntensity, "normal");

  const genericOperationHistory = genericArcHistory("operation", 12);
  const genericOperationArcId = genericOperationHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
  const genericOperationNode = await generateNextNode({
    userData,
    answers,
    history: genericOperationHistory,
    currentAttributes: attributes,
    selectedDecision: "确认长期风险边界",
    nodeIndex: genericOperationHistory.length,
    simulationSeed: "generic-operation-dynamic-event"
  }, {
    // Long synthetic pressure histories do not model a confirmed income
    // source. This assertion covers pressure-arc resolution only.
    financialNodeGateMode: "shadow",
    expenseLifecycleMode: "shadow",
    callAiJson: async () => ({ text: JSON.stringify(genericArcRawNode({ arcId: genericOperationArcId, includeResolvedSignal: true })) })
  });

  assert.notEqual(genericOperationNode.eventMeta?.eventId, "career_venture_pressure");
  assert.equal(genericOperationNode.committedArcMeta?.pressureArcId, genericOperationArcId);
  assert.equal(genericOperationNode.committedArcMeta?.transitionAction, "resolve");
assert.equal(genericOperationNode.worldStateSnapshot?.foregroundPressureArcId, undefined);
assert.equal(genericOperationNode.narrativeMeta?.lifeIntensity, "stable");
} finally {
  Math.random = originalMathRandom;
}

function pressureDenseRelationshipHistory(input: {
  deferredCount: number;
  atPhaseGap: boolean;
  currentAgeInMonths?: number;
}): HistoryItem[] {
  const currentAgeInMonths = input.currentAgeInMonths ?? 378;
  const progression = createExplorationProgression(360);
  const relationship = {
    id: "relationship_pressure_interleave",
    participantPersonIds: ["person_pressure_interleave"],
    type: "romantic" as const,
    stage: "exploring" as const,
    status: "active" as const,
    effectiveFromAgeInMonths: 360,
    progression,
    source: "accepted_history" as const,
    confidence: 0.95
  };
  const checkpointKey = relationshipCheckpointKey({ relationship, progression });
  const arc: PressureArcState = {
    id: "pressure_dense_relationship",
    eventId: "career_venture_pressure",
    eventIntentType: "career_venture_pressure",
    phasePolicyId: "generic_pressure_v1",
    phaseId: "growth",
    status: "active",
    startedAtAgeInMonths: 340,
    phaseStartedAtAgeInMonths: 370,
    phaseCheckpointCount: 0,
    totalCheckpointCount: 2,
    unresolvedSummary: "高压事业推进仍需分阶段处理"
  };

  return Array.from({ length: input.deferredCount }, (_, index) => ({
    age: Math.floor(currentAgeInMonths / 12),
    ageInMonths: currentAgeInMonths,
    stage: "压力密集期",
    title: `关系检查点推迟 ${index + 1}`,
    description: "事业压力事件占用了这一节点，关系检查点保留等待恢复。",
    selectedChoice: "继续处理当前压力",
    selectedDecisionIntent: "career:continue:pressure_arc",
    attributes,
    choices: [{
      id: "A",
      text: "继续处理当前压力",
      impactSummary: "推进压力事件",
      decisionIntent: "career:continue:pressure_arc"
    }],
    eventMeta: {
      eventId: "career_pressure_continuation",
      eventCategory: "career",
      eventTags: ["career", "pressure"],
      selectionKind: "forced",
      relationshipCheckpointKind: "exploration_review",
      relationshipCheckpointStatus: "due",
      relationshipCheckpointWaitMonths: currentAgeInMonths - progression.startedAtAgeInMonths,
      relationshipCheckpointDueAtAgeInMonths: progression.dueAtAgeInMonths,
      relationshipCheckpointMaxAtAgeInMonths: progression.maxAtAgeInMonths,
      relationshipCheckpointDeferred: true,
      relationshipCheckpointKey: checkpointKey,
      relationshipCheckpointDeferredCount: index + 1,
      relationshipCheckpointMustRestore: index + 1 >= 3
    },
    committedArcMeta: {
      pressureArcId: arc.id,
      phaseId: arc.phaseId,
      transitionAction: index === input.deferredCount - 1 && input.atPhaseGap
        ? "advance"
        : "stay"
    },
    isEndingNode: false,
    worldStateSnapshot: {
      people: [{
        id: "person_pressure_interleave",
        identityKey: { namespace: "accepted_character", key: "candidate_pressure_interleave" },
        displayName: "林遥",
        relation: "partner",
        lifeStatus: "active",
        relationshipSummary: "正在持续了解的同一人物",
        source: "accepted_history",
        confidence: 0.95
      }],
      directionArcs: [],
      pressureArcs: [{ ...arc }],
      foregroundPressureArcId: arc.id,
      relationships: [{ ...relationship, progression: { ...progression } }],
      relationshipProgressionVersion: 1,
      committedTransactionIds: [],
      version: 2
    }
  }));
}

function relationshipCheckpointRawNode() {
  return {
    age: 31,
    stage: "关系复盘",
    title: "需要确认的相处方向",
    description: "你和林遥持续联系了一段时间。现在你们需要决定正式交往、继续慢慢了解，还是结束浪漫探索。",
    choices: [
      { id: "A", text: "确认接下来的关系方向", impactSummary: "确认方向" },
      { id: "B", text: "讨论彼此的现实节奏", impactSummary: "讨论节奏" },
      { id: "C", text: "说明各自的边界", impactSummary: "说明边界" }
    ],
    attributes,
    narrativeMeta: {
      activeCharacters: []
    },
    isEndingNode: false
  };
}

const directRelationshipHistory = pressureDenseRelationshipHistory({
  deferredCount: 1,
  atPhaseGap: false,
  currentAgeInMonths: 372
}).map((item) => ({
  ...item,
  eventMeta: {
    eventId: "ordinary_before_relationship_checkpoint",
    eventCategory: "career" as const,
    eventTags: ["career"],
    selectionKind: "main" as const
  },
  committedArcMeta: undefined,
  worldStateSnapshot: {
    ...item.worldStateSnapshot!,
    pressureArcs: [],
    foregroundPressureArcId: undefined
  }
}));
const directRelationshipNode = await generateNextNode({
  userData,
  answers,
  history: directRelationshipHistory,
  currentAttributes: attributes,
  selectedDecision: "继续当前生活",
  nodeIndex: directRelationshipHistory.length,
  simulationSeed: "relationship-due-without-forced-event"
}, {
  callAiJson: async () => ({ text: JSON.stringify(relationshipCheckpointRawNode()) })
});

assert.equal(directRelationshipNode.eventMeta?.eventId, "romance_connection_clarification");
assert.equal(directRelationshipNode.eventMeta?.selectionKind, "relationship_follow_up");
assert.equal(directRelationshipNode.eventMeta?.relationshipCheckpointStatus, "due");
assert.equal(directRelationshipNode.eventMeta?.relationshipCheckpointDeferredCount, 0);
assert.notEqual(directRelationshipNode.eventMeta?.relationshipCheckpointMustRestore, true);

const deadlineBeforeNewHealthArcHistory = pressureDenseRelationshipHistory({
  deferredCount: 1,
  atPhaseGap: false,
  currentAgeInMonths: 378
}).map((item) => ({
  ...item,
  eventMeta: {
    eventId: "ordinary_at_relationship_deadline",
    eventCategory: "career" as const,
    eventTags: ["career"],
    selectionKind: "main" as const
  },
  committedArcMeta: undefined,
  worldStateSnapshot: {
    ...item.worldStateSnapshot!,
    pressureArcs: [],
    foregroundPressureArcId: undefined
  }
}));
const deadlineBeforeNewHealthArcNode = await generateNextNode({
  userData,
  answers,
  history: deadlineBeforeNewHealthArcHistory,
  currentAttributes: { ...attributes, health: 20 },
  selectedDecision: "继续当前生活",
  nodeIndex: deadlineBeforeNewHealthArcHistory.length,
  simulationSeed: "relationship-deadline-before-new-health-arc"
}, {
  callAiJson: async () => ({ text: JSON.stringify(relationshipCheckpointRawNode()) })
});

assert.equal(deadlineBeforeNewHealthArcNode.eventMeta?.eventId, "romance_connection_clarification");
assert.equal(deadlineBeforeNewHealthArcNode.eventMeta?.selectionKind, "relationship_follow_up");
assert.equal(deadlineBeforeNewHealthArcNode.ageInMonths, 379, "a new health arc must not push restoration past maxAt + 1");
assert.equal(deadlineBeforeNewHealthArcNode.worldStateSnapshot?.foregroundPressureArcId, undefined);

let pressureInterleavePrompt = "";
const pressureInterleaveHistory = pressureDenseRelationshipHistory({
  deferredCount: 3,
  atPhaseGap: true
});
const pressureArcBeforeInterleave = pressureInterleaveHistory.at(-1)!.worldStateSnapshot!.pressureArcs[0]!;
const restoredRelationshipNode = await generateNextNode({
  userData,
  answers,
  history: pressureInterleaveHistory,
  currentAttributes: attributes,
  selectedDecision: "继续处理当前压力",
  nodeIndex: pressureInterleaveHistory.length,
  simulationSeed: "pressure-relationship-starvation-free"
}, {
  callAiJson: async (prompt) => {
    pressureInterleavePrompt = prompt;
    return { text: JSON.stringify(relationshipCheckpointRawNode()) };
  }
});

assert.equal(restoredRelationshipNode.eventMeta?.eventId, "romance_connection_clarification");
assert.equal(restoredRelationshipNode.eventMeta?.selectionKind, "relationship_follow_up");
assert.equal(restoredRelationshipNode.eventMeta?.relationshipCheckpointDeferredCount, 3);
assert.equal(restoredRelationshipNode.eventMeta?.relationshipCheckpointMustRestore, true);
assert.notEqual(restoredRelationshipNode.eventMeta?.relationshipCheckpointDeferred, true);
assert.equal(restoredRelationshipNode.eventMeta?.pressureArcInterleaved, true);
assert.equal(restoredRelationshipNode.committedArcMeta?.transitionAction, "interleave");
assert.equal(restoredRelationshipNode.ageInMonths, 379, "the overdue restoration advances only one month");
assert.match(pressureInterleavePrompt, /为避免关系 checkpoint 饥饿或越过硬截止而插入 PressureArc/);
const pressureArcAfterInterleave = restoredRelationshipNode.worldStateSnapshot?.pressureArcs.find(
  (arc) => arc.id === pressureArcBeforeInterleave.id
);
assert.deepEqual(pressureArcAfterInterleave, pressureArcBeforeInterleave, "interleave must not advance or resolve the active pressure arc");
assert.equal(
  restoredRelationshipNode.narrativeMeta?.activeCharacters.find((character) => character.personId === "person_pressure_interleave")?.displayName,
  "林遥",
  "the restored checkpoint must keep the authoritative romantic person"
);

const noGapMustRestoreHistory = pressureDenseRelationshipHistory({
  deferredCount: 3,
  atPhaseGap: false,
  currentAgeInMonths: 376
});
const noGapPressureArcBeforeInterleave = noGapMustRestoreHistory.at(-1)!.worldStateSnapshot!.pressureArcs[0]!;
const noGapMustRestoreNode = await generateNextNode({
  userData,
  answers,
  history: noGapMustRestoreHistory,
  currentAttributes: attributes,
  selectedDecision: "继续处理当前压力",
  nodeIndex: noGapMustRestoreHistory.length,
  simulationSeed: "pressure-relationship-hard-three-node-bound"
}, {
  callAiJson: async () => ({ text: JSON.stringify(relationshipCheckpointRawNode()) })
});

assert.equal(noGapMustRestoreNode.eventMeta?.eventId, "romance_connection_clarification");
assert.equal(noGapMustRestoreNode.eventMeta?.selectionKind, "relationship_follow_up");
assert.equal(noGapMustRestoreNode.eventMeta?.relationshipCheckpointDeferredCount, 3);
assert.equal(noGapMustRestoreNode.eventMeta?.relationshipCheckpointMustRestore, true);
assert.equal(noGapMustRestoreNode.eventMeta?.pressureArcInterleaved, true);
assert.equal(noGapMustRestoreNode.committedArcMeta?.transitionAction, "interleave");
assert.equal(noGapMustRestoreNode.ageInMonths, 377, "three deferrals must restore even before the pressure phase gap");
assert.deepEqual(
  noGapMustRestoreNode.worldStateSnapshot?.pressureArcs.find((arc) => arc.id === noGapPressureArcBeforeInterleave.id),
  noGapPressureArcBeforeInterleave,
  "hard-bound interleave must preserve the active pressure arc"
);

const postHealthResolutionHistory = pressureDenseRelationshipHistory({
  deferredCount: 3,
  atPhaseGap: false
});
const postHealthResolutionLast = postHealthResolutionHistory.at(-1)!;
postHealthResolutionLast.committedArcMeta = {
  pressureArcId: "pressure_dense_relationship",
  phaseId: "operation",
  transitionAction: "resolve"
};
postHealthResolutionLast.worldStateSnapshot = {
  ...postHealthResolutionLast.worldStateSnapshot!,
  pressureArcs: [{
    ...postHealthResolutionLast.worldStateSnapshot!.pressureArcs[0],
    phaseId: "operation",
    status: "resolved"
  }],
  foregroundPressureArcId: undefined
};
const postHealthRestorationNode = await generateNextNode({
  userData,
  answers,
  history: postHealthResolutionHistory,
  currentAttributes: { ...attributes, health: 45 },
  selectedDecision: "继续恢复后的生活",
  nodeIndex: postHealthResolutionHistory.length,
  simulationSeed: "relationship-restored-after-health-resolution"
}, {
  callAiJson: async () => ({ text: JSON.stringify(relationshipCheckpointRawNode()) })
});

assert.equal(postHealthRestorationNode.eventMeta?.eventId, "romance_connection_clarification");
assert.equal(postHealthRestorationNode.eventMeta?.selectionKind, "relationship_follow_up");
assert.equal(postHealthRestorationNode.eventMeta?.relationshipCheckpointDeferredCount, 3);
assert.equal(postHealthRestorationNode.eventMeta?.relationshipCheckpointMustRestore, true);
assert.equal(postHealthRestorationNode.worldStateSnapshot?.foregroundPressureArcId, undefined);

const boundedPressureHistory = pressureDenseRelationshipHistory({
  deferredCount: 1,
  atPhaseGap: false,
  currentAgeInMonths: 377
});
const boundedPressureNode = await generateNextNode({
  userData,
  answers,
  history: boundedPressureHistory,
  currentAttributes: attributes,
  selectedDecision: "继续处理当前压力",
  nodeIndex: boundedPressureHistory.length,
  simulationSeed: "pressure-relationship-boundary-clamp"
}, {
  callAiJson: async () => ({
    text: JSON.stringify(genericArcRawNode({ arcId: "pressure_dense_relationship" }))
  })
});

assert.equal(boundedPressureNode.ageInMonths, 378, "forced-event duration must be clamped to the relationship maxAt boundary");
assert.equal(boundedPressureNode.eventMeta?.relationshipCheckpointDeferred, true);
assert.equal(boundedPressureNode.eventMeta?.relationshipCheckpointDeferredCount, 2);
assert.notEqual(boundedPressureNode.committedArcMeta?.transitionAction, "interleave");

const deadlinePressureHistory = [
  ...boundedPressureHistory,
  {
    ...boundedPressureNode,
    selectedChoice: boundedPressureNode.choices[0].text,
    selectedDecisionIntent: boundedPressureNode.choices[0].decisionIntent,
    selectedEventOutcomeId: boundedPressureNode.choices[0].eventOutcomeId
  } as HistoryItem
];
const deadlinePressureArcBeforeInterleave = deadlinePressureHistory.at(-1)!
  .worldStateSnapshot!.pressureArcs.find((arc) => arc.status === "active")!;
const deadlineRestorationNode = await generateNextNode({
  userData,
  answers,
  history: deadlinePressureHistory,
  currentAttributes: boundedPressureNode.attributes,
  selectedDecision: boundedPressureNode.choices[0].text,
  nodeIndex: deadlinePressureHistory.length,
  simulationSeed: "pressure-relationship-dispatch-deadline"
}, {
  callAiJson: async () => ({ text: JSON.stringify(relationshipCheckpointRawNode()) })
});

assert.equal(deadlineRestorationNode.eventMeta?.eventId, "romance_connection_clarification");
assert.equal(deadlineRestorationNode.eventMeta?.selectionKind, "relationship_follow_up");
assert.equal(deadlineRestorationNode.eventMeta?.relationshipCheckpointDeferredCount, 2);
assert.equal(deadlineRestorationNode.eventMeta?.relationshipCheckpointMustRestore, false);
assert.equal(deadlineRestorationNode.eventMeta?.pressureArcInterleaved, true);
assert.equal(deadlineRestorationNode.committedArcMeta?.transitionAction, "interleave");
assert.equal(deadlineRestorationNode.ageInMonths, 379, "dispatch must occur no later than maxAt + 1");
assert.deepEqual(
  deadlineRestorationNode.worldStateSnapshot?.pressureArcs.find((arc) => arc.id === deadlinePressureArcBeforeInterleave.id),
  deadlinePressureArcBeforeInterleave,
  "deadline interleave must preserve the active pressure arc without advancing its phase"
);

const legacyHealthHistory = healthArcHistory("operation", 1);
const legacyHealthArc = legacyHealthHistory.at(-1)!.worldStateSnapshot!.pressureArcs[0]!;
legacyHealthArc.phasePolicyId = "generic_pressure_v1";
legacyHealthArc.phaseId = "growth";
let legacyHealthPrompt = "";
const legacyHealthNode = await generateNextNode({
  userData,
  answers,
  history: legacyHealthHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续处理旧健康事件",
  nodeIndex: legacyHealthHistory.length,
  simulationSeed: "legacy-health-arc-compatibility"
}, {
  callAiJson: async (prompt) => {
    legacyHealthPrompt = prompt;
    return { text: JSON.stringify(healthArcRawNode({ arcId: legacyHealthArc.id })) };
  }
});

assert.equal(legacyHealthNode.eventMeta?.eventId, "health_recovery_observation");
assert.match(legacyHealthPrompt, /身体状态迫使原有生活节奏暂停/);

const missingOutcomeRandom = Math.random;
Math.random = () => 0.9;
try {
  let missingOutcomeAttempts = 0;
  let missingOutcomeRetryPrompt = "";
  const repairedMissingOutcomeNode = await generateNextNodeProduction({
    userData,
    answers,
    history,
    currentAttributes: attributes,
    selectedDecision: "继续推进但要求选项形成不同结果",
    nodeIndex: history.length,
    simulationSeed: "missing-event-outcome-contract"
  }, {
    callAiJson: async (prompt) => {
      missingOutcomeAttempts += 1;
      if (missingOutcomeAttempts > 1) missingOutcomeRetryPrompt = prompt;
      const allowedOutcomes = [...prompt.matchAll(/^\s*\d+\.\s*(\S+)\s*$/gm)].map((match) => match[1]).slice(0, 3);
      return {
        text: JSON.stringify({
          age: 23,
          stage: "现实选择",
          title: "下一步安排",
          description: "现有方向进入需要明确安排的阶段，三个方案会产生不同的现实后果。",
          choices: [
            { id: "A", text: "缩小范围继续推进", impactSummary: "收缩推进", decisionIntent: "career:narrow_scope:project", expectedWorldDeltaTypes: ["career_state"], eventOutcomeId: missingOutcomeAttempts > 1 ? allowedOutcomes[0] : undefined },
            { id: "B", text: "重新分配责任", impactSummary: "重组责任", decisionIntent: "career:delegate:project", expectedWorldDeltaTypes: ["career_state", "relationship_change"], eventOutcomeId: missingOutcomeAttempts > 1 ? allowedOutcomes[1] : undefined },
            { id: "C", text: "暂停并调整方向", impactSummary: "暂停调整", decisionIntent: "career:pause:project", expectedWorldDeltaTypes: ["career_state"], eventOutcomeId: missingOutcomeAttempts > 1 ? allowedOutcomes[2] : undefined }
          ],
          attributes,
          isEndingNode: false
        })
      };
    }
  });
  assert.equal(missingOutcomeAttempts, 2);
  assert.match(missingOutcomeRetryPrompt, /choice\.eventOutcomeId 缺失或不在本事件 allowedOutcomes 中/);
  assert.match(missingOutcomeRetryPrompt, /每个 choice 都必须从当前事件 allowedOutcomes 中原样选择/);
assert.ok(repairedMissingOutcomeNode.choices.every((choice) => choice.eventOutcomeId));
} finally {
  Math.random = missingOutcomeRandom;
}

{
  const proposals = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "接受全职前端职位",
    narrativeText: "你正式入职，税后月薪7000元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "accept_frontend_role",
    periodStartAgeInMonths: 286,
    currentCareerStateId: "career_frontend_286",
    currentEmploymentStatus: "employed",
    migrateToCurrentCareerState: true,
    ledger: {
      ...structuredClone(history.at(-1)!.financialLedger!),
      incomeSources: [{
        id: "old_internship_income",
        type: "salary",
        displayName: "旧实习工资",
        monthlyNetAmountWan: 0.1,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 250,
        status: "active",
        linkedCareerStateId: "career_internship",
        factStatus: "known",
        evidence: []
      }]
    }
  });
  const adjusted = proposals.find((proposal) => proposal.kind === "income_source_adjusted");
  if (!adjusted || adjusted.kind !== "income_source_adjusted") {
    throw new Error("expected an income adjustment for the confirmed new salary");
  }
  const adjustedPayload = adjusted.payload as { nextSource: { monthlyNetAmountWan?: number; linkedCareerStateId?: string } };
  assert.ok(Math.abs(Number(adjustedPayload.nextSource.monthlyNetAmountWan) - 0.7) < 1e-9);
  assert.equal(adjustedPayload.nextSource.linkedCareerStateId, "career_frontend_286");
}
const relationshipOptionAHistory: HistoryItem[] = [{
  age: 36,
  ageInMonths: 36 * 12,
  stage: "生活交汇",
  title: "平淡中的细微抉择",
  description: "公司给出华东分部半年的外派机会，你需要决定是否离开当前生活节奏。",
  selectedChoice: "接受华东外派，拉近与陈曦的距离",
  selectedDecisionIntent: "career:accept:regional_assignment",
  attributes,
  choices: [
    { id: "A", text: "接受华东外派，拉近与陈曦的距离", impactSummary: "接受外派", eventOutcomeId: "accept_regional_assignment" },
    { id: "B", text: "留在本地继续当前项目", impactSummary: "保持本地" },
    { id: "C", text: "申请缩短外派周期", impactSummary: "折中安排" }
  ],
  isEndingNode: false
}];
const relationshipOptionADecision = relationshipOptionAHistory[0].selectedChoice!;
// This group tests relationship redispatch and rescheduling against a
// deliberately finance-incomplete fixture. Its shadow setting is explicit so
// the application default remains the production enforced contract.
const relationshipCompatibilityFinancialDeps = {
  financialNodeGateMode: "shadow" as const,
  expenseLifecycleMode: "shadow" as const
};
const relationshipOptionABranch = buildBranchFingerprint(relationshipOptionAHistory, relationshipOptionADecision, 1);
let romanceFallbackSeed = "";
for (let index = 0; index < 2_000; index += 1) {
  const candidateSeed = `relationship-option-a-${index}`;
  const selected = queryDynamicLifeEvent(
    attributes,
    userData,
    36,
    relationshipOptionAHistory,
    answers,
    {
      applyCareerLineMix: true,
      enableRomanceFormationEvents: true,
      entropy: createSelectionEntropy({ simulationSeed: candidateSeed, branchFingerprint: relationshipOptionABranch, nodeIndex: 1 })
    }
  );
  if (selected?.id === "romance_new_connection") {
    romanceFallbackSeed = candidateSeed;
    break;
  }
}
assert.ok(romanceFallbackSeed, "the regression must deterministically select romance_new_connection");

let romanceFullNodeCalls = 0;
let romanceCandidateRepairCalls = 0;
let fallbackFullNodeCalls = 0;
const optionAFallbackNode = await generateNextNode({
  userData,
  answers,
  history: relationshipOptionAHistory,
  currentAttributes: attributes,
  selectedDecision: relationshipOptionADecision,
  nodeIndex: 1,
  simulationSeed: romanceFallbackSeed
}, {
  ...relationshipCompatibilityFinancialDeps,
  callAiJson: async (prompt) => {
    if (/你只负责从既有正文中提取一个候选人物脚手架/.test(prompt)) {
      romanceCandidateRepairCalls += 1;
      return { text: JSON.stringify({ activeCharacters: [] }) };
    }
    const isRomanceNode = /type: romance_new_connection/.test(prompt);
    if (isRomanceNode) romanceFullNodeCalls += 1;
    else fallbackFullNodeCalls += 1;
    return {
      text: JSON.stringify({
        age: 37,
        stage: isRomanceNode ? "外派后的新节奏" : "外派安排落地",
        title: isRomanceNode ? "业务交流中的新联系人" : "异地生活的第一轮调整",
        description: isRomanceNode
          ? "你在区域项目会上认识客户经理苏棠，会后加了微信，继续讨论合同和交付安排。"
          : "你抵达华东分部后重新安排通勤、工作交接和固定休息时间，外派生活逐渐形成可执行的节奏。",
        choices: [
          { id: "A", text: "按原计划推进重点项目", impactSummary: "推进项目", decisionIntent: "career:continue:regional_project" },
          { id: "B", text: "缩小项目范围并稳定生活", impactSummary: "稳定节奏", decisionIntent: "career:narrow:regional_project" },
          { id: "C", text: "交接部分职责并重新评估外派", impactSummary: "重新评估", decisionIntent: "career:delegate:regional_project" }
        ],
        attributes,
        narrativeMeta: { activeCharacters: [] },
        isEndingNode: false
      })
    };
  }
});

assert.equal(romanceFullNodeCalls, 1, "the failed romance event must not run three full-node retries");
assert.equal(romanceCandidateRepairCalls, 1, "candidate extraction gets one localized repair attempt");
assert.equal(fallbackFullNodeCalls, 1, "the original option A must continue through one ordinary redispatch");
assert.notEqual(optionAFallbackNode.eventMeta?.eventId, "romance_new_connection");
assert.equal(optionAFallbackNode.eventMeta?.requestedEventId, "romance_new_connection");
assert.match(optionAFallbackNode.eventMeta?.fallbackReason || "", /^romance_contract_failed:/);
assert.equal(optionAFallbackNode.eventMeta?.romanceRepairAttempted, true);
assert.equal(optionAFallbackNode.eventMeta?.romanceRepairSucceeded, false);
assert.equal(optionAFallbackNode.eventMeta?.romanceRescheduled, true);
assert.equal(optionAFallbackNode.worldStateSnapshot?.relationships.length || 0, 0, "render-time fallback must not commit a relationship");

const completedFallbackNode: HistoryItem = {
  ...optionAFallbackNode,
  selectedChoice: optionAFallbackNode.choices[0].text,
  selectedDecisionIntent: optionAFallbackNode.choices[0].decisionIntent
};
const deferredBranch = buildBranchFingerprint([completedFallbackNode], completedFallbackNode.selectedChoice!, 2);
let immediateRomanceSeed = "";
for (let index = 0; index < 2_000; index += 1) {
  const candidateSeed = `relationship-deferred-${index}`;
  const selected = queryDynamicLifeEvent(
    attributes,
    userData,
    completedFallbackNode.ageInMonths! / 12,
    [completedFallbackNode],
    answers,
    {
      applyCareerLineMix: true,
      enableRomanceFormationEvents: true,
      entropy: createSelectionEntropy({ simulationSeed: candidateSeed, branchFingerprint: deferredBranch, nodeIndex: 2 })
    }
  );
  if (selected?.id === "romance_new_connection") {
    immediateRomanceSeed = candidateSeed;
    break;
  }
}
assert.ok(immediateRomanceSeed, "control seed must otherwise select romance immediately");
const deferredOnceNode = await generateNextNode({
  userData,
  answers,
  history: [completedFallbackNode],
  currentAttributes: attributes,
  selectedDecision: completedFallbackNode.selectedChoice!,
  nodeIndex: 2,
  simulationSeed: immediateRomanceSeed
}, {
  ...relationshipCompatibilityFinancialDeps,
  callAiJson: async () => ({
    text: JSON.stringify({
      age: 38,
      stage: "外派生活",
      title: "先安顿眼前的生活",
      description: "你先完成住所、通勤和工作交接安排，让外派后的日常重新稳定下来。",
      choices: [
        { id: "A", text: "维持当前安排", impactSummary: "保持节奏" },
        { id: "B", text: "减少非必要任务", impactSummary: "降低负荷" },
        { id: "C", text: "重新协调工作边界", impactSummary: "调整边界" }
      ],
      attributes,
      isEndingNode: false
    })
  })
});
assert.notEqual(deferredOnceNode.eventMeta?.eventId, "romance_new_connection", "the owed event must not return immediately");
assert.notEqual(deferredOnceNode.eventMeta?.romanceRescheduleFulfilled, true);

const deferredOrdinaryNodes: HistoryItem[] = [1, 2].map((offset) => ({
  age: 37 + offset,
  ageInMonths: (37 + offset) * 12,
  stage: "外派生活",
  title: `外派后的普通节点 ${offset}`,
  description: "你继续处理日常工作和生活安排。",
  selectedChoice: "保持当前节奏",
  selectedDecisionIntent: "career:continue:ordinary_rhythm",
  attributes,
  choices: [{ id: "A", text: "保持当前节奏", impactSummary: "保持节奏" }],
  isEndingNode: false,
  eventMeta: {
    eventId: `ordinary_after_romance_fallback_${offset}`,
    eventCategory: "career",
    routeLine: "career",
    eventTags: ["career"],
    selectionKind: "main"
  },
  worldStateSnapshot: optionAFallbackNode.worldStateSnapshot
}));
let fulfilledRomanceCalls = 0;
const fulfilledRomanceNode = await generateNextNode({
  userData,
  answers,
  history: [completedFallbackNode, ...deferredOrdinaryNodes],
  currentAttributes: attributes,
  selectedDecision: "保持当前节奏",
  nodeIndex: 3,
  simulationSeed: "relationship-option-a-reschedule"
}, {
  ...relationshipCompatibilityFinancialDeps,
  callAiJson: async (prompt) => {
    assert.match(prompt, /type: romance_new_connection/);
    fulfilledRomanceCalls += 1;
    const evidence = "周岚说她也常去城南旧书市集，你们约好下周在那里见面。";
    return {
      text: JSON.stringify({
        age: 40,
        stage: "生活里的新联系",
        title: "旧书市集前的约定",
        description: `外派结束前，你在书店活动认识了周岚。${evidence}`,
        choices: [
          { id: "A", text: "下周去旧书市集", impactSummary: "继续了解" },
          { id: "B", text: "保持普通联系", impactSummary: "普通认识" },
          { id: "C", text: "说明暂不考虑发展", impactSummary: "婉拒发展" }
        ],
        attributes,
        narrativeMeta: {
          activeCharacters: [{
            candidateOrdinal: 0,
            displayName: "周岚",
            relation: "other",
            presenceMode: "active_scene",
            currentRole: "书店活动参与者",
            encounterType: "new_connection",
            encounterContext: "personal",
            groundingEvidence: evidence
          }]
        },
        isEndingNode: false
      })
    };
  }
});

assert.equal(fulfilledRomanceCalls, 1);
assert.equal(fulfilledRomanceNode.eventMeta?.eventId, "romance_new_connection");
assert.equal(fulfilledRomanceNode.eventMeta?.romanceRescheduleFulfilled, true);
assert.equal(fulfilledRomanceNode.eventMeta?.romanceRescheduleDelayNodes, 2);
assert.equal(fulfilledRomanceNode.eventMeta?.selectionKind, "unmixed");
assert.equal(fulfilledRomanceNode.narrativeMeta?.relationshipProposals?.length, 2);
assert.equal(fulfilledRomanceNode.worldStateSnapshot?.relationships.length || 0, 0, "rescheduled rendering still waits for the user's outcome");
