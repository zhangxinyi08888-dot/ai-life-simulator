import assert from "node:assert/strict";
import { normalizeFinalLifeOutcome } from "./finalOutcomeResponse";
import { HistoryItem } from "../types";

const history = [
  { age: 18, title: "高考志愿", selectedChoice: "先选择现实认可的专业" },
  { age: 23, title: "第一份工作", selectedChoice: "留下来攒经验和现金流" },
  { age: 28, title: "第一次创业", selectedChoice: "用业余时间做出第一个版本" },
  { age: 31, title: "产品上线", selectedChoice: "继续打磨垂直功能" },
  { age: 35, title: "健康预警", selectedChoice: "暂停扩张，先修复身体" },
  { age: 39, title: "持续坚持", selectedChoice: "把热爱慢慢做成稳定作品" }
].map((item): HistoryItem => ({
  ...item,
  stage: "人生节点",
  description: `${item.title}的具体经历。`,
  attributes: { happiness: 50, intelligence: 60, wealth: 45, relation: 55, health: 65 },
  choices: [],
  isEndingNode: false
}));

const outcome = normalizeFinalLifeOutcome({
  share: {
    viralTitle: "重生之你把兴趣当副业坚持了半辈子",
    covenantTitle: "根系守望者",
    oneLineSummary: "现实改变过你的路径，却没有真正改变你的热爱。",
    timeline: [
      { ageLabel: "18岁", icon: "🎓", title: "高考志愿", choiceSummary: "为现实选择稳妥专业", keyMomentIndexes: [0] },
      { ageLabel: "23岁", icon: "💼", title: "第一份工作", choiceSummary: "稳定工作但开始怀疑", keyMomentIndexes: [1, 99] },
      { ageLabel: "28岁", icon: "🌱", title: "第一次创业", choiceSummary: "用业余时间做出产品", keyMomentIndexes: [2] },
      { ageLabel: "31岁", icon: "📱", title: "产品上线", choiceSummary: "继续打磨垂直功能", keyMomentIndexes: [3] },
      { ageLabel: "35岁", icon: "⚠️", title: "健康预警", choiceSummary: "暂停扩张修复身体", keyMomentIndexes: [4] },
      { ageLabel: "39岁", icon: "🌳", title: "持续坚持", choiceSummary: "把热爱做成稳定作品", keyMomentIndexes: [5] },
      { ageLabel: "45岁", icon: "✨", title: "多余节点", choiceSummary: "不应进入海报", keyMomentIndexes: [5] }
    ],
    closingLine: "人生不是由成功组成，而是由一次次选择组成。",
    posterTheme: "unknown",
    downloadFileName: "../bad/name"
  },
  report: {
    executiveSummary: {
      headline: "真正塑造你的不是某一次重大决定，而是三个不断重复的选择模式。",
      patterns: [
        { name: "现实妥协后回到热爱", shortDescription: "你会先照顾现实，但热爱会重新回来。", keyMomentIndexes: [0, 3] }
      ],
      closingLine: "这些模式让你获得了今天的优势，也带来了今天的代价。"
    },
    repeatedPatterns: [
      {
        name: "现实妥协后回到热爱",
        title: "你总会在现实之后，重新把热爱捡起来",
        paragraphs: ["18岁你先选择了稳妥专业，23岁你进入传统公司，28岁又用业余时间做出产品。"],
        keyMomentIndexes: [0, 1, 2, 99],
        closingLine: "这不是一次冲动，而是你的人生反复运行的方式。"
      }
    ],
    patternEffects: [
      {
        patternName: "长期积累",
        compoundReturn: "作品越来越完整，经验越来越值钱。",
        hiddenCost: "反馈来得慢，你容易怀疑自己是不是跑得太慢。",
        paragraphs: ["长期积累让你在39岁拥有稳定作品，也让你经历了更长的低反馈期。"],
        keyMomentIndexes: [2, 5],
        closingLine: "复利和代价，其实来自同一个模式。"
      }
    ],
    futureTrends: [
      { title: "把经验产品化", trend: "未来最大的机会不是换行业，而是把经验产品化。", reason: "你已经连续多年把兴趣、工具和用户反馈沉淀成作品。", keyMomentIndexes: [3, 5] }
    ],
    patternsToKeep: [
      { title: "保留长期积累", why: "这是你最稳定的竞争方式。", paragraphs: ["它已经在产品和经验上被验证过。"], keyMomentIndexes: [2, 5], closingLine: "这不是慢，而是你的复利方式。" }
    ],
    patternsToAdjust: [
      { title: "不要再一个人完成所有事情", why: "过去这是优势，未来会变成瓶颈。", paragraphs: ["真正限制你的已经不是能力，而是没有更多人放大你的能力。"], keyMomentIndexes: [2, 4], closingLine: "请把自己做，升级成一起做。" }
    ],
    finalLifeReading: {
      title: "如果我是十年后的你",
      paragraphs: ["你不是靠突然抓住机会成长的人。"],
      finalSentence: "你不是靠抓住机会成长，而是靠不断积累，让机会最终找到你。"
    }
  },
  meta: {}
}, history);

assert.match(outcome.share.viralTitle, /我/);
assert.doesNotMatch(outcome.share.viralTitle, /你/);
assert.equal(outcome.share.timeline.length, 6);
assert.deepEqual(outcome.share.timeline[1].keyMomentIndexes, [1]);
assert.equal(outcome.share.posterTheme, "warm_realistic");
assert.equal(outcome.meta.reportVersion, "life-pattern-v2");
assert.equal(outcome.meta.closureType, "mortality");
assert.equal(outcome.report.repeatedPatterns[0].keyMomentIndexes.includes(99), false);
assert.equal(outcome.report.executiveSummary.patterns.length >= 1, true);
assert.equal(outcome.report.patternsToAdjust[0].closingLine, "请把自己做，升级成一起做。");

const fallback = normalizeFinalLifeOutcome({}, history);
assert.match(fallback.share.viralTitle, /我/);
assert.equal(fallback.share.timeline.length, 4);
assert.equal(fallback.report.repeatedPatterns.length >= 1, true);
assert.equal(fallback.meta.reportVersion, "life-pattern-v2");

const reflection = normalizeFinalLifeOutcome({}, history, "user_reflection");
assert.equal(reflection.meta.closureType, "user_reflection");
assert.equal(reflection.share.downloadFileName, "这段人生的报告.png");
assert.doesNotMatch(reflection.share.imageAlt, /人生终章/);
