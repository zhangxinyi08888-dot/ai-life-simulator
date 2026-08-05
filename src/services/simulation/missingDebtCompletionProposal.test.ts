import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeMissingDebtCompletionProposals } from "./simulationService";

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
