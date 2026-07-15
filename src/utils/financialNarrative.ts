import { FinancialState } from "../types";

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

export function sanitizeFinancialNarrative(description: string, state: FinancialState): string {
  if (!description) return description;
  return description
    .replace(BALANCE_RANGE, (match) => replaceBalanceTotal(match, state))
    .replace(BALANCE_TOTAL, (match) => replaceBalanceTotal(match, state));
}
