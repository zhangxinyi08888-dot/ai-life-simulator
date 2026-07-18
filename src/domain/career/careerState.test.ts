import assert from "node:assert/strict";
import test from "node:test";
import {
  CareerStateError,
  initializeCareerState,
  reduceCareerStates,
  validateAndAcceptCareerTransition
} from "./careerState";
import type { CareerTransitionProposal } from "./types";

function proposal(overrides: Partial<CareerTransitionProposal> = {}): CareerTransitionProposal {
  return {
    id: "proposal_leave_job",
    fromCareerStateId: "career_employed",
    toStatus: "self_employed",
    occupation: "独立顾问",
    industry: "咨询",
    organization: "个人工作室",
    effectiveAtAgeInMonths: 366,
    sourceOutcomeId: "start_consulting",
    evidence: "你正式离职，开始以独立顾问身份承接项目",
    confidence: 0.95,
    ...overrides
  };
}

test("accepts and reduces a protagonist career transition with outcome, temporal and evidence authority", () => {
  const current = initializeCareerState({
    id: "career_employed",
    employmentStatus: "employed",
    occupation: "产品经理",
    organization: "原公司",
    effectiveFromAgeInMonths: 300
  });
  const accepted = validateAndAcceptCareerTransition({
    proposal: proposal(),
    currentCareerState: current,
    acceptedOutcomeId: "start_consulting",
    narrativeText: "经过交接，你正式离职，开始以独立顾问身份承接项目。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372
  });
  const reduced = reduceCareerStates({
    current: { careerStates: [current], currentCareerStateId: current.id, careerRevision: 0 },
    expectedCareerRevision: 0,
    acceptedTransitions: [accepted]
  });

  assert.equal(reduced.currentCareerStateId, "career_proposal_leave_job");
  assert.equal(reduced.careerStates[1].employmentStatus, "self_employed");
  assert.equal(reduced.careerStates[1].organization, "个人工作室");
  assert.equal(reduced.careerStates[1].occupation, "独立顾问");
  assert.equal(reduced.careerRevision, 1);
});

test("rejects stale, unselected, out-of-period or unsupported career transitions", () => {
  const current = initializeCareerState({
    id: "career_employed",
    employmentStatus: "employed",
    effectiveFromAgeInMonths: 300
  });
  const base = {
    currentCareerState: current,
    acceptedOutcomeId: "start_consulting",
    narrativeText: "你正式离职，开始以独立顾问身份承接项目",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372
  };
  for (const invalid of [
    proposal({ fromCareerStateId: "stale_state" }),
    proposal({ sourceOutcomeId: "stay_employed" }),
    proposal({ effectiveAtAgeInMonths: 373 }),
    proposal({ evidence: "正文没有的完成事实" }),
    proposal({ confidence: 0.5 })
  ]) {
    assert.throws(
      () => validateAndAcceptCareerTransition({ ...base, proposal: invalid }),
      (error: unknown) => error instanceof CareerStateError && error.code === "INVALID_TRANSITION"
    );
  }
});

test("career reducer is idempotent for an already committed next state", () => {
  const current = initializeCareerState({ id: "career_employed", employmentStatus: "employed", effectiveFromAgeInMonths: 300 });
  const accepted = validateAndAcceptCareerTransition({
    proposal: proposal(),
    currentCareerState: current,
    acceptedOutcomeId: "start_consulting",
    narrativeText: "你正式离职，开始以独立顾问身份承接项目",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372
  });
  const first = reduceCareerStates({
    current: { careerStates: [current], currentCareerStateId: current.id, careerRevision: 0 },
    expectedCareerRevision: 0,
    acceptedTransitions: [accepted]
  });
  const repeated = reduceCareerStates({
    current: first,
    expectedCareerRevision: 1,
    acceptedTransitions: [accepted]
  });
  assert.deepEqual(repeated, first);
});
