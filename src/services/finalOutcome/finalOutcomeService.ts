import { AiClientError } from "../ai/errors";
import { callDeepSeekJsonFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import type { FinalLifeOutcome, FinalOutcomeContext, HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
import { normalizeFinalLifeOutcome } from "../../utils/finalOutcomeResponse";
import { buildFinalOutcomePrompt } from "./prompts";
import { getBrowserE2eAiJsonCaller } from "../e2e/e2eAiMock";
import {
  collectFinalFinancialNarrativeIssues,
  deriveFinalFinancialNarrativeAuthority,
  removeUnsupportedDebtCompletionClauses,
  replaceUnsupportedFinancialAmountsWithQualitativeText,
  type FinalFinancialNarrativeIssue
} from "../../utils/finalFinancialNarrativeAuthority";
import {
  buildFinalOutcomeRepairPrompt,
  collectFinalOutcomeQualityIssues,
  SHARE_POSTER_COPY_BUDGET,
  sharePosterDisplayUnits,
  type FinalOutcomeQualityIssue
} from "../../utils/finalOutcomeQuality";

type AiJsonCaller = (prompt: string) => Promise<{ text: string }>;

export interface FinalOutcomeServiceDeps {
  callAiJson?: AiJsonCaller;
}

export interface GenerateFinalOutcomeInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  context: FinalOutcomeContext;
}

interface JsonParseIssue {
  code: "FINAL_REPORT_JSON_INVALID";
  path: "$";
  message: string;
}

type UnifiedIssue = FinalOutcomeQualityIssue | FinalFinancialNarrativeIssue | JsonParseIssue;

function getAiJsonCaller(deps: FinalOutcomeServiceDeps = {}): AiJsonCaller {
  if (deps.callAiJson) return deps.callAiJson;
  const e2eCaller = getBrowserE2eAiJsonCaller();
  if (e2eCaller) return e2eCaller;
  return (prompt: string) => callDeepSeekJsonFromBrowser(getBrowserAiEnv(), prompt);
}

function tryParseAiJsonResponse(response: { text?: string }): { data?: any; issue?: JsonParseIssue; raw: string } {
  const raw = response.text || "";
  try {
    return { data: JSON.parse(raw), raw };
  } catch {
    return {
      raw,
      issue: {
        code: "FINAL_REPORT_JSON_INVALID",
        path: "$",
        message: "AI 返回内容不是合法 JSON"
      }
    };
  }
}

function collectUnifiedIssues(input: GenerateFinalOutcomeInput, data: any): {
  quality: FinalOutcomeQualityIssue[];
  financial: FinalFinancialNarrativeIssue[];
  all: UnifiedIssue[];
} {
  const quality = collectFinalOutcomeQualityIssues({
    data,
    history: input.history,
    closureType: input.context.closureType
  });
  const authority = deriveFinalFinancialNarrativeAuthority(input.history);
  const financial = collectFinalFinancialNarrativeIssues({ outcome: data as FinalLifeOutcome, authority });
  return { quality, financial, all: [...quality, ...financial] };
}

function invalidAfterRepair(issues: UnifiedIssue[]): AiClientError {
  return new AiClientError(
    "AI_RESPONSE_INVALID",
    `终局报告定向修复后仍未通过统一校验：${issues.map((issue) => `${issue.path}:${issue.code}`).join("；")}`
  );
}

const POST_MORTEM_CONTINUATION_TEXT = /(?:^|[，。；])你(?:将|会|仍|继续|开始|需要|应该|可以)|你的(?:债务|还款)[^。！？]{0,30}(?:继续|未来)|由(?:家人|亲友|捐赠人|法定继承人|遗产管理人)[^。！？]{0,24}(?:偿还|承担|处置)|(?:法定继承人|遗产管理人|遗产清算|变卖资产|协商分期偿还)/u;
const POST_MORTEM_ADVICE_TEXT = /(?:如果我是十年后的你|未来的你|下一阶段|请(?:继续|保持|勿|不要)|你(?:需要|应该|应当|仍需|还要|要继续))/u;
const POST_MORTEM_EXTERNAL_TEXT = /(?:遗产清偿|遗产清算|遗产管理人|法定继承人|法律程序|无人追讨|变卖资产|协商分期偿还)|(?:(?:家人|家庭|父母|亲友|机构)[^。！？]{0,32}(?:债务|负债|偿还|承担|接手|负担)|(?:债务|负债)[^。！？]{0,32}(?:家人|家庭|父母|亲友|机构)[^。！？]{0,16}(?:偿还|承担|接手|负担)?)/u;
const TERMINAL_PROPERTY_ABSENCE_OVERCLAIM = /(?:(?:没有|并无|名下无|未持有|从未拥有)(?!已确认)(?:任何|一套|属于自己的|自己的)?(?:房屋|房产|住房|公寓)|(?:房屋|房产|住房|公寓)[^。！？]{0,8}(?:并不存在|不存在|一套也没有))/u;
const TERMINAL_ASSET_ABSENCE_OVERCLAIM = /(?:没有|并无|不存在)[^。！？]{0,10}(?:其他)?(?:可变现|流动|个人)?资产/u;
const TERMINAL_RAW_ATTRIBUTE_SCORE = /(?:幸福|才智|财富|人际|健康)(?:度)?\s*(?:为|达到|有)?\s*\d+(?:\.\d+)?\s*分?|\d+(?:\.\d+)?\s*分(?:的)?(?:幸福|才智|财富|人际|健康)/gu;

function mapStringLeaves(value: unknown, transform: (text: string) => string): number {
  let replacementCount = 0;
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (typeof child === "string") {
        const repaired = transform(child);
        if (repaired !== child && repaired.trim()) {
          (current as Record<string, unknown>)[key] = repaired;
          replacementCount += 1;
        }
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return replacementCount;
}

function removeMatchingSentences(text: string, pattern: RegExp, fallback?: string): string {
  const sentences = text.match(/[^。！？；]+[。！？；]?/gu) || [text];
  const kept = sentences.filter((sentence) => !pattern.test(sentence));
  return kept.length > 0 ? kept.join("").trim() : (fallback || text);
}

function repairUnsupportedAssetAbsenceClaims(text: string): string {
  const sentences = text.match(/[^。！？；]+[。！？；]?/gu) || [text];
  return sentences.map((sentence) => {
    const property = TERMINAL_PROPERTY_ABSENCE_OVERCLAIM.test(sentence);
    const asset = TERMINAL_ASSET_ABSENCE_OVERCLAIM.test(sentence);
    if (!property && !asset) return sentence;
    const punctuation = sentence.match(/[。！？；]$/u)?.[0] || "";
    if (property && asset) return `房产及其他资产情况缺少可靠记录${punctuation}`;
    if (property) return `房产情况缺少可靠记录${punctuation}`;
    return `其他资产情况缺少可靠记录${punctuation}`;
  }).join("").trim();
}

function repairRawAttributeScores(text: string): string {
  return text.replace(TERMINAL_RAW_ATTRIBUTE_SCORE, (claim) => {
    if (/幸福/u.test(claim)) return "幸福感的变化";
    if (/才智/u.test(claim)) return "认知能力的积累";
    if (/财富/u.test(claim)) return "财务状态的变化";
    if (/人际/u.test(claim)) return "关系状态的变化";
    return "健康状态的变化";
  });
}

function trimToPosterBudget(text: string, maximumUnits: number): string {
  if (sharePosterDisplayUnits(text) <= maximumUnits) return text;
  let units = 0;
  let trimmed = "";
  for (const character of [...text.trim()]) {
    const nextUnits = units + (/^[\u0000-\u00ff]$/u.test(character) ? 0.5 : 1);
    if (nextUnits > maximumUnits) break;
    trimmed += character;
    units = nextUnits;
  }
  return trimmed.replace(/[，、：；\-—]+$/u, "").trim();
}

function applyPosterBudgetFallback(data: any, issues: UnifiedIssue[]): number {
  let count = 0;
  for (const issue of issues) {
    if (issue.code !== "FINAL_REPORT_POSTER_COPY_BUDGET_EXCEEDED") continue;
    const direct = issue.path.match(/^share\.(viralTitle|oneLineSummary|closingLine)$/u);
    if (direct) {
      const key = direct[1] as keyof typeof SHARE_POSTER_COPY_BUDGET;
      const value = data?.share?.[key];
      if (typeof value !== "string") continue;
      const repaired = trimToPosterBudget(value, SHARE_POSTER_COPY_BUDGET[key]);
      if (repaired && repaired !== value) {
        data.share[key] = repaired;
        count += 1;
      }
      continue;
    }
    const timeline = issue.path.match(/^share\.timeline\[(\d+)\]\.(title|choiceSummary)$/u);
    if (!timeline) continue;
    const item = data?.share?.timeline?.[Number(timeline[1])];
    const field = timeline[2] as "title" | "choiceSummary";
    const value = item?.[field];
    if (typeof value !== "string") continue;
    const maximum = field === "title"
      ? SHARE_POSTER_COPY_BUDGET.timelineTitle
      : SHARE_POSTER_COPY_BUDGET.timelineChoiceSummary;
    const repaired = trimToPosterBudget(value, maximum);
    if (repaired && repaired !== value) {
      item[field] = repaired;
      count += 1;
    }
  }
  return count;
}

function applyTerminalQualityFallback(data: any, issues: UnifiedIssue[]): number {
  let count = 0;
  const codes = new Set(issues.map((issue) => issue.code));
  if (codes.has("FINAL_REPORT_POST_MORTEM_CONTINUATION") && Array.isArray(data?.report?.futureTrends)) {
    const rejectedIndexes = new Set(issues.flatMap((issue) => {
      if (issue.code !== "FINAL_REPORT_POST_MORTEM_CONTINUATION") return [];
      const match = issue.path.match(/^report\.futureTrends\[(\d+)\]$/u);
      return match ? [Number(match[1])] : [];
    }));
    if (data.report.futureTrends.length - rejectedIndexes.size >= 1) {
      data.report.futureTrends = data.report.futureTrends.filter((_: unknown, index: number) => !rejectedIndexes.has(index));
      count += rejectedIndexes.size;
    } else {
      count += mapStringLeaves(data.report.futureTrends, (text) => removeMatchingSentences(text, POST_MORTEM_CONTINUATION_TEXT));
    }
  }
  if (codes.has("FINAL_REPORT_POST_MORTEM_ADVICE")) {
    count += mapStringLeaves(data?.report, (text) => removeMatchingSentences(
      text,
      POST_MORTEM_ADVICE_TEXT,
      "这段人生已经走完，留下的是曾经发生的选择与影响。"
    ));
  }
  if (codes.has("FINAL_REPORT_UNGROUNDED_EXTERNAL_FACT")) {
    count += mapStringLeaves(data?.report, (text) => removeMatchingSentences(text, POST_MORTEM_EXTERNAL_TEXT));
  }
  if (codes.has("FINAL_REPORT_UNGROUNDED_SCALE_CLAIM")) {
    count += mapStringLeaves(data?.report, (text) => text
      .replace(/无数|成千上万/gu, "一些")
      .replace(/全国|遍布各地/gu, "相关地区")
      .replace(/一代代/gu, "后来的人")
      .replace(/广泛采用/gu, "有人使用")
      .replace(/参考案例/gu, "实践记录")
      .replace(/多所(?:学校|中学)/gu, "相关学校")
      .replace(/(?:多个|更多|多地)县域/gu, "相关县域"));
  }
  if (codes.has("FINAL_REPORT_RAW_ATTRIBUTE_SCORE")) {
    count += mapStringLeaves(data, repairRawAttributeScores);
  }
  if (codes.has("FINAL_REPORT_POSTER_COPY_BUDGET_EXCEEDED")) {
    count += applyPosterBudgetFallback(data, issues);
  }
  return count;
}

function applyTerminalFallback(input: {
  data: any;
  issues: UnifiedIssue[];
  history: HistoryItem[];
}): { financialCount: number; qualityCount: number } {
  const supportedIssue = (issue: UnifiedIssue) => (
    issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT"
  ) || (
    issue.code === "FINAL_REPORT_UNSUPPORTED_DURATION" && issue.path === "share.viralTitle"
  ) || (
    issue.code === "REPORT_DEBT_COMPLETION_CONFLICT" && issue.path === "share.closingLine"
  ) || (
    issue.code === "REPORT_PROPERTY_ABSENCE_OVERCLAIM"
    || issue.code === "REPORT_ASSET_ABSENCE_OVERCLAIM"
  ) || [
    "FINAL_REPORT_POST_MORTEM_CONTINUATION",
    "FINAL_REPORT_POST_MORTEM_ADVICE",
    "FINAL_REPORT_UNGROUNDED_EXTERNAL_FACT",
    "FINAL_REPORT_UNGROUNDED_SCALE_CLAIM",
    "FINAL_REPORT_RAW_ATTRIBUTE_SCORE",
    "FINAL_REPORT_POSTER_COPY_BUDGET_EXCEEDED"
  ].includes(issue.code);
  if (input.issues.length === 0 || input.issues.some((issue) => !supportedIssue(issue))) {
    return { financialCount: 0, qualityCount: 0 };
  }
  const authority = deriveFinalFinancialNarrativeAuthority(input.history);
  if (!input.data?.share) return { financialCount: 0, qualityCount: 0 };
  let financialCount = 0;
  if (authority) {
    if (input.issues.some((issue) => issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT")) {
      financialCount += mapStringLeaves(input.data, (text) => {
      const replaced = replaceUnsupportedFinancialAmountsWithQualitativeText({
          text,
        authority
      });
        return replaced.text;
      });
    }
    if (input.issues.some((issue) => issue.code === "REPORT_DEBT_COMPLETION_CONFLICT" && issue.path === "share.closingLine")
      && typeof input.data.share.closingLine === "string") {
      const repaired = removeUnsupportedDebtCompletionClauses(input.data.share.closingLine);
      input.data.share.closingLine = repaired.text || input.data.share.oneLineSummary;
      financialCount += repaired.removalCount;
    }
    if (input.issues.some((issue) => (
      issue.code === "REPORT_PROPERTY_ABSENCE_OVERCLAIM"
      || issue.code === "REPORT_ASSET_ABSENCE_OVERCLAIM"
    ))) {
      financialCount += mapStringLeaves(input.data, repairUnsupportedAssetAbsenceClaims);
    }
  }
  let qualityCount = 0;
  if (input.issues.some((issue) => issue.code === "FINAL_REPORT_UNSUPPORTED_DURATION")
    && typeof input.data.share.viralTitle === "string") {
    const replacedTitle = input.data.share.viralTitle.replace(/\d+(?:\.\d+)?\s*年/u, () => {
      qualityCount += 1;
      return "多年";
    });
    input.data.share.viralTitle = replacedTitle;
  }
  qualityCount += applyTerminalQualityFallback(input.data, input.issues);
  return { financialCount, qualityCount };
}

export async function generateFinalOutcome(
  input: GenerateFinalOutcomeInput,
  deps: FinalOutcomeServiceDeps = {}
): Promise<FinalLifeOutcome> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildFinalOutcomePrompt(input.userData, input.answers, input.history, input.currentAttributes, input.context);
  const firstResponse = await callAiJson(prompt);
  const firstParse = tryParseAiJsonResponse(firstResponse);
  const firstValidation = firstParse.data
    ? collectUnifiedIssues(input, firstParse.data)
    : { quality: [], financial: [], all: [firstParse.issue!] as UnifiedIssue[] };
  const observedFinancialIssues = [...firstValidation.financial];
  const observedQualityIssues = [...firstValidation.quality];

  let data = firstParse.data;
  let financialClaimFallbackCount = 0;
  let finalOutcomeQualityFallbackCount = 0;
  if (firstValidation.all.length > 0) {
    const repairResponse = await callAiJson(buildFinalOutcomeRepairPrompt({
      originalPrompt: prompt,
      data: firstParse.data ?? firstParse.raw,
      issues: firstValidation.all,
      history: input.history
    }));
    const repairParse = tryParseAiJsonResponse(repairResponse);
    if (!repairParse.data) throw invalidAfterRepair([repairParse.issue!]);
    data = repairParse.data;
    let finalValidation = collectUnifiedIssues(input, data);
    observedFinancialIssues.push(...finalValidation.financial);
    observedQualityIssues.push(...finalValidation.quality);
    if (finalValidation.all.length > 0) {
      const fallback = applyTerminalFallback({
        data,
        issues: finalValidation.all,
        history: input.history
      });
      financialClaimFallbackCount = fallback.financialCount;
      finalOutcomeQualityFallbackCount = fallback.qualityCount;
      if (financialClaimFallbackCount > 0 || finalOutcomeQualityFallbackCount > 0) {
        finalValidation = collectUnifiedIssues(input, data);
      }
    }
    if (finalValidation.all.length > 0) throw invalidAfterRepair(finalValidation.all);
  }

  const outcome = normalizeFinalLifeOutcome(data, input.history, input.context.closureType);
  const normalizedValidation = collectUnifiedIssues(input, outcome);
  if (normalizedValidation.all.length > 0) {
    throw new AiClientError(
      "AI_RESPONSE_INVALID",
      `终局报告技术格式化后校验失败：${normalizedValidation.all.map((issue) => `${issue.path}:${issue.code}`).join("；")}`
    );
  }

  const authority = deriveFinalFinancialNarrativeAuthority(input.history);
  outcome.meta = {
    ...outcome.meta,
    financialNarrativeAuthorityVersion: authority?.version,
    financialClaimRepairTriggered: observedFinancialIssues.length > 0,
    financialClaimFallbackCount,
    financialClaimViolationCodes: [...new Set(observedFinancialIssues.map((issue) => issue.code))],
    sourceLedgerRevision: authority?.sourceLedgerRevision,
    finalOutcomeQualityRepairTriggered: observedQualityIssues.length > 0 || Boolean(firstParse.issue),
    finalOutcomeQualityFallbackCount,
    finalOutcomeQualityIssueCodes: [...new Set([
      ...observedQualityIssues.map((issue) => issue.code),
      ...(firstParse.issue ? [firstParse.issue.code] : [])
    ])]
  };
  return outcome;
}
