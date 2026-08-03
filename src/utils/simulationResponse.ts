import { LifeIntensity, RecoveryState, SimulationChoice, SimulationNode, WorldDelta } from "../types";
import { deriveLifeStage } from "./timelineAdvance";
import { stableHash } from "./stableRandom";
import { isValidRomanceDisplayName } from "./romanceCandidateName";

interface NormalizeOptions {
  fallbackAge?: number;
  minAge?: number;
  maxAge?: number;
  targetAgeInMonths?: number;
  previousAgeInMonths?: number;
  elapsedMonths?: number;
  lifeIntensity?: LifeIntensity;
  pressureArcId?: string;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min?: number, max?: number): number {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

function normalizeAttributes(attributes: any): SimulationNode["attributes"] {
  return {
    happiness: readNumber(attributes?.happiness, 50),
    intelligence: readNumber(attributes?.intelligence ?? attributes?.wisdom ?? attributes?.talent, 50),
    wealth: readNumber(attributes?.wealth, 50),
    relation: readNumber(attributes?.relation ?? attributes?.social ?? attributes?.relationships, 50),
    health: readNumber(attributes?.health, 50)
  };
}

type WithNormalizedChoices<T> = Omit<T, "choices"> & { choices: SimulationNode["choices"] };
type WithNormalizedNode<T> = Omit<T, keyof SimulationNode> & SimulationNode;

function readNodeDescription(node: any): string {
  const structuredParagraphs = Array.isArray(node?.descriptionParagraphs)
    ? node.descriptionParagraphs.map(readString).filter(Boolean)
    : [];
  return structuredParagraphs.join("\n\n")
    || readString(node?.description)
    || readString(node?.narrative)
    || readString(node?.newCrossroads?.narrative)
    || readString(node?.scene)
    || readString(node?.story);
}

function hasCompleteAttributes(attributes: any): boolean {
  return [
    attributes?.happiness,
    attributes?.intelligence ?? attributes?.wisdom ?? attributes?.talent,
    attributes?.wealth,
    attributes?.relation ?? attributes?.social ?? attributes?.relationships,
    attributes?.health
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

export function getRawSimulationNodeChoices(node: Record<string, any>): any[] {
  return Array.isArray(node.choices)
    ? node.choices
    : Array.isArray(node.options)
      ? node.options
      : Array.isArray(node.newCrossroads?.options)
        ? node.newCrossroads.options
        : [];
}

function isExplicitChoiceTextValid(choice: any, index: number): boolean {
  const text = readString(choice?.text);
  if (!text) return false;

  const id = readString(choice?.id) || readString(choice?.label) || String.fromCharCode(65 + index);
  const impactSummary = readString(choice?.impactSummary) || readString(choice?.summary) || "继续探索";
  return text !== `${id}. ${impactSummary}`;
}

export function getInvalidExplicitChoiceTextIndexes(node: Record<string, any>): number[] {
  return getRawSimulationNodeChoices(node).flatMap((choice, index) => (
    isExplicitChoiceTextValid(choice, index) ? [] : [index]
  ));
}

export function normalizeSimulationNodeChoices<T extends Record<string, any>>(node: T): WithNormalizedChoices<T> {
  const rawChoices = getRawSimulationNodeChoices(node);
  const choices = rawChoices.map((choice: any, index: number) => {
    const id = readString(choice?.id) || readString(choice?.label) || String.fromCharCode(65 + index);
    const impactSummary = readString(choice?.impactSummary) || readString(choice?.summary) || "继续探索";
    const text = readString(choice?.text) || readString(choice?.content) || readString(choice?.choice) || readString(choice?.labelText) || `${id}. ${impactSummary}`;
    const rawIntensity = readString(choice?.temporalHint?.lifeIntensity);
    const lifeIntensity: LifeIntensity = ["critical", "high_tension", "normal", "stable"].includes(rawIntensity)
      ? rawIntensity as LifeIntensity
      : /急|立即|危机|重病/.test(text)
        ? "critical"
        : /创业|融资|辞职|转型|扩张|冲突/.test(text)
          ? "high_tension"
          : /稳定|维持|长期|退休/.test(text)
            ? "stable"
            : "normal";
    const defaultDuration: Record<LifeIntensity, [number, number]> = {
      critical: [1, 6], high_tension: [6, 12], normal: [12, 36], stable: [36, 60]
    };
    const duration = Array.isArray(choice?.temporalHint?.durationMonths) && choice.temporalHint.durationMonths.length >= 2
      ? [readNumber(choice.temporalHint.durationMonths[0], defaultDuration[lifeIntensity][0]), readNumber(choice.temporalHint.durationMonths[1], defaultDuration[lifeIntensity][1])] as [number, number]
      : defaultDuration[lifeIntensity];
    const validDeltaTypes = new Set(["person_status", "person_role", "relationship_change", "career_state", "health_state", "expense_responsibility", "location_change"]);
    const expectedWorldDeltaTypes = Array.isArray(choice?.expectedWorldDeltaTypes)
      ? choice.expectedWorldDeltaTypes.filter((value: unknown): value is WorldDelta["type"] => typeof value === "string" && validDeltaTypes.has(value))
      : [];

    return {
      id,
      text,
      impactSummary,
      temporalHint: {
        lifeIntensity,
        durationMonths: duration,
        requiresFollowUp: Boolean(choice?.temporalHint?.requiresFollowUp ?? (lifeIntensity === "critical" || lifeIntensity === "high_tension")),
        reason: readString(choice?.temporalHint?.reason) || impactSummary
      },
      decisionIntent: readString(choice?.decisionIntent) || text,
      eventOutcomeId: readString(choice?.eventOutcomeId) || undefined,
      expectedWorldDeltaTypes
    } satisfies SimulationChoice;
  });

  return {
    ...node,
    choices
  };
}

export interface SimulationNodeValidationOptions {
  allowedOutcomeIds?: string[];
  eventIntentType?: string;
  /** New AI responses must provide a real text field; legacy history normalization remains tolerant. */
  requireExplicitChoiceText?: boolean;
}

function matchesRomanceOutcomeSemantics(outcomeId: string, text: string): boolean {
  if (outcomeId === "continue_getting_to_know") {
    if (/专业联系|业务联系|行业人脉|工作往来/.test(text) && !/私下|生活里|约会|进一步了解|浪漫/.test(text)) return false;
    return /继续.*(?:了解|接触|见面|相处|交流|联系)|进一步了解|约(?:会|见)|私下见面|为.*留出.*空间/.test(text);
  }
  if (outcomeId === "keep_as_acquaintance") {
    return /普通认识|普通朋友|保持.*(?:普通|专业|工作|业务).*联系|熟人|不发展.*浪漫|保持边界/.test(text);
  }
  if (outcomeId === "decline_romantic_direction") {
    return /拒绝|婉拒|不发展|不考虑.*(?:恋爱|浪漫|关系)|明确.*边界|不再.*接触/.test(text);
  }
  if (outcomeId === "begin_mutual_dating") {
    return /正式交往|开始交往|确定.*关系|成为.*伴侣|确认恋爱/.test(text);
  }
  if (outcomeId === "continue_slow_exploration") {
    return /继续.*(?:慢慢|了解|探索|相处)|保持.*探索|暂不.*确定/.test(text);
  }
  if (outcomeId === "end_romantic_exploration") {
    return /结束|停止|不再.*(?:浪漫|探索|发展)|回到.*(?:普通|朋友)|终止/.test(text);
  }
  if (outcomeId === "return_to_acquaintance") {
    return /回到.*(?:普通|熟人|朋友)|保持.*普通|不再.*浪漫/.test(text);
  }
  if (outcomeId === "make_shared_commitment_plan") {
    return /共同.*(?:计划|安排)|长期.*计划|承诺.*计划|生活安排/.test(text);
  }
  if (outcomeId === "delay_with_clear_conditions") {
    return /延后|暂缓|等待.*条件|明确.*条件|复核/.test(text);
  }
  if (outcomeId === "reassess_relationship_fit") {
    return /重新评估|重新审视|是否适合|关系.*匹配|适配/.test(text);
  }
  if (outcomeId === "maintain_committed_partnership_without_marriage") {
    return /稳定.*伴侣|继续.*交往|维持.*关系|不结婚|不进入婚姻/.test(text);
  }
  return true;
}

const ROMANCE_CHOICE_CONTRACTS: Record<string, Array<{
  outcomeId: string;
  text: (displayName: string) => string;
  impactSummary: string;
  decisionIntent: string;
}>> = {
  romance_new_connection: [
    {
      outcomeId: "continue_getting_to_know",
      text: (name) => `继续和${name}私下见面，在不打乱当前生活安排的前提下进一步了解彼此`,
      impactSummary: "继续了解",
      decisionIntent: "romance:explore:new_connection"
    },
    {
      outcomeId: "keep_as_acquaintance",
      text: (name) => `与${name}保持普通认识和必要联系，不把这次接触发展为浪漫关系`,
      impactSummary: "普通认识",
      decisionIntent: "romance:boundary:keep_acquaintance"
    },
    {
      outcomeId: "decline_romantic_direction",
      text: (name) => `明确婉拒与${name}发展浪漫关系，把注意力留给当前生活`,
      impactSummary: "拒绝发展",
      decisionIntent: "romance:decline:new_connection"
    }
  ],
  romance_connection_clarification: [
    {
      outcomeId: "begin_mutual_dating",
      text: (name) => `与${name}正式交往，确认彼此的恋爱关系`,
      impactSummary: "正式交往",
      decisionIntent: "romance:confirm:mutual_dating"
    },
    {
      outcomeId: "continue_slow_exploration",
      text: (name) => `继续慢慢了解${name}，保持探索但暂不确定关系`,
      impactSummary: "慢慢了解",
      decisionIntent: "romance:explore:slow_connection"
    },
    {
      outcomeId: "end_romantic_exploration",
      text: (name) => `结束与${name}的浪漫探索，回到普通朋友关系`,
      impactSummary: "结束探索",
      decisionIntent: "romance:end:romantic_exploration"
    }
  ],
  romance_exploration_resolution: [
    {
      outcomeId: "begin_mutual_dating",
      text: (name) => `与${name}正式交往，结束长期悬而未决的探索状态`,
      impactSummary: "正式交往",
      decisionIntent: "romance:confirm:mutual_dating"
    },
    {
      outcomeId: "return_to_acquaintance",
      text: (name) => `与${name}回到普通认识，不再保留浪漫期待`,
      impactSummary: "普通认识",
      decisionIntent: "romance:boundary:return_acquaintance"
    },
    {
      outcomeId: "end_romantic_exploration",
      text: (name) => `明确结束与${name}的浪漫探索，停止继续投入`,
      impactSummary: "结束探索",
      decisionIntent: "romance:end:romantic_exploration"
    }
  ],
  relationship_material_commitment_test: [
    {
      outcomeId: "make_shared_commitment_plan",
      text: (name) => `与${name}讨论并形成共同生活的筹备计划和长期安排`,
      impactSummary: "共同计划",
      decisionIntent: "romance:commit:shared_plan"
    },
    {
      outcomeId: "delay_with_clear_conditions",
      text: (name) => `与${name}明确延后承诺的现实条件和下一次复核时间`,
      impactSummary: "条件延后",
      decisionIntent: "romance:commit:bounded_delay"
    },
    {
      outcomeId: "reassess_relationship_fit",
      text: (name) => `与${name}重新评估长期生活是否真正适合彼此`,
      impactSummary: "重新评估",
      decisionIntent: "romance:commit:reassess_fit"
    }
  ],
  relationship_commitment_resolution: [
    {
      outcomeId: "make_shared_commitment_plan",
      text: (name) => `与${name}讨论并形成共同生活的筹备计划和长期安排`,
      impactSummary: "共同计划",
      decisionIntent: "romance:commit:shared_plan"
    },
    {
      outcomeId: "maintain_committed_partnership_without_marriage",
      text: (name) => `与${name}继续维持稳定伴侣关系，但不把婚姻设为默认目标`,
      impactSummary: "稳定相伴",
      decisionIntent: "romance:commit:stable_without_marriage"
    },
    {
      outcomeId: "reassess_relationship_fit",
      text: (name) => `与${name}重新评估长期生活是否真正适合彼此`,
      impactSummary: "重新评估",
      decisionIntent: "romance:commit:reassess_fit"
    }
  ]
};

export function groundedRomanceCharacter(node: Record<string, any>, eventIntentType?: string): Record<string, unknown> | undefined {
  const activeCharacters = Array.isArray(node?.narrativeMeta?.activeCharacters)
    ? node.narrativeMeta.activeCharacters as Array<Record<string, unknown>>
    : [];
  if (["romance_connection_clarification", "romance_exploration_resolution", "relationship_material_commitment_test", "relationship_commitment_resolution"].includes(eventIntentType || "")) {
    return activeCharacters.find((character) => (
      typeof character.personId === "string" && character.personId.trim().length > 0
    ));
  }
  if (eventIntentType !== "romance_new_connection") return undefined;
  const description = readNodeDescription(node);
  const candidate = activeCharacters.find((character) => (
    character.candidateOrdinal === 0
    && isValidRomanceDisplayName(character.displayName)
    && ["active_scene", "remote_contact"].includes(String(character.presenceMode || ""))
  ));
  if (!candidate) return undefined;
  const displayName = String(candidate.displayName).trim();
  if (!description.includes(displayName)) return undefined;
  const encounterType = String(candidate.encounterType || "");
  const encounterContext = String(candidate.encounterContext || "");
  const groundingEvidence = readString(candidate.groundingEvidence);
  const hasStructuredGrounding = encounterType === "new_connection"
    && ["personal", "mixed"].includes(encounterContext)
    && (!groundingEvidence || description.includes(groundingEvidence));
  if (hasStructuredGrounding) return candidate;
  if (encounterContext === "professional") return undefined;

  // Backward-compatible fallback for older model responses. New responses
  // should use the structured encounter fields above; prose regexes are only
  // a last resort and must not be the primary source of truth.
  const candidateParagraphs = description.split(/\n{2,}/u).filter((paragraph) => paragraph.includes(displayName));
  const candidateParagraph = candidateParagraphs.length ? candidateParagraphs.join("\n\n") : description;
  const hasEncounter = /新认识|第一次(?:见面|接触)|认识了|结识(?:了)?|相遇|(?:交换|互换)(?:了)?(?:微信|联系方式)|加了微信/.test(description);
  const hasExplicitPersonalConnection = /工作之外|从工作.{0,12}(?:延伸|聊到).{0,12}(?:个人|生活|兴趣)|聊.{0,16}(?:生活|兴趣|个人)|共同兴趣|个人阅读|生活理念|好感|浪漫|约会|发展对象|进一步了解彼此|久违的轻松/.test(candidateParagraph);
  const hasPrivateInvitation = /(?:私下|单独|周末).{0,12}(?:咖啡|吃饭|逛展|看展|活动|见面)|约.{0,8}(?:吃饭|逛展|看展|看电影)/.test(candidateParagraph);
  const businessOnlyInvitation = /(?:项目|合作|产品|业务|商业|技术|投资|融资|客户|创业|合伙|方案|合同).{0,24}(?:咖啡|见面|深谈)|(?:咖啡|见面|深谈).{0,24}(?:项目|合作|产品|业务|商业|技术|投资|融资|客户|创业|合伙|方案|合同)/.test(candidateParagraph);
  const professionalCandidate = /business|professional|colleague|client|partner|客户|同事|代理商|合作方|合伙人|投资人|创业者/.test(
    `${String(candidate.relation || "")} ${String(candidate.currentRole || "")}`
  );
  const groundedConnection = hasExplicitPersonalConnection
    || (hasPrivateInvitation && (!professionalCandidate || !businessOnlyInvitation));
  return hasEncounter && groundedConnection ? candidate : undefined;
}

export function repairDeterministicRomanceChoices<T extends Record<string, any>>(
  node: T,
  eventIntentType?: string,
  allowedOutcomeIds: string[] = []
): T {
  const contract = eventIntentType ? ROMANCE_CHOICE_CONTRACTS[eventIntentType] : undefined;
  if (!contract || contract.some((item) => !allowedOutcomeIds.includes(item.outcomeId))) return node;

  const groundedCharacter = groundedRomanceCharacter(node, eventIntentType);
  if (!groundedCharacter) return node;

  const normalized = normalizeSimulationNodeChoices(node);
  const currentOutcomes = normalized.choices.map((choice) => choice.eventOutcomeId || "");
  const alreadyValid = normalized.choices.length === contract.length
    && new Set(currentOutcomes).size === contract.length
    && contract.every((item) => currentOutcomes.includes(item.outcomeId))
    && normalized.choices.every((choice) => matchesRomanceOutcomeSemantics(choice.eventOutcomeId || "", choice.text));
  if (alreadyValid) return node;

  const displayName = readString(groundedCharacter.displayName) || "对方";
  const unused = [...normalized.choices];
  const choices = contract.map((item, index) => {
    const matchingIndex = unused.findIndex((choice) => choice.eventOutcomeId === item.outcomeId);
    const source = matchingIndex >= 0
      ? unused.splice(matchingIndex, 1)[0]
      : unused.shift();
    return {
      ...source,
      id: source?.id || String.fromCharCode(65 + index),
      text: item.text(displayName),
      impactSummary: item.impactSummary,
      decisionIntent: item.decisionIntent,
      eventOutcomeId: item.outcomeId,
      expectedWorldDeltaTypes: ["relationship_change"]
    };
  });

  return { ...node, choices };
}

export function getSimulationNodeValidationIssues(
  node: Record<string, any>,
  options: SimulationNodeValidationOptions = {}
): string[] {
  const issues: string[] = [];
  const choices = normalizeSimulationNodeChoices(node).choices;
  const requiredChoiceCount = node?.isEndingNode ? 1 : 3;

  if (!readNodeDescription(node)) issues.push("description");
  if (!hasCompleteAttributes(node?.attributes)) issues.push("attributes");
  if (choices.length !== requiredChoiceCount) issues.push("choices");
  if (
    options.requireExplicitChoiceText
    && choices.length === requiredChoiceCount
    && getInvalidExplicitChoiceTextIndexes(node).length > 0
  ) {
    issues.push("choiceText");
  }
  if (["romance_new_connection", "romance_connection_clarification", "romance_exploration_resolution", "relationship_material_commitment_test", "relationship_commitment_resolution"].includes(options.eventIntentType || "")
    && !groundedRomanceCharacter(node, options.eventIntentType)) {
    issues.push("romanceNarrativeGrounding");
  }

  if (options.allowedOutcomeIds?.length && choices.length === requiredChoiceCount) {
    const allowed = new Set(options.allowedOutcomeIds);
    const outcomeIds = choices.map((choice) => choice.eventOutcomeId || "");
    if (outcomeIds.some((outcomeId) => !outcomeId || !allowed.has(outcomeId))) {
      issues.push("eventOutcomeId");
    }
    if (new Set(outcomeIds.filter((outcomeId) => allowed.has(outcomeId))).size < 2) {
      issues.push("eventOutcomeCoverage");
    }
    if (["romance_new_connection", "romance_connection_clarification", "romance_exploration_resolution", "relationship_material_commitment_test", "relationship_commitment_resolution"].includes(options.eventIntentType || "")) {
      const validOutcomes = outcomeIds.filter((outcomeId) => allowed.has(outcomeId));
      if (validOutcomes.length !== allowed.size || new Set(validOutcomes).size !== allowed.size) {
        if (!issues.includes("eventOutcomeCoverage")) issues.push("eventOutcomeCoverage");
      }
      if (choices.some((choice) => !matchesRomanceOutcomeSemantics(choice.eventOutcomeId || "", choice.text))) {
        issues.push("romanceChoiceSemantics");
      }
    }
  }

  return issues;
}

export function normalizeSimulationNode<T extends Record<string, any>>(node: T, options: NormalizeOptions = {}): WithNormalizedNode<T> {
  const normalized = normalizeSimulationNodeChoices(node);
  const fallbackAge = options.fallbackAge ?? 20;

  const age = clampNumber(readNumber(normalized.age ?? normalized.currentAge, fallbackAge), options.minAge, options.maxAge);
  const ageInMonths = options.targetAgeInMonths ?? readNumber(normalized.ageInMonths, age * 12);
  const elapsedMonths = options.elapsedMonths ?? Math.max(0, ageInMonths - (options.previousAgeInMonths ?? ageInMonths));
  const rawRecovery = readString(normalized.narrativeMeta?.recoveryState);
  const recoveryState: RecoveryState = ["protected", "neutral", "depleted"].includes(rawRecovery) ? rawRecovery as RecoveryState : "neutral";
  const lifeIntensity = options.lifeIntensity || (["critical", "high_tension", "normal", "stable"].includes(normalized.narrativeMeta?.lifeIntensity)
    ? normalized.narrativeMeta.lifeIntensity as LifeIntensity
    : "normal");
  const worldDeltas = Array.isArray(normalized.narrativeMeta?.worldDeltas) ? normalized.narrativeMeta.worldDeltas : [];
  const arcSignals = Array.isArray(normalized.narrativeMeta?.arcSignals) ? normalized.narrativeMeta.arcSignals : [];
  const relationshipProposals = Array.isArray(normalized.narrativeMeta?.relationshipProposals)
    ? normalized.narrativeMeta.relationshipProposals
    : [];
  const episodeId = readString(normalized.narrativeMeta?.storyEpisode?.id) || `episode_${stableHash({ ageInMonths, title: normalized.title })}`;
  const title = readString(normalized.title) || "新的选择";
  const description = readNodeDescription(normalized) || "新的现实局面正在展开。";
  const descriptionParagraphs = Array.isArray(normalized.descriptionParagraphs)
    ? normalized.descriptionParagraphs.map(readString).filter(Boolean)
    : description.split(/\n\s*\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);

  return {
    ...normalized,
    age,
    ageInMonths,
    lifeStage: deriveLifeStage(age),
    stage: readString(normalized.stage) || "现实转折",
    title,
    description,
    descriptionParagraphs,
    attributes: normalizeAttributes(normalized.attributes),
    isEndingNode: Boolean(normalized.isEndingNode),
    narrativeMeta: {
      elapsedMonths,
      elapsedYears: elapsedMonths / 12,
      lifeIntensity,
      nodeMateriality: "decision_checkpoint",
      storyEpisode: {
        id: episodeId,
        pressureArcId: options.pressureArcId,
        startAgeInMonths: options.previousAgeInMonths ?? ageInMonths,
        endAgeInMonths: ageInMonths,
        internalTransitions: Array.isArray(normalized.narrativeMeta?.storyEpisode?.internalTransitions) ? normalized.narrativeMeta.storyEpisode.internalTransitions : [],
        decisionCheckpointId: readString(normalized.narrativeMeta?.storyEpisode?.decisionCheckpointId) || `checkpoint_${stableHash({ episodeId, title })}`,
        summary: readString(normalized.narrativeMeta?.storyEpisode?.summary) || description.slice(0, 80)
      },
      recoveryState,
      recoveryEvidence: Array.isArray(normalized.narrativeMeta?.recoveryEvidence) ? normalized.narrativeMeta.recoveryEvidence.filter((value: unknown): value is string => typeof value === "string") : [],
      arcSignals,
      activeCharacters: Array.isArray(normalized.narrativeMeta?.activeCharacters) ? normalized.narrativeMeta.activeCharacters : [],
      primaryActivity: normalized.narrativeMeta?.primaryActivity,
      worldDeltas,
      relationshipProposals
    }
  } as WithNormalizedNode<T>;
}
