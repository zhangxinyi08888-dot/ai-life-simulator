import assert from "node:assert/strict";
import { DEFAULT_PHASE_POLICY, HEALTH_CRISIS_PHASE_POLICY, reducePressureArc, resolvePhase, resolvePhasePolicy, validateNodeOutcomeProposal } from "./arcLifecycle";

const attributes = { happiness: 50, intelligence: 70, wealth: 55, relation: 50, health: 60 };
const start = reducePressureArc({ startProposal: { eventId: "venture", eventIntentType: "venture", currentAgeInMonths: 35 * 12 }, selectedDecision: "开始创业", attributes, timelineAdvance: { elapsedMonths: 0, targetAgeInMonths: 35 * 12 } });
assert.equal(start.action, "start");
assert.equal(start.nextArcState?.phaseId, "trigger");
const arc = start.nextArcState!;
assert.equal(resolvePhase(DEFAULT_PHASE_POLICY, arc.phaseId).lifeIntensity, "high_tension");

const triggerResult = reducePressureArc({ currentArc: arc, selectedDecision: "开始创业", acceptedOutcome: { worldDeltas: [], arcSignals: [] }, attributes, timelineAdvance: { elapsedMonths: 6, targetAgeInMonths: 35 * 12 + 6 } });
assert.equal(triggerResult.action, "advance");
assert.equal(triggerResult.nextPhaseId, "response");

const responseArc = triggerResult.nextArcState!;
const accepted = validateNodeOutcomeProposal({
  worldDeltas: [{ type: "career_state", summary: "获得战略投资" }],
  arcSignals: [{ type: "funding_secured", evidence: "公司获得战略投资", confidence: 0.95 }]
});
const growth = reducePressureArc({ currentArc: responseArc, selectedDecision: "接受投资", acceptedOutcome: accepted, attributes, timelineAdvance: { elapsedMonths: 8, targetAgeInMonths: 36 * 12 } });
assert.equal(growth.nextPhaseId, "growth");
assert.equal(resolvePhase(DEFAULT_PHASE_POLICY, growth.nextPhaseId!).lifeIntensity, "normal");

const repeated = reducePressureArc({ currentArc: responseArc, selectedDecision: "接受投资", acceptedOutcome: accepted, attributes, timelineAdvance: { elapsedMonths: 8, targetAgeInMonths: 36 * 12 } });
assert.deepEqual(repeated, growth);

const invalidSignal = validateNodeOutcomeProposal({ arcSignals: [{ type: "next_phase_growth", evidence: "模型想跳阶段", confidence: 1 }] });
assert.equal(invalidSignal.arcSignals.length, 0);

const healthStart = reducePressureArc({
  startProposal: {
    eventId: "health_forced_pause",
    eventIntentType: "health_forced_pause",
    currentAgeInMonths: 40 * 12
  },
  policy: HEALTH_CRISIS_PHASE_POLICY,
  selectedDecision: "重新安排治疗和工作",
  attributes: { ...attributes, health: 28 },
  timelineAdvance: { elapsedMonths: 0, targetAgeInMonths: 40 * 12 }
});
assert.equal(healthStart.action, "start");
assert.equal(healthStart.nextArcState?.phasePolicyId, "health_crisis_v1");
assert.equal(healthStart.nextArcState?.phaseId, "trigger");
assert.equal(resolvePhase(HEALTH_CRISIS_PHASE_POLICY, "trigger").lifeIntensity, "high_tension");

const healthRecovery = reducePressureArc({
  currentArc: healthStart.nextArcState!,
  policy: HEALTH_CRISIS_PHASE_POLICY,
  selectedDecision: "开始治疗并调整负荷",
  acceptedOutcome: { worldDeltas: [], arcSignals: [] },
  attributes: { ...attributes, health: 28 },
  timelineAdvance: { elapsedMonths: 4, targetAgeInMonths: 40 * 12 + 4 }
});
assert.equal(healthRecovery.action, "advance");
assert.equal(healthRecovery.nextPhaseId, "recovery");
assert.equal(resolvePhase(HEALTH_CRISIS_PHASE_POLICY, "recovery").lifeIntensity, "normal");

const firstRecoveryCheckpoint = reducePressureArc({
  currentArc: healthRecovery.nextArcState!,
  policy: HEALTH_CRISIS_PHASE_POLICY,
  selectedDecision: "维持治疗和减负安排",
  acceptedOutcome: { worldDeltas: [], arcSignals: [] },
  attributes: { ...attributes, health: 29 },
  timelineAdvance: { elapsedMonths: 6, targetAgeInMonths: 40 * 12 + 10 }
});
assert.equal(firstRecoveryCheckpoint.action, "stay");
assert.equal(firstRecoveryCheckpoint.nextPhaseId, "recovery");

const cappedRecovery = reducePressureArc({
  currentArc: firstRecoveryCheckpoint.nextArcState!,
  policy: HEALTH_CRISIS_PHASE_POLICY,
  selectedDecision: "继续观察长期恢复条件",
  acceptedOutcome: { worldDeltas: [], arcSignals: [] },
  attributes: { ...attributes, health: 29 },
  timelineAdvance: { elapsedMonths: 6, targetAgeInMonths: 41 * 12 + 4 }
});
assert.equal(cappedRecovery.nextPhaseId, "operation");
assert.equal(resolvePhase(HEALTH_CRISIS_PHASE_POLICY, "operation").lifeIntensity, "stable");

const earlyRecoveryEvidence = "睡眠和工作负荷已经稳定下来";
const earlyRecovery = reducePressureArc({
  currentArc: healthRecovery.nextArcState!,
  policy: HEALTH_CRISIS_PHASE_POLICY,
  selectedDecision: "继续执行减负安排",
  acceptedOutcome: validateNodeOutcomeProposal({
    policy: HEALTH_CRISIS_PHASE_POLICY,
    narrativeText: earlyRecoveryEvidence,
    arcSignals: [{
      pressureArcId: healthRecovery.nextArcState!.id,
      type: "stability_reached",
      evidence: earlyRecoveryEvidence,
      confidence: 0.9
    }]
  }),
  attributes: { ...attributes, health: 31 },
  timelineAdvance: { elapsedMonths: 6, targetAgeInMonths: 40 * 12 + 10 }
});
assert.equal(earlyRecovery.action, "advance");
assert.equal(earlyRecovery.nextPhaseId, "operation");

const healthResolvedWithoutModelSignal = reducePressureArc({
  currentArc: cappedRecovery.nextArcState!,
  policy: HEALTH_CRISIS_PHASE_POLICY,
  selectedDecision: "接受长期管理方案",
  acceptedOutcome: { worldDeltas: [], arcSignals: [] },
  attributes: { ...attributes, health: 24 },
  timelineAdvance: { elapsedMonths: 12, targetAgeInMonths: 42 * 12 + 4 }
});
assert.equal(healthResolvedWithoutModelSignal.action, "resolve");
assert.equal(healthResolvedWithoutModelSignal.nextArcState?.status, "resolved");
assert.equal(healthResolvedWithoutModelSignal.nextArcState?.totalCheckpointCount, 4);

assert.equal(resolvePhasePolicy("health_crisis_v1"), HEALTH_CRISIS_PHASE_POLICY);
assert.equal(resolvePhasePolicy("unknown-policy"), DEFAULT_PHASE_POLICY);
