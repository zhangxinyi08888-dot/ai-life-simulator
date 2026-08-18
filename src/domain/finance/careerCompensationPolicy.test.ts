import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import type { AcceptedCareerTransition } from "../career/types";
import {
  CAREER_COMPENSATION_POLICY_ID,
  completeCareerCompensationProposals,
  completeDueCareerCompensationReviewProposals,
  isMaterialCompensationOutlier,
  normalizeCareerStage,
  normalizeOccupationFamily,
  parseBoundedEngagementMonths,
  reclassifyBoundedStudentEngagement,
  resolveCareerCompensationEstimate
} from "./careerCompensationPolicy";
import { initializeFinancialLedger } from "./initializeLedger";
import type { FinancialEventProposal } from "./types";

const evidence = [{
  source: "accepted_simulation_outcome" as const,
  reasonCode: "TEST",
  confidence: 1,
  excerpt: "毕业后，你正式加入头部互联网公司，担任前端工程师。"
}];

function career(overrides: Parameters<typeof initializeCareerState>[0]) {
  return initializeCareerState(overrides);
}

test("role corpus normalizes occupation, stage, employment type, industry, organization and region", () => {
  const corpus = [
    ["头部互联网公司应届前端工程师，北京", "software_engineering", "entry", "full_time"],
    ["大型科技公司 Web Engineer，上海", "software_engineering", "mid", "full_time"],
    ["资深交互设计师", "design", "senior", "full_time"],
    ["产品总监", "product", "manager", "full_time"],
    ["兼职行业顾问", "consulting", "mid", "part_time"],
    ["初创公司的运营负责人", "sales_operations", "manager", "full_time"],
    ["大学实习讲师", "education", "internship", "internship"]
  ] as const;
  for (const [description, family, stage, employmentType] of corpus) {
    const state = career({
      id: `career_${family}_${stage}`,
      employmentStatus: employmentType === "part_time" ? "part_time" : "employed",
      occupation: description,
      effectiveFromAgeInMonths: 300
    });
    const estimate = resolveCareerCompensationEstimate({
      careerState: state,
      narrativeText: description,
      effectiveAtAgeInMonths: 300,
      calendarYear: 2026
    });
    assert.equal(estimate.inputs.occupationFamily, family);
    assert.equal(estimate.inputs.careerStage, stage);
    assert.equal(estimate.inputs.employmentType, employmentType);
    assert.equal(estimate.policyId, CAREER_COMPENSATION_POLICY_ID);
    assert.equal(estimate.monthlyNetAmountWan, Math.round((estimate.monthlyNetRangeWan[0] + estimate.monthlyNetRangeWan[1]) * 50) / 100);
    assert.equal(estimate.reviewAtAgeInMonths, 312);
  }
});

test("synonyms produce the same normalized software family and deterministic estimate", () => {
  const first = career({ id: "front_end", employmentStatus: "employed", occupation: "头部互联网前端工程师", effectiveFromAgeInMonths: 300 });
  const second = career({ id: "web_engineer", employmentStatus: "employed", occupation: "头部互联网 Web Engineer", effectiveFromAgeInMonths: 300 });
  const a = resolveCareerCompensationEstimate({ careerState: first, effectiveAtAgeInMonths: 300, calendarYear: 2026 });
  const b = resolveCareerCompensationEstimate({ careerState: second, effectiveAtAgeInMonths: 300, calendarYear: 2026 });
  assert.equal(normalizeOccupationFamily(first.occupation!), "software_engineering");
  assert.equal(normalizeOccupationFamily(second.occupation!), "software_engineering");
  assert.deepEqual(a, resolveCareerCompensationEstimate({ careerState: first, effectiveAtAgeInMonths: 300, calendarYear: 2026 }));
  assert.deepEqual(a.monthlyNetRangeWan, b.monthlyNetRangeWan);
});

test("retrospective internship or another person's manager title cannot downgrade the accepted current role", () => {
  const state = career({
    id: "current_frontend", employmentStatus: "employed", occupation: "应届前端工程师",
    industry: "互联网", organization: "头部互联网公司", effectiveFromAgeInMonths: 307
  });
  const estimate = resolveCareerCompensationEstimate({
    careerState: state,
    narrativeText: "你正式入职头部互联网公司的前端团队，比实习时更忙。组长赵鹏负责评审。",
    effectiveAtAgeInMonths: 307
  });
  assert.equal(estimate.inputs.employmentType, "full_time");
  assert.equal(estimate.inputs.careerStage, "entry");
  assert.ok(estimate.monthlyNetRangeWan[0] > 1);
});

test("unknown context widens the band and lowers confidence without copying a previous salary", () => {
  const next = career({ id: "career_unknown", employmentStatus: "employed", occupation: "工程师", effectiveFromAgeInMonths: 360 });
  const estimate = resolveCareerCompensationEstimate({ careerState: next, effectiveAtAgeInMonths: 360 });
  assert.equal(estimate.inputs.organizationTier, "unknown");
  assert.equal(estimate.inputs.regionTier, "unknown");
  assert.ok(estimate.confidence < 0.8);
  assert.notEqual(estimate.monthlyNetAmountWan, 0.3);

  const old = career({ id: "career_intern", employmentStatus: "part_time", occupation: "实习生", effectiveFromAgeInMonths: 300 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_full_time", proposalId: "full_time", fromCareerStateId: old.id,
    nextCareerState: next, effectiveAtAgeInMonths: 360, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const ledger = initializeFinancialLedger({
    id: "no_reuse", asOfAgeInMonths: 360,
    openingPosition: { incomeSources: [{
      id: "intern_salary", type: "salary", displayName: "实习工资", monthlyNetAmountWan: 0.3,
      accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active",
      linkedCareerStateId: old.id, factStatus: "known", evidence: []
    }] }
  });
  const proposals = completeCareerCompensationProposals({
    proposals: [], currentLedger: ledger, transition, acceptedOutcomeId: "outcome",
    narrativeText: evidence[0].excerpt!
  });
  assert.equal(proposals.length, 1);
  const source = proposals[0].payload as any;
  assert.equal(source.factStatus, "estimated");
  assert.notEqual(source.monthlyNetAmountWan, 0.3);
  assert.equal(source.linkedCareerStateId, next.id);
  assert.equal(source.compensationEstimate.policyVersion, 1);
});

test("explicit known or unpaid compensation wins over policy estimation", () => {
  const old = career({ id: "career_old", employmentStatus: "employed", occupation: "工程师", effectiveFromAgeInMonths: 300 });
  const next = career({ id: "career_new", employmentStatus: "employed", occupation: "高级工程师", effectiveFromAgeInMonths: 360 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_new", proposalId: "new", fromCareerStateId: old.id, nextCareerState: next,
    effectiveAtAgeInMonths: 360, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const known: FinancialEventProposal = {
    id: "known_salary", kind: "income_source_started", effectiveAtAgeInMonths: 360,
    sourceOutcomeId: "outcome", evidence: "你税后月薪3万元。", confidence: 1,
    payload: {
      id: "known", type: "salary", displayName: "明确工资", monthlyNetAmountWan: 3,
      accrualPolicy: "monthly", activeFromAgeInMonths: 360, status: "active",
      linkedCareerStateId: next.id, factStatus: "known", evidence: []
    }
  };
  const ledger = initializeFinancialLedger({ id: "precedence", asOfAgeInMonths: 360 });
  assert.deepEqual(completeCareerCompensationProposals({
    proposals: [known], currentLedger: ledger, transition, acceptedOutcomeId: "outcome", narrativeText: evidence[0].excerpt!,
    userEvidenceText: known.evidence
  }), [known]);
  assert.deepEqual(completeCareerCompensationProposals({
    proposals: [], currentLedger: ledger, transition, acceptedOutcomeId: "outcome", narrativeText: "该岗位明确无薪。", explicitUnpaid: true
  }), []);
});

test("self-employed role definition never creates a personal owner draw without an accepted receipt", () => {
  const old = career({ id: "employee_before_founder", employmentStatus: "employed", occupation: "工程师", effectiveFromAgeInMonths: 300 });
  const founder = career({ id: "founder_without_draw", employmentStatus: "self_employed", occupation: "供应链咨询公司创始人", effectiveFromAgeInMonths: 360 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_founder", proposalId: "founder", fromCareerStateId: old.id,
    nextCareerState: founder, effectiveAtAgeInMonths: 360, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const ledger = initializeFinancialLedger({ id: "founder_no_draw", asOfAgeInMonths: 360 });
  assert.deepEqual(completeCareerCompensationProposals({
    proposals: [], currentLedger: ledger, transition, acceptedOutcomeId: "outcome",
    narrativeText: "你辞职创办供应链咨询公司，公司签下了第一位客户。"
  }), []);
});

test("material outliers are detected against the versioned role band", () => {
  const state = career({ id: "entry", employmentStatus: "employed", occupation: "应届前端工程师", effectiveFromAgeInMonths: 300 });
  const estimate = resolveCareerCompensationEstimate({ careerState: state, effectiveAtAgeInMonths: 300 });
  assert.equal(isMaterialCompensationOutlier(estimate.monthlyNetAmountWan, estimate), false);
  assert.equal(isMaterialCompensationOutlier(30, estimate), true);
});

test("an ungrounded model outlier is deterministically repaired while a user amount remains authoritative", () => {
  const old = career({ id: "old", employmentStatus: "employed", occupation: "初级工程师", effectiveFromAgeInMonths: 240 });
  const next = career({ id: "next", employmentStatus: "employed", occupation: "应届前端工程师", effectiveFromAgeInMonths: 300 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_next", proposalId: "next", fromCareerStateId: old.id, nextCareerState: next,
    effectiveAtAgeInMonths: 300, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const outlier: FinancialEventProposal = {
    id: "model_outlier", kind: "income_source_started", effectiveAtAgeInMonths: 300,
    sourceOutcomeId: "outcome", evidence: "你入职后税后月薪30万元。", confidence: 0.9,
    payload: {
      id: "outlier", type: "salary", displayName: "异常工资", monthlyNetAmountWan: 30,
      accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active",
      linkedCareerStateId: next.id, factStatus: "known", evidence: []
    }
  };
  const ledger = initializeFinancialLedger({ id: "outlier", asOfAgeInMonths: 300 });
  const repaired = completeCareerCompensationProposals({
    proposals: [outlier], currentLedger: ledger, transition, acceptedOutcomeId: "outcome",
    narrativeText: "你正式加入公司担任应届前端工程师。"
  });
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].id, "policy_compensation_next");
  assert.notEqual((repaired[0].payload as any).monthlyNetAmountWan, 30);
  assert.deepEqual(completeCareerCompensationProposals({
    proposals: [outlier], currentLedger: ledger, transition, acceptedOutcomeId: "outcome",
    narrativeText: "你正式加入公司担任应届前端工程师。", userEvidenceText: outlier.evidence
  }), [outlier]);
});

test("a due estimated salary is reviewed at each policy boundary without changing CareerState", () => {
  const state = career({ id: "career_current", employmentStatus: "employed", occupation: "高级前端工程师", effectiveFromAgeInMonths: 300 });
  const estimate = resolveCareerCompensationEstimate({ careerState: state, effectiveAtAgeInMonths: 300, calendarYear: 2026 });
  const ledger = initializeFinancialLedger({
    id: "reviews", asOfAgeInMonths: 312,
    openingPosition: { incomeSources: [{
      id: "estimated_salary", type: "salary", displayName: "估算工资",
      monthlyNetAmountWan: estimate.monthlyNetAmountWan, accrualPolicy: "monthly",
      activeFromAgeInMonths: 300, status: "active", linkedCareerStateId: state.id,
      factStatus: "estimated", compensationEstimate: estimate, evidence: []
    }] }
  });
  const reviewed = completeDueCareerCompensationReviewProposals({
    proposals: [], currentLedger: ledger, currentCareerState: state,
    periodStartAgeInMonths: 312, periodEndAgeInMonths: 336,
    acceptedOutcomeId: "review_outcome", narrativeText: "你继续担任高级前端工程师，职责保持稳定。"
  });
  assert.deepEqual(reviewed.map((proposal) => proposal.effectiveAtAgeInMonths), [312, 324, 336]);
  assert.equal((reviewed[2].payload as any).nextSource.compensationEstimate.reviewAtAgeInMonths, 348);
  assert.equal((reviewed[2].payload as any).nextSource.linkedCareerStateId, state.id);
});

test("bounded student internship is an engagement, retains student CareerState, and has an exact end month", () => {
  const student = career({ id: "career_student", employmentStatus: "student", occupation: "计算机专业学生", effectiveFromAgeInMonths: 216 });
  const intern = career({ id: "career_intern", employmentStatus: "employed", occupation: "网页设计实习生", effectiveFromAgeInMonths: 251 });
  const narrative = "你参加了为期两个月的暑期网页设计实习，税后月薪0.3万元。";
  const transition: AcceptedCareerTransition = {
    id: "accepted_intern", proposalId: "intern", fromCareerStateId: student.id, nextCareerState: intern,
    effectiveAtAgeInMonths: 251,
    evidence: [{ ...evidence[0], excerpt: narrative }], acceptedByReasonCodes: ["TEST"]
  };
  const result = reclassifyBoundedStudentEngagement({
    currentCareerState: student, transitions: [transition], narrativeText: narrative, acceptedOutcomeId: "outcome"
  });
  assert.equal(parseBoundedEngagementMonths(narrative), 2);
  assert.equal(result.transitions.length, 0);
  assert.equal(result.reclassified, true);
  const source = result.proposals[0].payload as any;
  assert.equal(source.monthlyNetAmountWan, 0.3);
  assert.equal(source.activeFromAgeInMonths, 251);
  assert.equal(source.activeUntilAgeInMonths, 253);
  assert.equal(source.linkedCareerStateId, student.id);
});

test("deterministic property corpus keeps every estimate positive, ordered, bounded and replayable", () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const occupations = ["前端工程师", "交互设计师", "产品经理", "行业顾问", "课程讲师", "销售运营", "行政专员"];
  const stages = ["应届", "中级", "高级", "技术负责人", "经理", "高管"];
  const organizations = ["头部互联网公司", "大型集团", "初创团队", "未知机构"];
  for (let index = 0; index < 300; index += 1) {
    const description = `${organizations[Math.floor(random() * organizations.length)]}${stages[Math.floor(random() * stages.length)]}${occupations[Math.floor(random() * occupations.length)]}`;
    const state = career({ id: `random_${index}`, employmentStatus: "employed", occupation: description, effectiveFromAgeInMonths: 240 + index });
    const first = resolveCareerCompensationEstimate({ careerState: state, effectiveAtAgeInMonths: 240 + index, calendarYear: 2026 });
    const second = resolveCareerCompensationEstimate({ careerState: state, effectiveAtAgeInMonths: 240 + index, calendarYear: 2026 });
    assert.deepEqual(first, second);
    assert.ok(first.monthlyNetRangeWan[0] > 0);
    assert.ok(first.monthlyNetRangeWan[1] >= first.monthlyNetRangeWan[0]);
    assert.ok(first.monthlyNetAmountWan >= first.monthlyNetRangeWan[0]);
    assert.ok(first.monthlyNetAmountWan <= first.monthlyNetRangeWan[1]);
  }
  assert.equal(normalizeCareerStage("高级工程师"), "senior");
});
