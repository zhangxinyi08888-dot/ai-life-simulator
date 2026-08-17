import assert from "node:assert/strict";
import test from "node:test";
import { hasExplicitPersonalBusinessIncomeReceipt, hasMatchingPersonalBusinessIncomeAmount, isNarratedBeforePeriod, matchFinancialEvidence } from "./evidenceMatching";
import type { FinancialEventProposal } from "./types";

function proposal(kind: FinancialEventProposal["kind"], evidence: string): FinancialEventProposal {
  return {
    id: "evidence_matching_fixture",
    kind,
    effectiveAtAgeInMonths: 400,
    payload: { monthlyAmountWan: 0.3 },
    evidence,
    sourceOutcomeId: "outcome",
    confidence: 1,
    financialScope: "personal"
  } as FinancialEventProposal;
}

test("a child or parent beneficiary may support a personal expense only with an explicit protagonist-payer fact", () => {
  const evidence = "孩子出生且由主角承担持续育儿费用。";
  assert.equal(matchFinancialEvidence({
    proposal: proposal("expense_commitment_started", evidence),
    narrativeText: evidence
  }).matched, true);
});

test("a fixed recurring transfer to parents remains an explicit protagonist-paid expense", () => {
  const evidence = "父母的身体状况相对稳定，你每月固定转给他们三千元作为医疗和日常开销。";
  assert.equal(matchFinancialEvidence({
    proposal: proposal("expense_commitment_started", evidence),
    narrativeText: evidence
  }).matched, true);
});

test("third-party payment wording and income events keep the non-protagonist boundary", () => {
  const thirdPartyExpense = "孩子出生后，配偶替你支付持续育儿费用。";
  assert.equal(matchFinancialEvidence({
    proposal: proposal("expense_commitment_started", thirdPartyExpense),
    narrativeText: thirdPartyExpense
  }).matched, false);

  const childIncome = "孩子的工资由主角承担家庭开销。";
  assert.equal(matchFinancialEvidence({
    proposal: proposal("income_source_started", childIncome),
    narrativeText: childIncome
  }).matched, false);
});

test("a child-independence fact may support only the matching V4 dependent end", () => {
  const evidence = "子女已独立，主角不再承担持续抚养费。";
  const end = proposal("expense_commitment_ended", evidence);
  end.payload = {
    expenseCommitmentId: "child_support_1",
    previousCommitmentId: "child_support_1",
    changeReason: "dependent_independent"
  } as FinancialEventProposal["payload"];
  assert.equal(matchFinancialEvidence({ proposal: end, narrativeText: evidence }).matched, true);

  const wrongReason = structuredClone(end);
  (wrongReason.payload as Record<string, unknown>).changeReason = "responsibility_ended";
  assert.equal(matchFinancialEvidence({ proposal: wrongReason, narrativeText: evidence }).matched, false);
});

test("a protagonist-arranged but unpriced elder-care service may start only a needs-review care commitment", () => {
  const evidence = "父母已过百岁，虽身体尚可，但已需要更多照料。你每隔几周会去看望他们，或请人帮忙照看。";
  const careStart = proposal("expense_commitment_started", evidence);
  careStart.payload = {
    responsibilityKey: "elder_care:parents",
    responsibilityKind: "elder_care",
    type: "dependent_support",
    factStatus: "needs_review",
    monthlyAmountWan: 0.4
  } as FinancialEventProposal["payload"];
  assert.equal(matchFinancialEvidence({ proposal: careStart, narrativeText: evidence }).matched, true);

  const knownAmount = structuredClone(careStart);
  (knownAmount.payload as Record<string, unknown>).factStatus = "known";
  assert.equal(matchFinancialEvidence({ proposal: knownAmount, narrativeText: evidence }).matched, false);

  const thirdPartyArrangement = structuredClone(careStart);
  thirdPartyArrangement.evidence = "父母已过百岁，虽身体尚可，但已需要更多照料。父母请人帮忙照看。";
  assert.equal(matchFinancialEvidence({ proposal: thirdPartyArrangement, narrativeText: thirdPartyArrangement.evidence }).matched, false);
});

test("a relative-past outlay is pre-period only when the narrative explicitly opens at the transaction start", () => {
  const historicalNarrative = "25岁0个月，你开始整理共同账户。你父亲上个月住院，你垫付了1.2万元住院押金。到26岁0个月，你们重新安排了照护预算。";
  assert.equal(isNarratedBeforePeriod({
    narrativeText: historicalNarrative,
    evidence: "你父亲上个月住院，你垫付了1.2万元住院押金。",
    periodStartAgeInMonths: 300
  }), true);
  assert.equal(isNarratedBeforePeriod({
    narrativeText: "到26岁0个月，你上个月垫付了1.2万元父亲住院费用。",
    evidence: "到26岁0个月，你上个月垫付了1.2万元父亲住院费用。",
    periodStartAgeInMonths: 300
  }), false);
  assert.equal(isNarratedBeforePeriod({
    narrativeText: "25岁0个月，你开始整理共同账户。此前你一直很关心父亲的健康。",
    evidence: "此前你一直很关心父亲的健康。",
    periodStartAgeInMonths: 300
  }), false, "ambiguous historical language must not reject an otherwise current fact");
});

test("personal business income amount matching parses exact numeric tokens instead of substrings", () => {
  assert.equal(hasMatchingPersonalBusinessIncomeAmount({
    type: "self_employment_draw",
    source: { monthlyNetAmountWan: 1.5, accrualPolicy: "monthly" },
    evidence: "公司从本月起每月向你的个人账户支付11.5万元税后工资。"
  }), false, "11.5 万 cannot authorize a 1.5 万 draw");
  assert.equal(hasMatchingPersonalBusinessIncomeAmount({
    type: "self_employment_draw",
    source: { monthlyNetAmountWan: 0.5, accrualPolicy: "monthly" },
    evidence: "你从本月起每月领取10.5万元业主提款。"
  }), false, "10.5 万 cannot authorize a 0.5 万 draw");
  assert.equal(hasMatchingPersonalBusinessIncomeAmount({
    type: "self_employment_draw",
    source: { monthlyNetAmountWan: 0.5, accrualPolicy: "monthly" },
    evidence: "你从本月起每月领取5000元业主提款。"
  }), true, "yuan-denominated evidence still proves the exact 0.5 万 draw");
});

test("personal business income cadence belongs to its exact amount clause", () => {
  assert.equal(hasMatchingPersonalBusinessIncomeAmount({
    type: "self_employment_draw",
    source: { monthlyNetAmountWan: 12, accrualPolicy: "monthly" },
    evidence: "公司已向你的个人账户支付年度分红12万元，另有每月一次的运营例会。"
  }), false, "an annual 12 万 dividend cannot become a monthly draw because another clause says 每月");
  assert.equal(hasMatchingPersonalBusinessIncomeAmount({
    type: "business_dividend",
    source: { annualNetAmountWan: 12, accrualPolicy: "annual" },
    evidence: "公司从本月起每月向你的个人账户支付12万元税后工资，年度汇总仍在准备。"
  }), false, "a monthly 12 万 salary cannot become an annual dividend because another clause says 年度");
});

test("a planned personal business payment is not a completed receipt", () => {
  const planned = "公司计划从下月起每月向你个人账户支付4万元税后工资。";
  assert.equal(hasExplicitPersonalBusinessIncomeReceipt({ type: "self_employment_draw", evidence: planned }), false);
  assert.equal(hasExplicitPersonalBusinessIncomeReceipt({ type: "business_dividend", evidence: planned }), false);
  assert.equal(hasExplicitPersonalBusinessIncomeReceipt({
    type: "self_employment_draw",
    evidence: "你计划接供应链咨询零活，每月能多挣5000元。"
  }), false);
  assert.equal(hasExplicitPersonalBusinessIncomeReceipt({
    type: "self_employment_draw",
    evidence: "你准备给自己涨薪到每月2.5万元。"
  }), false);
  assert.equal(hasExplicitPersonalBusinessIncomeReceipt({
    type: "self_employment_draw",
    evidence: "你计划扩大咨询范围，公司从本月起每月向你的个人账户支付4万元税后工资。"
  }), true, "an unrelated earlier plan must not erase a separate completed payment clause");
});
