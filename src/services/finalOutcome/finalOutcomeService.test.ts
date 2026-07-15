import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
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
          downloadFileName: "人生终章.png"
        },
        report: {
          executiveSummary: {
            headline: "AI发现真正塑造你的，是三个不断重复的选择模式。",
            patterns: [{ name: "成长优先", shortDescription: "你最终会选择成长空间。", keyMomentIndexes: [0, 2] }],
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
assert.doesNotMatch(capturedPrompt, /"decisionPatterns"/);
assert.equal(outcome.share.viralTitle.includes("我"), true);
assert.equal(outcome.report.executiveSummary.patterns.length, 3);
assert.equal(outcome.report.futureTrends[0].title, "经验产品化");
assert.equal(outcome.meta.closureType, "user_reflection");
assert.equal(outcome.share.downloadFileName, "这段人生的报告.png");
assert.match(capturedPrompt, /角色并未死亡/);
