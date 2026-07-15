import assert from "node:assert/strict";
import { DEFAULT_REPORT_INVITATION_POLICY } from "../config/reportInvitationPolicy";
import { HistoryItem, LifeIntensity, SimulationNode } from "../types";
import { findStableEpisodeStartChoiceCount, evaluateReportInvitation } from "./reportInvitationDecision";

const attributes = { happiness: 60, intelligence: 70, wealth: 55, relation: 65, health: 68 };

function node(input: {
  title: string;
  intensity?: LifeIntensity;
  arcId?: string;
  transitionAction?: SimulationNode["committedArcMeta"] extends infer T ? T extends { transitionAction?: infer A } ? A : never : never;
  foregroundArcId?: string;
  invitation?: SimulationNode["reportInvitation"];
}): SimulationNode {
  return {
    age: 35,
    ageInMonths: 35 * 12,
    stage: "现实抉择",
    title: input.title,
    description: `${input.title}形成了明确而可验证的现实结果。`,
    choices: [
      { id: "A", text: "继续推进", impactSummary: "继续前行" },
      { id: "B", text: "稳定观察", impactSummary: "保持节奏" },
      { id: "C", text: "寻找合作", impactSummary: "共同承担" }
    ],
    attributes,
    isEndingNode: false,
    narrativeMeta: {
      elapsedMonths: 12,
      elapsedYears: 1,
      lifeIntensity: input.intensity ?? "stable",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: {
        id: `episode-${input.title}`,
        startAgeInMonths: 34 * 12,
        endAgeInMonths: 35 * 12,
        internalTransitions: [],
        decisionCheckpointId: `checkpoint-${input.title}`,
        summary: input.title
      },
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [],
      worldDeltas: []
    },
    committedArcMeta: input.arcId ? {
      pressureArcId: input.arcId,
      phaseId: "operation",
      transitionAction: input.transitionAction ?? "resolve"
    } : undefined,
    worldStateSnapshot: {
      people: [],
      directionArcs: [],
      pressureArcs: input.foregroundArcId ? [{
        id: input.foregroundArcId,
        eventId: "event",
        eventIntentType: "test",
        phasePolicyId: "generic_pressure_v1",
        phaseId: "response",
        status: "active",
        startedAtAgeInMonths: 30 * 12,
        phaseStartedAtAgeInMonths: 34 * 12,
        phaseCheckpointCount: 1,
        totalCheckpointCount: 2,
        unresolvedSummary: "测试压力"
      }] : [],
      foregroundPressureArcId: input.foregroundArcId,
      version: 1
    },
    reportInvitation: input.invitation
  };
}

function historyItem(value: SimulationNode, selectedChoice = "继续推进"): HistoryItem {
  return { ...value, selectedChoice };
}

const resolvedArc = {
  id: "arc-one",
  eventId: "event",
  eventIntentType: "test",
  phasePolicyId: "generic_pressure_v1",
  phaseId: "operation",
  status: "resolved" as const,
  startedAtAgeInMonths: 30 * 12,
  phaseStartedAtAgeInMonths: 34 * 12,
  phaseCheckpointCount: 1,
  totalCheckpointCount: 5,
  unresolvedSummary: "测试压力"
};

const matchingEvidence = {
  worldDeltas: [],
  arcSignals: [{ type: "pressure_resolved", pressureArcId: "arc-one", evidence: "形成了明确而可验证的现实结果", confidence: 1 }]
};

const baseEvaluation = {
  candidateNode: node({ title: "阶段结果", arcId: "arc-one" }),
  history: [] as HistoryItem[],
  completedChoiceCount: 12,
  pressureArcTransition: { action: "resolve" as const, previousPhaseId: "operation", nextArcState: resolvedArc, reasonCodes: ["pressure-resolved"] },
  acceptedOutcome: matchingEvidence,
  policy: DEFAULT_REPORT_INVITATION_POLICY,
  simulationSeed: "seed",
  branchFingerprint: "branch"
};

const arcInvitation = evaluateReportInvitation(baseEvaluation);
assert.equal(arcInvitation.shouldInvite, true);
assert.equal(arcInvitation.invitation?.reason, "arc_resolved");
assert.equal(arcInvitation.invitation?.triggerKey, "arc:arc-one");

const wrongArcEvidence = evaluateReportInvitation({
  ...baseEvaluation,
  acceptedOutcome: {
    worldDeltas: [],
    arcSignals: [{ type: "pressure_resolved", pressureArcId: "other-arc", evidence: "形成了明确而可验证的现实结果", confidence: 1 }]
  }
});
assert.equal(wrongArcEvidence.shouldInvite, false);

const noEvidence = evaluateReportInvitation({ ...baseEvaluation, acceptedOutcome: { worldDeltas: [], arcSignals: [] } });
assert.equal(noEvidence.shouldInvite, false);
assert.equal(noEvidence.reasonCodes.includes("resolution-evidence-missing"), true);

const stableHistory = [historyItem(node({ title: "稳定生活一" }))];
const stableInvitation = evaluateReportInvitation({
  candidateNode: node({ title: "稳定生活二" }),
  history: stableHistory,
  completedChoiceCount: 15,
  pressureArcTransition: { action: "stay", reasonCodes: ["no-pressure-arc"] },
  acceptedOutcome: { worldDeltas: [], arcSignals: [] },
  policy: DEFAULT_REPORT_INVITATION_POLICY,
  simulationSeed: "seed",
  branchFingerprint: "stable-branch"
});
assert.equal(stableInvitation.shouldInvite, true);
assert.equal(stableInvitation.invitation?.triggerKey, "stable:0");

const declinedStableNode = node({
  title: "稳定生活一",
  invitation: {
    id: "invite-stable",
    status: "declined",
    reason: "stable_window",
    triggerKey: "stable:0",
    completedChoiceCount: 15,
    declinedAtChoiceCount: 15
  }
});
const repeatedStable = evaluateReportInvitation({
  ...stableInvitationInput(declinedStableNode),
  candidateNode: node({ title: "仍然稳定" })
});
assert.equal(repeatedStable.shouldInvite, false);

const resolvedInvitationNode = node({
  title: "Arc 已解决",
  arcId: "arc-one",
  invitation: {
    id: "invite-arc",
    status: "declined",
    reason: "arc_resolved",
    triggerKey: "arc:arc-one",
    completedChoiceCount: 12,
    pressureArcId: "arc-one",
    declinedAtChoiceCount: 12
  }
});
const stableAfterResolvedArc = evaluateReportInvitation({
  ...stableInvitationInput(resolvedInvitationNode),
  candidateNode: node({ title: "解决后的稳定生活" })
});
assert.equal(stableAfterResolvedArc.shouldInvite, false);
assert.equal(stableAfterResolvedArc.reasonCodes.includes("stable-stage-already-invited"), true);

const tension = historyItem(node({ title: "新的高张力阶段", intensity: "high_tension" }));
const firstStableAfterTension = historyItem(node({ title: "重新稳定一" }));
const newStableStage = evaluateReportInvitation({
  candidateNode: node({ title: "重新稳定二" }),
  history: [historyItem(declinedStableNode), tension, firstStableAfterTension],
  completedChoiceCount: 18,
  pressureArcTransition: { action: "stay", reasonCodes: ["no-pressure-arc"] },
  acceptedOutcome: { worldDeltas: [], arcSignals: [] },
  policy: DEFAULT_REPORT_INVITATION_POLICY,
  simulationSeed: "seed",
  branchFingerprint: "new-stable-stage"
});
assert.equal(newStableStage.shouldInvite, true);
assert.equal(newStableStage.invitation?.triggerKey, "stable:2");

const clearedForegroundResolvedNode = historyItem(node({ title: "已清空前台 Arc", arcId: "arc-boundary" }));
assert.equal(findStableEpisodeStartChoiceCount([clearedForegroundResolvedNode], node({ title: "边界之后" })), 1);

function stableInvitationInput(previous: SimulationNode) {
  return {
    history: [historyItem(previous)],
    completedChoiceCount: 16,
    pressureArcTransition: { action: "stay" as const, reasonCodes: ["no-pressure-arc"] },
    acceptedOutcome: { worldDeltas: [], arcSignals: [] },
    policy: DEFAULT_REPORT_INVITATION_POLICY,
    simulationSeed: "seed",
    branchFingerprint: "stable-repeat"
  };
}
