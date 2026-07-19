import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, UserInitialData } from "../../types";
import { generateNextNode as generateNextNodeProduction, generateQuestions, narrativeRequiresCareerTransition, startSimulation } from "./simulationService";
import { generateNextNodeWithEventOutcomes as generateNextNode } from "./testEventOutcomeAdapter";
import { deriveWealthScore, estimateFinancialStateFromWealth, normalizeInitialFinancialState } from "../../utils/financialState";

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
      return { text: JSON.stringify(healthArcRawNode({ arcId: operationArcId })) };
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

assert.equal(lateOperationRepairCalls, 3);
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
