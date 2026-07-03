import { buildEventMeta, queryDynamicLifeEvent } from "../../data/lifeEvents";
import { HistoryItem, LifeAttributes, PersonalityInsight, QuestionItem, QuestionTurn, SimulationNode, UserInitialData } from "../../types";
import { buildQuestionPrompt } from "../../utils/questionPrompt";
import { normalizePersonalityInsight } from "../../utils/insightResponse";
import { generateCompleteSimulationNode } from "../../utils/simulationNodeRetry";
import { normalizeSimulationNode } from "../../utils/simulationResponse";
import { buildStoryContextPack } from "../../utils/storyContext";
import { callDeepSeekJsonFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import { AiClientError } from "../ai/errors";
import { getBrowserE2eAiJsonCaller } from "../e2e/e2eAiMock";
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

function hasCompleteLifeAttributes(attributes: any): attributes is LifeAttributes {
  return [
    attributes?.happiness,
    attributes?.intelligence,
    attributes?.wealth,
    attributes?.relation,
    attributes?.health
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

function stringifyQuestionField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSuggestion(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return stringifyQuestionField(record.text ?? record.label ?? record.answer ?? record.value);
  }
  return "";
}

function normalizeQuestionItems(data: any): QuestionItem[] {
  const rawQuestions = Array.isArray(data?.questions)
    ? data.questions
    : Array.isArray(data?.questionList)
      ? data.questionList
      : Array.isArray(data?.items)
        ? data.items
        : [];

  return rawQuestions
    .map((item: unknown) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const question = stringifyQuestionField(
        record.question ?? record.title ?? record.prompt ?? record.text ?? record.content
      );
      const rawSuggestions = Array.isArray(record.suggestions)
        ? record.suggestions
        : Array.isArray(record.options)
          ? record.options
          : Array.isArray(record.choices)
            ? record.choices
            : [];
      const suggestions = rawSuggestions.map(normalizeSuggestion).filter(Boolean);
      return question && suggestions.length > 0 ? { question, suggestions } : null;
    })
    .filter((item): item is QuestionItem => Boolean(item));
}

function hasMalformedQuestionItems(data: any, normalized: QuestionItem[]): boolean {
  const rawQuestions = Array.isArray(data?.questions)
    ? data.questions
    : Array.isArray(data?.questionList)
      ? data.questionList
      : Array.isArray(data?.items)
        ? data.items
        : [];

  return rawQuestions.length === 0 || normalized.length === 0 || normalized.length !== rawQuestions.length;
}

export async function generateQuestions(
  userData: UserInitialData,
  deps: SimulationServiceDeps = {}
): Promise<GenerateQuestionsResult> {
  const callAiJson = getAiJsonCaller(deps);
  const basePrompt = buildQuestionPrompt(userData);
  let prompt = basePrompt;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const data = parseAiJsonResponse(await callAiJson(prompt));
    const questions = normalizeQuestionItems(data);
    if (!hasMalformedQuestionItems(data, questions)) {
      return { questions };
    }

    prompt = `${basePrompt}

【上一次返回不完整，必须重新生成】
问题列表中存在空 question、空 suggestions 或字段名不符合要求。
请严格返回：
{
  "questions": [
    { "question": "具体追问标题", "suggestions": ["第一人称候选回答"] }
  ]
}
每个 question 必须是非空中文问题，每个 suggestions 必须至少包含 4 个非空第一人称候选回答。`;
  }

  throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回的追问问题为空或格式异常，请重新生成。");
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
  const seedEvent = queryDynamicLifeEvent(input.currentAttributes, input.userData, fallbackAgeCheck, input.history, input.answers);
  const storyContext = buildStoryContextPack(input.userData, input.answers, input.history);
  const prompt = buildNextNodePrompt({ ...input, eventSeed: seedEvent, storyContext });
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
