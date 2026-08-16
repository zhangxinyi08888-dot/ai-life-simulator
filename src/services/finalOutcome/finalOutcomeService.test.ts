import assert from "node:assert/strict";
import test from "node:test";
import { HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../../domain/finance/ledgerMath";
import type { DebtAccount, FinancialEvidence } from "../../domain/finance/types";
import { generateFinalOutcome } from "./finalOutcomeService";

const userData: UserInitialData = {
  birthday: "1992-03-15",
  birthtime: "09:00",
  gender: "男",
  currentSituation: "正在考虑是否继续做自己的产品",
  isReturnToPast: true,
  targetAgeNode: "毕业后第一份工作",
  regressionNodeKey: "career",
  regressionAge: 22,
  regressionSituation: "毕业时在稳定岗位和兴趣方向之间摇摆",
  regressionChoices: "想试试做一个植物记录工具",
  coreStoryFocus: "selftruth",
  milestones: [{ id: "gaokao", title: "高考志愿", content: "为了现实选择了更稳的专业" }]
};

const answers: QuestionTurn[] = [
  { id: 1, question: "当时最大的现实限制是什么？", answer: "家里希望我先稳定下来。" }
];

const attributes: LifeAttributes = { happiness: 62, intelligence: 78, wealth: 58, relation: 66, health: 52 };
const history: HistoryItem[] = [18, 23, 28, 31, 35].map((age, index) => ({
  age,
  stage: "人生节点",
  title: ["高考志愿", "第一份工作", "创业", "开发植物APP", "健康危机"][index],
  description: "一次具体的人生选择。",
  selectedChoice: "继续选择更接近热爱的路",
  attributes,
  choices: [],
  isEndingNode: index === 4
}));

function historyWithOutstandingDebt(): HistoryItem[] {
  const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];
  const debt: DebtAccount = {
    id: "debt", type: "consumer_loan", displayName: "个人借款", principalWan: 100,
    openedAtAgeInMonths: 300, status: "active",
    repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 1, monthlyPrincipalWan: 1, monthlyInterestWan: 0, remainingTermMonths: 100 },
    factStatus: "known", evidence, origin: "explicit", accruedUnpaidInterestWan: 0,
    servicingStatus: "current", consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0, recentMissedPaymentAgeInMonths: []
  };
  const ledger = initializeFinancialLedger({
    id: "final-report-ledger",
    asOfAgeInMonths: 35 * 12,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      debtAccounts: [debt]
    }
  });
  return history.map((item, index) => index === history.length - 1 ? {
    ...item,
    financialLedger: ledger,
    worldStateSnapshot: {
      people: [], directionArcs: [], pressureArcs: [], careerStates: [],
      currentEmploymentStatus: "not_working", careerRevision: 0,
      committedTransactionIds: [], version: 2
    }
  } : item);
}

let capturedPrompt = "";
const outcome = await generateFinalOutcome({
  userData,
  answers,
  history,
  currentAttributes: attributes,
  context: { closureType: "user_reflection", invitationReason: "arc_resolved" }
}, {
  callAiJson: async (prompt) => {
    capturedPrompt = prompt;
    return {
      text: JSON.stringify({
        share: {
          viralTitle: "重生之我用20年开发一个APP",
          covenantTitle: "根系守望者",
          oneLineSummary: "现实改变过你的路径，却没有真正改变你的热爱。",
          timeline: history.map((item, index) => ({
            ageLabel: `${item.age}岁`,
            icon: "🌱",
            title: item.title,
            choiceSummary: "这次选择塑造了今天的你",
            keyMomentIndexes: [index]
          })),
          closingLine: "人生不是由成功组成，而是由一次次选择组成。",
          posterTheme: "clean_magazine",
          downloadFileName: "人生终章.png",
          imageAlt: "植物作品阶段人生报告"
        },
        report: {
          executiveSummary: {
            headline: "AI发现真正塑造你的，是三个不断重复的选择模式。",
            patterns: [
              { name: "成长优先", shortDescription: "你最终会选择成长空间。", keyMomentIndexes: [0, 2] },
              { name: "作品验证", shortDescription: "你会用具体作品验证方向。", keyMomentIndexes: [2, 3] },
              { name: "代价复盘", shortDescription: "你会在健康受损后重新安排投入。", keyMomentIndexes: [4] }
            ],
            closingLine: "这些模式让你获得优势，也带来代价。"
          },
          repeatedPatterns: [{ name: "成长优先", title: "你总是在稳定和成长之间选择成长", paragraphs: ["18岁和28岁的选择都说明这一点。"], keyMomentIndexes: [0, 2], closingLine: "这就是你的决策系统。" }],
          patternEffects: [{ patternName: "成长优先", compoundReturn: "能力越来越值钱。", hiddenCost: "反馈来得更慢。", paragraphs: ["它让你越来越强，也让你更容易焦虑。"], keyMomentIndexes: [2], closingLine: "复利和代价来自同一个模式。" }],
          futureTrends: [{ title: "经验产品化", trend: "未来机会来自经验产品化。", reason: "你一直在积累作品和方法。", keyMomentIndexes: [3] }],
          patternsToKeep: [{ title: "保留作品意识", why: "它已经证明有效。", paragraphs: ["你被看见的时候，往往是拿出成果的时候。"], keyMomentIndexes: [3], closingLine: "作品会替你说话。" }],
          patternsToAdjust: [{ title: "不要再一个人做完所有事", why: "过去有用，未来会限制你。", paragraphs: ["下一阶段需要有人放大你的能力。"], keyMomentIndexes: [2], closingLine: "合作决定你能走多远。" }],
          finalLifeReading: { title: "如果我是十年后的你", paragraphs: ["你不是突然改变方向的人。"], finalSentence: "你不是靠抓住机会成长，而是靠不断积累，让机会最终找到你。" }
        }
      })
    };
  }
});

assert.match(capturedPrompt, /人生运行模式/);
assert.match(capturedPrompt, /Cause -> Effect -> Future/);
assert.match(capturedPrompt, /海报标题用第一人称“我”/);
assert.match(capturedPrompt, /viralTitle 可以直接使用【报告唯一财务事实源】中的金额/);
assert.doesNotMatch(capturedPrompt, /"decisionPatterns"/);
assert.equal(outcome.share.viralTitle.includes("我"), true);
assert.equal(outcome.report.executiveSummary.patterns.length, 3);
assert.equal(outcome.report.futureTrends[0].title, "经验产品化");
assert.equal(outcome.meta.closureType, "user_reflection");
assert.equal(outcome.share.downloadFileName, "人生终章.png");
assert.match(capturedPrompt, /角色并未死亡/);
assert.match(capturedPrompt, /type FinalOutcomeJson/u);
assert.doesNotMatch(capturedPrompt, /人生不是由成功组成，而是由一次次选择组成/u);
assert.doesNotMatch(capturedPrompt, /这些模式让你获得了今天的优势，也带来了今天的代价/u);

function completePayload() {
  return {
    share: {
      viralTitle: "重生之我用十七年把兴趣做成作品",
      covenantTitle: "长期建造者",
      oneLineSummary: "你在现实压力中持续用作品验证方向。",
      timeline: history.slice(0, 4).map((item, index) => ({
        ageLabel: `${item.age}岁`, icon: "🌱", title: item.title, choiceSummary: item.selectedChoice, keyMomentIndexes: [index]
      })),
      closingLine: "你走过的路已经留下了清晰证据。",
      posterTheme: "warm_realistic",
      downloadFileName: "人生终章.png",
      imageAlt: "阶段人生报告"
    },
    report: {
      executiveSummary: {
        headline: "你用持续试做把模糊方向变成了可以验证的作品。",
        patterns: [
          { name: "先试做再决定", shortDescription: "你习惯先拿出小成果。", keyMomentIndexes: [0, 2] },
          { name: "在现实中保留方向", shortDescription: "你没有让稳定彻底覆盖兴趣。", keyMomentIndexes: [1, 3] },
          { name: "遇到代价后调整", shortDescription: "健康提醒你重新安排节奏。", keyMomentIndexes: [4] }
        ],
        closingLine: "这些选择同时形成了复利和代价。"
      },
      repeatedPatterns: [{ name: "先试做再决定", title: "你总是先让想法落到一个小作品上", paragraphs: ["18岁到31岁，你多次用实际成果换取下一步空间。"], keyMomentIndexes: [0, 2, 3], closingLine: "作品是你最稳定的判断方式。" }],
      patternEffects: [{ patternName: "先试做再决定", compoundReturn: "经验逐渐形成复利。", hiddenCost: "你也长期独自承担压力。", paragraphs: ["作品积累与健康消耗来自同一套投入方式。"], keyMomentIndexes: [2, 4], closingLine: "复利需要更可持续的节奏。" }],
      futureTrends: [{ title: "从独自试做到协作放大", trend: "下一阶段更可能通过合作放大已有作品。", reason: "你已经完成从想法到作品的验证。", keyMomentIndexes: [3, 4] }],
      patternsToKeep: [{ title: "保留作品验证", why: "它已经在多个阶段产生真实结果。", paragraphs: ["继续用小成果校准方向。"], keyMomentIndexes: [0, 3], closingLine: "让作品继续替你说话。" }],
      patternsToAdjust: [{ title: "把独自承担升级为协作", why: "健康代价说明旧节奏不可持续。", paragraphs: ["把重复劳动交给伙伴，保留关键判断。"], keyMomentIndexes: [3, 4], closingLine: "合作会让积累走得更远。" }],
      finalLifeReading: { title: "如果我是十年后的你", paragraphs: ["你真正留下来的不是一次冒险，而是一系列可以复用的作品。"], finalSentence: "你让方向变清晰的方法，一直是先认真做出一点东西。" }
    }
  };
}

test("incomplete final report receives one focused quality repair", async () => {
  let calls = 0;
  const repaired = await generateFinalOutcome({
    userData,
    answers,
    history,
    currentAttributes: attributes,
    context: { closureType: "user_reflection", invitationReason: "arc_resolved" }
  }, {
    callAiJson: async (prompt) => {
      calls += 1;
      if (calls === 1) return { text: JSON.stringify({ share: {}, report: {} }) };
      assert.match(prompt, /没有通过终局报告统一校验/u);
      return { text: JSON.stringify(completePayload()) };
    }
  });
  assert.equal(calls, 2);
  assert.equal(repaired.meta.finalOutcomeQualityRepairTriggered, true);
  assert.equal(repaired.meta.finalOutcomeQualityIssueCodes?.includes("FINAL_REPORT_ARRAY_LENGTH_INVALID"), true);
  assert.equal(repaired.report.executiveSummary.patterns.length, 3);
});

test("a still-incomplete focused repair is rejected instead of normalized with templates", async () => {
  let calls = 0;
  await assert.rejects(
    generateFinalOutcome({
      userData,
      answers,
      history,
      currentAttributes: attributes,
      context: { closureType: "user_reflection", invitationReason: "arc_resolved" }
    }, {
      callAiJson: async () => {
        calls += 1;
        return { text: JSON.stringify({ share: {}, report: {} }) };
      }
    }),
    /终局报告定向修复后仍未通过统一校验/u
  );
  assert.equal(calls, 2);
});

test("invalid JSON receives exactly one repair attempt", async () => {
  let calls = 0;
  const repaired = await generateFinalOutcome({
    userData,
    answers,
    history,
    currentAttributes: attributes,
    context: { closureType: "user_reflection", invitationReason: "arc_resolved" }
  }, {
    callAiJson: async (prompt) => {
      calls += 1;
      if (calls === 1) return { text: "not-json" };
      assert.match(prompt, /FINAL_REPORT_JSON_INVALID/u);
      return { text: JSON.stringify(completePayload()) };
    }
  });
  assert.equal(calls, 2);
  assert.equal(repaired.meta.finalOutcomeQualityRepairTriggered, true);
  assert.equal(repaired.meta.finalOutcomeQualityIssueCodes?.includes("FINAL_REPORT_JSON_INVALID"), true);
});

test("financial and structural issues share one repair and never trigger a third call", async () => {
  let calls = 0;
  const financialHistory = historyWithOutstandingDebt();
  const repaired = await generateFinalOutcome({
    userData,
    answers,
    history: financialHistory,
    currentAttributes: attributes,
    context: { closureType: "user_reflection", invitationReason: "arc_resolved" }
  }, {
    callAiJson: async (prompt) => {
      calls += 1;
      if (calls === 1) {
        const invalid = completePayload();
        invalid.share.viralTitle = "重生之我已经还清100万元债务";
        invalid.share.timeline = invalid.share.timeline.slice(0, 2);
        return { text: JSON.stringify(invalid) };
      }
      assert.match(prompt, /REPORT_DEBT_COMPLETION_CONFLICT/u);
      assert.match(prompt, /FINAL_REPORT_ARRAY_LENGTH_INVALID/u);
      const fixed = completePayload();
      fixed.share.viralTitle = "重生之我在未偿债务中重新安排生活";
      return { text: JSON.stringify(fixed) };
    }
  });
  assert.equal(calls, 2);
  assert.equal(repaired.meta.financialClaimRepairTriggered, true);
  assert.equal(repaired.meta.finalOutcomeQualityRepairTriggered, true);
  assert.equal(repaired.meta.financialClaimFallbackCount, 0);
});
