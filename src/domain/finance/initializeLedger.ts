import { assertFinancialLedgerInvariants, PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type {
  AssetAccount,
  BusinessHolding,
  CashAccount,
  DebtAccount,
  ExpenseCommitment,
  FinancialLedger,
  FinancialLedgerIssue,
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

export function initializeFinancialLedger(input: {
  id: string;
  asOfAgeInMonths: number;
  openingPosition?: AcceptedOpeningFinancialPosition;
}): FinancialLedger {
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
  const ledger: FinancialLedger = {
    id: input.id,
    owner: "protagonist",
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: input.asOfAgeInMonths,
    cashAccounts,
    assetAccounts: structuredClone(opening.assetAccounts || []),
    debtAccounts: structuredClone(opening.debtAccounts || []),
    incomeSources: structuredClone(opening.incomeSources || []),
    expenseCommitments: structuredClone(opening.expenseCommitments || []),
    businessHoldings: structuredClone(opening.businessHoldings || []),
    recentTransactions: [],
    committedTransactionIds: [],
    unresolvedIssues: structuredClone(opening.unresolvedIssues || []),
    revision: 0,
    version: 2
  };
  assertFinancialLedgerInvariants(ledger);
  return ledger;
}
