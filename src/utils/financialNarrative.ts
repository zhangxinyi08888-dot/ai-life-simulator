import { FinancialState } from "../types";
import type { FinancialLedger } from "../domain/finance/types";

const MONEY_AMOUNT = String.raw`-?\d+(?:\.\d+)?\s*(?:万元?|万|元)`;
const BALANCE_TERM = String.raw`(?:现金及存款|现金余额|银行余额|账户余额|存款|积蓄|净资产|身家|累计财富|现金)`;
const BALANCE_RANGE = new RegExp(
  `${BALANCE_TERM}[^，。！？；]{0,36}?(?:从|由)\s*${MONEY_AMOUNT}[^，。！？；]{0,16}?(?:降至|降到|增至|增加到|变为|达到)\s*${MONEY_AMOUNT}`,
  "g"
);
const BALANCE_TOTAL = new RegExp(
  `${BALANCE_TERM}[^。！？；]{0,64}?${MONEY_AMOUNT}`,
  "g"
);
const TRANSACTION_CONTEXT = /支付|付了|拿出|投入|用于|花费|支援|借出|偿还|入账|收到|获得|首付|贷款|房贷|医疗费|学费|房租|项目收入|稿费|月薪|工资|还差|缺口/;
const DECLINING_BALANCE = /从|由|降至|降到|减少|消耗|见底/;

export function getFinancialStatusText(state: FinancialState): string {
  const monthlyExpense = state.annualCoreExpenseWan / 12;
  const coverageMonths = monthlyExpense > 0 ? state.cashWan / monthlyExpense : Number.POSITIVE_INFINITY;
  if (state.netWorthWan < 0) return "整体仍处于负债状态";
  if (coverageMonths < 3) return "现金流十分紧张";
  if (coverageMonths < 12) return "仍有一定现金缓冲";
  return "已经积累了一些储蓄";
}

function replaceBalanceTotal(match: string, state: FinancialState): string {
  if (TRANSACTION_CONTEXT.test(match)) return match;
  if (DECLINING_BALANCE.test(match)) return "持续支出正在消耗现金缓冲";
  return getFinancialStatusText(state);
}

function formatWan(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function sanitizeRecurringIncomeClaims(description: string, ledger?: FinancialLedger): string {
  if (!ledger) return description;
  const careerIncome = ledger.incomeSources.filter((source) => (
    source.status === "active" && Boolean(source.linkedCareerStateId) && source.accrualPolicy !== "event_only"
  ));
  if (careerIncome.length !== 1) return description;
  const source = careerIncome[0];
  const monthlyWan = source.accrualPolicy === "annual"
    ? (source.annualNetAmountWan || 0) / 12
    : source.monthlyNetAmountWan || 0;
  const annualWan = source.accrualPolicy === "annual"
    ? source.annualNetAmountWan || 0
    : monthlyWan * 12;
  if (monthlyWan <= 0 || annualWan <= 0) return description;
  return description
    .replace(/(?:税后)?月薪(?:从|由)\s*\d+(?:\.\d+)?\s*万(?:元)?[^，。；！？]{0,16}?(?:降至|降到|增至|增加到|变为|达到)\s*\d+(?:\.\d+)?\s*万(?:元)?/gu, `当前税后月薪约${formatWan(monthlyWan)}万元`)
    .replace(/((?:税后)?月薪(?:约|为|达到|降至|降到)?\s*)(\d+(?:\.\d+)?)\s*万(?:元)?/gu, (match, prefix: string, raw: string) => (
      Math.abs(Number(raw) - monthlyWan) <= Math.max(0.01, monthlyWan * 0.01)
        ? match
        : `${prefix}${formatWan(monthlyWan)}万元`
    ))
    .replace(/((?:税后)?年薪(?:约|为|达到|降至|降到)?\s*)(\d+(?:\.\d+)?)\s*万(?:元)?/gu, (match, prefix: string, raw: string) => (
      Math.abs(Number(raw) - annualWan) <= Math.max(0.01, annualWan * 0.01)
        ? match
        : `${prefix}${formatWan(annualWan)}万元`
    ));
}

function sanitizePersonalDebtClaims(description: string, state: FinancialState): string {
  return description.replace(/(?:你(?:的)?|个人|家庭)(?:累计|当前|总计)?(?:总)?(?:债务|负债)(?:约|为|达到|升至|增加到)?\s*-?\d+(?:\.\d+)?\s*万(?:元)?/gu, `个人总负债为${formatWan(state.totalDebtWan)}万元`);
}

export function sanitizeFinancialNarrative(description: string, state: FinancialState, ledger?: FinancialLedger): string {
  if (!description) return description;
  return sanitizePersonalDebtClaims(sanitizeRecurringIncomeClaims(description, ledger), state)
    .replace(BALANCE_RANGE, (match) => replaceBalanceTotal(match, state))
    .replace(BALANCE_TOTAL, (match) => replaceBalanceTotal(match, state));
}
