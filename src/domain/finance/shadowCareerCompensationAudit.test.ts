import assert from "node:assert/strict";
import test from "node:test";
import { auditCareerCompensationHistory, projectEducationHistoryWithCareerCompensation } from "./shadowCareerCompensationAudit";

function node(ageInMonths: number, description: string, overrides: Record<string, any> = {}) {
  return {
    ageInMonths, description,
    financialState: { annualAfterTaxIncomeWan: 0, netWorthWan: -52.6 },
    worldStateSnapshot: {
      currentCareerStateId: ageInMonths < 300 ? "student" : "stale_intern",
      careerStates: [
        { id: "student", employmentStatus: "student" },
        { id: "stale_intern", employmentStatus: "employed" }
      ]
    },
    financialLedger: {
      incomeSources: [], debtAccounts: [],
      ...overrides
    }
  };
}

test("shadow audit reports bounded overrun, paid gaps and unsupported automatic debt without mutating history", () => {
  const history = [
    node(216, "学生阶段"),
    node(300, "实习结束后仍处于旧职业", {
      incomeSources: [{
        id: "intern", type: "salary", monthlyNetAmountWan: 0.3, activeFromAgeInMonths: 251,
        activeUntilAgeInMonths: 354, status: "active", linkedCareerStateId: "stale_intern",
        evidence: [{ excerpt: "签下为期两个月的实习，月薪0.3万元。" }]
      }],
      debtAccounts: [{ origin: "system_auto_shortfall", principalWan: 52.6 }]
    })
  ];
  const before = structuredClone(history);
  const metrics = auditCareerCompensationHistory(history);
  assert.equal(metrics.nodeCount, 2);
  assert.equal(metrics.boundedIncomeOverrunCount, 1);
  assert.equal(metrics.systemAutoShortfallDebtWan, 52.6);
  assert.equal(metrics.unsupportedDebtAccountCount, 1);
  assert.deepEqual(history, before);
});

test("education shadow projection removes internship overrun and adds a versioned full-time salary range", () => {
  const incomeSources = [{
    id: "support", type: "family_support", monthlyNetAmountWan: 0.2,
    activeFromAgeInMonths: 216, activeUntilAgeInMonths: 251, status: "ended"
  }, {
    id: "intern", type: "salary", monthlyNetAmountWan: 0.3,
    activeFromAgeInMonths: 251, activeUntilAgeInMonths: 354, status: "ended",
    evidence: [{ excerpt: "实习期两个月，税后月薪0.3万元。" }]
  }];
  const history = [
    node(251, "实习期两个月，税后月薪0.3万元。", { incomeSources, debtAccounts: [] }),
    node(307, "你正式入职头部互联网公司的前端团队。", { incomeSources, debtAccounts: [] }),
    node(388, "阶段结束", { incomeSources, debtAccounts: [{ origin: "system_auto_shortfall", principalWan: 52.6 }] })
  ];
  const projection = projectEducationHistoryWithCareerCompensation(history);
  assert.equal(projection.baselineNetWorthWan, -52.6);
  assert.equal(projection.removedInternshipOverrunIncomeWan, 30.3);
  assert.equal(projection.restoredStudentSupportWan, 11.2);
  assert.equal(projection.fullTimeEffectiveAtAgeInMonths, 307);
  assert.equal(projection.policyId, "career_compensation_cn_v1");
  assert.ok(projection.projectedNetWorthRangeWan![0] > projection.baselineNetWorthWan);
});
