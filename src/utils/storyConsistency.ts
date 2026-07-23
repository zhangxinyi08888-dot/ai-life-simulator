import { LifeStage, PersonState, SimulationNode, WorldStateSnapshot } from "../types";
import { deriveLifeStage } from "./timelineAdvance";

export type StoryConsistencyIssueCode =
  | "timeline_progression_invalid"
  | "life_stage_mismatch"
  | "deceased_character_active"
  | "character_timeline_conflict"
  | "family_authority_conflict"
  | "age_script_funneling"
  | "arc_state_write_violation";

export interface StoryConsistencyIssue {
  code: StoryConsistencyIssueCode;
  severity: "warning" | "error";
  message: string;
}

const FUNNEL_TERMS = ["退休", "养老", "接受照护", "退出", "回忆过去", "安享晚年"];

export function validateStoryConsistency(input: {
  node: SimulationNode;
  targetAgeInMonths: number;
  people: PersonState[];
  worldState?: WorldStateSnapshot;
}): StoryConsistencyIssue[] {
  const issues: StoryConsistencyIssue[] = [];
  const expectedAge = Math.floor(input.targetAgeInMonths / 12);
  if (input.node.ageInMonths !== input.targetAgeInMonths || input.node.age !== expectedAge) {
    issues.push({ code: "timeline_progression_invalid", severity: "error", message: "节点时间与代码确定的目标时间不一致。" });
  }
  const expectedStage: LifeStage = deriveLifeStage(expectedAge);
  if (input.node.lifeStage !== expectedStage) {
    issues.push({ code: "life_stage_mismatch", severity: "error", message: "内部 chronological band 与目标年龄不一致。" });
  }

  for (const character of input.node.narrativeMeta?.activeCharacters || []) {
    const person = character.personId ? input.people.find((item) => item.id === character.personId) : undefined;
    if (person?.lifeStatus === "deceased" && (character.presenceMode === "active_scene" || character.presenceMode === "remote_contact")) {
      issues.push({ code: "deceased_character_active", severity: "error", message: `${person.displayName || person.relation}已故，不能作为现实行动者出现。` });
    }
    if (person?.estimatedAgeRange?.[0] && person.estimatedAgeRange[0] >= 105 && person.lifeStatus === "unknown" && character.currentRole?.includes("工作")) {
      issues.push({ code: "character_timeline_conflict", severity: "error", message: `${person.relation}估算年龄超过105岁，缺少明确长寿事实时不能默认仍在工作。` });
    }
  }

  if (!input.node.isEndingNode && input.node.choices.length >= 2 && input.node.choices.every((choice) => FUNNEL_TERMS.some((term) => choice.text.includes(term)))) {
    issues.push({ code: "age_script_funneling", severity: "error", message: "非终章选项全部导向退休、照护、退出或回忆，缺少继续面向未来的方向。" });
  }

  const parentSentences = input.node.description
    .split(/(?<=[。！？；])/u)
    .filter((sentence) => /父母|父亲|母亲|爸爸|妈妈/.test(sentence));
  for (const relationship of input.worldState?.familyRelationships || []) {
    const careerStance = relationship.topicStances.find((stance) => stance.topic === "career_change")?.stance;
    for (const sentence of parentSentences) {
      const oppositionText = sentence.replace(/不(?:会|再)?要求.{0,16}(?:求稳|留下|拒绝|放弃)/gu, "");
      const assertsOpposition = /反对|不同意|不支持|阻止|要求.{0,16}(?:求稳|留下|拒绝|放弃)/.test(oppositionText);
      const assertsRelaxation = /不再.{0,8}反对|从反对转为|(?:态度|语气|口风|立场).{0,12}(?:缓和|软化|松动|转为|转变|改变|好转)|(?:逐渐|开始|慢慢|终于).{0,12}(?:理解|接受|认可|支持)|(?:没|不).{0,4}(?:那么|再|像以前那样).{0,6}(?:反对|强硬)|(?:默认|勉强接受)/.test(sentence);
      const assertsSupport = /明确支持|表示支持|赞成|如约.{0,12}(?:帮助|帮忙)|愿意.{0,12}(?:帮助|帮忙)/.test(sentence);
      const contradictsStance = careerStance === "supportive" && assertsOpposition
        || careerStance === "opposed" && (assertsRelaxation || assertsSupport);
      const contradictsPracticalSupport = relationship.practicalSupport === "available"
        && /不(?:愿|会|再).{0,12}(?:帮助|帮忙)|没有实际帮忙|拒绝.{0,12}(?:帮助|帮忙)/.test(sentence)
        || relationship.practicalSupport === "unavailable"
        && /如约.{0,12}(?:帮助|帮忙)|愿意.{0,12}(?:帮助|帮忙)|提供了.{0,12}帮助/.test(sentence);
      if (contradictsStance || contradictsPracticalSupport) {
        issues.push({
          code: "family_authority_conflict",
          severity: "error",
          message: `父母正文与当前权威家庭状态冲突：${sentence.trim()} 未经已接受的 parent_topic_stance 不得宣告立场变化。`
        });
        break;
      }
    }
  }
  return issues;
}

export function containsForbiddenArcWrite(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenArcWrite);
  const forbidden = new Set(["nextPhaseId", "nextPressureArcStatus", "foregroundPressureArcId", "phaseCheckpointCount"]);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => forbidden.has(key) || containsForbiddenArcWrite(nested));
}
