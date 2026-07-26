import assert from "node:assert/strict";
import test from "node:test";
import {
  adultBelowPolicyExpenseViolation,
  collectRecoveredGenerationAttempts,
  collectVisibleGenerationPauses,
  classifyTerminalFinancialIssues,
  duplicateSingletonExpenseTypes,
  personalCompensationAnnualAmounts,
  personalLedgerBusinessBoundaryViolations
} from "./financial-real-browser-audit-helpers.mjs";

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

test("keeps evidence-scoped personal consulting fees out of company revenue violations", () => {
  assert.deepEqual(personalLedgerBusinessBoundaryViolations({ incomeSources: [{
    id: "consultant_income_ai_tool_630",
    type: "other",
    displayName: "AI医疗创业公司顾问费",
    status: "active",
    evidence: [{
      financialScope: "personal",
      excerpt: "顾问收入每月1万"
    }]
  }] }), { incomeSourceIds: [], expenseCommitmentIds: [] });
});

test("does not let personal scope relabel company operating revenue as consulting income", () => {
  assert.deepEqual(personalLedgerBusinessBoundaryViolations({ incomeSources: [{
    id: "company_revenue",
    type: "other",
    displayName: "AI医疗创业公司月营收",
    status: "active",
    evidence: [{
      financialScope: "personal",
      excerpt: "公司月收入达到20万"
    }]
  }] }), { incomeSourceIds: ["company_revenue"], expenseCommitmentIds: [] });
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
  assert.deepEqual(personalCompensationAnnualAmounts("这意味着你要辞掉现在18万的稳定工作，去一个年薪22万但没有保障的新公司。你最终没有接受。"), []);
  assert.deepEqual(personalCompensationAnnualAmounts("你想起那种踏实感是以前年薪32万时才有的。"), []);
  assert.deepEqual(personalCompensationAnnualAmounts("你辞去了年薪38万元的工作，开始创业。"), []);
  assert.deepEqual(personalCompensationAnnualAmounts("你正式入职，税后月薪6000元，加上兼职收入每月总计约1.1万元。"), [13.2]);
});

test("accepts an exact evidence-backed low-cost living arrangement without weakening the adult default floor", () => {
  const exactLowCostLedger = {
    expenseCommitments: [{
      id: "rural_living",
      type: "basic_living",
      monthlyAmountWan: 0.15,
      status: "active",
      factStatus: "known",
      evidence: [{
        source: "accepted_simulation_outcome",
        reasonCode: "EVIDENCE_EXACT_MATCHED",
        financialScope: "personal",
        excerpt: "你住在父母家，生活成本降到每月1500元。"
      }]
    }]
  };
  assert.equal(adultBelowPolicyExpenseViolation({
    ageInMonths: 360,
    financialState: { employmentStatus: "self_employed", annualCoreExpenseWan: 1.8 },
    ledger: exactLowCostLedger
  }), false);
  assert.equal(adultBelowPolicyExpenseViolation({
    ageInMonths: 360,
    financialState: { employmentStatus: "self_employed", annualCoreExpenseWan: 1.8 },
    ledger: {
      expenseCommitments: [{
        ...exactLowCostLedger.expenseCommitments[0],
        factStatus: "estimated",
        evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING_ESTIMATED_V1" }]
      }]
    }
  }), true);
});

test("counts user-visible generation pauses once across app state and runner trace", () => {
  const record = {
    finalState: {
      generationEvents: [
        { id: "pause-1", type: "visible_pause", historyLength: 8, errorCode: "AI_RESPONSE_INVALID", message: "格式异常" },
        { id: "recovered-1", type: "recovered", historyLength: 9 }
      ]
    },
    interactionLog: [
      { type: "recoverable_error", generationEventId: "pause-1", historyLength: 8, message: "格式异常" },
      { type: "recoverable_retry_succeeded", generationEventId: "recovered-1", historyLength: 9 }
    ]
  };
  const pauses = collectVisibleGenerationPauses(record);
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].generationEventId, "pause-1");
  assert.equal(pauses[0].source, "app_state_and_runner");
  assert.equal(collectRecoveredGenerationAttempts(record), 1);
});

test("keeps runner-only legacy pause evidence auditable", () => {
  const pauses = collectVisibleGenerationPauses({
    interactionLog: [{ type: "recoverable_error", historyLength: 3, debug: "AiClientError: invalid" }]
  });
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].source, "runner");
});

test("release issue classification blocks facts but bounds servicing warnings by distressed accounts", () => {
  const distressed = new Set(["route-a:loan-a"]);
  const result = classifyTerminalFinancialIssues([
    {
      caseSlug: "route-a",
      id: "debt_payment_servicing_loan-a",
      code: "DEBT_PAYMENT_DELINQUENT",
      severity: "warning",
      status: "open",
      relatedDebtAccountIds: ["loan-a"]
    },
    {
      caseSlug: "route-a",
      id: "proposal_issue_bad",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      status: "open"
    },
    {
      caseSlug: "route-a",
      id: "old_warning",
      code: "LEGACY_UNCERTAINTY",
      severity: "warning",
      status: "open"
    }
  ], distressed);
  assert.equal(result.blockingOpenIssues.length, 1);
  assert.equal(result.servicingWarnings.length, 1);
  assert.equal(result.servicingWarningOverflow, 0);
  assert.deepEqual(result.orphanServicingWarnings, []);
});

test("servicing warnings for recovered or duplicated debt accounts fail the release classification", () => {
  const result = classifyTerminalFinancialIssues([
    { caseSlug: "route-a", id: "old-1", code: "DEBT_PAYMENT_MISSED", severity: "warning", status: "open", relatedDebtAccountIds: ["loan-a"] },
    { caseSlug: "route-a", id: "old-2", code: "DEBT_PAYMENT_DELINQUENT", severity: "warning", status: "open", relatedDebtAccountIds: ["loan-a"] }
  ], new Set());
  assert.equal(result.servicingWarningOverflow, 2);
  assert.deepEqual(result.orphanServicingWarnings, ["route-a:loan-a"]);
});
