import assert from "node:assert/strict";
import test from "node:test";
import type { EmploymentTransitionProposal, WorldDelta } from "../types";
import { initializeCareerState } from "../domain/career/careerState";
import {
  resolveAuthoritativeEmploymentStatus,
  resolveEmploymentStatusForNode,
  sanitizeEmploymentTransitions
} from "./employmentState";

function transition(overrides: Partial<EmploymentTransitionProposal> = {}): EmploymentTransitionProposal {
  return {
    subject: "protagonist",
    toStatus: "self_employed",
    effectiveAtAgeInMonths: 360,
    sourceOutcomeId: "start_business",
    evidence: "你正式辞职并开始全职经营公司",
    confidence: 0.95,
    ...overrides
  };
}

test("initializes the temporary authority once and otherwise requires world state", () => {
  assert.equal(resolveAuthoritativeEmploymentStatus({
    worldState: {},
    legacyFinancialState: { employmentStatus: "employed" },
    isInitialization: true
  }), "employed");
  assert.equal(resolveAuthoritativeEmploymentStatus({
    worldState: {},
    legacyFinancialState: { employmentStatus: "employed" },
    isInitialization: false
  }), undefined);
  assert.equal(resolveAuthoritativeEmploymentStatus({
    worldState: { currentEmploymentStatus: "retired" },
    legacyFinancialState: { employmentStatus: "employed" },
    isInitialization: false
  }), "retired");
  assert.equal(resolveAuthoritativeEmploymentStatus({
    currentCareerState: initializeCareerState({
      id: "career_current",
      employmentStatus: "self_employed",
      effectiveFromAgeInMonths: 360
    }),
    worldState: { currentEmploymentStatus: "retired" },
    legacyFinancialState: { employmentStatus: "student" },
    isInitialization: false
  }), "self_employed");
});

test("accepts only protagonist transitions tied to the selected outcome and narrative evidence", () => {
  const narrativeText = "这一年，你正式辞职并开始全职经营公司，收入暂时下降。";
  const delta: WorldDelta = { type: "career_state", summary: "开始创业", employmentTransition: transition() };
  assert.equal(resolveEmploymentStatusForNode({
    currentStatus: "employed",
    worldDeltas: [delta],
    narrativeText,
    expectedSourceOutcomeId: "start_business"
  }), "self_employed");

  for (const invalid of [
    transition({ subject: "protagonist", sourceOutcomeId: "stay_employed" }),
    transition({ subject: "protagonist", evidence: "正文里没有这句话" }),
    transition({ subject: "protagonist", confidence: 0.5 })
  ]) {
    assert.equal(resolveEmploymentStatusForNode({
      currentStatus: "employed",
      worldDeltas: [{ type: "career_state", summary: "无效转换", employmentTransition: invalid }],
      narrativeText,
      expectedSourceOutcomeId: "start_business"
    }), "employed");
  }
});

test("strips invalid transition payloads without discarding the compatibility summary", () => {
  const deltas = sanitizeEmploymentTransitions({
    worldDeltas: [{
      type: "career_state",
      summary: "团队里有一位退休干部",
      employmentTransition: transition({ toStatus: "retired", evidence: "退休干部", sourceOutcomeId: "hire_retired_advisor" })
    }],
    narrativeText: "团队里有一位退休干部",
    expectedSourceOutcomeId: "start_business"
  });

  assert.deepEqual(deltas, [{ type: "career_state", summary: "团队里有一位退休干部" }]);
});
