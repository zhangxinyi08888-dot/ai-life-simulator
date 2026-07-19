import assert from "node:assert/strict";
import test from "node:test";
import { duplicateSingletonExpenseTypes, personalLedgerBusinessBoundaryViolations } from "./financial-real-browser-audit-helpers.mjs";

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
