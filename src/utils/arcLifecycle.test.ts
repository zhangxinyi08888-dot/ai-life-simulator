import assert from "node:assert/strict";
import { DEFAULT_PHASE_POLICY, reducePressureArc, resolvePhase, validateNodeOutcomeProposal } from "./arcLifecycle";

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
