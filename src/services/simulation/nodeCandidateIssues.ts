import type { CandidateRepairIssue, CandidateRepairIssueCode } from "./nodeCandidateTypes";

export const CANDIDATE_ISSUE = {
  selectedDecision: "SELECTED_DECISION_NOT_GROUNDED",
  forbiddenArcWrite: "FORBIDDEN_ARC_WRITE",
  repeatedAcuteHealth: "REPEATED_ACUTE_HEALTH_CRISIS",
  debtNarrative: "DEBT_NARRATIVE_CONFLICT",
  storyConsistency: "STORY_CONSISTENCY_FAILED",
  decisionGate: "DECISION_GATE_FAILED",
  healthEvidence: "HEALTH_OPERATION_EVIDENCE_MISSING"
} as const satisfies Record<string, CandidateRepairIssueCode>;

export function repairIssue(input: {
  code: CandidateRepairIssueCode;
  message: string;
  surfaces: string[];
  authorityContext?: Record<string, unknown>;
  strategy?: CandidateRepairIssue["strategy"];
}): CandidateRepairIssue {
  return {
    code: input.code,
    phase: "pre_settlement",
    strategy: input.strategy ?? "model_patch",
    surfaces: input.surfaces,
    message: input.message,
    authorityContext: input.authorityContext ?? {}
  };
}

export function uniqueRepairIssues(issues: CandidateRepairIssue[]): CandidateRepairIssue[] {
  const byCode = new Map<string, CandidateRepairIssue>();
  for (const issue of issues) {
    const existing = byCode.get(issue.code);
    if (!existing) {
      byCode.set(issue.code, issue);
      continue;
    }
    byCode.set(issue.code, {
      ...existing,
      surfaces: [...new Set([...existing.surfaces, ...issue.surfaces])],
      message: [...new Set([existing.message, issue.message])].join("；"),
      authorityContext: { ...existing.authorityContext, ...issue.authorityContext }
    });
  }
  return [...byCode.values()];
}
