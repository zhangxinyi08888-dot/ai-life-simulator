import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { resolveAllowedIncomeCareerStateIds, synthesizeSelectedPersonalIncomeProposal } from "./simulationService";

const decision = "现有客户续费；我与合伙人签署工资决议，从本月起公司向我的个人账户每月支付4万元税后工资。";

test("PB-BIZ-20 accepted custom decision starts explicit personal income deterministically", () => {
  const ledger = initializeFinancialLedger({ id: "selected_income", asOfAgeInMonths: 300 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: decision,
    acceptedOutcomeId: "custom_outcome",
    periodStartAgeInMonths: 300,
    currentCareerStateId: "career_founder",
    currentEmploymentStatus: "self_employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_started");
  assert.equal((result[0].payload as any).monthlyNetAmountWan, 4);
  assert.equal((result[0].payload as any).linkedCareerStateId, "career_founder");
  assert.equal(result[0].evidence, decision);
});

test("PB-BIZ-20 accepted custom decision adjusts an existing career income and replaces model competition", () => {
  const ledger = initializeFinancialLedger({
    id: "selected_income_adjustment",
    asOfAgeInMonths: 312,
    openingPosition: {
      incomeSources: [{
        id: "owner_draw", type: "self_employment_draw", displayName: "创业提款",
        monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [{
      id: "model_income", kind: "income_source_started", effectiveAtAgeInMonths: 320,
      payload: { id: "invented", type: "self_employment_draw", monthlyNetAmountWan: 8 },
      evidence: "公司月营收8万元。", confidence: 0.8
    }],
    selectedDecision: decision,
    acceptedOutcomeId: "custom_outcome",
    periodStartAgeInMonths: 312,
    currentCareerStateId: "career_founder",
    currentEmploymentStatus: "self_employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_adjusted");
  assert.equal((result[0].payload as any).incomeSourceId, "owner_draw");
  assert.equal((result[0].payload as any).nextSource.monthlyNetAmountWan, 4);
});

test("PB-CAREER-06 accepted employment transition can ground the exact personal salary from its narrative", () => {
  const ledger = initializeFinancialLedger({ id: "return_to_work_income", asOfAgeInMonths: 639 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "C. 回归职场稳定",
    narrativeText: "你决定回归职场，最终接受了年薪45万元的offer，税后月薪约2.6万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "return_to_work",
    periodStartAgeInMonths: 639,
    currentCareerStateId: "career_employed",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_started");
  assert.equal((result[0].payload as any).type, "salary");
  assert.equal((result[0].payload as any).monthlyNetAmountWan, 2.6);
  assert.match(result[0].evidence, /税后月薪约2.6万元/);
});

test("PB-CAREER-09 income confirmation remains linked to the current career when no transition occurs", () => {
  assert.deepEqual(resolveAllowedIncomeCareerStateIds("career_self_employed", []), ["career_self_employed"]);
  assert.deepEqual(resolveAllowedIncomeCareerStateIds("career_old", ["career_new"]), ["career_new"]);
});

test("PB-CAREER-10 salary reconfirmation cannot be hijacked by an unsupported candidate career", () => {
  const ledger = initializeFinancialLedger({
    id: "salary_reconfirmation",
    asOfAgeInMonths: 480,
    openingPosition: {
      incomeSources: [{
        id: "owner_draw", type: "self_employment_draw", displayName: "创业个人工资",
        monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "needs_review",
        accrualReviewStatus: "quarantined", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "董事会完成年度复核，公司继续向我的个人账户每月支付4.5万元税后工资。",
    acceptedOutcomeId: "salary_review",
    periodStartAgeInMonths: 480,
    currentCareerStateId: "unsupported_candidate_career",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_adjusted");
  assert.equal((result[0].payload as any).incomeSourceId, "owner_draw");
  assert.equal((result[0].payload as any).nextSource.linkedCareerStateId, "career_founder");
  assert.equal((result[0].payload as any).nextSource.type, "self_employment_draw");
  assert.equal((result[0].payload as any).nextSource.monthlyNetAmountWan, 4.5);
});
