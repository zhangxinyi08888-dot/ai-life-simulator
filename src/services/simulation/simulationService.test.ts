import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
import { generateNextNode, generateQuestions, startSimulation } from "./simulationService";
import { deriveWealthScore, estimateFinancialStateFromWealth } from "../../utils/financialState";

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
assert.equal(started.initialAttributes.wealth, 38);
assert.equal(started.startNode.choices.length, 3);
assert.equal(started.startNode.age, 22);

const attributes: LifeAttributes = { happiness: 50, intelligence: 70, wealth: 42, relation: 55, health: 64 };
const history: HistoryItem[] = [
  {
    age: 22,
    stage: "毕业选择",
    title: "第一份工作的岔路",
    description: "她拿着录用通知，反复比较通勤、工资和成长空间。",
    selectedChoice: "转向内容行业实习",
    attributes,
    choices: [{ id: "A", text: "转向内容行业实习", impactSummary: "内容试水" }],
    isEndingNode: false
  }
];
let capturedNextPrompt = "";

const nextNode = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "转向内容行业实习",
  nodeIndex: 1
}, {
  callAiJson: async (prompt) => {
    capturedNextPrompt = prompt;
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
        attributes,
        financialSignals: {
          employmentStatus: "part_time",
          monthlyNetIncomeWan: 1,
          incomeMonths: 1,
          monthlyLivingExpenseWan: 0.5,
          oneOffIncomeWan: 0,
          oneOffExpenseWan: 1,
          assetValueChangeWan: 1,
          personalDebtChangeWan: 0,
          incomeStability: "volatile",
          confidence: 0.9,
          reasons: ["转行初期收入降低"]
        },
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
assert.equal(nextNode.financialSignals?.employmentStatus, "part_time");
assert.ok(nextNode.financialChange);
assert.ok(nextNode.financialState);
assert.equal(nextNode.attributes.wealth, Math.min(attributes.wealth + 12, deriveWealthScore(nextNode.financialState!)));

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
  assert.notEqual(degradedNode.financialState?.netWorthWan, previousFinancialState.netWorthWan);
  assert.equal(degradedNode.financialState?.isEstimated, true);
  assert.ok(degradedNode.financialSignals);
  assert.ok(degradedNode.financialChange);
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
  enableFinancialRepair: true,
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

const repairPreviousState = estimateFinancialStateFromWealth(attributes.wealth, history[0].age * 12);
assert.equal(financialRepairCalls, 2);
assert.match(capturedFinancialRepairPrompt, /月薪、月入、年薪/);
assert.match(capturedFinancialRepairPrompt, /生活支出不能无故为 0/);
assert.equal(repairedFinancialNode.financialSignals?.confidence, 0.9);
assert.ok((repairedFinancialNode.financialState?.netWorthWan || 0) > repairPreviousState.netWorthWan);

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
  enableFinancialRepair: true,
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

assert.equal(failedRepairCalls, 2);
assert.notEqual(failedRepairNode.attributes.wealth, 88);
assert.ok(failedRepairNode.financialSignals);
assert.ok(failedRepairNode.financialChange);
