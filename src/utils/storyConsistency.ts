import { LifeStage, PersonState, SimulationNode } from "../types";
import { deriveLifeStage } from "./timelineAdvance";

export type StoryConsistencyIssueCode =
  | "timeline_progression_invalid"
  | "life_stage_mismatch"
  | "deceased_character_active"
  | "character_timeline_conflict"
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
  return issues;
}

export function containsForbiddenArcWrite(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenArcWrite);
  const forbidden = new Set(["nextPhaseId", "nextPressureArcStatus", "foregroundPressureArcId", "phaseCheckpointCount"]);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => forbidden.has(key) || containsForbiddenArcWrite(nested));
}
