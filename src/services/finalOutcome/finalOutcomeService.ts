import { AiClientError } from "../ai/errors";
import { callDeepSeekJsonFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import { FinalLifeOutcome, FinalOutcomeContext, HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
import { normalizeFinalLifeOutcome } from "../../utils/finalOutcomeResponse";
import { buildFinalOutcomePrompt } from "./prompts";
import { getBrowserE2eAiJsonCaller } from "../e2e/e2eAiMock";

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
  return normalizeFinalLifeOutcome(data, input.history, input.context.closureType);
}
