import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem } from "../types";
import { collectFinalOutcomeQualityIssues } from "./finalOutcomeQuality";

const attributes = { happiness: 50, intelligence: 60, wealth: 40, relation: 55, health: 45 };

function longHistory(): HistoryItem[] {
  return Array.from({ length: 18 }, (_, index) => {
    const age = 25 + index * 3;
    return {
      age,
      ageInMonths: age * 12,
      stage: age >= 60 ? "晚年" : age >= 40 ? "中年" : "青年",
      title: `${age}岁的生活调整`,
      description: `${age}岁时，你围绕工作、健康和关系做出了一次具体调整。`,
      selectedChoice: `完成${age}岁的现实安排`,
      attributes,
      choices: [],
      isEndingNode: index === 17
    };
  });
}

function completeLongLifeData(indexes: number[]) {
  const evidence = (suffix: string) => ({
    title: `基于人生阶段的${suffix}`,
    why: "它在多个阶段产生过具体影响。",
    paragraphs: ["25岁、49岁和70岁后的选择共同说明了这条变化。"],
    keyMomentIndexes: indexes,
    closingLine: "不同阶段留下了不同结果。"
  });
  return {
    share: {
      viralTitle: "重生之我用半生重新安排生活",
      covenantTitle: "阶段重排者",
      oneLineSummary: "你在不同阶段持续调整工作、健康和关系。",
      timeline: [0, 5, 10, 17].map((index) => ({ ageLabel: `${25 + index * 3}岁`, icon: "🌱", title: `节点${index}`, choiceSummary: "完成现实安排", keyMomentIndexes: [index] })),
      closingLine: "不同阶段都留下了选择的痕迹。",
      posterTheme: "quiet_dark",
      downloadFileName: "人生终章.png",
      imageAlt: "完整人生阶段回顾海报"
    },
    report: {
      executiveSummary: {
        headline: "你的人生经历了积累、重排和晚年收束三个阶段。",
        patterns: [
          { name: "先承担再调整", shortDescription: "青年阶段先处理现实责任。", keyMomentIndexes: [indexes[0]] },
          { name: "中年重新排序", shortDescription: "中年开始重新分配资源。", keyMomentIndexes: [indexes[1]] },
          { name: "晚年保留连接", shortDescription: "晚年把健康和关系放到更前面。", keyMomentIndexes: [indexes[2]] }
        ],
        closingLine: "这些模式产生了各自的收益和代价。"
      },
      repeatedPatterns: [{ name: "阶段性重排", ...evidence("重复模式") }],
      patternEffects: [{ patternName: "阶段性重排", compoundReturn: "逐步形成适应能力。", hiddenCost: "调整往往发生在压力累积之后。", paragraphs: ["三个阶段表现出同一方式的收益与代价。"], keyMomentIndexes: indexes, closingLine: "适应也需要提前发生。" }],
      futureTrends: [{ title: "读本继续服务后来者", trend: "留下的读本和培训网络会继续影响当地教师。", reason: "60岁后的多个节点已经完成公开整理与交接。", keyMomentIndexes: [indexes[2]] }],
      patternsToKeep: [evidence("保留模式")],
      patternsToAdjust: [evidence("升级模式")],
      finalLifeReading: { title: "完整人生回望", paragraphs: ["你在青年、中年和晚年分别学会了不同的承担方式。"], finalSentence: "真正的变化，是你终于开始在压力到来前重新排序。" }
    }
  };
}

test("mortality report must cite youth, middle age and age 60+", () => {
  const issues = collectFinalOutcomeQualityIssues({
    data: completeLongLifeData([0, 5, 8]),
    history: longHistory(),
    closureType: "mortality"
  });
  assert.equal(issues.some((issue) => issue.code === "FINAL_REPORT_LIFE_PHASE_COVERAGE_MISSING"), true);
});

test("a concrete long-life report covering all phases passes quality validation", () => {
  const issues = collectFinalOutcomeQualityIssues({
    data: completeLongLifeData([0, 8, 15]),
    history: longHistory(),
    closureType: "mortality"
  });
  assert.deepEqual(issues, []);
});

test("generic numbered patterns are rejected even when the schema is complete", () => {
  const data = completeLongLifeData([0, 8, 15]);
  data.report.repeatedPatterns[0].name = "模式1";
  assert.equal(
    collectFinalOutcomeQualityIssues({ data, history: longHistory(), closureType: "mortality" })
      .some((issue) => issue.code === "FINAL_REPORT_GENERIC_FALLBACK_COPY"),
    true
  );
});

test("mortality report cannot make the deceased continue working or assign debt to relatives", () => {
  const data = completeLongLifeData([0, 8, 15]);
  data.report.futureTrends[0].trend = "你将继续以顾问身份工作，债务由家人和捐赠人协助偿还。";
  assert.equal(
    collectFinalOutcomeQualityIssues({ data, history: longHistory(), closureType: "mortality" })
      .some((issue) => issue.code === "FINAL_REPORT_POST_MORTEM_CONTINUATION"),
    true
  );
});

test("mortality future trend rejects financial fallback written in present tense", () => {
  const data = completeLongLifeData([0, 8, 15]);
  data.report.futureTrends[0].trend = "债务仍在偿还过程中，你开始用更可持续的方式安排生活。";
  assert.equal(
    collectFinalOutcomeQualityIssues({ data, history: longHistory(), closureType: "mortality" })
      .some((issue) => issue.code === "FINAL_REPORT_POST_MORTEM_CONTINUATION"),
    true
  );
});

test("report rejects raw attribute scores and ungrounded impact scale", () => {
  const data = completeLongLifeData([0, 8, 15]);
  data.report.finalLifeReading.paragraphs = ["你以92分幸福走到晚年，并影响了全国无数教师。"];
  const issues = collectFinalOutcomeQualityIssues({ data, history: longHistory(), closureType: "mortality" });
  assert.equal(issues.some((issue) => issue.code === "FINAL_REPORT_RAW_ATTRIBUTE_SCORE"), true);
  assert.equal(issues.some((issue) => issue.code === "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM"), true);
});

test("viral title duration must match the simulated history span", () => {
  const data = completeLongLifeData([0, 8, 15]);
  data.share.viralTitle = "我用20年把乡村教育做成遗产";
  assert.equal(
    collectFinalOutcomeQualityIssues({ data, history: longHistory(), closureType: "mortality" })
      .some((issue) => issue.code === "FINAL_REPORT_UNSUPPORTED_DURATION"),
    true
  );
});

test("mortality future trend rejects invented estate settlement mechanics", () => {
  const data = completeLongLifeData([0, 8, 15]);
  data.report.futureTrends[0].trend = "遗产管理人将变卖资产，并与法定继承人协商分期偿还。";
  assert.equal(
    collectFinalOutcomeQualityIssues({ data, history: longHistory(), closureType: "mortality" })
      .some((issue) => issue.code === "FINAL_REPORT_POST_MORTEM_CONTINUATION"),
    true
  );
});

test("r6 mortality failures are rejected across advice, estate, family and scale claims", () => {
  const cases = [
    "如果我是十年后的你，请继续保持意义驱动。",
    "你的债务可能由遗产清偿，未来只能按法律程序处理。",
    "68.56万债务可能由家庭或机构接手。",
    "这套读本将影响一代代教师和学生。",
    "这项模式会成为非营利领域的参考案例。"
  ];
  for (const text of cases) {
    const data = completeLongLifeData([0, 8, 15]);
    data.report.finalLifeReading.paragraphs = [text];
    const issues = collectFinalOutcomeQualityIssues({ data, history: longHistory(), closureType: "mortality" });
    assert.equal(
      issues.some((issue) => [
        "FINAL_REPORT_POST_MORTEM_ADVICE",
        "FINAL_REPORT_UNGROUNDED_EXTERNAL_FACT",
        "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM"
      ].includes(issue.code)),
      true,
      text
    );
  }
});

test("a multi-school claim is allowed when history directly records several schools", () => {
  const history = longHistory();
  history[10].description = "你已经在三所学校完成教师培训试点，并记录了逐校反馈。";
  const data = completeLongLifeData([0, 8, 15]);
  data.report.futureTrends[0].trend = "留下的读本已在多所学校的教师培训中使用。";
  assert.equal(
    collectFinalOutcomeQualityIssues({ data, history, closureType: "mortality" })
      .some((issue) => issue.code === "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM"),
    false
  );
});
