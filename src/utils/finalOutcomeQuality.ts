import type { HistoryItem, SimulationClosureType } from "../types";
import { formatAgeInMonths } from "./timelineAdvance";

export type FinalOutcomeQualityIssueCode =
  | "FINAL_REPORT_REQUIRED_FIELD_MISSING"
  | "FINAL_REPORT_ARRAY_LENGTH_INVALID"
  | "FINAL_REPORT_HISTORY_INDEX_INVALID"
  | "FINAL_REPORT_GENERIC_FALLBACK_COPY"
  | "FINAL_REPORT_HISTORY_COVERAGE_INSUFFICIENT"
  | "FINAL_REPORT_LIFE_PHASE_COVERAGE_MISSING"
  | "FINAL_REPORT_POST_MORTEM_CONTINUATION"
  | "FINAL_REPORT_RAW_ATTRIBUTE_SCORE"
  | "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM"
  | "FINAL_REPORT_UNSUPPORTED_DURATION"
  | "FINAL_REPORT_TITLE_SUBJECT_INVALID"
  | "FINAL_REPORT_ENUM_INVALID"
  | "FINAL_REPORT_POST_MORTEM_ADVICE"
  | "FINAL_REPORT_UNGROUNDED_EXTERNAL_FACT"
  | "FINAL_REPORT_POSTER_COPY_BUDGET_EXCEEDED";

export interface FinalOutcomeQualityIssue {
  code: FinalOutcomeQualityIssueCode;
  path: string;
  message: string;
}

const GENERIC_LABEL_PATTERN = /^(?:人生)?模式\s*\d+$|^趋势\s*\d+$/u;
const GENERIC_COPY_PATTERNS = [
  /我在现实起伏中重新安排了生活/u,
  /财务现实仍在变化，你选择按已经发生的事实继续安排生活/u,
  /你的人生一直在重复同一种选择/u,
  /真正塑造你的不是单次决定，而是多次重复出现的选择方式/u,
  /AI 看到的是同一种选择被你重复了很多年/u,
  /你的命运，从来不是某一次选择决定的，而是同一种选择，被重复了很多年/u
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export const SHARE_POSTER_COPY_BUDGET = {
  viralTitle: 24,
  oneLineSummary: 44,
  closingLine: 40,
  timelineTitle: 16,
  timelineChoiceSummary: 22
} as const;

/**
 * The poster is rendered at a fixed 9:16 width. Count CJK/full-width glyphs as
 * one unit and ordinary ASCII as half a unit so validation follows rendered
 * line pressure without pretending to be a browser layout engine.
 */
export function sharePosterDisplayUnits(value: unknown): number {
  if (typeof value !== "string") return 0;
  return [...value.trim()].reduce((total, character) => (
    total + (/^[\u0000-\u00ff]$/u.test(character) ? 0.5 : 1)
  ), 0);
}

function inspectPosterCopyBudget(
  issues: FinalOutcomeQualityIssue[],
  value: unknown,
  path: string,
  maximumUnits: number
): void {
  if (!isNonEmptyString(value) || sharePosterDisplayUnits(value) <= maximumUnits) return;
  issues.push({
    code: "FINAL_REPORT_POSTER_COPY_BUDGET_EXCEEDED",
    path,
    message: `${path} 超出分享海报内容预算 ${maximumUnits} 个显示单位；必须压缩原意，不能依赖截图裁切`
  });
}

function addMissingStringIssue(
  issues: FinalOutcomeQualityIssue[],
  value: unknown,
  path: string
): void {
  if (isNonEmptyString(value)) return;
  issues.push({
    code: "FINAL_REPORT_REQUIRED_FIELD_MISSING",
    path,
    message: `${path} 必须是非空文本`
  });
}

function addArrayLengthIssue(
  issues: FinalOutcomeQualityIssue[],
  value: unknown,
  path: string,
  min: number,
  max: number
): any[] {
  const items = Array.isArray(value) ? value : [];
  if (items.length < min || items.length > max) {
    issues.push({
      code: "FINAL_REPORT_ARRAY_LENGTH_INVALID",
      path,
      message: `${path} 必须包含 ${min}-${max} 项，当前为 ${items.length}`
    });
  }
  return items;
}

function collectIndexes(
  issues: FinalOutcomeQualityIssue[],
  value: unknown,
  path: string,
  historyLength: number,
  output: Set<number>
): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({
      code: "FINAL_REPORT_HISTORY_INDEX_INVALID",
      path,
      message: `${path} 必须引用至少一个历史节点`
    });
    return;
  }
  for (const index of value) {
    if (!Number.isInteger(index) || index < 0 || index >= historyLength) {
      issues.push({
        code: "FINAL_REPORT_HISTORY_INDEX_INVALID",
        path,
        message: `${path} 包含越界历史索引 ${String(index)}`
      });
      continue;
    }
    output.add(index);
  }
}

function inspectGenericCopy(
  issues: FinalOutcomeQualityIssue[],
  value: unknown,
  path: string
): void {
  if (typeof value === "string") {
    const text = value.trim();
    if (GENERIC_LABEL_PATTERN.test(text) || GENERIC_COPY_PATTERNS.some((pattern) => pattern.test(text))) {
      issues.push({
        code: "FINAL_REPORT_GENERIC_FALLBACK_COPY",
        path,
        message: `${path} 使用了通用 fallback 文案`
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectGenericCopy(issues, item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => inspectGenericCopy(issues, item, path ? `${path}.${key}` : key));
  }
}

function inspectEvidenceItems(input: {
  issues: FinalOutcomeQualityIssue[];
  items: any[];
  path: string;
  historyLength: number;
  referencedIndexes: Set<number>;
  stringFields: string[];
  arrayFields?: string[];
}): void {
  input.items.forEach((item, index) => {
    const itemPath = `${input.path}[${index}]`;
    input.stringFields.forEach((field) => addMissingStringIssue(input.issues, item?.[field], `${itemPath}.${field}`));
    (input.arrayFields || []).forEach((field) => {
      const values = item?.[field];
      if (!Array.isArray(values) || values.length === 0 || values.some((value: unknown) => !isNonEmptyString(value))) {
        input.issues.push({
          code: "FINAL_REPORT_REQUIRED_FIELD_MISSING",
          path: `${itemPath}.${field}`,
          message: `${itemPath}.${field} 必须包含非空文本`
        });
      }
    });
    collectIndexes(input.issues, item?.keyMomentIndexes, `${itemPath}.keyMomentIndexes`, input.historyLength, input.referencedIndexes);
  });
}

function historyAgeInYears(item: HistoryItem): number {
  return (item.ageInMonths ?? item.age * 12) / 12;
}

export function collectFinalOutcomeQualityIssues(input: {
  data: any;
  history: HistoryItem[];
  closureType: SimulationClosureType;
}): FinalOutcomeQualityIssue[] {
  const { data, history, closureType } = input;
  const issues: FinalOutcomeQualityIssue[] = [];
  const historyLength = history.length;
  const referencedIndexes = new Set<number>();
  const share = data?.share;
  const report = data?.report;

  addMissingStringIssue(issues, share?.viralTitle, "share.viralTitle");
  addMissingStringIssue(issues, share?.covenantTitle, "share.covenantTitle");
  addMissingStringIssue(issues, share?.oneLineSummary, "share.oneLineSummary");
  addMissingStringIssue(issues, share?.closingLine, "share.closingLine");
  addMissingStringIssue(issues, share?.downloadFileName, "share.downloadFileName");
  addMissingStringIssue(issues, share?.imageAlt, "share.imageAlt");
  inspectPosterCopyBudget(issues, share?.viralTitle, "share.viralTitle", SHARE_POSTER_COPY_BUDGET.viralTitle);
  inspectPosterCopyBudget(issues, share?.oneLineSummary, "share.oneLineSummary", SHARE_POSTER_COPY_BUDGET.oneLineSummary);
  inspectPosterCopyBudget(issues, share?.closingLine, "share.closingLine", SHARE_POSTER_COPY_BUDGET.closingLine);
  if (isNonEmptyString(share?.viralTitle) && (!share.viralTitle.includes("我") || /^你/u.test(share.viralTitle))) {
    issues.push({
      code: "FINAL_REPORT_TITLE_SUBJECT_INVALID",
      path: "share.viralTitle",
      message: "share.viralTitle 必须由模型以第一人称“我”创作，代码不会改写标题主语"
    });
  }
  if (!(["warm_realistic", "quiet_dark", "clean_magazine"] as unknown[]).includes(share?.posterTheme)) {
    issues.push({
      code: "FINAL_REPORT_ENUM_INVALID",
      path: "share.posterTheme",
      message: "share.posterTheme 必须是允许的主题枚举"
    });
  }
  const timeline = addArrayLengthIssue(issues, share?.timeline, "share.timeline", 4, 6);
  timeline.forEach((item, index) => {
    inspectPosterCopyBudget(issues, item?.title, `share.timeline[${index}].title`, SHARE_POSTER_COPY_BUDGET.timelineTitle);
    inspectPosterCopyBudget(issues, item?.choiceSummary, `share.timeline[${index}].choiceSummary`, SHARE_POSTER_COPY_BUDGET.timelineChoiceSummary);
  });
  inspectEvidenceItems({
    issues,
    items: timeline,
    path: "share.timeline",
    historyLength,
    referencedIndexes: new Set<number>(),
    stringFields: ["ageLabel", "icon", "title", "choiceSummary"]
  });

  addMissingStringIssue(issues, report?.executiveSummary?.headline, "report.executiveSummary.headline");
  addMissingStringIssue(issues, report?.executiveSummary?.closingLine, "report.executiveSummary.closingLine");
  const summaryPatterns = addArrayLengthIssue(issues, report?.executiveSummary?.patterns, "report.executiveSummary.patterns", 3, 3);
  inspectEvidenceItems({
    issues,
    items: summaryPatterns,
    path: "report.executiveSummary.patterns",
    historyLength,
    referencedIndexes,
    stringFields: ["name", "shortDescription"]
  });

  const repeatedPatterns = addArrayLengthIssue(issues, report?.repeatedPatterns, "report.repeatedPatterns", 1, 3);
  inspectEvidenceItems({
    issues,
    items: repeatedPatterns,
    path: "report.repeatedPatterns",
    historyLength,
    referencedIndexes,
    stringFields: ["name", "title", "closingLine"],
    arrayFields: ["paragraphs"]
  });

  const patternEffects = addArrayLengthIssue(issues, report?.patternEffects, "report.patternEffects", 1, 3);
  inspectEvidenceItems({
    issues,
    items: patternEffects,
    path: "report.patternEffects",
    historyLength,
    referencedIndexes,
    stringFields: ["patternName", "compoundReturn", "hiddenCost", "closingLine"],
    arrayFields: ["paragraphs"]
  });

  const futureTrends = addArrayLengthIssue(issues, report?.futureTrends, "report.futureTrends", 1, 3);
  inspectEvidenceItems({
    issues,
    items: futureTrends,
    path: "report.futureTrends",
    historyLength,
    referencedIndexes,
    stringFields: ["title", "trend", "reason"]
  });
  if (closureType === "mortality") {
    futureTrends.forEach((item, index) => {
      const text = `${item?.trend || ""}${item?.reason || ""}`;
      if (/(?:^|[，。；])你(?:将|会|仍|继续|开始|需要|应该|可以)|你的(?:债务|还款)[^。！？]{0,30}(?:继续|未来)|由(?:家人|亲友|捐赠人|法定继承人|遗产管理人)[^。！？]{0,24}(?:偿还|承担|处置)|(?:法定继承人|遗产管理人|遗产清算|变卖资产|协商分期偿还)/u.test(text)) {
        issues.push({
          code: "FINAL_REPORT_POST_MORTEM_CONTINUATION",
          path: `report.futureTrends[${index}]`,
          message: "mortality 报告不能让角色死后继续行动，也不能无依据指定他人偿债"
        });
      }
    });
  }

  for (const [field, keep] of [["patternsToKeep", true], ["patternsToAdjust", false]] as const) {
    const values = addArrayLengthIssue(issues, report?.[field], `report.${field}`, 1, 3);
    inspectEvidenceItems({
      issues,
      items: values,
      path: `report.${field}`,
      historyLength,
      referencedIndexes,
      stringFields: ["title", "why", "closingLine"],
      arrayFields: ["paragraphs"]
    });
    void keep;
  }

  addMissingStringIssue(issues, report?.finalLifeReading?.title, "report.finalLifeReading.title");
  addMissingStringIssue(issues, report?.finalLifeReading?.finalSentence, "report.finalLifeReading.finalSentence");
  if (!Array.isArray(report?.finalLifeReading?.paragraphs)
    || report.finalLifeReading.paragraphs.length === 0
    || report.finalLifeReading.paragraphs.some((value: unknown) => !isNonEmptyString(value))) {
    issues.push({
      code: "FINAL_REPORT_REQUIRED_FIELD_MISSING",
      path: "report.finalLifeReading.paragraphs",
      message: "report.finalLifeReading.paragraphs 必须包含非空文本"
    });
  }

  inspectGenericCopy(issues, report, "report");

  const serializedCopy = JSON.stringify({ share, report });
  if (/(?:幸福|才智|财富|人际|健康)(?:度)?\s*(?:为|达到|有)?\s*\d+(?:\.\d+)?\s*分?|\d+(?:\.\d+)?\s*分(?:的)?(?:幸福|才智|财富|人际|健康)/u.test(serializedCopy)) {
    issues.push({
      code: "FINAL_REPORT_RAW_ATTRIBUTE_SCORE",
      path: "report",
      message: "终局文案不得把内部属性分数直接写给用户"
    });
  }
  if (/(?:影响|帮助|改变|覆盖)[^。！？]{0,12}(?:无数|成千上万|全国|遍布各地)/u.test(serializedCopy)) {
    issues.push({
      code: "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM",
      path: "report",
      message: "终局文案不得在历史无量化依据时夸大影响规模"
    });
  }

  if (closureType === "mortality") {
    if (/(?:如果我是十年后的你|未来的你|下一阶段|请(?:继续|保持|勿|不要)|你(?:需要|应该|应当|仍需|还要|要继续))/u.test(serializedCopy)) {
      issues.push({
        code: "FINAL_REPORT_POST_MORTEM_ADVICE",
        path: "report",
        message: "mortality 报告只能回顾已完结人生，不能向死者提供未来建议"
      });
    }
    if (/(?:遗产清偿|遗产清算|遗产管理人|法定继承人|法律程序|无人追讨|变卖资产|协商分期偿还)|(?:(?:家人|家庭|父母|亲友|机构)[^。！？]{0,32}(?:债务|负债|偿还|承担|接手|负担)|(?:债务|负债)[^。！？]{0,32}(?:家人|家庭|父母|亲友|机构)[^。！？]{0,16}(?:偿还|承担|接手|负担)?)/u.test(serializedCopy)) {
      issues.push({
        code: "FINAL_REPORT_UNGROUNDED_EXTERNAL_FACT",
        path: "report",
        message: "mortality 报告不得推演未经权威状态确认的遗产、法律程序或他人债务责任"
      });
    }
    const historyCorpus = history.map((item) => `${item.title}\n${item.description}\n${item.selectedChoice}`).join("\n");
    const unsupportedScaleClaim = ["无数", "成千上万", "全国", "遍布各地", "一代代", "广泛采用", "参考案例"]
      .some((claim) => serializedCopy.includes(claim) && !historyCorpus.includes(claim));
    const unsupportedMultiSchoolClaim = /多所(?:学校|中学)/u.test(serializedCopy)
      && !/(?:两|三|四|五|六|七|八|九|十|\d+)所(?:学校|中学)/u.test(historyCorpus);
    const unsupportedMultiCountyClaim = /(?:多个|更多|多地)县域/u.test(serializedCopy)
      && !/(?:两|三|四|五|六|七|八|九|十|\d+)个(?:新)?县|周边(?:两|三|四|五|六|七|八|九|十|\d+)个县/u.test(historyCorpus);
    if (unsupportedScaleClaim || unsupportedMultiSchoolClaim || unsupportedMultiCountyClaim) {
      issues.push({
        code: "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM",
        path: "report",
        message: "影响人数、采用范围和行业地位必须能在历史记录中找到直接证据"
      });
    }
  }

  const titleDuration = typeof share?.viralTitle === "string"
    ? share.viralTitle.match(/(\d+(?:\.\d+)?)\s*年/u)
    : null;
  if (titleDuration && historyLength >= 2) {
    const ages = history.map(historyAgeInYears);
    const historySpanYears = Math.max(...ages) - Math.min(...ages);
    if (Math.abs(Number(titleDuration[1]) - historySpanYears) > 5) {
      issues.push({
        code: "FINAL_REPORT_UNSUPPORTED_DURATION",
        path: "share.viralTitle",
        message: `标题中的 ${titleDuration[1]} 年与历史跨度 ${historySpanYears.toFixed(1)} 年不匹配`
      });
    }
  }

  const minimumReferences = historyLength >= 6 ? 3 : Math.min(2, historyLength);
  if (referencedIndexes.size < minimumReferences) {
    issues.push({
      code: "FINAL_REPORT_HISTORY_COVERAGE_INSUFFICIENT",
      path: "report",
      message: `报告只引用 ${referencedIndexes.size} 个不同历史节点，至少需要 ${minimumReferences} 个`
    });
  }

  if (closureType === "mortality" && historyLength >= 12) {
    const ages = history.map(historyAgeInYears);
    if (Math.min(...ages) < 40 && Math.max(...ages) >= 60) {
      const coveredAges = [...referencedIndexes].map((index) => ages[index]);
      const missingPhases = [
        coveredAges.some((age) => age < 40) ? "" : "40岁前",
        coveredAges.some((age) => age >= 40 && age < 60) ? "" : "40-59岁",
        coveredAges.some((age) => age >= 60) ? "" : "60岁后"
      ].filter(Boolean);
      if (missingPhases.length > 0) {
        issues.push({
          code: "FINAL_REPORT_LIFE_PHASE_COVERAGE_MISSING",
          path: "report",
          message: `完整人生报告缺少阶段证据：${missingPhases.join("、")}`
        });
      }
    }
  }

  return issues;
}

export function buildFinalOutcomeRepairPrompt(input: {
  originalPrompt: string;
  data: unknown;
  issues: Array<{ code: string; path: string; message?: string; text?: string }>;
  history: HistoryItem[];
}): string {
  const anchors = input.history.map((item, index) => (
    `索引 ${index}｜${formatAgeInMonths(item.ageInMonths ?? item.age * 12)}｜${item.title}｜选择：${item.selectedChoice}`
  )).join("\n");
  const financialAmountRepair = input.issues.some((issue) => [
    "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT",
    "REPORT_UNSUPPORTED_RETURN_CLAIM",
    "REPORT_FINANCIAL_PRECISION",
    "REPORT_ORPHAN_FINANCIAL_AMOUNT"
  ].includes(issue.code))
    ? "\n【财务数字定向修复】\n对上述问题列出的每一个 path：删除不在‘报告唯一财务事实源’中的金额、比例、倍数或收益率；保留原本的人生模式含义，改写成不含财务数字的定性叙述。不得把被删除的数字移到其他字段，不得创造替代数字，也不得写‘待确认’等内部占位符。"
    : "";
  const strictClaimRepair = input.issues.some((issue) => [
    "REPORT_DEBT_COMPLETION_CONFLICT",
    "REPORT_NEGATIVE_NET_WORTH_CONFLICT",
    "REPORT_PROPERTY_ABSENCE_OVERCLAIM",
    "REPORT_ASSET_ABSENCE_OVERCLAIM",
    "REPORT_PROPERTY_CONFLICT",
    "REPORT_NEGATIVE_NET_WORTH_ROMANTICIZATION",
    "FINAL_REPORT_RAW_ATTRIBUTE_SCORE",
    "FINAL_REPORT_UNGROUNDED_EXTERNAL_FACT",
    "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM"
  ].includes(issue.code))
    ? `\n【冲突断言定向修复】
- 对每个被点名 path 只删除或改写冲突句，不得把同一断言搬到其他字段。
- 若权威账本仍有债务，全文不得出现“还清、清零、偿清、债务结束、终于无债”等完成语义；只能写仍有负担、仍在偿付或财务压力仍存在。
- 不得把负净资产、现金见底或未偿债务浪漫化成“财富自由、财务圆满、已经翻身、没有留下负担”。
- no_confirmed_property 只表示房产未知：不能写成没有房产、从未置业、名下无房或没有其他可变现资产；也不能写拥有、买下、卖掉、抵押、房产升值或房贷压力。被点名字段应改回由历史锚点直接支持、且不讨论房产或资产有无的具体人生模式。
- 删除“幸福/才智/财富/人际/健康达到多少分”等内部属性分数表达；不得换一种句式把这些分数搬到其他字段，也不得把分数改写成金额或比例。
- mortality 报告不得编造遗产清算、继承人、家人/机构接手债务、法律程序，也不得写死后继续还款或继续行动。
- “无数、成千上万、全国、多所学校、多个县域、一代代、广泛采用、参考案例”等规模结论，只有历史锚点逐字支持时才能保留；否则改成不扩大范围的具体局部影响。
- 修复完成后逐一对照【全部问题】中的 path，再对完整 JSON 做一次自检：上述禁句、内部属性分数、房产拥有/处置断言和资产不存在断言在任何 share/report 字段都不得残留。`
    : "";
  const posterCopyRepair = input.issues.some((issue) => issue.code === "FINAL_REPORT_POSTER_COPY_BUDGET_EXCEEDED")
    ? `\n【分享海报内容预算定向修复】
- 只压缩被点名的 share 字段，保留原有事实、第一人称标题和人生模式含义，不得删改报告正文或创造新经历。
- viralTitle 最多 ${SHARE_POSTER_COPY_BUDGET.viralTitle} 显示单位，oneLineSummary 最多 ${SHARE_POSTER_COPY_BUDGET.oneLineSummary}，closingLine 最多 ${SHARE_POSTER_COPY_BUDGET.closingLine}。
- timeline 每项 title 最多 ${SHARE_POSTER_COPY_BUDGET.timelineTitle} 显示单位，choiceSummary 最多 ${SHARE_POSTER_COPY_BUDGET.timelineChoiceSummary}；timeline 仍须保持 4-6 项。
- 中文和全角字符按 1 单位、普通 ASCII 按 0.5 单位计算。不得依赖省略号、CSS 裁切或删除关键财务限定来过关。`
    : "";
  return `${input.originalPrompt}\n\n【本次输出没有通过终局报告统一校验】\n以下问题已经一次性汇总，包含 JSON 结构、历史引用、财务事实和终局语义。只允许本次定向修复；代码不会补写正文，也不会再触发第三次生成。保留已经合格且不冲突的具体内容，不得用“模式1”“趋势1”或通用人生总结补齐。${financialAmountRepair}${strictClaimRepair}${posterCopyRepair}\n\n【全部问题】\n${JSON.stringify(input.issues, null, 2)}\n\n【历史锚点速查】\n${anchors}\n\n【需要修复的原始输出】\n${typeof input.data === "string" ? input.data : JSON.stringify(input.data, null, 2)}\n\n重新返回完整 JSON，不要 Markdown。`;
}
