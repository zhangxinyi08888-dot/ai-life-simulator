import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { detectNarrativeFinancialCoverageIssues, narrativeRequiresCareerTransition } from "./simulationService";

const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];
const ledger = initializeFinancialLedger({
  id: "coverage", asOfAgeInMonths: 360,
  openingPosition: { cashAccounts: [{ id: "cash_primary", type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }] }
});

test("narrative coverage catches missing property, mortgage and option facts", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你买下了一套公寓并背上房贷，公司还授予了你一批期权。",
    ledger, acceptedEvents: [], ageInMonths: 372
  });
  assert.deepEqual(issues.map((issue) => issue.id), [
    "narrative_coverage_property_372",
    "narrative_coverage_mortgage_372",
    "narrative_coverage_business_holding_372",
    "narrative_coverage_personal_option_372"
  ]);
  assert.ok(issues.every((issue) => issue.severity === "blocking"));
});

test("accepted directional events satisfy narrative coverage", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你买下了一套公寓并背上房贷，公司还授予了你一批期权。",
    ledger,
    acceptedEvents: [{ kind: "asset_purchased" }, { kind: "debt_drawn" }, { kind: "business_option_granted" }],
    ageInMonths: 372
  });
  assert.equal(issues.length, 0);
});

test("late-discovered balances satisfy coverage without a fake current-period purchase", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你每月偿还房贷4500元，这套自有住房仍有贷款余额。",
    ledger,
    acceptedEvents: [{ kind: "asset_balance_discovered" }, { kind: "debt_balance_discovered" }],
    ageInMonths: 373
  });
  assert.equal(issues.length, 0);
});

test("another person's mortgage does not create protagonist coverage", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "母亲提到表哥最近背上了房贷，你只是听着。",
    ledger, acceptedEvents: [], ageInMonths: 374
  });
  assert.equal(issues.length, 0);
});

test("employee option grants do not create a protagonist option coverage issue", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你决定建立期权池，并授予销售总监和技术骨干各2%的期权。",
    ledger, acceptedEvents: [], ageInMonths: 372
  });
  assert.equal(issues.length, 0);
});

test("a protagonist accepting sweat equity requires a personal holding", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你接受老张的干股提议，正式成为公司的联合创始人。",
    ledger, acceptedEvents: [], ageInMonths: 386
  });
  assert.deepEqual(issues.map((issue) => issue.id), ["narrative_coverage_business_holding_386"]);
});

test("personal salary narration requires a matching career-income event", () => {
  ledger.incomeSources.push({
    id: "salary_old", type: "salary", displayName: "旧工资", monthlyNetAmountWan: 2,
    accrualPolicy: "monthly", activeFromAgeInMonths: 360, status: "active", linkedCareerStateId: "career_current",
    factStatus: "estimated", evidence
  });
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你被任命为产品负责人，薪资调整为年薪42万元（月薪3.5万）。公司月收入达到4万元。",
    ledger, acceptedEvents: [], ageInMonths: 386
  });
  assert.deepEqual(issues.map((issue) => issue.id), ["narrative_coverage_personal_compensation_386"]);
  assert.deepEqual(issues[0].relatedIncomeSourceIds, ["salary_old"]);
  ledger.incomeSources.pop();
});

test("matching salary adjustment satisfies compensation coverage while staff payroll does not create it", () => {
  const matching = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你全职加入新公司，月薪3.5万。",
    ledger,
    acceptedEvents: [{ kind: "income_source_started", payload: { monthlyNetAmountWan: 3.5, linkedCareerStateId: "career_next" } }],
    ageInMonths: 386
  });
  assert.equal(matching.length, 0);
  const staffPayroll = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你招聘一位专职会计，月薪4500元。",
    ledger, acceptedEvents: [], ageInMonths: 386
  });
  assert.equal(staffPayroll.length, 0);
});

test("explicit protagonist job entry, role change and retirement require authoritative transitions", () => {
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你正式入职一家软件公司。", currentStatus: "student" }), true);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你决定换工作，加入新的团队。", currentStatus: "employed" }), true);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你办理退休，结束全职工作。", currentStatus: "employed" }), true);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你继续当前岗位，本期没有变化。", currentStatus: "employed" }), false);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "父亲正式退休，你为他庆祝。", currentStatus: "employed" }), false);
});
