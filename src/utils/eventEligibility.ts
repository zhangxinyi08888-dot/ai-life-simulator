import type {
  HistoryItem,
  LifeAttributes,
  NarrativeMode,
  PersonRelation,
  UserInitialData,
  WorldStateSnapshot
} from "../types";
import { normalizeDecisionIntent } from "./choicePreference";

export type EventHistoryCondition =
  | {
      type: "selected_intent_count";
      intentPrefixes: string[];
      minCount: number;
      withinNodes?: number;
      withinMonths?: number;
    }
  | {
      type: "elapsed_since_event";
      eventIds?: string[];
      semanticFamilies?: string[];
      minMonths: number;
      maxMonths?: number;
    }
  | {
      type: "attribute_trend";
      attribute: keyof LifeAttributes;
      direction: "improving" | "declining" | "stable";
      withinNodes: number;
      minimumDelta?: number;
    }
  | {
      type: "recent_mode_count";
      modes: NarrativeMode[];
      minCount: number;
      withinNodes: number;
    }
  | {
      type: "event_absent";
      eventIds?: string[];
      semanticFamilies?: string[];
      withinNodes?: number;
      withinMonths?: number;
    }
  | {
      type: "direction_reinforcement_count";
      minCount: number;
    }
  | {
      type: "pressure_arc_state";
      phasePolicyIds?: string[];
      phaseIds?: string[];
      statuses?: Array<"active" | "stabilizing" | "resolved">;
    };

export type RequiredContextKey =
  | "career_active"
  | "career_or_creation_direction"
  | "active_project_context"
  | "identified_life_constraint"
  | "confirmed_partner"
  | "confirmed_family"
  | "confirmed_friend_or_colleague"
  | "financial_state_available"
  | "debt_present"
  | "learning_or_creation_direction"
  | "health_recovery_context";

export interface EventEligibilityDefinition {
  historyConditionGroups?: EventHistoryCondition[][];
  requiredContextGroups?: RequiredContextKey[][];
}

export interface EventEligibilityInput {
  event: EventEligibilityDefinition;
  attribs: LifeAttributes;
  userData: Partial<UserInitialData>;
  age: number;
  history: HistoryItem[];
  answers?: unknown;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("\n");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(textOf).join("\n");
  return "";
}

function userContextText(userData: Partial<UserInitialData>, answers?: unknown): string {
  return [
    userData.currentSituation,
    userData.regressionSituation,
    userData.regressionChoices,
    userData.milestoneCareer,
    userData.milestoneRelationship,
    userData.milestoneOther,
    ...(userData.milestones || []).flatMap((item) => [item.title, item.content]),
    textOf(answers)
  ].filter(Boolean).join("\n");
}

function itemAgeInMonths(item: HistoryItem): number {
  return item.ageInMonths ?? item.age * 12;
}

function currentAgeInMonths(age: number, history: HistoryItem[]): number {
  const latest = history[history.length - 1];
  return Math.max(age * 12, latest ? itemAgeInMonths(latest) : age * 12);
}

function selectedIntent(item: HistoryItem): string {
  if (item.selectedDecisionIntent) return item.selectedDecisionIntent;
  const selected = item.choices.find((choice) => (
    choice.text === item.selectedChoice || item.selectedChoice.includes(choice.text)
  ));
  return selected
    ? normalizeDecisionIntent(selected)
    : normalizeDecisionIntent({ id: "legacy", text: item.selectedChoice, impactSummary: "旧历史" });
}

function windowedHistory(
  history: HistoryItem[],
  nowInMonths: number,
  withinNodes?: number,
  withinMonths?: number
): HistoryItem[] {
  let result = typeof withinNodes === "number" ? history.slice(-withinNodes) : history;
  if (typeof withinMonths === "number") {
    result = result.filter((item) => {
      const elapsed = nowInMonths - itemAgeInMonths(item);
      return elapsed >= 0 && elapsed <= withinMonths;
    });
  }
  return result;
}

export function evaluateHistoryCondition(
  condition: EventHistoryCondition,
  history: HistoryItem[],
  attribs: LifeAttributes,
  age: number
): boolean {
  const nowInMonths = currentAgeInMonths(age, history);

  if (condition.type === "selected_intent_count") {
    const window = windowedHistory(history, nowInMonths, condition.withinNodes, condition.withinMonths);
    const count = window.filter((item) => {
      const intent = selectedIntent(item);
      return condition.intentPrefixes.some((prefix) => intent.startsWith(prefix) || intent.includes(prefix));
    }).length;
    return count >= condition.minCount;
  }

  if (condition.type === "elapsed_since_event") {
    const matches = history.filter((item) => (
      condition.eventIds?.includes(item.eventMeta?.eventId || "")
      || condition.semanticFamilies?.includes(item.eventMeta?.eventSemanticFamily || "")
    ));
    return matches.some((item) => {
      const elapsed = nowInMonths - itemAgeInMonths(item);
      return elapsed >= condition.minMonths
        && (typeof condition.maxMonths !== "number" || elapsed <= condition.maxMonths);
    });
  }

  if (condition.type === "attribute_trend") {
    const window = history.slice(-condition.withinNodes);
    if (window.length === 0) return false;
    const delta = attribs[condition.attribute] - window[0].attributes[condition.attribute];
    const minimum = condition.minimumDelta ?? 1;
    if (condition.direction === "improving") return delta >= minimum;
    if (condition.direction === "declining") return delta <= -minimum;
    return Math.abs(delta) < minimum;
  }

  if (condition.type === "recent_mode_count") {
    return history.slice(-condition.withinNodes)
      .filter((item) => condition.modes.includes(item.eventMeta?.eventMode as NarrativeMode)).length >= condition.minCount;
  }

  if (condition.type === "direction_reinforcement_count") {
    const snapshot = [...history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot;
    return Boolean(snapshot?.directionArcs.some((arc) => arc.userReinforcementCount >= condition.minCount));
  }

  if (condition.type === "pressure_arc_state") {
    const snapshot = [...history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot;
    return Boolean(snapshot?.pressureArcs.some((arc) => (
      (!condition.phasePolicyIds || condition.phasePolicyIds.includes(arc.phasePolicyId))
      && (!condition.phaseIds || condition.phaseIds.includes(arc.phaseId))
      && (!condition.statuses || condition.statuses.includes(arc.status))
    )));
  }

  const window = windowedHistory(history, nowInMonths, condition.withinNodes, condition.withinMonths);
  return !window.some((item) => (
    condition.eventIds?.includes(item.eventMeta?.eventId || "")
    || condition.semanticFamilies?.includes(item.eventMeta?.eventSemanticFamily || "")
  ));
}

export function matchesHistoryConditionGroups(
  groups: EventHistoryCondition[][] | undefined,
  history: HistoryItem[],
  attribs: LifeAttributes,
  age: number
): boolean {
  if (!groups || groups.length === 0) return true;
  return groups.some((group) => group.length > 0 && group.every((condition) => (
    evaluateHistoryCondition(condition, history, attribs, age)
  )));
}

function latestWorldState(history: HistoryItem[]): WorldStateSnapshot | undefined {
  return [...history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot;
}

function hasReliablePerson(
  snapshot: WorldStateSnapshot | undefined,
  relations: PersonRelation[],
  minimumConfidence: number
): boolean {
  return Boolean(snapshot?.people.some((person) => (
    relations.includes(person.relation)
    && person.source !== "model_inferred"
    && person.confidence >= minimumConfidence
    && !["distant", "deceased"].includes(person.lifeStatus)
  )));
}

function hasActiveDirection(snapshot: WorldStateSnapshot | undefined, pattern: RegExp): boolean {
  return Boolean(snapshot?.directionArcs.some((arc) => (
    ["active", "background"].includes(arc.status)
    && pattern.test(`${arc.directionType} ${arc.summary}`)
  )));
}

function historyText(history: HistoryItem[], count = 8): string {
  return history.slice(-count).map((item) => (
    `${item.title}\n${item.description}\n${item.selectedChoice}\n${selectedIntent(item)}`
  )).join("\n");
}

export function matchesRequiredContext(
  key: RequiredContextKey,
  input: Omit<EventEligibilityInput, "event">
): boolean {
  const snapshot = latestWorldState(input.history);
  const userText = userContextText(input.userData, input.answers);
  const recentText = historyText(input.history);
  const combinedText = `${userText}\n${recentText}`;

  if (key === "career_active") {
    return Boolean(
      input.history.slice(-3).some((item) => item.narrativeMeta?.primaryActivity?.domain === "career")
      || snapshot?.careerSummary
      || /工作|职业|岗位|公司|组织|项目|研究|创业|经营|写作|创作|客户|产品/.test(userText)
    );
  }
  if (key === "career_or_creation_direction") {
    return hasActiveDirection(snapshot, /career|creation|创业|职业|工作|项目|研究|写作|创作|产品|经营/i);
  }
  if (key === "active_project_context") {
    return hasActiveDirection(snapshot, /project|creation|research|项目|作品|研究|写作|创作|产品/i)
      && input.history.slice(-8).some((item) => /project|creation|research|项目|作品|研究|写作|创作|产品/i.test(selectedIntent(item)));
  }
  if (key === "identified_life_constraint") {
    return /困局|限制|冲突|难以|无法|压力|异地|通勤|地点|城市|债务|照护|失业|裁员|不稳定|受限|瓶颈/.test(combinedText);
  }
  if (key === "confirmed_partner") {
    return hasReliablePerson(snapshot, ["partner"], 0.75)
      || /丈夫|妻子|老公|老婆|现任伴侣|现任男友|现任女友|未婚夫|未婚妻|已婚|正在恋爱|恋爱中/.test(userText);
  }
  if (key === "confirmed_family") {
    return hasReliablePerson(snapshot, ["parent", "grandparent", "child", "sibling"], 0.75)
      || /父母|父亲|母亲|爸爸|妈妈|孩子|女儿|儿子|兄弟|姐妹|祖父|祖母|家庭照护/.test(userText);
  }
  if (key === "confirmed_friend_or_colleague") {
    return hasReliablePerson(snapshot, ["friend", "colleague", "mentor"], 0.7);
  }
  if (key === "financial_state_available") return Boolean(input.history[input.history.length - 1]?.financialState);
  if (key === "debt_present") {
    return (input.history[input.history.length - 1]?.financialState?.totalDebtWan ?? 0) > 0;
  }
  if (key === "learning_or_creation_direction") {
    return hasActiveDirection(snapshot, /learning|creation|research|study|学习|技能|研究|写作|创作|艺术|手艺|作品/i)
      || /学习|技能|研究|写作|创作|艺术|摄影|手艺|作品|练习/.test(userText);
  }
  return input.history.slice(-8).some((item) => (
    ["health_system_warning", "health_forced_pause", "health_recovery_observation"].includes(item.eventMeta?.eventId || "")
    || item.eventMeta?.eventSemanticFamily?.startsWith("health_recovery")
    || item.worldStateSnapshot?.pressureArcs.some((arc) => (
      arc.phasePolicyId === "health_crisis_v1" && ["recovery", "operation"].includes(arc.phaseId)
    ))
  ));
}

export function matchesRequiredContextGroups(
  groups: RequiredContextKey[][] | undefined,
  input: Omit<EventEligibilityInput, "event">
): boolean {
  if (!groups || groups.length === 0) return true;
  return groups.some((group) => group.length > 0 && group.every((key) => matchesRequiredContext(key, input)));
}

export function evaluateEventEligibility(input: EventEligibilityInput): boolean {
  const commonInput = {
    attribs: input.attribs,
    userData: input.userData,
    age: input.age,
    history: input.history,
    answers: input.answers
  };
  return matchesRequiredContextGroups(input.event.requiredContextGroups, commonInput)
    && matchesHistoryConditionGroups(input.event.historyConditionGroups, input.history, input.attribs, input.age);
}

export function resolveSelectedDecisionIntent(item: HistoryItem): string {
  return selectedIntent(item);
}
