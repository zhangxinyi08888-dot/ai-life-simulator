import { assertFinancialLedgerInvariants } from "./ledgerMath";
import type { FinancialLedger } from "./types";

/**
 * Prospective policy migration: old system-created cash-floor debt is not a
 * user-authorised borrowing fact. Retire it at a restore boundary without
 * touching explicit or legacy-migration debt and without rewriting history.
 */
export function retireSystemAutoShortfallDebt<T extends FinancialLedger>(input: T): T {
  const ledger = structuredClone(input);
  const retiredIds: string[] = [];
  for (const account of ledger.debtAccounts) {
    if (account.origin !== "system_auto_shortfall" || account.status === "repaid") continue;
    retiredIds.push(account.id);
    account.principalWan = 0;
    account.accruedUnpaidInterestWan = 0;
    account.status = "repaid";
    account.closedAtAgeInMonths = ledger.asOfAgeInMonths;
    account.servicingStatus = "current";
    account.consecutiveMissedPaymentMonths = 0;
    account.evidence = [
      ...account.evidence,
      {
        source: "system_policy",
        reasonCode: "SYSTEM_AUTO_SHORTFALL_RETIRED_V1",
        excerpt: "旧版系统自动资金缺口不是用户明确接受的借款，恢复时停止计提并撤销余额",
        confidence: 1,
        financialScope: "personal"
      }
    ];
  }
  if (retiredIds.length === 0) return ledger;
  for (const issue of ledger.unresolvedIssues) {
    if (issue.status !== "resolved"
      && issue.code === "LIQUIDITY_SHORTFALL_PERSISTED"
      && issue.relatedDebtAccountIds?.some((id) => retiredIds.includes(id))) {
      issue.status = "resolved";
      issue.resolvedAtAgeInMonths = ledger.asOfAgeInMonths;
      issue.resolvedByEventId = "system_auto_shortfall_retirement_v1";
    }
  }
  const auditId = `system_auto_shortfall_retired_${ledger.asOfAgeInMonths}`;
  if (!ledger.unresolvedIssues.some((issue) => issue.id === auditId)) {
    ledger.unresolvedIssues.push({
      id: auditId,
      code: "LEGACY_UNCERTAINTY",
      severity: "warning",
      status: "resolved",
      relatedProposalIds: [],
      relatedDebtAccountIds: retiredIds,
      summary: "已停止并撤销旧版系统自动资金缺口；明确借款未受影响",
      createdAtAgeInMonths: ledger.asOfAgeInMonths,
      resolvedAtAgeInMonths: ledger.asOfAgeInMonths,
      resolvedByEventId: "system_auto_shortfall_retirement_v1"
    });
  }
  assertFinancialLedgerInvariants(ledger);
  return ledger;
}
