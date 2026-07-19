import assert from "node:assert/strict";
import test from "node:test";
import { duplicateSingletonExpenseTypes, personalCompensationAnnualAmounts, personalLedgerBusinessBoundaryViolations } from "./financial-real-browser-audit-helpers.mjs";

test("detects company revenue and team payroll in a personal ledger", () => {
  const result = personalLedgerBusinessBoundaryViolations({
    incomeSources: [
      { id: "saas", status: "active", displayName: "公司 SaaS 年费收入" },
      { id: "salary", status: "active", displayName: "公司向你支付的税后工资" },
      { id: "dividend", status: "active", displayName: "个人分红" }
    ],
    expenseCommitments: [
      { id: "team", status: "active", displayName: "公司团队工资及运营成本" },
      { id: "living", status: "active", displayName: "个人基本生活费" }
    ]
  });
  assert.deepEqual(result, { incomeSourceIds: ["saas"], expenseCommitmentIds: ["team"] });
});

test("flags duplicate basic-living and housing baselines but allows multiple care obligations", () => {
  assert.deepEqual(duplicateSingletonExpenseTypes({ expenseCommitments: [
    { id: "living_1", status: "active", type: "basic_living" },
    { id: "living_2", status: "active", type: "basic_living" },
    { id: "home_1", status: "active", type: "housing" },
    { id: "home_2", status: "active", type: "housing" },
    { id: "parent", status: "active", type: "dependent_support" },
    { id: "child", status: "active", type: "dependent_support" }
  ]}), ["basic_living", "housing"]);
});

test("keeps a personal product-consulting contract out of business revenue violations", () => {
  assert.deepEqual(personalLedgerBusinessBoundaryViolations({ incomeSources: [{
    id: "income_consulting", type: "contract", displayName: "AI产品顾问收入", status: "active", evidence: []
  }] }), { incomeSourceIds: [], expenseCommitmentIds: [] });
});

test("flags spouse salary in a protagonist ledger", () => {
  assert.deepEqual(personalLedgerBusinessBoundaryViolations({ incomeSources: [{
    id: "income_xiaoyu", type: "salary", displayName: "小余出纳工作", status: "active", evidence: []
  }] }), { incomeSourceIds: ["income_xiaoyu"], expenseCommitmentIds: [] });
});

test("extracts protagonist compensation without treating company revenue or staff payroll as salary", () => {
  assert.deepEqual(personalCompensationAnnualAmounts("你被任命为负责人，薪资调整为年薪42万元（月薪3.5万）。公司月收入达到4万元。"), [42, 42]);
  assert.deepEqual(personalCompensationAnnualAmounts("你招聘一位专职会计，月薪4500元。中心月收入达到10万元。"), []);
  assert.deepEqual(personalCompensationAnnualAmounts("你给自己维持月薪1万。"), [12]);
  assert.deepEqual(personalCompensationAnnualAmounts("猎头邀请你担任产品VP，年薪60万加期权。"), []);
  assert.deepEqual(personalCompensationAnnualAmounts("你决定接受VP offer，年薪65万加期权。"), [65]);
  assert.deepEqual(personalCompensationAnnualAmounts("你接受顾问工作，税后月薪0.8万元，并聘请护工，月薪0.25万元。"), [9.6]);
});
