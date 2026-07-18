import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFinancialProposals, normalizeRepairedFinancialProposals } from "./normalizeFinancialProposals";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";

test("normalizes kind fields, fills a unique outcome id and deduplicates temporary ids", () => {
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["choice_fallback_1"],
    proposals: [
      { id: "temporary", type: "one_off_income_received", effectiveAtAgeInMonths: 301, payload: {}, evidence: "证据", confidence: 0.9 },
      { id: "temporary", kind: "one_off_expense_paid", effectiveAtAgeInMonths: 301, payload: {}, sourceOutcomeId: null, evidence: "证据", confidence: 0.9 }
    ]
  });
  assert.deepEqual(result.proposals.map((proposal) => proposal.id), ["temporary", "temporary_2"]);
  assert.deepEqual(result.proposals.map((proposal) => proposal.sourceOutcomeId), ["choice_fallback_1", "choice_fallback_1"]);
  assert.equal(result.proposals[0].kind, "one_off_income_received");
  assert.equal(result.audit.some((item) => item.reasonCode === "DUPLICATE_ID_RENAMED"), true);
});

test("fills only the missing CareerState reference without changing wage semantics", () => {
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentCareerStateId: "career_current",
    nextCareerStateIds: ["career_new_job"],
    proposals: [{
      id: "new_wage",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 301,
      payload: { id: "salary_new", type: "salary", monthlyNetAmountWan: 1.25 },
      evidence: "你正式入职，月薪1.25万元",
      confidence: 0.9
    }]
  });
  assert.equal((result.proposals[0].payload as { linkedCareerStateId: string }).linkedCareerStateId, "career_new_job");
  assert.equal((result.proposals[0].payload as { monthlyNetAmountWan: number }).monthlyNetAmountWan, 1.25);
  assert.equal(result.audit.some((item) => item.reasonCode === "CAREER_LINK_FILLED"), true);
});

test("fills a missing cash account reference without changing the amount", () => {
  const currentLedger = initializeFinancialLedger({
    id: "cash_normalization",
    asOfAgeInMonths: 300,
    openingPosition: { cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 3, status: "active", factStatus: "known", evidence: [] }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    proposals: [{ id: "income", kind: "one_off_income_received", effectiveAtAgeInMonths: 301, payload: { amountWan: 2 }, evidence: "你收到2万元", confidence: 0.9 }]
  });
  assert.equal((result.proposals[0].payload as { destinationCashAccountId: string }).destinationCashAccountId, PRIMARY_CASH_ACCOUNT_ID);
  assert.equal((result.proposals[0].payload as { amountWan: number }).amountWan, 2);
});

test("repair output inherits omitted structural fields from the rejected proposal", () => {
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    rejectedProposals: [{
      id: "consulting_income",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 700,
      payload: { id: "consulting", type: "salary", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 700, status: "active", factStatus: "estimated", evidence: [] },
      sourceOutcomeId: "selected",
      evidence: "你转为顾问，每月收入2万元。",
      confidence: 0.9
    }],
    proposals: [{ id: "consulting_income", payload: { monthlyNetAmountWan: 2.2 } }]
  });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].kind, "income_source_started");
  assert.equal(result.proposals[0].confidence, 0.9);
  assert.equal((result.proposals[0].payload as any).id, "consulting");
  assert.equal((result.proposals[0].payload as any).monthlyNetAmountWan, 2.2);
});

test("repair duplicate rows collapse into one proposal", () => {
  const rejected = [{
    id: "end_salary", kind: "income_source_ended" as const, effectiveAtAgeInMonths: 700,
    payload: { incomeSourceId: "salary" }, sourceOutcomeId: "selected", evidence: "你结束全职工作。", confidence: 0.9
  }];
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    rejectedProposals: rejected,
    proposals: [{ id: "end_salary" }, { id: "end_salary", confidence: 0.95 }]
  });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].confidence, 0.95);
  assert.equal(result.audit.some((item) => item.reasonCode === "REPAIR_DUPLICATE_COLLAPSED"), true);
});

test("normalizes consultant income and fills the sole active career income id", () => {
  const currentLedger = initializeFinancialLedger({
    id: "career_income", asOfAgeInMonths: 696,
    openingPosition: { incomeSources: [{
      id: "legacy_salary", type: "other", displayName: "旧工资", annualNetAmountWan: 45,
      accrualPolicy: "annual", activeFromAgeInMonths: 696, status: "active", linkedCareerStateId: "career_old", factStatus: "estimated", evidence: []
    }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger, currentCareerStateId: "career_old", nextCareerStateIds: ["career_consultant"],
    proposals: [
      { id: "end_old", kind: "income_source_ended", effectiveAtAgeInMonths: 696, payload: {}, evidence: "你结束全职工作。", confidence: 0.9 },
      { id: "start_consulting", kind: "income_source_started", effectiveAtAgeInMonths: 696, payload: { id: "consulting", type: "consulting" }, evidence: "你转为顾问。", confidence: 0.9 }
    ]
  });
  assert.equal((result.proposals[0].payload as any).incomeSourceId, "legacy_salary");
  assert.equal((result.proposals[1].payload as any).type, "contract");
  assert.equal((result.proposals[1].payload as any).linkedCareerStateId, "career_consultant");
});

test("repair evidence is grounded to a verbatim consultant sentence", () => {
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    narrativeText: "你转为每周三天的顾问后，顾问年收入稳定在24万左右。家庭生活也慢了下来。",
    rejectedProposals: [{
      id: "consulting", kind: "income_source_started", effectiveAtAgeInMonths: 696,
      payload: { id: "consulting", type: "contract", annualNetAmountWan: 24 }, sourceOutcomeId: "selected",
      evidence: "顾问收入约24万元", confidence: 0.9
    }],
    proposals: [{ id: "consulting", evidence: "新的收入已经稳定" }]
  });
  assert.equal(result.proposals[0].evidence, "你转为每周三天的顾问后，顾问年收入稳定在24万左右。家庭生活也慢了下来。".split("家庭")[0]);
});

test("corrects a cash-account id used as the sole active income-source id and completes the next source shape", () => {
  const currentLedger = initializeFinancialLedger({ id: "typed_income", asOfAgeInMonths: 300, openingPosition: {
    cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 3, status: "active", factStatus: "known", evidence: [] }],
    incomeSources: [{ id: "salary_main", type: "salary", displayName: "工资", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: [] }]
  } });
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], currentLedger, currentCareerStateId: "career_current", proposals: [{ id: "adjust", kind: "income_source_adjusted", effectiveAtAgeInMonths: 312, payload: { incomeSourceId: PRIMARY_CASH_ACCOUNT_ID, nextSource: { monthlyNetAmountWan: 3 } }, evidence: "你涨薪到每月3万元。", confidence: 0.9 }] });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.incomeSourceId, "salary_main"); assert.equal(payload.nextSource.id, "salary_main"); assert.equal(payload.nextSource.displayName, "工资"); assert.equal(payload.nextSource.monthlyNetAmountWan, 3);
  assert.equal(result.audit.some((item) => item.reasonCode === "ACCOUNT_ID_TYPE_CORRECTED"), true);
});

test("normalizes a fixed option schedule and expiry into authoritative option terms", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "grant", kind: "business_option_granted", effectiveAtAgeInMonths: 348,
    payload: { optionHolding: {
      id: "employee_option", instrumentType: "stock_option", business: { id: "employer" },
      optionTerms: { grantedUnits: 30000, vestedUnits: 0, exercisedUnits: 0, strikePriceWanPerUnit: 0.001 },
      vestingSchedule: "4年归属，每年25%", expirationDateInMonths: 408,
      personalCarryingValueWan: 0, status: "active", factStatus: "estimated", evidence: []
    } }, evidence: "公司授予3万份期权，四年归属，每年25%。", confidence: 0.8
  }] });
  const terms = (result.proposals[0].payload as any).optionHolding.optionTerms;
  assert.deepEqual(terms.vestingPolicy, { totalMonths: 48, frequencyMonths: 12 });
  assert.equal(terms.expiresAtAgeInMonths, 408);
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_TERMS_NORMALIZED"), true);
});
