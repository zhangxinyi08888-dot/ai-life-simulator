import { assertFinancialLedgerInvariants, PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type {
  AssetAccount,
  BusinessHolding,
  CashAccount,
  DebtAccount,
  ExpenseCommitment,
  FinancialLedgerIssue,
  FinancialLedgerV3,
  IncomeSource
} from "./types";

export interface AcceptedOpeningFinancialPosition {
  cashAccounts?: CashAccount[];
  assetAccounts?: AssetAccount[];
  debtAccounts?: DebtAccount[];
  incomeSources?: IncomeSource[];
  expenseCommitments?: ExpenseCommitment[];
  businessHoldings?: BusinessHolding[];
  unresolvedIssues?: FinancialLedgerIssue[];
}

export function normalizeDebtAccountV3(account: DebtAccount): DebtAccount {
  const isAutomaticShortfall = account.type === "liquidity_shortfall"
    && account.origin !== "explicit"
    && account.origin !== "legacy_migration";
  return {
    ...structuredClone(account),
    repaymentPolicy: isAutomaticShortfall
      ? { mode: "event_driven" }
      : structuredClone(account.repaymentPolicy),
    origin: account.origin ?? (account.type === "liquidity_shortfall" ? "system_auto_shortfall" : "explicit"),
    accruedUnpaidInterestWan: roundWan(account.accruedUnpaidInterestWan ?? 0),
    servicingStatus: account.servicingStatus ?? "current",
    consecutiveMissedPaymentMonths: account.consecutiveMissedPaymentMonths ?? 0,
    totalMissedPaymentMonths: account.totalMissedPaymentMonths ?? 0,
    recentMissedPaymentAgeInMonths: [...(account.recentMissedPaymentAgeInMonths ?? [])]
  };
}

export function initializeFinancialLedger(input: {
  id: string;
  asOfAgeInMonths: number;
  openingPosition?: AcceptedOpeningFinancialPosition;
}): FinancialLedgerV3 {
  const opening = input.openingPosition || {};
  const cashAccounts = opening.cashAccounts?.length
    ? opening.cashAccounts.map((account) => ({ ...account, balanceWan: roundWan(account.balanceWan) }))
    : [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit" as const,
        balanceWan: 0,
        status: "active" as const,
        factStatus: "known" as const,
        evidence: []
      }];
  const ledger: FinancialLedgerV3 = {
    id: input.id,
    owner: "protagonist",
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: input.asOfAgeInMonths,
    cashAccounts,
    assetAccounts: structuredClone(opening.assetAccounts || []),
    debtAccounts: (opening.debtAccounts || []).map(normalizeDebtAccountV3),
    incomeSources: structuredClone(opening.incomeSources || []),
    expenseCommitments: structuredClone(opening.expenseCommitments || []),
    businessHoldings: structuredClone(opening.businessHoldings || []),
    recentTransactions: [],
    committedTransactionIds: [],
    unresolvedIssues: structuredClone(opening.unresolvedIssues || []),
    revision: 0,
    version: 3
  };
  assertFinancialLedgerInvariants(ledger);
  return ledger;
}
