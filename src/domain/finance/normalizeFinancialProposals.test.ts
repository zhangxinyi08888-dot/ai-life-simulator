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

test("completes long-tail recurring income and expense shapes from deterministic aliases", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [
    { id: "stipend", kind: "income_source_started", effectiveAtAgeInMonths: 300, payload: { type: "stipend", accrualPolicy: "recurring_monthly" }, evidence: "你每月获得4500元补贴。", confidence: 0.9 },
    { id: "caregiver", kind: "expense_commitment_started", effectiveAtAgeInMonths: 300, payload: { type: "caregiver" }, evidence: "你每月支付护工6000元。", confidence: 0.9 }
  ] });
  const income = result.proposals[0].payload as any;
  const expense = result.proposals[1].payload as any;
  assert.equal(income.type, "other");
  assert.equal(income.accrualPolicy, "monthly");
  assert.equal(income.monthlyNetAmountWan, 0.45);
  assert.equal(income.status, "active");
  assert.equal(expense.type, "dependent_support");
  assert.equal(expense.monthlyAmountWan, 0.6);
  assert.equal(expense.status, "active");
});

test("completes late-discovered mortgage shape without inventing current cash movement", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "old_mortgage", kind: "debt_balance_discovered", effectiveAtAgeInMonths: 400,
    payload: { debt: { accountId: "mortgage_home", amountWan: 120 } },
    evidence: "你名下住房尚有120万元房贷余额。", confidence: 0.9
  }] });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.debtAccount.id, "mortgage_home");
  assert.equal(payload.debtAccount.type, "mortgage");
  assert.equal(payload.debtAccount.principalWan, 120);
  assert.equal(payload.debtAccount.repaymentPolicy.mode, "estimated_amortizing");
  assert.equal(payload.destinationCashAccountId, undefined);
});

test("normalizes residential purchase aliases and explicit price without inventing a valuation", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "home_purchase", kind: "asset_purchased", effectiveAtAgeInMonths: 422,
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      cashPaidWan: 54,
      transactionFeeWan: 0,
      linkedDebtDrawEventId: "mortgage_draw",
      assetAccount: { id: "home", type: "residential_property", factStatus: "confirmed" }
    },
    evidence: "你买下一套两居室，总价180万，首付54万，组合贷款126万。", confidence: 0.9
  }] });
  const account = (result.proposals[0].payload as any).assetAccount;
  assert.equal(account.type, "property");
  assert.equal(account.marketValueWan, 180);
  assert.equal(account.factStatus, "known");
});

test("keeps an unknown discovered property as needs-review zero carrying value", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "old_home", kind: "asset_balance_discovered", effectiveAtAgeInMonths: 422,
    payload: { asset: { accountId: "home", type: "house" } },
    evidence: "你仍住在自己名下的房子里，但当前估值不清楚。", confidence: 0.9
  }] });
  const account = (result.proposals[0].payload as any).assetAccount;
  assert.equal(account.type, "property");
  assert.equal(account.marketValueWan, 0);
  assert.equal(account.factStatus, "needs_review");
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

test("preserves policy evidence when an expense adjustment omits it", () => {
  const currentLedger = initializeFinancialLedger({ id: "expense_evidence", asOfAgeInMonths: 288, openingPosition: {
    expenseCommitments: [{
      id: "living_policy", type: "basic_living", displayName: "基础生活支出（系统保守估计）",
      monthlyAmountWan: 0.15, activeFromAgeInMonths: 216, status: "active", factStatus: "estimated",
      evidence: [{ source: "system_policy", reasonCode: "STUDENT_BASIC_LIVING_ESTIMATED_V1", confidence: 0.6 }]
    }]
  } });
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], currentLedger, proposals: [{
    id: "adjust_living", kind: "expense_commitment_adjusted", effectiveAtAgeInMonths: 300,
    payload: { expenseCommitmentId: "living_policy", nextCommitment: { monthlyAmountWan: 0.15, evidence: [] } },
    evidence: "生活支出仍按估计处理。", confidence: 0.9
  }] });
  const next = (result.proposals[0].payload as any).nextCommitment;
  assert.equal(next.evidence[0].source, "system_policy");
  assert.equal(result.audit.some((item) => item.reasonCode === "EXPENSE_EVIDENCE_PRESERVED"), true);
});

test("normalizes a fixed option schedule and expiry into authoritative option terms", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "grant", kind: "business_option_granted", effectiveAtAgeInMonths: 348,
    payload: { optionHolding: {
      id: "employee_option", instrumentType: "stock_option", business: { id: "employer" },
      optionTerms: { grantedUnits: 30000, vestedUnits: 0, exercisedUnits: 0, strikePriceWanPerUnit: 0.001 },
      vestingSchedule: "4年归属，每年25%", expirationDateInMonths: 408,
      personalCarryingValueWan: 0, status: "active", factStatus: "estimated", evidence: []
    } }, evidence: "公司授予3万份期权，四年归属，每年25%，34岁到期。", confidence: 0.8
  }] });
  const terms = (result.proposals[0].payload as any).optionHolding.optionTerms;
  assert.deepEqual(terms.vestingPolicy, { totalMonths: 48, frequencyMonths: 12 });
  assert.equal(terms.expiresAtAgeInMonths, 408);
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_TERMS_NORMALIZED"), true);
});

test("does not turn a vesting period into an unsupported option expiry", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "grant_without_expiry", kind: "business_option_granted", effectiveAtAgeInMonths: 297,
    payload: { optionHolding: {
      id: "startup_option", instrumentType: "stock_option", business: { id: "startup" },
      optionTerms: { grantedUnits: 8000, vestedUnits: 0, exercisedUnits: 0, strikePriceWanPerUnit: 0.001, expiresAtAgeInMonths: 336 },
      vestingSchedule: "4年归属，每年25%", personalCarryingValueWan: 0, status: "active", factStatus: "estimated", evidence: []
    } }, evidence: "公司承诺期权分四年归属。", confidence: 0.9
  }] });
  assert.equal((result.proposals[0].payload as any).optionHolding.optionTerms.expiresAtAgeInMonths, undefined);
});

test("unwraps a nested partial equity holding without inventing a valuation", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "founder_equity", kind: "business_holding_started", effectiveAtAgeInMonths: 405,
    payload: { businessHolding: { holdingId: "founder_share", instrumentType: "non_listed_equity", ownershipRate: 0.4, companyName: "供应链软件公司" } },
    evidence: "新的股权结构为：你占40%。", confidence: 0.9
  }] });
  const holding = result.proposals[0].payload as any;
  assert.equal(holding.id, "founder_share");
  assert.equal(holding.business.displayName, "供应链软件公司");
  assert.equal(holding.ownershipRate, 0.4);
  assert.equal(holding.instrumentType, "equity");
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.factStatus, "needs_review");
  assert.equal(result.audit.some((item) => item.reasonCode === "BUSINESS_HOLDING_SHAPE_COMPLETED"), true);
});

test("converts a stock-option holding event and nested grant aliases to the option contract", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "my_options", kind: "business_holding_started", effectiveAtAgeInMonths: 348,
    payload: { holding: {
      holdingId: "employee_options", instrumentType: "stock_option", companyId: "employer",
      optionTerms: { grantedUnits: 30000 }, vestingSchedule: "4年归属，每年25%"
    } }, evidence: "公司授予你3万份期权，四年归属，每年25%。", confidence: 0.9
  }] });
  assert.equal(result.proposals[0].kind, "business_option_granted");
  const holding = (result.proposals[0].payload as any).optionHolding;
  assert.equal(holding.id, "employee_options");
  assert.equal(holding.instrumentType, "stock_option");
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.optionTerms.vestedUnits, 0);
  assert.deepEqual(holding.optionTerms.vestingPolicy, { totalMonths: 48, frequencyMonths: 12 });
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_EVENT_NORMALIZED"), true);
});

test("normalizes long-tail option aliases and keeps unknown option value out of wealth", () => {
  const currentLedger = initializeFinancialLedger({
    id: "existing_equity", asOfAgeInMonths: 360,
    openingPosition: {
      businessHoldings: [{
        id: "startup_equity", instrumentType: "equity", personalCarryingValueWan: 0,
        status: "active", factStatus: "needs_review", evidence: [],
        business: { id: "startup", displayName: "创业公司", status: "operating", factStatus: "known", evidence: [] }
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger,
    proposals: [{
      id: "grant_alias", kind: "stock_option_grant", effectiveAtAgeInMonths: 368,
      payload: { optionHolding: { id: "startup_equity", displayName: "创业公司10%期权", businessId: "startup" } },
      evidence: "你持有创业公司10%的期权，但归属和行权条件仍待确认。", confidence: 0.9
    }]
  });
  assert.equal(result.proposals[0].kind, "business_option_granted");
  const holding = (result.proposals[0].payload as any).optionHolding;
  assert.equal(holding.id, "startup_equity_stock_option");
  assert.equal(holding.instrumentType, "stock_option");
  assert.equal(holding.optionTerms.grantedUnits, 0);
  assert.equal(holding.optionTerms.vestedUnits, 0);
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.factStatus, "needs_review");
});

test("recognizes option semantics in a generic holding event even when units are absent", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "generic_option", kind: "business_holding_started", effectiveAtAgeInMonths: 368,
    payload: { id: "employee_right", displayName: "员工期权", businessId: "employer" },
    evidence: "公司确认你拥有员工期权，具体份额待补充。", confidence: 0.85
  }] });
  assert.equal(result.proposals[0].kind, "business_option_granted");
  const holding = (result.proposals[0].payload as any).optionHolding;
  assert.equal(holding.optionTerms.grantedUnits, 0);
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.factStatus, "needs_review");
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_UNITS_UNKNOWN"), true);
});
