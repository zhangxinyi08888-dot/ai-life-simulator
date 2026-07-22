import { AiClientError } from "../ai/errors";
import { callDeepSeekJsonFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import { FinalLifeOutcome, FinalOutcomeContext, HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
import { normalizeFinalLifeOutcome } from "../../utils/finalOutcomeResponse";
import { buildFinalOutcomePrompt } from "./prompts";
import { getBrowserE2eAiJsonCaller } from "../e2e/e2eAiMock";
import { sanitizeFinalOutcomeFinancialClaims } from "../../utils/finalOutcomeFinancialSanitizer";
import {
  applyFinalFinancialNarrativeFallback,
  buildFinalFinancialNarrativeRepairPrompt,
  collectFinalFinancialNarrativeIssues,
  deriveFinalFinancialNarrativeAuthority
} from "../../utils/finalFinancialNarrativeAuthority";

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

function getAiJsonCaller(deps: FinalOutcomeServiceDeps = {}): AiJsonCaller {
  if (deps.callAiJson) return deps.callAiJson;
  const e2eCaller = getBrowserE2eAiJsonCaller();
  if (e2eCaller) return e2eCaller;
  return (prompt: string) => callDeepSeekJsonFromBrowser(getBrowserAiEnv(), prompt);
}

function parseAiJsonResponse(response: { text?: string }): any {
  try {
    return JSON.parse(response.text || "{}");
  } catch (error) {
    throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回内容不是合法 JSON，请重试。", { cause: error });
  }
}

export async function generateFinalOutcome(
  input: GenerateFinalOutcomeInput,
  deps: FinalOutcomeServiceDeps = {}
): Promise<FinalLifeOutcome> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildFinalOutcomePrompt(input.userData, input.answers, input.history, input.currentAttributes, input.context);
  const data = parseAiJsonResponse(await callAiJson(prompt));
  let outcome = sanitizeFinalOutcomeFinancialClaims(
    normalizeFinalLifeOutcome(data, input.history, input.context.closureType),
    input.history
  );
  const authority = deriveFinalFinancialNarrativeAuthority(input.history);
  let issues = collectFinalFinancialNarrativeIssues({ outcome, authority });
  const initialViolationCodes = [...new Set(issues.map((issue) => issue.code))];
  let repairTriggered = false;
  let fallbackCount = 0;

  if (authority && issues.length > 0) {
    repairTriggered = true;
    const repairData = parseAiJsonResponse(await callAiJson(buildFinalFinancialNarrativeRepairPrompt({
      outcome,
      authority,
      issues
    })));
    outcome = sanitizeFinalOutcomeFinancialClaims(
      normalizeFinalLifeOutcome(repairData, input.history, input.context.closureType),
      input.history
    );
    issues = collectFinalFinancialNarrativeIssues({ outcome, authority });
  }

  if (authority && issues.length > 0) {
    fallbackCount = issues.length;
    outcome = applyFinalFinancialNarrativeFallback({ outcome, authority, issues });
    const remaining = collectFinalFinancialNarrativeIssues({ outcome, authority });
    if (remaining.length > 0) {
      throw new AiClientError(
        "AI_RESPONSE_INVALID",
        `终局报告仍与权威财务事实冲突：${remaining.map((issue) => `${issue.path}:${issue.code}`).join("；")}`
      );
    }
  }

  outcome.meta = {
    ...outcome.meta,
    financialNarrativeAuthorityVersion: authority?.version,
    financialClaimRepairTriggered: repairTriggered,
    financialClaimFallbackCount: fallbackCount,
    financialClaimViolationCodes: initialViolationCodes,
    sourceLedgerRevision: authority?.sourceLedgerRevision
  };
  return outcome;
}
