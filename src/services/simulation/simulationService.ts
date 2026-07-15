import { buildEventMeta, getEventTemporalProfile, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent, queryHealthEscalationEvent } from "../../data/lifeEvents";
import { ChoiceTemporalHint, FinancialChange, FinancialSignals, FinancialState, HistoryItem, LifeAttributes, PersonalityInsight, PressureArcState, QuestionItem, QuestionTurn, SimulationNode, UserInitialData, WorldDelta } from "../../types";
import { DEFAULT_ENDING_POLICY } from "../../config/endingPolicy";
import { buildQuestionPrompt } from "../../utils/questionPrompt";
import { normalizePersonalityInsight } from "../../utils/insightResponse";
import { generateCompleteSimulationNode } from "../../utils/simulationNodeRetry";
import { normalizeSimulationNode } from "../../utils/simulationResponse";
import { buildStoryContextPack } from "../../utils/storyContext";
import { buildAgeContext } from "../../utils/ageContext";
import { DEFAULT_PHASE_POLICY, reducePressureArc, resolvePhase, validateNodeOutcomeProposal } from "../../utils/arcLifecycle";
import { evaluateDecisionGate } from "../../utils/decisionGate";
import { evaluateEnding } from "../../utils/endingDecision";
import { rebuildPersonStates } from "../../utils/personTimeline";
import { commitSimulationTransaction, emptyWorldState } from "../../utils/simulationTransaction";
import { buildBranchFingerprint, calculateTimelineAdvance, deriveTemporalProfile } from "../../utils/timelineAdvance";
import { stableHash } from "../../utils/stableRandom";
import { containsForbiddenArcWrite, validateStoryConsistency } from "../../utils/storyConsistency";
import { applyFinancialChange, applyFinancialSignals, estimateFinancialStateFromWealth, getFinancialChangeInputIssues, getFinancialSignalsInputIssues, getPropertyTransactionSignalIssues, inferFinancialSignalsFromNarrative, normalizeInitialFinancialState, withCalculatedWealth } from "../../utils/financialState";
import { sanitizeFinancialNarrative } from "../../utils/financialNarrative";
import { reconcileHealth } from "../../utils/healthReconciliation";
import { callDeepSeekJsonFromBrowser } from "../ai/deepseekBrowserClient";
import { getBrowserAiEnv } from "../ai/env";
import { AiClientError } from "../ai/errors";
import { getBrowserE2eAiJsonCaller, shouldForceBrowserE2eEnding } from "../e2e/e2eAiMock";
import {
  buildNextNodePrompt,
  buildFinancialSignalsRepairPrompt,
  buildEndingNodePrompt,
  buildNodePromptWithRetryNotice,
  buildPersonalityPrompt,
  buildStartSimulationPrompt,
  buildTimeTravelPrompt
} from "./prompts";

type AiJsonCaller = (prompt: string) => Promise<{ text: string }>;

export interface SimulationServiceDeps {
  callAiJson?: AiJsonCaller;
  enableFinancialRepair?: boolean;
}

export interface GenerateQuestionsResult {
  questions: QuestionItem[];
}

export interface StartSimulationResult {
  initialAttributes: LifeAttributes;
  startNode: SimulationNode;
}

function hasFinancialObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function attachFinancialProgress(input: {
  node: SimulationNode;
  rawNode: any;
  previousState: FinancialState;
  previousWealth: number;
  elapsedMonths: number;
  targetAgeInMonths: number;
}): SimulationNode {
  const rawSignals = hasFinancialObject(input.rawNode?.financialSignals)
    ? input.rawNode.financialSignals as Partial<FinancialSignals>
    : undefined;
  const signalIssues = rawSignals
    ? getFinancialSignalsInputIssues(rawSignals, input.elapsedMonths)
    : ["financialSignals 缺失"];
  if (rawSignals && signalIssues.length === 0) {
    const calculated = applyFinancialSignals(
      input.previousState,
      rawSignals,
      input.elapsedMonths,
      input.targetAgeInMonths
    );
    return {
      ...input.node,
      description: sanitizeFinancialNarrative(input.node.description, calculated.financialState),
      attributes: withCalculatedWealth(input.node.attributes, calculated.financialState, input.previousWealth),
      financialState: calculated.financialState,
      financialSignals: calculated.financialSignals,
      financialChange: calculated.financialChange
    };
  }

  const rawChange = hasFinancialObject(input.rawNode?.financialChange)
    ? input.rawNode.financialChange as Partial<FinancialChange>
    : undefined;
  const financialIssues = rawChange
    ? getFinancialChangeInputIssues(rawChange, input.elapsedMonths)
    : ["financialChange 缺失"];
  if (rawChange && financialIssues.length === 0) {
    const calculated = applyFinancialChange(
      input.previousState,
      rawChange,
      input.elapsedMonths,
      input.targetAgeInMonths
    );
    return {
      ...input.node,
      description: sanitizeFinancialNarrative(input.node.description, calculated.financialState),
      attributes: withCalculatedWealth(input.node.attributes, calculated.financialState, input.previousWealth),
      financialState: calculated.financialState,
      financialChange: calculated.financialChange
    };
  }

  const inferredSignals = inferFinancialSignalsFromNarrative({
    description: input.node.description,
    previousState: input.previousState,
    periodMonths: input.elapsedMonths,
    targetAgeInMonths: input.targetAgeInMonths
  });
  const inferred = applyFinancialSignals(
    input.previousState,
    inferredSignals,
    input.elapsedMonths,
    input.targetAgeInMonths
  );
  return {
    ...input.node,
    description: sanitizeFinancialNarrative(input.node.description, inferred.financialState),
    attributes: withCalculatedWealth(input.node.attributes, inferred.financialState, input.previousWealth),
    financialState: inferred.financialState,
    financialSignals: inferred.financialSignals,
    financialChange: inferred.financialChange
  };
}

function isMajorFinancialNarrative(text: string): boolean {
  return /买房|卖房|房产|首付|按揭|继承|遗产|股权|融资|公司估值|企业出售|破产|债务重组|大额负债/.test(text);
}

async function repairFinancialChangeIfNeeded(input: {
  rawNode: any;
  node: SimulationNode;
  currentFinancialState: FinancialState;
  elapsedMonths: number;
  targetAgeInMonths: number;
  selectedDecision: string;
  history: HistoryItem[];
  callAiJson: AiJsonCaller;
  enabled: boolean;
}): Promise<any> {
  const rawSignals = input.rawNode?.financialSignals;
  const signalIssues = hasFinancialObject(rawSignals)
    ? getFinancialSignalsInputIssues(rawSignals, input.elapsedMonths)
    : ["financialSignals 缺失"];
  const rawChange = input.rawNode?.financialChange;
  const legacyIssues = hasFinancialObject(rawChange)
    ? getFinancialChangeInputIssues(rawChange, input.elapsedMonths)
    : ["financialChange 缺失"];
  const propertyIssues = getPropertyTransactionSignalIssues(input.node.description, rawSignals);
  const hasValidSignals = signalIssues.length === 0 && propertyIssues.length === 0;
  const hasValidLegacyChange = legacyIssues.length === 0 && propertyIssues.length === 0;
  if (hasValidSignals || hasValidLegacyChange || !input.enabled || !isMajorFinancialNarrative(input.node.description)) {
    return input.rawNode;
  }

  try {
    const prompt = buildFinancialSignalsRepairPrompt({
      description: input.node.description,
      title: input.node.title,
      ageInMonths: input.targetAgeInMonths,
      elapsedMonths: input.elapsedMonths,
      selectedDecision: input.selectedDecision,
      currentFinancialState: input.currentFinancialState,
      recentHistory: input.history
    });
    const repairedData = parseAiJsonResponse(await input.callAiJson(prompt));
    const repairedSignals = hasFinancialObject(repairedData?.financialSignals)
      ? repairedData.financialSignals
      : repairedData;
    if (
      !hasFinancialObject(repairedSignals)
      || getFinancialSignalsInputIssues(repairedSignals, input.elapsedMonths).length > 0
      || getPropertyTransactionSignalIssues(input.node.description, repairedSignals).length > 0
    ) {
      return input.rawNode;
    }
    return { ...input.rawNode, financialSignals: repairedSignals };
  } catch {
    return input.rawNode;
  }
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
  }, {
    fallbackAge: userData.regressionAge || 20,
    minAge: userData.regressionAge || 20,
    maxAge: userData.regressionAge || 20,
    targetAgeInMonths: (userData.regressionAge || 20) * 12,
    previousAgeInMonths: (userData.regressionAge || 20) * 12,
    elapsedMonths: 0,
    lifeIntensity: "normal"
  });
  const startAgeInMonths = startNode.ageInMonths ?? startNode.age * 12;
  const rawFinancialState = latestData.initialFinancialState || latestData.startNode?.financialState || latestData.financialState;
  const financialState = normalizeInitialFinancialState(rawFinancialState, startAgeInMonths, startNode.attributes.wealth);
  const startAttributes = hasFinancialObject(rawFinancialState)
    ? withCalculatedWealth(startNode.attributes, financialState)
    : startNode.attributes;
  const startWorldState = emptyWorldState();
  startWorldState.directionArcs = ensureDirectionArcs(startWorldState, userData, startNode.ageInMonths ?? startNode.age * 12);
  startWorldState.people = rebuildPersonStates(userData, [], startNode.ageInMonths ?? startNode.age * 12);
  const initializedStartNodeWithFinance = {
    ...startNode,
    description: sanitizeFinancialNarrative(startNode.description, financialState),
    attributes: startAttributes,
    financialState,
    worldStateSnapshot: startWorldState
  };

  return {
    ...latestData,
    initialAttributes: initializedStartNodeWithFinance.attributes,
    startNode: initializedStartNodeWithFinance
  };
}

export interface GenerateNextNodeInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  selectedDecision: string;
  nodeIndex?: number;
  simulationSeed?: string;
}

function resolveChoiceTemporalHint(history: HistoryItem[], selectedDecision: string): ChoiceTemporalHint | undefined {
  const latest = history[history.length - 1];
  const preset = latest?.choices.find((choice) => choice.text === selectedDecision || selectedDecision.includes(choice.text));
  if (preset?.temporalHint) return preset.temporalHint;
  const text = selectedDecision;
  if (/急|立即|重病|危机/.test(text)) return { lifeIntensity: "critical", durationMonths: [1, 6], requiresFollowUp: true, reason: "自定义选择包含即时危机" };
  if (/创业|融资|辞职|转型|扩张|冲突/.test(text)) return { lifeIntensity: "high_tension", durationMonths: [6, 12], requiresFollowUp: true, reason: "自定义选择开启高张力行动" };
  if (/稳定|维持|长期|退休/.test(text)) return { lifeIntensity: "stable", durationMonths: [36, 60], requiresFollowUp: false, reason: "自定义选择强调长期稳定" };
  return undefined;
}

function latestWorldState(history: HistoryItem[]) {
  return history[history.length - 1]?.worldStateSnapshot || emptyWorldState();
}

function ensureDirectionArcs(worldState: ReturnType<typeof emptyWorldState>, userData: UserInitialData, currentAgeInMonths: number) {
  if (worldState.directionArcs.length > 0 || !userData.regressionChoices?.trim()) return worldState.directionArcs;
  return [{
    id: `direction_${stableHash({ focus: userData.coreStoryFocus, direction: userData.regressionChoices })}`,
    directionType: userData.coreStoryFocus || "self_directed",
    summary: userData.regressionChoices.trim(),
    status: "active" as const,
    startedAtAgeInMonths: currentAgeInMonths,
    userReinforcementCount: 1,
    establishedAssets: []
  }];
}

function foregroundPressureArc(history: HistoryItem[]): PressureArcState | undefined {
  const worldState = latestWorldState(history);
  return worldState.pressureArcs.find((arc) => arc.id === worldState.foregroundPressureArcId && arc.status !== "resolved");
}

function fallbackWorldDeltaTypes(node: SimulationNode): WorldDelta["type"][] {
  const category = node.eventMeta?.eventCategory;
  if (category === "health") return ["health_state"];
  if (category === "relationship") return ["relationship_change"];
  if (category === "career" || category === "financial" || category === "opportunity") return ["career_state"];
  return [];
}

export async function generateNextNode(
  input: GenerateNextNodeInput,
  deps: SimulationServiceDeps = {}
): Promise<SimulationNode> {
  const callAiJson = getAiJsonCaller(deps);
  const shouldRepairFinancialChange = deps.enableFinancialRepair
    ?? (!deps.callAiJson && !getBrowserE2eAiJsonCaller());
  const lastNode = input.history[input.history.length - 1];
  const lastAge = lastNode ? lastNode.age : (input.userData.regressionAge || 20);
  const currentAgeInMonths = lastNode?.ageInMonths ?? lastAge * 12;
  const currentFinancialState = lastNode?.financialState
    || estimateFinancialStateFromWealth(input.currentAttributes.wealth, currentAgeInMonths);
  const nodeIndex = input.nodeIndex ?? input.history.length;
  const simulationSeed = input.simulationSeed || stableHash({ user: input.userData.birthday, regressionAge: input.userData.regressionAge });
  const branchFingerprint = buildBranchFingerprint(input.history, input.selectedDecision, nodeIndex);
  const baseWorldState = latestWorldState(input.history);
  const currentWorldState = { ...baseWorldState, directionArcs: ensureDirectionArcs(baseWorldState, input.userData, currentAgeInMonths) };
  const existingPressureArc = foregroundPressureArc(input.history);
  const healthEscalationEvent = existingPressureArc
    ? null
    : queryHealthEscalationEvent(input.currentAttributes, input.history);
  const seedEvent = existingPressureArc
    ? LIFE_EVENTS_DATABASE.find((event) => event.id === existingPressureArc.eventId) || null
    : healthEscalationEvent
      || queryDynamicLifeEvent(input.currentAttributes, input.userData, Math.floor(currentAgeInMonths / 12), input.history, input.answers);
  const eventProfile = seedEvent ? getEventTemporalProfile(seedEvent) : undefined;
  const startArcDecision = !existingPressureArc && seedEvent && eventProfile?.requiresFollowUp
    ? reducePressureArc({
        startProposal: { eventId: seedEvent.id, eventIntentType: seedEvent.intent.type, currentAgeInMonths, summary: seedEvent.intent.meaning },
        policy: DEFAULT_PHASE_POLICY,
        selectedDecision: input.selectedDecision,
        attributes: input.currentAttributes,
        timelineAdvance: { elapsedMonths: 0, targetAgeInMonths: currentAgeInMonths }
      })
    : undefined;
  const workingPressureArc = existingPressureArc || startArcDecision?.nextArcState;
  const pressurePhaseProfile = workingPressureArc ? resolvePhase(DEFAULT_PHASE_POLICY, workingPressureArc.phaseId) : undefined;
  const stableNodeCount = input.history.slice(-2).filter((item) => item.narrativeMeta?.lifeIntensity === "stable").length;
  const temporalProfile = deriveTemporalProfile({
    pressurePhaseProfile,
    choiceHint: resolveChoiceTemporalHint(input.history, input.selectedDecision),
    eventProfile,
    attributes: input.currentAttributes,
    stableNodeCount
  });
  const timelineAdvance = calculateTimelineAdvance({
    currentAgeInMonths,
    temporalProfile,
    simulationSeed,
    branchFingerprint,
    hardMaximumAge: DEFAULT_ENDING_POLICY.hardMaximumAge
  });
  const people = rebuildPersonStates(input.userData, input.history, timelineAdvance.targetAgeInMonths);
  const worldState = { ...currentWorldState, people };
  const ageContext = buildAgeContext({
    previousAgeInMonths: currentAgeInMonths,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    attributes: input.currentAttributes,
    userData: input.userData,
    history: input.history,
    people,
    directionArcs: worldState.directionArcs
  });
  const storyContext = buildStoryContextPack(input.userData, input.answers, input.history);
  const prompt = buildNextNodePrompt({ ...input, currentFinancialState, eventSeed: seedEvent, storyContext, timelineAdvance, ageContext, worldState, foregroundPressureArc: workingPressureArc });

  let latestRawNode: any = {};
  let node = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
    const response = await callAiJson(buildNodePromptWithRetryNotice(prompt, previousIssues));
    latestRawNode = parseAiJsonResponse(response);
    return latestRawNode;
  }, {
    fallbackAge: timelineAdvance.targetAge,
    minAge: timelineAdvance.targetAge,
    maxAge: timelineAdvance.targetAge,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    previousAgeInMonths: currentAgeInMonths,
    elapsedMonths: timelineAdvance.elapsedMonths,
    lifeIntensity: timelineAdvance.lifeIntensity,
    pressureArcId: workingPressureArc?.id
  });
  latestRawNode = await repairFinancialChangeIfNeeded({
    rawNode: latestRawNode,
    node,
    currentFinancialState,
    elapsedMonths: timelineAdvance.elapsedMonths,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    selectedDecision: input.selectedDecision,
    history: input.history,
    callAiJson,
    enabled: shouldRepairFinancialChange
  });
  node = {
    ...node,
    isEndingNode: false,
    eventMeta: seedEvent ? buildEventMeta(seedEvent) : undefined,
    choices: node.choices.map((choice) => ({
      ...choice,
      expectedWorldDeltaTypes: choice.expectedWorldDeltaTypes?.length ? choice.expectedWorldDeltaTypes : fallbackWorldDeltaTypes({ ...node, eventMeta: seedEvent ? buildEventMeta(seedEvent) : undefined })
    }))
  };
  node = attachFinancialProgress({
    node,
    rawNode: latestRawNode,
    previousState: currentFinancialState,
    previousWealth: input.currentAttributes.wealth,
    elapsedMonths: timelineAdvance.elapsedMonths,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths
  });

  let consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
  if (containsForbiddenArcWrite(latestRawNode) || consistencyIssues.some((issue) => issue.severity === "error")) {
    const issueText = [
      containsForbiddenArcWrite(latestRawNode) ? "模型尝试直接修改 PressureArc phase；只能返回 arcSignals" : "",
      ...consistencyIssues.map((issue) => issue.message)
    ].filter(Boolean).join("；");
    const response = await callAiJson(`${prompt}\n\n【年龄与状态一致性修复】\n${issueText}\n请重新生成完整节点，不得修改 Arc 状态。`);
    latestRawNode = parseAiJsonResponse(response);
    if (containsForbiddenArcWrite(latestRawNode)) throw new AiClientError("AI_RESPONSE_INVALID", "AI 返回包含未授权的 Arc 状态修改，请重试。");
    node = normalizeSimulationNode(latestRawNode, {
      fallbackAge: timelineAdvance.targetAge,
      minAge: timelineAdvance.targetAge,
      maxAge: timelineAdvance.targetAge,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      previousAgeInMonths: currentAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      pressureArcId: workingPressureArc?.id
    });
    node = { ...node, isEndingNode: false, eventMeta: seedEvent ? buildEventMeta(seedEvent) : undefined };
    latestRawNode = await repairFinancialChangeIfNeeded({
      rawNode: latestRawNode,
      node,
      currentFinancialState,
      elapsedMonths: timelineAdvance.elapsedMonths,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      selectedDecision: input.selectedDecision,
      history: input.history,
      callAiJson,
      enabled: shouldRepairFinancialChange
    });
    node = attachFinancialProgress({
      node,
      rawNode: latestRawNode,
      previousState: currentFinancialState,
      previousWealth: input.currentAttributes.wealth,
      elapsedMonths: timelineAdvance.elapsedMonths,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths
    });
    consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
    if (consistencyIssues.some((issue) => issue.severity === "error")) throw new AiClientError("AI_RESPONSE_INVALID", consistencyIssues.map((issue) => issue.message).join("；"));
  }

  node = {
    ...node,
    attributes: {
      ...node.attributes,
      health: reconcileHealth(
        input.currentAttributes.health,
        node.attributes.health,
        node.narrativeMeta?.recoveryState ?? "neutral",
        node.eventMeta?.eventId === "health_forced_pause"
      )
    }
  };

  const endingDecision = evaluateEnding({
    candidateNode: node,
    history: input.history,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths,
    elapsedMonths: timelineAdvance.elapsedMonths,
    simulationSeed,
    branchFingerprint,
    nodeIndex,
    policy: DEFAULT_ENDING_POLICY
  });
  if (endingDecision.shouldEnd || shouldForceBrowserE2eEnding(latestRawNode)) {
    const endingPrompt = buildEndingNodePrompt({ userData: input.userData, history: input.history, candidateNode: node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, forcedByHardMaximum: endingDecision.forcedByHardMaximum });
    const response = await callAiJson(endingPrompt);
    const rawEnding = parseAiJsonResponse(response);
    const normalizedEnding = normalizeSimulationNode(rawEnding, {
      fallbackAge: timelineAdvance.targetAge,
      minAge: timelineAdvance.targetAge,
      maxAge: timelineAdvance.targetAge,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      previousAgeInMonths: currentAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      pressureArcId: workingPressureArc?.id
    });
    const endingNode: SimulationNode = {
      ...normalizedEnding,
      description: sanitizeFinancialNarrative(normalizedEnding.description, node.financialState!),
      attributes: node.attributes,
      financialState: node.financialState,
      financialChange: node.financialChange,
      isEndingNode: true,
      choices: [{ id: "ENDING", text: "安详落幕，查看一生洞察", impactSummary: "一生回望" }],
      eventMeta: node.eventMeta
    };
    const endingOutcome = validateNodeOutcomeProposal({
      worldDeltas: endingNode.narrativeMeta?.worldDeltas,
      arcSignals: endingNode.narrativeMeta?.arcSignals,
      policy: DEFAULT_PHASE_POLICY,
      narrativeText: endingNode.description
    });
    const terminalTransition = workingPressureArc
      ? { action: "resolve" as const, previousPhaseId: workingPressureArc.phaseId, nextArcState: { ...workingPressureArc, status: "resolved" as const }, reasonCodes: ["life-ending"] }
      : { action: "stay" as const, reasonCodes: ["no-pressure-arc"] };
    return commitSimulationTransaction({
      transactionId: stableHash({ namespace: "ending-transaction", simulationSeed, branchFingerprint, targetAgeInMonths: timelineAdvance.targetAgeInMonths }),
      node: endingNode,
      storyEpisode: endingNode.narrativeMeta!.storyEpisode,
      acceptedOutcome: endingOutcome,
      pressureArcTransition: terminalTransition,
      currentWorldStateSnapshot: worldState
    }).node;
  }

  let decisionGate = evaluateDecisionGate({ candidateNode: node, previousNode: lastNode, pressureArc: workingPressureArc, recentHistory: input.history, targetAgeInMonths: timelineAdvance.targetAgeInMonths });
  if (!decisionGate.isDecisionCheckpoint) {
    const blockedChoicePrompt = decisionGate.blockedDecisionIntents.length > 0
      ? `\n以下 decisionIntent 近期已被用户重复未采纳，处于冷却中：${decisionGate.blockedDecisionIntents.join("、")}。保留相关真实事实或人物关系，但不得改写文案后再次提供同一行动。`
      : "";
    const repairPrompt = `${prompt}\n\n【DecisionGate 未通过】\n问题：${decisionGate.reasonCodes.join("、")}。${blockedChoicePrompt}\n请把等待、复查、恢复等过程压缩进 storyEpisode.internalTransitions，并生成至少两个会改变未来状态的实质选项。`;
    const response = await callAiJson(repairPrompt);
    latestRawNode = parseAiJsonResponse(response);
    if (containsForbiddenArcWrite(latestRawNode)) throw new AiClientError("AI_RESPONSE_INVALID", "DecisionGate 修复结果包含未授权的 Arc 状态修改。");
    node = normalizeSimulationNode(latestRawNode, {
      fallbackAge: timelineAdvance.targetAge,
      minAge: timelineAdvance.targetAge,
      maxAge: timelineAdvance.targetAge,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      previousAgeInMonths: currentAgeInMonths,
      elapsedMonths: timelineAdvance.elapsedMonths,
      lifeIntensity: timelineAdvance.lifeIntensity,
      pressureArcId: workingPressureArc?.id
    });
    node = { ...node, isEndingNode: false, eventMeta: seedEvent ? buildEventMeta(seedEvent) : undefined };
    latestRawNode = await repairFinancialChangeIfNeeded({
      rawNode: latestRawNode,
      node,
      currentFinancialState,
      elapsedMonths: timelineAdvance.elapsedMonths,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths,
      selectedDecision: input.selectedDecision,
      history: input.history,
      callAiJson,
      enabled: shouldRepairFinancialChange
    });
    node = attachFinancialProgress({
      node,
      rawNode: latestRawNode,
      previousState: currentFinancialState,
      previousWealth: input.currentAttributes.wealth,
      elapsedMonths: timelineAdvance.elapsedMonths,
      targetAgeInMonths: timelineAdvance.targetAgeInMonths
    });
    consistencyIssues = validateStoryConsistency({ node, targetAgeInMonths: timelineAdvance.targetAgeInMonths, people });
    if (consistencyIssues.some((issue) => issue.severity === "error")) throw new AiClientError("AI_RESPONSE_INVALID", consistencyIssues.map((issue) => issue.message).join("；"));
    decisionGate = evaluateDecisionGate({ candidateNode: node, previousNode: lastNode, pressureArc: workingPressureArc, recentHistory: input.history, targetAgeInMonths: timelineAdvance.targetAgeInMonths });
    if (!decisionGate.isDecisionCheckpoint) throw new AiClientError("AI_RESPONSE_INVALID", "生成结果没有形成真正不同的人生选择，请重试。");
  }

  const acceptedOutcome = validateNodeOutcomeProposal({
    worldDeltas: node.narrativeMeta?.worldDeltas,
    arcSignals: node.narrativeMeta?.arcSignals,
    policy: DEFAULT_PHASE_POLICY,
    narrativeText: node.description
  });
  const pressureArcTransition = reducePressureArc({
    currentArc: workingPressureArc,
    policy: DEFAULT_PHASE_POLICY,
    selectedDecision: input.selectedDecision,
    acceptedOutcome,
    attributes: node.attributes,
    timelineAdvance
  });
  const transactionId = stableHash({ namespace: "simulation-transaction", simulationSeed, branchFingerprint, targetAgeInMonths: timelineAdvance.targetAgeInMonths });
  const committed = commitSimulationTransaction({
    transactionId,
    node,
    storyEpisode: node.narrativeMeta!.storyEpisode,
    acceptedOutcome,
    pressureArcTransition,
    currentWorldStateSnapshot: worldState
  });
  return committed.node;
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
    maxAge: input.targetAge,
    targetAgeInMonths: input.targetAge * 12,
    previousAgeInMonths: input.targetAge * 12,
    elapsedMonths: 0,
    lifeIntensity: "normal"
  });
}
