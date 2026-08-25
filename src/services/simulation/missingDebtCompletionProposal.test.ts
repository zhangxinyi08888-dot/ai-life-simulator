import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger, normalizeFinancialProposals } from "../../domain/finance";
import { synthesizeMissingDebtCompletionProposals } from "./simulationService";

const mortgageLedger = initializeFinancialLedger({
  id: "selected_restructure",
  asOfAgeInMonths: 334,
  openingPosition: {
    debtAccounts: [{
      id: "opening_mortgage",
      type: "mortgage",
      displayName: "住房按揭",
      principalWan: 188.775,
      openedAtAgeInMonths: 288,
      status: "active",
      repaymentPolicy: { mode: "estimated_amortizing", monthlyPaymentWan: 1.3, monthlyInterestWan: 0.425 },
      factStatus: "known",
      evidence: []
    }]
  }
});

test("missing debt synthesis does not turn an existing mortgage servicing restatement into a new draw", () => {
  const proposals = synthesizeMissingDebtCompletionProposals({
    proposals: [],
    narrativeText: "你向银行申请延长还款期限。房贷剩余本金188.775万元，月供1.3万元。",
    acceptedOutcomeId: "request_debt_restructuring",
    effectiveAtAgeInMonths: 335
  });

  assert.deepEqual(proposals, []);
});

test("missing debt synthesis keeps completed restructure detection without fabricating a draw", () => {
  const proposals = synthesizeMissingDebtCompletionProposals({
    proposals: [],
    narrativeText: "银行已经批准将贷款展期至60个月，月供已降至0.34万元。",
    acceptedOutcomeId: "request_debt_restructuring",
    effectiveAtAgeInMonths: 409
  });

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "debt_restructured");
});

test("an explicitly accepted completed mortgage restructure binds the selected debt before normalization", () => {
  const proposals = synthesizeMissingDebtCompletionProposals({
    proposals: [],
    selectedDecision: "接受银行提出的延长还款期限方案，把月供从1.3万元降到约8000元。",
    narrativeText: "银行的新还款方案已经正式生效，月供从1.3万元降到约8000元。",
    acceptedOutcomeId: "extend_repayment_term",
    effectiveAtAgeInMonths: 344,
    currentLedger: mortgageLedger
  });

  assert.equal(proposals[0]?.kind, "debt_restructured");
  assert.equal((proposals[0]?.payload as any).oldDebtAccountId, "opening_mortgage");
  assert.equal(proposals[0]?.confidence, 1);
  const normalized = normalizeFinancialProposals({
    proposals,
    acceptedOutcomeIds: ["extend_repayment_term"],
    currentLedger: mortgageLedger
  });
  const replacement = (normalized.proposals[0]?.payload as any).replacementDebtAccount;
  assert.equal(replacement.principalWan, 188.775);
  assert.equal(replacement.repaymentPolicy.monthlyPaymentWan, 0.8);
  assert.equal(replacement.factStatus, "needs_review");
});

test("a pending or ambiguous restructure remains repair-only", () => {
  const pending = synthesizeMissingDebtCompletionProposals({
    proposals: [],
    selectedDecision: "申请调整房贷还款安排。",
    narrativeText: "银行已经批准重组，月供从1.3万元降到0.8万元。",
    acceptedOutcomeId: "request_debt_restructuring",
    effectiveAtAgeInMonths: 344,
    currentLedger: mortgageLedger
  });
  assert.deepEqual(pending[0]?.payload, {});
  assert.equal(pending[0]?.confidence, 0);
});

test("missing debt synthesis still marks an explicit new-loan disbursement for repair", () => {
  const proposals = synthesizeMissingDebtCompletionProposals({
    proposals: [],
    narrativeText: "银行已向你的个人账户放款20万元经营贷，资金到账。",
    acceptedOutcomeId: "request_business_loan",
    effectiveAtAgeInMonths: 409
  });

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "debt_drawn");
  assert.match(proposals[0].evidence, /放款20万元经营贷/u);
});

test("missing debt synthesis keeps company financing outside the protagonist debt ledger", () => {
  const proposals = synthesizeMissingDebtCompletionProposals({
    proposals: [],
    narrativeText: "公司这边，天使融资款正式到账，团队扩到二十多人。你仍在支付房租。",
    acceptedOutcomeId: "strengthen_shared_routine",
    effectiveAtAgeInMonths: 382
  });

  assert.deepEqual(proposals, []);
});
