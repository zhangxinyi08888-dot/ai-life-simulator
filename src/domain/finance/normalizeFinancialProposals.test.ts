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

test("repairs an invented CareerState reference to the single accepted next state", () => {
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentCareerStateId: "career_current",
    nextCareerStateIds: ["career_authoritative_next"],
    proposals: [{
      id: "repaired_owner_draw",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 301,
      payload: {
        id: "owner_draw", type: "self_employment_draw", monthlyNetAmountWan: 4,
        linkedCareerStateId: "career_model_invented"
      },
      evidence: "公司向你个人账户支付4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal((result.proposals[0].payload as any).linkedCareerStateId, "career_authoritative_next");
});

test("anchors from-this-month recurring income to the current period start", () => {
  const currentLedger = initializeFinancialLedger({ id: "income_timing", asOfAgeInMonths: 295 });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_current",
    proposals: [{
      id: "salary_late_timestamp",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 304,
      sourceOutcomeId: "selected",
      payload: {
        id: "owner_salary", type: "self_employment_draw", monthlyNetAmountWan: 4,
        accrualPolicy: "monthly", activeFromAgeInMonths: 304, status: "active", factStatus: "known", evidence: []
      },
      evidence: "公司从本月起每月向你个人账户支付4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal(result.proposals[0].effectiveAtAgeInMonths, 295);
  assert.equal((result.proposals[0].payload as any).activeFromAgeInMonths, 295);
});

test("drops a no-op income adjustment instead of quarantining the authoritative source", () => {
  const currentLedger = initializeFinancialLedger({
    id: "income_noop",
    asOfAgeInMonths: 307,
    openingPosition: {
      incomeSources: [{
        id: "owner_salary", type: "self_employment_draw", displayName: "公司税后工资",
        monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 297,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_founder",
    proposals: [{
      id: "repeat_salary",
      kind: "income_source_adjusted",
      effectiveAtAgeInMonths: 315,
      sourceOutcomeId: "selected",
      payload: {
        incomeSourceId: "owner_salary",
        nextSource: {
          ...currentLedger.incomeSources[0],
          activeFromAgeInMonths: 307
        }
      },
      evidence: "你继续从公司每月领取4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.audit.some((item) => item.reasonCode === "NO_OP_PROPOSAL_DROPPED"), true);
});

test("normalizes a repeated income start for the same source id into an adjustment", () => {
  const currentLedger = initializeFinancialLedger({
    id: "income_existing",
    asOfAgeInMonths: 307,
    openingPosition: {
      incomeSources: [{
        id: "self_employment_draw_supplychain", type: "self_employment_draw", displayName: "创业月度提款",
        monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 295,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_founder",
    proposals: [{
      id: "raise_owner_salary",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 315,
      sourceOutcomeId: "selected",
      payload: {
        id: "self_employment_draw_supplychain", type: "self_employment_draw", displayName: "创业月度提款",
        monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 315,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      },
      evidence: "从本月起公司向你的个人账户每月支付4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal(result.proposals[0].kind, "income_source_adjusted");
  assert.equal((result.proposals[0].payload as any).incomeSourceId, "self_employment_draw_supplychain");
  assert.equal((result.proposals[0].payload as any).nextSource.monthlyNetAmountWan, 4);
  assert.equal(result.audit.some((item) => item.reasonCode === "INCOME_START_NORMALIZED_TO_ADJUSTMENT"), true);
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

test("normalizes a flat model debt draw into the authoritative cash-balanced payload", () => {
  const currentLedger = initializeFinancialLedger({
    id: "flat_debt_draw",
    asOfAgeInMonths: 384,
    openingPosition: { cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 30, status: "active", factStatus: "known", evidence: [] }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["borrow_for_studio"],
    currentLedger,
    proposals: [{
      id: "loan_drawn",
      kind: "debt_drawn",
      effectiveAtAgeInMonths: 390,
      payload: {
        id: "debt_loan_2024",
        type: "personal_business_loan",
        displayName: "个人经营贷款",
        principalAmountWan: 20,
        annualInterestRate: 0.06,
        termMonths: 36,
        monthlyPaymentWan: 0.6083,
        activeFromAgeInMonths: 390,
        status: "active",
        factStatus: "estimated",
        evidence: []
      },
      evidence: "银行完成20万元经营贷款放款。",
      confidence: 0.9
    }]
  });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.destinationCashAccountId, PRIMARY_CASH_ACCOUNT_ID);
  assert.equal(payload.principalDrawnWan, 20);
  assert.equal(payload.debtAccount.id, "debt_loan_2024");
  assert.equal(payload.debtAccount.type, "business_personal_guarantee");
  assert.equal(payload.debtAccount.principalWan, 20);
  assert.deepEqual(payload.debtAccount.repaymentPolicy, {
    mode: "known_schedule",
    monthlyPaymentWan: 0.6083,
    annualInterestRate: 0.06,
    remainingTermMonths: 36
  });
  assert.equal(result.audit.some((item) => item.reasonCode === "DEBT_DRAW_PAYLOAD_NORMALIZED"), true);
  assert.equal(result.audit.some((item) => item.reasonCode === "DEBT_TYPE_NORMALIZED"), true);
});

test("normalizes asset purchase price aliases and fills the cash source", () => {
  const currentLedger = initializeFinancialLedger({
    id: "asset_purchase_alias",
    asOfAgeInMonths: 384,
    openingPosition: { cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence: [] }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["choice_equipment"],
    currentLedger,
    proposals: [{
      id: "equipment_purchase",
      kind: "asset_purchased",
      effectiveAtAgeInMonths: 390,
      payload: {
        assetAccount: { id: "equipment", type: "business_asset", marketValueWan: 20 },
        purchasePriceWan: 20,
        linkedDebtDrawEventId: "loan_draw"
      },
      evidence: "贷款到账当天，你立即支付20万元购买设备。",
      confidence: 0.9
    }]
  });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.cashPaidWan, 20);
  assert.equal(payload.transactionFeeWan, 0);
  assert.equal(payload.sourceCashAccountId, PRIMARY_CASH_ACCOUNT_ID);
  assert.equal(result.audit.some((item) => item.reasonCode === "ASSET_PURCHASE_PAYLOAD_NORMALIZED"), true);
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

test("repair evidence for a debt draw is grounded to the completed disbursement sentence", () => {
  const sentence = "银行正式批准贷款，并将20万元全额放入你的现金账户。";
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    narrativeText: `${sentence}到账当天你支付20万元购买设备。`,
    rejectedProposals: [{
      id: "loan_draw", kind: "debt_drawn", effectiveAtAgeInMonths: 390,
      payload: { principalDrawnWan: 20 }, sourceOutcomeId: "selected",
      evidence: "贷款已经到账", confidence: 0.9
    }],
    proposals: [{ id: "loan_draw", evidence: "银行已经处理" }]
  });
  assert.equal(result.proposals[0].evidence, sentence);
});
