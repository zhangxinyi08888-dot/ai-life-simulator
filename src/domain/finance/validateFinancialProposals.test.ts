import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { normalizeFinancialProposals } from "./normalizeFinancialProposals";
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

test("PB-ASSET-01 rejects an unsupported model asset type", () => {
  const result = validate([proposal({
    id: "bad_property",
    kind: "asset_purchased",
    evidence: "你已经支付8万元买下一套公寓。",
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      cashPaidWan: 8,
      transactionFeeWan: 0,
      assetAccount: {
        id: "bad_home", type: "real_estate", displayName: "公寓", marketValueWan: 8,
        liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 312, evidence: []
      }
    } as never
  })], "你已经支付8万元买下一套公寓。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "INVALID_ASSET_TYPE");
});

test("PB-ASSET-02 rejects sale of an asset absent from the ledger", () => {
  const result = validate([proposal({
    id: "missing_sale",
    kind: "asset_sold",
    evidence: "你已经卖掉城市公寓，收到20万元。",
    payload: {
      assetAccountId: "missing_city_apartment", destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      assetValueRemovedWan: 20, cashReceivedWan: 20, transactionFeeWan: 0
    }
  })], "你已经卖掉城市公寓，收到20万元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "UNBALANCED_TRANSACTION"), true);
});

test("asset purchase receives accepted-event evidence before entering the ledger", () => {
  const result = validate([proposal({
    id: "valid_asset",
    kind: "asset_purchased",
    evidence: "你已经支付8万元买入基金。",
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, cashPaidWan: 8, transactionFeeWan: 0,
      assetAccount: { id: "fund", type: "investment", displayName: "基金", marketValueWan: 8, liquidity: "liquid", status: "active", factStatus: "known", openedAtAgeInMonths: 312, evidence: [] }
    }
  })], "你已经支付8万元买入基金。");
  assert.equal(result.acceptedEvents.length, 1);
  const event = result.acceptedEvents[0];
  assert.equal(event.kind, "asset_purchased");
  if (event.kind === "asset_purchased") assert.equal(event.payload.assetAccount.evidence.length, 1);
});

test("new debt receives accepted-event evidence before debt-health eligibility", () => {
  const result = validate([proposal({
    id: "new_loan",
    kind: "debt_drawn",
    evidence: "你已经收到10万元个人借款。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 10,
      debtAccount: {
        id: "new_loan_account", type: "family_or_personal_loan", displayName: "个人借款",
        principalWan: 10, openedAtAgeInMonths: 312, status: "active",
        repaymentPolicy: { mode: "event_driven" }, factStatus: "known", origin: "explicit", evidence: []
      }
    }
  })], "你已经收到10万元个人借款。");
  assert.equal(result.acceptedEvents.length, 1);
  const event = result.acceptedEvents[0];
  assert.equal(event.kind, "debt_drawn");
  if (event.kind === "debt_drawn") assert.equal(event.payload.debtAccount.evidence[0]?.source, "accepted_simulation_outcome");
});

test("rejects a repeated discovery of the sole opening mortgage with the same balance", () => {
  const state = setup();
  state.currentLedger.debtAccounts.push({
    id: "opening_mortgage",
    type: "mortgage",
    displayName: "开局住房按揭",
    principalWan: 210,
    openedAtAgeInMonths: 288,
    status: "active",
    repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.875, remainingTermMonths: 240 },
    factStatus: "known",
    evidence,
    origin: "explicit"
  });
  const result = validateFinancialProposals({
    ...state,
    proposals: [proposal({
      id: "repeated_opening_mortgage",
      kind: "debt_balance_discovered",
      evidence: "你仍背着210万元房贷余额。",
      payload: {
        debtAccount: {
          id: "model_generated_mortgage",
          type: "mortgage",
          displayName: "住房贷款",
          principalWan: 210,
          openedAtAgeInMonths: 288,
          status: "active",
          repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.875, remainingTermMonths: 240 },
          factStatus: "known",
          evidence: [],
          origin: "explicit"
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你仍背着210万元房贷余额。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "repeated_opening_mortgage",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0]?.summary ?? "", /已存在且余额一致/);
});

test("rejects a discovered mortgage principal inferred only from monthly payment", () => {
  const state = setup();
  const result = validateFinancialProposals({
    ...state,
    proposals: [proposal({
      id: "invented_mortgage_balance",
      kind: "debt_balance_discovered",
      evidence: "你算了一笔账，每月房贷月供1.2万，加上生活开销，还能存下一些钱。",
      payload: {
        debtAccount: {
          id: "mortgage_primary",
          type: "mortgage",
          displayName: "待确认房贷",
          principalWan: 150,
          openedAtAgeInMonths: 312,
          status: "active",
          repaymentPolicy: { mode: "estimated_amortizing", monthlyPaymentWan: 1.2, remainingTermMonths: 240 },
          factStatus: "estimated",
          evidence: [],
          origin: "explicit"
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你算了一笔账，每月房贷月供1.2万，加上生活开销，还能存下一些钱。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "invented_mortgage_balance",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0]?.summary ?? "", /不能从月供、期限或利率反推本金/);
});

test("accepts a discovered debt balance when the evidence states the exact principal", () => {
  const state = setup();
  const result = validateFinancialProposals({
    ...state,
    proposals: [proposal({
      id: "explicit_mortgage_balance",
      kind: "debt_balance_discovered",
      evidence: "你核对账单后确认，当前房贷余额150万元。",
      payload: {
        debtAccount: {
          id: "mortgage_primary",
          type: "mortgage",
          displayName: "住房房贷",
          principalWan: 150,
          openedAtAgeInMonths: 312,
          status: "active",
          repaymentPolicy: { mode: "estimated_amortizing", remainingTermMonths: 240 },
          factStatus: "known",
          evidence: [],
          origin: "explicit"
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你核对账单后确认，当前房贷余额150万元。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "explicit_mortgage_balance",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.acceptedEvents[0]?.kind, "debt_balance_discovered");
});

test("an explicit family loan with no schedule normalizes to event-driven servicing", () => {
  const raw = proposal({
    id: "family_loan",
    kind: "debt_drawn",
    evidence: "你已经收到10万元父母借款。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 10,
      debtAccount: {
        id: "family_loan_account", type: "family_or_personal_loan", displayName: "父母借款",
        principalWan: 10, openedAtAgeInMonths: 312, status: "active",
        repaymentPolicy: { mode: "no_schedule", annualInterestRate: 0, monthlyPaymentWan: 0, remainingTermMonths: null },
        factStatus: "known", origin: "explicit", evidence: []
      }
    }
  });
  const normalized = normalizeFinancialProposals({
    proposals: [raw], acceptedOutcomeIds: ["accepted_choice"], currentLedger: setup().currentLedger, currentCareerStateId: "career_current"
  });
  const result = validate(normalized.proposals, "你已经收到10万元父母借款。");
  assert.equal(result.acceptedEvents.length, 1);
  if (result.acceptedEvents[0].kind !== "debt_drawn") throw new Error("expected debt draw");
  assert.equal(result.acceptedEvents[0].payload.debtAccount.repaymentPolicy.mode, "event_driven");
});

test("PB-BIZ-01 company operating revenue cannot be recorded as personal recurring income", () => {
  const companyRevenue = proposal({
    id: "company_revenue",
    kind: "income_source_started",
    evidence: "你经营的公司每月收到46万元营业收入。",
    payload: {
      id: "company_mrr",
      type: "salary",
      displayName: "公司营业收入",
      monthlyNetAmountWan: 46,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence: []
    }
  });
  Object.assign(companyRevenue, { financialScope: "business_operating" });
  const result = validate([companyRevenue], "你经营的公司每月收到46万元营业收入。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-02 company payroll and operating costs cannot be recorded as personal expenses", () => {
  const companyPayroll = proposal({
    id: "company_payroll",
    kind: "expense_commitment_started",
    evidence: "你每月支付29万元团队工资和销售提成。",
    payload: {
      id: "company_payroll_expense",
      type: "other",
      displayName: "团队工资与销售提成",
      monthlyAmountWan: 29,
      activeFromAgeInMonths: 312,
      status: "active",
      factStatus: "known",
      evidence: []
    }
  });
  Object.assign(companyPayroll, { financialScope: "business_operating" });
  const result = validate([companyPayroll], "你每月支付29万元团队工资和销售提成。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-03 personal salary, owner draw, and received dividend remain valid personal cash events", () => {
  const salary = proposal({
    id: "personal_salary",
    kind: "income_source_started",
    evidence: "你开始领取每月4万元税后工资。",
    payload: {
      id: "salary_income", type: "salary", displayName: "个人工资", monthlyNetAmountWan: 4,
      accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active",
      linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  Object.assign(salary, { financialScope: "personal" });
  assert.equal(validate([salary], "你开始领取每月4万元税后工资。").acceptedEvents.length, 1);

  const ownerDraw = proposal({
    id: "owner_draw",
    kind: "income_source_started",
    evidence: "你开始每月提取3万元作为个人可支配收入。",
    payload: {
      id: "owner_draw_income", type: "self_employment_draw", displayName: "业主提款", monthlyNetAmountWan: 3,
      accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active",
      linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  Object.assign(ownerDraw, { financialScope: "personal" });
  assert.equal(validate([ownerDraw], "你开始每月提取3万元作为个人可支配收入。").acceptedEvents.length, 1);

  const input = setup();
  input.currentLedger.businessHoldings.push({
    id: "holding_1",
    business: { id: "business_1", displayName: "个人工作室", status: "operating", factStatus: "known", evidence },
    ownershipRate: 1,
    personalCarryingValueWan: 0,
    status: "active",
    factStatus: "known",
    evidence
  });
  const dividend = proposal({
    id: "received_dividend",
    kind: "business_distribution_received",
    evidence: "公司已经向你的个人账户支付2万元分红。",
    payload: { businessHoldingId: "holding_1", destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 2 }
  });
  Object.assign(dividend, { financialScope: "personal" });
  const dividendResult = validateFinancialProposals({
    ...input,
    proposals: [dividend],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "公司已经向你的个人账户支付2万元分红。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "proposal_validation_dividend",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(dividendResult.acceptedEvents.length, 1);
});

test("PB-BIZ-04 personal founder contribution creates a holding without recording company operations", () => {
  const startBusiness = proposal({
    id: "start_business",
    kind: "business_holding_started",
    evidence: "你用10万元个人现金创办了供应链软件公司。",
    financialScope: "personal",
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      personalCashInvestedWan: 10,
      businessHolding: {
        id: "holding_supply_chain",
        business: {
          id: "business_supply_chain",
          displayName: "供应链软件公司",
          status: "operating",
          factStatus: "known",
          evidence: []
        },
        ownershipRate: 1,
        attributableValueWan: 10,
        liquidityDiscountRate: 0,
        personalCarryingValueWan: 10,
        status: "active",
        factStatus: "known",
        evidence: []
      }
    }
  });
  const result = validate([startBusiness], "你用10万元个人现金创办了供应链软件公司。");
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents[0].kind, "business_holding_started");
});

test("PB-BIZ-05 a misclassified company operating expense is normalized when prose proves a personal founder contribution", () => {
  const misclassified = proposal({
    id: "startup_funds",
    kind: "expense_commitment_started",
    evidence: "你从35万备用金中取出5万元作为公司初期运营资金。",
    financialScope: "business_operating",
    payload: {
      id: "company_ops",
      type: "business_operating",
      displayName: "公司运营开支",
      monthlyAmountWan: 0.8,
      activeFromAgeInMonths: 301,
      status: "active",
      factStatus: "known",
      evidence: []
    }
  });
  const normalized = normalizeFinancialProposals({
    proposals: [misclassified],
    acceptedOutcomeIds: ["accepted_choice"],
    currentLedger: setup().currentLedger,
    currentCareerStateId: "career_current"
  });
  const result = validate(normalized.proposals, "你从35万备用金中取出5万元作为公司初期运营资金。");
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.acceptedEvents[0].kind, "business_holding_started");
  if (result.acceptedEvents[0].kind !== "business_holding_started") throw new Error("expected founder contribution");
  assert.equal(result.acceptedEvents[0].payload.personalCashInvestedWan, 5);
});

test("PB-BIZ-06 a company customer contract cannot prove a personal owner draw", () => {
  const fakeDraw = proposal({
    id: "fake_owner_draw",
    kind: "income_source_started",
    evidence: "你签下了一家电子厂的试用合同，年费5万元。",
    financialScope: "personal",
    payload: {
      id: "owner_draw",
      type: "self_employment_draw",
      displayName: "创业期间个人提取",
      monthlyNetAmountWan: 0.3,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "estimated",
      evidence: []
    }
  });
  const result = validate([fakeDraw], "你签下了一家电子厂的试用合同，年费5万元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-25 business operating income type cannot enter the personal ledger even when scope is mislabeled", () => {
  const companyRevenue = proposal({
    id: "company_revenue_mislabeled_personal",
    kind: "income_source_started",
    payload: {
      id: "business_income_company", type: "business_operating", displayName: "创业公司合同收入",
      monthlyNetAmountWan: 1.67, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
      status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence: []
    },
    evidence: "三家客户年费18万元，实际到账10万元。"
  });
  Object.assign(companyRevenue, { financialScope: "personal" });
  const result = validate([companyRevenue], companyRevenue.evidence);
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-09 explicit personal consulting earnings can prove a self-employment draw", () => {
  const consulting = proposal({
    id: "consulting_income",
    kind: "income_source_started",
    evidence: "你开始接供应链咨询零活，每月能多挣5000元左右。",
    financialScope: "personal",
    payload: {
      id: "consulting_draw", type: "self_employment_draw", displayName: "个人咨询收入",
      monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  const result = validate([consulting], "你开始接供应链咨询零活，每月能多挣5000元左右。");
  assert.equal(result.acceptedEvents.length, 1);
});

test("a consulting fee paid by a named company remains personal compensation", () => {
  const consulting = proposal({
    id: "medical_ai_consulting",
    kind: "income_source_started",
    evidence: "你接受AI医疗创业公司的顾问工作，顾问收入每月1万元，直接支付到你的个人账户。",
    financialScope: "personal",
    payload: {
      id: "consultant_income_ai_tool_630",
      type: "contract",
      displayName: "AI医疗创业公司顾问费",
      monthlyNetAmountWan: 1,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence: []
    }
  });
  const result = validate([consulting], consulting.evidence);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), false);
  assert.equal(result.acceptedEvents.length, 1);
});

test("PB-BIZ-11 long-form personal consulting salary and owner draw evidence remain valid", () => {
  const consultantSalary = proposal({
    id: "long_consulting_salary",
    kind: "income_source_started",
    evidence: "你以每周10-15小时的节奏接下一家中小型制造企业的供应链优化顾问合同，税后月薪1.5万。",
    financialScope: "personal",
    payload: {
      id: "long_consulting_income", type: "salary", displayName: "兼职供应链顾问税后工资",
      monthlyNetAmountWan: 1.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  assert.equal(validate([consultantSalary], consultantSalary.evidence).acceptedEvents.length, 1);

  const ownerDraw = proposal({
    id: "explicit_owner_draw",
    kind: "income_source_started",
    evidence: "你给自己发了1万元作为个人提款。",
    financialScope: "personal",
    payload: {
      id: "explicit_owner_draw_income", type: "self_employment_draw", displayName: "创业项目个人提款",
      monthlyNetAmountWan: 0.4167, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  assert.equal(validate([ownerDraw], ownerDraw.evidence).acceptedEvents.length, 1);

  const companyPaidSalary = proposal({
    id: "company_paid_personal_salary",
    kind: "income_source_started",
    evidence: "公司从本月起每月向你个人账户支付4万元税后工资。",
    financialScope: "personal",
    payload: {
      id: "company_salary_income", type: "self_employment_draw", displayName: "创业公司个人税后工资",
      monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  assert.equal(validate([companyPaidSalary], companyPaidSalary.evidence).acceptedEvents.length, 1);

  const lowerOwnerSalary = proposal({
    id: "lower_owner_salary",
    kind: "income_source_adjusted",
    evidence: "你给自己降薪到每月2.5万元。",
    financialScope: "personal",
    payload: {
      incomeSourceId: "owner_draw_income",
      nextSource: {
        id: "owner_draw_income", type: "self_employment_draw", displayName: "业主工资",
        monthlyNetAmountWan: 2.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
      }
    }
  });
  const salaryInput = setup();
  salaryInput.currentLedger.incomeSources.push({
    id: "owner_draw_income", type: "self_employment_draw", displayName: "业主工资",
    monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
    status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
  });
  assert.equal(validateFinancialProposals({
    ...salaryInput,
    proposals: [lowerOwnerSalary],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: lowerOwnerSalary.evidence,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "lower_owner_salary",
    liquidityPolicy: "require_explicit"
  }).acceptedEvents.length, 1);
});

test("PB-BIZ-10 own reserve used as startup capital cannot become a debt draw", () => {
  const fakeDebt = proposal({
    id: "startup_from_reserve",
    kind: "debt_drawn",
    evidence: "你们把备用金中的15万元作为启动资金。",
    payload: {
      debtAccount: { id: "fake_startup_debt", type: "family_or_personal_loan", principalWan: 15 },
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 15
    }
  });
  const normalized = normalizeFinancialProposals({
    proposals: [fakeDebt], acceptedOutcomeIds: ["accepted_choice"], currentLedger: setup().currentLedger, currentCareerStateId: "career_current"
  });
  assert.equal(normalized.proposals[0].kind, "business_holding_started");
  assert.equal((normalized.proposals[0].payload as any).personalCashInvestedWan, 15);
});

test("PB-CAREER-07 a paraphrased resignation sentence can close the old salary", () => {
  const input = setup();
  input.currentLedger.incomeSources.push({
    id: "legacy_salary", type: "salary", displayName: "旧工作工资", monthlyNetAmountWan: 3,
    accrualPolicy: "monthly", activeFromAgeInMonths: 240, status: "active",
    linkedCareerStateId: "career_current", factStatus: "known", evidence: []
  });
  const closeSalary = proposal({
    id: "close_old_salary",
    kind: "income_source_ended",
    evidence: "你提交辞职信，拿到最后工资后正式离职。",
    financialScope: "personal",
    payload: { incomeSourceId: "legacy_salary" }
  });
  const result = validateFinancialProposals({
    ...input,
    proposals: [closeSalary],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你向公司提交辞职信时，主管有些意外。拿到最后一个月工资后，你正式开始了创业。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "career_close_paraphrase",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 1);
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

test("rejects nonprofit monthly donations from a personal career income source", () => {
  const context = setup();
  context.currentLedger.incomeSources.push({
    id: "career_income_current",
    type: "contract",
    displayName: "个人咨询收入",
    monthlyNetAmountWan: 1.8,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_current",
    factStatus: "known",
    evidence
  });
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "donation_income_adjusted_554",
      kind: "income_source_adjusted",
      effectiveAtAgeInMonths: 312,
      evidence: "机构月捐因协调员定期更新项目反馈，反而增至9500元。",
      payload: {
        incomeSourceId: "career_income_current",
        nextSource: {
          ...context.currentLedger.incomeSources.at(-1),
          id: "career_income_current",
          type: "other",
          displayName: "机构月捐收入",
          monthlyNetAmountWan: 0.95
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "咨询业务方面，你月税后收入稳定在1.8万元；机构月捐因协调员定期更新项目反馈，反而增至9500元。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "nonprofit_donation_boundary",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true, JSON.stringify(result.issues));
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

test("rejects a spouse salary from the protagonist ledger", () => {
  const result = validate([proposal({
    id: "spouse_salary", kind: "income_source_started", evidence: "小余考了会计证，找到一份出纳工作，月薪4500元。",
    payload: { id: "income_xiaoyu_accountant", type: "salary", displayName: "小余出纳工作", monthlyNetAmountWan: 0.45, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence }
  })], "小余考了会计证，找到一份出纳工作，月薪4500元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
  assert.match(result.issues[0].summary, /其他人物/);
});

test("rejects a spouse recurring transfer as protagonist income and requires family support events", () => {
  const result = validate([proposal({
    id: "wife_med_contribution", kind: "income_source_started",
    evidence: "妻子每月从工资里转2000元进你建立的医疗备用金账户。",
    payload: { id: "wife_med_contribution", type: "family_support", displayName: "妻子医疗金转入", monthlyNetAmountWan: 0.2, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence }
  })], "妻子每月从工资里转2000元进你建立的医疗备用金账户。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
  assert.match(result.issues[0].summary, /家庭支持事件/);
});

test("accepts only an explicit spouse transfer through family_support_received", () => {
  const accepted = validate([proposal({
    id: "wife_med_transfer", kind: "family_support_received",
    evidence: "妻子从工资里转2000元进你建立的医疗备用金账户。",
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 0.2 }
  })], "妻子从工资里转2000元进你建立的医疗备用金账户。");
  assert.equal(accepted.issues.length, 0, JSON.stringify(accepted.issues));
  assert.equal(accepted.acceptedEvents.length, 1);

  const rejected = validate([proposal({
    id: "wife_salary_as_support", kind: "family_support_received",
    evidence: "妻子目前月薪2万元。",
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 2 }
  })], "妻子目前月薪2万元。");
  assert.equal(rejected.acceptedEvents.length, 0);
  assert.equal(rejected.issues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
});

test("rewrites an accepted asset dependency from proposal id to event id", () => {
  const context = setup();
  context.currentLedger.cashAccounts[0].balanceWan = 54;
  const proposals = [
    proposal({
      id: "mortgage_draw", kind: "debt_drawn", evidence: "你办理126万元组合贷款。",
      payload: {
        debtAccount: { id: "mortgage", type: "mortgage", displayName: "房贷", principalWan: 126, openedAtAgeInMonths: 312, status: "active", repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.525, remainingTermMonths: 240 }, factStatus: "known", evidence },
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, principalDrawnWan: 126
      }
    }),
    proposal({
      id: "home_purchase", kind: "asset_purchased", evidence: "你用54万元首付和126万元组合贷款买下总价180万元的住房。",
      payload: {
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        assetAccount: { id: "home", type: "property", displayName: "自住房", marketValueWan: 180, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 312, evidence },
        cashPaidWan: 180, transactionFeeWan: 0, linkedDebtDrawEventId: "mortgage_draw"
      }
    })
  ];
  const result = validateFinancialProposals({
    ...context,
    proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你办理126万元组合贷款，用54万元首付买下总价180万元的住房。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "mortgage_purchase",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 2);
  assert.equal((result.acceptedEvents[1].payload as any).linkedDebtDrawEventId, "accepted_mortgage_draw");
});

test("allows compensation explicitly offered to the protagonist by another person", () => {
  const result = validate([proposal({
    id: "consulting_offer", kind: "income_source_started", evidence: "张哥问你要不要以技术顾问身份加入，每周远程工作十小时，月薪8000元；你最终决定接下兼职。",
    payload: { id: "income_consulting", type: "contract", displayName: "技术顾问收入", monthlyNetAmountWan: 0.8, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence }
  })], "张哥问你要不要以技术顾问身份加入，每周远程工作十小时，月薪8000元；你最终决定接下兼职。");
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 0);
  assert.equal(result.acceptedEvents.length, 1);
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
  const kinds: FinancialEventKind[] = ["income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended", "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended", "one_off_expense_paid", "asset_purchased", "asset_balance_discovered", "asset_sold", "asset_revalued", "debt_drawn", "debt_balance_discovered", "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven", "debt_default_recorded", "business_holding_started", "business_financing_recorded", "business_option_granted", "business_option_vested", "business_option_revalued", "business_option_exercised", "business_option_expired", "business_option_cancelled", "business_holding_revalued", "business_distribution_received", "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"];
  for (const kind of kinds) assert.ok(validateFinancialPayloadSchema(kind, {}).length > 0, `${kind} schema must reject {}`);
});
