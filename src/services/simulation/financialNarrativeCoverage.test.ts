import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { detectNarrativeFinancialCoverageIssues, narrativeRequiresCareerTransition, reconcileNarrativeFinancialIssues } from "./simulationService";

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

test("an authoritative mortgage fact does not imply a separately owned property", () => {
  const mortgageLedger = structuredClone(ledger);
  mortgageLedger.debtAccounts.push({
    id: "mortgage_existing",
    type: "mortgage",
    displayName: "现有住房按揭",
    principalWan: 35.5,
    openedAtAgeInMonths: 300,
    status: "active",
    repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 0.35, remainingTermMonths: 120 },
    factStatus: "known",
    evidence
  });
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你继续承担房贷，月供压力仍在可控范围内。",
    ledger: mortgageLedger,
    acceptedEvents: [],
    ageInMonths: 467
  });
  assert.equal(issues.some((issue) => issue.id.includes("property")), false);
  assert.equal(issues.some((issue) => issue.id.includes("mortgage")), false);
});

test("future home plans and relationship metaphors are not completed property facts", () => {
  for (const narrativeText of [
    "你们正式讨论两年后共同购买三居室的计划。",
    "林姐的女儿每周来你家住一天，你终于拥有了一个可以称之为家的关系。"
  ]) {
    const issues = detectNarrativeFinancialCoverageIssues({
      narrativeText,
      ledger,
      acceptedEvents: [],
      ageInMonths: 563
    });
    assert.equal(issues.some((issue) => issue.id.includes("property")), false);
  }
});

test("employee option grants do not create a protagonist option coverage issue", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你决定建立期权池，并授予销售总监和技术骨干各2%的期权。",
    ledger, acceptedEvents: [], ageInMonths: 372
  });
  assert.equal(issues.length, 0);
});

test("a conditional option promise is not treated as a completed personal grant", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "股权激励计划尚未正式设立，CEO只给你口头承诺：如果融资成功，会优先考虑你的期权。",
    ledger, acceptedEvents: [], ageInMonths: 373
  });
  assert.equal(issues.length, 0);
});

test("an option requiring future performance is not treated as a completed grant", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "新公司给你的年薪是42万，但期权部分需要等事业部业绩连续两年达标后才能兑现。",
    ledger,
    acceptedEvents: [],
    ageInMonths: 433
  });
  assert.equal(issues.some((issue) => issue.id.includes("personal_option")), false);
  assert.equal(issues.some((issue) => issue.id.includes("business_holding")), false);
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

test("historical salary comparisons and a resigned salary do not become current compensation facts", () => {
  for (const narrativeText of [
    "你想起那种踏实感是以前年薪32万时才有的。",
    "你辞去了年薪38万元的工作，开始创业。"
  ]) {
    const issues = detectNarrativeFinancialCoverageIssues({
      narrativeText,
      ledger,
      acceptedEvents: [],
      ageInMonths: 386
    });
    assert.equal(issues.length, 0);
  }
});

test("explicit protagonist job entry, role change and retirement require authoritative transitions", () => {
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你正式入职一家软件公司。", currentStatus: "student" }), true);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你决定换工作，加入新的团队。", currentStatus: "employed" }), true);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你办理退休，结束全职工作。", currentStatus: "employed" }), true);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "你继续当前岗位，本期没有变化。", currentStatus: "employed" }), false);
  assert.equal(narrativeRequiresCareerTransition({ narrativeText: "父亲正式退休，你为他庆祝。", currentStatus: "employed" }), false);
  assert.equal(narrativeRequiresCareerTransition({
    narrativeText: "投资人要求你全职投入产品。你面临抉择：是辞去稳定的UI/UX工作，还是保持现状。意向书条件是你必须在三个月内从现有公司离职并全职创业。",
    currentStatus: "employed"
  }), false);
  assert.equal(narrativeRequiresCareerTransition({
    narrativeText: "你最终决定辞去稳定的UI/UX工作，正式全职投入创业。",
    currentStatus: "employed"
  }), true);
  assert.equal(narrativeRequiresCareerTransition({
    narrativeText: "你的本职工作保持稳定，但房贷压力让你不敢轻易辞职。你开始认真考虑是否应该未来全职投入创业。",
    currentStatus: "employed"
  }), false);
});

test("post-sanitization narrative reconciliation resolves stale coverage blockers", () => {
  const staleIssue = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你的税后年薪调整为18万元。",
    ledger,
    acceptedEvents: [],
    ageInMonths: 430
  });
  assert.equal(staleIssue.length, 1);
  const reconciled = reconcileNarrativeFinancialIssues({
    issues: staleIssue,
    narrativeText: "你的个人收入仍以权威账本中已确认的记录为准。",
    ledger,
    acceptedEvents: [],
    ageInMonths: 430
  });
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].status, "resolved");
  assert.equal(reconciled[0].resolvedAtAgeInMonths, 430);
  assert.equal(reconciled[0].resolvedByEventId, "system:narrative_revalidated");
});
