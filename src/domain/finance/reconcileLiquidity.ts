import { FinancialLedgerInvariantError, roundWan } from "./ledgerMath";
import type { FinancialLedger } from "./types";

export interface LiquidityShortfall {
  cashAccountId: string;
  shortfallWan: number;
  atAgeInMonths: number;
}

export function findLiquidityShortfall(
  ledger: FinancialLedger,
  atAgeInMonths: number
): LiquidityShortfall | undefined {
  const account = ledger.cashAccounts.find((candidate) => candidate.status === "active" && candidate.balanceWan < 0);
  if (!account) return undefined;
  return {
    cashAccountId: account.id,
    shortfallWan: roundWan(-account.balanceWan),
    atAgeInMonths
  };
}

export function assertSufficientLiquidity(ledger: FinancialLedger, atAgeInMonths: number): void {
  const shortfall = findLiquidityShortfall(ledger, atAgeInMonths);
  if (!shortfall) return;
  throw new FinancialLedgerInvariantError(
    "MISSING_FUNDING_SOURCE",
    `现金账户 ${shortfall.cashAccountId} 在 ${shortfall.atAgeInMonths} 月龄仍有缺口 ${shortfall.shortfallWan} 万元；需在同一时间点补充有方向资金来源`
  );
}
