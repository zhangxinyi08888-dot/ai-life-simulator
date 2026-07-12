import {
  HistoryItem,
  OngoingProcess,
  OutcomePlausibilityContext,
  PersonState,
  SimulationNode,
  UserInitialData,
  WorldDelta
} from "../types";

const RELATIONSHIP_TERMS = ["恋爱", "交往", "伴侣", "同居", "相亲", "婚", "爱人", "对象"];
const PREGNANCY_TERMS = ["怀孕", "妊娠", "备孕", "孕期", "待产"];
const EXCEPTIONAL_SUPPORT_TERMS = ["辅助生殖", "试管", "生殖医学", "医疗评估", "医生评估", "冻卵", "供卵", "长期治疗"];

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function supportingRelationshipFacts(userData: Partial<UserInitialData>, history: HistoryItem[]): string[] {
  return [
    userData.milestoneRelationship,
    userData.regressionSituation,
    userData.regressionChoices,
    ...history.slice(-5).flatMap((item) => [item.description, item.selectedChoice])
  ].filter((value): value is string => Boolean(value && includesAny(value, RELATIONSHIP_TERMS)));
}

function exceptionalSupportFacts(texts: string[]): string[] {
  return texts.filter((text) => includesAny(text, EXCEPTIONAL_SUPPORT_TERMS));
}

function pregnancySubjectAge(
  people: PersonState[],
  worldDeltas: WorldDelta[],
  ongoingProcesses: OngoingProcess[],
  protagonistAge: number
): { explicit?: number; estimated?: [number, number] } {
  const started = worldDeltas.find((delta) => delta.type === "process_started" && delta.process.type === "pregnancy");
  const subjectIds = started?.type === "process_started"
    ? started.process.subjectPersonIds
    : ongoingProcesses.find((process) => process.type === "pregnancy" && process.status === "active")?.subjectPersonIds || [];
  if (subjectIds.includes("protagonist")) return { explicit: protagonistAge };
  const person = subjectIds.map((id) => people.find((item) => item.id === id)).find(Boolean);
  return person ? { explicit: person.explicitAge, estimated: person.estimatedAgeRange } : {};
}

export function buildOutcomePlausibilityGuidance(input: {
  targetAgeInMonths: number;
  people: PersonState[];
  ongoingProcesses?: OngoingProcess[];
  history: HistoryItem[];
  userData: Partial<UserInitialData>;
}): string[] {
  const age = Math.floor(input.targetAgeInMonths / 12);
  const guidance = [
    "少见不等于错误；只在具体结果生成后判断 ordinary、uncommon 或 exceptional。",
    "结婚、晚婚和再婚不设硬 maxAge，用户明确选择的关系方向不得被年龄替换。",
    "妊娠等生物过程必须明确 subjectPersonId，并结合该人物年龄和医疗支持判断，而不是用主角年龄代替。"
  ];
  if (age >= 48) guidance.push("当前主角接近或超过50岁：结婚结果允许成立；若属于本轮新结果，应与既往关系背景自然衔接。 ");
  return guidance;
}

export function evaluateOutcomePlausibility(input: {
  candidateNode: SimulationNode;
  worldDeltas: WorldDelta[];
  userData: Partial<UserInitialData>;
  history: HistoryItem[];
  people: PersonState[];
  ongoingProcesses?: OngoingProcess[];
  targetAgeInMonths: number;
}): OutcomePlausibilityContext {
  const age = Math.floor(input.targetAgeInMonths / 12);
  const currentText = [input.candidateNode.title, input.candidateNode.description, ...input.candidateNode.choices.map((choice) => choice.text)].join("\n");
  const historicalTexts = [
    input.userData.milestoneRelationship,
    input.userData.regressionSituation,
    input.userData.regressionChoices,
    ...input.history.slice(-5).flatMap((item) => [item.description, item.selectedChoice])
  ].filter((value): value is string => Boolean(value));
  const supportingFacts: string[] = [];
  const reasons: string[] = [];
  let tier: OutcomePlausibilityContext["tier"] = "ordinary";
  let requiresExplicitBasis = false;

  if (age >= 48 && /结婚|领证|婚礼|再婚/.test(currentText)) {
    tier = "uncommon";
    reasons.push("接近或超过50岁的婚姻结果较少见，但允许成立。 ");
    supportingFacts.push(...supportingRelationshipFacts(input.userData, input.history));
    if (/交往多年|长期伴侣|共同生活多年|多年关系|再婚|多年后/.test(currentText)) supportingFacts.push(currentText);
  }

  const hasPregnancyOutcome = includesAny(currentText, PREGNANCY_TERMS)
    || input.worldDeltas.some((delta) => delta.type === "process_started" && delta.process.type === "pregnancy");
  if (hasPregnancyOutcome) {
    const activePregnancy = (input.ongoingProcesses || []).find((process) => process.type === "pregnancy" && process.status === "active");
    const startedPregnancy = input.worldDeltas.find((delta) => delta.type === "process_started" && delta.process.type === "pregnancy");
    const subjectAge = pregnancySubjectAge(input.people, input.worldDeltas, input.ongoingProcesses || [], age);
    const support = exceptionalSupportFacts([
      currentText,
      ...historicalTexts,
      ...(activePregnancy?.exceptionalBasis || []),
      ...(startedPregnancy?.type === "process_started" ? startedPregnancy.process.exceptionalBasis || [] : [])
    ]);
    if ((subjectAge.explicit ?? 0) >= 50 || (subjectAge.estimated?.[0] ?? 0) >= 50) {
      tier = "exceptional";
      requiresExplicitBasis = true;
      reasons.push("妊娠主体年龄处于极低概率范围，需要明确医疗或已建立事实。 ");
      supportingFacts.push(...support);
    } else if ((subjectAge.explicit ?? 0) >= 45 || (subjectAge.estimated?.[1] ?? 0) >= 50 || (age >= 50 && !subjectAge.explicit && !subjectAge.estimated)) {
      tier = "uncommon";
      reasons.push("妊娠主体年龄不明确或处于较低概率范围，需要交代人物年龄与现实条件。 ");
      supportingFacts.push(...support, ...historicalTexts.filter((text) => /妻子|伴侣|爱人/.test(text)));
    }
  }

  return {
    tier,
    reasons: [...new Set(reasons.map((item) => item.trim()))],
    supportingFacts: [...new Set(supportingFacts.map((item) => item.trim()).filter(Boolean))],
    requiresExplicitBasis
  };
}
