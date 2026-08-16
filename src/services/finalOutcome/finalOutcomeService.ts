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

  let data = firstParse.data;
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
    const finalValidation = collectUnifiedIssues(input, data);
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
    financialClaimRepairTriggered: firstValidation.financial.length > 0,
    financialClaimFallbackCount: 0,
    financialClaimViolationCodes: [...new Set(firstValidation.financial.map((issue) => issue.code))],
    sourceLedgerRevision: authority?.sourceLedgerRevision,
    finalOutcomeQualityRepairTriggered: firstValidation.quality.length > 0 || Boolean(firstParse.issue),
    finalOutcomeQualityIssueCodes: [...new Set([
      ...firstValidation.quality.map((issue) => issue.code),
      ...(firstParse.issue ? [firstParse.issue.code] : [])
    ])]
  };
  return outcome;
}
