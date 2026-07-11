import { LifeStage, OngoingProcess, OutcomePlausibilityContext, PersonState, ProcessTransitionRequirement, SimulationNode } from "../types";
import { deriveLifeStage } from "./timelineAdvance";
import { extractPregnancyMonths, processElapsedMonths, unresolvedProcessRequirements } from "./ongoingProcess";

export type StoryConsistencyIssueCode =
  | "timeline_progression_invalid"
  | "life_stage_mismatch"
  | "deceased_character_active"
  | "character_timeline_conflict"
  | "ongoing_process_time_frozen"
  | "ongoing_process_end_overrun"
  | "ongoing_process_state_conflict"
  | "outcome_plausibility_context_missing"
  | "exceptional_outcome_unsupported"
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
  ongoingProcesses?: OngoingProcess[];
  requiredProcessTransitions?: ProcessTransitionRequirement[];
  processIssues?: string[];
  outcomePlausibility?: OutcomePlausibilityContext;
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

  const worldDeltas = input.node.narrativeMeta?.worldDeltas || [];
  const mentionsPregnancy = /怀孕|妊娠|孕期|待产/.test(input.node.description);
  const hasActivePregnancy = (input.ongoingProcesses || []).some((process) => process.type === "pregnancy" && process.status === "active");
  const startsPregnancy = worldDeltas.some((delta) => delta.type === "process_started" && delta.process.type === "pregnancy");
  if (mentionsPregnancy && !hasActivePregnancy && !startsPregnancy) {
    issues.push({
      code: "ongoing_process_state_conflict",
      severity: "error",
      message: "正文引入了妊娠过程，但没有返回 process_started delta。"
    });
  }
  const unresolved = unresolvedProcessRequirements(input.requiredProcessTransitions || [], worldDeltas);
  for (const requirement of unresolved) {
    issues.push({
      code: "ongoing_process_end_overrun",
      severity: "error",
      message: `${requirement.processType} 已跨过预计结束时间，必须在本轮完成或中断。`
    });
  }
  const processNarrative = [
    input.node.description,
    ...(input.node.narrativeMeta?.storyEpisode.internalTransitions || []).map((transition) => transition.summary)
  ].join("\n");
  const transitionTerms: Record<string, RegExp> = {
    pregnancy: /出生|生产|分娩|妊娠结束|孕期结束|流产|终止|中断/,
    recovery: /康复|恢复|治疗结束|中断|转入长期管理/,
    education: /毕业|结业|肄业|退学|中断|完成学业/,
    contract_transition: /交接完成|正式入职|合同结束|解约|中断/,
    relocation: /搬迁完成|入住|迁居|取消搬迁|中断/,
    caregiving: /照护结束|转由|长期照护|中断|安置完成/
  };
  for (const requirement of input.requiredProcessTransitions || []) {
    if (unresolved.some((item) => item.processId === requirement.processId)) continue;
    const matcher = transitionTerms[requirement.processType];
    if (matcher && !matcher.test(processNarrative)) {
      issues.push({
        code: "ongoing_process_state_conflict",
        severity: "error",
        message: `${requirement.processType} 的结构化状态已经变化，但正文或 Episode 没有体现。`
      });
    }
  }
  for (const process of input.ongoingProcesses || []) {
    if (process.status !== "active" || process.type !== "pregnancy") continue;
    const statedMonths = extractPregnancyMonths(input.node.description);
    const elapsedMonths = processElapsedMonths(process, input.targetAgeInMonths);
    if (statedMonths != null && Math.abs(statedMonths - elapsedMonths) > 1) {
      issues.push({
        code: "ongoing_process_time_frozen",
        severity: "error",
        message: `妊娠过程已经持续${elapsedMonths}个月，正文仍写为${statedMonths}个月。`
      });
    }
  }
  for (const processIssue of input.processIssues || []) {
    issues.push({ code: "ongoing_process_state_conflict", severity: "error", message: processIssue });
  }

  if (input.outcomePlausibility?.tier === "exceptional" && input.outcomePlausibility.supportingFacts.length === 0) {
    issues.push({
      code: "exceptional_outcome_unsupported",
      severity: "error",
      message: input.outcomePlausibility.reasons.join("；") || "低概率结果缺少明确成立依据。"
    });
  } else if (input.outcomePlausibility?.tier === "uncommon" && input.outcomePlausibility.supportingFacts.length === 0) {
    issues.push({
      code: "outcome_plausibility_context_missing",
      severity: "warning",
      message: input.outcomePlausibility.reasons.join("；") || "少见结果需要更自然的历史背景。"
    });
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
