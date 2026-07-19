import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { FinancialEventProposal, FinancialEvidence } from "./types";
import type { FinancialEventKind } from "./types";
import { validateFinancialPayloadSchema } from "./financialProposalSchema";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];

function setup() {
  return {
    currentCareerState: initializeCareerState({ id: "career_current", employmentStatus: "employed", effectiveFromAgeInMonths: 300 }),
    currentLedger: initializeFinancialLedger({
      id: "proposal_test",
      asOfAgeInMonths: 300,
      openingPosition: {
        cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }]
      }
    })
  };
}

function proposal(overrides: Partial<FinancialEventProposal> = {}): FinancialEventProposal {
  return {
    id: "bonus",
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: 312,
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 2 },
    sourceOutcomeId: "accepted_choice",
    evidence: "你已经收到2万元项目奖金。",
    confidence: 0.9,
    ...overrides
  };
}

function validate(proposals: FinancialEventProposal[], narrativeText = "这一年，你已经收到2万元项目奖金。") {
  return validateFinancialProposals({
    ...setup(),
    proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "proposal_validation",
    liquidityPolicy: "require_explicit"
  });
}

test("accepts valid proposals independently when an unrelated proposal is blocking", () => {
  const result = validate([
    proposal(),
    proposal({ id: "wrong_outcome", sourceOutcomeId: "other_choice" })
  ]);
  assert.deepEqual(result.acceptedEvents.map((event) => event.proposalId), ["bonus"]);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].relatedProposalIds, ["wrong_outcome"]);
});

test("rolls back only the event that fails incremental ledger trial", () => {
  const result = validate([
    proposal(),
    proposal({
      id: "unfunded",
      kind: "one_off_expense_paid",
      payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 50 },
      evidence: "你已经支付50万元费用。"
    })
  ], "这一年，你已经收到2万元项目奖金。你已经支付50万元费用。");
  assert.deepEqual(result.acceptedEvents.map((event) => event.proposalId), ["bonus"]);
  assert.equal(result.issues.some((issue) => issue.code === "MISSING_FUNDING_SOURCE" && issue.relatedProposalIds.includes("unfunded")), true);
});

test("uses normalized and amount-anchored evidence without accepting another subject", () => {
  const normalized = validate([
    proposal({ evidence: "你 已经 收到 2 万元项目奖金" })
  ]);
  assert.equal(normalized.acceptedEvents.length, 1);
  assert.equal(normalized.acceptedEvents[0].acceptedByReasonCodes.includes("EVIDENCE_NORMALIZED_MATCHED"), true);

  const fuzzy = validate([
    proposal({ evidence: "你获得了2万元奖金" })
  ], "项目结算后，你的账户实际收到2万元项目奖金。公司另获得200万元融资。");
  assert.equal(fuzzy.acceptedEvents.length, 1);
  assert.equal(fuzzy.acceptedEvents[0].acceptedByReasonCodes.includes("EVIDENCE_FUZZY_MATCHED"), true);

  const wrongSubject = validate([
    proposal({ evidence: "公司获得了2万元奖金" })
  ], "公司获得了2万元奖金，你继续正常工作。");
  assert.equal(wrongSubject.acceptedEvents.length, 0);
});

test("low-confidence but otherwise determinate facts are accepted as estimated", () => {
  const result = validate([proposal({
    id: "estimated_income",
    kind: "income_source_started",
    confidence: 0.7,
    evidence: "你开始每月获得1万元顾问收入。",
    payload: {
      id: "consulting",
      type: "contract",
      displayName: "顾问收入",
      monthlyNetAmountWan: 1,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      factStatus: "known",
      evidence
    }
  })], "你开始每月获得1万元顾问收入。");
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal((result.acceptedEvents[0].payload as { factStatus: string }).factStatus, "estimated");
});

test("rejects malformed kind payload before reducer trial without leaking undefined", () => {
  const result = validate([proposal({ id: "malformed_adjustment", kind: "income_source_adjusted", payload: { incomeSourceId: "salary_main" }, evidence: "你正式涨薪到每月3万元。" })], "你正式涨薪到每月3万元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0].summary, /payload\.nextSource/);
  assert.doesNotMatch(result.issues[0].summary, /undefined/i);
});

test("reports typed account mismatch with legal income-source candidates", () => {
  const context = setup();
  context.currentLedger.incomeSources.push({ id: "salary_main", type: "salary", displayName: "工资", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence });
  const nextSource = { ...structuredClone(context.currentLedger.incomeSources[0]), monthlyNetAmountWan: 3 };
  const result = validateFinancialProposals({ ...context, proposals: [proposal({ id: "wrong_typed_id", kind: "income_source_adjusted", payload: { incomeSourceId: PRIMARY_CASH_ACCOUNT_ID, nextSource: { ...nextSource, id: PRIMARY_CASH_ACCOUNT_ID } }, evidence: "你正式涨薪到每月3万元。" })], acceptedOutcomeId: "accepted_choice", narrativeText: "你正式涨薪到每月3万元。", periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "typed_mismatch", liquidityPolicy: "require_explicit" });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0].code, "ACCOUNT_TYPE_MISMATCH");
  assert.match(result.issues[0].summary, /salary_main/);
  assert.doesNotMatch(result.issues[0].summary, /undefined/i);
});

test("rejects company revenue and team payroll at the personal-ledger boundary", () => {
  const result = validate([
    proposal({
      id: "saas_revenue", kind: "income_source_started", evidence: "公司SaaS年费收入达到27万元。",
      payload: { id: "saas_revenue", type: "business_dividend", displayName: "SaaS年费收入", annualNetAmountWan: 27, accrualPolicy: "annual", activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    }),
    proposal({
      id: "team_payroll", kind: "expense_commitment_started", evidence: "公司团队工资和运营成本每月3.8万元。",
      payload: { id: "team_payroll", type: "other", displayName: "团队工资及运营成本", monthlyAmountWan: 3.8, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    })
  ], "公司SaaS年费收入达到27万元。公司团队工资和运营成本每月3.8万元。你没有从公司领取分红。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 2);
});

test("does not confuse a salary at a SaaS company with company revenue", () => {
  const result = validate([
    proposal({
      id: "saas_salary", kind: "income_source_started", evidence: "你正式入职跨境电商SaaS公司，税后月薪1.5万元。",
      payload: { id: "saas_salary", type: "salary", displayName: "SaaS公司税后工资", monthlyNetAmountWan: 1.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence }
    })
  ], "你正式入职跨境电商SaaS公司，税后月薪1.5万元。");
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 0);
  assert.equal(result.acceptedEvents.length, 1);
});

test("rejects nonprofit grants, hired staff payroll and warehouse rent from the personal ledger", () => {
  const result = validate([
    proposal({
      id: "nonprofit_grant", kind: "one_off_income_received", evidence: "青禾中心获得国家级公益项目资助，首期款30万元将在签约后到账。",
      payload: { amountWan: 30, destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID }
    }),
    proposal({
      id: "accountant_salary", kind: "expense_commitment_started", evidence: "你招聘一位专职会计，月薪4500元。",
      payload: { id: "expense_accountant_salary", type: "basic_living", displayName: "专职会计月薪", monthlyAmountWan: 0.45, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    }),
    proposal({
      id: "warehouse_rent", kind: "expense_commitment_started", evidence: "中心新增仓库月租800元。",
      payload: { id: "expense_warehouse_rent", type: "basic_living", displayName: "新增仓库月租", monthlyAmountWan: 0.08, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    })
  ], "青禾中心获得国家级公益项目资助，首期款30万元将在签约后到账。你招聘一位专职会计，月薪4500元。中心新增仓库月租800元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 3);
});

test("requires adjustment instead of stacking a second authoritative basic-living commitment", () => {
  const context = setup();
  context.currentLedger.expenseCommitments.push({
    id: "living_current", type: "basic_living", displayName: "当前生活费", monthlyAmountWan: 0.8,
    activeFromAgeInMonths: 300, status: "active", factStatus: "estimated", evidence
  });
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "living_duplicate", kind: "expense_commitment_started", evidence: "你的基本生活费调整为每月1万元。",
      payload: { id: "living_duplicate", type: "basic_living", displayName: "新的基本生活费", monthlyAmountWan: 1, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    })],
    acceptedOutcomeId: "accepted_choice", narrativeText: "你的基本生活费调整为每月1万元。",
    periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "duplicate_living", liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0].summary, /expense_commitment_adjusted/);
});

test("allows separate dependent-support commitments for different responsibilities", () => {
  const context = setup();
  context.currentLedger.expenseCommitments.push({
    id: "support_parent", type: "dependent_support", displayName: "父母照护费", monthlyAmountWan: 0.2,
    activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence
  });
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "support_child", kind: "expense_commitment_started", evidence: "你开始每月支付0.3万元子女教育生活费。",
      payload: { id: "support_child", type: "dependent_support", displayName: "子女教育生活费", monthlyAmountWan: 0.3, activeFromAgeInMonths: 312, status: "active", factStatus: "known", evidence }
    })],
    acceptedOutcomeId: "accepted_choice", narrativeText: "你开始每月支付0.3万元子女教育生活费。",
    periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "separate_support", liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 1);
});

test("every financial event kind has a payload schema that rejects an empty object", () => {
  const kinds: FinancialEventKind[] = ["income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended", "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended", "one_off_expense_paid", "asset_purchased", "asset_balance_discovered", "asset_sold", "asset_revalued", "debt_drawn", "debt_balance_discovered", "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven", "business_financing_recorded", "business_option_granted", "business_option_vested", "business_option_revalued", "business_option_exercised", "business_option_expired", "business_option_cancelled", "business_holding_revalued", "business_distribution_received", "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"];
  for (const kind of kinds) assert.ok(validateFinancialPayloadSchema(kind, {}).length > 0, `${kind} schema must reject {}`);
});
