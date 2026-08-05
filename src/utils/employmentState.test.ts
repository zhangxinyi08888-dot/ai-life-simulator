import assert from "node:assert/strict";
import test from "node:test";
import type { EmploymentTransitionProposal, WorldDelta } from "../types";
import { initializeCareerState } from "../domain/career/careerState";
import {
  hasCompletedEmployerStartEvidence,
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

test("treats completed post-entry narration as an actual employer start", () => {
  assert.equal(hasCompletedEmployerStartEvidence(
    "入职后，你发现公司只有8个人，开始负责从需求调研到原型设计的全部环节。"
  ), true);
  assert.equal(hasCompletedEmployerStartEvidence(
    "你计划下月入职，先完成项目交接。入职后，你开始负责产品路线图。"
  ), true);
  assert.equal(hasCompletedEmployerStartEvidence(
    "你计划入职后再和团队确认试用期目标。"
  ), false);
  assert.equal(hasCompletedEmployerStartEvidence(
    "入职后可以先观察三个月再决定是否长期留下。"
  ), false);
  assert.equal(hasCompletedEmployerStartEvidence(
    "入职早期人工智能创业公司后，你才发现产品负责人几乎需要承担所有职责。"
  ), true, "an employer qualifier between 入职 and 后 remains a completed start");
  assert.equal(hasCompletedEmployerStartEvidence(
    "你计划下月入职早期人工智能创业公司后，再决定是否承担产品负责人的职责。"
  ), false, "a scheduled employer start remains pending even when the employer is named");
  assert.equal(hasCompletedEmployerStartEvidence(
    "入职早期人工智能创业公司后可以先观察三个月再决定是否长期留下。"
  ), false, "a named employer start remains pending when the prose says only what may happen after entry");
  assert.equal(hasCompletedEmployerStartEvidence(
    "入职早期人工智能创业公司后，你将负责产品路线图和首批客户访谈。"
  ), false, "future responsibilities after a named employer start remain pending");
  assert.equal(hasCompletedEmployerStartEvidence(
    "等待入职日期确认。入职早期人工智能创业公司后，你需要先完成合规培训。"
  ), false, "a required post-entry task cannot turn a pending start into an active employer job");
  assert.equal(hasCompletedEmployerStartEvidence(
    "入职后的前三个月，你几乎每天都要处理客户反馈和产品迭代。"
  ), true, "a completed post-entry duration is evidence that employment has already started");
  assert.equal(hasCompletedEmployerStartEvidence(
    "入职后的前三个月，你将接受产品培训并完成交接。"
  ), false, "a future post-entry duration remains pending");
});

test("recognizes a completed external consultant role, but not a future or independent engagement", () => {
  assert.equal(hasCompletedEmployerStartEvidence(
    "老周介绍的那个供应链顾问岗位，你最终接了，按月结算，税后到手约1.2万。"
  ), true);
  assert.equal(hasCompletedEmployerStartEvidence(
    "这家企业的供应链顾问工作，你正式接下了。税后到手约1.2万，按月结算。"
  ), true);
  assert.equal(hasCompletedEmployerStartEvidence(
    "你计划下月接下老周介绍的供应链顾问岗位，按月结算，税后到手约1.2万。"
  ), false);
  assert.equal(hasCompletedEmployerStartEvidence(
    "老周介绍了一个独立供应链咨询项目，你最终接了，税后到手约1.2万，按月结算。"
  ), false);
  assert.equal(hasCompletedEmployerStartEvidence(
    "你最终签了老周介绍的供应链顾问合同，税后到手约1.2万，按月结算。"
  ), false);
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

test("keeps only a selected-outcome-bound pending offer withdrawal", () => {
  const narrativeText = "你放弃了已经接受的AI创业公司产品负责人 offer，决定留在当前岗位。";
  const valid: WorldDelta = {
    type: "career_state",
    summary: "放弃待入职 offer",
    pendingEmployerOfferResolution: {
      action: "withdrawn",
      pendingOfferSourceOutcomeId: "accept_ai_offer",
      sourceOutcomeId: "decline_ai_offer",
      evidence: "你放弃了已经接受的AI创业公司产品负责人 offer，决定留在当前岗位。",
      confidence: 0.9
    }
  };
  const accepted = sanitizeEmploymentTransitions({
    worldDeltas: [valid],
    narrativeText,
    expectedSourceOutcomeId: "decline_ai_offer"
  });
  assert.equal(accepted[0]?.type, "career_state");
  assert.equal(
    accepted[0]?.type === "career_state"
      ? accepted[0].pendingEmployerOfferResolution?.pendingOfferSourceOutcomeId
      : undefined,
    "accept_ai_offer"
  );

  const rejected = sanitizeEmploymentTransitions({
    worldDeltas: [{
      ...valid,
      pendingEmployerOfferResolution: {
        ...valid.pendingEmployerOfferResolution!,
        sourceOutcomeId: "some_other_choice"
      }
    }],
    narrativeText,
    expectedSourceOutcomeId: "decline_ai_offer"
  });
  assert.deepEqual(rejected, [{ type: "career_state", summary: "放弃待入职 offer" }]);
});

test("requires action-specific evidence before a pending offer can be resolved", () => {
  const started: WorldDelta = {
    type: "career_state",
    summary: "正式入职待入职岗位",
    pendingEmployerOfferResolution: {
      action: "started",
      pendingOfferSourceOutcomeId: "accept_ai_offer",
      sourceOutcomeId: "start_ai_offer",
      evidence: "你于本月正式入职AI创业公司，担任产品负责人。",
      confidence: 0.9
    }
  };
  const accepted = sanitizeEmploymentTransitions({
    worldDeltas: [started],
    narrativeText: started.pendingEmployerOfferResolution!.evidence,
    expectedSourceOutcomeId: "start_ai_offer"
  });
  assert.equal(
    accepted[0]?.type === "career_state" ? accepted[0].pendingEmployerOfferResolution?.action : undefined,
    "started"
  );

  const invalidStarted = sanitizeEmploymentTransitions({
    worldDeltas: [{
      ...started,
      pendingEmployerOfferResolution: {
        ...started.pendingEmployerOfferResolution!,
        evidence: "你计划下月正式入职AI创业公司。"
      }
    }],
    narrativeText: "你计划下月正式入职AI创业公司。",
    expectedSourceOutcomeId: "start_ai_offer"
  });
  assert.deepEqual(invalidStarted, [{ type: "career_state", summary: "正式入职待入职岗位" }]);

  const invalidWithdrawal = sanitizeEmploymentTransitions({
    worldDeltas: [{
      type: "career_state",
      summary: "保留待入职 offer",
      pendingEmployerOfferResolution: {
        action: "withdrawn",
        pendingOfferSourceOutcomeId: "accept_ai_offer",
        sourceOutcomeId: "decline_ai_offer",
        evidence: "你没有放弃这份 offer，继续等待入职日期。",
        confidence: 0.9
      }
    }],
    narrativeText: "你没有放弃这份 offer，继续等待入职日期。",
    expectedSourceOutcomeId: "decline_ai_offer"
  });
  assert.deepEqual(invalidWithdrawal, [{ type: "career_state", summary: "保留待入职 offer" }]);
});
