import { buildEventMeta, queryDynamicLifeEvent } from "../../data/lifeEvents";
import { HistoryItem, LifeAttributes, PersonalityInsight, QuestionItem, QuestionTurn, SimulationNode, UserInitialData } from "../../types";
import { buildQuestionPrompt } from "../../utils/questionPrompt";
import { normalizePersonalityInsight } from "../../utils/insightResponse";
import { generateCompleteSimulationNode } from "../../utils/simulationNodeRetry";
import { normalizeSimulationNode } from "../../utils/simulationResponse";
import { callDeepSeekJsonFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import { AiClientError } from "../ai/errors";
import {
  buildNextNodePrompt,
  buildNodePromptWithRetryNotice,
  buildPersonalityPrompt,
  buildStartSimulationPrompt,
  buildTimeTravelPrompt
} from "./prompts";

type AiJsonCaller = (prompt: string) => Promise<{ text: string }>;

export interface SimulationServiceDeps {
  callAiJson?: AiJsonCaller;
}

export interface GenerateQuestionsResult {
  questions: QuestionItem[];
}

export interface StartSimulationResult {
  initialAttributes: LifeAttributes;
  startNode: SimulationNode;
}

function getAiJsonCaller(deps: SimulationServiceDeps = {}): AiJsonCaller {
  if (deps.callAiJson) return deps.callAiJson;

  return (prompt: string) => callDeepSeekJsonFromBrowser(getBrowserAiEnv(), prompt);
}

function parseAiJsonResponse(response: { text?: string }): any {
  try {
    return JSON.parse(response.text || "{}");
  } catch (error) {
    throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回内容不是合法 JSON，请重试。", { cause: error });
  }
}

function hasCompleteLifeAttributes(attributes: any): attributes is LifeAttributes {
  return [
    attributes?.happiness,
    attributes?.intelligence,
    attributes?.wealth,
    attributes?.relation,
    attributes?.health
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

export async function generateQuestions(
  userData: UserInitialData,
  deps: SimulationServiceDeps = {}
): Promise<GenerateQuestionsResult> {
  const callAiJson = getAiJsonCaller(deps);
  const data = parseAiJsonResponse(await callAiJson(buildQuestionPrompt(userData)));
  return {
    questions: Array.isArray(data.questions) ? data.questions : []
  };
}

export async function startSimulation(
  userData: UserInitialData,
  answers: QuestionTurn[],
  deps: SimulationServiceDeps = {}
): Promise<StartSimulationResult> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildStartSimulationPrompt(userData, answers);
  let latestData: any = {};

  const startNode = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
    const response = await callAiJson(buildNodePromptWithRetryNotice(prompt, previousIssues));
    latestData = parseAiJsonResponse(response);
    return latestData.startNode || latestData.node || latestData;
  }, { fallbackAge: userData.regressionAge || 20 });

  return {
    ...latestData,
    initialAttributes: hasCompleteLifeAttributes(latestData.initialAttributes)
      ? latestData.initialAttributes
      : startNode.attributes,
    startNode
  };
}

export interface GenerateNextNodeInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  selectedDecision: string;
  nodeIndex?: number;
}

export async function generateNextNode(
  input: GenerateNextNodeInput,
  deps: SimulationServiceDeps = {}
): Promise<SimulationNode> {
  const callAiJson = getAiJsonCaller(deps);
  const lastNode = input.history[input.history.length - 1];
  const lastAge = lastNode ? lastNode.age : (input.userData.regressionAge || 20);
  const fallbackAgeCheck = lastAge + 3;
  const seedEvent = queryDynamicLifeEvent(input.currentAttributes, input.userData, fallbackAgeCheck, input.history);
  const prompt = buildNextNodePrompt({ ...input, eventSeed: seedEvent });
  const maxAgeStep = typeof input.nodeIndex === "number" && input.nodeIndex < 3 ? 2 : 4;

  const node = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
    const response = await callAiJson(buildNodePromptWithRetryNotice(prompt, previousIssues));
    return parseAiJsonResponse(response);
  }, {
    fallbackAge: lastAge + 1,
    minAge: lastAge + 1,
    maxAge: lastAge + maxAgeStep
  });

  return seedEvent ? { ...node, eventMeta: buildEventMeta(seedEvent) } : node;
}

export interface AnalyzePersonalityInput {
  userData: UserInitialData;
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
}

export async function analyzePersonality(
  input: AnalyzePersonalityInput,
  deps: SimulationServiceDeps = {}
): Promise<PersonalityInsight> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildPersonalityPrompt(input.userData, input.history, input.currentAttributes);
  const data = parseAiJsonResponse(await callAiJson(prompt));
  return normalizePersonalityInsight(data);
}

export interface TimeTravelInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  targetAge: number;
  targetTitle?: string;
  targetStage?: string;
  targetDescription?: string;
}

export async function timeTravel(
  input: TimeTravelInput,
  deps: SimulationServiceDeps = {}
): Promise<SimulationNode> {
  const callAiJson = getAiJsonCaller(deps);
  const prompt = buildTimeTravelPrompt(input);

  return generateCompleteSimulationNode(async (_attempt, previousIssues) => {
    const response = await callAiJson(buildNodePromptWithRetryNotice(prompt, previousIssues));
    const data = parseAiJsonResponse(response);
    return data.newPath || data.node || data;
  }, {
    fallbackAge: input.targetAge,
    minAge: input.targetAge,
    maxAge: input.targetAge
  });
}
