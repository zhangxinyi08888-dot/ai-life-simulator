import assert from "node:assert/strict";
import test from "node:test";
import { FinancialState } from "../types";
import { getFinancialStatusText, sanitizeFinancialNarrative } from "./financialNarrative";
import { initializeFinancialLedger } from "../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../domain/finance/ledgerMath";

const state: FinancialState = {
  currencyUnit: "CNY_WAN_REAL",
  asOfAgeInMonths: 40 * 12,
  cashWan: 6,
  investmentAssetsWan: 0,
  propertyMarketValueWan: 0,
  businessAndOtherAssetsWan: 0,
  totalDebtWan: 0,
  netWorthWan: 6,
  annualAfterTaxIncomeWan: 18,
  annualDisposableIncomeWan: 6,
  annualCoreExpenseWan: 12,
  employmentStatus: "employed",
  incomeStability: "stable",
  isEstimated: true
};

test("replaces precise current savings and balance totals", () => {
  assert.equal(
    sanitizeFinancialNarrative("目前存款约90万，但工作仍有风险。", state),
    "目前仍有一定现金缓冲，但工作仍有风险。"
  );
  assert.equal(
    sanitizeFinancialNarrative("存款从45万降至42万，现金流开始紧张。", state),
    "持续支出正在消耗现金缓冲，现金流开始紧张。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你看着银行余额里仅剩的800元，心里发紧。", state),
    "你看着仍有一定现金缓冲，心里发紧。"
  );
  assert.equal(
    sanitizeFinancialNarrative("净资产达到200万后，你开始重新规划生活。", state),
    "仍有一定现金缓冲后，你开始重新规划生活。"
  );
  assert.equal(
    sanitizeFinancialNarrative("存款因收入增加，目前约90万，但职业仍有风险。", state),
    "仍有一定现金缓冲，但职业仍有风险。"
  );
  assert.equal(
    sanitizeFinancialNarrative("消费贷到期后，现金还剩35.4万。", state),
    "消费贷到期后，仍有一定现金缓冲。"
  );
});

test("preserves salary, expenses and transaction amounts", () => {
  const description = "月薪2万，房租5000元，本月支付医疗费3万，并用存款支付60万首付、办理120万贷款。";
  assert.equal(sanitizeFinancialNarrative(description, state), description);
  const fundingGap = "首付需要100万，双方家庭能出50万，加上现有存款，还差约50万。";
  assert.equal(sanitizeFinancialNarrative(fundingGap, state), fundingGap);
});

test("derives qualitative wording from the calculated state", () => {
  assert.equal(getFinancialStatusText(state), "仍有一定现金缓冲");
  assert.equal(getFinancialStatusText({ ...state, cashWan: 2 }), "现金流十分紧张");
  assert.equal(getFinancialStatusText({ ...state, netWorthWan: -2 }), "整体仍处于负债状态");
  assert.equal(getFinancialStatusText({ ...state, cashWan: 20 }), "已经积累了一些储蓄");
});

test("rewrites monthly-versus-annual salary contradictions from the authoritative source", () => {
  const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];
  const ledger = initializeFinancialLedger({
    id: "salary_narrative",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 1, status: "active", factStatus: "known", evidence }],
      incomeSources: [{ id: "startup_salary", type: "salary", displayName: "创业公司工资", monthlyNetAmountWan: 1.25, accrualPolicy: "monthly", activeFromAgeInMonths: 289, status: "active", linkedCareerStateId: "career_startup", factStatus: "estimated", evidence }]
    }
  });
  assert.equal(
    sanitizeFinancialNarrative("你的月薪从22万降到15万，但仍决定加入。", state, ledger),
    "你的当前税后月薪约1.25万元，但仍决定加入。"
  );
  assert.equal(
    sanitizeFinancialNarrative("到年底，你个人累计债务约18万元，公司仍在融资。", { ...state, totalDebtWan: 44.6651 }, ledger),
    "到年底，你个人总负债为44.6651万元，公司仍在融资。"
  );
});
