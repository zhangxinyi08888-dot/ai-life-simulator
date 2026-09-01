import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "./initializeLedger";
import { retireSystemAutoShortfallDebt } from "./retireSystemAutoShortfall";
import type { FinancialLedgerV3 } from "./types";

test("restore retirement removes only system-created shortfall debt and is idempotent", () => {
  const ledger = initializeFinancialLedger({ id: "retire_shortfall", asOfAgeInMonths: 360 }) as FinancialLedgerV3;
  ledger.debtAccounts = [{
    id: "automatic_gap",
    type: "liquidity_shortfall",
    displayName: "系统自动资金缺口",
    principalWan: 7,
    openedAtAgeInMonths: 348,
    status: "active",
    repaymentPolicy: { mode: "event_driven" },
    factStatus: "known",
    evidence: [{ source: "system_policy", reasonCode: "SYSTEM_AUTO_SHORTFALL", confidence: 1 }],
    origin: "system_auto_shortfall",
    accruedUnpaidInterestWan: 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: []
  }, {
    id: "accepted_loan",
    type: "family_or_personal_loan",
    displayName: "明确借款",
    principalWan: 2,
    openedAtAgeInMonths: 350,
    status: "active",
    repaymentPolicy: { mode: "event_driven" },
    factStatus: "known",
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "ACCEPTED_LOAN", confidence: 1 }],
    origin: "explicit",
    accruedUnpaidInterestWan: 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: []
  }];
  const retired = retireSystemAutoShortfallDebt(ledger);
  assert.equal(retired.debtAccounts[0].principalWan, 0);
  assert.equal(retired.debtAccounts[0].status, "repaid");
  assert.equal(retired.debtAccounts[1].principalWan, 2);
  assert.equal(retired.debtAccounts[1].status, "active");
  assert.ok(retired.unresolvedIssues.some((issue) => issue.id.startsWith("system_auto_shortfall_retired_") && issue.status === "resolved"));
  assert.deepEqual(retireSystemAutoShortfallDebt(retired), retired);
});
