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
  replaceUnsupportedFinancialAmountsWithQualitativeText,
  type FinalFinancialNarrativeIssue
} from "../../utils/finalFinancialNarrativeAuthority";
import {
  buildFinalOutcomeRepairPrompt,
  collectFinalOutcomeQualityIssues,
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

function applyShareTerminalFallback(input: {
  data: any;
  issues: UnifiedIssue[];
  history: HistoryItem[];
}): { financialCount: number; qualityCount: number } {
  const supportedFinancialPaths = new Set(["share.viralTitle", "share.imageAlt"]);
  const supportedIssue = (issue: UnifiedIssue) => (
    issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT" && supportedFinancialPaths.has(issue.path)
  ) || (
    issue.code === "FINAL_REPORT_UNSUPPORTED_DURATION" && issue.path === "share.viralTitle"
  );
  if (input.issues.length === 0 || input.issues.some((issue) => !supportedIssue(issue))) {
    return { financialCount: 0, qualityCount: 0 };
  }
  const authority = deriveFinalFinancialNarrativeAuthority(input.history);
  if (!input.data?.share) return { financialCount: 0, qualityCount: 0 };
  let financialCount = 0;
  if (authority) {
    for (const field of ["viralTitle", "imageAlt"] as const) {
      if (typeof input.data.share[field] !== "string") continue;
      const replaced = replaceUnsupportedFinancialAmountsWithQualitativeText({
        text: input.data.share[field],
        authority
      });
      input.data.share[field] = replaced.text;
      financialCount += replaced.replacementCount;
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
      const fallback = applyShareTerminalFallback({
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
