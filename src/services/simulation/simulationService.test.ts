import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, UserInitialData } from "../../types";
import { buildDeterministicFinancialNarrativeRollback, generateNextNode as generateNextNodeProduction, generateQuestions, narrativeRequiresCareerTransition, rollbackRejectedFinancialCompletionTitle, startSimulation, synthesizeSelectedCareerTransition, synthesizeSelectedPersonalIncomeProposal } from "./simulationService";
import { generateNextNodeWithEventOutcomes as generateNextNode } from "./testEventOutcomeAdapter";
import { deriveWealthScore, estimateFinancialStateFromWealth, normalizeInitialFinancialState } from "../../utils/financialState";
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

const rejectedRestructureRollback = buildDeterministicFinancialNarrativeRollback({
  rejectedProposals: [{
    id: "rejected_restructure",
    kind: "debt_restructured",
    effectiveAtAgeInMonths: 420,
    sourceOutcomeId: "request_restructure",
    payload: {},
    evidence: "银行已经批准调整还款计划。",
    confidence: 0.9
  }],
  acceptedEvents: [],
  narrativeText: "银行已经批准调整还款计划。你松了一口气，虽然月供仍不轻松，但压力减轻了不少。你继续整理未来六个月的收支材料。两个月后，你签了补充协议。"
});
assert.match(rejectedRestructureRollback.join("\n"), /尚未形成生效协议/u);
assert.doesNotMatch(rejectedRestructureRollback.join("\n"), /签了补充协议/u);
assert.doesNotMatch(rejectedRestructureRollback.join("\n"), /松了一口气|压力减轻/u);
assert.match(rejectedRestructureRollback.join("\n"), /继续整理未来六个月的收支材料/u);
assert.equal(rollbackRejectedFinancialCompletionTitle("债务重组与业务转机", [{
  id: "rejected_restructure_title",
  kind: "debt_restructured",
  effectiveAtAgeInMonths: 420,
  sourceOutcomeId: "request_restructure",
  payload: {},
  evidence: "申请调整还款安排",
  confidence: 0.9
}]), "还款协商与现实调整");

const rejectedCompensationRollback = buildDeterministicFinancialNarrativeRollback({
  rejectedProposals: [{
    id: "rejected_backpay",
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: 486,
    sourceOutcomeId: "financing_closed",
    payload: {},
    evidence: "创始人补发了过去14个月的税后工资。",
    confidence: 0.9
  }, {
    id: "rejected_equity",
    kind: "business_holding_started",
    effectiveAtAgeInMonths: 486,
    sourceOutcomeId: "financing_closed",
    payload: {},
    evidence: "创始人签署了5%的股权协议。",
    confidence: 0.9
  }],
  acceptedEvents: [],
  narrativeText: "领投方资金到账。创始人补发了过去14个月的税后工资，并签署了5%的股权协议。"
});
assert.match(rejectedCompensationRollback.join("\n"), /领投方资金到账/u);
assert.doesNotMatch(rejectedCompensationRollback.join("\n"), /补发了过去14个月|签署了5%的股权协议/u);
assert.match(rejectedCompensationRollback.join("\n"), /补发收入的安排仍在核对|股权补偿仍在确认/u);
assert.equal(rollbackRejectedFinancialCompletionTitle("融资交割与股权确认", [{
  id: "rejected_equity_title",
  kind: "business_holding_started",
  effectiveAtAgeInMonths: 486,
  sourceOutcomeId: "financing_closed",
  payload: {},
  evidence: "签署5%的股权协议",
  confidence: 0.9
}]), "融资交割与权益安排待确认");

const rejectedRestructureBenefitRollback = buildDeterministicFinancialNarrativeRollback({
  rejectedProposals: [{
    id: "rejected_restructure_benefit",
    kind: "debt_restructured",
    effectiveAtAgeInMonths: 420,
    sourceOutcomeId: "request_restructure",
    payload: {},
    evidence: "你申请将贷款期限延长，以降低每月还款额。",
    confidence: 0.9
  }],
  acceptedEvents: [],
  narrativeText: "你已经尝试申请调整还款安排，但尚未形成生效协议。你算了一下，虽然利息总额会增加，但每月多出来的4000元现金流让你松了口气。你继续整理客户合同。"
});
assert.match(rejectedRestructureBenefitRollback.join("\n"), /尚未形成生效协议/u);
assert.doesNotMatch(rejectedRestructureBenefitRollback.join("\n"), /4000元|松了口气|利息总额会增加/u);
assert.match(rejectedRestructureBenefitRollback.join("\n"), /继续整理客户合同/u);

const rejectedDrawAndRestructureRollback = buildDeterministicFinancialNarrativeRollback({
  rejectedProposals: [{
    id: "rejected_draw_combined",
    kind: "debt_drawn",
    effectiveAtAgeInMonths: 424,
    sourceOutcomeId: "request_financing",
    payload: {},
    evidence: "你申请了一笔过桥借款。",
    confidence: 0.8
  }, {
    id: "rejected_restructure_combined",
    kind: "debt_restructured",
    effectiveAtAgeInMonths: 424,
    sourceOutcomeId: "request_financing",
    payload: {},
    evidence: "你同时提交了还款协商申请。",
    confidence: 0.8
  }],
  acceptedEvents: [],
  narrativeText: "你申请了一笔过桥借款。你反复核算，发现即便月供降低，现金流依然紧绷。家人和你提前还掉了一部分房贷本金，每月还款压力明显下降。睡眠仍时好时坏，但整体压力比之前有所缓解。"
});
assert.match(rejectedDrawAndRestructureRollback.join("\n"), /尚未形成已经到账的结果/u);
assert.match(rejectedDrawAndRestructureRollback.join("\n"), /尚未形成生效协议/u);
assert.doesNotMatch(rejectedDrawAndRestructureRollback.join("\n"), /即便月供降低/u);
assert.doesNotMatch(rejectedDrawAndRestructureRollback.join("\n"), /提前还掉|每月还款压力明显下降/u);
assert.doesNotMatch(rejectedDrawAndRestructureRollback.join("\n"), /整体压力比之前有所缓解/u);

const rejectedAdministrativeClosureRollback = buildDeterministicFinancialNarrativeRollback({
  rejectedProposals: [{
    id: "rejected_income_end",
    kind: "income_source_ended",
    effectiveAtAgeInMonths: 451,
    sourceOutcomeId: "keep_working",
    payload: { incomeSourceId: "salary_current" },
    evidence: "这份工资收入已经结束。",
    confidence: 0.7
  }],
  acceptedEvents: [],
  narrativeText: "这份工资收入已经结束。年底绩效奖金税后4万元到账。"
});
assert.doesNotMatch(rejectedAdministrativeClosureRollback.join("\n"), /工资收入已经结束|尝试推进这项财务安排/u);
assert.match(rejectedAdministrativeClosureRollback.join("\n"), /年底绩效奖金税后4万元到账/u);

const rejectedRecurringIncomeBenefitRollback = buildDeterministicFinancialNarrativeRollback({
  rejectedProposals: [{
    id: "rejected_side_income",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 430,
    sourceOutcomeId: "start_side_work",
    payload: {},
    evidence: "副业开始带来稳定收入。",
    confidence: 0.9
  }],
  acceptedEvents: [],
  narrativeText: "你开始接周末项目。副业带来的收入暂时缓解了经济紧张，也让你攒下一小笔应急金。你继续维护客户关系。"
});
assert.doesNotMatch(rejectedRecurringIncomeBenefitRollback.join("\n"), /副业带来的收入|攒下一小笔应急金/u);
assert.match(rejectedRecurringIncomeBenefitRollback.join("\n"), /实际到账的个人收入尚待确认|财务安排/u);
assert.match(rejectedRecurringIncomeBenefitRollback.join("\n"), /继续维护客户关系/u);

const rejectedIncomeCrossParagraphReliefRollback = buildDeterministicFinancialNarrativeRollback({
  rejectedProposals: [{
    id: "rejected_income_cross_paragraph",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 380,
    sourceOutcomeId: "new_income",
    payload: {},
    evidence: "新的收入来源已经稳定。",
    confidence: 0.8
  }],
  acceptedEvents: [],
  narrativeText: "与朋友退回普通关系后，你明显松了口气。新的收入来源已经稳定。\n\n父母分担房租后，你的生活压力小了一些。你恢复了规律运动。"
});
assert.match(rejectedIncomeCrossParagraphReliefRollback.join("\n"), /与朋友退回普通关系后，你明显松了口气/u);
assert.doesNotMatch(rejectedIncomeCrossParagraphReliefRollback.join("\n"), /父母分担房租|生活压力小/u);
assert.match(rejectedIncomeCrossParagraphReliefRollback.join("\n"), /恢复了规律运动/u);

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
assert.equal(mortgageStarted.startNode.financialState?.annualDisposableIncomeWan, 14.9);

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
        financialNarrativeClaims: [{
          id: "claim_content_bonus",
          proposalId: "content_bonus",
          kind: "one_off_income_received",
          surfaceText: "她收到一万元项目奖金。"
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
assert.deepEqual(nextNode.financialNarrativeClaims?.map((claim) => claim.id), ["claim_content_bonus"]);
assert.equal(nextNode.financialProcessingMeta?.financialNarrativeAuthorityVersion, "financial_narrative_claims_v1");
assert.doesNotMatch(nextNode.description, /存款约90万/);
assert.match(nextNode.description, /现金流|现金缓冲|储蓄|负债状态/);
assert.equal(nextNode.attributes.wealth, Math.min(attributes.wealth + 12, deriveWealthScore(nextNode.financialState!)));
assert.deepEqual(nextGenerationStages, ["preparing", "generating", "validating", "finalizing"]);
assert.equal(nextNarrativePreviews.at(-1)?.title, "新行业的第一年");
assert.match(nextNarrativePreviews.at(-1)?.paragraphs[0] || "", /小团队做基础内容执行/);

let malformedInitialGenerationCalls = 0;
const malformedInitialGenerationNode = await generateNextNode({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  selectedDecision: "继续推进，但不把尚未发生的结果写成事实",
  nodeIndex: history.length,
  simulationSeed: "malformed-initial-generation-deterministic-fallback"
}, {
  callAiJson: async () => {
    malformedInitialGenerationCalls += 1;
    return { text: "{invalid-json" };
  }
});

assert.equal(malformedInitialGenerationCalls, 2);
assert.match(malformedInitialGenerationNode.description, /尚未被写成未经权威状态确认的成功结果/u);
assert.equal(malformedInitialGenerationNode.choices.length, 3);

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
        financialNarrativeClaims: [{
          id: "claim_invalid_loan",
          proposalId: "invalid_loan",
          kind: "debt_drawn",
          surfaceText: "贷款到账后，你每月还贷6083元，同时继续寻找稳定客户。"
        }],
        isEndingNode: false
      })
    };
  }
});

assert.equal(rejectedDebtProposalRepairCalls, 1);
assert.equal(rejectedDebtNarrativeRepairCalls, 0);
assert.equal(rejectedDebtNarrativeNode.financialState?.totalDebtWan, 0);
assert.doesNotMatch(rejectedDebtNarrativeNode.description, /贷款到账|完成20万元经营贷款放款|每月还贷6083元/);
assert.match(rejectedDebtNarrativeNode.description, /尚未形成已经到账的结果/);
assert.equal(rejectedDebtNarrativeNode.financialNarrativeClaims?.length, 0);
assert.equal(rejectedDebtNarrativeNode.financialProcessingMeta?.rejectedFinancialNarrativeClaimCount, 2);

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
function candidatePatchResponse(prompt: string, input: {
  titleReplacement?: string;
  replacementParagraph?: string;
  replacementChoices?: ReturnType<typeof healthArcRawNode>["choices"];
}): string {
  const hash = prompt.match(/"baseCandidateHash":\s*"([^"]+)"/)?.[1];
  const revision = Number(prompt.match(/"targetCandidateRevision":\s*(\d+)/)?.[1] ?? 0);
  const issueCodesText = prompt.match(/"addressedIssueCodes":\s*(\[[^\]]*\])/)?.[1] ?? "[]";
  const allowedOutcomeText = prompt.match(/"allowedOutcomeIds":(\[[^\]]*\])/)?.[1] ?? "[]";
  const allowedOutcomeIds = JSON.parse(allowedOutcomeText) as string[];
  const paragraph = prompt.match(/"paragraphId":"([^"]+)","expectedTextHash":"([^"]+)"/);
  assert.ok(hash);
  return JSON.stringify({
    contractVersion: "node_candidate_patch_v1",
    baseCandidateHash: hash,
    targetCandidateRevision: revision,
    addressedIssueCodes: JSON.parse(issueCodesText),
    ...(input.titleReplacement ? { titleReplacement: input.titleReplacement } : {}),
    ...(input.replacementParagraph && paragraph ? {
      descriptionParagraphPatches: [{
        paragraphId: paragraph[1],
        expectedTextHash: paragraph[2],
        replacementText: input.replacementParagraph
      }]
    } : {}),
    ...(input.replacementChoices ? {
      replacementChoices: input.replacementChoices.map((choice, index) => ({
        ...choice,
        eventOutcomeId: allowedOutcomeIds[index % allowedOutcomeIds.length]
      }))
    } : {})
  });
}
const repairedRecoveryNode = await generateNextNode({
  userData,
  answers,
  history: recoveryHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续硬撑但观察身体状态",
  nodeIndex: recoveryHistory.length,
  simulationSeed: "health-recovery-acute-narrative-repair"
}, {
  enableCandidatePatchRepair: true,
  callAiJson: async (prompt) => {
    repeatedAcuteRecoveryCalls += 1;
    const arcId = recoveryHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
    const candidate = healthArcRawNode({ arcId });
    if (repeatedAcuteRecoveryCalls === 1) {
      candidate.title = "再次倒下";
      candidate.description = "她在加班时突然胸闷倒地，拨打120后被送进急诊并被要求立即住院，身体状态仍需长期观察。";
    } else {
      assert.match(prompt, /恢复或处置阶段不得再次生成急性停摆/);
      return { text: candidatePatchResponse(prompt, {
        titleReplacement: "持续观察",
        replacementParagraph: "复查显示身体状态仍需长期观察，她继续执行减负和治疗安排。"
      }) };
    }
    return { text: JSON.stringify(candidate) };
  }
});

assert.equal(repeatedAcuteRecoveryCalls, 2);
assert.notEqual(repairedRecoveryNode.eventMeta?.eventId, "health_forced_pause");
assert.doesNotMatch(`${repairedRecoveryNode.title}\n${repairedRecoveryNode.description}`, /再次倒下|突然胸闷倒地|拨打120|被送进急诊|要求立即住院/);

let defaultDisabledCandidatePatchCalls = 0;
let defaultDisabledSawPatchPrompt = false;
const defaultDisabledCandidatePatchTraces: Array<{ kind: string; outcome: string; issueCodes: string[] }> = [];
const defaultDisabledCandidatePatchNode = await generateNextNode({
  userData,
  answers,
  history: recoveryHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续硬撑但观察身体状态",
  nodeIndex: recoveryHistory.length,
  simulationSeed: "candidate-patch-disabled-by-default"
}, {
  onGenerationCallTrace: (trace) => {
    if (trace.outcome !== "started") defaultDisabledCandidatePatchTraces.push(trace);
  },
  callAiJson: async (prompt) => {
    defaultDisabledCandidatePatchCalls += 1;
    if (prompt.includes("node_candidate_patch_v1")) defaultDisabledSawPatchPrompt = true;
    const arcId = recoveryHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
    const candidate = healthArcRawNode({ arcId });
    if (defaultDisabledCandidatePatchCalls === 1) {
      candidate.title = "再次倒下";
      candidate.description = "她在加班时突然胸闷倒地，身体状态仍需长期观察。";
    }
    return { text: JSON.stringify(candidate) };
  }
});

assert.equal(defaultDisabledCandidatePatchCalls, 2);
assert.equal(defaultDisabledSawPatchPrompt, false);
assert.ok(defaultDisabledCandidatePatchTraces.some((trace) => (
  trace.kind === "full_regeneration"
  && trace.outcome === "succeeded"
  && trace.issueCodes.includes("REPEATED_ACUTE_HEALTH_CRISIS")
)));
assert.doesNotMatch(`${defaultDisabledCandidatePatchNode.title}\n${defaultDisabledCandidatePatchNode.description}`, /再次倒下|突然胸闷倒地/);

let deterministicDecisionGateCalls = 0;
const deterministicDecisionGateNode = await generateNextNode({
  userData,
  answers,
  history: recoveryHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续执行恢复安排",
  nodeIndex: recoveryHistory.length,
  simulationSeed: "decision-gate-deterministic-before-regeneration"
}, {
  callAiJson: async () => {
    deterministicDecisionGateCalls += 1;
    const arcId = recoveryHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
    const candidate = healthArcRawNode({ arcId });
    candidate.choices = candidate.choices.map((choice) => ({
      ...choice,
      decisionIntent: "health:wait:same-plan",
      expectedWorldDeltaTypes: ["health_state"]
    }));
    return { text: JSON.stringify(candidate) };
  }
});

assert.equal(deterministicDecisionGateCalls, 1);
assert.equal(new Set(deterministicDecisionGateNode.choices.map((choice) => choice.decisionIntent)).size >= 2, true);

let exhaustedRecursiveGenerationCalls = 0;
const deterministicBudgetFallbackNode = await generateNextNode({
  userData,
  answers,
  history: recoveryHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续硬撑但观察身体状态",
  nodeIndex: recoveryHistory.length,
  simulationSeed: "recursive-regeneration-budget-fallback"
}, {
  callAiJson: async () => {
    exhaustedRecursiveGenerationCalls += 1;
    if (exhaustedRecursiveGenerationCalls === 1) {
      const arcId = recoveryHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
      const candidate = healthArcRawNode({ arcId });
      candidate.title = "再次倒下";
      candidate.description = "她在加班时突然胸闷倒地，身体状态仍需长期观察。";
      return { text: JSON.stringify(candidate) };
    }
    return { text: "{}" };
  }
});

assert.equal(exhaustedRecursiveGenerationCalls, 2);
assert.equal(deterministicBudgetFallbackNode.eventMeta?.eventId, "candidate_authority_fallback");
assert.match(deterministicBudgetFallbackNode.description, /尚未被写成未经权威状态确认的成功结果/u);
assert.doesNotMatch(deterministicBudgetFallbackNode.description, /突然胸闷倒地/u);

let invalidCandidatePatchCalls = 0;
const invalidCandidatePatchOutcomes: string[] = [];
const invalidCandidatePatchFullRegenerationReasons: string[][] = [];
const recoveredAfterInvalidPatchNode = await generateNextNode({
  userData,
  answers,
  history: recoveryHistory,
  currentAttributes: { ...attributes, health: 35 },
  selectedDecision: "继续硬撑但观察身体状态",
  nodeIndex: recoveryHistory.length,
  simulationSeed: "health-recovery-invalid-patch-full-regeneration"
}, {
  enableCandidatePatchRepair: true,
  onGenerationCallTrace: (trace) => {
    invalidCandidatePatchOutcomes.push(`${trace.kind}:${trace.outcome}`);
    if (trace.kind === "full_regeneration" && trace.outcome !== "started") {
      invalidCandidatePatchFullRegenerationReasons.push(trace.issueCodes);
    }
  },
  callAiJson: async (prompt) => {
    invalidCandidatePatchCalls += 1;
    const arcId = recoveryHistory.at(-1)!.worldStateSnapshot!.foregroundPressureArcId!;
    const candidate = healthArcRawNode({ arcId });
    if (invalidCandidatePatchCalls === 1) {
      candidate.title = "再次倒下";
      candidate.description = "她在加班时突然胸闷倒地，身体状态仍需长期观察。";
      return { text: JSON.stringify(candidate) };
    }
    if (prompt.includes("node_candidate_patch_v1")) {
      const hash = prompt.match(/"baseCandidateHash":\s*"([^"]+)"/)?.[1];
      const revision = Number(prompt.match(/"targetCandidateRevision":\s*(\d+)/)?.[1] ?? 0);
      const issueCodesText = prompt.match(/"addressedIssueCodes":\s*(\[[^\]]*\])/)?.[1] ?? "[]";
      assert.ok(hash);
      return {
        text: JSON.stringify({
          contractVersion: "node_candidate_patch_v1",
          baseCandidateHash: hash,
          targetCandidateRevision: revision,
          addressedIssueCodes: JSON.parse(issueCodesText),
          narrativeMetaPatch: { arcSignals: "not-an-array" }
        })
      };
    }
    return { text: JSON.stringify(candidate) };
  }
});

assert.equal(invalidCandidatePatchCalls, 3);
assert.ok(invalidCandidatePatchOutcomes.includes("candidate_patch:failed"));
assert.ok(invalidCandidatePatchOutcomes.includes("full_regeneration:succeeded"));
assert.ok(invalidCandidatePatchFullRegenerationReasons.some((codes) => codes.includes("REPEATED_ACUTE_HEALTH_CRISIS")));
assert.doesNotMatch(`${recoveredAfterInvalidPatchNode.title}\n${recoveredAfterInvalidPatchNode.description}`, /再次倒下|突然胸闷倒地/);

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

assert.equal(operationRepairCalls, 1);
assert.notEqual(resolvedHealthNode.eventMeta?.eventId, "health_forced_pause");
assert.equal(resolvedHealthNode.narrativeMeta?.lifeIntensity, "stable");
assert.equal(resolvedHealthNode.committedArcMeta?.transitionAction, "resolve");
assert.equal(resolvedHealthNode.worldStateSnapshot?.foregroundPressureArcId, undefined);
assert.equal(resolvedHealthNode.attributes.health, 30);
assert.equal(resolvedHealthNode.reportInvitation?.reason, "arc_resolved");
assert.equal(resolvedHealthNode.reportInvitation?.pressureArcId, operationArcId);
assert.deepEqual(resolvedHealthNode.reportInvitation?.resolutionEvidence, ["这次健康危机已经从急性停摆转为需要长期管理的稳定阶段。"]);

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

assert.equal(failedOperationEvidenceCalls, 1);
assert.equal(unresolvedOperationNode.committedArcMeta?.transitionAction, "resolve");
assert.equal(unresolvedOperationNode.reportInvitation?.reason, "arc_resolved");

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
  enableCandidatePatchRepair: true,
  callAiJson: async (prompt) => {
    lateOperationRepairCalls += 1;
    if (prompt.includes("node_candidate_patch_v1")) {
      lateOperationDecisionRepairCalls += 1;
      const repaired = healthArcRawNode({ arcId: operationArcId });
      return { text: candidatePatchResponse(prompt, { replacementChoices: repaired.choices }) };
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

assert.equal(lateOperationRepairCalls, 2);
assert.equal(lateOperationDecisionRepairCalls, 1);
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
  assert.equal(missingOutcomeAttempts, 1);
  assert.equal(missingOutcomeRetryPrompt, "");
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
assert.equal(fallbackFullNodeCalls, 1, "a failed romance contract gets one bounded ordinary redispatch before deterministic fallback");
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
